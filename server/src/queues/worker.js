/**
 * LeadPulse — BullMQ worker. Runs in its own process (worker.js) or inside the
 * API when WORKER_INLINE=true (single-instance hosting such as Render's free tier).
 */

'use strict';

const { Worker } = require('bullmq');
const { connect } = require('../lib/redis');
const { logger } = require('../lib/logger');
const { QUEUE_NAME, runJob, registerSchedules } = require('./queue');

/** Starts the worker and registers the schedules; null without REDIS_URL. */
function startWorker({ concurrency = Number(process.env.WORKER_CONCURRENCY) || 4 } = {}) {
  // Workers block on Redis, so they need their own connection that retries forever.
  const connection = connect('worker', { maxRetriesPerRequest: null });
  if (!connection) return null;

  const worker = new Worker(QUEUE_NAME, (job) => runJob(job.name, job.data, job), { connection, concurrency });

  worker.on('completed', (job, result) => logger.info({
    event: 'job_completed', jobName: job.name, jobId: job.id, attempt: job.attemptsStarted,
    ms: job.finishedOn - job.processedOn, result: typeof result === 'object' ? result : undefined,
  }, 'Job completed'));
  worker.on('failed', (job, err) => logger.warn({
    event: 'job_failed', jobName: job?.name, jobId: job?.id, attempt: job?.attemptsStarted,
    willRetry: job ? job.attemptsMade < (job.opts.attempts ?? 1) : false, err: err.message,
  }, 'Job failed'));
  // Connection loss is already reported once per outage by lib/redis; BullMQ repeats it on every reconnect attempt.
  worker.on('error', (err) => {
    if (!/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|Connection is closed/.test(err.message)) {
      logger.warn({ event: 'worker_error', err: err.message }, 'Worker error');
    }
  });

  registerSchedules().catch((err) => logger.warn({ event: 'schedules_failed', err: err.message }, 'Could not register job schedules'));
  logger.info({ event: 'worker_started', concurrency }, 'Worker started');
  return worker;
}

module.exports = { startWorker };
