/**
 * LeadPulse — Activity writes and sentiment scoring.
 *
 * Writes return as soon as the row is saved; sentiment, rescoring and indexing
 * follow as background jobs (queues/triggers.js).
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { scopeFor, assertInScope, assertContactInScope } = require('../middleware/auth.middleware');
const { ml } = require('../lib/mlClient');
const { emitScoped } = require('../lib/realtime');
const { logger } = require('../lib/logger');
const storage = require('../lib/storage');
const { queueTranscription } = require('./transcription.service');
const { afterActivityChange, reindex, SENTIMENT_TYPES } = require('../queues/triggers');
const { removeFromIndex } = require('./semanticIndex.service');
const { snapshot, MIN_CHANGE } = require('./scoring.service');

const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'TRANSCRIPT'];
const SENTIMENT_LABELS = new Set(['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'AT_RISK']);
const ROLLING_WINDOW = 10;

const ACTIVITY_INCLUDE = {
  contact: { select: { id: true, firstName: true, lastName: true } },
  deal:    { select: { id: true, title: true } },
  user:    { select: { id: true, firstName: true, lastName: true } },
};

/** Contact must be in scope; a deal, if given, must be in scope and belong to that contact. */
async function assertParents(user, contactId, dealId) {
  if (!contactId) throw ApiError.badRequest('contactId is required');
  const contact = await assertContactInScope(user, contactId, { id: true, ownerId: true });
  if (dealId) {
    const deal = await assertInScope(user, 'deal', dealId, { contactId: true });
    if (deal.contactId !== contactId) throw ApiError.badRequest('Deal does not belong to this contact', null, 'DEAL_CONTACT_MISMATCH');
  }
  return contact;
}

const emitCreated = (activity, ownerId) => emitScoped(
  [activity.userId, ownerId],
  'activity:created',
  { activityId: activity.id, contactId: activity.contactId, dealId: activity.dealId },
);

async function logActivity(user, input) {
  const { type, subject, notes, contactId, dealId, durationMinutes, occurredAt } = input;
  if (!ACTIVITY_TYPES.includes(type)) throw ApiError.badRequest(`type must be one of: ${ACTIVITY_TYPES.join(', ')}`);
  const contact = await assertParents(user, contactId, dealId);

  const when = occurredAt ? new Date(occurredAt) : new Date();
  if (Number.isNaN(when.getTime())) throw ApiError.validation([{ path: 'occurredAt', msg: 'occurredAt must be a date' }]);

  const activity = await prisma.activity.create({
    data: {
      type,
      subject:         subject || null,
      notes:           notes || null,
      durationMinutes: durationMinutes ? parseInt(durationMinutes, 10) : null,
      contactId,
      dealId:          dealId || null,
      userId:          user.id,
      occurredAt:      when,
    },
    include: ACTIVITY_INCLUDE,
  });

  emitCreated(activity, contact.ownerId);
  afterActivityChange(activity, { created: true });
  return activity;
}

const AUDIO_EXTENSIONS = {
  'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a', 'audio/m4a': '.m4a', 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/flac': '.flac',
};

/**
 * Stores a call recording privately and creates its TRANSCRIPT activity in
 * `processing` state; transcription follows as a background job.
 * @param {{ buffer: Buffer, mimetype: string }} file
 */
async function logRecording(user, { contactId, dealId, occurredAt, file }) {
  const contact = await assertParents(user, contactId, dealId);
  const when = occurredAt ? new Date(occurredAt) : new Date();
  if (Number.isNaN(when.getTime())) throw ApiError.validation([{ path: 'occurredAt', msg: 'occurredAt must be a date' }]);

  const key = storage.newKey('audio', `call${AUDIO_EXTENSIONS[file.mimetype.split(';')[0]] ?? '.webm'}`);
  await storage.put(key, file.buffer);
  const activity = await prisma.activity.create({
    data: {
      type: 'TRANSCRIPT', subject: 'Call recording', audioKey: key, metadata: { status: 'processing' },
      contactId, dealId: dealId || null, userId: user.id, occurredAt: when,
    },
    include: ACTIVITY_INCLUDE,
  });

  emitCreated(activity, contact.ownerId);
  afterActivityChange(activity, { created: true });
  await queueTranscription(activity.id);
  return activity;
}

