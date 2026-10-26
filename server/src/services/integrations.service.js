/**
 * LeadPulse — Settings → Integrations (ADMIN): where each API key comes from,
 * saving and removing keys (encrypted, see secrets.js), a cheap real call to
 * test a key, and the last 24 h of AI calls per provider.
 *
 * Responses never contain a key: only its source and its last four characters.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { audit } = require('../lib/audit');
const { encrypt, encryptionKey, EncryptionUnavailableError } = require('../lib/crypto');
const { secret, secretSource, cacheSecret } = require('../lib/secrets');
const { sendEmail, emailDriver, emailFrom } = require('../lib/mailer');
const { ml } = require('../lib/mlClient');
const { ApiError } = require('../middleware/error.middleware');
const ai = require('./ai');

const TEST_TIMEOUT_MS = 8000;
const bearer = (key) => ({ Authorization: `Bearer ${key}` });

/** Each key-based integration: its variable and a request that proves the key works without spending quota. */
const KEYS = {
  gemini:     { envVar: 'GEMINI_API_KEY',     test: (key) => ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { 'x-goog-api-key': key }] },
  groq:       { envVar: 'GROQ_API_KEY',       test: (key) => ['https://api.groq.com/openai/v1/models', bearer(key)] },
  openrouter: { envVar: 'OPENROUTER_API_KEY', test: (key) => ['https://openrouter.ai/api/v1/key', bearer(key)] },
  anthropic:  { envVar: 'ANTHROPIC_API_KEY',  test: (key) => ['https://api.anthropic.com/v1/models?limit=1', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }] },
  openai:     { envVar: 'OPENAI_API_KEY',     test: (key) => ['https://api.openai.com/v1/models', bearer(key)] },
  clearbit:   { envVar: 'CLEARBIT_API_KEY',   test: (key) => ['https://company.clearbit.com/v2/companies/find?domain=clearbit.com', bearer(key)] },
  resend:     { envVar: 'RESEND_API_KEY',     test: (key) => ['https://api.resend.com/api-keys', bearer(key)] },
};

function keyConfig(id) {
  const config = KEYS[id];
  if (!config) throw ApiError.notFound('Unknown integration');
  return config;
}

/** The last four characters, only for keys long enough that they reveal nothing useful. */
const last4 = (value) => (value && value.length >= 16 ? value.slice(-4) : null);

function encryptionReady() {
  try {
    return Boolean(encryptionKey());
  } catch {
    return false;
  }
}

/** AI calls in the last 24 h per provider: attempts, errors, fallbacks and median latency. */
async function aiUsage() {
  const rows = await prisma.$queryRaw`
    SELECT "provider",
           COUNT(*)::int AS "calls",
           COUNT(*) FILTER (WHERE "status" = 'error')::int AS "errors",
           COUNT(*) FILTER (WHERE "status" = 'fallback')::int AS "fallbacks",
           (percentile_disc(0.5) WITHIN GROUP (ORDER BY "latencyMs"))::int AS "p50Ms"
    FROM "ai_logs"
    WHERE "createdAt" > NOW() - INTERVAL '24 hours' AND "provider" IS NOT NULL
    GROUP BY "provider"
    ORDER BY "calls" DESC`;
  return rows;
}

async function integrationStatus() {
  const [saved, usage] = await Promise.all([
    prisma.integrationCredential.findMany({ select: { provider: true, updatedAt: true } }),
    aiUsage(),
  ]);
  const savedAt = new Map(saved.map((r) => [r.provider, r.updatedAt]));
  const providers = ai.providerDetails();
  return {
    encryption: encryptionReady(),
    keys: Object.entries(KEYS).map(([id, { envVar }]) => ({
      id,
      envVar,
      source: secretSource(envVar),          // 'env' | 'ui' | null; the environment wins over a saved key
      savedAt: savedAt.get(envVar) ?? null,
      last4: last4(secret(envVar)),
      circuit: providers[id]?.state ?? null,
      // The chain entries this key serves: Gemini's covers Flash and Flash-Lite.
      models: Object.entries(providers).filter(([name]) => name === id || name.startsWith(`${id}-`))
        .map(([name, p]) => ({ provider: name, model: p.model, state: p.state, reopensAt: p.reopensAt })),
    })),
    email: { driver: emailDriver(), from: emailFrom() },
    storage: { driver: process.env.STORAGE_DRIVER || 'local' },
    mlService: { url: process.env.ML_SERVICE_URL || 'http://localhost:5001' },
    aiMock: process.env.AI_MOCK === 'true',
    usage,
  };
}

