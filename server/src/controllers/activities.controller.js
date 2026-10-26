/**
 * LeadPulse CRM — Activities Controller
 *
 * Reads live here; writes and sentiment scoring are in activities.service.
 */

'use strict';

const fs         = require('fs');
const { prisma } = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { scoped, scopeFor } = require('../middleware/auth.middleware');
const { ml } = require('../lib/mlClient');
const { logger } = require('../lib/logger');
const activities = require('../services/activities.service');

const { ACTIVITY_INCLUDE } = activities;

/**
 * GET /api/activities
 * Paginated, filterable by type, contactId, dealId, companyId, userId and date range.
 */
async function list(req, res) {
  const {
    page = 1, limit = 25,
    contactId, dealId, companyId, userId, type,
    dateFrom, dateTo,
  } = req.query;

  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const skip     = (pageNum - 1) * limitNum;

  const where = scoped(req.user, 'activity', {
    AND: [
      contactId ? { contactId } : {},
      dealId    ? { dealId }    : {},
      companyId ? { contact: { companyId } } : {},
      userId    ? { userId }    : {},
      type      ? { type }      : {},
      dateFrom || dateTo ? {
        occurredAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo   && { lte: new Date(dateTo)   }),
        },
      } : {},
    ],
  });

  const [items, total] = await Promise.all([
    prisma.activity.findMany({ where, skip, take: limitNum, orderBy: { occurredAt: 'desc' }, include: ACTIVITY_INCLUDE }),
    prisma.activity.count({ where }),
  ]);

  res.json({
    success: true,
    activities: items,
    meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
  });
}

/** POST /api/activities — sentiment is scored in the background. */
async function create(req, res) {
  res.status(201).json({ success: true, activity: await activities.logActivity(req.user, req.body) });
}

/** GET /api/activities/:id */
async function getOne(req, res) {
  const activity = await prisma.activity.findFirst({
    where:   { id: req.params.id, ...scopeFor(req.user, 'activity') },
    include: ACTIVITY_INCLUDE,
  });
  if (!activity) throw ApiError.notFound('Activity not found');
  res.json({ success: true, activity });
}

/** DELETE /api/activities/:id */
async function remove(req, res) {
  await activities.deleteActivity(req.user, req.params.id);
  res.json({ success: true, message: 'Activity deleted' });
}

const FALLBACK_EXTRACTION = {
  transcript:      null,
  summary:         'Transcription is unavailable right now. The recording was not processed.',
  sentiment:       null,
  actionItems:     [],
  objections:      [],
  pricingMentions: [],
  nextSteps:       '',
  keyTopics:       [],
};

/**
 * POST /api/activities/upload-audio (multipart field `audio`)
 * Sends the recording to the ML service for transcription and logs a TRANSCRIPT activity.
 */
async function uploadAudio(req, res) {
  const file = req.file;
  try {
    if (!file) throw ApiError.badRequest('No audio file uploaded (field "audio")');
    const { contactId, dealId } = req.body;
    await activities.assertParents(req.user, contactId, dealId);

    const form = new FormData();
    form.append('audio', new Blob([await fs.promises.readFile(file.path)], { type: file.mimetype }), file.originalname || 'recording.webm');

    let extraction;
    try {
      ({ data: extraction } = await ml.post('/transcribe/', form, { timeout: 120_000 }));
    } catch (err) {
      logger.warn({ event: 'transcription_unavailable', err: err.message }, 'Transcription unavailable');
      extraction = FALLBACK_EXTRACTION;
    }

    const activity = await activities.logCallRecording(req.user, { contactId, dealId, extraction });
    res.json({ success: true, activity, extraction });
  } finally {
    if (file?.path) fs.promises.unlink(file.path).catch(() => {});
  }
}

module.exports = { list, create, getOne, remove, uploadAudio };
