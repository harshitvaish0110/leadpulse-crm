'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { ApiError } = require('./error.middleware');

/**
 * In-memory rate limiter that answers with the standard error envelope (429 + Retry-After).
 * The memory store is per process — switch to a Redis store if the API runs on several instances.
 */
function limiter({ windowMs, limit, keyGenerator, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req, _res, next) => next(new ApiError('Too many requests, please try again later.', 429, 'RATE_LIMITED')),
  });
}

/** IP plus the submitted email, so one attacker cannot lock out every account behind a shared IP. */
const ipAndEmail = (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email ?? '').trim().toLowerCase()}`;

module.exports = { limiter, ipAndEmail };
