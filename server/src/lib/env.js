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
    if (!env.INTERNAL_JOB_TOKEN) errors.push('INTERNAL_JOB_TOKEN is required in production (it protects the nightly job trigger)');
  }

  if (!env.ENCRYPTION_KEY) {
    warnings.push('ENCRYPTION_KEY is not set — API keys can only come from .env, and webhooks cannot be created');
  } else if (Buffer.from(env.ENCRYPTION_KEY, 'base64').length !== 32) {
    errors.push('ENCRYPTION_KEY must be 32 bytes, base64-encoded (e.g. openssl rand -base64 32)');
  }

  if (!env.REDIS_URL) warnings.push('REDIS_URL is not set — background jobs run inside the API process, without retries');

  if (!AI_PROVIDER_KEYS.some((k) => env[k]) && env.AI_MOCK !== 'true') {
    warnings.push(`No AI provider key in the environment (${AI_PROVIDER_KEYS.join(', ')}) — AI features need one saved in Settings → Integrations`);
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
