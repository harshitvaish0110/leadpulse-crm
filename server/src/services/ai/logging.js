/**
 * LeadPulse — AI call log. One `ai_logs` row (and one log line) per provider
 * attempt, fire-and-forget: logging never fails or slows down the AI call.
 */

'use strict';

const { prisma } = require('../../lib/prisma');
const { logger } = require('../../lib/logger');

const MAX_TEXT = 4000;

/**
 * @param {object} entry
 * @param {string} entry.feature
 * @param {string} entry.provider
 * @param {string} entry.model
 * @param {'ok'|'fallback'|'error'|'aborted'} entry.status
 * @param {number} entry.latencyMs
 * @param {string} [entry.userId]
 * @param {string} [entry.contactId]
 * @param {string} [entry.dealId]
 * @param {object} [entry.input]    what the feature was asked (ids, options), not the full prompt
 * @param {object|string} [entry.output]
 * @param {string} [entry.errorMessage]
 * @param {number} [entry.tokensUsed]
 */
function logAICall(entry) {
  const { feature, provider, model, status, latencyMs, errorMessage, tokensUsed = 0 } = entry;
  const output = typeof entry.output === 'string' ? { text: entry.output.slice(0, MAX_TEXT) } : entry.output ?? null;

  logger[status === 'ok' ? 'info' : 'warn']({ event: 'ai_call', feature, provider, model, status, latencyMs, tokensUsed, err: errorMessage }, 'AI call');

  prisma.aiLog.create({
    data: {
      feature,
      provider,
      model,
      status,
      latencyMs,
      errorMessage: errorMessage ? String(errorMessage).slice(0, 500) : null,
      userId: entry.userId || null,
      contactId: entry.contactId || null,
      dealId: entry.dealId || null,
      input: entry.input ?? {},
      output,
      tokensUsed,
    },
  }).catch((err) => logger.warn({ event: 'ai_log_failed', err: err.message }, 'Could not write AI log'));
}

module.exports = { logAICall };
