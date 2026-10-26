/**
 * LeadPulse CRM — Users Controller
 * Role checks live in users.routes.js; everything except `directory` is ADMIN only.
 */

'use strict';

const { prisma }   = require('../lib/prisma');
const { audit }    = require('../lib/audit');
const { logger }   = require('../lib/logger');
const { sendEmail } = require('../lib/mailer');
const { workspace } = require('../lib/workspace');
const { ApiError } = require('../middleware/error.middleware');
const { allowedOrigins } = require('../lib/env');
const { createInvitation, reissueInvitation, revokeAllForUser } = require('../services/session.service');

const PUBLIC_USER = { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true };
const EMAIL_TIMEOUT_MS = 10_000;
const ROLE_NAMES = { ADMIN: 'an admin', MANAGER: 'a manager', SALES_REP: 'a sales rep' };

const inviteUrl = (token) =>
  `${(process.env.APP_URL || allowedOrigins()[0]).replace(/\/$/, '')}/accept-invite?token=${token}`;

/**
 * Emails the invitation link. The admin always gets the link back too, so a
 * failed or slow send never blocks an invite: they can share it themselves.
 * @returns {Promise<{ sent: boolean, previewUrl?: string, error?: string }>}
 */
async function emailInvite(req, invitation, link) {
  const inviter = `${req.user.firstName} ${req.user.lastName}`;
  const { companyName } = workspace();
  const text = [
    `${inviter} invited you to join ${companyName} on LeadPulse as ${ROLE_NAMES[invitation.role]}.`,
    '',
    `Accept the invitation: ${link}`,
    '',
    `The link works once and expires on ${invitation.expiresAt.toUTCString()}.`,
  ].join('\n');
  try {
    const { previewUrl } = await Promise.race([
      sendEmail({ to: invitation.email, subject: `${inviter} invited you to ${companyName} on LeadPulse`, text, replyTo: req.user.email }),
      new Promise((_, reject) => { setTimeout(() => reject(new Error('timed out')), EMAIL_TIMEOUT_MS).unref(); }),
    ]);
    return { sent: true, ...(previewUrl && { previewUrl }) };
  } catch (err) {
    logger.warn({ event: 'invite_email_failed', invitationId: invitation.id, err: err.message }, 'Invitation email not sent');
    return { sent: false, error: 'The email could not be sent; share the link instead.' };
  }
}

/** GET /api/users/directory — any role; feeds owner and assignee pickers. */
async function directory(_req, res) {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, firstName: true, lastName: true, role: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  res.json({ success: true, users });
}

/** GET /api/users — users, plus invitations still pending (including ones that expired in the last 30 days, which can be resent). */
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
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date(Date.now() - 30 * 86_400_000) } },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const now = new Date();
  res.json({
    success: true,
    users: users.map((u) => ({ ...u, status: u.isActive ? 'active' : 'inactive' })),
    invitations: invitations.map((i) => ({ ...i, expired: i.expiresAt <= now })),
  });
}

/** PATCH /api/users/:id — role and/or isActive; deactivation ends every session. */
async function updateUser(req, res) {
  const { role, isActive } = req.body;
  const self = req.params.id === req.user.id;
  if (self && isActive === false) throw ApiError.badRequest('You cannot deactivate your own account');
  if (self && role && role !== 'ADMIN') throw ApiError.badRequest('You cannot remove your own admin role');

  const before = await prisma.user.findUnique({ where: { id: req.params.id }, select: { role: true, isActive: true } });
  if (!before) throw ApiError.notFound('User not found');
  const user = await prisma.user.update({
    where:  { id: req.params.id },
    data:   { ...(role !== undefined && { role }), ...(isActive !== undefined && { isActive }) },
    select: PUBLIC_USER,
  });
  if (isActive === false) await revokeAllForUser(user.id);
  const action = role !== undefined && role !== before.role ? 'role_change' : 'update';
  await audit(req, { action, entityType: 'user', entityId: user.id, before, after: { role: user.role, isActive: user.isActive } });
  res.json({ success: true, user });
}

/** POST /api/users/invite — emails a single-use link valid for 72 h; the link is also returned. */
async function inviteUser(req, res) {
  const { email, role = 'SALES_REP' } = req.body;
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw ApiError.conflict('A user with this email already exists');

  const { invitation, token } = await createInvitation({ email, role, invitedById: req.user.id });
  await audit(req, { action: 'invite', entityType: 'invitation', entityId: invitation.id, after: { email, role } });
  const link = inviteUrl(token);
  res.status(201).json({ success: true, invitation, inviteUrl: link, email: await emailInvite(req, invitation, link) });
}

/** POST /api/users/invitations/:id/resend — a fresh link (the old one stops working), emailed again. */
async function resendInvitation(req, res) {
  const reissued = await reissueInvitation(req.params.id);
  if (!reissued) throw ApiError.notFound('Invitation not found or already used');
  await audit(req, { action: 'invite_resend', entityType: 'invitation', entityId: reissued.invitation.id });
  const link = inviteUrl(reissued.token);
  res.json({ success: true, invitation: reissued.invitation, inviteUrl: link, email: await emailInvite(req, reissued.invitation, link) });
}

/** DELETE /api/users/invitations/:id */
async function revokeInvitation(req, res) {
  await prisma.invitation.update({
    where: { id: req.params.id, acceptedAt: null },
    data:  { revokedAt: new Date() },
  });
  await audit(req, { action: 'invite_revoke', entityType: 'invitation', entityId: req.params.id });
  res.status(204).end();
}

module.exports = { directory, listUsers, updateUser, inviteUser, resendInvitation, revokeInvitation };
