/**
 * LeadPulse — Approval gate for AI-proposed writes.
 *
 * The assistant can only propose: each proposal is validated, scope-checked and
 * stored as PENDING. Nothing runs until its requester approves it. Approval is
 * a conditional update (PENDING → APPROVED), so a second click or a race gets
 * 409; the payload is then validated and scope-checked again, as the approving
 * user, and executed through the same service functions the UI uses, so every
 * side effect (sockets, rescoring, reindexing) happens as usual.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { audit } = require('../lib/audit');
const { notify } = require('../lib/notify');
const { ApiError } = require('../middleware/error.middleware');
const { assertInScope, assertContactInScope } = require('../middleware/auth.middleware');
const tasks = require('./tasks.service');
const activities = require('./activities.service');
const deals = require('./deals.service');
const emails = require('./emails.service');

const RISK = { CREATE_TASK: 'low', DRAFT_EMAIL: 'low', LOG_ACTIVITY: 'medium', UPDATE_DEAL_STAGE: 'medium' };
const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
const PUBLIC = {
  id: true, type: true, payload: true, rationale: true, risk: true, status: true, source: true,
  conversationId: true, contactId: true, dealId: true, result: true, error: true, decidedAt: true, executedAt: true, createdAt: true,
};

const invalid = (msg) => ApiError.validation([{ path: 'payload', msg }]);
const str = (v, max, name, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw invalid(`${name} is required`);
  if (s.length > max) throw invalid(`${name} can be at most ${max} characters`);
  return s || undefined;
};
const id = (v, name, required = false) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw invalid(`${name} is required`);
    return undefined;
  }
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw invalid(`${name} must be a record id`);
  return v;
};
const oneOf = (v, allowed, name, required = false) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw invalid(`${name} is required`);
    return undefined;
  }
  const s = String(v).toUpperCase();
  if (!allowed.includes(s)) throw invalid(`${name} must be one of ${allowed.join(', ')}`);
  return s;
};
const isoDate = (v, name) => {
  if (v === undefined || v === null || v === '') return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw invalid(`${name} must be a date`);
  return d.toISOString();
};
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Payload schemas: unknown keys are dropped, values are checked and trimmed. */
const SCHEMAS = {
  CREATE_TASK: (p) => compact({
    title: str(p.title, 200, 'title', true), description: str(p.description, 2000, 'description'),
    dueDate: isoDate(p.dueDate, 'dueDate'), priority: oneOf(p.priority, PRIORITIES, 'priority'),
    contactId: id(p.contactId, 'contactId'), dealId: id(p.dealId, 'dealId'),
  }),
  LOG_ACTIVITY: (p) => compact({
    type: oneOf(p.type, ACTIVITY_TYPES, 'type', true), contactId: id(p.contactId, 'contactId', true), dealId: id(p.dealId, 'dealId'),
    subject: str(p.subject, 200, 'subject'), notes: str(p.notes, 4000, 'notes'),
  }),
  UPDATE_DEAL_STAGE: (p) => {
    const payload = compact({
      dealId: id(p.dealId, 'dealId', true), toStage: oneOf(p.toStage, deals.DEAL_STAGES, 'toStage', true), lostReason: str(p.lostReason, 200, 'lostReason'),
    });
    if (payload.toStage === 'CLOSED_LOST' && !payload.lostReason) throw invalid('lostReason is required to mark a deal lost');
    return payload;
  },
  DRAFT_EMAIL: (p) => compact({
    contactId: id(p.contactId, 'contactId', true), dealId: id(p.dealId, 'dealId'),
    subject: str(p.subject, 200, 'subject', true), body: str(p.body, 8000, 'body', true),
  }),
};

/** Validates the payload and checks every referenced record against the user's scope (404 otherwise). */
async function checkPayload(user, type, rawPayload) {
  const schema = SCHEMAS[type];
  if (!schema) throw ApiError.validation([{ path: 'type', msg: 'Unknown action type' }]);
  const payload = schema(rawPayload && typeof rawPayload === 'object' ? rawPayload : {});
  let contactId = payload.contactId ?? null;
  if (payload.dealId) {
    const deal = await assertInScope(user, 'deal', payload.dealId, { contactId: true });
    if (contactId && deal.contactId !== contactId) throw invalid('the deal does not belong to that contact');
    contactId ??= deal.contactId;
  }
  if (payload.contactId) await assertContactInScope(user, payload.contactId);
  return { payload, contactId, dealId: payload.dealId ?? null };
}

