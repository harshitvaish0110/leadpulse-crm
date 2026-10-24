/**
 * LeadPulse CRM — Auth Controller
 *
 * Login, registration and invite acceptance start a session: a refresh-token
 * cookie plus a short-lived access token in the response body.
 */

'use strict';

const bcrypt = require('bcryptjs');

const { prisma }   = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const session      = require('../services/session.service');

// A real bcrypt hash so unknown emails cost the same as a wrong password.
const DUMMY_HASH = '$2b$12$u2iKNVsAnMfU468txFmaXe3z8/eHrTlMNXxiYRVQ..9OoM0dLzVrC';
const { USER_SELECT } = session;

/** Role for a self-registration, or 403 when sign-up is closed. */
async function signupRole(email) {
  const bootstrap = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (bootstrap && email === bootstrap) {
    const admins = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (admins === 0) return 'ADMIN';
  }
  if (process.env.ALLOW_SIGNUP === 'true') return 'SALES_REP';
  throw ApiError.forbidden('Registration is invite-only', 'REGISTRATION_CLOSED');
}

async function createUser({ email, password, firstName, lastName, role }) {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw ApiError.conflict('An account with this email already exists');
  return prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash(password, 12), firstName, lastName, role, lastLoginAt: new Date() },
    select: USER_SELECT,
  });
}

/** POST /api/auth/register */
async function register(req, res) {
  const role = await signupRole(req.body.email);
  const user = await createUser({ ...req.body, role });
  const accessToken = await session.issueSession(res, user, req);
  res.status(201).json({ success: true, accessToken, user });
}

/** POST /api/auth/login */
async function login(req, res) {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { ...USER_SELECT, passwordHash: true },
  });

  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated', 'ACCOUNT_DISABLED');

  const { passwordHash: _omit, ...safeUser } = user;
  safeUser.lastLoginAt = new Date();
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: safeUser.lastLoginAt } });

  const accessToken = await session.issueSession(res, safeUser, req);
  res.json({ success: true, accessToken, user: safeUser });
}

/** POST /api/auth/refresh — requires `X-Requested-With` (CSRF guard; the cookie is SameSite=Lax). */
async function refresh(req, res) {
  if (!req.get('x-requested-with')) throw ApiError.forbidden('Missing X-Requested-With header', 'CSRF_HEADER_REQUIRED');
  const { accessToken, user } = await session.refreshSession(req, res);
  res.json({ success: true, accessToken, user });
}

/** POST /api/auth/logout */
async function logout(req, res) {
  await session.endSession(req, res);
  res.status(204).end();
}

/** GET /api/auth/invite/:token */
async function getInvite(req, res) {
  const invitation = await session.findValidInvitation(req.params.token);
  if (!invitation) throw ApiError.notFound('This invitation is invalid or has expired', 'INVITE_INVALID');
  const { email, role, expiresAt } = invitation;
  res.json({ success: true, invitation: { email, role, expiresAt } });
}

/** POST /api/auth/accept-invite */
async function acceptInvite(req, res) {
  const { token, firstName, lastName, password } = req.body;
  const invitation = await session.findValidInvitation(token);
  if (!invitation) throw ApiError.notFound('This invitation is invalid or has expired', 'INVITE_INVALID');

  const user = await createUser({ email: invitation.email, password, firstName, lastName, role: invitation.role });
  await prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });

  const accessToken = await session.issueSession(res, user, req);
  res.status(201).json({ success: true, accessToken, user });
}

/** GET /api/auth/me */
async function getMe(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      ...USER_SELECT,
      createdAt: true,
      _count: { select: { contacts: true, deals: true, activities: true, tasks: true } },
    },
  });
  if (!user) throw ApiError.notFound('User not found');
  res.json({ success: true, user });
}

/** PATCH /api/auth/me */
async function updateMe(req, res) {
  const { firstName, lastName, email } = req.body;

  if (email && email !== req.user.email) {
    const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (taken) throw ApiError.conflict('Email is already in use');
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(email && { email }),
    },
    select: { ...USER_SELECT, updatedAt: true },
  });
  res.json({ success: true, user });
}

/** POST /api/auth/change-password — also signs out every other session. */
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  const { passwordHash } = await prisma.user.findUnique({ where: { id: req.user.id }, select: { passwordHash: true } });

  if (!(await bcrypt.compare(currentPassword, passwordHash))) {
    throw ApiError.unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
  }

  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } });
  await session.revokeAllForUser(req.user.id);
  const accessToken = await session.issueSession(res, req.user, req);
  res.json({ success: true, message: 'Password changed successfully', accessToken });
}

module.exports = { register, login, refresh, logout, getInvite, acceptInvite, getMe, updateMe, changePassword };
