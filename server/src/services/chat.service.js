/**
 * LeadPulse — The assistant: answers questions from the caller's own CRM records.
 *
 * Each question is stored in a conversation, answered from at most six records
 * found by hybrid search (scoped exactly like the rest of the API), and streamed
 * as SSE: `delta`… `sources` [`actions`] `done`. With no matching record the
 * fixed "I don't have that information" answer is sent without an LLM call.
 * Questions that filter, rank or count ("deals over 100k closing this month")
 * are also turned into checked, scoped database queries (crmQueries), whose
 * complete results come first. Questions about the pipeline as a whole (hottest
 * leads, risk, closing deals) also get a live snapshot of the caller's book. When
 * the user asked for something to be done, the proposed actions are stored as
 * PENDING for them to approve; nothing is executed here.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { sseStart, sseSend, sseEnd, clientGone } = require('../lib/sse');
const { ApiError } = require('../middleware/error.middleware');
const { scoped } = require('../middleware/auth.middleware');
const ai = require('./ai');
const prompts = require('./ai/prompts');
const semanticIndex = require('./semanticIndex.service');
const actions = require('./actions.service');
const crmQueries = require('./crmQueries.service');
const { localDate, orgTimezone } = require('./nightly.service');
const { money } = require('../lib/workspace');

const HISTORY_TURNS = 6;
// Asking for proposals costs a second LLM call, so it only happens for requests to do something.
const WANTS_ACTION = /\b(create|add|log|schedule|remind|move|mark|draft|write|set up|follow[- ]?up|book|update|change)\b/i;

// Questions about the book as a whole, which ranking by text similarity can't answer.
const AGGREGATE = /\b(hot|hottest|top|best|biggest|largest|pipeline|risk|risky|churn|closing|forecast|how many|summar\w*|overview|priorit\w*|stuck|stale)\b/i;
const OPEN_STAGES = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION'];

// Planning queries costs an LLM call, so it only happens when the question names records and a filter, ranking or count.
const RECORDS = /\b(deals?|opportunit\w*|pipeline|contacts?|leads?|customers?|accounts?|people|tasks?|to-?dos?)\b/i;
const FILTERS = /\b(over|under|above|below|more than|less than|at least|between|\d+\s*k\b|\$?\d{3,}|clos\w*|won|lost|due|overdue|today|tomorrow|this (week|month|quarter|year)|next (week|month|quarter)|last (week|month|quarter|year)|q[1-4]|stalled|stuck|no (contact|activity)|haven'?t|inactive|churn\w*|hot|warm|cold|stage|status|owned|which|list|show|top|biggest|largest|highest|lowest|most|least|how many|how much|total|count|sum|average)\b/i;
const wantsQueries = (question) => RECORDS.test(question) && FILTERS.test(question);

const fullName = (p) => `${p.firstName} ${p.lastName}`;
const pct = (p) => `${Math.round((p ?? 0) * 100)}%`;

/** A live summary of the caller's book (the whole org for managers), as one extra record. */
async function pipelineSnapshot(user, today) {
  const person = { id: true, firstName: true, lastName: true, leadScore: true, leadScoreLabel: true, churnRisk: true, sentimentScore: true, company: { select: { name: true } } };
  const soon = new Date(Date.now() + 30 * 86_400_000);
  const [hot, risky, open, closing] = await Promise.all([
    prisma.contact.findMany({ where: scoped(user, 'contact', { status: { in: ['LEAD', 'ACTIVE'] } }), orderBy: { leadScore: 'desc' }, take: 5, select: person }),
    prisma.contact.findMany({
      where: scoped(user, 'contact', { status: { not: 'CHURNED' }, OR: [{ churnRisk: { gt: 0.6 } }, { sentimentScore: { lt: 0.3 } }] }),
      orderBy: { churnRisk: 'desc' }, take: 5, select: person,
    }),
    prisma.deal.findMany({ where: scoped(user, 'deal', { stage: { in: OPEN_STAGES } }), select: { stage: true, value: true, winProbability: true } }),
    prisma.deal.findMany({
      where: scoped(user, 'deal', { stage: { in: OPEN_STAGES }, expectedCloseDate: { gte: new Date(), lte: soon } }),
      orderBy: { expectedCloseDate: 'asc' }, take: 5,
      select: { id: true, title: true, value: true, winProbability: true, stage: true, expectedCloseDate: true, contactId: true },
    }),
  ]);
  const at = (c) => `${fullName(c)}${c.company ? ` (${c.company.name})` : ''}`;
  const byStage = OPEN_STAGES.map((s) => [s, open.filter((d) => d.stage === s)]).filter(([, ds]) => ds.length)
    .map(([s, ds]) => `${s} ${ds.length} (${money(ds.reduce((t, d) => t + Number(d.value), 0))})`).join(', ');
  const content = [
    `Pipeline snapshot of ${user.firstName}'s book, computed live on ${today}.`,
    `Hottest leads and customers by lead score: ${hot.map((c) => `${at(c)} ${c.leadScore} ${c.leadScoreLabel ?? ''}`.trim()).join('; ') || 'none'}.`,
    `At risk (churn risk over 60% or sentiment under 0.3): ${risky.map((c) => `${at(c)} churn ${pct(c.churnRisk)}, sentiment ${c.sentimentScore.toFixed(2)}`).join('; ') || 'none'}.`,
    `Open deals: ${open.length} worth ${money(open.reduce((t, d) => t + Number(d.value), 0))}, weighted by win probability ${money(open.reduce((t, d) => t + Number(d.value) * d.winProbability, 0))}. By stage: ${byStage || 'none'}.`,
    `Expected to close in the next 30 days: ${closing.map((d) => `${d.title} (${d.stage}, ${money(d.value)}, ${pct(d.winProbability)} win probability, ${d.expectedCloseDate.toISOString().slice(0, 10)})`).join('; ') || 'none'}.`,
  ].join('\n');
  // The records it names become source chips too.
  const refs = [...hot, ...risky].map((c) => ({ recordType: 'contact', recordId: c.id }))
    .concat(closing.map((d) => ({ recordType: 'deal', recordId: d.id })));
  return { record: { recordType: 'snapshot', recordId: 'pipeline', content }, refs };
}

