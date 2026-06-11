'use strict';
const { Router } = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/ai.controller');

const router = Router();
router.use(authenticate);

router.post('/compose-email',    ctrl.composeEmail);
router.post('/deal-summary/:id', ctrl.dealSummary);
router.post('/smart-reply',      ctrl.smartReply);
router.post('/next-action/:id',  ctrl.nextAction);
router.post('/enrich-contact',   ctrl.enrichContact);
router.get('/chat',              ctrl.chat);
router.post('/transcribe',       ctrl.transcribe);

module.exports = router;
