/**
 * LeadPulse CRM — Background worker entry point (`npm run worker`).
 *
 * Runs the BullMQ jobs (sentiment, rescoring, indexing, forecasts, nightly
 * pipeline, task reminders) and registers their schedules. Socket events it
 * emits are relayed to browsers through the API process.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
process.env.SERVICE_NAME ||= 'leadpulse-worker'; // before the logger is created

const { prisma }      = require('./src/lib/prisma');
const { logger }      = require('./src/lib/logger');
const { closeRedis }  = require('./src/lib/redis');
const { validateEnv } = require('./src/lib/env');
const { relayThroughRedis } = require('./src/lib/realtime');
const { startWorker } = require('./src/queues/worker');
const { closeQueue }  = require('./src/queues/queue');
const { loadSecrets } = require('./src/lib/secrets');
const { refreshWorkspace } = require('./src/lib/workspace');

/** Keys saved in Settings and the workspace row: loaded now, then every minute (other processes may change them). */
async function loadSettings() {
  const refresh = () => Promise.all([loadSecrets(), refreshWorkspace()]);
  await refresh();
  setInterval(refresh, 60_000).unref();
}

async function main() {
  const { errors } = validateEnv();
  if (!process.env.REDIS_URL) errors.push('REDIS_URL is required to run the worker (or set WORKER_INLINE=true on the API)');
  if (errors.length) {
    errors.forEach((e) => logger.fatal({ event: 'config_error' }, e));
    process.exit(1);
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    logger.fatal({ event: 'db_unavailable', err: err.message }, 'Database connection failed');
    process.exit(1);
  }

  await loadSettings();
  relayThroughRedis();
  const worker = startWorker();

  const shutdown = async (signal) => {
    logger.info({ event: 'shutdown', signal }, 'Worker shutting down');
    setTimeout(() => process.exit(1), 15_000).unref();
    await worker.close().catch(() => {}); // lets running jobs finish
    await closeQueue();
    await closeRedis();
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
