/**
 * LeadPulse — Prisma Client Singleton
 *
 * Prisma 7 requires a driver adapter. This module creates a single
 * PrismaClient instance backed by the @prisma/adapter-pg pool adapter.
 * Importing this module anywhere in the server gives the same instance.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { PrismaClient } = require('@prisma/client');
const { PrismaPg }     = require('@prisma/adapter-pg');
const { Pool }         = require('pg');

// Connection pool — shared across all requests
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Reasonable defaults for a Node.js API server
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development'
    ? ['warn', 'error']
    : ['error'],
});

// Graceful shutdown — close pool on process exit
const shutdown = async () => {
  await prisma.$disconnect();
  await pool.end();
};

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

module.exports = { prisma, pool };
