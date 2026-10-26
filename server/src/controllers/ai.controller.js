/**
 * LeadPulse CRM — AI Controller
 *
 * Loads scoped CRM records, builds a prompt (services/ai/prompts.js) and sends
 * it through the AI gateway, which handles provider fallback, logging and
 * streaming. Every record lookup is scoped to the caller: out of scope is 404.
 */

'use strict';

const axios = require('axios');
const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const ai = require('../services/ai');
const prompts = require('../services/ai/prompts');
const semanticIndex = require('../services/semanticIndex.service');
const { enqueue } = require('../queues/queue');
const { ApiError } = require('../middleware/error.middleware');
const { scopeFor } = require('../middleware/auth.middleware');

const TONES = ['professional', 'casual', 'urgent'];
const RECENT_ACTIVITIES = { orderBy: { occurredAt: 'desc' }, select: { type: true, notes: true, sentiment: true, occurredAt: true } };

/** Contact lookup limited to the caller's scope (404 otherwise). */
async function findContact(user, contactId, args) {
  if (!contactId) throw ApiError.badRequest('contactId required');
  const contact = await prisma.contact.findFirst({ where: { id: contactId, ...scopeFor(user, 'contact') }, ...args });
  if (!contact) throw ApiError.notFound('Contact not found');
  return contact;
}

function checkTone(tone) {
  if (!TONES.includes(tone)) throw ApiError.validation([{ path: 'tone', msg: `tone must be one of: ${TONES.join(', ')}` }]);
  return tone;
}

/** POST /api/ai/chat { question } — SSE. */
async function chat(req, res) {
  const question = String(req.body?.question ?? '').trim();
  if (!question) throw ApiError.badRequest('question is required');
  if (question.length > 2000) throw ApiError.validation([{ path: 'question', msg: 'question is too long (max 2000 characters)' }]);

  await ai.streamToResponse(res, prompts.chat({ question }), { log: { userId: req.user.id, input: { question } } });
}

/** POST /api/ai/compose-email { contactId, bulletPoints[] | context, tone } → { draft: { subject, body } } */
async function composeEmail(req, res) {
  const { contactId, context, bulletPoints, tone = 'professional' } = req.body ?? {};
  checkTone(tone);
  const points = (Array.isArray(bulletPoints) ? bulletPoints : [context])
    .map((p) => String(p ?? '').trim()).filter(Boolean).slice(0, 10).map((p) => p.slice(0, 300));
  const contact = await findContact(req.user, contactId, {
    include: { company: { select: { name: true, industry: true } }, activities: { ...RECENT_ACTIVITIES, take: 3 } },
  });

  const { data } = await ai.getJSON(prompts.composeEmail({ contact, points, tone }), {
    log: { userId: req.user.id, contactId, input: { contactId, tone, points } },
  });
  res.json({ success: true, draft: data });
}

/** POST /api/ai/deal-summary/:id — SSE. */
async function dealSummary(req, res) {
  const deal = await prisma.deal.findFirst({
    where: { id: req.params.id, ...scopeFor(req.user, 'deal') },
    include: {
      contact:    { select: { firstName: true, lastName: true, company: { select: { name: true } } } },
      owner:      { select: { firstName: true, lastName: true } },
      activities: { ...RECENT_ACTIVITIES, take: 10 },
    },
  });
  if (!deal) throw ApiError.notFound('Deal not found');

  await ai.streamToResponse(res, prompts.dealSummary({ deal }), {
    log: { userId: req.user.id, dealId: deal.id, contactId: deal.contactId, input: { dealId: deal.id } },
  });
}

/** POST /api/ai/smart-reply { emailThread, tone, contactId? } → { reply, tone } */
async function smartReply(req, res) {
  const { contactId, tone = 'professional' } = req.body ?? {};
  checkTone(tone);
  const thread = String(req.body?.emailThread ?? req.body?.emailContent ?? '').trim().slice(0, 8000);
  if (!thread) throw ApiError.badRequest('emailThread is required');

  const contact = contactId
    ? await findContact(req.user, contactId, { select: { firstName: true, lastName: true, company: { select: { name: true } } } })
    : null;

  const { data } = await ai.getJSON(prompts.smartReply({ thread, tone, contact }), {
    log: { userId: req.user.id, contactId: contactId || null, input: { contactId, tone } },
  });
  res.json({ success: true, tone, reply: data.reply });
}

/** POST /api/ai/next-action{/:id} { contactId?, dealId? } → { recommendation } */
async function nextAction(req, res) {
  const body = req.body ?? {};
  const contactId = req.params.id || body.contactId;
  const dealId = body.dealId;
  if (!contactId && !dealId) throw ApiError.badRequest('contactId or dealId required');

  const deal = dealId
    ? await prisma.deal.findFirst({ where: { id: dealId, ...scopeFor(req.user, 'deal') }, select: { title: true, stage: true, value: true, winProbability: true, contactId: true } })
    : null;
  if (dealId && !deal) throw ApiError.notFound('Deal not found');

  const contact = await findContact(req.user, contactId || deal.contactId, {
    include: {
      company:    { select: { name: true } },
      activities: { ...RECENT_ACTIVITIES, take: 5 },
      deals:      { where: { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } }, select: { title: true, stage: true, value: true } },
    },
  });

  const { data } = await ai.getJSON(prompts.nextAction({ contact, deal }), {
    log: { userId: req.user.id, contactId: contact.id, dealId: dealId || null, input: { contactId: contact.id, dealId } },
  });
  res.json({ success: true, recommendation: data });
}

/** POST /api/ai/enrich-contact { contactId } — Clearbit when configured, otherwise AI suggestions. */
async function enrichContact(req, res) {
  const contact = await findContact(req.user, req.body?.contactId, { include: { company: true } });

  if (process.env.CLEARBIT_API_KEY && contact.email) {
    try {
      const r = await axios.get(
        `https://person.clearbit.com/v2/combined/find?email=${encodeURIComponent(contact.email)}`,
        { headers: { Authorization: `Bearer ${process.env.CLEARBIT_API_KEY}` }, timeout: 10_000 },
      );
      return res.json({ success: true, source: 'clearbit', enriched: {
        title:       r.data.person?.employment?.title,
        linkedinUrl: r.data.person?.linkedin?.handle ? `https://linkedin.com/in/${r.data.person.linkedin.handle}` : undefined,
        companySize: r.data.company?.metrics?.employees,
        industry:    r.data.company?.category?.industry,
      } });
    } catch (err) {
      logger.warn({ event: 'clearbit_failed', err: err.message }, 'Clearbit lookup failed; using AI suggestions');
    }
  }

  const { data } = await ai.getJSON(prompts.enrichSuggestions({ contact }), {
    log: { userId: req.user.id, contactId: contact.id, input: { contactId: contact.id } },
  });
  res.json({ success: true, source: 'ai-suggestion', enriched: data });
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

module.exports = { chat, composeEmail, dealSummary, smartReply, nextAction, enrichContact, indexStatus, rebuildIndex };