/**
 * The records an answer cites as [n] (also 【n】), in citation order; null when it cites none
 * that exist. Citing a query result ("8 tasks are overdue [1]") also brings the rows listed under it.
 */
function citedRecords(answer, chunks) {
  const numbers = [...String(answer).matchAll(/[[【](\d{1,2})[\]】]/g)].map((m) => Number(m[1]) - 1);
  const picked = [];
  for (const i of new Set(numbers)) {
    if (i < 0 || i >= chunks.length) continue;
    picked.push(chunks[i]);
    if (chunks[i].recordType === 'query') for (let j = i + 1; chunks[j]?.fromQuery; j += 1) picked.push(chunks[j]);
  }
  return picked.length ? picked : null;
}

/** Chip data for each retrieved record: what it is, its name and where it links to. */
async function resolveSources(chunks) {
  const ids = (type) => chunks.filter((c) => c.recordType === type).map((c) => c.recordId);
  const [contacts, deals, companies, activities, tasks] = await Promise.all([
    prisma.contact.findMany({ where: { id: { in: ids('contact') } }, select: { id: true, firstName: true, lastName: true } }),
    prisma.deal.findMany({ where: { id: { in: ids('deal') } }, select: { id: true, title: true, contactId: true } }),
    prisma.company.findMany({ where: { id: { in: ids('company') } }, select: { id: true, name: true } }),
    prisma.activity.findMany({
      where: { id: { in: ids('activity') } },
      select: { id: true, type: true, subject: true, occurredAt: true, contactId: true, contact: { select: { firstName: true, lastName: true } } },
    }),
    prisma.task.findMany({ where: { id: { in: ids('task') } }, select: { id: true, title: true, contactId: true } }),
  ]);
  const byKey = new Map([
    ...contacts.map((c) => [`contact:${c.id}`, { type: 'contact', id: c.id, name: fullName(c), contactId: c.id }]),
    ...deals.map((d) => [`deal:${d.id}`, { type: 'deal', id: d.id, name: d.title, contactId: d.contactId }]),
    ...companies.map((c) => [`company:${c.id}`, { type: 'company', id: c.id, name: c.name }]),
    ...activities.map((a) => [`activity:${a.id}`, {
      type: 'activity', id: a.id, contactId: a.contactId,
      name: `${a.subject || a.type.toLowerCase()} · ${fullName(a.contact)} · ${a.occurredAt.toISOString().slice(0, 10)}`,
    }]),
    ...tasks.map((t) => [`task:${t.id}`, { type: 'task', id: t.id, name: t.title, contactId: t.contactId }]),
  ]);
  return chunks.map((c) => byKey.get(`${c.recordType}:${c.recordId}`)).filter(Boolean);
}

