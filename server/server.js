/**
 * LeadPulse CRM — API entry point.
 *
 * Creates the HTTP server, attaches Socket.IO and starts listening. Background
 * jobs run in the separate worker process (worker.js), or in this process when
 * WORKER_INLINE=true (hosts without background workers).
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });

const http = require('http');

const { createApp }    = require('./src/app');
const { prisma }       = require('./src/lib/prisma');
const { logger }       = require('./src/lib/logger');
const { redis, closeRedis } = require('./src/lib/redis');
const { validateEnv }  = require('./src/lib/env');
const { attachSocket, closeSocket } = require('./src/lib/realtime');
const { closeQueue }   = require('./src/queues/queue');

const PORT = parseInt(process.env.PORT || '3001', 10);

async function bootstrap() {
  // ── Fail fast on missing/weak configuration ─────────────────────────────────
  const { errors, warnings } = validateEnv();
  warnings.forEach((w) => logger.warn({ event: 'config_warning' }, w));
  if (errors.length) {
    errors.forEach((e) => logger.fatal({ event: 'config_error' }, e));
    process.exit(1);
  }

  // ── Verify DB connectivity before accepting traffic ─────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    logger.fatal({ event: 'db_unavailable', err: err.message }, 'Database connection failed');
    process.exit(1);
  }

  redis(); // connect early, so the first requests can already queue jobs

  const app    = createApp();
  const server = http.createServer(app);
  attachSocket(server);

  const worker = process.env.WORKER_INLINE === 'true' && process.env.NODE_ENV !== 'test'
    ? require('./src/queues/worker').startWorker()
    : null;

  server.listen(PORT, () => {
    logger.info({ event: 'api_started', port: PORT, env: process.env.NODE_ENV || 'development', inlineWorker: Boolean(worker) }, `LeadPulse API listening on http://localhost:${PORT}`);
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info({ event: 'shutdown', signal }, 'Shutting down');
    setTimeout(() => process.exit(1), 10_000).unref();
    server.close();
    await worker?.close().catch(() => {});
    await Promise.allSettled([closeSocket(), closeQueue()]);
    await closeRedis();
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal bootstrap error');
  process.exit(1);
});
