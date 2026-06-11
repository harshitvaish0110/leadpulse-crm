/**
 * LeadPulse CRM — Auth Routes
 *
 * POST   /api/auth/register
 * POST   /api/auth/login
 * GET    /api/auth/me
 * PATCH  /api/auth/me
 * POST   /api/auth/change-password
 */

'use strict';

const { Router } = require('express');
const { body }   = require('express-validator');

const { authenticate }                              = require('../middleware/auth.middleware');
const { register, login, getMe, updateMe, changePassword } = require('../controllers/auth.controller');

const router = Router();

// ── Validation rules ──────────────────────────────────────────────────────────

const registerRules = [
  body('email')
    .isEmail().withMessage('Must be a valid email')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),
  body('firstName')
    .trim().notEmpty().withMessage('First name is required')
    .isLength({ max: 50 }).withMessage('First name too long'),
  body('lastName')
    .trim().notEmpty().withMessage('Last name is required')
    .isLength({ max: 50 }).withMessage('Last name too long'),
];

const loginRules = [
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password required'),
];

const updateMeRules = [
  body('email').optional().isEmail().withMessage('Must be a valid email').normalizeEmail(),
  body('firstName').optional().trim().notEmpty().isLength({ max: 50 }),
  body('lastName').optional().trim().notEmpty().isLength({ max: 50 }),
];

const changePasswordRules = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('New password must contain an uppercase letter')
    .matches(/[0-9]/).withMessage('New password must contain a number'),
];

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/register',         registerRules,       register);
router.post('/login',            loginRules,          login);
router.get('/me',                authenticate,        getMe);
router.patch('/me',              authenticate, updateMeRules, updateMe);
router.post('/change-password',  authenticate, changePasswordRules, changePassword);

module.exports = router;
