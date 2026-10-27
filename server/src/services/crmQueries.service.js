/**
 * LeadPulse — Structured queries for the assistant.
 *
 * Text search can't answer "deals over 100k closing this month": that needs a
 * filter. The model picks from four tools and fills in parameters; everything
 * it returns is checked here (unknown tools and parameters are dropped,
 * numbers clamped, dates parsed), and every query runs inside the caller's
 * scope, so a plan can only narrow what the user may already see.
 *
 *   deals            filter and sort deals
 *   contacts         filter and sort contacts
 *   tasks            open tasks by due window
 *   pipeline_summary deal count, value and weighted value grouped by stage, owner or month
 *
 * Results become numbered records for the answer: one header per query that
 * states the filters and the complete count and totals, then one record per
 * row (at most 10, marked `fromQuery`), so each row can be cited and linked.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { money } = require('../lib/workspace');
const { DAY_MS, dayBoundary, startOfDay, localDate } = require('../lib/dates');
const { scoped } = require('../middleware/auth.middleware');

const OPEN = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION'];
const STAGES = [...OPEN, 'CLOSED_WON', 'CLOSED_LOST'];
const STATUSES = ['LEAD', 'ACTIVE', 'INACTIVE', 'CHURNED'];
const LABELS = ['HOT', 'WARM', 'COLD'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
const MAX_ROWS = 10;

const pct = (p) => `${Math.round((p ?? 0) * 100)}%`;
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'not set');
const name = (p) => (p ? `${p.firstName} ${p.lastName}` : 'unassigned');

// ── Parameter checks: anything that doesn't fit is dropped ───────────────────────

const num = (v, min, max) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : undefined);
const pick = (v, allowed) => {
  const s = String(v ?? '').toUpperCase();
  return allowed.includes(s) ? s : undefined;
};
const picks = (v, allowed) => {
  const list = (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => pick(x, allowed)).filter(Boolean);
  return list.length ? [...new Set(list)] : undefined;
};
const word = (v, max = 60) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const choice = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** One query from the model, checked; null when it isn't a known tool. */
function checkQuery(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const limit = num(raw.limit, 1, MAX_ROWS) ?? MAX_ROWS;
  switch (raw.tool) {
    case 'deals':
      return compact({
        tool: 'deals',
        status: choice(raw.status, ['open', 'won', 'lost', 'any'], 'open'),
        stages: picks(raw.stages, STAGES),
        minValue: num(raw.minValue, 0, 1e12),
        maxValue: num(raw.maxValue, 0, 1e12),
        closeFrom: date(raw.closeFrom),
        closeTo: date(raw.closeTo),
        minWinProbability: num(raw.minWinProbability, 0, 1),
        maxWinProbability: num(raw.maxWinProbability, 0, 1),
        stalledDays: num(raw.stalledDays, 1, 3650),
        company: word(raw.company),
        owner: word(raw.owner),
        sort: choice(raw.sort, ['value', 'closeDate', 'winProbability', 'stalled'], 'value'),
        limit,
      });
    case 'contacts':
      return compact({
        tool: 'contacts',
        statuses: picks(raw.statuses ?? raw.status, STATUSES),
        scoreLabels: picks(raw.scoreLabels ?? raw.scoreLabel, LABELS),
        minLeadScore: num(raw.minLeadScore, 0, 120),
        minChurnRisk: num(raw.minChurnRisk, 0, 1),
        maxSentiment: num(raw.maxSentiment, 0, 1),
        noContactDays: num(raw.noContactDays, 1, 3650),
        tag: word(raw.tag, 40),
        company: word(raw.company),
        owner: word(raw.owner),
        sort: choice(raw.sort, ['leadScore', 'churnRisk', 'sentiment', 'newest'], 'leadScore'),
        limit,
      });
    case 'tasks':
      return compact({
        tool: 'tasks',
        due: choice(raw.due, ['overdue', 'today', 'week', 'any'], 'any'),
        priorities: picks(raw.priorities ?? raw.priority, PRIORITIES),
        mine: raw.mine === true ? true : undefined,
        company: word(raw.company),
        owner: word(raw.owner),
        limit,
      });
    case 'pipeline_summary':
      return compact({
        tool: 'pipeline_summary',
        groupBy: choice(raw.groupBy, ['stage', 'owner', 'month'], 'stage'),
        status: choice(raw.status, ['open', 'won', 'lost'], 'open'),
        closeFrom: date(raw.closeFrom),
        closeTo: date(raw.closeTo),
        company: word(raw.company),
        owner: word(raw.owner),
      });
    default:
      return null;
  }
}

