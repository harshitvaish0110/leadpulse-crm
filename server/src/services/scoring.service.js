/**
 * LeadPulse — Scoring.
 *
 * Lead score: rules in leadScore.js (0–120), recomputed per contact on change
 * and nightly. Churn risk and win probability: the ML service, fed rows from
 * the ml_contact_features / ml_deal_features views (the same rows train.py
 * learns from) and sent by feature name. Probabilities are 0–1.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { ml } = require('../lib/mlClient');
const { emitScoped } = require('../lib/realtime');
const { notify } = require('../lib/notify');
const { computeLeadScore, explainLeadScore } = require('./leadScore');
const triggers = require('../queues/triggers');

const DAY_MS = 86_400_000;
const CLOSED = ['CLOSED_WON', 'CLOSED_LOST'];
const ML_BATCH = 500;
const CHURN_ALERT = 0.7;
const MIN_CHANGE = 0.01;

// Must match ml-service/services/features.py; the ML service rejects rows that drift.
const CHURN_FEATURES = ['days_since_last_contact', 'activity_count_30d', 'activity_count_90d', 'avg_sentiment', 'deal_count', 'total_deal_value', 'has_open_deal'];
const WIN_FEATURES = ['stage_ordinal', 'deal_value', 'days_in_current_stage', 'total_activities', 'activity_last_7d', 'contact_seniority', 'company_size'];

const pick = (row, features) => Object.fromEntries([['id', row.id], ...features.map((f) => [f, Number(row[f])])]);
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Calls an ML prediction endpoint in batches; returns Map(id → probability). Throws if the service is down. */
async function predict(path, rows, features, key) {
  const out = new Map();
  for (const batch of chunks(rows, ML_BATCH)) {
    const { data } = await ml.post(path, { rows: batch.map((r) => pick(r, features)) }, { timeout: 30_000 });
    for (const p of data.predictions) out.set(p.id, Math.min(1, Math.max(0, p[key])));
  }
  return out;
}

/** One history point (the AI Insights charts read these). */
const snapshot = (entityType, entityId, metric, value) => prisma.scoreSnapshot.create({ data: { entityType, entityId, metric, value } });

