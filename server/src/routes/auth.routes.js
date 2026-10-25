/**
 * LeadPulse CRM — Auth Routes
 *
 * POST   /api/auth/register         public, rate-limited
 * POST   /api/auth/login            public, rate-limited
 * POST   /api/auth/refresh          cookie + X-Requested-With
 * POST   /api/auth/logout           cookie
 * GET    /api/auth/invite/:token    public
 * POST   /api/auth/accept-invite    public, rate-limited
 * GET    /api/auth/me
 * PATCH  /api/auth/me
 * POST   /api/auth/change-password
 */

'use strict';

const { Router } = require('express');
const { body }   = require('express-validator');

const { authenticate } = require('../middleware/auth.middleware');
const { validate }     = require('../middleware/validate');
const { limiter, ipAndEmail } = require('../middleware/rateLimit');
const ctrl             = require('../controllers/auth.controller');

const router = Router();

const MIN = 60_000;
// Only failed sign-ins count, per IP and email address.
const loginLimit    = limiter({ windowMs: 15 * MIN, limit: 10, keyGenerator: ipAndEmail, skipSuccessfulRequests: true });
const registerLimit = limiter({ windowMs: 60 * MIN, limit: 5 });
// Every page load restores the session, so successful refreshes are not counted;
// only failures (bad or expired cookies, unknown invite tokens) are.
const refreshLimit  = limiter({ windowMs: 15 * MIN, limit: 60, skipSuccessfulRequests: true });

// Keep dots and +tags: they are distinct mailboxes outside Gmail.
const email = (field = 'email') => body(field)
  .trim()
  .isEmail().withMessage('Must be a valid email')
  .normalizeEmail({ all_lowercase: true, gmail_remove_dots: false, gmail_remove_subaddress: false });

const newPassword = (field) => body(field)
  .isLength({ min: 8, max: 128 }).withMessage('Password must be 8–128 characters')
  .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
  .matches(/[0-9]/).withMessage('Password must contain a number');

const name = (field, optional = false) => {
  const chain = body(field);
  return (optional ? chain.optional() : chain)
    .isString().trim().notEmpty().withMessage(`${field} is required`)
    .isLength({ max: 50 }).withMessage(`${field} is too long`);
};

router.post('/register', registerLimit,
  validate([email(), newPassword('password'), name('firstName'), name('lastName')]),
  ctrl.register);

router.post('/login', loginLimit,
  validate([email(), body('password').isString().notEmpty().withMessage('Password required')]),
  ctrl.login);

router.post('/refresh', refreshLimit, ctrl.refresh);
router.post('/logout', ctrl.logout);

router.get('/invite/:token', refreshLimit, ctrl.getInvite);
router.post('/accept-invite', registerLimit,
  validate([body('token').isString().notEmpty(), newPassword('password'), name('firstName'), name('lastName')]),
  ctrl.acceptInvite);

router.get('/me', authenticate, ctrl.getMe);
router.patch('/me', authenticate,
  validate([email().optional(), name('firstName', true), name('lastName', true)]),
  ctrl.updateMe);
router.post('/change-password', authenticate,
  validate([body('currentPassword').isString().notEmpty().withMessage('Current password is required'), newPassword('newPassword')]),
  ctrl.changePassword);

module.exports = router;
