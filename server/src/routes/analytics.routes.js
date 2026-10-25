'use strict';
const { Router } = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/analytics.controller');

const router = Router();
router.use(authenticate);

router.get('/overview',          ctrl.overview);
router.get('/revenue',           ctrl.revenue);
router.get('/pipeline',          ctrl.pipeline);
router.get('/win-loss',          ctrl.winLoss);
router.get('/rep-performance',   ctrl.repPerformance);
router.get('/sentiment-trends',  ctrl.sentimentTrends);
router.get('/funnel',            ctrl.funnel);
router.get('/lead-sources',      ctrl.leadSources);
router.get('/at-risk',           ctrl.atRisk);
router.get('/next-actions',      ctrl.nextActions);

module.exports = router;
