/**
 * LeadPulse — Redis connections (job queue, socket relay, caches).
 *
 * Optional: without REDIS_URL every caller falls back (jobs run in-process,
 * caches live in memory). The shared connection fails fast instead of buffering
 * commands while Redis is down, so a missing Redis never stalls a request.
 */

'use strict';

const IORedis = require('ioredis');
const { logger } = require('./logger');

let shared = null;

/** Logs connection loss and recovery once each, not on every reconnect attempt. */
function watch(client, role) {
  let down = false;
  client.on('error', (err) => {
    if (!down) logger.warn({ event: 'redis_unavailable', role, err: err.message }, 'Redis connection lost');
    down = true;
  });
  client.on('ready', () => {
    if (down) logger.info({ event: 'redis_ready', role }, 'Redis connection restored');
    down = false;
  });
  return client;
}

/** New connection with its own options (BullMQ workers and subscribers need dedicated ones). */
function connect(role, options = {}) {
  if (!process.env.REDIS_URL) return null;
  return watch(new IORedis(process.env.REDIS_URL, options), role);
}

/** Shared command connection, or null when Redis isn't configured. */
function redis() {
  if (!process.env.REDIS_URL) return null;
  shared ??= connect('commands', { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  return shared;
}

/** JSON get/set that never throws: a Redis outage reads as a cache miss. */
async function getJSON(key) {
  try {
    const raw = await redis()?.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function setJSON(key, value, ttlSeconds) {
  try {
    await redis()?.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    return true;
  } catch {
    return false;
  }
}

async function closeRedis() {
  await shared?.quit().catch(() => {});
  shared = null;
}

module.exports = { redis, connect, getJSON, setJSON, closeRedis };
