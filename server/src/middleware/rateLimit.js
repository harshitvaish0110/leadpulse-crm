'use strict';

const { rateLimit } = require('express-rate-limit');
const { ApiError } = require('./error.middleware');

/**
 * In-memory rate limiter that answers with the standard error envelope (429 + Retry-After).
 * The memory store is per process — switch to a Redis store if the API runs on several instances.
 */
function limiter({ windowMs, limit, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req, _res, next) => next(new ApiError('Too many requests, please try again later.', 429, 'RATE_LIMITED')),
  });
}

module.exports = { limiter };
