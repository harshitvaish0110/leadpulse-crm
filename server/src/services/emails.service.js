/**
 * LeadPulse — Email thread writes, shared by the emails API and approved AI actions.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { assertParents } = require('./activities.service');
const { emitScoped } = require('../lib/realtime');

const EMAIL_SELECT = {
  id: true, direction: true, status: true, subject: true, body: true, aiGenerated: true, tone: true,
  sentAt: true, receivedAt: true, createdAt: true, updatedAt: true, contactId: true, dealId: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
};

const invalid = (path, msg) => ApiError.validation([{ path, msg }]);

/**
 * An OUTBOUND draft or a logged INBOUND email for a contact in the user's scope.
 * @param {{ contactId: string, dealId?: string, direction?: 'OUTBOUND'|'INBOUND', subject?: string, body: string, aiGenerated?: boolean, tone?: string, receivedAt?: string }} input
 */
async function createEmail(user, input) {
  const { contactId, dealId, subject, body, aiGenerated, tone } = input;
  const direction = input.direction ?? 'OUTBOUND';
  if (!['OUTBOUND', 'INBOUND'].includes(direction)) throw invalid('direction', 'direction must be OUTBOUND or INBOUND');
  if (!String(body ?? '').trim()) throw invalid('body', 'body is required');
  const contact = await assertParents(user, contactId, dealId);

  let receivedAt = null;
  if (direction === 'INBOUND') {
    receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
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
      createdById: user.id,
    },
    select: EMAIL_SELECT,
  });
  emitScoped([user.id, contact.ownerId], 'email:created', { emailId: email.id, contactId });
  return email;
}

module.exports = { EMAIL_SELECT, createEmail };
