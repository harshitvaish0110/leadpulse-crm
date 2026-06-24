'use strict';

const bcrypt     = require('bcryptjs');
const { prisma } = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');

function adminOnly(req) {
  if (req.user.role !== 'ADMIN') throw ApiError.forbidden('Admin only');
}

/**
 * GET /api/users
 * List all users with last-login and counts. Admin only.
 */
async function listUsers(req, res, next) {
  try {
    adminOnly(req);
    const users = await prisma.user.findMany({
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, isActive: true, lastLoginAt: true, createdAt: true,
        _count: { select: { contacts: true, deals: true, activities: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, users });
  } catch (err) { next(err); }
}

/**
 * PATCH /api/users/:id
 * Update role or isActive. Admin only.
 */
async function updateUser(req, res, next) {
  try {
    adminOnly(req);
    const { role, isActive } = req.body;

    // Prevent admin from deactivating themselves
    if (req.params.id === req.user.id && isActive === false) {
      throw ApiError.badRequest('You cannot deactivate your own account');
    }

    const allowed = {};
    if (role     !== undefined) allowed.role     = role;
    if (isActive !== undefined) allowed.isActive = isActive;

    const user = await prisma.user.update({
      where:  { id: req.params.id },
      data:   allowed,
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });
    res.json({ success: true, user });
  } catch (err) { next(err); }
}

/**
 * POST /api/users/invite
 * Create a new user with a temporary password. Admin only.
 * The invited user should reset their password on first login.
 */
async function inviteUser(req, res, next) {
  try {
    adminOnly(req);
    const { email, firstName, lastName, role = 'SALES_REP' } = req.body;

    if (!email || !firstName || !lastName) {
      throw ApiError.badRequest('email, firstName and lastName are required');
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw ApiError.badRequest('A user with this email already exists');

    // Temporary password — user should change this on first login
    const tempPassword = `LP_${Math.random().toString(36).slice(2, 10).toUpperCase()}!`;
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.user.create({
      data:   { email, firstName, lastName, role, passwordHash },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });

    // In production: send email with tempPassword via SMTP
    // For now: return it in the response so admin can share it manually
    res.status(201).json({ success: true, user, tempPassword });
  } catch (err) { next(err); }
}

/**
 * GET /api/settings/integrations
 * Returns which API integrations are configured (key present in env).
 * Never exposes actual key values.
 */
async function getIntegrationStatus(_req, res) {
  res.json({
    success: true,
    integrations: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai:    !!process.env.OPENAI_API_KEY,
      clearbit:  !!process.env.CLEARBIT_API_KEY,
      smtp:      !!process.env.SMTP_HOST,
    },
  });
}

module.exports = { listUsers, updateUser, inviteUser, getIntegrationStatus };
