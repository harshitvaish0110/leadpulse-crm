'use strict';
const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { limiter } = require('../middleware/rateLimit');
const ctrl = require('../controllers/ai.controller');

const router = Router();

// Per-user AI budget: protects the free-tier provider quotas shared by everyone.
const perUser = (req) => req.user.id;
router.use(
  authenticate,
  limiter({ windowMs: 60_000, limit: Number(process.env.AI_RATE_PER_MIN) || 30, keyGenerator: perUser }),
  limiter({ windowMs: 86_400_000, limit: Number(process.env.AI_RATE_PER_DAY) || 500, keyGenerator: perUser }),
);

router.post('/compose-email',              ctrl.composeEmail);
router.post('/deal-summary/:id',           ctrl.dealSummary);
router.post('/contact-narrative/:id',      ctrl.contactNarrative);
router.post('/smart-reply',                ctrl.smartReply);
router.post('/next-action{/:id}',          ctrl.nextAction);
router.post('/lead-score/:id/explain',     ctrl.explainLeadScore);
router.post('/enrich-contact',             ctrl.enrichContact);
router.post('/enrich-contact/:id/apply',   ctrl.applyEnrichment);
router.post('/chat',                       ctrl.chat);
router.post('/briefing',                   ctrl.briefing);
router.get('/conversations',               ctrl.listConversations);
router.get('/conversations/:id',           ctrl.getConversation);
router.delete('/conversations/:id',        ctrl.deleteConversation);
router.get('/actions',                     ctrl.listActions);
router.post('/actions/:id/approve',        ctrl.approveAction);
router.post('/actions/:id/reject',         ctrl.rejectAction);
router.get('/index/status',                requireRole('ADMIN'), ctrl.indexStatus);
router.post('/index/rebuild',              requireRole('ADMIN'), ctrl.rebuildIndex);

module.exports = router;
