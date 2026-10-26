/**
 * LeadPulse CRM — Email workspace: a per-contact thread of drafts, sent emails
 * and logged received emails. There is no mailbox sync; received emails are logged by hand.
 */

'use strict';

const { logger } = require('../lib/logger');
const { prisma } = require('../lib/prisma');
const { sendEmail } = require('../lib/mailer');
const { ApiError } = require('../middleware/error.middleware');
const { scoped, scopeFor } = require('../middleware/auth.middleware');
const { assertParents, logActivity } = require('../services/activities.service');
const { emitScoped } = require('../lib/realtime');

const EMAIL_SELECT = {
  id: true, direction: true, status: true, subject: true, body: true, aiGenerated: true, tone: true,
  sentAt: true, receivedAt: true, createdAt: true, updatedAt: true, contactId: true, dealId: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
};

const invalid = (path, msg) => ApiError.validation([{ path, msg }]);

async function findEmail(user, id) {
  const email = await prisma.emailDraft.findFirst({
    where:  { id, ...scopeFor(user, 'emailDraft') },
    select: { ...EMAIL_SELECT, contact: { select: { email: true, ownerId: true, firstName: true } } },
  });
  if (!email) throw ApiError.notFound('Email not found');
  return email;
}

/** GET /api/emails?contactId=&dealId= — oldest first, like a thread. */
async function list(req, res) {
  const { contactId, dealId } = req.query;
  if (!contactId && !dealId) throw ApiError.badRequest('contactId or dealId is required');
  const emails = await prisma.emailDraft.findMany({
    where: scoped(req.user, 'emailDraft', { ...(contactId && { contactId }), ...(dealId && { dealId }) }),
    orderBy: [{ createdAt: 'asc' }],
    select: EMAIL_SELECT,
  });
  res.json({ success: true, emails });
}

/**
 * POST /api/emails — `{ contactId, dealId?, direction, subject?, body, receivedAt?, aiGenerated?, tone? }`.
 * OUTBOUND starts as a DRAFT; INBOUND is a logged received email.
 */
async function create(req, res) {
  const { contactId, dealId, subject, body, aiGenerated, tone } = req.body ?? {};
  const direction = req.body?.direction ?? 'OUTBOUND';
  if (!['OUTBOUND', 'INBOUND'].includes(direction)) throw invalid('direction', 'direction must be OUTBOUND or INBOUND');
  if (!String(body ?? '').trim()) throw invalid('body', 'body is required');
  const contact = await assertParents(req.user, contactId, dealId);

  let receivedAt = null;
  if (direction === 'INBOUND') {
    receivedAt = req.body?.receivedAt ? new Date(req.body.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) throw invalid('receivedAt', 'receivedAt must be a date');
  }

  const email = await prisma.emailDraft.create({
    data: {
      contactId, dealId: dealId || null, direction,
      status:      direction === 'INBOUND' ? 'RECEIVED' : 'DRAFT',
      subject:     String(subject ?? '').trim() || null,
      body:        String(body).trim(),
      aiGenerated: Boolean(aiGenerated),
      tone:        tone || null,
      receivedAt,
      createdById: req.user.id,
    },
    select: EMAIL_SELECT,
  });
  emitScoped([req.user.id, contact.ownerId], 'email:created', { emailId: email.id, contactId });
  res.status(201).json({ success: true, email });
}

/** PATCH /api/emails/:id — subject/body of a DRAFT only. */
async function update(req, res) {
  const email = await findEmail(req.user, req.params.id);
  if (email.status !== 'DRAFT') throw ApiError.conflict('Only drafts can be edited', 'EMAIL_NOT_DRAFT');
  const data = {};
  if (req.body?.subject !== undefined) data.subject = String(req.body.subject).trim() || null;
  if (req.body?.body !== undefined) {
    if (!String(req.body.body).trim()) throw invalid('body', 'body cannot be empty');
    data.body = String(req.body.body).trim();
  }
  const updated = await prisma.emailDraft.update({ where: { id: email.id }, data, select: EMAIL_SELECT });
  res.json({ success: true, email: updated });
}

/**
 * POST /api/emails/:id/send — delivers a DRAFT through the configured provider.
 * Sets SENT (and logs an EMAIL activity) or FAILED; user-initiated, so no approval step.
 */
async function send(req, res) {
  const email = await findEmail(req.user, req.params.id);
  if (email.status !== 'DRAFT') throw ApiError.conflict('Only drafts can be sent', 'EMAIL_NOT_DRAFT');

  // Claim the draft first so a double click cannot send it twice.
  const { count } = await prisma.emailDraft.updateMany({ where: { id: email.id, status: 'DRAFT' }, data: { status: 'SENT', sentAt: new Date() } });
  if (count === 0) throw ApiError.conflict('This email is already being sent', 'EMAIL_NOT_DRAFT');

  try {
    const { previewUrl } = await sendEmail({ to: email.contact.email, subject: email.subject || '(no subject)', text: email.body });
    await logActivity(req.user, {
      type: 'EMAIL', subject: email.subject || 'Email sent', notes: email.body,
      contactId: email.contactId, dealId: email.dealId || undefined,
    });
    const sent = await prisma.emailDraft.findUnique({ where: { id: email.id }, select: EMAIL_SELECT });
    res.json({ success: true, email: sent, previewUrl });
  } catch (err) {
    logger.warn({ event: 'email_send_failed', err: err.message }, 'Email send failed');
    const failed = await prisma.emailDraft.update({ where: { id: email.id }, data: { status: 'FAILED', sentAt: null }, select: EMAIL_SELECT });
    res.status(502).json({ success: false, error: 'The email could not be sent. Check the email settings and try again.', code: 'EMAIL_SEND_FAILED', email: failed });
  }
}

/** DELETE /api/emails/:id */
async function remove(req, res) {
  await prisma.emailDraft.delete({ where: { id: req.params.id, ...scopeFor(req.user, 'emailDraft') } });
  res.status(204).end();
}

module.exports = { list, create, update, send, remove };
