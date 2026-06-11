'use strict';
const { Router } = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/tasks.controller');

const router = Router();
router.use(authenticate);

router.get('/',               ctrl.list);
router.post('/',              ctrl.create);
router.patch('/:id',          ctrl.update);
router.patch('/:id/complete', ctrl.complete);
router.delete('/:id',         ctrl.remove);

module.exports = router;
