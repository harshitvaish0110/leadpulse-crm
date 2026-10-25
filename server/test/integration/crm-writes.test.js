'use strict';

/** Deal stage bookkeeping and task completion through the API. */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, request, prisma, bearer, login, teardown } = require('./helpers');

let sarah, contact;
const created = { deals: [], tasks: [] };

before(async () => {
  sarah = await login('sarah@leadpulse.dev');
  contact = await prisma.contact.findFirstOrThrow({ where: { ownerId: sarah.user.id } });
});

after(async () => {
  await prisma.task.deleteMany({ where: { id: { in: created.tasks } } });
  await prisma.deal.deleteMany({ where: { id: { in: created.deals } } });
  await teardown();
});

const api = (method, url, body) => request(app)[method](url).set(bearer(sarah.token)).send(body);
const history = (dealId) => prisma.dealStageHistory.findMany({ where: { dealId }, orderBy: { changedAt: 'asc' } });

test('a new deal lands in the default column with a history row and ignores client probabilities', async () => {
  const res = await api('post', '/api/deals', { title: 'Stage test', value: '1200', contactId: contact.id, winProbability: 75 }).expect(201);
  const deal = res.body.deal;
  created.deals.push(deal.id);

  const lead = await prisma.pipelineStage.findFirst({ where: { baseStage: 'LEAD' }, orderBy: { position: 'asc' } });
  assert.equal(deal.stage, 'LEAD');
  assert.equal(deal.pipelineStageId, lead.id);
  assert.equal(deal.winProbability, 0);
  assert.equal(deal.closedAt, null);
  const rows = await history(deal.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fromStage, null);
  assert.equal(rows[0].changedById, sarah.user.id);
});

test('closing, reopening and no-op moves keep stage fields and history consistent', async () => {
  const dealId = created.deals[0];

  const won = (await api('patch', `/api/deals/${dealId}/stage`, { stage: 'CLOSED_WON' }).expect(200)).body.deal;
  assert.equal(won.stage, 'CLOSED_WON');
  assert.equal(won.winProbability, 1);
  assert.ok(won.closedAt);
  const wonColumn = await prisma.pipelineStage.findUnique({ where: { id: won.pipelineStageId } });
  assert.equal(wonColumn.baseStage, 'CLOSED_WON');

  await api('patch', `/api/deals/${dealId}/stage`, { stage: 'CLOSED_WON' }).expect(200);
  assert.equal((await history(dealId)).length, 2, 'moving to the same stage adds no history');

  const reopened = (await api('patch', `/api/deals/${dealId}`, { stage: 'PROPOSAL', notes: 'reopened' }).expect(200)).body.deal;
  assert.equal(reopened.stage, 'PROPOSAL');
  assert.equal(reopened.closedAt, null);
  assert.equal(reopened.notes, 'reopened');

  const rows = await history(dealId);
  assert.deepEqual(rows.map((r) => [r.fromStage, r.toStage]), [[null, 'LEAD'], ['LEAD', 'CLOSED_WON'], ['CLOSED_WON', 'PROPOSAL']]);
});

test('invalid stages and values are rejected with 422', async () => {
  const dealId = created.deals[0];
  const bad = await api('patch', `/api/deals/${dealId}/stage`, { stage: 'WON' }).expect(422);
  assert.equal(bad.body.code, 'VALIDATION_ERROR');
  await api('patch', `/api/deals/${dealId}`, { value: -5 }).expect(422);
  await api('patch', `/api/deals/${dealId}/stage`, { pipelineStageId: '00000000-0000-0000-0000-000000000000' }).expect(422);
});

test('tasks can be completed and reopened, including with string flags', async () => {
  const task = (await api('post', '/api/tasks', { title: 'Follow up', contactId: contact.id, priority: 'HIGH' }).expect(201)).body.task;
  created.tasks.push(task.id);
  assert.equal(task.assignedTo.id, sarah.user.id);

  const done = (await api('patch', `/api/tasks/${task.id}/complete`, {}).expect(200)).body.task;
  assert.equal(done.completed, true);
  assert.ok(done.completedAt);

  const reopened = (await api('patch', `/api/tasks/${task.id}/complete`, { completed: 'false' }).expect(200)).body.task;
  assert.equal(reopened.completed, false);
  assert.equal(reopened.completedAt, null);

  await api('post', '/api/tasks', { title: 'x', priority: 'URGENT' }).expect(422);
});
