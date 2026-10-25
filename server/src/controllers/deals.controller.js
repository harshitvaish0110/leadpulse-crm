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

const { DEAL_STAGES, DEAL_LIST_INCLUDE } = deals;

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

function buildWhere({ search, ownerId, contactId, companyId, stage }) {
  return {
    AND: [
      search    ? { title: { contains: search, mode: 'insensitive' } } : {},
      ownerId   ? { ownerId }   : {},
      contactId ? { contactId } : {},
      companyId ? { contact: { companyId } } : {},
      stage     ? { stage }     : {},
    ],
  };
}

/**
 * GET /api/deals
 * Supports ?view=kanban (default) or ?view=list
 */
async function list(req, res, next) {
  try {
    const { view = 'kanban', search = '', ownerId, contactId, companyId, stage, page = 1, limit = 50 } = req.query;
    const where = scoped(req.user, 'deal', buildWhere({ search, ownerId, contactId, companyId, stage }));

    if (view === 'kanban') {
      // Parallel fetch all stages — much faster than sequential
      const stageData = await Promise.all(
        DEAL_STAGES.map(async (s) => {
          const deals = await prisma.deal.findMany({
            where:   { ...where, stage: s },
            orderBy: { createdAt: 'desc' },
            include: DEAL_LIST_INCLUDE,
          });
          const totalValue = deals.reduce((sum, d) => sum + Number(d.value), 0);
          return [s, { deals, totalValue, count: deals.length }];
        })
      );

      return res.json({ success: true, kanban: Object.fromEntries(stageData) });
    }

    // List view — paginated
    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * limitNum;

    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        skip,
        take:    limitNum,
        orderBy: { createdAt: 'desc' },
        include: DEAL_LIST_INCLUDE,
      }),
      prisma.deal.count({ where }),
    ]);

    res.json({
      success: true,
      deals,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/deals */
async function create(req, res) {
  res.status(201).json({ success: true, deal: await deals.createDeal(req.user, req.body) });
}

/**
 * GET /api/deals/:id
 */
async function getOne(req, res, next) {
  try {
    const deal = await prisma.deal.findFirst({
      where:   { id: req.params.id, ...scopeFor(req.user, 'deal') },
      include: dealDetailInclude(req.user),
    });

    if (!deal) throw ApiError.notFound('Deal not found');
    res.json({ success: true, deal });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/deals/:id — editable fields, plus `stage` / `pipelineStageId`. */
async function update(req, res) {
  res.json({ success: true, deal: await deals.updateDeal(req.user, req.params.id, req.body) });
}

/** PATCH /api/deals/:id/stage — `{ stage }` or `{ pipelineStageId }`. */
async function updateStage(req, res) {
  const { stage, pipelineStageId } = req.body ?? {};
  res.json({ success: true, deal: await deals.changeStage(req.user, req.params.id, { stage, pipelineStageId }) });
}

/** DELETE /api/deals/:id */
async function remove(req, res) {
  await deals.deleteDeal(req.user, req.params.id);
  res.json({ success: true, message: 'Deal deleted' });
}

module.exports = { list, create, getOne, update, updateStage, remove };
