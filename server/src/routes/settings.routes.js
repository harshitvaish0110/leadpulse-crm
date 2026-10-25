/**
 * LeadPulse CRM — Workspace settings routes.
 *
 * GET /api/settings/tags              any role — tags for filters and pickers
 * GET /api/settings/pipeline-stages   any role — board columns in order
 * GET /api/settings/integrations      ADMIN — which integrations are configured; never returns key values
 */

'use strict';

const { Router } = require('express');
const { prisma } = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

const router = Router();
router.use(authenticate);

router.get('/tags', async (_req, res) => {
  const tags = await prisma.tag.findMany({
    orderBy: [{ isSource: 'desc' }, { name: 'asc' }],
    select:  { id: true, name: true, color: true, isSource: true },
  });
  res.json({ success: true, tags });
});

router.get('/pipeline-stages', async (_req, res) => {
  const stages = await prisma.pipelineStage.findMany({
    orderBy: { position: 'asc' },
    select:  { id: true, label: true, color: true, baseStage: true, position: true },
  });
  res.json({ success: true, stages });
});

router.get('/integrations', requireRole('ADMIN'), (_req, res) => {
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
