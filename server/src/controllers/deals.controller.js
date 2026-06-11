/**
 * LeadPulse CRM — Deals Controller
 *
 * Kanban-grouped view, full CRUD, and stage-change with Socket.IO push.
 */

'use strict';

const { prisma }   = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');

const DEAL_STAGES = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];

const DEAL_LIST_INCLUDE = {
  contact: { select: { id: true, firstName: true, lastName: true, email: true } },
  owner:   { select: { id: true, firstName: true, lastName: true } },
};

const DEAL_DETAIL_INCLUDE = {
  contact: {
    include: {
      company: { select: { id: true, name: true } },
    },
  },
  owner:      { select: { id: true, firstName: true, lastName: true, email: true } },
  activities: {
    orderBy: { occurredAt: 'desc' },
    take:    20,
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  },
  tasks: {
    where:   { completed: false },
    orderBy: { dueDate: 'asc' },
    include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
  },
};

function emit(req, event, payload) {
  const io = req.app.get('io');
  if (io) io.emit(event, payload);
}

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
    const where = buildWhere({ search, ownerId, contactId, stage });

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

    // Verify contact exists
    const contact = await prisma.contact.findUnique({
      where: { id: contactId }, select: { id: true },
    });
    if (!contact) throw ApiError.notFound('Contact not found');

    const deal = await prisma.deal.create({
      data: {
        title:            title.trim(),
        value:            value            ? parseFloat(value)         : 0,
        stage:            stage            || 'LEAD',
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
        notes:            notes            || null,
        lostReason:       lostReason       || null,
        contactId,
        ownerId:          req.user.id,
      },
      include: DEAL_LIST_INCLUDE,
    });

    emit(req, 'deal:created', { dealId: deal.id, stage: deal.stage, ownerId: req.user.id });
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
    const deal = await prisma.deal.findUnique({
      where:   { id: req.params.id },
      include: DEAL_DETAIL_INCLUDE,
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

    const deal = await prisma.deal.update({
      where:   { id: req.params.id },
      data,
      include: DEAL_LIST_INCLUDE,
    });

    emit(req, 'deal:updated', { dealId: deal.id });
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

    const deal = await prisma.deal.update({
      where: { id: req.params.id },
      data:  {
        stage,
        // Auto-set win probability when moving to terminal stages
        ...(stage === 'CLOSED_WON'  && { winProbability: 1.0 }),
        ...(stage === 'CLOSED_LOST' && { winProbability: 0.0 }),
      },
      include: DEAL_LIST_INCLUDE,
    });

    // Targeted push to the deal owner's socket room
    const io = req.app.get('io');
    if (io && deal.ownerId) {
      io.to(`user:${deal.ownerId}`).emit('deal:stage_changed', {
        dealId:   deal.id,
        title:    deal.title,
        newStage: deal.stage,
        value:    Number(deal.value),
      });
    }

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
    await prisma.deal.delete({ where: { id: req.params.id } });
    emit(req, 'deal:deleted', { dealId: req.params.id });
    res.json({ success: true, message: 'Deal deleted' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, getOne, update, updateStage, remove };
