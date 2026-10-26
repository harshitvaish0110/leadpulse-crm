/**
 * LeadPulse CRM — AI Controller
 *
 * Loads scoped CRM records, builds a prompt (services/ai/prompts.js) and sends
 * it through the AI gateway, which handles provider fallback, logging and
 * streaming. Every record lookup is scoped to the caller: out of scope is 404.
 * Validation happens before a stream starts, so it fails with a normal JSON error.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const ai = require('../services/ai');
const prompts = require('../services/ai/prompts');
const scoring = require('../services/scoring.service');
const enrichment = require('../services/enrichment.service');
const semanticIndex = require('../services/semanticIndex.service');
const { recommendNextAction } = require('../services/nextAction.service');
const chatService = require('../services/chat.service');
const actionsService = require('../services/actions.service');
const { DEAL_STAGES } = require('../services/deals.service');
const { enqueue } = require('../queues/queue');
const { ApiError } = require('../middleware/error.middleware');
const { scopeFor } = require('../middleware/auth.middleware');

const RECENT_ACTIVITIES = { orderBy: { occurredAt: 'desc' }, select: { type: true, subject: true, notes: true, sentiment: true, occurredAt: true } };
const EMAIL_FIELDS = { direction: true, subject: true, body: true, sentAt: true, receivedAt: true, createdAt: true };
const DEAL_FIELDS = { id: true, title: true, stage: true, value: true, winProbability: true, pipelineStage: { select: { label: true } } };
const invalid = (path, msg) => ApiError.validation([{ path, msg }]);

/** Contact lookup limited to the caller's scope (404 otherwise). */
async function findContact(user, contactId, args) {
  if (!contactId) throw ApiError.badRequest('contactId required');
  const contact = await prisma.contact.findFirst({ where: { id: contactId, ...scopeFor(user, 'contact') }, ...args });
  if (!contact) throw ApiError.notFound('Contact not found');
  return contact;
}

function checkTone(tone, allowed) {
  if (!allowed.includes(tone)) throw invalid('tone', `tone must be one of: ${allowed.join(', ')}`);
  return tone;
}

/** POST /api/ai/chat { conversationId?, question } — SSE: delta…, sources, actions?, done { conversationId, messageId }. */
async function chat(req, res) {
  const question = String(req.body?.question ?? '').trim();
  if (!question) throw ApiError.badRequest('question is required');
  if (question.length > 2000) throw invalid('question', 'question is too long (max 2000 characters)');
  await chatService.ask(req.user, { conversationId: req.body?.conversationId || null, question }, res);
}

/** GET /api/ai/conversations — the caller's own, most recent first. */
async function listConversations(req, res) {
  res.json({ success: true, conversations: await chatService.listConversations(req.user) });
}

/** GET /api/ai/conversations/:id → { conversation: { …, messages, actions } } */
async function getConversation(req, res) {
  res.json({ success: true, conversation: await chatService.getConversation(req.user, req.params.id) });
}

async function deleteConversation(req, res) {
  await chatService.deleteConversation(req.user, req.params.id);
  res.status(204).end();
}

const ACTION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED'];

/** GET /api/ai/actions?status= — the caller's proposals. */
async function listActions(req, res) {
  const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
  if (status && !ACTION_STATUSES.includes(status)) throw invalid('status', `status must be one of: ${ACTION_STATUSES.join(', ')}`);
  res.json({ success: true, actions: await actionsService.list(req.user, { status }) });
}

/** POST /api/ai/actions/:id/approve → { action } (EXECUTED or FAILED); 409 unless PENDING. */
async function approveAction(req, res) {
  res.json({ success: true, action: await actionsService.approve(req.user, req.params.id, req) });
}

/** POST /api/ai/actions/:id/reject { note? } → { action }; 409 unless PENDING. */
async function rejectAction(req, res) {
  res.json({ success: true, action: await actionsService.reject(req.user, req.params.id, req.body?.note, req) });
}

/**
 * POST /api/ai/compose-email { contactId, dealId?, bulletPoints[1..10], tone } — SSE.
 * The text starts with "Subject: …", then a blank line, then the body.
 */
