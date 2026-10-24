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

  if (env.NODE_ENV === 'production') {
    if (!env.ML_SERVICE_TOKEN) errors.push('ML_SERVICE_TOKEN is required in production');
    if (!env.CORS_ORIGINS && !env.CLIENT_URL) errors.push('CORS_ORIGINS is required in production');
  }

  if (!AI_PROVIDER_KEYS.some((k) => env[k]) && env.AI_MOCK !== 'true') {
    warnings.push(`No AI provider key set (${AI_PROVIDER_KEYS.join(', ')}) — AI features will be unavailable`);
  }

  return { errors, warnings };
}

/** Exact CORS allow-list: CORS_ORIGINS (comma-separated), else CLIENT_URL, else the Vite dev server. */
function allowedOrigins(env = process.env) {
  const list = (env.CORS_ORIGINS || env.CLIENT_URL || 'http://localhost:5173')
    .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  return [...new Set(list)];
}

module.exports = { validateEnv, allowedOrigins };
