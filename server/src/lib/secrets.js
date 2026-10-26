/**
 * LeadPulse — API keys from the environment or from Settings → Integrations.
 *
 * An environment variable always wins. Keys saved in the UI live encrypted in
 * `integration_credentials` (one row per variable name) and are cached here,
 * decrypted. server.js and worker.js load them at start and every minute; the
 * process that saves a key updates its cache at once. Values are never logged
 * or returned.
 */

'use strict';

const { prisma } = require('./prisma');
const { logger } = require('./logger');
const { decrypt } = require('./crypto');

/** Variables that may be set from the UI. */
const UI_SECRETS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLEARBIT_API_KEY', 'RESEND_API_KEY'];

let stored = new Map();
let loading = null;

/** Reloads the saved keys; never throws. A key that can't be decrypted (ENCRYPTION_KEY changed) is skipped. */
function loadSecrets() {
  loading ??= prisma.integrationCredential.findMany({ select: { provider: true, encryptedValue: true } })
    .then((rows) => {
      const next = new Map();
      for (const row of rows) {
        try {
          next.set(row.provider, decrypt(row.encryptedValue));
        } catch (err) {
          logger.warn({ event: 'secret_unreadable', name: row.provider, err: err.message }, 'A saved key could not be decrypted');
        }
      }
      stored = next;
    })
    .catch((err) => logger.warn({ event: 'secrets_load_failed', err: err.message }, 'Could not load saved keys'))
    .finally(() => { loading = null; });
  return loading;
}

/** The value of `name`: the environment variable, else the key saved in the UI, else ''. */
function secret(name) {
  if (process.env[name]) return process.env[name];
  return UI_SECRETS.includes(name) ? stored.get(name) ?? '' : '';
}

/** 'env' | 'ui' | null — where `secret(name)` comes from. */
function secretSource(name) {
  if (process.env[name]) return 'env';
  return secret(name) ? 'ui' : null;
}

/** Updates this process's cache after a save (`value`) or a removal (null). */
function cacheSecret(name, value) {
  if (value) stored.set(name, value);
  else stored.delete(name);
}

/**
 * An SDK client that is rebuilt when its key changes.
 * @template T
 * @param {string} name
 * @param {(key: string) => T} create
 * @returns {() => T}
 */
function keyedClient(name, create) {
  let client = null;
  let clientKey = null;
  return () => {
    const key = secret(name);
    if (key !== clientKey) {
      client = create(key);
      clientKey = key;
    }
    return client;
  };
}

module.exports = { UI_SECRETS, secret, secretSource, loadSecrets, cacheSecret, keyedClient };