/**
 * "2026-10-26 (Monday). Coming days: Tue 2026-10-27, …, Mon 2026-11-02". Models are
 * unreliable at weekday arithmetic, so "next Monday" is resolved from this list.
 */
async function calendarNote(now = new Date(), tz = null) {
  tz ??= await orgTimezone();
  const weekday = (d, style) => new Intl.DateTimeFormat('en-US', { weekday: style, timeZone: tz }).format(d);
  const days = Array.from({ length: 7 }, (_, i) => new Date(now.getTime() + (i + 1) * 86_400_000));
  return `${localDate(now, tz)} (${weekday(now, 'long')}). Coming days: ${days.map((d) => `${weekday(d, 'short')} ${localDate(d, tz)}`).join(', ')}`;
}

/**
 * Asks the model which queries answer the question, then runs the checked ones.
 * A failed plan only means no query results: the answer still uses search.
 */
async function runPlannedQueries(user, { question, history, today, tz, signal, log }) {
  let plan;
  try {
    ({ data: plan } = await ai.getJSON(prompts.planQueries({ question, history, today }), { signal, log }));
  } catch (err) {
    if (!signal.aborted) logger.warn({ event: 'plan_queries_failed', err: err.message }, 'No structured queries for this question');
    return [];
  }
  const queries = crmQueries.checkPlan(plan);
  if (queries.length) logger.info({ event: 'chat_queries', tools: queries.map((q) => q.tool) }, 'Running structured queries');
  return crmQueries.runQueries(user, queries, { tz });
}

