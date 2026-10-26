/**
 * LeadPulse — Encryption at rest for secrets entered in the UI (API keys,
 * webhook signing secrets): AES-256-GCM with ENCRYPTION_KEY (32 bytes, base64).
 *
 * Stored format: v1:<iv>:<auth tag>:<ciphertext>, each part base64.
 */

'use strict';

const crypto = require('node:crypto');

class EncryptionUnavailableError extends Error {}

/** The key, or null when ENCRYPTION_KEY isn't set. A malformed key throws (env.js reports it at startup). */
function encryptionKey(env = process.env) {
  if (!env.ENCRYPTION_KEY) return null;
  const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) throw new EncryptionUnavailableError('ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return key;
}

function requireKey() {
  const key = encryptionKey();
  if (!key) throw new EncryptionUnavailableError('ENCRYPTION_KEY is not set');
  return key;
}

/** @param {string} plaintext */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', requireKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ciphertext].map((p) => (typeof p === 'string' ? p : p.toString('base64'))).join(':');
}

/** Throws when the value was encrypted with another key or has been tampered with. */
function decrypt(stored) {
  const [version, iv, tag, ciphertext] = String(stored).split(':');
  if (version !== 'v1' || !iv || !tag || ciphertext === undefined) throw new Error('Unrecognised encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', requireKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, encryptionKey, EncryptionUnavailableError };