async function composeEmail(req, res) {
  const { contactId, dealId, tone = 'professional' } = req.body ?? {};
  checkTone(tone, prompts.EMAIL_TONES);
  const points = (Array.isArray(req.body?.bulletPoints) ? req.body.bulletPoints : []).map((p) => String(p ?? '').trim()).filter(Boolean);
  if (!points.length || points.length > 10) throw invalid('bulletPoints', 'Give between 1 and 10 points to cover');
  if (points.some((p) => p.length > 300)) throw invalid('bulletPoints', 'Each point can be at most 300 characters');

  const contact = await findContact(req.user, contactId, {
    include: {
      company: { select: { name: true, industry: true } },
      activities: { ...RECENT_ACTIVITIES, take: 3 },
      deals: { where: { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } }, select: DEAL_FIELDS },
    },
  });
  let deal;
  if (dealId) {
    deal = await prisma.deal.findFirst({ where: { id: dealId, contactId: contact.id, ...scopeFor(req.user, 'deal') }, select: DEAL_FIELDS });
    if (!deal) throw ApiError.notFound('Deal not found');
  } else {
    // The most advanced open deal is the one the email is most likely about.
    deal = [...contact.deals].sort((a, b) => DEAL_STAGES.indexOf(b.stage) - DEAL_STAGES.indexOf(a.stage))[0] ?? null;
  }

  await ai.streamToResponse(res, prompts.composeEmail({ contact, deal, points, tone }), {
    log: { userId: req.user.id, contactId: contact.id, dealId: deal?.id ?? null, input: { contactId, dealId: deal?.id ?? null, tone, points } },
  });
}

/** POST /api/ai/deal-summary/:id — SSE: four markdown sections. */
async function dealSummary(req, res) {
  const deal = await prisma.deal.findFirst({
    where: { id: req.params.id, ...scopeFor(req.user, 'deal') },
    include: {
      contact:      { select: { firstName: true, lastName: true, title: true, company: { select: { name: true } } } },
      owner:        { select: { firstName: true, lastName: true } },
      pipelineStage: { select: { label: true } },
      stageHistory: { orderBy: { changedAt: 'asc' }, take: 10, select: { fromStage: true, toStage: true, changedAt: true } },
      activities:   { ...RECENT_ACTIVITIES, take: 10 },
    },
  });
  if (!deal) throw ApiError.notFound('Deal not found');
  const emails = await prisma.emailDraft.findMany({
    where: { OR: [{ dealId: deal.id }, { contactId: deal.contactId }] },
    orderBy: { createdAt: 'desc' }, take: 5, select: EMAIL_FIELDS,
  });

  await ai.streamToResponse(res, prompts.dealSummary({ deal, emails }), {
    log: { userId: req.user.id, dealId: deal.id, contactId: deal.contactId, input: { dealId: deal.id } },
  });
}

/** "0.62 → 0.48 over 90 days", from the contact's sentiment snapshots. */
async function sentimentTrend(contactId) {
  const points = await prisma.scoreSnapshot.findMany({
    where: { entityType: 'contact', entityId: contactId, metric: 'sentimentScore', takenAt: { gte: new Date(Date.now() - 90 * 86_400_000) } },
    orderBy: { takenAt: 'asc' }, select: { value: true, takenAt: true },
  });
  if (points.length < 2) return null;
  const days = Math.round((points.at(-1).takenAt - points[0].takenAt) / 86_400_000);
  return `${points[0].value.toFixed(2)} → ${points.at(-1).value.toFixed(2)} over ${days} days`;
}

/** POST /api/ai/contact-narrative/:id — SSE: the relationship in prose. */
async function contactNarrative(req, res) {
  const contact = await findContact(req.user, req.params.id, {
    include: {
      company: { select: { name: true } },
      owner:   { select: { firstName: true, lastName: true } },
      deals:   { orderBy: { createdAt: 'desc' }, take: 10, select: DEAL_FIELDS },
    },
  });
  const [activities, emailCount, trend] = await Promise.all([
    prisma.activity.findMany({ where: { contactId: contact.id }, ...RECENT_ACTIVITIES, take: 15 }),
    prisma.emailDraft.count({ where: { contactId: contact.id } }),
    sentimentTrend(contact.id),
  ]);

  await ai.streamToResponse(res, prompts.contactNarrative({ contact, activities, emailCount, sentimentTrend: trend }), {
    log: { userId: req.user.id, contactId: contact.id, input: { contactId: contact.id } },
  });
}

