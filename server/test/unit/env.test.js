'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnv } = require('../../src/lib/env');

const VALID = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_SECRET: 'x'.repeat(32), GEMINI_API_KEY: 'k' };

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
  const noKeys = { DATABASE_URL: VALID.DATABASE_URL, JWT_SECRET: VALID.JWT_SECRET };
  assert.equal(validateEnv(noKeys).warnings.length, 1);
  assert.equal(validateEnv({ ...noKeys, AI_MOCK: 'true' }).warnings.length, 0);
});
