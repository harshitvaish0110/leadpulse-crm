/**
 * LeadPulse CRM — the signed-in user's own start page and quick search.
 *
 * GET /api/my-day            tasks, closing and stalled deals, accounts at risk, next steps, today's briefing
 * GET /api/search?q=         contacts, deals and companies for the command palette (scoped)
 *
 * Generating the briefing is an AI call, so it lives with the AI routes: POST /api/ai/briefing.
 */

'use strict';

const { Router } = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { myDay } = require('../services/myDay.service');
const { quickSearch } = require('../services/search.service');

// Mounted at /api, so authentication is per route: unknown /api paths must still reach the 404 handler.
const router = Router();

router.get('/my-day', authenticate, async (req, res) => {
  res.json({ success: true, day: await myDay(req.user) });
});

router.get('/search', authenticate, async (req, res) => {
  res.json({ success: true, results: await quickSearch(req.user, String(req.query.q ?? '').slice(0, 120)) });
});

module.exports = router;
