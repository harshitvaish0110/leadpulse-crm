/**
 * LeadPulse CRM — Users Routes
 *
 * GET    /api/users/directory          any role — active users for owner pickers
 * GET    /api/users                    ADMIN
 * POST   /api/users/invite             ADMIN
 * DELETE /api/users/invitations/:id    ADMIN
 * PATCH  /api/users/:id                ADMIN
 */

'use strict';

const { Router } = require('express');
const { body }   = require('express-validator');

const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate');
const ctrl = require('../controllers/users.controller');

const ROLES = ['ADMIN', 'MANAGER', 'SALES_REP'];

const router = Router();
router.use(authenticate);

router.get('/directory', ctrl.directory);

router.use(requireRole('ADMIN'));

router.get('/', ctrl.listUsers);
router.post('/invite',
  validate([
    body('email').trim().isEmail().withMessage('Must be a valid email')
      .normalizeEmail({ all_lowercase: true, gmail_remove_dots: false, gmail_remove_subaddress: false }),
    body('role').optional().isIn(ROLES).withMessage(`role must be one of ${ROLES.join(', ')}`),
  ]),
  ctrl.inviteUser);
router.delete('/invitations/:id', ctrl.revokeInvitation);
router.patch('/:id',
  validate([
    body('role').optional().isIn(ROLES).withMessage(`role must be one of ${ROLES.join(', ')}`),
    body('isActive').optional().isBoolean({ strict: true }).withMessage('isActive must be true or false'),
  ]),
  ctrl.updateUser);

module.exports = router;
