'use strict';

// Smoke test: the app boots and serves routes that need no database.
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ||= 'x'.repeat(32);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool } = require('../../src/lib/prisma');

after(() => pool.end());

test('GET /health returns ok', async () => {
  const res = await request(createApp()).get('/health').expect(200);
  assert.equal(res.body.status, 'ok');
});

test('unknown route returns a JSON 404', async () => {
  const res = await request(createApp()).get('/api/does-not-exist').expect(404);
  assert.equal(res.body.success, false);
});

test('protected route without a token returns 401', async () => {
  await request(createApp()).get('/api/contacts').expect(401);
});
