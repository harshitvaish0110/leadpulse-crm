/**
 * LeadPulse CRM — Deals Controller
 *
 * Kanban-grouped and paginated reads; writes go through deals.service.
 */

'use strict';

const { prisma }   = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { scoped, scopeFor } = require('../middleware/auth.middleware');
const deals = require('../services/deals.service');

const { DEAL_LIST_INCLUDE } = deals;

/** Detail include; activity and task sub-lists follow the caller's own scopes. */
const dealDetailInclude = (user) => ({
  contact: {
    include: {
      company: { select: { id: true, name: true } },
    },
  },
  owner:      { select: { id: true, firstName: true, lastName: true, email: true } },
  pipelineStage: { select: { id: true, label: true, color: true, position: true } },
  activities: {
    where:   scopeFor(user, 'activity'),
    orderBy: { occurredAt: 'desc' },
    take:    20,
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  },
  tasks: {
    where:   { completed: false, ...scopeFor(user, 'task') },
    orderBy: { dueDate: 'asc' },
    include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
  },
});

const DAY_MS = 86_400_000;
const CLOSED = new Set(['CLOSED_WON', 'CLOSED_LOST']);
const SORTABLE = ['createdAt', 'title', 'value', 'winProbability', 'expectedCloseDate', 'stageChangedAt'];
/** Closed columns show their most recent deals; counts and totals still cover all of them. */
const CLOSED_COLUMN_LIMIT = 25;

const withDaysInStage = (deal, now = Date.now()) => ({
  ...deal,
  daysInStage: Math.max(0, Math.floor((now - new Date(deal.stageChangedAt).getTime()) / DAY_MS)),
});

const dayStart = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`) : null);
const dayEnd = (value) => (value ? new Date(`${String(value).slice(0, 10)}T23:59:59.999Z`) : null);

function buildWhere({ search, ownerId, contactId, companyId, stage, minValue, maxValue, closeFrom, closeTo }) {
  const term = String(search ?? '').trim();
  const min = minValue !== undefined && minValue !== '' ? Number(minValue) : null;
  const max = maxValue !== undefined && maxValue !== '' ? Number(maxValue) : null;
  return {
    AND: [
      term ? { OR: [
        { title: { contains: term, mode: 'insensitive' } },
        { contact: { OR: [{ firstName: { contains: term, mode: 'insensitive' } }, { lastName: { contains: term, mode: 'insensitive' } }] } },
      ] } : {},
      ownerId   ? { ownerId }   : {},
      contactId ? { contactId } : {},
      companyId ? { contact: { companyId } } : {},
      stage     ? { stage }     : {},
      Number.isFinite(min) || Number.isFinite(max) ? { value: {
        ...(Number.isFinite(min) && { gte: min }),
        ...(Number.isFinite(max) && { lte: max }),
      } } : {},
      closeFrom || closeTo ? { expectedCloseDate: {
        ...(closeFrom && { gte: dayStart(closeFrom) }),
        ...(closeTo && { lte: dayEnd(closeTo) }),
      } } : {},
    ],
  };
}

/**
 * GET /api/deals
 * ?view=kanban (default): `{ columns: [{ stage, deals, count, totalValue }] }`, one per pipeline stage.
 * ?view=list: paginated, sortable (`sortBy`, `sortDir`).
 */
async function list(req, res) {
  const { view = 'kanban', page = 1, limit = 50, sortBy, sortDir } = req.query;
  const where = scoped(req.user, 'deal', buildWhere(req.query));
  const now = Date.now();

  if (view === 'kanban') {
    const stages = await prisma.pipelineStage.findMany({
      orderBy: { position: 'asc' },
      select:  { id: true, label: true, color: true, baseStage: true, position: true },
    });
    const columns = await Promise.all(stages.map(async (stage) => {
      const inColumn = { AND: [where, { pipelineStageId: stage.id }] };
      const closed = CLOSED.has(stage.baseStage);
      const [items, totals] = await Promise.all([
        prisma.deal.findMany({
          where:   inColumn,
          orderBy: closed ? { closedAt: 'desc' } : { stageChangedAt: 'asc' },
          take:    closed ? CLOSED_COLUMN_LIMIT : undefined,
          include: DEAL_LIST_INCLUDE,
        }),
        prisma.deal.aggregate({ where: inColumn, _count: { _all: true }, _sum: { value: true } }),
      ]);
      return {
        stage,
        deals:      items.map((d) => withDaysInStage(d, now)),
        count:      totals._count._all,
        totalValue: Number(totals._sum.value ?? 0),
      };
    }));
    return res.json({ success: true, columns });
  }

  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const orderBy  = [{ [SORTABLE.includes(sortBy) ? sortBy : 'createdAt']: sortDir === 'asc' ? 'asc' : 'desc' }, { id: 'asc' }];

  const [items, total] = await Promise.all([
    prisma.deal.findMany({ where, skip: (pageNum - 1) * limitNum, take: limitNum, orderBy, include: DEAL_LIST_INCLUDE }),
    prisma.deal.count({ where }),
  ]);

  res.json({
    success: true,
    deals: items.map((d) => withDaysInStage(d, now)),
    meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
  });
}

/** GET /api/deals/:id/history — stage changes, newest first. */
async function history(req, res) {
  const deal = await prisma.deal.findFirst({ where: { id: req.params.id, ...scopeFor(req.user, 'deal') }, select: { id: true } });
  if (!deal) throw ApiError.notFound('Deal not found');
  const rows = await prisma.dealStageHistory.findMany({
    where:   { dealId: deal.id },
    orderBy: { changedAt: 'desc' },
    select: {
      id: true, fromStage: true, toStage: true, fromStageId: true, toStageId: true, changedAt: true,
      changedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  const ids = [...new Set(rows.flatMap((r) => [r.fromStageId, r.toStageId]).filter(Boolean))];
  const labels = Object.fromEntries((await prisma.pipelineStage.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } }))
    .map((s) => [s.id, s.label]));
  res.json({
    success: true,
    history: rows.map(({ fromStageId, toStageId, ...r }) => ({
      ...r, fromLabel: labels[fromStageId] ?? null, toLabel: labels[toStageId] ?? null,
    })),
  });
}

/** POST /api/deals */
async function create(req, res) {
  res.status(201).json({ success: true, deal: await deals.createDeal(req.user, req.body) });
}

/**
 * GET /api/deals/:id
 */
async function getOne(req, res) {
  const deal = await prisma.deal.findFirst({
    where:   { id: req.params.id, ...scopeFor(req.user, 'deal') },
    include: dealDetailInclude(req.user),
  });
  if (!deal) throw ApiError.notFound('Deal not found');
  res.json({ success: true, deal: withDaysInStage(deal) });
}

/** PATCH /api/deals/:id — editable fields, plus `stage` / `pipelineStageId`. */
async function update(req, res) {
  res.json({ success: true, deal: await deals.updateDeal(req.user, req.params.id, req.body) });
}

/** PATCH /api/deals/:id/stage — `{ stage }` or `{ pipelineStageId }`. */
async function updateStage(req, res) {
  const { stage, pipelineStageId, lostReason } = req.body ?? {};
  res.json({ success: true, deal: await deals.changeStage(req.user, req.params.id, { stage, pipelineStageId, lostReason }) });
}

/** DELETE /api/deals/:id */
async function remove(req, res) {
  await deals.deleteDeal(req.user, req.params.id);
  res.json({ success: true, message: 'Deal deleted' });
}

module.exports = { list, create, getOne, history, update, updateStage, remove };
