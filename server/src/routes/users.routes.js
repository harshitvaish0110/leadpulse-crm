'use strict';

const { Router } = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/users.controller');

const router = Router();
router.use(authenticate);

router.get('/',           ctrl.listUsers);
router.patch('/:id',      ctrl.updateUser);
router.post('/invite',    ctrl.inviteUser);

// Settings sub-routes (mounted separately in app.js)
router.get('/integrations', ctrl.getIntegrationStatus);

module.exports = router;
