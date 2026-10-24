/**
 * LeadPulse — Startup environment validation.
 *
 * Fails fast on missing or weak required configuration. Only variables the
 * current code actually reads are required; extend the list as features start
 * depending on new variables.
 */

'use strict';

const AI_PROVIDER_KEYS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateEnv(env = process.env) {
  const errors = [];
  const warnings = [];

  if (!env.DATABASE_URL) errors.push('DATABASE_URL is required');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be set and at least 32 characters long');
  }

  if (!AI_PROVIDER_KEYS.some((k) => env[k]) && env.AI_MOCK !== 'true') {
    warnings.push(`No AI provider key set (${AI_PROVIDER_KEYS.join(', ')}) — AI features will be unavailable`);
  }

  return { errors, warnings };
}

module.exports = { validateEnv };
