/**
 * LeadPulse — Task writes.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { scopeFor, assertInScope, assertContactInScope, resolveOwnerId } = require('../middleware/auth.middleware');
const { emitToUsers } = require('../lib/realtime');

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

const TASK_INCLUDE = {
  contact:    { select: { id: true, firstName: true, lastName: true } },
  deal:       { select: { id: true, title: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  createdBy:  { select: { id: true, firstName: true, lastName: true } },
};

const invalid = (path, msg) => ApiError.validation([{ path, msg }]);

/** Linked contact/deal must be in the caller's scope; the assignee follows the owner rule. */
async function checkRefs(user, { contactId, dealId, assignedToId }) {
  if (contactId) await assertContactInScope(user, contactId);
  if (dealId) await assertInScope(user, 'deal', dealId);
  return resolveOwnerId(user, assignedToId);
}

function parseDue(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw invalid('dueDate', 'dueDate must be a date');
  return d;
}

function checkPriority(priority) {
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    throw invalid('priority', `priority must be one of: ${PRIORITIES.join(', ')}`);
  }
}

const notifyAssignee = (task, actorId) => {
  if (task.assignedToId !== actorId) {
    emitToUsers([task.assignedToId], 'task:assigned', { taskId: task.id, title: task.title, dueDate: task.dueDate });
  }
};

async function createTask(user, input) {
  const { title, description, priority, contactId, dealId, assignedToId } = input;
  if (!title?.trim()) throw ApiError.badRequest('title is required');
  checkPriority(priority);
  const assignee = (await checkRefs(user, { contactId, dealId, assignedToId })) ?? user.id;

  const task = await prisma.task.create({
    data: {
      title:        title.trim(),
      description:  description || null,
      dueDate:      parseDue(input.dueDate) ?? null,
      priority:     priority || 'MEDIUM',
      contactId:    contactId || null,
      dealId:       dealId || null,
      assignedToId: assignee,
      createdById:  user.id,
    },
    include: TASK_INCLUDE,
  });
  notifyAssignee(task, user.id);
  return task;
}

async function updateTask(user, taskId, input) {
  const data = {};
  for (const f of ['description', 'contactId', 'dealId']) {
    if (input[f] !== undefined) data[f] = input[f] || null;
  }
  if (input.title !== undefined) {
    if (!String(input.title).trim()) throw invalid('title', 'title cannot be empty');
    data.title = String(input.title).trim();
  }
  if (input.priority !== undefined) {
    checkPriority(input.priority);
    data.priority = input.priority;
  }
  const dueDate = parseDue(input.dueDate);
  if (dueDate !== undefined) data.dueDate = dueDate;

  const assignee = await checkRefs(user, { contactId: data.contactId, dealId: data.dealId, assignedToId: input.assignedToId });
  if (input.assignedToId !== undefined && assignee) data.assignedToId = assignee;

  const before = await prisma.task.findFirst({ where: { id: taskId, ...scopeFor(user, 'task') }, select: { assignedToId: true } });
  if (!before) throw ApiError.notFound('Task not found');

  const task = await prisma.task.update({ where: { id: taskId, ...scopeFor(user, 'task') }, data, include: TASK_INCLUDE });
  if (task.assignedToId !== before.assignedToId) notifyAssignee(task, user.id);
  return task;
}

/** `completed` may arrive as a boolean or as the strings "true"/"false". */
async function setCompleted(user, taskId, completed = true) {
  const done = !(completed === false || completed === 'false');
  return prisma.task.update({
    where:   { id: taskId, ...scopeFor(user, 'task') },
    data:    { completed: done, completedAt: done ? new Date() : null },
    include: TASK_INCLUDE,
  });
}

async function deleteTask(user, taskId) {
  await prisma.task.delete({ where: { id: taskId, ...scopeFor(user, 'task') } });
}

module.exports = { PRIORITIES, TASK_INCLUDE, createTask, updateTask, setCompleted, deleteTask };
