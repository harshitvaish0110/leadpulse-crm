/**
 * LeadPulse — Revenue forecast and weighted pipeline.
 *
 * The forecast learns from won revenue (by closedAt, in the caller's deal scope)
 * over the 24 complete months before the current one, and predicts the current
 * month plus three ahead. Fitting Prophet takes seconds here and much longer on
 * a small host, so no request waits for it: the revenue report serves the cached
 * result, or `source: 'pending'` while the `forecast` job computes it. The cache
 * key is a hash of the history, so a newly won deal produces a fresh forecast;
 * the nightly run warms the org-wide and per-rep forecasts.
 */

'use strict';

const crypto = require('crypto');
const { prisma } = require('../lib/prisma');
const { ml } = require('../lib/mlClient');
const { getJSON, setJSON } = require('../lib/redis');
const { scoped } = require('../middleware/auth.middleware');
const { enqueue } = require('../queues/queue');

const HISTORY_MONTHS = 24;
const PERIODS = 4; // the current (partial) month + 3 ahead
const TTL_SECONDS = 24 * 3600;
const UNAVAILABLE_TTL_SECONDS = 600;
const OPEN_STAGES = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION'];

const memory = new Map(); // key -> { value, expires }: the cache when there is no Redis

const keyFor = (historical) => crypto.createHash('sha1').update(JSON.stringify({ historical, periods: PERIODS })).digest('hex');
const monthStart = (date, offset = 0) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
const ds = (date) => date.toISOString().slice(0, 10);

async function readCache(key) {
  const hit = await getJSON(`lp:forecast:${key}`);
  if (hit) return hit;
  const local = memory.get(key);
  return local && local.expires > Date.now() ? local.value : null;
}

async function writeCache(key, value, ttlSeconds) {
  memory.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  if (memory.size > 200) memory.delete(memory.keys().next().value);
  await setJSON(`lp:forecast:${key}`, value, ttlSeconds);
}

/**
 * `[{ ds: 'YYYY-MM-01', y }]` for up to 24 complete months before `now`, zero-filled
 * between the first won deal and now. Months before the first win are left out:
 * they mean "no data yet", and as zeros they would exaggerate the growth trend.
 */
async function forecastHistory(user, now = new Date()) {
  const from = monthStart(now, -HISTORY_MONTHS);
  const rows = await prisma.deal.findMany({
    where: scoped(user, 'deal', { stage: 'CLOSED_WON', closedAt: { gte: from, lt: monthStart(now) } }),
    select: { value: true, closedAt: true },
  });
  const byMonth = new Map(Array.from({ length: HISTORY_MONTHS }, (_, i) => [ds(monthStart(from, i)), 0]));
  for (const d of rows) {
    const key = ds(monthStart(d.closedAt));
    byMonth.set(key, byMonth.get(key) + Number(d.value));
  }
  const series = [...byMonth].map(([month, y]) => ({ ds: month, y: Math.round(y) }));
  const first = series.findIndex((m) => m.y > 0);
  return first === -1 ? [] : series.slice(first);
}

/** The cached forecast for the user's scope, or `{ source: 'pending' }` after queueing its computation. */
async function getForecast(user, now = new Date()) {
  const historical = await forecastHistory(user, now);
  const key = keyFor(historical);
  const hit = await readCache(key);
  if (hit) return hit;
  enqueue('forecast', { historical }, { dedupe: `forecast:${key}`, attempts: 1 });
  return { forecast: [], source: 'pending' };
}

/** Job `forecast`: fit through the ML service and cache the result. */
async function computeForecast({ historical }) {
  const key = keyFor(historical);
  try {
    const { data } = await ml.post('/forecast/revenue', { historical, periods: PERIODS }, { timeout: 120_000 });
    const value = { forecast: data.forecast ?? [], source: data.source ?? 'unknown', generatedAt: new Date().toISOString() };
    await writeCache(key, value, TTL_SECONDS);
    return { source: value.source, points: value.forecast.length };
  } catch (err) {
    // Clients poll while the forecast is pending; a short-lived 'unavailable' lets them stop.
    await writeCache(key, { forecast: [], source: 'unavailable' }, UNAVAILABLE_TTL_SECONDS);
    throw err;
  }
}

/** Nightly: the org-wide forecast and each sales rep's, so dashboards open with a forecast. */
async function warmForecasts(now = new Date()) {
  const reps = await prisma.user.findMany({ where: { isActive: true, role: 'SALES_REP' }, select: { id: true, role: true } });
  const scopes = [{ id: 'org', role: 'ADMIN' }, ...reps];
  const done = new Set();
  for (const user of scopes) {
    const historical = await forecastHistory(user, now);
    const key = keyFor(historical);
    if (done.has(key)) continue;
    await computeForecast({ historical });
    done.add(key);
  }
  return { scopes: scopes.length, computed: done.size };
}

/** Σ(value × win probability) of open deals by expected-close month, current month + 3 ahead. */
async function weightedPipeline(user, now = new Date()) {
  const deals = await prisma.deal.findMany({
    where: scoped(user, 'deal', { stage: { in: OPEN_STAGES }, expectedCloseDate: { gte: monthStart(now), lt: monthStart(now, PERIODS) } }),
    select: { value: true, winProbability: true, expectedCloseDate: true },
  });
  const byMonth = new Map(Array.from({ length: PERIODS }, (_, i) => [ds(monthStart(now, i)), 0]));
  for (const d of deals) {
    const key = ds(monthStart(d.expectedCloseDate));
    byMonth.set(key, byMonth.get(key) + Number(d.value) * d.winProbability);
  }
  return [...byMonth].map(([month, weighted]) => ({ ds: month, weighted: Math.round(weighted) }));
}

module.exports = { getForecast, computeForecast, warmForecasts, forecastHistory, weightedPipeline, monthStart, PERIODS };
