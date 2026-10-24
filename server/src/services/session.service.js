/**
 * LeadPulse — Session service.
 *
 * Short-lived JWT access tokens plus rotating, hashed refresh tokens kept in an
 * httpOnly cookie scoped to /api/auth.
 */

'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { prisma } = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');

const REFRESH_COOKIE = 'lp_rt';
const REFRESH_PATH = '/api/auth';
const ROTATION_GRACE_MS = 30_000;
const INVITE_TTL_MS = 72 * 3_600_000;

const refreshTtlMs = () => Number(process.env.JWT_REFRESH_TTL_DAYS || 7) * 86_400_000;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

/** Public shape of a user returned by auth endpoints. */
const USER_SELECT = {
  id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, lastLoginAt: true,
};

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, typ: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_TTL || '15m' },
  );
}

/** Minimal Cookie header parser (only reads the refresh cookie). */
function readRefreshCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === REFRESH_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_PATH,
  };
}

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions(), maxAge: refreshTtlMs() });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

async function createRefreshToken(userId, { familyId = crypto.randomUUID(), req } = {}) {
  const raw = randomToken();
  const row = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      familyId,
      expiresAt: new Date(Date.now() + refreshTtlMs()),
      userAgent: req?.get?.('user-agent')?.slice(0, 300) || null,
      ip: req?.ip || null,
    },
    select: { id: true },
  });
  return { raw, id: row.id, familyId };
}

/**
 * Starts a session: new refresh-token family + cookie, returns the access token.
 */
async function issueSession(res, user, req) {
  const { raw } = await createRefreshToken(user.id, { req });
  setRefreshCookie(res, raw);
  return signAccessToken(user);
}

/**
 * Exchanges the refresh cookie for a new access token, rotating the refresh token.
 *  - valid & unrotated      → rotate (same family), set new cookie
 *  - rotated ≤ 30 s ago     → grace: new access token, no rotation (parallel tabs)
 *  - rotated > 30 s / revoked / expired → reuse or stale: revoke family, 401
 * @returns {Promise<{ accessToken: string, user: object }>}
 */
async function refreshSession(req, res) {
  const raw = readRefreshCookie(req);
  if (!raw) throw ApiError.unauthorized('No session', 'NO_SESSION');

  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { user: { select: USER_SELECT } },
  });

  const now = Date.now();
  if (!token || token.revokedAt || token.expiresAt.getTime() <= now) {
    clearRefreshCookie(res);
    throw ApiError.unauthorized('Session expired', 'SESSION_EXPIRED');
  }

  if (token.replacedById) {
    const withinGrace = token.rotatedAt && now - token.rotatedAt.getTime() <= ROTATION_GRACE_MS;
    if (!withinGrace) {
      await revokeFamily(token.familyId);
      clearRefreshCookie(res);
      throw ApiError.unauthorized('Session revoked', 'SESSION_REUSED');
    }
  }

  if (!token.user.isActive) {
    await revokeFamily(token.familyId);
    clearRefreshCookie(res);
    throw ApiError.forbidden('Account is deactivated', 'ACCOUNT_DISABLED');
  }

  if (!token.replacedById) {
    const next = await createRefreshToken(token.userId, { familyId: token.familyId, req });
    // Conditional update: if two requests race on the same token, only one rotates.
    const { count } = await prisma.refreshToken.updateMany({
      where: { id: token.id, replacedById: null },
      data: { replacedById: next.id, rotatedAt: new Date(now) },
    });
    if (count === 1) {
      setRefreshCookie(res, next.raw);
    } else {
      await prisma.refreshToken.delete({ where: { id: next.id } });
    }
  }

  const { isActive: _a, ...user } = token.user;
  return { accessToken: signAccessToken(token.user), user };
}

async function revokeFamily(familyId) {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function revokeAllForUser(userId) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

async function endSession(req, res) {
  const raw = readRefreshCookie(req);
  if (raw) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  clearRefreshCookie(res);
}

// ── Invitations ──────────────────────────────────────────────────────────────

async function createInvitation({ email, role, invitedById }) {
  await prisma.invitation.updateMany({
    where: { email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const raw = randomToken();
  const invitation = await prisma.invitation.create({
    data: { email, role, invitedById, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
  });
  return { invitation, token: raw };
}

async function findValidInvitation(rawToken) {
  if (!rawToken) return null;
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) return null;
  return invitation;
}

module.exports = {
  REFRESH_COOKIE,
  USER_SELECT,
  signAccessToken,
  issueSession,
  refreshSession,
  endSession,
  revokeAllForUser,
  createInvitation,
  findValidInvitation,
  sha256,
};
