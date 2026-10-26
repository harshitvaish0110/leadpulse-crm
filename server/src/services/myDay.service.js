/**
 * LeadPulse — My Day: what needs the user today, from their own book.
 *
 * "Their own book" is what a sales rep sees everywhere else: contacts they own,
 * deals they own or whose contact they own, and tasks assigned to them. It is
 * the same for managers and admins, so My Day stays personal while the
 * dashboard shows the team. Days are workspace-local.
 *
 * The briefing is a few AI-written sentences on top of the same data,
 * generated nightly for each active user with something on their plate (or on
 * request) and stored per user per day.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { workspace, money } = require('../lib/workspace');
const { DAY_MS, localDate, startOfDay } = require('../lib/dates');
const ai = require('./ai');
const prompts = require('./ai/prompts');

const OPEN = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION'];
const STALLED_AFTER_DAYS = 14;
const CLOSING_WITHIN_DAYS = 14;
const URGENCY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const fullName = (p) => `${p.firstName} ${p.lastName}`;
const myDeals = (userId) => ({ stage: { in: OPEN }, OR: [{ ownerId: userId }, { contact: { ownerId: userId } }] });

const DEAL_SELECT = {
  id: true, title: true, value: true, stage: true, winProbability: true, expectedCloseDate: true, stageChangedAt: true,
  pipelineStage: { select: { label: true } }, contact: { select: { id: true, firstName: true, lastName: true } },
};

/**
 * @param {{ id: string }} user
 * @param {Date} [now]
 */
async function myDay(user, now = new Date()) {
  const tz = workspace().timezone;
  const date = localDate(now, tz);
  const today = startOfDay(now, tz);
  const tomorrow = startOfDay(new Date(today.getTime() + 1.5 * DAY_MS), tz);
  const horizon = new Date(today.getTime() + 7 * DAY_MS);

  const [tasks, closing, stalled, atRisk, recommended, open, briefing] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: user.id, completed: false, dueDate: { lt: horizon } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 40,
      select: {
        id: true, title: true, dueDate: true, priority: true,
        contact: { select: { id: true, firstName: true, lastName: true } }, deal: { select: { id: true, title: true } },
      },
    }),
    prisma.deal.findMany({
      where: { ...myDeals(user.id), expectedCloseDate: { gte: today, lt: new Date(today.getTime() + CLOSING_WITHIN_DAYS * DAY_MS) } },
      orderBy: [{ expectedCloseDate: 'asc' }, { value: 'desc' }], take: 6, select: DEAL_SELECT,
    }),
    prisma.deal.findMany({
      where: { ...myDeals(user.id), stageChangedAt: { lt: new Date(now.getTime() - STALLED_AFTER_DAYS * DAY_MS) } },
      orderBy: [{ stageChangedAt: 'asc' }, { id: 'asc' }], take: 6, select: DEAL_SELECT,
    }),
    prisma.contact.findMany({
      where: { ownerId: user.id, status: { not: 'CHURNED' }, OR: [{ churnRisk: { gt: 0.6 } }, { sentimentScore: { lt: 0.3 } }] },
      orderBy: [{ churnRisk: 'desc' }, { id: 'asc' }], take: 6,
      select: { id: true, firstName: true, lastName: true, churnRisk: true, sentimentScore: true, company: { select: { name: true } } },
    }),
    prisma.contact.findMany({
      where: { ownerId: user.id, status: { in: ['LEAD', 'ACTIVE'] }, nextBestActionAt: { not: null } },
      orderBy: [{ leadScore: 'desc' }, { id: 'asc' }], take: 20,
      select: { id: true, firstName: true, lastName: true, leadScore: true, nextBestAction: true, nextBestActionAt: true, company: { select: { name: true } } },
    }),
    prisma.deal.findMany({ where: myDeals(user.id), select: { value: true, winProbability: true } }),
    prisma.dailyBriefing.findUnique({ where: { userId_date: { userId: user.id, date } }, select: { content: true, provider: true, createdAt: true } }),
  ]);

  const taskItem = (t) => ({
    id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority,
    contact: t.contact && { id: t.contact.id, name: fullName(t.contact) }, deal: t.deal,
  });
  const dealItem = (d) => ({
    id: d.id, title: d.title, value: Number(d.value), stage: d.pipelineStage?.label ?? d.stage, winProbability: d.winProbability,
    expectedCloseDate: d.expectedCloseDate, daysInStage: Math.floor((now - d.stageChangedAt) / DAY_MS),
    contact: { id: d.contact.id, name: fullName(d.contact) },
  });
  const nextActions = recommended
    .filter((c) => c.nextBestAction?.action)
    .sort((a, b) => (URGENCY_RANK[a.nextBestAction.urgency] ?? 1) - (URGENCY_RANK[b.nextBestAction.urgency] ?? 1) || b.leadScore - a.leadScore)
    .slice(0, 5)
    .map((c) => ({ contact: { id: c.id, name: fullName(c), company: c.company?.name ?? null }, recommendation: c.nextBestAction, generatedAt: c.nextBestActionAt }));

  return {
    date,
    tasks: {
      overdue: tasks.filter((t) => t.dueDate < today).map(taskItem),
      today: tasks.filter((t) => t.dueDate >= today && t.dueDate < tomorrow).map(taskItem),
      upcoming: tasks.filter((t) => t.dueDate >= tomorrow).map(taskItem),
    },
    closing: closing.map(dealItem),
    stalled: stalled.map(dealItem),
    atRisk: atRisk.map((c) => ({ id: c.id, name: fullName(c), company: c.company?.name ?? null, churnRisk: c.churnRisk, sentimentScore: c.sentimentScore })),
    nextActions,
    pipeline: {
      count: open.length,
      value: open.reduce((t, d) => t + Number(d.value), 0),
      weighted: open.reduce((t, d) => t + Number(d.value) * d.winProbability, 0),
    },
    briefing,
  };
}

