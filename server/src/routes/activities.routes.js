'use strict';
const { Router } = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/activities.controller');

const router = Router();
router.use(authenticate);

router.get('/',       ctrl.list);
router.post('/',      ctrl.create);
router.get('/:id',    ctrl.getOne);
router.delete('/:id', ctrl.remove);

module.exports = router;
