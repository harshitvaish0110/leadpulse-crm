/**
 * LeadPulse — Activity writes and sentiment scoring.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { scopeFor, assertInScope, assertContactInScope } = require('../middleware/auth.middleware');
const { ml } = require('../lib/mlClient');
const { emitScoped } = require('../lib/realtime');

const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'TRANSCRIPT'];
const SENTIMENT_LABELS = new Set(['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'AT_RISK']);
const SCORED_TYPES = new Set(['NOTE', 'CALL', 'EMAIL', 'MEETING']);
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

  // Fire-and-forget in this process for now; belongs on the job queue once there is one.
  if (SCORED_TYPES.has(type) && notes?.trim()) setImmediate(() => scoreSentiment(activity.id, contactId, notes));

  emitCreated(activity, contact.ownerId);
  return activity;
}

/** Creates the TRANSCRIPT activity for an analysed call recording. */
async function logCallRecording(user, { contactId, dealId, extraction }) {
  const contact = await assertParents(user, contactId, dealId);
  const sentiment = SENTIMENT_LABELS.has(extraction.sentiment) ? extraction.sentiment : null;

  const activity = await prisma.activity.create({
    data: {
      type:       'TRANSCRIPT',
      subject:    'Call Recording',
      notes:      extraction.summary || null,
      transcript: extraction.transcript || null,
      sentiment,
      metadata:   extraction,
      contactId,
      dealId:     dealId || null,
      userId:     user.id,
      occurredAt: new Date(),
    },
    include: ACTIVITY_INCLUDE,
  });

  emitCreated(activity, contact.ownerId);
  return activity;
}

/**
 * Scores one activity with the ML service, then refreshes the contact's rolling
 * sentiment (mean of its last 10 scored activities). Failures are logged, not thrown.
 */
async function scoreSentiment(activityId, contactId, text) {
  try {
    const { data } = await ml.post('/sentiment/analyze', { text });
    const label = SENTIMENT_LABELS.has(data.mapped_sentiment) ? data.mapped_sentiment : null;
    const score = typeof data.score === 'number' ? Math.min(1, Math.max(0, data.score)) : null;
    if (score === null) return;

    await prisma.activity.update({ where: { id: activityId }, data: { sentiment: label, sentimentScore: score } });

    const recent = await prisma.activity.findMany({
      where:   { contactId, sentimentScore: { not: null } },
      orderBy: { occurredAt: 'desc' },
      take:    ROLLING_WINDOW,
      select:  { sentimentScore: true },
    });
    const avg = recent.reduce((sum, a) => sum + a.sentimentScore, 0) / recent.length;
    await prisma.contact.update({ where: { id: contactId }, data: { sentimentScore: Math.round(avg * 100) / 100 } });
  } catch (err) {
    console.warn('[Sentiment] analysis skipped:', err.message);
  }
}

async function deleteActivity(user, activityId) {
  const activity = await prisma.activity.delete({
    where:  { id: activityId, ...scopeFor(user, 'activity') },
    select: { id: true, userId: true, contactId: true, contact: { select: { ownerId: true } } },
  });
  emitScoped([activity.userId, activity.contact.ownerId], 'activity:deleted', { activityId: activity.id, contactId: activity.contactId });
}

module.exports = {
  ACTIVITY_TYPES, ACTIVITY_INCLUDE,
  assertParents, logActivity, logCallRecording, scoreSentiment, deleteActivity,
};