/** POST /api/ai/smart-reply { contactId?, emailId, tone } → { reply } for a received email. */
async function smartReply(req, res) {
  const { contactId, emailId, tone = 'professional' } = req.body ?? {};
  checkTone(tone, prompts.REPLY_TONES);
  if (!emailId) throw ApiError.badRequest('emailId is required');

  const email = await prisma.emailDraft.findFirst({
    where: { id: emailId, ...scopeFor(req.user, 'emailDraft'), ...(contactId && { contactId }) },
    include: { contact: { select: { id: true, firstName: true, lastName: true, company: { select: { name: true } } } } },
  });
  if (!email) throw ApiError.notFound('Email not found');
  if (email.direction !== 'INBOUND') throw invalid('emailId', 'Smart replies answer received emails');

  const thread = (await prisma.emailDraft.findMany({
    where: { contactId: email.contactId, createdAt: { lt: email.createdAt } },
    orderBy: { createdAt: 'desc' }, take: 3, select: EMAIL_FIELDS,
  })).reverse();

  const { text, provider } = await ai.getText(prompts.smartReply({ tone, email, thread, contact: email.contact }), {
    log: { userId: req.user.id, contactId: email.contactId, input: { tone, emailId } },
  });
  if (!text) throw new ApiError('The AI returned an empty reply. Please try again.', 502, 'AI_BAD_OUTPUT');
  res.json({ success: true, tone, reply: text, provider });
}

/** POST /api/ai/next-action{/:id} { contactId?, dealId? } → stored { recommendation, generatedAt }. */
async function nextAction(req, res) {
  const body = req.body ?? {};
  const contactId = req.params.id || body.contactId;
  const dealId = body.dealId || null;
  if (!contactId && !dealId) throw ApiError.badRequest('contactId or dealId required');

  const deal = dealId
    ? await prisma.deal.findFirst({ where: { id: dealId, ...scopeFor(req.user, 'deal') }, select: { contactId: true } })
    : null;
  if (dealId && !deal) throw ApiError.notFound('Deal not found');
  const contact = await findContact(req.user, contactId || deal.contactId, { select: { id: true } });
  if (deal && deal.contactId !== contact.id) throw invalid('dealId', 'Deal does not belong to this contact');

  res.json({ success: true, ...(await recommendNextAction(contact.id, { userId: req.user.id, dealId })) });
}

/** POST /api/ai/lead-score/:id/explain → { explanation }: one AI sentence, stored with the fresh score. */
async function explainLeadScore(req, res) {
  const contact = await findContact(req.user, req.params.id, { select: { id: true, firstName: true, lastName: true } });
  const result = await scoring.leadScoreResult(contact.id);
  const { text } = await ai.getText(prompts.leadExplain({ contact, result }), {
    log: { userId: req.user.id, contactId: contact.id, input: { contactId: contact.id, score: result.score, label: result.label } },
  });
  await prisma.contact.update({
    where: { id: contact.id },
    data: { leadScore: result.score, leadScoreLabel: result.label, leadScoreExplanation: text },
  });
  res.json({ success: true, explanation: text, score: result.score, label: result.label });
}

/** POST /api/ai/enrich-contact { contactId, domain? | linkedinUrl? } → a proposal; nothing is saved. */
async function enrichContact(req, res) {
  res.json({ success: true, ...(await enrichment.preview(req.user, req.body ?? {})) });
}

/** POST /api/ai/enrich-contact/:id/apply { fields, domain? } → { contact, company }. */
async function applyEnrichment(req, res) {
  res.json({ success: true, ...(await enrichment.apply(req.user, req.params.id, req.body ?? {}, req)) });
}

/** GET /api/ai/index/status (ADMIN) — index size per record type and the last full rebuild. */
async function indexStatus(_req, res) {
  res.json({ success: true, ...(await semanticIndex.indexStatus()) });
}

/** POST /api/ai/index/rebuild (ADMIN) — queues a full pass; unchanged records are skipped. */
async function rebuildIndex(_req, res) {
  await enqueue('reindex-all', {}, { dedupe: 'reindex-all', attempts: 1 });
  res.status(202).json({ success: true, enqueued: ['reindex-all'] });
}

module.exports = {
  chat, listConversations, getConversation, deleteConversation, listActions, approveAction, rejectAction,
  composeEmail, dealSummary, contactNarrative, smartReply, nextAction, explainLeadScore,
  enrichContact, applyEnrichment, indexStatus, rebuildIndex,
};
