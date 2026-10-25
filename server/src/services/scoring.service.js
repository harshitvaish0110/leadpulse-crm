/**
 * LeadPulse — Scoring Service
 * Recomputes and stores a contact's lead score (0–120) with the shared rules
 * in leadScore.js, so the seed, the nightly job and on-demand rescoring agree.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { computeLeadScore, explainLeadScore } = require('./leadScore');

const DAY_MS = 86_400_000;
const CLOSED = ['CLOSED_WON', 'CLOSED_LOST'];

/**
 * @param {string} contactId
 * @param {Date}   [now]
 * @returns {Promise<{ score: number, label: string, explanation: string }>}
 */
async function calculateAndSaveLeadScore(contactId, now = new Date()) {
  const [last, activityCount30d, openDeals] = await Promise.all([
    prisma.activity.findFirst({ where: { contactId }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
    prisma.activity.count({ where: { contactId, occurredAt: { gt: new Date(now.getTime() - 30 * DAY_MS) } } }),
    prisma.deal.findMany({ where: { contactId, stage: { notIn: CLOSED } }, select: { value: true, stage: true } }),
  ]);

  const result = computeLeadScore({ lastActivityAt: last?.occurredAt ?? null, activityCount30d, openDeals, now });
  const explanation = explainLeadScore(result);

  await prisma.contact.update({
    where: { id: contactId },
    data:  { leadScore: result.score, leadScoreLabel: result.label, leadScoreExplanation: explanation },
  });

  return { score: result.score, label: result.label, explanation };
}

module.exports = { calculateAndSaveLeadScore };
