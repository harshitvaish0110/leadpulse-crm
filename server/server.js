/**
 * LeadPulse CRM — Server Entry Point
 *
 * Creates the HTTP server, attaches Socket.IO for real-time events,
 * registers cron jobs, and starts listening.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http    = require('http');

const { createApp }   = require('./src/app');
const { prisma }      = require('./src/lib/prisma');
const { validateEnv } = require('./src/lib/env');
const { attachSocket } = require('./src/lib/realtime');

const PORT = parseInt(process.env.PORT || '3001', 10);

async function bootstrap() {
  // ── Fail fast on missing/weak configuration ─────────────────────────────────
  const { errors, warnings } = validateEnv();
  warnings.forEach((w) => console.warn(`⚠  ${w}`));
  if (errors.length) {
    errors.forEach((e) => console.error(`✗  ${e}`));
    process.exit(1);
  }

  // ── Verify DB connectivity before accepting traffic ─────────────────────────
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    console.log('✓  Database connected');
  } catch (err) {
    console.error('✗  Database connection failed:', err.message);
    process.exit(1);
  }

  const app    = createApp();
  const server = http.createServer(app);

  // ── Socket.IO (JWT handshake, server-side rooms) ─────────────────────────────
  attachSocket(server);

  // ── Start listening ─────────────────────────────────────────────────────────
  server.listen(PORT, () => {
    console.log(`\n🚀  LeadPulse server running at http://localhost:${PORT}`);
    console.log(`    Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`    Health:      http://localhost:${PORT}/health\n`);

    // Register background jobs after server is fully up
    require('./src/jobs/scoring.job');
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    console.log(`\n[${signal}] Shutting down gracefully…`);
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
    // Force-close after 10s if still hanging
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