/** The lead score as of `now`, with its components, without saving it. */
async function leadScoreResult(contactId, now = new Date()) {
  const [last, activityCount30d, openDeals] = await Promise.all([
    prisma.activity.findFirst({ where: { contactId }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
    prisma.activity.count({ where: { contactId, occurredAt: { gt: new Date(now.getTime() - 30 * DAY_MS) } } }),
    prisma.deal.findMany({ where: { contactId, stage: { notIn: CLOSED } }, select: { value: true, stage: true } }),
  ]);
  return computeLeadScore({ lastActivityAt: last?.occurredAt ?? null, activityCount30d, openDeals, now });
}

/**
 * Recomputes and stores the score, label and rules explanation.
 * @param {string} contactId
 * @param {Date}   [now]
 * @returns {Promise<{ score: number, label: string, explanation: string }>}
 */
async function calculateAndSaveLeadScore(contactId, now = new Date()) {
  const result = await leadScoreResult(contactId, now);
  const explanation = explainLeadScore(result);

  await prisma.contact.update({
    where: { id: contactId },
    data:  { leadScore: result.score, leadScoreLabel: result.label, leadScoreExplanation: explanation },
  });

  return { score: result.score, label: result.label, explanation };
}

/** Job `rescore-contact`: lead score after a change; tells the owner's views when it moved. */
async function rescoreContact(contactId) {
  const before = await prisma.contact.findUnique({ where: { id: contactId }, select: { leadScore: true, leadScoreLabel: true, ownerId: true } });
  if (!before) return { skipped: 'deleted' };
  const after = await calculateAndSaveLeadScore(contactId);
  const changed = after.score !== before.leadScore || after.label !== before.leadScoreLabel;
  if (changed) {
    await snapshot('contact', contactId, 'leadScore', after.score);
    emitScoped([before.ownerId], 'contact:updated', { contactId, leadScore: after.score, leadScoreLabel: after.label });
    triggers.reindex('contact', contactId);
  }
  return { score: after.score, changed };
}

/** Job `rescore-deal`: win probability of one open deal (closed deals stay at 1 or 0). */
async function rescoreDeal(dealId) {
  const rows = await prisma.$queryRaw`SELECT * FROM ml_deal_features WHERE "id" = ${dealId} AND is_closed = 0`;
  if (!rows.length) return { skipped: 'closed or deleted' };

  const probability = (await predict('/predict/win_prob', rows, WIN_FEATURES, 'probability')).get(dealId);
  const before = await prisma.deal.findUnique({ where: { id: dealId }, select: { winProbability: true } });
  if (probability === undefined || !before) return { skipped: 'no prediction' };

  const deal = await prisma.deal.update({
    where: { id: dealId },
    data: { winProbability: probability },
    select: { ownerId: true, contact: { select: { ownerId: true } } },
  });
  if (Math.abs(probability - before.winProbability) >= MIN_CHANGE) {
    await snapshot('deal', dealId, 'winProbability', probability);
    emitScoped([deal.ownerId, deal.contact.ownerId], 'deal:score_updated', { dealId, winProbability: probability });
    triggers.reindex('deal', dealId);
  }
  return { winProbability: probability };
}

// ── Nightly batch ──────────────────────────────────────────────────────────────

/** Churn risk for the given contacts; alerts the owner only when a contact crosses into high risk. */
async function scoreChurn(contacts) {
  const ids = contacts.map((c) => c.id);
  const rows = ids.length ? await prisma.$queryRaw`SELECT * FROM ml_contact_features WHERE "id" = ANY(${ids}::text[])` : [];
  const risks = await predict('/predict/churn', rows, CHURN_FEATURES, 'risk');

  for (const contact of contacts) {
    const risk = risks.get(contact.id);
    if (risk === undefined) continue;
    await prisma.contact.update({ where: { id: contact.id }, data: { churnRisk: risk } });

    if (risk > CHURN_ALERT && (contact.churnRisk ?? 0) <= CHURN_ALERT) {
      const name = `${contact.firstName} ${contact.lastName}`;
      emitScoped([contact.ownerId], 'contact:churn_alert', { contactId: contact.id, name, churnRisk: risk });
      await notify([contact.ownerId], {
        type: 'churn', title: 'Churn risk alert',
        message: `${name} is now at ${Math.round(risk * 100)}% churn risk`,
        link: `/contacts/${contact.id}`, data: { contactId: contact.id },
      });
    }
  }
  return risks.size;
}

/** Win probability for every open deal. */
async function scoreOpenDeals() {
  const rows = await prisma.$queryRaw`SELECT * FROM ml_deal_features WHERE is_closed = 0`;
  const probabilities = await predict('/predict/win_prob', rows, WIN_FEATURES, 'probability');
  for (const [id, winProbability] of probabilities) await prisma.deal.update({ where: { id }, data: { winProbability } });
  return probabilities.size;
}

/** Lead score for each contact, 20 at a time. */
async function scoreLeads(contacts, now = new Date()) {
  let scored = 0;
  for (const batch of chunks(contacts, 20)) {
    const results = await Promise.allSettled(batch.map((c) => calculateAndSaveLeadScore(c.id, now)));
    scored += results.filter((r) => r.status === 'fulfilled').length;
  }
  return scored;
}

/** One history point per metric: lead score, churn and sentiment per contact; win probability per open deal. */
async function writeSnapshots(contactIds, now = new Date()) {
  const [contacts, deals] = await Promise.all([
    prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, leadScore: true, churnRisk: true, sentimentScore: true } }),
    prisma.deal.findMany({ where: { stage: { notIn: CLOSED } }, select: { id: true, winProbability: true } }),
  ]);
  const data = [
    ...contacts.flatMap((c) => [
      { entityType: 'contact', entityId: c.id, metric: 'leadScore', value: c.leadScore, takenAt: now },
      { entityType: 'contact', entityId: c.id, metric: 'churnRisk', value: c.churnRisk, takenAt: now },
      { entityType: 'contact', entityId: c.id, metric: 'sentimentScore', value: c.sentimentScore, takenAt: now },
    ]),
    ...deals.map((d) => ({ entityType: 'deal', entityId: d.id, metric: 'winProbability', value: d.winProbability, takenAt: now })),
  ];
  if (data.length) await prisma.scoreSnapshot.createMany({ data });
  return data.length;
}

module.exports = {
  CHURN_FEATURES, WIN_FEATURES, MIN_CHANGE,
  snapshot, leadScoreResult, calculateAndSaveLeadScore, rescoreContact, rescoreDeal,
  scoreChurn, scoreOpenDeals, scoreLeads, writeSnapshots,
};
