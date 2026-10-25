'use strict';

/**
 * LeadPulse CRM — AI Controller
 * All AI features route through ai.service.js which tries Gemini → Groq → OpenRouter.
 */

const axios      = require('axios');
const { prisma } = require('../lib/prisma');
const ai         = require('../services/ai.service');
const { ApiError } = require('../middleware/error.middleware');
const { scopeFor } = require('../middleware/auth.middleware');

/** Contact lookup limited to the caller's scope (404 otherwise). */
async function findContact(user, contactId, args) {
  if (!contactId) throw ApiError.badRequest('contactId required');
  const contact = await prisma.contact.findFirst({ where: { id: contactId, ...scopeFor(user, 'contact') }, ...args });
  if (!contact) throw ApiError.notFound('Contact not found');
  return contact;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/chat  { question }  (SSE: delta / done / error)
// ─────────────────────────────────────────────────────────────────────────────
async function chat(req, res) {
  const question = String(req.body?.question ?? '').trim();
  if (!question) throw ApiError.badRequest('question is required');
  if (question.length > 2000) throw ApiError.validation([{ path: 'question', msg: 'question is too long (max 2000 characters)' }]);

  // No record context for now: the old ML-side retrieval ignored ownership, so it
  // stays disabled until retrieval is scoped to the caller.
  const system = 'You are a helpful CRM assistant called LeadPulse. The user is asking about their CRM data.';
  await ai.streamResponse(question, system, res);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/compose-email  (non-streaming JSON)
// ─────────────────────────────────────────────────────────────────────────────
async function composeEmail(req, res, next) {
  try {
    const { contactId, context, bulletPoints, tone = 'professional' } = req.body ?? {};
    const notes = Array.isArray(bulletPoints) && bulletPoints.length
      ? bulletPoints.map((b) => `- ${b}`).join('\n')
      : context;
    const contact = await findContact(req.user, contactId, {
      include: {
        company:    { select: { name: true, industry: true } },
        activities: { take: 3, orderBy: { occurredAt: 'desc' }, select: { type: true, notes: true, occurredAt: true } },
      },
    });

    const recentActivity = contact.activities.map(a =>
      `${a.type} on ${a.occurredAt.toISOString().slice(0, 10)}: ${a.notes || '(no notes)'}`
    ).join('\n');

    const prompt = `Write a ${tone} sales email to:
Name: ${contact.firstName} ${contact.lastName}
Title: ${contact.title || 'unknown'}
Company: ${contact.company?.name || 'their company'} (${contact.company?.industry || 'unknown industry'})
Recent interactions:
${recentActivity || 'No recent interactions'}
Points to cover:
${notes || 'none'}

Return JSON only: { "subject": "...", "body": "..." }`;

    const result = await ai.getJSON(prompt, 'You are an expert sales email writer.');
    res.json({ success: true, draft: result });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/deal-summary/:dealId  (SSE streaming)
// ─────────────────────────────────────────────────────────────────────────────
async function dealSummary(req, res, next) {
  try {
    const dealId = req.params.id || req.body?.dealId;
    const deal   = await prisma.deal.findFirst({
      where:   { id: dealId, ...scopeFor(req.user, 'deal') },
      include: {
        contact:    { select: { firstName: true, lastName: true, company: { select: { name: true } } } },
        owner:      { select: { firstName: true, lastName: true } },
        activities: { take: 5, orderBy: { occurredAt: 'desc' }, select: { type: true, notes: true, sentiment: true, occurredAt: true } },
      },
    });
    if (!deal) throw ApiError.notFound('Deal not found');

    const actSummary = deal.activities.map(a =>
      `[${a.type}] ${a.occurredAt.toISOString().slice(0, 10)}: ${a.notes || '(no notes)'} (sentiment: ${a.sentiment || 'unknown'})`
    ).join('\n');

    const prompt = `Summarise this CRM deal for the sales rep in 4 sections:

Deal: ${deal.title}
Value: $${Number(deal.value).toLocaleString()}
Stage: ${deal.stage}
Win Probability: ${Math.round((deal.winProbability ?? 0) * 100)}%
Expected Close: ${deal.expectedCloseDate?.toISOString().slice(0, 10) || 'not set'}
Contact: ${deal.contact?.firstName} ${deal.contact?.lastName} (${deal.contact?.company?.name || 'unknown'})
Owner: ${deal.owner?.firstName} ${deal.owner?.lastName}

Recent Activities:
${actSummary || 'No activities'}

Write:
## Deal Background
(2 sentences)

## Key Concerns
- bullet list of risks

## Last Interaction
(what happened most recently)

## Recommended Talking Points
- bullet list for next call`;

    await ai.streamResponse(prompt, 'You are an expert CRM sales analyst.', res);
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/smart-reply
// ─────────────────────────────────────────────────────────────────────────────
async function smartReply(req, res, next) {
  try {
    const { contactId, tone = 'professional' } = req.body ?? {};
    const emailThread = (req.body?.emailThread ?? req.body?.emailContent ?? '').trim();
    if (!emailThread) throw ApiError.badRequest('emailThread is required');
    if (!['professional', 'casual', 'urgent'].includes(tone)) {
      throw ApiError.validation([{ path: 'tone', msg: 'tone must be professional, casual or urgent' }]);
    }

    let contactContext = '';
    if (contactId) {
      const contact = await findContact(req.user, contactId, {
        select: { firstName: true, lastName: true, company: { select: { name: true } } },
      });
      contactContext = `Replying to: ${contact.firstName} ${contact.lastName} (${contact.company?.name || ''})`;
    }

    const prompt = `Write one ${tone} reply to the latest message in this email thread.
${contactContext}

Email thread:
${emailThread}

Return JSON only: { "reply": "..." }`;

    const result = await ai.getJSON(prompt, `You write ${tone} sales email replies.`);
    res.json({ success: true, tone, reply: result.reply ?? result.replies?.[0] ?? '' });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/next-action/:id  (contactId or dealId)
// ─────────────────────────────────────────────────────────────────────────────
async function nextAction(req, res, next) {
  try {
    const body      = req.body ?? {};
    const contactId = req.params.id || body.contactId;
    const dealId    = body.dealId;

    if (!contactId && !dealId) throw ApiError.badRequest('contactId or dealId required');
    if (dealId) await prisma.deal.findFirstOrThrow({ where: { id: dealId, ...scopeFor(req.user, 'deal') }, select: { id: true } });

    let context = '';
    if (contactId) {
      const contact = await findContact(req.user, contactId, {
        include: {
          company:    { select: { name: true } },
          activities: { take: 5, orderBy: { occurredAt: 'desc' }, select: { type: true, notes: true, occurredAt: true, sentiment: true } },
          deals:      { where: { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } }, select: { title: true, stage: true, value: true } },
        },
      });
      if (contact) {
        context = `Contact: ${contact.firstName} ${contact.lastName} | Status: ${contact.status} | Churn Risk: ${Math.round((contact.churnRisk || 0) * 100)}%
Company: ${contact.company?.name || 'unknown'}
Open Deals: ${contact.deals.map(d => `${d.title} (${d.stage}, $${Number(d.value).toLocaleString()})`).join(', ') || 'none'}
Last 5 activities: ${contact.activities.map(a => `${a.type} on ${a.occurredAt.toISOString().slice(0, 10)}: ${a.sentiment || ''}`).join(', ') || 'none'}`;
      }
    }

    const prompt = `Based on this CRM data, what is the single best next action for the sales rep?

${context}

Return JSON only: { "action": "specific action description", "reason": "why", "urgency": "HIGH|MEDIUM|LOW", "channel": "CALL|EMAIL|MEETING|TASK" }`;

    const result = await ai.getJSON(prompt, 'You are an expert sales coach who recommends precise, actionable next steps.');
    res.json({ success: true, recommendation: result });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/enrich-contact
// ─────────────────────────────────────────────────────────────────────────────
async function enrichContact(req, res, next) {
  try {
    const contact = await findContact(req.user, req.body?.contactId, { include: { company: true } });

    // Clearbit first if configured
    if (process.env.CLEARBIT_API_KEY && contact.email) {
      try {
        const r = await axios.get(
          `https://person.clearbit.com/v2/combined/find?email=${encodeURIComponent(contact.email)}`,
          { headers: { Authorization: `Bearer ${process.env.CLEARBIT_API_KEY}` }, timeout: 10_000 }
        );
        return res.json({ success: true, source: 'clearbit', enriched: {
          title:         r.data.person?.employment?.title,
          linkedinUrl:   r.data.person?.linkedin?.handle ? `https://linkedin.com/in/${r.data.person.linkedin.handle}` : undefined,
          companySize:   r.data.company?.metrics?.employees,
          industry:      r.data.company?.category?.industry,
        }});
      } catch (e) { console.warn('Clearbit failed:', e.message); }
    }

    // Fallback: Gemini suggestion
    const prompt = `Suggest what data a sales rep should research for:
Name: ${contact.firstName} ${contact.lastName}
Email: ${contact.email || 'unknown'}
Title: ${contact.title || 'unknown'}
Company: ${contact.company?.name || 'unknown'}

Return JSON only: { "suggestedTitle": "...", "suggestedIndustry": "...", "suggestedCompanySize": "...", "researchTips": ["..."] }`;

    const result = await ai.getJSON(prompt, 'You are a B2B sales intelligence assistant.');
    res.json({ success: true, source: 'ai-suggestion', enriched: result });
  } catch (err) { next(err); }
}

module.exports = { chat, composeEmail, dealSummary, smartReply, nextAction, enrichContact };
