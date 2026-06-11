/**
 * LeadPulse CRM — Auth Controller
 *
 * Handles user registration, login, and profile retrieval.
 * Passwords are bcrypt-hashed. JWTs are signed with HS256.
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { validationResult } = require('express-validator');

const { prisma }   = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');

const JWT_SECRET     = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Signs a JWT for the given userId.
 */
function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Checks express-validator results and throws if there are errors.
 */
function assertValid(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw ApiError.badRequest('Validation failed', errors.array());
  }
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Creates a new SALES_REP account (only ADMINs can promote to ADMIN via settings).
 */
async function register(req, res, next) {
  try {
    assertValid(req);

    const { email, password, firstName, lastName } = req.body;

    // Check duplicate before hashing to short-circuit early
    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true },
    });
    if (existing) throw ApiError.conflict('An account with this email already exists');

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email:     email.toLowerCase().trim(),
        passwordHash,
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        role:      'SALES_REP',
      },
      select: {
        id: true, email: true, firstName: true,
        lastName: true, role: true, createdAt: true,
      },
    });

    const token = signToken(user.id);

    res.status(201).json({
      success: true,
      token,
      user,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/login
 */
async function login(req, res, next) {
  try {
    assertValid(req);

    const { email, password } = req.body;

    // Use select to include passwordHash (excluded by default in most queries)
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, isActive: true, passwordHash: true,
      },
    });

    // Use constant-time comparison to prevent user enumeration via timing
    const dummyHash = '$2b$12$invalidhashforcomparison000000000000000000000000000';
    const hashToCompare = user?.passwordHash ?? dummyHash;
    const passwordOk = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordOk) {
      throw ApiError.unauthorized('Invalid email or password');
    }
    if (!user.isActive) {
      throw ApiError.forbidden('This account has been deactivated');
    }

    // Update lastLoginAt non-blocking (don't await — not critical path)
    prisma.user.update({
      where: { id: user.id },
      data:  { lastLoginAt: new Date() },
    }).catch(() => {}); // silently ignore

    const token = signToken(user.id);

    // Strip the hash before sending
    const { passwordHash: _omit, ...safeUser } = user;

    res.json({
      success: true,
      token,
      user: safeUser,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile.
 */
async function getMe(req, res, next) {
  try {
    // req.user is already populated by authenticate middleware
    // but re-fetch to include company/stats if needed later
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, isActive: true, lastLoginAt: true, createdAt: true,
        _count: {
          select: {
            contacts:   true,
            deals:      true,
            activities: true,
            tasks:      true,
          },
        },
      },
    });

    if (!user) throw ApiError.notFound('User not found');

    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/auth/me
 * Updates the current user's profile (name, email).
 */
async function updateMe(req, res, next) {
  try {
    assertValid(req);

    const { firstName, lastName, email } = req.body;

    // If changing email, check it's not taken
    if (email && email.toLowerCase().trim() !== req.user.email) {
      const taken = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        select: { id: true },
      });
      if (taken) throw ApiError.conflict('Email is already in use');
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(firstName && { firstName: firstName.trim() }),
        ...(lastName  && { lastName:  lastName.trim()  }),
        ...(email     && { email:     email.toLowerCase().trim() }),
      },
      select: {
        id: true, email: true, firstName: true,
        lastName: true, role: true, updatedAt: true,
      },
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/change-password
 */
async function changePassword(req, res, next) {
  try {
    assertValid(req);

    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { passwordHash: true },
    });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw ApiError.unauthorized('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: req.user.id },
      data:  { passwordHash },
    });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, getMe, updateMe, changePassword };