/** "Create task “Send pricing” due 27 Oct", for notifications and cards. */
function summarise(type, p) {
  const due = p.dueDate ? ` due ${new Date(p.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '';
  switch (type) {
    case 'CREATE_TASK': return `Create task “${p.title}”${due}`;
    case 'LOG_ACTIVITY': return `Log ${p.type.toLowerCase()}${p.subject ? ` “${p.subject}”` : ''}`;
    case 'UPDATE_DEAL_STAGE': return `Move deal to ${p.toStage.replace('_', ' ').toLowerCase()}`;
    case 'DRAFT_EMAIL': return `Draft email “${p.subject}”`;
    default: return type;
  }
}

/**
 * Stores a proposal as PENDING after validating it and checking scope.
 * @returns {Promise<object|null>} the stored proposal, or null when it is invalid or out of scope
 */
async function propose(user, { type, payload, rationale, source, conversationId = null }) {
  let checked;
  try {
    checked = await checkPayload(user, type, payload);
  } catch (err) {
    logger.info({ event: 'action_proposal_dropped', type, reason: err.meta?.[0]?.msg ?? err.message }, 'AI proposal dropped');
    return null;
  }
  const action = await prisma.aiActionRequest.create({
    data: {
      userId: user.id, type, payload: checked.payload, rationale: rationale ?? null, risk: RISK[type], source, conversationId,
      contactId: checked.contactId, dealId: checked.dealId,
    },
    select: PUBLIC,
  });
  await notify([user.id], {
    type: 'ai_action', title: 'AI suggested an action',
    message: `${summarise(type, checked.payload)}. Approve or reject it in the assistant.`,
    link: conversationId ? `/ai-assistant?c=${conversationId}` : '/ai-assistant',
    data: { actionId: action.id },
  });
  return { ...action, summary: summarise(type, action.payload) };
}

const EXECUTORS = {
  CREATE_TASK: async (user, p) => ({ taskId: (await tasks.createTask(user, p)).id }),
  LOG_ACTIVITY: async (user, p) => ({ activityId: (await activities.logActivity(user, p)).id }),
  UPDATE_DEAL_STAGE: async (user, p) => ({ dealId: (await deals.changeStage(user, p.dealId, { stage: p.toStage, lostReason: p.lostReason })).id }),
  DRAFT_EMAIL: async (user, p) => ({ emailId: (await emails.createEmail(user, { ...p, direction: 'OUTBOUND', aiGenerated: true })).id }),
};

/** PENDING → `status` for the requester only; 409 if it was already decided, 404 if it isn't theirs. */
async function decide(user, actionId, status) {
  const { count } = await prisma.aiActionRequest.updateMany({
    where: { id: actionId, userId: user.id, status: 'PENDING' },
    data: { status, decidedById: user.id, decidedAt: new Date() },
  });
  if (count) return;
  const exists = await prisma.aiActionRequest.findFirst({ where: { id: actionId, userId: user.id }, select: { status: true } });
  if (!exists) throw ApiError.notFound('Action not found');
  throw ApiError.conflict(`This action is already ${exists.status.toLowerCase()}`, 'ACTION_NOT_PENDING');
}

/** Approves and executes. Execution failures are recorded on the action (FAILED), not thrown. */
async function approve(user, actionId, req) {
  await decide(user, actionId, 'APPROVED');
  const action = await prisma.aiActionRequest.findUnique({ where: { id: actionId } });
  await audit(req, { action: 'approve', entityType: 'ai_action', entityId: actionId, after: { type: action.type, payload: action.payload } });

  let update;
  try {
    const { payload } = await checkPayload(user, action.type, action.payload); // the world may have changed since it was proposed
    const result = await EXECUTORS[action.type](user, payload);
    update = { status: 'EXECUTED', executedAt: new Date(), result };
    await audit(req, { action: 'execute', entityType: 'ai_action', entityId: actionId, after: result });
  } catch (err) {
    const message = err.meta?.[0]?.msg ?? err.message ?? 'Execution failed';
    update = { status: 'FAILED', error: String(message).slice(0, 500) };
    await audit(req, { action: 'execute_failed', entityType: 'ai_action', entityId: actionId, after: { error: update.error } });
  }
  const done = await prisma.aiActionRequest.update({ where: { id: actionId }, data: update, select: PUBLIC });
  return { ...done, summary: summarise(done.type, done.payload) };
}

async function reject(user, actionId, note, req) {
  await decide(user, actionId, 'REJECTED');
  const action = await prisma.aiActionRequest.findUnique({ where: { id: actionId }, select: PUBLIC });
  await audit(req, { action: 'reject', entityType: 'ai_action', entityId: actionId, after: { note: note ? String(note).slice(0, 500) : null } });
  return { ...action, summary: summarise(action.type, action.payload) };
}

/** The user's own proposals, newest first (optionally by status or conversation). */
async function list(user, { status, conversationId } = {}) {
  const rows = await prisma.aiActionRequest.findMany({
    where: { userId: user.id, ...(status && { status }), ...(conversationId && { conversationId }) },
    orderBy: { createdAt: 'desc' }, take: 50, select: PUBLIC,
  });
  return rows.map((a) => ({ ...a, summary: summarise(a.type, a.payload) }));
}

module.exports = { RISK, SCHEMAS, checkPayload, summarise, propose, approve, reject, list };
