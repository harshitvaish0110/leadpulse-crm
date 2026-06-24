'use strict';

/**
 * LeadPulse CRM — AI Controller (Google Gemini)
 * All AI features use gemini-2.5-flash via the shared claude.service.js.
 */

const axios      = require('axios');
const { prisma } = require('../lib/prisma');
const ai         = require('../services/claude.service');

const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';

const SSE_HEADERS = {
  'Content-Type':  'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection':    'keep-alive',
};

function sseWrite(res, data, end = false) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (end) res.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/chat?question=...&history=[]
// ─────────────────────────────────────────────────────────────────────────────
async function chat(req, res) {
  const question = (req.query.question || '').trim();
  const history  = req.query.history  || '[]';

  Object.entries(SSE_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_URL || '*');
  res.flushHeaders?.();

  if (!question) {
    sseWrite(res, { error: 'No question provided', done: true, sources: [] }, true);
    return;
  }

  try {
    const response = await axios({
      method:       'get',
      url:          `${ML_URL}/rag/query`,
      params:       { question, history },
      responseType: 'stream',
      timeout:      60_000,
    });
    response.data.pipe(res);
    response.data.on('end', () => res.end());
  } catch (err) {
    // ML service unavailable — fall back to Gemini directly with no context
    const system = 'You are a helpful CRM assistant called LeadPulse. The user is asking about their CRM data.';
    const prompt = question;
    await ai.streamResponse(prompt, system, res);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/compose-email  (non-streaming JSON)
// ─────────────────────────────────────────────────────────────────────────────
async function composeEmail(req, res, next) {
  try {
    const { contactId, context, tone = 'professional' } = req.body;
    if (!contactId) return res.status(400).json({ error: 'contactId required' });

    const contact = await prisma.contact.findUnique({
      where:   { id: contactId },
      include: {
        company:    { select: { name: true, industry: true } },
        activities: { take: 3, orderBy: { occurredAt: 'desc' }, select: { type: true, notes: true, occurredAt: true } },
      },
    });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const recentActivity = contact.activities.map(a =>
      `${a.type} on ${a.occurredAt.toISOString().slice(0, 10)}: ${a.notes || '(no notes)'}`
    ).join('\n');

    const prompt = `Write a ${tone} sales email to:
Name: ${contact.firstName} ${contact.lastName}
Title: ${contact.title || 'unknown'}
Company: ${contact.company?.name || 'their company'} (${contact.company?.industry || 'unknown industry'})
Recent interactions:
${recentActivity || 'No recent interactions'}
Additional context: ${context || 'none'}

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
    const dealId = req.params.dealId || req.params.id || req.body.dealId;
    const deal   = await prisma.deal.findUnique({
      where:   { id: dealId },
      include: {
        contact:    { select: { firstName: true, lastName: true, company: { select: { name: true } } } },
        owner:      { select: { firstName: true, lastName: true } },
        activities: { take: 5, orderBy: { occurredAt: 'desc' }, select: { type: true, notes: true, sentiment: true, occurredAt: true } },
      },
    });
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const actSummary = deal.activities.map(a =>
      `[${a.type}] ${a.occurredAt.toISOString().slice(0, 10)}: ${a.notes || '(no notes)'} (sentiment: ${a.sentiment || 'unknown'})`
    ).join('\n');

    const prompt = `Summarise this CRM deal for the sales rep in 4 sections:

Deal: ${deal.title}
Value: $${Number(deal.value).toLocaleString()}
Stage: ${deal.stage}
Win Probability: ${deal.winProbability || 0}%
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
    const { emailContent, contactId, tone = 'professional' } = req.body;
    if (!emailContent) return res.status(400).json({ error: 'emailContent required' });

    let contactContext = '';
    if (contactId) {
      const contact = await prisma.contact.findUnique({
        where:  { id: contactId },
        select: { firstName: true, lastName: true, company: { select: { name: true } } },
      });
      if (contact) {
        contactContext = `Replying to: ${contact.firstName} ${contact.lastName} (${contact.company?.name || ''})`;
      }
    }

    const prompt = `Generate 3 smart reply options for this email.
${contactContext}

Original email:
${emailContent}

Write 3 reply options with different approaches (brief, detailed, question-based).
Return JSON only: { "replies": ["reply1", "reply2", "reply3"] }`;

    const result = await ai.getJSON(prompt, `You write ${tone} sales email replies.`);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/next-action/:id  (contactId or dealId)
// ─────────────────────────────────────────────────────────────────────────────
async function nextAction(req, res, next) {
  try {
    const contactId = req.params.id || req.body.contactId;
    const dealId    = req.body.dealId;

    if (!contactId && !dealId) return res.status(400).json({ error: 'contactId or dealId required' });

    let context = '';
    if (contactId) {
      const contact = await prisma.contact.findUnique({
        where:   { id: contactId },
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
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ error: 'contactId required' });

    const contact = await prisma.contact.findUnique({
      where:   { id: contactId },
      include: { company: true },
    });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    // Clearbit first if configured
    if (process.env.CLEARBIT_API_KEY && contact.email) {
      try {
        const r = await axios.get(
          `https://person.clearbit.com/v2/combined/find?email=${contact.email}`,
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/transcribe  (audio → text stub)
// ─────────────────────────────────────────────────────────────────────────────
async function transcribe(req, res) {
  // Proxy to ML service if available, else return stub
  try {
    const mlRes = await axios.post(`${ML_URL}/transcribe`, req.body, { timeout: 60_000 });
    res.json(mlRes.data);
  } catch {
    res.json({ success: true, transcript: '[Transcription requires the ML service to be running]' });
  }
}

module.exports = { chat, composeEmail, dealSummary, smartReply, nextAction, enrichContact, transcribe };
