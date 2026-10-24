/**
 * LeadPulse CRM — Users Controller
 * Role checks live in users.routes.js; everything except `directory` is ADMIN only.
 */

'use strict';

const { prisma }   = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { allowedOrigins } = require('../lib/env');
const { createInvitation, revokeAllForUser } = require('../services/session.service');

const PUBLIC_USER = { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true };

const inviteUrl = (token) =>
  `${(process.env.APP_URL || allowedOrigins()[0]).replace(/\/$/, '')}/accept-invite?token=${token}`;

/** GET /api/users/directory — any role; feeds owner and assignee pickers. */
async function directory(_req, res) {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, firstName: true, lastName: true, role: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  res.json({ success: true, users });
}

/** GET /api/users */
async function listUsers(_req, res) {
  const [users, invitations] = await Promise.all([
    prisma.user.findMany({
      select: {
        ...PUBLIC_USER, lastLoginAt: true, createdAt: true,
        _count: { select: { contacts: true, deals: true, activities: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  res.json({
    success: true,
    users: users.map((u) => ({ ...u, status: u.isActive ? 'active' : 'inactive' })),
    invitations,
  });
}

/** PATCH /api/users/:id — role and/or isActive; deactivation ends every session. */
async function updateUser(req, res) {
  const { role, isActive } = req.body;
  const self = req.params.id === req.user.id;
  if (self && isActive === false) throw ApiError.badRequest('You cannot deactivate your own account');
  if (self && role && role !== 'ADMIN') throw ApiError.badRequest('You cannot remove your own admin role');

  const user = await prisma.user.update({
    where:  { id: req.params.id },
    data:   { ...(role !== undefined && { role }), ...(isActive !== undefined && { isActive }) },
    select: PUBLIC_USER,
  });
  if (isActive === false) await revokeAllForUser(user.id);
  res.json({ success: true, user });
}

/**
 * POST /api/users/invite — single-use link valid for 72 h.
 * Invites are not emailed yet, so the link is returned for the admin to share.
 */
async function inviteUser(req, res) {
  const { email, role = 'SALES_REP' } = req.body;
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw ApiError.conflict('A user with this email already exists');

  const { invitation, token } = await createInvitation({ email, role, invitedById: req.user.id });
  res.status(201).json({ success: true, invitation, inviteUrl: inviteUrl(token) });
}

/** DELETE /api/users/invitations/:id */
async function revokeInvitation(req, res) {
  await prisma.invitation.update({
    where: { id: req.params.id, acceptedAt: null },
    data:  { revokedAt: new Date() },
  });
  res.status(204).end();
}

module.exports = { directory, listUsers, updateUser, inviteUser, revokeInvitation };
