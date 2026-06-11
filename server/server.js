/**
 * LeadPulse CRM — Server Entry Point
 *
 * Creates the HTTP server, attaches Socket.IO for real-time events,
 * registers cron jobs, and starts listening.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http    = require('http');
const { Server: SocketIOServer } = require('socket.io');

const { createApp } = require('./src/app');
const { prisma }    = require('./src/lib/prisma');

const PORT = parseInt(process.env.PORT || '3001', 10);

async function bootstrap() {
  // ── Verify DB connectivity before accepting traffic ─────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✓  Database connected');
  } catch (err) {
    console.error('✗  Database connection failed:', err.message);
    process.exit(1);
  }

  const app    = createApp();
  const server = http.createServer(app);

  // ── Socket.IO setup ─────────────────────────────────────────────────────────
  const io = new SocketIOServer(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Use websockets with polling fallback
    transports: ['websocket', 'polling'],
  });

  // Attach io to app so controllers can emit events
  app.set('io', io);

  io.on('connection', (socket) => {
    const clientId = socket.handshake.query?.userId ?? socket.id;
    console.log(`[Socket] connected  → ${clientId} (${socket.id})`);

    // Each user joins a private room keyed by their userId
    // so we can target push updates to specific users
    socket.on('join', (userId) => {
      if (userId) socket.join(`user:${userId}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] disconnected → ${clientId} (${reason})`);
    });
  });

  // ── Start listening ─────────────────────────────────────────────────────────
  server.listen(PORT, () => {
    console.log(`\n🚀  LeadPulse server running at http://localhost:${PORT}`);
    console.log(`    Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`    Health:      http://localhost:${PORT}/health\n`);
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
