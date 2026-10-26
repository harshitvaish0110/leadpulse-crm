/**
 * LeadPulse — File storage with signed download URLs.
 *
 * STORAGE_DRIVER=local (default): files live under server/storage/ and are served
 * by GET /api/files/<key>?exp=&name=&sig= only with a valid, unexpired signature.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { ApiError } = require('../middleware/error.middleware');

const ROOT = path.resolve(__dirname, '..', '..', 'storage');
const KEY_PATTERN = /^[a-z]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/;

function driver() {
  const name = process.env.STORAGE_DRIVER || 'local';
  if (name !== 'local') throw ApiError.internal(`Storage driver "${name}" is not available yet`);
  return name;
}

/** Signing secret: STORAGE_SIGNING_KEY, else one derived from JWT_SECRET for local development. */
const secret = () => process.env.STORAGE_SIGNING_KEY
  || crypto.createHmac('sha256', process.env.JWT_SECRET || '').update('storage-signing').digest('hex');

const sign = (key, exp, name) => crypto.createHmac('sha256', secret()).update(`${key}\n${exp}\n${name}`).digest('hex');

/** Resolves a key to a path inside ROOT; rejects anything that is not a generated key. */
function filePath(key) {
  if (!KEY_PATTERN.test(key)) throw ApiError.notFound('File not found');
  return path.join(ROOT, ...key.split('/'));
}

/** New random key, e.g. "attachment/2026/10/<uuid>.pdf". The client's file name is never used. */
function newKey(kind, originalName) {
  const ext = path.extname(originalName || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 9);
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${kind}/${now.getUTCFullYear()}/${month}/${crypto.randomUUID()}${ext}`;
}

async function put(key, buffer) {
  driver();
  const target = filePath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer, { flag: 'wx' });
}

async function read(key) {
  driver();
  return fs.readFile(filePath(key));
}

async function remove(key) {
  driver();
  await fs.rm(filePath(key), { force: true });
}

/** Relative URL valid for `ttlSeconds`; `downloadName` becomes the saved file name. */
function signedUrl(key, downloadName, ttlSeconds = 600) {
  driver();
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const name = String(downloadName || path.basename(key)).slice(0, 200);
  const query = new URLSearchParams({ exp: String(exp), name, sig: sign(key, exp, name) });
  return { url: `/api/files/${key}?${query}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Checks a signed request; returns the absolute path to stream. */
function verify(key, { exp, name, sig }) {
  const expected = sign(key, exp, name ?? '');
  const valid = typeof sig === 'string' && sig.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid || !(Number(exp) * 1000 > Date.now())) throw ApiError.forbidden('This download link is invalid or has expired', 'LINK_EXPIRED');
  return filePath(key);
}

module.exports = { newKey, put, read, remove, signedUrl, verify };
