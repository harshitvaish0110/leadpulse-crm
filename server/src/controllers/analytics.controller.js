/**
 * LeadPulse CRM — Analytics Controller
 *
 * Every report is limited to the caller's scope (reps see their own book,
 * managers everything) and accepts `from` / `to` (YYYY-MM-DD, UTC) where a
 * date range makes sense. Probabilities and rates are 0–1.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { scoped, isPrivileged } = require('../middleware/auth.middleware');
const { getForecast, weightedPipeline, monthStart } = require('../services/forecast.service');

const DAY_MS = 86_400_000;
const OPEN_STAGES = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION'];
const STAGES = [...OPEN_STAGES, 'CLOSED_WON', 'CLOSED_LOST'];

const dealsScope      = (req, where) => scoped(req.user, 'deal', where);
const contactsScope   = (req, where) => scoped(req.user, 'contact', where);
const tasksScope      = (req, where) => scoped(req.user, 'task', where);
const activitiesScope = (req, where) => scoped(req.user, 'activity', where);

/** `{ from, to }` from the query (inclusive UTC days), defaulting to the last `defaultDays`. */
function range(req, defaultDays) {
  const parse = (value, endOfDay) => {
    const d = new Date(`${String(value).slice(0, 10)}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    if (Number.isNaN(d.getTime())) throw ApiError.validation([{ path: endOfDay ? 'to' : 'from', msg: 'Use YYYY-MM-DD' }]);
    return d;
  };
  const to = req.query.to ? parse(req.query.to, true) : new Date();
  const from = req.query.from ? parse(req.query.from, false) : new Date(to.getTime() - defaultDays * DAY_MS);
  if (from > to) throw ApiError.validation([{ path: 'from', msg: 'from must be before to' }]);
  return { from, to };
}

const monthKey = (date) => date.toISOString().slice(0, 7);

/** Every UTC month from `from` to `to` as "YYYY-MM". */
function monthsBetween(from, to) {
  const keys = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cursor <= to) {
    keys.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

/** Monday of the UTC week containing `date`, as "YYYY-MM-DD". */
function weekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** GET /api/analytics/overview — dashboard KPIs. */
async function overview(req, res) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const yearAgo = new Date(now.getTime() - 365 * DAY_MS);

  const [totalContacts, newContactsThisMonth, totalDeals, openDeals, revenue, won, lost, tasksOverdue] = await Promise.all([
    prisma.contact.count({ where: contactsScope(req) }),
    prisma.contact.count({ where: contactsScope(req, { createdAt: { gte: monthStart } }) }),
    prisma.deal.count({ where: dealsScope(req) }),
    prisma.deal.count({ where: dealsScope(req, { stage: { in: OPEN_STAGES } }) }),
    prisma.deal.aggregate({ where: dealsScope(req, { stage: 'CLOSED_WON', closedAt: { gte: monthStart } }), _sum: { value: true } }),
    prisma.deal.count({ where: dealsScope(req, { stage: 'CLOSED_WON', closedAt: { gte: yearAgo } }) }),
    prisma.deal.count({ where: dealsScope(req, { stage: 'CLOSED_LOST', closedAt: { gte: yearAgo } }) }),
    prisma.task.count({ where: tasksScope(req, { completed: false, dueDate: { lt: now } }) }),
  ]);

  res.json({
    success: true,
    stats: {
      totalContacts, newContactsThisMonth, totalDeals, openDeals,
      revenueThisMonth: Math.round(Number(revenue._sum.value ?? 0)),
      winRate: won + lost ? Number((won / (won + lost)).toFixed(3)) : 0,
      won, lost, tasksOverdue,
    },
  });
}

/** GET /api/analytics/revenue — won revenue per UTC month (by close date) plus the forecast. */
async function revenue(req, res) {
  const { from, to } = range(req, 365);
  const rows = await prisma.deal.findMany({
    where:  dealsScope(req, { stage: 'CLOSED_WON', closedAt: { gte: from, lte: to } }),
    select: { value: true, closedAt: true },
  });

  const byMonth = Object.fromEntries(monthsBetween(from, to).map((k) => [k, 0]));
  for (const d of rows) byMonth[monthKey(d.closedAt)] = (byMonth[monthKey(d.closedAt)] ?? 0) + Number(d.value);
  const historical = Object.entries(byMonth).map(([month, y]) => ({ ds: `${month}-01`, y: Math.round(y) }));

  const totalRevenue = historical.reduce((s, m) => s + m.y, 0);
  const avgMonthly = historical.length ? Math.round(totalRevenue / historical.length) : 0;

  // The forecast continues from today, so it is only shown when the range reaches this month.
  // It is computed in the background; until then `forecastSource` is 'pending'.
  const now = new Date();
  const reachesNow = to >= monthStart(now);
  const [prediction, pipeline] = reachesNow
    ? await Promise.all([getForecast(req.user, now), weightedPipeline(req.user, now)])
    : [{ forecast: [], source: 'none' }, []];

  res.json({
    success: true, historical, totalRevenue, avgMonthly, pipeline,
    forecast: prediction.forecast, forecastSource: prediction.source, forecastGeneratedAt: prediction.generatedAt ?? null,
  });
}

/**
 * GET /api/analytics/pipeline — current snapshot per base stage: count, total value,
 * mean win probability and probability-weighted value (sum of value × probability).
 */
async function pipeline(req, res) {
  const rows = await prisma.deal.findMany({ where: dealsScope(req), select: { stage: true, value: true, winProbability: true } });
  const byStage = Object.fromEntries(STAGES.map((stage) => [stage, { count: 0, totalValue: 0, probSum: 0, weightedValue: 0 }]));
  for (const d of rows) {
    const s = byStage[d.stage];
    const value = Number(d.value);
    s.count += 1;
    s.totalValue += value;
    s.probSum += d.winProbability;
    s.weightedValue += value * d.winProbability;
  }
  const stages = STAGES.map((stage) => {
    const { count, totalValue, probSum, weightedValue } = byStage[stage];
    return {
      stage, count,
      totalValue:    Math.round(totalValue),
      avgWinProb:    count ? Number((probSum / count).toFixed(3)) : 0,
      weightedValue: Math.round(weightedValue),
    };
  });
  const totalPipelineValue = stages.filter((s) => OPEN_STAGES.includes(s.stage)).reduce((sum, s) => sum + s.totalValue, 0);
  res.json({ success: true, stages, totalPipelineValue });
}

/** GET /api/analytics/win-loss — deals closed in the range, with the lost-reason breakdown. */
async function winLoss(req, res) {
  const { from, to } = range(req, 365);
  const closedAt = { gte: from, lte: to };
  const [won, lost, lostDeals] = await Promise.all([
    prisma.deal.count({ where: dealsScope(req, { stage: 'CLOSED_WON', closedAt }) }),
    prisma.deal.count({ where: dealsScope(req, { stage: 'CLOSED_LOST', closedAt }) }),
    prisma.deal.groupBy({
      by: ['lostReason'],
      where: dealsScope(req, { stage: 'CLOSED_LOST', closedAt, lostReason: { not: null } }),
      _count: { _all: true },
    }),
  ]);
  const total = won + lost;
  res.json({
    success: true, won, lost, total,
    winRate: total ? Number((won / total).toFixed(3)) : 0,
    lostReasons: Object.fromEntries(lostDeals.map((r) => [r.lostReason, r._count._all])),
  });
}

/** GET /api/analytics/rep-performance — per owner: deals won and revenue in the range, open deals now. */
async function repPerformance(req, res) {
  const { from, to } = range(req, 365);
  const users = await prisma.user.findMany({
    where:  { isActive: true, ...(!isPrivileged(req.user) && { id: req.user.id }) },
    select: { id: true, firstName: true, lastName: true, role: true },
  });

  const reps = await Promise.all(users.map(async (user) => {
    const [won, openDeals, activities] = await Promise.all([
      prisma.deal.aggregate({ where: { ownerId: user.id, stage: 'CLOSED_WON', closedAt: { gte: from, lte: to } }, _count: { _all: true }, _sum: { value: true } }),
      prisma.deal.count({ where: { ownerId: user.id, stage: { in: OPEN_STAGES } } }),
      prisma.activity.count({ where: { userId: user.id, occurredAt: { gte: from, lte: to } } }),
    ]);
    return {
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
      wonDeals: won._count._all,
      revenue:  Math.round(Number(won._sum.value ?? 0)),
      openDeals,
      activities,
    };
  }));
  reps.sort((a, b) => b.revenue - a.revenue);
  res.json({ success: true, reps });
}

/** GET /api/analytics/sentiment-trends — mean sentiment (0–1) per UTC week. */
async function sentimentTrends(req, res) {
  const { from, to } = range(req, 84);
  const rows = await prisma.activity.findMany({
    where:  activitiesScope(req, { occurredAt: { gte: from, lte: to }, sentimentScore: { not: null } }),
    select: { sentimentScore: true, occurredAt: true, sentiment: true },
  });

  const weeks = {};
  for (const a of rows) {
    const key = weekKey(a.occurredAt);
    weeks[key] ??= { sum: 0, count: 0, breakdown: {} };
    weeks[key].sum += a.sentimentScore;
    weeks[key].count += 1;
    if (a.sentiment) weeks[key].breakdown[a.sentiment] = (weeks[key].breakdown[a.sentiment] || 0) + 1;
  }
  const trends = Object.entries(weeks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, w]) => ({ week, avgScore: Number((w.sum / w.count).toFixed(3)), count: w.count, breakdown: w.breakdown }));
  res.json({ success: true, trends });
}

/**
 * GET /api/analytics/funnel — of the deals created in the range, how many reached
 * each stage (by the furthest stage in their history). Lost deals count for the
 * open stages they reached; WON is the final step.
 */
async function funnel(req, res) {
  const { from, to } = range(req, 365);
  const deals = await prisma.deal.findMany({
    where:  dealsScope(req, { createdAt: { gte: from, lte: to } }),
    select: { id: true, stage: true },
  });
  const ordinal = (stage) => (stage === 'CLOSED_WON' ? OPEN_STAGES.length : OPEN_STAGES.indexOf(stage));
  const furthest = new Map(deals.map((d) => [d.id, ordinal(d.stage)]));
  const history = deals.length
    ? await prisma.dealStageHistory.findMany({ where: { dealId: { in: deals.map((d) => d.id) } }, select: { dealId: true, toStage: true } })
    : [];
  for (const h of history) furthest.set(h.dealId, Math.max(furthest.get(h.dealId), ordinal(h.toStage)));

  const steps = [...OPEN_STAGES, 'CLOSED_WON'];
  const reached = [...furthest.values()];
  res.json({
    success: true,
    total: deals.length,
    baseStages: steps.map((baseStage, i) => ({ baseStage, count: reached.filter((o) => o >= i).length })),
  });
}

/** GET /api/analytics/lead-sources — contacts created in the range, per lead-source tag. */
async function leadSources(req, res) {
  const { from, to } = range(req, 365);
  const tags = await prisma.tag.findMany({ where: { isSource: true }, orderBy: { name: 'asc' }, select: { name: true, color: true } });
  const counts = await Promise.all(tags.map((t) =>
    prisma.contact.count({ where: contactsScope(req, { tags: { has: t.name }, createdAt: { gte: from, lte: to } }) })));
  res.json({ success: true, sources: tags.map((t, i) => ({ tag: t.name, color: t.color, count: counts[i] })) });
}

/** GET /api/analytics/at-risk?limit=5 — churnRisk > 0.6 or sentimentScore < 0.3, riskiest first. */
async function atRisk(req, res) {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 5));
  const where = contactsScope(req, {
    status: { not: 'CHURNED' },
    OR: [{ churnRisk: { gt: 0.6 } }, { sentimentScore: { lt: 0.3 } }],
  });
  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: [{ churnRisk: 'desc' }, { sentimentScore: 'asc' }],
      take: limit,
      select: {
        id: true, firstName: true, lastName: true, email: true,
        churnRisk: true, sentimentScore: true, leadScoreLabel: true,
        company: { select: { id: true, name: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.contact.count({ where }),
  ]);
  res.json({ success: true, contacts, total });
}

const URGENCY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** GET /api/analytics/next-actions?limit=5 — stored next best actions, by urgency then lead score. */
async function nextActions(req, res) {
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));
  const rows = await prisma.contact.findMany({
    where:   contactsScope(req, { nextBestAction: { not: null }, status: { not: 'CHURNED' } }),
    orderBy: { leadScore: 'desc' },
    take:    200,
    select: {
      id: true, firstName: true, lastName: true, leadScore: true, leadScoreLabel: true,
      nextBestAction: true, nextBestActionAt: true,
      company: { select: { id: true, name: true } },
    },
  });
  const items = rows
    .map((c) => ({
      contact: { id: c.id, name: `${c.firstName} ${c.lastName}`, company: c.company, leadScore: c.leadScore, leadScoreLabel: c.leadScoreLabel },
      recommendation: c.nextBestAction,
      generatedAt: c.nextBestActionAt,
    }))
    .sort((a, b) => (URGENCY_RANK[a.recommendation?.urgency] ?? 3) - (URGENCY_RANK[b.recommendation?.urgency] ?? 3)
      || b.contact.leadScore - a.contact.leadScore)
    .slice(0, limit);
  res.json({ success: true, items });
}

module.exports = {
  overview, revenue, pipeline, winLoss, repPerformance, sentimentTrends,
  funnel, leadSources, atRisk, nextActions,
};
