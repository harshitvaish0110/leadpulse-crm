'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnv } = require('../../src/lib/env');

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const VALID = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_SECRET: 'x'.repeat(32), GEMINI_API_KEY: 'k', REDIS_URL: 'redis://localhost:6379', ENCRYPTION_KEY };

test('valid configuration has no errors or warnings', () => {
  assert.deepEqual(validateEnv(VALID), { errors: [], warnings: [] });
});

test('missing DATABASE_URL is an error', () => {
  const { errors } = validateEnv({ ...VALID, DATABASE_URL: '' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /DATABASE_URL/);
});

test('JWT_SECRET shorter than 32 characters is an error', () => {
  assert.match(validateEnv({ ...VALID, JWT_SECRET: 'x'.repeat(31) }).errors[0], /JWT_SECRET/);
  assert.match(validateEnv({ ...VALID, JWT_SECRET: undefined }).errors[0], /JWT_SECRET/);
});

test('no AI key is a warning, suppressed in mock mode', () => {
  const noKeys = { DATABASE_URL: VALID.DATABASE_URL, JWT_SECRET: VALID.JWT_SECRET, REDIS_URL: VALID.REDIS_URL, ENCRYPTION_KEY };
  assert.equal(validateEnv(noKeys).warnings.length, 1);
  assert.equal(validateEnv({ ...noKeys, AI_MOCK: 'true' }).warnings.length, 0);
});

test('ENCRYPTION_KEY: missing is a warning, the wrong length an error', () => {
  const { ENCRYPTION_KEY: _, ...without } = VALID;
  assert.match(validateEnv(without).warnings[0], /ENCRYPTION_KEY/);
  assert.match(validateEnv({ ...VALID, ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }).errors[0], /32 bytes/);
});

test('production requires ML_SERVICE_TOKEN, an origin allow-list and INTERNAL_JOB_TOKEN', () => {
  const { errors } = validateEnv({ ...VALID, NODE_ENV: 'production' });
  assert.equal(errors.length, 3);
  assert.deepEqual(validateEnv({
    ...VALID, NODE_ENV: 'production', ML_SERVICE_TOKEN: 't', CORS_ORIGINS: 'https://a.app', INTERNAL_JOB_TOKEN: 'i',
  }).errors, []);
});

test('missing REDIS_URL is a warning (jobs fall back to running in the API)', () => {
  const { REDIS_URL, ...withoutRedis } = VALID;
  assert.match(validateEnv(withoutRedis).warnings[0], /REDIS_URL/);
});

test('allowedOrigins parses CORS_ORIGINS and falls back to CLIENT_URL', () => {
  const { allowedOrigins } = require('../../src/lib/env');
  assert.deepEqual(allowedOrigins({ CORS_ORIGINS: 'https://a.app/, https://b.app,https://a.app' }), ['https://a.app', 'https://b.app']);
  assert.deepEqual(allowedOrigins({ CLIENT_URL: 'http://localhost:5173' }), ['http://localhost:5173']);
  assert.deepEqual(allowedOrigins({}), ['http://localhost:5173']);
});
