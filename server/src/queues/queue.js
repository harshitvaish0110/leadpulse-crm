/**
 * LeadPulse — Background job queue: one BullMQ queue ("leadpulse") with named jobs.
 *
 * enqueue() never throws and never makes a request wait for Redis:
 *   - NODE_ENV=test: the job is recorded in `recorded` and not run.
 *   - Redis connected: the job is added to the queue and the worker runs it,
 *     with retries and exponential backoff.
 *   - Redis missing or down: the job runs in this process after its delay
 *     (logged as queue_fallback_inline), without retries.
 *
 * `dedupe` coalesces work per record: while a job with that id is waiting, new
 * ones are dropped; while one is running, one follow-up is kept, so the latest
 * change is always processed.
 */

'use strict';

const { Queue } = require('bullmq');
const { redis } = require('../lib/redis');
const { logger } = require('../lib/logger');
const { prisma } = require('../lib/prisma');

const QUEUE_NAME = 'leadpulse';
const ADD_TIMEOUT_MS = 2000;
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 86_400 },
};

let queue = null;
const recorded = [];
const inlinePending = new Set();
let lastFallbackWarning = 0;

/** The queue, or null when Redis isn't configured. */
function getQueue() {
  const connection = redis();
  if (!connection) return null;
  queue ??= new Queue(QUEUE_NAME, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  return queue;
}

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => { setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms).unref(); }),
]);

/** Runs a job handler by name; handlers live in jobs.js (loaded lazily: they import the services that enqueue). */
function runJob(name, data, job) {
  const { handlers } = require('./jobs');
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown job "${name}"`);
  return handler(data ?? {}, job);
}

function runInline(name, data, { dedupe, delay = 0 }) {
  if (dedupe) {
    if (inlinePending.has(dedupe)) return;
    inlinePending.add(dedupe);
  }
  setTimeout(() => {
    if (dedupe) inlinePending.delete(dedupe);
    Promise.resolve()
      .then(() => runJob(name, data))
      .catch((err) => logger.warn({ event: 'job_failed', jobName: name, inline: true, err: err.message }, 'Inline job failed'));
  }, delay);
}

/**
 * @param {string} name   job name (see jobs.js)
 * @param {object} [data]
 * @param {object} [opts]
 * @param {string} [opts.dedupe]   coalescing key, e.g. "rescore-contact:<id>"
 * @param {string} [opts.jobId]    exact id; a second job with the same id is ignored
 * @param {number} [opts.delay]    ms before the job may run (debounce window)
 * @param {number} [opts.attempts]
 * @param {object} [opts.backoff]   e.g. { type: 'exponential', delay: 30000 }
 * @param {object} [opts.removeOnComplete]
 */
async function enqueue(name, data = {}, opts = {}) {
  if (process.env.NODE_ENV === 'test') {
    recorded.push({ name, data, opts });
    if (recorded.length > 1000) recorded.shift();
    return;
  }

  const q = getQueue();
  if (q && redis().status === 'ready') {
    // Only defined keys: an explicit `undefined` would override the queue's defaults.
    const jobOpts = Object.fromEntries(Object.entries({
      jobId: opts.jobId,
      delay: opts.delay,
      attempts: opts.attempts,
      backoff: opts.backoff,
      removeOnComplete: opts.removeOnComplete,
      deduplication: opts.dedupe && { id: opts.dedupe, keepLastIfActive: true },
    }).filter(([, v]) => v !== undefined));
    try {
      await withTimeout(q.add(name, data, jobOpts), ADD_TIMEOUT_MS);
      return;
    } catch (err) {
      logger.debug({ event: 'queue_add_failed', jobName: name, err: err.message });
    }
  }

  if (q && Date.now() - lastFallbackWarning > 60_000) {
    lastFallbackWarning = Date.now();
    logger.warn({ event: 'queue_fallback_inline', jobName: name }, 'Redis unavailable; running background jobs in this process');
  }
  runInline(name, data, opts);
}

/** Repeating jobs: the nightly pipeline (SCORING_CRON in the org timezone) and hourly task reminders. */
async function registerSchedules() {
  const q = getQueue();
  if (!q) return false;
  const settings = await prisma.orgSettings.findUnique({ where: { id: 1 }, select: { timezone: true } }).catch(() => null);
  const tz = settings?.timezone || process.env.TZ || 'Asia/Kolkata';
  await q.upsertJobScheduler('nightly', { pattern: process.env.SCORING_CRON || '0 2 * * *', tz }, { name: 'nightly', data: {} });
  await q.upsertJobScheduler('task-reminders', { pattern: '5 * * * *', tz }, { name: 'task-reminders', data: {} });
  logger.info({ event: 'schedules_registered', tz }, 'Job schedules registered');
  return true;
}

/** Waiting/active/delayed/failed counts for /health/ready, or null without Redis. */
async function jobCounts() {
  const q = getQueue();
  if (!q || redis().status !== 'ready') return null;
  return q.getJobCounts('waiting', 'active', 'delayed', 'failed');
}

async function closeQueue() {
  await queue?.close().catch(() => {});
  queue = null;
}

module.exports = { QUEUE_NAME, DEFAULT_JOB_OPTIONS, enqueue, runJob, registerSchedules, jobCounts, closeQueue, recorded };
