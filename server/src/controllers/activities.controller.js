/**
 * LeadPulse CRM — Activities Controller
 *
 * Async sentiment analysis via ML service (non-blocking).
 * Rolling contact sentiment recalculation after each activity.
 */

'use strict';

const axios      = require('axios');
const fs         = require('fs');
const FormData   = require('form-data');
const { prisma } = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');

const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';

const ACTIVITY_INCLUDE = {
  contact: { select: { id: true, firstName: true, lastName: true } },
  deal:    { select: { id: true, title: true } },
  user:    { select: { id: true, firstName: true, lastName: true } },
};

function emit(req, event, payload) {
  const io = req.app.get('io');
  if (io) io.emit(event, payload);
}

/**
 * GET /api/activities
 * Paginated, filterable by type, contactId, dealId, userId, date range.
 */
async function list(req, res, next) {
  try {
    const {
      page = 1, limit = 25,
      contactId, dealId, userId, type,
      dateFrom, dateTo,
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * limitNum;

    const where = {
      AND: [
        contactId ? { contactId } : {},
        dealId    ? { dealId }    : {},
        userId    ? { userId }    : {},
        type      ? { type }      : {},
        dateFrom || dateTo ? {
          occurredAt: {
            ...(dateFrom && { gte: new Date(dateFrom) }),
            ...(dateTo   && { lte: new Date(dateTo)   }),
          },
        } : {},
      ],
    };

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        skip,
        take:    limitNum,
        orderBy: { occurredAt: 'desc' },
        include: ACTIVITY_INCLUDE,
      }),
      prisma.activity.count({ where }),
    ]);

    res.json({
      success: true,
      activities,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/activities
 * Creates activity then asynchronously runs sentiment analysis.
 */
async function create(req, res, next) {
  try {
    const { type, subject, notes, contactId, dealId, durationMinutes, occurredAt } = req.body;

    if (!type || !contactId) throw ApiError.badRequest('type and contactId are required');

    const VALID_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'TRANSCRIPT'];
    if (!VALID_TYPES.includes(type)) {
      throw ApiError.badRequest(`type must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const activity = await prisma.activity.create({
      data: {
        type,
        subject:         subject         || null,
        notes:           notes           || null,
        durationMinutes: durationMinutes ? parseInt(durationMinutes, 10) : null,
        contactId,
        dealId:          dealId          || null,
        userId:          req.user.id,
        occurredAt:      occurredAt      ? new Date(occurredAt) : new Date(),
      },
      include: ACTIVITY_INCLUDE,
    });

    // Non-blocking async sentiment analysis
    if (['NOTE', 'CALL', 'EMAIL', 'MEETING'].includes(type) && notes?.trim()) {
      setImmediate(() => runSentimentAnalysis(activity.id, contactId, notes));
    }

    emit(req, 'activity:created', { activityId: activity.id, contactId });
    res.status(201).json({ success: true, activity });
  } catch (err) {
    next(err);
  }
}

/**
 * Calls the ML service, updates the activity's sentiment fields,
 * then recalculates and updates the contact's rolling sentiment score.
 */
async function runSentimentAnalysis(activityId, contactId, text) {
  try {
    const { data } = await axios.post(
      `${ML_URL}/sentiment/analyze`,
      { text },
      { timeout: 10_000 }
    );

    const { sentiment, score } = data;

    await prisma.activity.update({
      where: { id: activityId },
      data:  { sentiment, sentimentScore: score },
    });

    // Recalculate rolling average from all scored activities
    const scored = await prisma.activity.findMany({
      where:  { contactId, sentimentScore: { not: null } },
      select: { sentimentScore: true },
    });

    if (scored.length > 0) {
      const avg = scored.reduce((s, a) => s + a.sentimentScore, 0) / scored.length;
      await prisma.contact.update({
        where: { id: contactId },
        data:  { sentimentScore: Math.round(avg * 100) / 100 },
      });
    }
  } catch (err) {
    // Non-critical — ML service may be unavailable in dev
    console.warn('[Sentiment] analysis skipped:', err.message);
  }
}

/**
 * GET /api/activities/:id
 */
async function getOne(req, res, next) {
  try {
    const activity = await prisma.activity.findUnique({
      where:   { id: req.params.id },
      include: ACTIVITY_INCLUDE,
    });
    if (!activity) throw ApiError.notFound('Activity not found');
    res.json({ success: true, activity });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/activities/:id
 */
async function remove(req, res, next) {
  try {
    await prisma.activity.delete({ where: { id: req.params.id } });
    emit(req, 'activity:deleted', { activityId: req.params.id });
    res.json({ success: true, message: 'Activity deleted' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/activities/upload-audio
 * Forwards audio file to ML service for Whisper transcription + Claude extraction.
 * Creates a TRANSCRIPT activity in the database.
 */
async function uploadAudio(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });

    const { contactId, dealId } = req.body;
    if (!contactId) return res.status(400).json({ error: 'contactId required' });

    // Forward file to Python ML service
    const form = new FormData();
    form.append('audio', fs.createReadStream(req.file.path), {
      filename:    req.file.originalname || 'recording.mp3',
      contentType: req.file.mimetype,
    });

    let extraction;
    try {
      const mlRes = await axios.post(`${ML_URL}/transcribe/`, form, {
        headers: form.getHeaders(),
        timeout: 120_000, // 2 min for long recordings
      });
      extraction = mlRes.data;
    } catch (mlErr) {
      extraction = {
        transcript:      'Transcription service unavailable',
        summary:         'ML service not running. Start with: python app.py in ml-service/',
        sentiment:       'NEUTRAL',
        actionItems:     [],
        objections:      [],
        pricingMentions: [],
        nextSteps:       '',
        keyTopics:       [],
      };
    } finally {
      // Always clean up uploaded file
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    // Create TRANSCRIPT activity in DB
    const activity = await prisma.activity.create({
      data: {
        type:      'TRANSCRIPT',
        subject:   'Call Recording',
        notes:     extraction.summary,
        sentiment: extraction.sentiment || 'NEUTRAL',
        metadata:  JSON.stringify(extraction),
        contactId,
        dealId:    dealId || null,
        userId:    req.user.id,
        occurredAt: new Date(),
      },
      include: ACTIVITY_INCLUDE,
    });

    emit(req, 'activity:created', { activityId: activity.id, contactId });
    res.json({ success: true, activity, extraction });
  } catch (err) {
    // Clean up file on unexpected errors
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(err);
  }
}

module.exports = { list, create, getOne, remove, uploadAudio };
