/**
 * LeadPulse — File storage with signed download URLs.
 *
 * STORAGE_DRIVER=local (default): files live under server/storage/ and are served
 * by GET /api/files/<key>?exp=&name=&sig= only with a valid, unexpired signature.
 * STORAGE_DRIVER=supabase: files live in a private Supabase Storage bucket
 * (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET); downloads use links Supabase signs.
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
  if (name !== 'local' && name !== 'supabase') throw ApiError.internal(`Unknown STORAGE_DRIVER "${name}": use "local" or "supabase"`);
  return name;
}

/** Signing secret: STORAGE_SIGNING_KEY, else one derived from JWT_SECRET for local development. */
const secret = () => process.env.STORAGE_SIGNING_KEY
  || crypto.createHmac('sha256', process.env.JWT_SECRET || '').update('storage-signing').digest('hex');

const sign = (key, exp, name) => crypto.createHmac('sha256', secret()).update(`${key}\n${exp}\n${name}`).digest('hex');

/** Rejects anything that is not a key this app generated, so a bad value can't reach the disk or Supabase. */
function checkKey(key) {
  if (!KEY_PATTERN.test(key)) throw ApiError.notFound('File not found');
  return key;
}

/** The local disk path for a checked key. */
function filePath(key) {
  checkKey(key);
  return path.join(ROOT, ...key.split('/'));
}

const bucket = () => process.env.SUPABASE_BUCKET || 'leadpulse';

/** Calls the Supabase Storage API at `endpoint` (the part after /storage/v1/); throws an Error with `.status` when Supabase refuses. */
async function storageApi(endpoint, { method = 'GET', body, headers = {} } = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw ApiError.internal('Supabase storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');

  // New sb_secret_ keys go in `apikey` only; older JWT keys (they start with "eyJ") also need a Bearer header.
  const auth = { apikey: key };
  if (key.startsWith('eyJ')) auth.Authorization = `Bearer ${key}`;

  const res = await fetch(`${base}/storage/v1/${endpoint}`, {
    method, body, headers: { ...auth, ...headers }, signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const reply = await res.text();
    throw Object.assign(new Error(`Supabase Storage ${method} ${endpoint} failed (${res.status}): ${reply}`), { status: res.status });
  }
  return res;
}

/** True when Supabase said the object doesn't exist. */
const notFound = (err) => err.status === 404 || /not.?found/i.test(err.message);

/** New random key, e.g. "attachment/2026/10/<uuid>.pdf". The client's file name is never used. */
function newKey(kind, originalName) {
  const ext = path.extname(originalName || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 9);
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${kind}/${now.getUTCFullYear()}/${month}/${crypto.randomUUID()}${ext}`;
}

async function put(key, buffer, contentType = 'application/octet-stream') {
  if (driver() === 'supabase') {
    // no-store: otherwise Supabase's CDN keeps serving a copy after the file is deleted.
    await storageApi(`object/${bucket()}/${checkKey(key)}`, { method: 'POST', body: buffer, headers: { 'Content-Type': contentType, 'cache-control': 'no-store' } });
    return;
  }
  const target = filePath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer, { flag: 'wx' });
}

async function read(key) {
  if (driver() === 'supabase') {
    try {
      const res = await storageApi(`object/authenticated/${bucket()}/${checkKey(key)}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (notFound(err)) throw ApiError.notFound('File not found');
      throw err;
    }
  }
  return fs.readFile(filePath(key));
}

async function remove(key) {
  if (driver() === 'supabase') {
    try {
      await storageApi(`object/${bucket()}/${checkKey(key)}`, { method: 'DELETE' });
    } catch (err) {
      if (!notFound(err)) throw err;
    }
    return;
  }
  await fs.rm(filePath(key), { force: true });
}

/** A link valid for `ttlSeconds`; `downloadName` becomes the saved file name. */
async function signedUrl(key, downloadName, ttlSeconds = 600) {
  const name = String(downloadName || path.basename(key)).slice(0, 200);
  if (driver() === 'supabase') {
    const res = await storageApi(`object/sign/${bucket()}/${checkKey(key)}`, {
      method: 'POST', body: JSON.stringify({ expiresIn: ttlSeconds }), headers: { 'Content-Type': 'application/json' },
    });
    const { signedURL } = await res.json();
    return {
      url: `${process.env.SUPABASE_URL}/storage/v1${signedURL}&download=${encodeURIComponent(name)}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
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
