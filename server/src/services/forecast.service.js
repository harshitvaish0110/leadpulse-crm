/**
 * LeadPulse — Revenue forecast with an in-process cache.
 *
 * Fitting Prophet takes seconds (much longer on a small instance), and the same
 * monthly history always yields the same forecast, so results are cached by
 * history for 12 hours and concurrent requests share one computation.
 * The cache is per process; a shared one can come with the job queue.
 */

'use strict';

const crypto = require('crypto');
const { ml } = require('../lib/mlClient');

const TTL_MS = 12 * 3_600_000;
const MAX_ENTRIES = 200;
const cache = new Map();   // key -> { value, expires }
const pending = new Map(); // key -> Promise

const keyFor = (historical, periods) =>
  crypto.createHash('sha1').update(JSON.stringify({ historical, periods })).digest('hex');

/**
 * @param {{ ds: string, y: number }[]} historical  monthly points, oldest first
 * @returns {Promise<{ forecast: object[], source: string }>} empty forecast when the ML service is unavailable
 */
async function forecastRevenue(historical, periods = 3) {
  const key = keyFor(historical, periods);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (pending.has(key)) return pending.get(key);

  const work = ml.post('/forecast/revenue', { historical, periods }, { timeout: 90_000 })
    .then(({ data }) => {
      const value = { forecast: data.forecast || [], source: data.source || 'unknown' };
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expires: Date.now() + TTL_MS });
      return value;
    })
    .catch((err) => {
      console.warn('[Forecast] unavailable:', err.message);
      return { forecast: [], source: 'unavailable' };
    })
    .finally(() => pending.delete(key));

  pending.set(key, work);
  return work;
}

module.exports = { forecastRevenue };
