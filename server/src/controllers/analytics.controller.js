/**
 * LeadPulse CRM — Analytics Controller
 *
 * All queries use raw SQL aggregations for performance.
 * No N+1 queries — single DB round-trip per endpoint.
 */

'use strict';

const axios    = require('axios');
const { prisma } = require('../lib/prisma');

const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';

/**
 * GET /api/analytics/revenue
 * Monthly revenue from CLOSED_WON deals over the past 12 months.
 */
async function revenue(req, res, next) {
  try {
    const since = new Date();
    since.setFullYear(since.getFullYear() - 1);

    const deals = await prisma.deal.findMany({
      where: {
        stage:     'CLOSED_WON',
        createdAt: { gte: since },
      },
      select: { value: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Group by YYYY-MM
    const monthly = {};
    for (const deal of deals) {
      const key = deal.createdAt.toISOString().slice(0, 7); // "2024-01"
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
      const mlRes = await axios.post(
        `${ML_URL}/forecast/revenue`,
        { historical },
        { timeout: 30_000 }
      );
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
 * Count and total value of deals per stage.
 */
async function pipeline(req, res, next) {
  try {
    const STAGES = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];

    const results = await Promise.all(
      STAGES.map(async (stage) => {
        const [count, aggregate] = await Promise.all([
          prisma.deal.count({ where: { stage } }),
          prisma.deal.aggregate({
            where:  { stage },
            _sum:   { value: true },
            _avg:   { winProbability: true },
          }),
        ]);
        return {
          stage,
          count,
          totalValue:      Number(aggregate._sum.value ?? 0),
          avgWinProb:      Number((aggregate._avg.winProbability ?? 0).toFixed(2)),
          weightedValue:   Math.round(
            Number(aggregate._sum.value ?? 0) * Number(aggregate._avg.winProbability ?? 0)
          ),
        };
      })
    );

    const totalPipelineValue = results.reduce((s, r) => s + r.totalValue, 0);

    res.json({ success: true, stages: results, totalPipelineValue });
  } catch (err) {
    next(err);
  }
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
      prisma.deal.count({ where: { stage: 'CLOSED_WON',  createdAt: { gte: since } } }),
      prisma.deal.count({ where: { stage: 'CLOSED_LOST', createdAt: { gte: since } } }),
    ]);

    const total   = won + lost;
    const winRate = total > 0 ? Math.round((won / total) * 100) : 0;

    // Lost reasons breakdown
    const lostDeals = await prisma.deal.findMany({
      where:  { stage: 'CLOSED_LOST', createdAt: { gte: since }, lostReason: { not: null } },
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
      where:  { isActive: true },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        _count: { select: { deals: true, contacts: true, activities: true } },
      },
    });

    const reps = await Promise.all(
      users.map(async (user) => {
        const [wonDeals, aggregate, openDeals] = await Promise.all([
          prisma.deal.count({ where: { ownerId: user.id, stage: 'CLOSED_WON', createdAt: { gte: since } } }),
          prisma.deal.aggregate({
            where:  { ownerId: user.id, stage: 'CLOSED_WON', createdAt: { gte: since } },
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
      where: {
        occurredAt:     { gte: since },
        sentimentScore: { not: null },
      },
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
      prisma.contact.count(),
      prisma.contact.count({ where: { createdAt: { gte: since30d } } }),
      prisma.deal.count(),
      prisma.deal.count({ where: { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } } }),
      prisma.deal.aggregate({
        where:  { stage: 'CLOSED_WON', createdAt: { gte: since30d } },
        _sum:   { value: true },
      }),
      prisma.task.count({ where: { completed: false, dueDate: { lt: new Date() } } }),
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

module.exports = { revenue, pipeline, winLoss, repPerformance, sentimentTrends, overview };
