/**
 * LeadPulse — Nightly scoring.
 *
 * For every LEAD/ACTIVE contact: churn risk (ML), lead score (rules), and a
 * history snapshot of lead score, churn and sentiment. For every open deal: win
 * probability (ML) and a snapshot. Feature rows come from the ml_*_features
 * views, the same source train.py learns from, and are sent to the ML service
 * by name. Runs on SCORING_CRON (default 02:00) or on demand: `npm run score`.
 */

'use strict';

const cron = require('node-cron');
const { ml } = require('../lib/mlClient');
const { emitScoped } = require('../lib/realtime');
const { notify } = require('../lib/notify');
const { prisma } = require('../lib/prisma');
const { calculateAndSaveLeadScore } = require('../services/scoring.service');

const CRON_EXPR = process.env.SCORING_CRON || '0 2 * * *';
const TZ = process.env.TZ || 'Asia/Kolkata';
const ML_BATCH = 500;
const SCORE_CONCURRENCY = 20;
const CHURN_ALERT = 0.7;

// Must match ml-service/services/features.py; the ML service rejects rows that drift.
const CHURN_FEATURES = ['days_since_last_contact', 'activity_count_30d', 'activity_count_90d', 'avg_sentiment', 'deal_count', 'total_deal_value', 'has_open_deal'];
const WIN_FEATURES = ['stage_ordinal', 'deal_value', 'days_in_current_stage', 'total_activities', 'activity_last_7d', 'contact_seniority', 'company_size'];

const pick = (row, features) => Object.fromEntries([['id', row.id], ...features.map((f) => [f, Number(row[f])])]);
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Calls an ML prediction endpoint in batches; returns Map(id → probability), empty if the service is down. */
async function predict(path, rows, features, key) {
  const out = new Map();
  for (const batch of chunks(rows, ML_BATCH)) {
    const { data } = await ml.post(path, { rows: batch.map((r) => pick(r, features)) }, { timeout: 30_000 });
    for (const p of data.predictions) out.set(p.id, p[key]);
  }
  return out;
}

async function scoreChurn(contacts) {
  const ids = contacts.map((c) => c.id);
  const rows = ids.length ? await prisma.$queryRaw`SELECT * FROM ml_contact_features WHERE "id" = ANY(${ids}::text[])` : [];
  let risks;
  try {
    risks = await predict('/predict/churn', rows, CHURN_FEATURES, 'risk');
  } catch (err) {
    console.warn('[Scoring] churn predictions skipped:', err.message);
    return 0;
  }

  for (const contact of contacts) {
    const risk = risks.get(contact.id);
    if (risk === undefined) continue;
    await prisma.contact.update({ where: { id: contact.id }, data: { churnRisk: risk } });

    // Alert only when a contact crosses into high risk, not on every run.
    if (risk > CHURN_ALERT && (contact.churnRisk ?? 0) <= CHURN_ALERT) {
      const name = `${contact.firstName} ${contact.lastName}`;
      emitScoped([contact.ownerId], 'contact:churn_alert', { contactId: contact.id, name, churnRisk: risk });
      notify([contact.ownerId], {
        type: 'churn', title: 'Churn risk alert',
        message: `${name} is now at ${Math.round(risk * 100)}% churn risk`,
        link: `/contacts/${contact.id}`, data: { contactId: contact.id },
      });
    }
  }
  return risks.size;
}

async function scoreDeals() {
  const rows = await prisma.$queryRaw`SELECT * FROM ml_deal_features WHERE is_closed = 0`;
  let probabilities;
  try {
    probabilities = await predict('/predict/win_prob', rows, WIN_FEATURES, 'probability');
  } catch (err) {
    console.warn('[Scoring] win predictions skipped:', err.message);
    return { scored: 0, owners: [] };
  }
  const owners = new Set();
  for (const [id, probability] of probabilities) {
    const deal = await prisma.deal.update({ where: { id }, data: { winProbability: probability }, select: { ownerId: true, contact: { select: { ownerId: true } } } });
    owners.add(deal.ownerId).add(deal.contact?.ownerId);
  }
  return { scored: probabilities.size, owners: [...owners] };
}

async function writeSnapshots(contactIds, now) {
  const [contacts, deals] = await Promise.all([
    prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, leadScore: true, churnRisk: true, sentimentScore: true } }),
    prisma.deal.findMany({ where: { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } }, select: { id: true, winProbability: true } }),
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

async function runNightlyScoring({ now = new Date() } = {}) {
  const started = Date.now();
  const contacts = await prisma.contact.findMany({
    where:  { status: { not: 'CHURNED' } }, // churned customers are already gone; everyone else can still churn
    select: { id: true, firstName: true, lastName: true, ownerId: true, churnRisk: true },
  });
  console.log(`[Scoring] ${contacts.length} contacts…`);

  const churnScored = await scoreChurn(contacts);

  let leadScored = 0;
  for (const batch of chunks(contacts, SCORE_CONCURRENCY)) {
    const results = await Promise.allSettled(batch.map((c) => calculateAndSaveLeadScore(c.id, now)));
    leadScored += results.filter((r) => r.status === 'fulfilled').length;
  }

  const deals = await scoreDeals();
  const snapshots = await writeSnapshots(contacts.map((c) => c.id), now);

  // One refresh per affected user rather than one event per deal.
  emitScoped([...new Set([...contacts.map((c) => c.ownerId), ...deals.owners])], 'deal:score_updated', { bulk: true });

  const summary = { contacts: contacts.length, churnScored, leadScored, dealsScored: deals.scored, snapshots, seconds: (Date.now() - started) / 1000 };
  console.log('[Scoring] done', summary);
  return summary;
}

/** Schedules the nightly run. A failed run is logged and retried on the next schedule; it never takes the API down. */
function startScoringSchedule() {
  cron.schedule(CRON_EXPR, () => runNightlyScoring().catch((err) => console.error('[Scoring] run failed:', err.message)), { timezone: TZ });
  console.log(`[Scoring] scheduled "${CRON_EXPR}" (${TZ})`);
}

module.exports = { runNightlyScoring, startScoringSchedule, CHURN_FEATURES, WIN_FEATURES };

// `npm run score` — one run, then exit.
if (require.main === module) {
  runNightlyScoring()
    .then(() => process.exit(0))
    .catch((err) => { console.error('[Scoring] failed:', err); process.exit(1); });
}
