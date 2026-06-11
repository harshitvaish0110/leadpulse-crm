/**
 * LeadPulse CRM — Tasks Controller
 */

'use strict';

const { prisma }   = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');

const TASK_INCLUDE = {
  contact:    { select: { id: true, firstName: true, lastName: true } },
  deal:       { select: { id: true, title: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  createdBy:  { select: { id: true, firstName: true, lastName: true } },
};

/**
 * GET /api/tasks
 * Filter by assignedToId, contactId, dealId, completed, priority, due date range.
 */
async function list(req, res, next) {
  try {
    const {
      page = 1, limit = 25,
      assignedToId, contactId, dealId,
      completed, priority, dueFrom, dueTo,
      sortBy = 'dueDate', sortDir = 'asc',
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * limitNum;

    const where = {
      AND: [
        assignedToId ? { assignedToId } : {},
        contactId    ? { contactId }    : {},
        dealId       ? { dealId }       : {},
        priority     ? { priority }     : {},
        completed !== undefined ? { completed: completed === 'true' } : {},
        dueFrom || dueTo ? {
          dueDate: {
            ...(dueFrom && { gte: new Date(dueFrom) }),
            ...(dueTo   && { lte: new Date(dueTo)   }),
          },
        } : {},
      ],
    };

    const ALLOWED_SORTS = ['dueDate', 'createdAt', 'priority'];
    const orderField = ALLOWED_SORTS.includes(sortBy) ? sortBy : 'dueDate';

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take:    limitNum,
        orderBy: { [orderField]: sortDir === 'desc' ? 'desc' : 'asc' },
        include: TASK_INCLUDE,
      }),
      prisma.task.count({ where }),
    ]);

    res.json({
      success: true,
      tasks,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/tasks
 */
async function create(req, res, next) {
  try {
    const { title, description, dueDate, priority, contactId, dealId, assignedToId } = req.body;

    if (!title) throw ApiError.badRequest('title is required');

    const task = await prisma.task.create({
      data: {
        title:       title.trim(),
        description: description || null,
        dueDate:     dueDate     ? new Date(dueDate) : null,
        priority:    priority    || 'MEDIUM',
        contactId:   contactId   || null,
        dealId:      dealId      || null,
        assignedToId: assignedToId || req.user.id,
        createdById:  req.user.id,
      },
      include: TASK_INCLUDE,
    });

    // Push notification to assigned user
    const io = req.app.get('io');
    if (io && task.assignedToId !== req.user.id) {
      io.to(`user:${task.assignedToId}`).emit('task:assigned', {
        taskId: task.id, title: task.title, dueDate: task.dueDate,
      });
    }

    res.status(201).json({ success: true, task });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/tasks/:id
 */
async function update(req, res, next) {
  try {
    const ALLOWED = ['title', 'description', 'dueDate', 'priority', 'assignedToId', 'contactId', 'dealId'];
    const data = {};
    for (const f of ALLOWED) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }
    if (data.dueDate) data.dueDate = new Date(data.dueDate);

    const task = await prisma.task.update({
      where:   { id: req.params.id },
      data,
      include: TASK_INCLUDE,
    });

    res.json({ success: true, task });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/tasks/:id/complete
 * Marks a task as complete (or incomplete).
 */
async function complete(req, res, next) {
  try {
    const { completed = true } = req.body;
    const isComplete = Boolean(completed);

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data:  {
        completed:   isComplete,
        completedAt: isComplete ? new Date() : null,
      },
      include: TASK_INCLUDE,
    });

    res.json({ success: true, task });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/tasks/:id
 */
async function remove(req, res, next) {
  try {
    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, complete, remove };
