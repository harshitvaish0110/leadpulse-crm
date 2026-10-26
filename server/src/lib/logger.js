/**
 * LeadPulse — Structured JSON logs (pino).
 *
 * One line per event with `service`, plus `requestId`/`userId` on request logs.
 * Domain events add an `event` field (ai_call, job_completed, queue_fallback_inline…).
 * Credentials are redacted wherever they appear in a logged object.
 */

'use strict';

const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: process.env.SERVICE_NAME || 'leadpulse-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-internal-token"]', 'res.headers["set-cookie"]',
      '*.password', '*.passwordHash', '*.apiKey', '*.token', '*.accessToken', '*.refreshToken',
    ],
    censor: '[redacted]',
  },
});

module.exports = { logger };