/** At most two checked queries from a plan `{ queries: [...] }`. */
const checkPlan = (plan) => (Array.isArray(plan?.queries) ? plan.queries.map(checkQuery).filter(Boolean).slice(0, 2) : []);

// ── Running them ───────────────────────────────────────────────────────────────

/** Ids of users whose name contains `owner` (null when no owner filter). */
async function ownerIds(owner) {
  if (!owner) return null;
  const terms = owner.split(/\s+/).filter(Boolean);
  const users = await prisma.user.findMany({
    where: { AND: terms.map((t) => ({ OR: [{ firstName: { contains: t, mode: 'insensitive' } }, { lastName: { contains: t, mode: 'insensitive' } }] })) },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

const range = (from, to, tz) => (from || to ? compact({ gte: from && dayBoundary(from, tz), lt: to && dayBoundary(to, tz, { end: true }) }) : undefined);

function describe(q) {
  const bits = [];
  if (q.stages) bits.push(`in stage ${q.stages.join(' or ')}`);
  if (q.minValue !== undefined) bits.push(`worth at least ${money(q.minValue)}`);
  if (q.maxValue !== undefined) bits.push(`worth at most ${money(q.maxValue)}`);
  if (q.closeFrom || q.closeTo) bits.push(`${q.status === 'won' || q.status === 'lost' ? 'closed' : 'expected to close'} ${q.closeFrom ?? '…'} to ${q.closeTo ?? '…'}`);
  if (q.minWinProbability !== undefined) bits.push(`win probability ≥ ${pct(q.minWinProbability)}`);
  if (q.maxWinProbability !== undefined) bits.push(`win probability ≤ ${pct(q.maxWinProbability)}`);
  if (q.stalledDays) bits.push(`unchanged stage for ${q.stalledDays}+ days`);
  if (q.statuses) bits.push(`status ${q.statuses.join(' or ')}`);
  if (q.scoreLabels) bits.push(`lead score ${q.scoreLabels.join(' or ')}`);
  if (q.minLeadScore !== undefined) bits.push(`lead score ≥ ${q.minLeadScore}`);
  if (q.minChurnRisk !== undefined) bits.push(`churn risk ≥ ${pct(q.minChurnRisk)}`);
  if (q.maxSentiment !== undefined) bits.push(`sentiment ≤ ${q.maxSentiment}`);
  if (q.noContactDays) bits.push(`no activity in ${q.noContactDays}+ days`);
  if (q.tag) bits.push(`tagged "${q.tag}"`);
  if (q.priorities) bits.push(`priority ${q.priorities.join(' or ')}`);
  if (q.mine) bits.push('assigned to the user');
  if (q.company) bits.push(`at a company whose name contains "${q.company}"`);
  if (q.owner) bits.push(`owned by "${q.owner}"`);
  return bits.length ? ` ${bits.join(', ')}` : '';
}

/** Records of a contact at a company whose name contains `company` (case-insensitive). */
const atCompany = (company) => (company ? { company: { name: { contains: company, mode: 'insensitive' } } } : undefined);

const header = (q, text) => ({ recordType: 'query', recordId: q.tool, content: `Query result (complete, straight from the database): ${text}` });
const listed = (shown, total, order) => (shown ? `The ${shown === total ? `${shown}` : `first ${shown} of the ${total}`} listed next are sorted by ${order}.` : 'None match.');

async function runDeals(user, q, ctx) {
  const owners = await ownerIds(q.owner);
  const closedBy = q.status === 'won' || q.status === 'lost' ? 'closedAt' : 'expectedCloseDate';
  const stage = q.stages ?? { open: OPEN, won: ['CLOSED_WON'], lost: ['CLOSED_LOST'], any: STAGES }[q.status];
  const where = scoped(user, 'deal', compact({
    stage: { in: stage },
    value: q.minValue !== undefined || q.maxValue !== undefined ? compact({ gte: q.minValue, lte: q.maxValue }) : undefined,
    [closedBy]: range(q.closeFrom, q.closeTo, ctx.tz),
    winProbability: q.minWinProbability !== undefined || q.maxWinProbability !== undefined
      ? compact({ gte: q.minWinProbability, lte: q.maxWinProbability }) : undefined,
    stageChangedAt: q.stalledDays ? { lte: new Date(ctx.now.getTime() - q.stalledDays * DAY_MS) } : undefined,
    contact: atCompany(q.company),
    ownerId: owners ? { in: owners } : undefined,
  }));
  const orderBy = {
    value: [{ value: 'desc' }], closeDate: [{ [closedBy]: 'asc' }], winProbability: [{ winProbability: 'desc' }], stalled: [{ stageChangedAt: 'asc' }],
  }[q.sort];
  const [rows, all] = await Promise.all([
    prisma.deal.findMany({
      where, orderBy: [...orderBy, { id: 'asc' }], take: q.limit,
      select: {
        id: true, title: true, value: true, stage: true, winProbability: true, expectedCloseDate: true, closedAt: true, stageChangedAt: true,
        contactId: true, pipelineStage: { select: { label: true } }, owner: { select: { firstName: true, lastName: true } },
        contact: { select: { firstName: true, lastName: true, company: { select: { name: true } } } },
      },
    }),
    prisma.deal.findMany({ where, select: { value: true, winProbability: true } }),
  ]);
  const total = all.reduce((t, d) => t + Number(d.value), 0);
  const weighted = all.reduce((t, d) => t + Number(d.value) * d.winProbability, 0);
  const sortText = { value: 'value, highest first', closeDate: 'close date, soonest first', winProbability: 'win probability, highest first', stalled: 'time in stage, longest first' }[q.sort];
  return [
    header(q, `${q.status === 'any' ? 'all' : q.status} deals${describe(q)}: ${all.length} match, total value ${money(total)}, weighted by win probability ${money(weighted)}. `
      + listed(rows.length, all.length, sortText)),
    ...rows.map((d) => ({
      recordType: 'deal', recordId: d.id, contactId: d.contactId, fromQuery: true,
      content: `Deal "${d.title}" with ${name(d.contact)}${d.contact.company ? ` (${d.contact.company.name})` : ''}: stage ${d.pipelineStage?.label ?? d.stage} (${d.stage}), `
        + `value ${money(d.value)}, win probability ${pct(d.winProbability)}, ${d.closedAt ? `closed ${day(d.closedAt)}` : `expected close ${day(d.expectedCloseDate)}`}, `
        + `${Math.floor((ctx.now - d.stageChangedAt) / DAY_MS)} days in stage, owner ${name(d.owner)}.`,
    })),
  ];
}

async function runContacts(user, q, ctx) {
  const owners = await ownerIds(q.owner);
  const where = scoped(user, 'contact', compact({
    status: q.statuses ? { in: q.statuses } : undefined,
    leadScoreLabel: q.scoreLabels ? { in: q.scoreLabels } : undefined,
    leadScore: q.minLeadScore !== undefined ? { gte: q.minLeadScore } : undefined,
    churnRisk: q.minChurnRisk !== undefined ? { gte: q.minChurnRisk } : undefined,
    sentimentScore: q.maxSentiment !== undefined ? { lte: q.maxSentiment } : undefined,
    activities: q.noContactDays ? { none: { occurredAt: { gte: new Date(ctx.now.getTime() - q.noContactDays * DAY_MS) } } } : undefined,
    tags: q.tag ? { has: q.tag } : undefined,
    ...atCompany(q.company),
    ownerId: owners ? { in: owners } : undefined,
  }));
  const orderBy = { leadScore: { leadScore: 'desc' }, churnRisk: { churnRisk: 'desc' }, sentiment: { sentimentScore: 'asc' }, newest: { createdAt: 'desc' } }[q.sort];
  const [rows, count] = await Promise.all([
    prisma.contact.findMany({
      where, orderBy: [orderBy, { id: 'asc' }], take: q.limit,
      select: {
        id: true, firstName: true, lastName: true, title: true, status: true, leadScore: true, leadScoreLabel: true, churnRisk: true, sentimentScore: true, tags: true,
        company: { select: { name: true } }, owner: { select: { firstName: true, lastName: true } },
        activities: { orderBy: { occurredAt: 'desc' }, take: 1, select: { occurredAt: true, type: true } },
      },
    }),
    prisma.contact.count({ where }),
  ]);
  return [
    header(q, `contacts${describe(q)}: ${count} match. ${listed(rows.length, count, { sentiment: 'sentiment, lowest first', newest: 'date added, newest first', churnRisk: 'churn risk, highest first', leadScore: 'lead score, highest first' }[q.sort])}`),
    ...rows.map((c) => ({
      recordType: 'contact', recordId: c.id, contactId: c.id, fromQuery: true,
      content: `Contact ${name(c)}${c.title ? `, ${c.title}` : ''}${c.company ? ` at ${c.company.name}` : ''}: status ${c.status}, lead score ${c.leadScore}${c.leadScoreLabel ? ` (${c.leadScoreLabel})` : ''}, `
        + `churn risk ${pct(c.churnRisk)}, sentiment ${c.sentimentScore.toFixed(2)}, last activity ${c.activities[0] ? `${day(c.activities[0].occurredAt)} (${c.activities[0].type})` : 'none'}, `
        + `owner ${name(c.owner)}${c.tags.length ? `, tags ${c.tags.join(', ')}` : ''}.`,
    })),
  ];
}

async function runTasks(user, q, ctx) {
  const owners = await ownerIds(q.owner);
  const today = startOfDay(ctx.now, ctx.tz);
  const tomorrow = dayBoundary(localDate(ctx.now, ctx.tz), ctx.tz, { end: true });
  const dueDate = {
    overdue: { lt: today }, today: { gte: today, lt: tomorrow }, week: { gte: today, lt: new Date(today.getTime() + 7 * DAY_MS) }, any: undefined,
  }[q.due];
  const where = scoped(user, 'task', compact({
    completed: false,
    dueDate,
    priority: q.priorities ? { in: q.priorities } : undefined,
    contact: atCompany(q.company),
    assignedToId: q.mine ? user.id : owners ? { in: owners } : undefined,
  }));
  const [rows, count] = await Promise.all([
    prisma.task.findMany({
      where, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: q.limit,
      select: {
        id: true, title: true, dueDate: true, priority: true, contactId: true,
        assignedTo: { select: { firstName: true, lastName: true } }, contact: { select: { firstName: true, lastName: true } }, deal: { select: { title: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);
  const window = { overdue: 'overdue', today: 'due today', week: 'due in the next 7 days', any: '' }[q.due];
  return [
    header(q, `open tasks ${window}${describe(q)}: ${count} match. ${listed(rows.length, count, 'due date, soonest first')}`),
    ...rows.map((t) => ({
      recordType: 'task', recordId: t.id, contactId: t.contactId ?? undefined, fromQuery: true,
      content: `Task "${t.title}": due ${day(t.dueDate)}, priority ${t.priority}, assigned to ${name(t.assignedTo)}`
        + `${t.contact ? `, about ${name(t.contact)}` : ''}${t.deal ? `, deal "${t.deal.title}"` : ''}.`,
    })),
  ];
}

async function runSummary(user, q, ctx) {
  const owners = await ownerIds(q.owner);
  const closedBy = q.status === 'open' ? 'expectedCloseDate' : 'closedAt';
  const deals = await prisma.deal.findMany({
    where: scoped(user, 'deal', compact({
      stage: { in: { open: OPEN, won: ['CLOSED_WON'], lost: ['CLOSED_LOST'] }[q.status] },
      [closedBy]: range(q.closeFrom, q.closeTo, ctx.tz),
      contact: atCompany(q.company),
      ownerId: owners ? { in: owners } : undefined,
    })),
    select: { value: true, winProbability: true, stage: true, expectedCloseDate: true, closedAt: true, owner: { select: { firstName: true, lastName: true } } },
  });
  const keyOf = {
    stage: (d) => d.stage,
    owner: (d) => name(d.owner),
    month: (d) => (d[closedBy] ? localDate(d[closedBy], ctx.tz).slice(0, 7) : 'no date'),
  }[q.groupBy];
  const groups = new Map();
  for (const d of deals) {
    const g = groups.get(keyOf(d)) ?? { count: 0, value: 0, weighted: 0 };
    g.count += 1;
    g.value += Number(d.value);
    g.weighted += Number(d.value) * d.winProbability;
    groups.set(keyOf(d), g);
  }
  const order = q.groupBy === 'stage' ? STAGES : [...groups.keys()].sort();
  const lines = order.filter((k) => groups.has(k)).map((k) => {
    const g = groups.get(k);
    return `${k}: ${g.count} deals, ${money(g.value)}${q.status === 'open' ? ` (weighted ${money(g.weighted)})` : ''}`;
  });
  const total = deals.reduce((t, d) => t + Number(d.value), 0);
  return [header(q, `${q.status} deals${describe(q)} grouped by ${q.groupBy === 'month' ? `${q.status === 'open' ? 'expected close' : 'close'} month` : q.groupBy}: `
    + `${lines.join('; ') || 'none'}. Overall ${deals.length} deals, ${money(total)}.`)];
}

const RUNNERS = { deals: runDeals, contacts: runContacts, tasks: runTasks, pipeline_summary: runSummary };

/**
 * Runs checked queries for `user`.
 * @param {object} user
 * @param {object[]} queries  output of checkPlan
 * @param {{ now?: Date, tz: string }} ctx
 * @returns {Promise<{ recordType: string, recordId: string, content: string, contactId?: string }[]>}
 */
async function runQueries(user, queries, { now = new Date(), tz }) {
  const results = await Promise.all(queries.map((q) => RUNNERS[q.tool](user, q, { now, tz })));
  return results.flat();
}

module.exports = { checkQuery, checkPlan, runQueries, MAX_ROWS };