const hasAnything = (day) => day.tasks.overdue.length + day.tasks.today.length + day.tasks.upcoming.length
  + day.closing.length + day.stalled.length + day.atRisk.length + day.nextActions.length > 0;

/** The facts the briefing is written from: a count per kind and its top three, one line each. */
function briefingFacts(day) {
  const line = (label, items, fmt) => (items.length
    ? `${label}: ${items.length}${items.length > 3 ? ', the top 3' : ''}: ${items.slice(0, 3).map(fmt).join('; ')}`
    : `${label}: none`);
  const due = (t) => `"${t.title}"${t.contact ? ` (${t.contact.name})` : ''}${t.priority === 'HIGH' ? ', high priority' : ''}`;
  return [
    line('Overdue tasks', day.tasks.overdue, (t) => `${due(t)}, due ${t.dueDate.toISOString().slice(0, 10)}`),
    line('Tasks due today', day.tasks.today, due),
    `Tasks due in the next 7 days: ${day.tasks.upcoming.length}`,
    line(`Deals expected to close within ${CLOSING_WITHIN_DAYS} days`, [...day.closing].sort((a, b) => b.value - a.value),
      (d) => `"${d.title}" with ${d.contact.name}, ${money(d.value)}, ${Math.round(d.winProbability * 100)}% win probability, closes ${d.expectedCloseDate.toISOString().slice(0, 10)}`),
    line(`Deals with no stage change for ${STALLED_AFTER_DAYS}+ days`, day.stalled, (d) => `"${d.title}" (${d.stage}, ${d.daysInStage} days, ${money(d.value)})`),
    line('Accounts at risk', day.atRisk, (c) => `${c.name}${c.company ? ` at ${c.company}` : ''} (churn risk ${Math.round(c.churnRisk * 100)}%)`),
    line('Recommended next steps', day.nextActions, (a) => `${a.contact.name}: ${a.recommendation.action}`),
    `Open pipeline: ${day.pipeline.count} deals, ${money(day.pipeline.value)} (weighted ${money(day.pipeline.weighted)})`,
  ].join('\n');
}

/**
 * Writes (or rewrites) today's briefing for `user`. Null when there is nothing to brief.
 * @returns {Promise<{ content: string, provider: string, createdAt: Date }|null>}
 */
async function generateBriefing(user, now = new Date()) {
  const day = await myDay(user, now);
  if (!hasAnything(day)) return null;
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: workspace().timezone }).format(now);
  const { text, provider } = await ai.getText(
    prompts.dailyBriefing({ userName: user.firstName, today: `${weekday} ${day.date}`, facts: briefingFacts(day) }),
    { log: { userId: user.id, input: { date: day.date } } },
  );
  return prisma.dailyBriefing.upsert({
    where: { userId_date: { userId: user.id, date: day.date } },
    create: { userId: user.id, date: day.date, content: text, provider },
    update: { content: text, provider, createdAt: new Date() },
    select: { content: true, provider: true, createdAt: true },
  });
}

/** Nightly: one briefing per active user, spaced out for free-tier rate limits; stops when the AI is unavailable. */
async function generateBriefings({ spacingMs = 6000, now = new Date() } = {}) {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, firstName: true }, orderBy: { createdAt: 'asc' } });
  let written = 0;
  let skipped = 0;
  for (const [i, user] of users.entries()) {
    if (i && written) await new Promise((resolve) => { setTimeout(resolve, spacingMs); });
    try {
      if (await generateBriefing(user, now)) written += 1;
      else skipped += 1;
    } catch (err) {
      if (['AI_UNAVAILABLE', 'AI_NOT_CONFIGURED'].includes(err.code)) return { users: users.length, written, skipped, stopped: err.code };
      logger.warn({ event: 'briefing_failed', userId: user.id, err: err.message }, 'Briefing failed');
    }
  }
  return { users: users.length, written, skipped };
}

module.exports = { myDay, generateBriefing, generateBriefings, briefingFacts, STALLED_AFTER_DAYS };
