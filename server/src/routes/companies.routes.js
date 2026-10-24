'use strict';
const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/companies.controller');

const router = Router();
router.use(authenticate);

router.get('/',       ctrl.list);
router.post('/',      ctrl.create);
router.get('/:id',    ctrl.getOne);
router.patch('/:id',  ctrl.update);
router.delete('/:id', requireRole('ADMIN', 'MANAGER'), ctrl.remove);

module.exports = router;