/** POST /activities/:id/retry-transcription — only for a recording whose transcription failed. */
async function retryTranscription(user, activityId) {
  const activity = await prisma.activity.findFirst({ where: { id: activityId, ...scopeFor(user, 'activity') }, select: { id: true, audioKey: true, metadata: true } });
  if (!activity?.audioKey) throw ApiError.notFound('Recording not found');
  if (activity.metadata?.status !== 'failed') throw ApiError.conflict('Only a failed transcription can be retried', 'NOT_FAILED');
  const updated = await prisma.activity.update({
    where: { id: activityId },
    data: { metadata: { status: 'processing' } },
    include: ACTIVITY_INCLUDE,
  });
  await queueTranscription(activityId);
  return updated;
}

/** A 10-minute link to play the recording. */
async function recordingUrl(user, activityId) {
  const activity = await prisma.activity.findFirst({ where: { id: activityId, ...scopeFor(user, 'activity') }, select: { audioKey: true, occurredAt: true } });
  if (!activity?.audioKey) throw ApiError.notFound('Recording not found');
  const ext = activity.audioKey.slice(activity.audioKey.lastIndexOf('.'));
  return storage.signedUrl(activity.audioKey, `call-${activity.occurredAt.toISOString().slice(0, 10)}${ext}`);
}

/**
 * Job `sentiment`: scores one activity's notes with the ML service, then refreshes
 * the contact's rolling sentiment (mean of its last 10 scored activities).
 * Throws when the ML service is unreachable, so the job is retried.
 */
async function scoreSentiment(activityId) {
  const activity = await prisma.activity.findUnique({
    where:  { id: activityId },
    select: { id: true, notes: true, userId: true, contactId: true, contact: { select: { ownerId: true, sentimentScore: true } } },
  });
  if (!activity?.notes?.trim()) return { skipped: activity ? 'no notes' : 'deleted' };

  const { data } = await ml.post('/sentiment/analyze', { text: activity.notes }, { timeout: 15_000 });
  const label = SENTIMENT_LABELS.has(data.mapped_sentiment) ? data.mapped_sentiment : null;
  const score = typeof data.score === 'number' ? Math.min(1, Math.max(0, data.score)) : null;
  if (score === null) return { skipped: 'no score' };

  await prisma.activity.update({ where: { id: activityId }, data: { sentiment: label, sentimentScore: score } });

  const recent = await prisma.activity.findMany({
    where:   { contactId: activity.contactId, sentimentScore: { not: null } },
    orderBy: { occurredAt: 'desc' },
    take:    ROLLING_WINDOW,
    select:  { sentimentScore: true },
  });
  const rolling = Math.round((recent.reduce((sum, a) => sum + a.sentimentScore, 0) / recent.length) * 100) / 100;
  await prisma.contact.update({ where: { id: activity.contactId }, data: { sentimentScore: rolling } });
  if (Math.abs(rolling - activity.contact.sentimentScore) >= MIN_CHANGE) await snapshot('contact', activity.contactId, 'sentimentScore', rolling);

  const owners = [activity.userId, activity.contact.ownerId];
  emitScoped(owners, 'activity:updated', { activityId, contactId: activity.contactId, sentiment: label });
  emitScoped(owners, 'contact:updated', { contactId: activity.contactId });
  reindex('activity', activityId);
  reindex('contact', activity.contactId);
  return { label, score, source: data.source };
}

/**
 * Nightly: scores recent activities whose sentiment job never succeeded (say the ML
 * service was down through every retry), newest first, at most `limit` per night.
 */
async function backfillSentiment(now = new Date(), limit = 200) {
  const missed = await prisma.activity.findMany({
    where: {
      sentimentScore: null,
      type: { in: [...SENTIMENT_TYPES] },
      notes: { not: null },
      createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true },
  });
  let scored = 0;
  for (const { id } of missed) if ((await scoreSentiment(id)).score !== undefined) scored += 1;
  return { missed: missed.length, scored };
}

async function deleteActivity(user, activityId) {
  const activity = await prisma.activity.delete({
    where:  { id: activityId, ...scopeFor(user, 'activity') },
    select: { id: true, userId: true, contactId: true, dealId: true, audioKey: true, contact: { select: { ownerId: true } } },
  });
  await removeFromIndex({ activity: [activity.id] });
  if (activity.audioKey) await storage.remove(activity.audioKey).catch((err) => logger.warn({ event: 'audio_remove_failed', err: err.message }, 'Recording not deleted'));
  emitScoped([activity.userId, activity.contact.ownerId], 'activity:deleted', { activityId: activity.id, contactId: activity.contactId });
  afterActivityChange(activity, { deleted: true });
}

module.exports = {
  ACTIVITY_TYPES, ACTIVITY_INCLUDE,
  assertParents, logActivity, logRecording, retryTranscription, recordingUrl, scoreSentiment, backfillSentiment, deleteActivity,
};
