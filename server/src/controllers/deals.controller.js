/**
 * LeadPulse CRM — Deals Controller
 *
 * Kanban-grouped view, full CRUD, and stage-change with Socket.IO push.
 */

'use strict';

const { prisma }   = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { scoped, scopeFor, assertContactInScope, resolveOwnerId } = require('../middleware/auth.middleware');
const { emitScoped } = require('../lib/realtime');

const DEAL_STAGES = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];

const DEAL_LIST_INCLUDE = {
  contact: { select: { id: true, firstName: true, lastName: true, email: true, ownerId: true } },
  owner:   { select: { id: true, firstName: true, lastName: true } },
};

/** Detail include; activity and task sub-lists follow the caller's own scopes. */
const dealDetailInclude = (user) => ({
  contact: {
    include: {
      company: { select: { id: true, name: true } },
    },
  },
  owner:      { select: { id: true, firstName: true, lastName: true, email: true } },
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

/** Deal events go to the deal owner, the contact owner and managers. */
const emitDeal = (deal, event, payload) => emitScoped([deal.ownerId, deal.contact?.ownerId], event, payload);

function buildWhere({ search, ownerId, contactId, stage }) {
  return {
    AND: [
      search    ? { title: { contains: search, mode: 'insensitive' } } : {},
      ownerId   ? { ownerId }   : {},
      contactId ? { contactId } : {},
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
    const { view = 'kanban', search = '', ownerId, contactId, stage, page = 1, limit = 50 } = req.query;
    const where = scoped(req.user, 'deal', buildWhere({ search, ownerId, contactId, stage }));

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

/**
 * POST /api/deals
 */
async function create(req, res, next) {
  try {
    const { title, value, stage, contactId, expectedCloseDate, notes, lostReason } = req.body;

    if (!title || !contactId) throw ApiError.badRequest('title and contactId are required');
    if (stage && !DEAL_STAGES.includes(stage)) {
      throw ApiError.badRequest(`stage must be one of: ${DEAL_STAGES.join(', ')}`);
    }

    await assertContactInScope(req.user, contactId);
    const ownerId = (await resolveOwnerId(req.user, req.body.ownerId)) ?? req.user.id;

    const deal = await prisma.deal.create({
      data: {
        title:            title.trim(),
        value:            value            ? parseFloat(value)         : 0,
        stage:            stage            || 'LEAD',
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
        notes:            notes            || null,
        lostReason:       lostReason       || null,
        contactId,
        ownerId,
      },
      include: DEAL_LIST_INCLUDE,
    });

    emitDeal(deal, 'deal:created', { dealId: deal.id, stage: deal.stage });
    res.status(201).json({ success: true, deal });
  } catch (err) {
    next(err);
  }
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

/**
 * PATCH /api/deals/:id
 */
async function update(req, res, next) {
  try {
    const ALLOWED = [
      'title', 'value', 'stage', 'winProbability', 'expectedCloseDate',
      'lostReason', 'notes', 'ownerId',
    ];
    const data = {};
    for (const f of ALLOWED) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }
    if (data.value)             data.value             = parseFloat(data.value);
    if (data.winProbability)    data.winProbability    = parseFloat(data.winProbability);
    if (data.expectedCloseDate) data.expectedCloseDate = new Date(data.expectedCloseDate);
    if (data.stage && !DEAL_STAGES.includes(data.stage)) {
      throw ApiError.badRequest(`Invalid stage: ${data.stage}`);
    }
    if ('ownerId' in data) data.ownerId = await resolveOwnerId(req.user, data.ownerId);

    const deal = await prisma.deal.update({
      where:   { id: req.params.id, ...scopeFor(req.user, 'deal') },
      data,
      include: DEAL_LIST_INCLUDE,
    });

    emitDeal(deal, 'deal:updated', { dealId: deal.id });
    res.json({ success: true, deal });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/deals/:id/stage
 * Dedicated stage-change endpoint — emits targeted Socket.IO event to deal owner.
 */
async function updateStage(req, res, next) {
  try {
    const { stage } = req.body;
    if (!stage || !DEAL_STAGES.includes(stage)) {
      throw ApiError.badRequest(`stage must be one of: ${DEAL_STAGES.join(', ')}`);
    }

    const where = { id: req.params.id, ...scopeFor(req.user, 'deal') };
    const before = await prisma.deal.findFirst({ where, select: { stage: true } });
    if (!before) throw ApiError.notFound('Deal not found');

    const deal = await prisma.deal.update({
      where,
      data:  {
        stage,
        // Auto-set win probability when moving to terminal stages
        ...(stage === 'CLOSED_WON'  && { winProbability: 1.0 }),
        ...(stage === 'CLOSED_LOST' && { winProbability: 0.0 }),
      },
      include: DEAL_LIST_INCLUDE,
    });

    emitDeal(deal, 'deal:stage_changed', {
      dealId:    deal.id,
      title:     deal.title,
      fromStage: before.stage,
      toStage:   deal.stage,
      value:     Number(deal.value),
    });

    res.json({ success: true, deal });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/deals/:id
 */
async function remove(req, res, next) {
  try {
    const deal = await prisma.deal.delete({
      where:  { id: req.params.id, ...scopeFor(req.user, 'deal') },
      select: { id: true, ownerId: true, contact: { select: { ownerId: true } } },
    });
    emitDeal(deal, 'deal:deleted', { dealId: deal.id });
    res.json({ success: true, message: 'Deal deleted' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, getOne, update, updateStage, remove };
