'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { encrypt, decrypt } = require('../../src/lib/crypto');
const { safePost } = require('../../src/lib/safeFetch');
const { sign } = require('../../src/services/webhooks.service');
const { keyFor, coerce } = require('../../src/services/customFields.service');
const { verdict } = require('../../src/services/integrations.service');

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

test('encrypt/decrypt round-trips, uses a fresh IV and rejects tampering or another key', () => {
  const a = encrypt('gsk_secret_value');
  const b = encrypt('gsk_secret_value');
  assert.match(a, /^v1:[^:]+:[^:]+:[^:]+$/);
  assert.notEqual(a, b);
  assert.equal(decrypt(a), 'gsk_secret_value');

  const [v, iv, tag, ct] = a.split(':');
  const flipped = Buffer.from(ct, 'base64');
  flipped[0] ^= 1;
  assert.throws(() => decrypt([v, iv, tag, flipped.toString('base64')].join(':')));

  const original = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  assert.throws(() => decrypt(a));
  process.env.ENCRYPTION_KEY = original;
});

test('webhook signature is HMAC-SHA256 over "<timestamp>.<body>"', () => {
  const body = '{"id":"d1","event":"ping"}';
  assert.equal(
    sign('whsec_test', 1700000000, body),
    `sha256=${crypto.createHmac('sha256', 'whsec_test').update(`1700000000.${body}`).digest('hex')}`,
  );
  assert.notEqual(sign('whsec_test', 1700000001, body), sign('whsec_test', 1700000000, body));
});

test('custom field keys are camelCase and start with a letter', () => {
  assert.equal(keyFor('Budget tier'), 'budgetTier');
  assert.equal(keyFor('  Main competitor! '), 'mainCompetitor');
  assert.equal(keyFor('2025 renewal'), 'field2025Renewal');
  assert.equal(keyFor('Ünïcode name'), 'unicodeName');
});

test('custom field values are checked and converted by type', () => {
  const field = (type, extra = {}) => ({ key: 'f', label: 'Field', type, ...extra });
  const refuses = (fn, pattern) => assert.throws(fn, (err) => err.status === 422 && pattern.test(err.meta[0].msg));
  assert.equal(coerce(field('NUMBER'), '42.5'), 42.5);
  refuses(() => coerce(field('NUMBER'), 'many'), /must be a number/);
  assert.equal(coerce(field('DATE'), '2026-02-28'), '2026-02-28');
  refuses(() => coerce(field('DATE'), '2026-02-30'), /date/);
  refuses(() => coerce(field('DATE'), '28/02/2026'), /date/);
  assert.equal(coerce(field('SELECT', { options: ['A', 'B'] }), 'B'), 'B');
  refuses(() => coerce(field('SELECT', { options: ['A', 'B'] }), 'C'), /one of: A, B/);
  assert.equal(coerce(field('TEXT'), '  hi '), 'hi');
  refuses(() => coerce(field('TEXT'), 'x'.repeat(501)), /at most 500/);
});

test('key tests: rate limited still means the key works; Resend sending-only keys are recognised', () => {
  assert.deepEqual(verdict('groq', 200, ''), { ok: true, detail: 'Connected' });
  assert.equal(verdict('gemini', 429, '').ok, true);
  assert.equal(verdict('openai', 401, '').ok, false);
  assert.equal(verdict('resend', 401, '{"name":"restricted_api_key"}').ok, true);
  assert.equal(verdict('groq', 401, 'restricted').ok, false);
  assert.match(verdict('anthropic', 500, '').detail, /HTTP 500/);
});

test('safePost refuses private targets unless allowed, and returns the status without reading the body', async () => {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { bodies.push({ raw, signature: req.headers['x-test'] }); res.writeHead(202).end('ignored'); });
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/hook`;
  try {
    await assert.rejects(safePost(url, '{}', {}), /Only https URLs/);
    await assert.rejects(safePost('https://127.0.0.1/hook', '{}', {}), /private or reserved/);
    await assert.rejects(
      safePost('https://hooks.example.com/x', '{}', {}, { resolve: async () => [{ address: '10.0.0.5', family: 4 }] }),
      /private or reserved/,
    );
    const { status } = await safePost(url, '{"a":1}', { 'X-Test': 'yes' }, { allowPrivate: true });
    assert.equal(status, 202);
    assert.deepEqual(bodies, [{ raw: '{"a":1}', signature: 'yes' }]);
  } finally {
    await new Promise((resolve) => { server.close(resolve); });
  }
});
