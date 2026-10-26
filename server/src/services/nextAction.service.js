/**
 * LeadPulse — Next best action: one recommended step per contact, stored on the
 * contact (`nextBestAction`, `nextBestActionAt`) so the contact page and the
 * dashboard show it without another LLM call.
 */

'use strict';

const { setTimeout: sleep } = require('node:timers/promises');
const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { emitScoped } = require('../lib/realtime');
const ai = require('./ai');
const prompts = require('./ai/prompts');

const DAY_MS = 86_400_000;
const CLOSED = ['CLOSED_WON', 'CLOSED_LOST'];
const STALE_AFTER_DAYS = 3;

/**
 * Asks the AI for the contact's next step and stores it. The caller has already
 * checked that the contact (and the deal, if any) is in the user's scope.
 * @returns {Promise<{ recommendation: object, generatedAt: Date }>}
 */
async function recommendNextAction(contactId, { userId = null, dealId = null } = {}) {
  const dealSelect = { title: true, stage: true, value: true, winProbability: true, pipelineStage: { select: { label: true } } };
  const [contact, lastEmail, deal] = await Promise.all([
    prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
      include: {
        company: { select: { name: true } },
        activities: { take: 5, orderBy: { occurredAt: 'desc' }, select: { type: true, subject: true, notes: true, sentiment: true, occurredAt: true } },
        deals: { where: { stage: { notIn: CLOSED } }, select: dealSelect },
      },
    }),
    prisma.emailDraft.findFirst({ where: { contactId, status: { not: 'DRAFT' } }, orderBy: { createdAt: 'desc' }, select: { direction: true, sentAt: true, receivedAt: true, createdAt: true } }),
    dealId ? prisma.deal.findUnique({ where: { id: dealId }, select: dealSelect }) : null,
  ]);
  const last = contact.activities[0]?.occurredAt;
  const daysSinceContact = last ? Math.floor((Date.now() - last.getTime()) / DAY_MS) : null;

  const { data } = await ai.getJSON(prompts.nextAction({ contact, deal, daysSinceContact, lastEmail }), {
    log: { userId, contactId, dealId, input: { contactId, dealId, source: userId ? 'user' : 'nightly' } },
  });
  const generatedAt = new Date();
  await prisma.contact.update({ where: { id: contactId }, data: { nextBestAction: data, nextBestActionAt: generatedAt } });
  emitScoped([contact.ownerId], 'contact:updated', { contactId });
  return { recommendation: data, generatedAt };
}

/**
 * Nightly: refreshes the recommendation of the highest-scoring HOT/WARM leads and
 * customers whose recommendation is missing or over 3 days old. Calls are spaced
 * 6 s apart (Gemini's free tier allows about 10 requests a minute), and the batch
 * stops at the first sign that every provider is out of quota.
 */
async function refreshNextActions({ limit = Number(process.env.NBA_BATCH_SIZE) || 20, spacingMs = 6000 } = {}) {
  const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * DAY_MS);
  const due = await prisma.contact.findMany({
    where: {
      status: { in: ['LEAD', 'ACTIVE'] },
      leadScoreLabel: { in: ['HOT', 'WARM'] },
      OR: [{ nextBestActionAt: null }, { nextBestActionAt: { lt: cutoff } }],
    },
    orderBy: [{ leadScore: 'desc' }, { id: 'asc' }], // many contacts share a score; keep the pick stable
    take: limit,
    select: { id: true },
  });

  let refreshed = 0;
  for (const [i, { id }] of due.entries()) {
    if (i) await sleep(spacingMs);
    try {
      await recommendNextAction(id);
      refreshed += 1;
    } catch (err) {
      if (['AI_UNAVAILABLE', 'AI_NOT_CONFIGURED'].includes(err.code)) return { due: due.length, refreshed, stopped: err.code };
      logger.warn({ event: 'nba_failed', contactId: id, err: err.message }, 'Next best action failed');
    }
  }
  return { due: due.length, refreshed };
}

module.exports = { recommendNextAction, refreshNextActions };
