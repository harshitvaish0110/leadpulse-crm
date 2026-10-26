/**
 * LeadPulse — Readiness: every dependency checked concurrently, 2 s each.
 * Only a database failure makes the API "down" (503); anything else is
 * "degraded" (200) because the app keeps working without it.
 */

'use strict';

const { prisma } = require('./prisma');
const { redis } = require('./redis');
const { ml } = require('./mlClient');

const TIMEOUT_MS = 2000;

const within = (promise) => Promise.race([
  promise,
  new Promise((_, reject) => { setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS).unref(); }),
]);

async function readiness() {
  // Loaded here: these modules depend on most of the app.
  const { providerStates } = require('../services/ai');
  const { jobCounts } = require('../queues/queue');
  const { lastNightly } = require('../services/nightly.service');

  const [db, cache, mlService, jobs, nightly] = await Promise.allSettled([
    within(prisma.$queryRaw`SELECT 1`),
    redis() ? within(redis().ping()) : Promise.resolve('disabled'),
    within(ml.get('/health', { timeout: TIMEOUT_MS })),
    within(jobCounts()),
    within(lastNightly()),
  ]);

  const aiProviders = providerStates();
  const last = nightly.status === 'fulfilled' ? nightly.value : null;
  const components = {
    database: db.status === 'fulfilled' ? 'ok' : 'down',
    redis: cache.status === 'rejected' ? 'down' : cache.value === 'disabled' ? 'disabled' : 'ok',
    mlService: mlService.status === 'fulfilled' ? 'ok' : 'down',
    aiProviders,
    jobs: jobs.status === 'fulfilled' ? jobs.value ?? 'inline' : 'unknown',
    nightly: last && {
      date: last.date,
      finishedAt: last.finishedAt,
      seconds: last.seconds,
      failedStages: Object.keys(last.stages ?? {}).filter((s) => !last.stages[s].ok),
    },
  };

  const aiUsable = Object.values(aiProviders).some((s) => s === 'closed' || s === 'half-open');
  const degraded = components.redis === 'down' || components.mlService === 'down' || !aiUsable;
  return { status: components.database === 'down' ? 'down' : degraded ? 'degraded' : 'ok', components };
}

module.exports = { readiness };
