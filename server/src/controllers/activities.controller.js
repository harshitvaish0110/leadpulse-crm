/**
 * LeadPulse CRM — Activities Controller
 *
 * Reads live here; writes and sentiment scoring are in activities.service.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { scoped, scopeFor } = require('../middleware/auth.middleware');
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

/**
 * POST /api/activities/upload-audio (multipart `audio`, `contactId`, `dealId?`, `occurredAt?`)
 * Stores the recording and answers 202; the transcript arrives later (socket `activity:transcribed`).
 */
async function uploadAudio(req, res) {
  if (!req.file) throw ApiError.badRequest('No audio file uploaded (field "audio")');
  const { contactId, dealId, occurredAt } = req.body ?? {};
  res.status(202).json({ success: true, activity: await activities.logRecording(req.user, { contactId, dealId, occurredAt, file: req.file }) });
}

/** POST /api/activities/:id/retry-transcription */
async function retryTranscription(req, res) {
  res.status(202).json({ success: true, activity: await activities.retryTranscription(req.user, req.params.id) });
}

/** GET /api/activities/:id/audio-url → { url, expiresAt } (10 minutes) */
async function audioUrl(req, res) {
  res.json({ success: true, ...(await activities.recordingUrl(req.user, req.params.id)) });
}

module.exports = { list, create, getOne, remove, uploadAudio, retryTranscription, audioUrl };