/** Streams the answer to one question; validation and conversation lookup happen before the stream starts. */
async function ask(user, { conversationId, question }, res) {
  const conversation = conversationId
    ? await prisma.aiConversation.findFirst({ where: { id: conversationId, userId: user.id } })
    : await prisma.aiConversation.create({ data: { userId: user.id, title: question.slice(0, 60) } });
  if (!conversation) throw ApiError.notFound('Conversation not found');

  const history = (await prisma.aiMessage.findMany({
    where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: HISTORY_TURNS, select: { role: true, content: true },
  })).reverse();
  await prisma.aiMessage.create({ data: { conversationId: conversation.id, role: 'user', content: question } });
  const tz = await orgTimezone();
  const today = await calendarNote(new Date(), tz);
  const log = { userId: user.id, input: { conversationId: conversation.id, question } };

  const signal = clientGone(res);
  sseStart(res);
  try {
    let chunks;
    let snapshotRefs = [];
    try {
      const [hits, queried] = await Promise.all([
        semanticIndex.search(user, question, { limit: 6 }),
        wantsQueries(question) ? runPlannedQueries(user, { question, history, today, tz, signal, log }) : [],
      ]);
      chunks = [...queried, ...hits];
      if (AGGREGATE.test(question)) {
        const snapshot = await pipelineSnapshot(user, today);
        chunks = [...queried, snapshot.record, ...hits];
        snapshotRefs = snapshot.refs;
      }
    } catch (err) {
      logger.error({ event: 'retrieval_failed', err: err.message }, 'Chat retrieval failed');
      sseSend(res, 'error', { code: 'RETRIEVAL_FAILED', message: 'Your CRM data could not be searched right now. Please try again.' });
      return;
    }

    let answer = prompts.NO_ANSWER;
    let provider = null;
    if (chunks.length) {
      try {
        const spec = prompts.chatAnswer({ question, chunks, history, userName: user.firstName ?? 'the user', today });
        ({ text: answer, provider } = await ai.stream(spec, { signal, log }, (text) => sseSend(res, 'delta', { text })));
      } catch (err) {
        if (!signal.aborted) {
          const known = err instanceof ApiError;
          sseSend(res, 'error', { code: known ? err.code : 'AI_UNAVAILABLE', message: known ? err.message : 'The AI service is temporarily unavailable.' });
        }
        return;
      }
    } else {
      sseSend(res, 'delta', { text: answer });
    }

    const answered = !answer.trim().startsWith(prompts.NO_ANSWER.slice(0, 30));
    // Chips for the records the answer cites; every record when it cites none (or the model numbered them oddly).
    const cited = citedRecords(answer, chunks);
    const usedSnapshot = !cited || cited.some((c) => c.recordType === 'snapshot');
    const refs = await resolveSources([...(cited ?? chunks), ...(usedSnapshot ? snapshotRefs : [])]);
    const seen = new Set();
    const sources = answered ? refs.filter((r) => !seen.has(`${r.type}:${r.id}`) && seen.add(`${r.type}:${r.id}`)).slice(0, 12) : [];
    sseSend(res, 'sources', { sources });
    const message = await prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'assistant', content: answer, sources, provider },
    });
    await prisma.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

    const proposed = [];
    if (chunks.length && WANTS_ACTION.test(question) && !signal.aborted) {
      try {
        // Each record carries its contact, so a task or activity can be attached to the right person.
        const contactOf = new Map(refs.map((r) => [`${r.type}:${r.id}`, r.contactId]));
        const records = chunks.map((c) => ({ ...c, contactId: contactOf.get(`${c.recordType}:${c.recordId}`) }));
        const { data } = await ai.getJSON(prompts.proposeActions({ question, answer, records, today }), { signal, log });
        for (const a of data.actions) {
          const stored = await actions.propose(user, { ...a, source: 'chat', conversationId: conversation.id });
          if (stored) proposed.push(stored);
        }
      } catch (err) {
        if (!signal.aborted) logger.warn({ event: 'propose_failed', err: err.message }, 'No actions proposed');
      }
    }
    if (proposed.length) sseSend(res, 'actions', { actions: proposed });
    sseSend(res, 'done', { conversationId: conversation.id, messageId: message.id, provider });
  } finally {
    sseEnd(res);
  }
}

async function listConversations(user) {
  return prisma.aiConversation.findMany({
    where: { userId: user.id }, orderBy: { updatedAt: 'desc' }, take: 50,
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
}

/** A conversation's messages and the actions proposed in it (the caller's own only). */
async function getConversation(user, id) {
  const conversation = await prisma.aiConversation.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true, title: true, createdAt: true, updatedAt: true,
      messages: { orderBy: { createdAt: 'asc' }, select: { id: true, role: true, content: true, sources: true, provider: true, createdAt: true } },
    },
  });
  if (!conversation) throw ApiError.notFound('Conversation not found');
  return { ...conversation, actions: (await actions.list(user, { conversationId: id })).reverse() };
}

async function deleteConversation(user, id) {
  const { count } = await prisma.aiConversation.deleteMany({ where: { id, userId: user.id } });
  if (!count) throw ApiError.notFound('Conversation not found');
}

module.exports = { ask, listConversations, getConversation, deleteConversation, resolveSources, calendarNote, wantsQueries, citedRecords };
