'use strict';

/**
 * Shared setup for API integration tests. Requires a migrated, seeded database
 * at DATABASE_URL (the demo seed provides the users below, password "password123").
 */

process.env.NODE_ENV = 'test'; // disables rate limits and request logging
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env'), quiet: true });

const request = require('supertest');
const { createApp } = require('../../src/app');
const { prisma, pool } = require('../../src/lib/prisma');
const { closeRedis } = require('../../src/lib/redis');

const app = createApp();
const startedAt = new Date();

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

/** Logs in a seeded user; returns `{ token, cookie, user }`. */
async function login(email, password = 'password123') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, cookie: refreshCookie(res), user: res.body.user };
}

/** `lp_rt=<value>` from a response's Set-Cookie header, or null. */
function refreshCookie(res) {
  const raw = [].concat(res.headers['set-cookie'] || []).find((c) => c.startsWith('lp_rt='));
  return raw ? raw.split(';')[0] : null;
}

/**
 * Retries `read` until it returns something truthy (or `timeoutMs` passes).
 * For records written fire-and-forget, such as AI call logs, which can land a
 * few milliseconds after the response.
 */
async function eventually(read, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Removes refresh tokens created by this test file, then closes the pool and any Redis connection. */
async function teardown() {
  await prisma.refreshToken.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.$disconnect();
  await pool.end().catch(() => {});
  await closeRedis();
}

module.exports = { app, request, prisma, bearer, login, refreshCookie, eventually, teardown };
