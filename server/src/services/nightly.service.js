/**
 * LeadPulse — Nightly pipeline.
 *
 * Stages run in order; each one is caught and logged on its own, so one failing
 * stage (say, the ML service is asleep) doesn't stop the others. A second run on
 * the same local day is a no-op unless forced. The summary is kept in Redis for
 * /health/ready (and in memory when there is no Redis).
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { getJSON, setJSON } = require('../lib/redis');
const { emitScoped } = require('../lib/realtime');
const scoring = require('./scoring.service');
const activities = require('./activities.service');
const nextActions = require('./nextAction.service');
const forecast = require('./forecast.service');
const semanticIndex = require('./semanticIndex.service');
const { localDate } = require('../lib/dates');

const SUMMARY_KEY = 'lp:nightly:last';
const DAY_MS = 86_400_000;
let lastInMemory = null;

async function orgTimezone() {
  const settings = await prisma.orgSettings.findUnique({ where: { id: 1 }, select: { timezone: true } }).catch(() => null);
  return settings?.timezone || process.env.TZ || 'Asia/Kolkata';
}

async function lastNightly() {
  return (await getJSON(SUMMARY_KEY)) ?? lastInMemory;
}

/** Expired sessions and invitations, old read notifications, history of deleted records. */
async function housekeeping(now) {
  const before = (days) => new Date(now.getTime() - days * DAY_MS);
  const [tokens, invitations, notifications, snapshots] = await Promise.all([
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: before(7) } } }),
    prisma.invitation.deleteMany({ where: { expiresAt: { lt: before(30) } } }),
    prisma.notification.deleteMany({ where: { readAt: { lt: before(90) } } }),
    prisma.$executeRaw`
      DELETE FROM "score_snapshots" s
      WHERE (s."entityType" = 'contact' AND NOT EXISTS (SELECT 1 FROM "contacts" c WHERE c."id" = s."entityId"))
         OR (s."entityType" = 'deal' AND NOT EXISTS (SELECT 1 FROM "deals" d WHERE d."id" = s."entityId"))`,
  ]);
  return { refreshTokens: tokens.count, invitations: invitations.count, notifications: notifications.count, snapshots };
}

/**
 * @param {{ force?: boolean, now?: Date }} [options]
 * @returns {Promise<object>} the run summary, or `{ skipped }`
 */
async function runNightly({ force = false, now = new Date() } = {}) {
  const date = localDate(now, await orgTimezone());
  const last = await lastNightly();
  if (!force && last?.date === date) return { skipped: `already ran on ${date}` };

  const started = Date.now();
  const contacts = await prisma.contact.findMany({
    where: { status: { not: 'CHURNED' } }, // churned customers are already gone; everyone else can still churn
    select: { id: true, firstName: true, lastName: true, ownerId: true, churnRisk: true },
  });

  const stages = {};
  const stage = async (name, fn) => {
    const t = Date.now();
    try {
      stages[name] = { ok: true, result: await fn(), ms: Date.now() - t };
    } catch (err) {
      stages[name] = { ok: false, error: err.message, ms: Date.now() - t };
      logger.warn({ event: 'nightly_stage_failed', stage: name, err: err.message }, 'Nightly stage failed');
    }
  };

  await stage('sentimentBackfill', () => activities.backfillSentiment(now));
  await stage('churn', () => scoring.scoreChurn(contacts));
  await stage('winProbability', () => scoring.scoreOpenDeals());
  await stage('leadScores', () => scoring.scoreLeads(contacts, now));
  await stage('snapshots', () => scoring.writeSnapshots(contacts.map((c) => c.id), now));
  await stage('nextActions', () => nextActions.refreshNextActions());
  await stage('forecast', () => forecast.warmForecasts(now));
  await stage('reindex', () => semanticIndex.reindexAll());
  await stage('housekeeping', () => housekeeping(now));

  // One refresh per affected user rather than one event per record.
  emitScoped([...new Set(contacts.map((c) => c.ownerId))], 'deal:score_updated', { bulk: true });

  const summary = { date, finishedAt: new Date().toISOString(), seconds: (Date.now() - started) / 1000, stages };
  lastInMemory = summary;
  await setJSON(SUMMARY_KEY, summary, 8 * 86_400);
  logger.info({ event: 'nightly_done', date, seconds: summary.seconds, failed: Object.keys(stages).filter((s) => !stages[s].ok) }, 'Nightly pipeline done');
  return summary;
}

module.exports = { runNightly, lastNightly, housekeeping, localDate, orgTimezone };
