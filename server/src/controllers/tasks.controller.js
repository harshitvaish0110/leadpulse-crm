/**
 * LeadPulse CRM — Tasks Controller
 *
 * Reads live here; writes are in tasks.service.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { scoped } = require('../middleware/auth.middleware');
const tasks = require('../services/tasks.service');

const { TASK_INCLUDE } = tasks;

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

    const where = scoped(req.user, 'task', {
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
    });

    const ALLOWED_SORTS = ['dueDate', 'createdAt', 'priority'];
    const orderField = ALLOWED_SORTS.includes(sortBy) ? sortBy : 'dueDate';

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take:    limitNum,
        // Tasks without a due date sort last either way.
        orderBy: [
          orderField === 'dueDate'
            ? { dueDate: { sort: sortDir === 'desc' ? 'desc' : 'asc', nulls: 'last' } }
            : { [orderField]: sortDir === 'desc' ? 'desc' : 'asc' },
          { id: 'asc' },
        ],
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

/** POST /api/tasks */
async function create(req, res) {
  res.status(201).json({ success: true, task: await tasks.createTask(req.user, req.body) });
}

/** PATCH /api/tasks/:id */
async function update(req, res) {
  res.json({ success: true, task: await tasks.updateTask(req.user, req.params.id, req.body) });
}

/** PATCH /api/tasks/:id/complete — `{ completed }` (default true). */
async function complete(req, res) {
  res.json({ success: true, task: await tasks.setCompleted(req.user, req.params.id, req.body?.completed) });
}

/** DELETE /api/tasks/:id */
async function remove(req, res) {
  await tasks.deleteTask(req.user, req.params.id);
  res.json({ success: true, message: 'Task deleted' });
}

module.exports = { list, create, update, complete, remove };
