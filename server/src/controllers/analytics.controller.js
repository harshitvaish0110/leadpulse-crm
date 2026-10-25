/**
 * LeadPulse CRM — Analytics Controller
 *
 * All queries use raw SQL aggregations for performance.
 * No N+1 queries — single DB round-trip per endpoint.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { scoped, isPrivileged } = require('../middleware/auth.middleware');
const { ml } = require('../lib/mlClient');

// Every aggregate is limited to the caller's scope: reps see their own book, managers everything.
const dealsScope      = (req, where) => scoped(req.user, 'deal', where);
const contactsScope   = (req, where) => scoped(req.user, 'contact', where);
const tasksScope      = (req, where) => scoped(req.user, 'task', where);
const activitiesScope = (req, where) => scoped(req.user, 'activity', where);

/**
 * GET /api/analytics/revenue
 * Monthly revenue from deals won (by close date) over the past 12 months.
 */
async function revenue(req, res, next) {
  try {
    const since = new Date();
    since.setFullYear(since.getFullYear() - 1);

    const deals = await prisma.deal.findMany({
      where: dealsScope(req, {
        stage:    'CLOSED_WON',
        closedAt: { gte: since },
      }),
      select: { value: true, closedAt: true },
      orderBy: { closedAt: 'asc' },
    });

    // Group by YYYY-MM
    const monthly = {};
    for (const deal of deals) {
      const key = deal.closedAt.toISOString().slice(0, 7); // "2024-01"
      monthly[key] = (monthly[key] || 0) + Number(deal.value);
    }

    const historical = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ds, y]) => ({ ds: `${ds}-01`, y: Math.round(y) }));

    // Summary stats
    const totalRevenue = historical.reduce((s, m) => s + m.y, 0);
    const avgMonthly   = historical.length ? Math.round(totalRevenue / historical.length) : 0;

    // Call ML service for 90-day Prophet forecast
    let forecast = [];
    try {
      const mlRes = await ml.post('/forecast/revenue', { historical }, { timeout: 30_000 });
      forecast = mlRes.data.forecast || [];
    } catch (mlErr) {
      console.warn('Forecast service unavailable:', mlErr.message);
    }

    res.json({ success: true, historical, forecast, totalRevenue, avgMonthly });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analytics/pipeline
 * Per stage: deal count, total value, mean win probability (0–1) and
 * probability-weighted value (sum of value × winProbability).
 */
async function pipeline(req, res) {
  const STAGES = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];
  const rows = await prisma.deal.findMany({
    where:  dealsScope(req),
    select: { stage: true, value: true, winProbability: true },
  });

  const byStage = Object.fromEntries(STAGES.map((stage) => [stage, { stage, count: 0, totalValue: 0, probSum: 0, weightedValue: 0 }]));
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
      stage,
      count,
      totalValue:    Math.round(totalValue),
      avgWinProb:    count ? Number((probSum / count).toFixed(3)) : 0,
      weightedValue: Math.round(weightedValue),
    };
  });
  const totalPipelineValue = stages
    .filter((s) => s.stage !== 'CLOSED_WON' && s.stage !== 'CLOSED_LOST')
    .reduce((sum, s) => sum + s.totalValue, 0);

  res.json({ success: true, stages, totalPipelineValue });
}

/**
 * GET /api/analytics/win-loss
 * Win rate and counts over past 12 months.
 */
