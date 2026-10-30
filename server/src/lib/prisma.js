/**
 * LeadPulse — Prisma Client Singleton
 *
 * Prisma 7 requires a driver adapter. This module creates a single
 * PrismaClient instance backed by the @prisma/adapter-pg pool adapter.
 * Importing this module anywhere in the server gives the same instance.
 */

'use strict';

// The repository-root .env (server.js loads the same file); real environment variables take precedence.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env'), quiet: true });

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

// Connection pool — shared across all requests
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Reasonable defaults for a Node.js API server
  max: Number(process.env.DB_POOL_MAX || 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  // Query errors are thrown to callers; the error middleware logs the unexpected ones.
  // (Logging them here too would flag every scoped 404 as an error.)
  log: ['warn'],
});

// Graceful shutdown — close pool on process exit
const shutdown = async () => {
  await prisma.$disconnect();
  await pool.end();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { prisma, pool };