async function saveKey(req, id, apiKey) {
  const { envVar } = keyConfig(id);
  const value = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (value.length < 8 || value.length > 500 || /\s/.test(value)) throw ApiError.validation([{ path: 'apiKey', msg: 'That does not look like an API key' }]);

  let encryptedValue;
  try {
    encryptedValue = encrypt(value);
  } catch (err) {
    if (err instanceof EncryptionUnavailableError) {
      throw new ApiError('Set ENCRYPTION_KEY on the server to save keys here; until then keys come from .env.', 503, 'ENCRYPTION_NOT_CONFIGURED');
    }
    throw err;
  }
  await prisma.integrationCredential.upsert({
    where: { provider: envVar },
    create: { provider: envVar, encryptedValue, updatedById: req.user.id },
    update: { encryptedValue, updatedById: req.user.id },
  });
  cacheSecret(envVar, value);
  await audit(req, { action: 'update', entityType: 'integration', entityId: id, after: { saved: true } });
}

async function removeKey(req, id) {
  const { envVar } = keyConfig(id);
  const { count } = await prisma.integrationCredential.deleteMany({ where: { provider: envVar } });
  if (!count) throw ApiError.notFound('No key is saved for this integration');
  cacheSecret(envVar, null);
  await audit(req, { action: 'delete', entityType: 'integration', entityId: id });
}

/** Status → what the admin should know. A 429 means the key is valid but over its quota. */
function verdict(id, status, body) {
  if (status >= 200 && status < 300) return { ok: true, detail: 'Connected' };
  if (status === 429) return { ok: true, detail: 'The key works but is rate limited right now' };
  // Resend's sending-only keys can't list keys, which is how we know they're real.
  if (id === 'resend' && status === 401 && /restricted/i.test(body)) return { ok: true, detail: 'Connected (sending-only key)' };
  if (status === 401 || status === 403) return { ok: false, detail: 'The key was rejected' };
  return { ok: false, detail: `Unexpected response (HTTP ${status})` };
}

/**
 * Tests a key (the one typed in, else the configured one), the email setup (a
 * message to the admin) or the ML service.
 * @returns {Promise<{ ok: boolean, detail: string, latencyMs: number, previewUrl?: string }>}
 */
async function testIntegration(req, id, apiKey) {
  const started = Date.now();
  const done = (result) => ({ ...result, latencyMs: Date.now() - started });

  if (id === 'email') {
    try {
      const { previewUrl } = await sendEmail({
        to: req.user.email,
        subject: 'LeadPulse test email',
        text: `This is a test email from LeadPulse, sent with the "${emailDriver()}" email driver. If you can read it, email delivery works.`,
      });
      return done({ ok: true, detail: `Sent to ${req.user.email}`, ...(previewUrl && { previewUrl }) });
    } catch (err) {
      return done({ ok: false, detail: `Sending failed: ${String(err.message).slice(0, 200)}` });
    }
  }

  if (id === 'ml') {
    try {
      await ml.get('/health', { timeout: TEST_TIMEOUT_MS });
      return done({ ok: true, detail: 'Connected' });
    } catch (err) {
      return done({ ok: false, detail: err.response ? `HTTP ${err.response.status}` : 'Not reachable' });
    }
  }

  const config = keyConfig(id);
  const key = (typeof apiKey === 'string' && apiKey.trim()) || secret(config.envVar);
  if (!key) throw ApiError.validation([{ path: 'apiKey', msg: 'Enter a key to test, or save one first' }]);
  const [url, headers] = config.test(key);
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
    const body = res.ok ? '' : await res.text().catch(() => '');
    return done(verdict(id, res.status, body));
  } catch (err) {
    return done({ ok: false, detail: err.name === 'TimeoutError' ? 'Timed out' : 'Could not reach the provider' });
  }
}

module.exports = { KEYS, integrationStatus, saveKey, removeKey, testIntegration, verdict, aiUsage };