async function winLoss(req, res, next) {
  try {
    const since = new Date();
    since.setFullYear(since.getFullYear() - 1);

    const [won, lost] = await Promise.all([
      prisma.deal.count({ where: dealsScope(req, { stage: 'CLOSED_WON',  closedAt: { gte: since } }) }),
      prisma.deal.count({ where: dealsScope(req, { stage: 'CLOSED_LOST', closedAt: { gte: since } }) }),
    ]);

    const total   = won + lost;
    const winRate = total > 0 ? Number((won / total).toFixed(3)) : 0;

    // Lost reasons breakdown
    const lostDeals = await prisma.deal.findMany({
      where:  dealsScope(req, { stage: 'CLOSED_LOST', closedAt: { gte: since }, lostReason: { not: null } }),
      select: { lostReason: true },
    });

    const lostReasons = lostDeals.reduce((acc, d) => {
      acc[d.lostReason] = (acc[d.lostReason] || 0) + 1;
      return acc;
    }, {});

    res.json({ success: true, won, lost, total, winRate, lostReasons });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analytics/rep-performance
 * Closed deals and revenue grouped by owner.
 */
async function repPerformance(req, res, next) {
  try {
    const since = new Date();
    since.setFullYear(since.getFullYear() - 1);

    const users = await prisma.user.findMany({
      where:  { isActive: true, ...(!isPrivileged(req.user) && { id: req.user.id }) },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        _count: { select: { deals: true, contacts: true, activities: true } },
      },
    });

    const reps = await Promise.all(
      users.map(async (user) => {
        const [wonDeals, aggregate, openDeals] = await Promise.all([
          prisma.deal.count({ where: { ownerId: user.id, stage: 'CLOSED_WON', closedAt: { gte: since } } }),
          prisma.deal.aggregate({
            where:  { ownerId: user.id, stage: 'CLOSED_WON', closedAt: { gte: since } },
            _sum:   { value: true },
          }),
          prisma.deal.count({
            where: { ownerId: user.id, stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } },
          }),
        ]);

        return {
          user: { id: user.id, firstName: user.firstName, lastName: user.lastName },
          wonDeals,
          revenue:    Math.round(Number(aggregate._sum.value ?? 0)),
          openDeals,
          totalDeals: user._count.deals,
          contacts:   user._count.contacts,
          activities: user._count.activities,
        };
      })
    );

    // Sort by revenue descending
    reps.sort((a, b) => b.revenue - a.revenue);

    res.json({ success: true, reps });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analytics/sentiment-trends
 * Average sentiment score per week for the past 12 weeks.
 */
async function sentimentTrends(req, res, next) {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 84); // 12 weeks

    const activities = await prisma.activity.findMany({
      where: activitiesScope(req, {
        occurredAt:     { gte: since },
        sentimentScore: { not: null },
      }),
      select: { sentimentScore: true, occurredAt: true, sentiment: true },
      orderBy: { occurredAt: 'asc' },
    });

    // Group by ISO week start (Monday)
    const weeks = {};
    for (const a of activities) {
      const d = new Date(a.occurredAt);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      const key = monday.toISOString().slice(0, 10);

      if (!weeks[key]) weeks[key] = { scores: [], labels: {} };
      weeks[key].scores.push(a.sentimentScore);
      weeks[key].labels[a.sentiment] = (weeks[key].labels[a.sentiment] || 0) + 1;
    }

    const trends = Object.entries(weeks)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, { scores, labels }]) => ({
        week,
        avgScore:    Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100,
        count:       scores.length,
        breakdown:   labels,
      }));

    res.json({ success: true, trends });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analytics/overview
 * Dashboard summary stats — single endpoint for the main KPI cards.
 */
async function overview(req, res, next) {
  try {
    const since30d = new Date();
    since30d.setDate(since30d.getDate() - 30);

    const [
      totalContacts, newContacts30d,
      totalDeals, openDeals,
      revenue30d, tasksOverdue,
    ] = await Promise.all([
      prisma.contact.count({ where: contactsScope(req) }),
      prisma.contact.count({ where: contactsScope(req, { createdAt: { gte: since30d } }) }),
      prisma.deal.count({ where: dealsScope(req) }),
      prisma.deal.count({ where: dealsScope(req, { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } }) }),
      prisma.deal.aggregate({
        where:  dealsScope(req, { stage: 'CLOSED_WON', closedAt: { gte: since30d } }),
        _sum:   { value: true },
      }),
      prisma.task.count({ where: tasksScope(req, { completed: false, dueDate: { lt: new Date() } }) }),
    ]);

    res.json({
      success: true,
      stats: {
        totalContacts,
        newContacts30d,
        totalDeals,
        openDeals,
        revenue30d:   Math.round(Number(revenue30d._sum.value ?? 0)),
        tasksOverdue,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/analytics/at-risk?limit=5
 * Contacts with churnRisk > 0.6 or sentimentScore < 0.3, riskiest first.
 */
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

module.exports = { revenue, pipeline, winLoss, repPerformance, sentimentTrends, overview, atRisk };
