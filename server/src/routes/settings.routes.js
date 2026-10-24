/**
 * LeadPulse CRM — Workspace settings routes (ADMIN).
 *
 * GET /api/settings/integrations — which integrations are configured; never returns key values.
 */

'use strict';

const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

const router = Router();
router.use(authenticate, requireRole('ADMIN'));

router.get('/integrations', (_req, res) => {
  const has = (key) => Boolean(process.env[key]);
  res.json({
    success: true,
    integrations: {
      gemini:     has('GEMINI_API_KEY'),
      groq:       has('GROQ_API_KEY'),
      openrouter: has('OPENROUTER_API_KEY'),
      anthropic:  has('ANTHROPIC_API_KEY'),
      openai:     has('OPENAI_API_KEY'),
      clearbit:   has('CLEARBIT_API_KEY'),
      smtp:       has('SMTP_HOST'),
      mlService:  has('ML_SERVICE_URL'),
    },
  });
});

module.exports = router;
