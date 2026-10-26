/**
 * LeadPulse — Internal endpoints for schedulers (GitHub Actions cron in the cloud).
 * Authenticated by the shared INTERNAL_JOB_TOKEN in `X-Internal-Token`.
 */

'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { ApiError } = require('../middleware/error.middleware');
const { enqueue } = require('../queues/queue');
const { localDate, orgTimezone } = require('../services/nightly.service');

const router = Router();

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

/** Constant-time token check (hashing first makes the comparison length-independent). */
router.use((req, _res, next) => {
  const expected = process.env.INTERNAL_JOB_TOKEN;
  if (!expected) throw new ApiError('Internal jobs are not configured', 503, 'INTERNAL_JOBS_DISABLED');
  if (!crypto.timingSafeEqual(digest(req.get('x-internal-token') ?? ''), digest(expected))) {
    throw ApiError.unauthorized('Invalid internal token', 'INVALID_INTERNAL_TOKEN');
  }
  next();
});

/** POST /internal/jobs/nightly — queues today's nightly run; repeated calls the same day are no-ops. */
router.post('/jobs/nightly', async (_req, res) => {
  const date = localDate(new Date(), await orgTimezone());
  await enqueue('nightly', {}, { jobId: `nightly-${date}`, attempts: 1, removeOnComplete: { age: 2 * 86_400 } });
  res.status(202).json({ success: true, enqueued: ['nightly'], date });
});

module.exports = router;
