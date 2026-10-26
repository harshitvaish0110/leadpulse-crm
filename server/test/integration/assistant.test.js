'use strict';

/**
 * The assistant (scoped retrieval, conversations, proposals), the approval gate,
 * call-recording uploads and the audit log, through the mock provider.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, request, prisma, bearer, login, teardown } = require('./helpers');
const { recorded } = require('../../src/queues/queue');
const actions = require('../../src/services/actions.service');
const transcription = require('../../src/services/transcription.service');
const prompts = require('../../src/services/ai/prompts');

const startedAt = new Date();
const TEST_CHUNK = 901;
const TOKEN = 'quokkafoo';
let sarah, mike, admin, sarahContact, mikeContact;
const created = { tasks: [], activities: [], conversations: [] };

before(async () => {
  process.env.AI_MOCK = 'true';
  [sarah, mike, admin] = await Promise.all(['sarah', 'mike', 'admin'].map((u) => login(`${u}@leadpulse.dev`)));
  sarahContact = await prisma.contact.findFirstOrThrow({ where: { ownerId: sarah.user.id } });
  mikeContact = await prisma.contact.findFirstOrThrow({ where: { ownerId: mike.user.id } });
  // Two index rows with the same rare word: one in Sarah's book, one in Mike's.
  for (const [contact, owner] of [[sarahContact, 'sarah'], [mikeContact, 'mike']]) {
    await prisma.$executeRaw`
      INSERT INTO "embeddings" ("id", "recordType", "recordId", "chunkIndex", "content", "contentHash", "updatedAt")
      VALUES (gen_random_uuid()::text, 'contact', ${contact.id}, ${TEST_CHUNK}, ${`${TOKEN} renewal notes for ${owner}`}, 'test', NOW())
      ON CONFLICT ("recordType", "recordId", "chunkIndex") DO NOTHING`;
  }
});

after(async () => {
  delete process.env.AI_MOCK;
  await prisma.$executeRaw`DELETE FROM "embeddings" WHERE "chunkIndex" = ${TEST_CHUNK}`;
  await prisma.task.deleteMany({ where: { id: { in: created.tasks } } });
  await prisma.activity.deleteMany({ where: { id: { in: created.activities } } });
  await prisma.aiConversation.deleteMany({ where: { id: { in: created.conversations } } });
  await prisma.aiActionRequest.deleteMany({ where: { createdAt: { gte: startedAt }, userId: { in: [sarah.user.id, mike.user.id] } } });
  await prisma.notification.deleteMany({ where: { createdAt: { gte: startedAt }, type: { in: ['ai_action', 'transcript'] } } });
  await prisma.aiLog.deleteMany({ where: { provider: 'mock', createdAt: { gte: startedAt } } });
  await teardown();
});

const as = (who) => ({
  get: (url) => request(app).get(url).set(bearer(who.token)),
  post: (url, body) => request(app).post(url).set(bearer(who.token)).send(body),
  del: (url) => request(app).delete(url).set(bearer(who.token)),
});

async function ask(who, question, conversationId) {
  const res = await request(app).post('/api/ai/chat').set(bearer(who.token)).send({ question, conversationId }).buffer(true)
    .parse((r, cb) => {
      let raw = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { raw += c; });
      r.on('end', () => cb(null, raw));
    });
  const events = String(res.body).split('\n\n').filter((b) => /^event:/m.test(b))
    .map((b) => ({ event: /^event: (.+)$/m.exec(b)[1], data: JSON.parse(/^data: (.+)$/m.exec(b)[1]) }));
  const data = (name) => events.find((e) => e.event === name)?.data;
  const result = {
    status: res.status, names: events.map((e) => e.event),
    text: events.filter((e) => e.event === 'delta').map((e) => e.data.text).join(''),
    sources: data('sources')?.sources ?? [], actions: data('actions')?.actions ?? [], done: data('done'),
  };
  if (result.done) created.conversations.push(result.done.conversationId);
  return result;
}

test('a rep\'s answer only ever cites records in their own book', async () => {
  const answer = await ask(sarah, `What is the ${TOKEN} renewal status?`);
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.names.slice(-2), ['sources', 'done']);
  const ids = answer.sources.map((s) => s.id);
  assert.ok(ids.includes(sarahContact.id), 'her own record is cited');
  assert.ok(!ids.includes(mikeContact.id), "another rep's record never is");

  const manager = await ask(admin, `What is the ${TOKEN} renewal status?`);
  assert.ok(manager.sources.some((s) => s.id === mikeContact.id), 'admins search the whole org');
});

test('with nothing relevant the assistant says so without calling the model', async () => {
  const before = await prisma.aiLog.count({ where: { feature: 'chat', userId: sarah.user.id } });
  const answer = await ask(sarah, 'zxqvbn wqzrty plover?');
  assert.equal(answer.text, prompts.NO_ANSWER);
  assert.deepEqual(answer.sources, []);
  assert.equal(await prisma.aiLog.count({ where: { feature: 'chat', userId: sarah.user.id } }), before, 'no LLM call');
});

test('conversations are stored per user and continue across questions', async () => {
  const first = await ask(sarah, `Tell me about ${TOKEN}`);
  const id = first.done.conversationId;
  await ask(sarah, `And the ${TOKEN} renewal?`, id);

  const list = await as(sarah).get('/api/ai/conversations').expect(200);
  assert.ok(list.body.conversations.some((c) => c.id === id && c.title === `Tell me about ${TOKEN}`));
  const detail = await as(sarah).get(`/api/ai/conversations/${id}`).expect(200);
  assert.deepEqual(detail.body.conversation.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);

  await as(mike).get(`/api/ai/conversations/${id}`).expect(404);
  await as(mike).post('/api/ai/chat', { question: 'hi', conversationId: id }).expect(404);
  await as(mike).del(`/api/ai/conversations/${id}`).expect(404);
  await as(sarah).del(`/api/ai/conversations/${id}`).expect(204);
  await as(sarah).get(`/api/ai/conversations/${id}`).expect(404);
});

test('a requested action is proposed, runs only once approved, and only once', async () => {
  const answer = await ask(sarah, `Create a follow-up task for the ${TOKEN} renewal`);
  assert.ok(answer.names.includes('actions'));
  const [proposal] = answer.actions;
  assert.equal(proposal.status, 'PENDING');
  assert.equal(proposal.type, 'CREATE_TASK');
  assert.equal((await prisma.contact.findUnique({ where: { id: proposal.payload.contactId } })).ownerId, sarah.user.id, 'one of her contacts');
  assert.equal(await prisma.task.count({ where: { title: 'Follow up', createdAt: { gte: startedAt } } }), 0, 'nothing ran yet');

  await as(mike).post(`/api/ai/actions/${proposal.id}/approve`).expect(404);
  const approved = await as(sarah).post(`/api/ai/actions/${proposal.id}/approve`).expect(200);
  assert.equal(approved.body.action.status, 'EXECUTED');
  created.tasks.push(approved.body.action.result.taskId);
  const task = await prisma.task.findUnique({ where: { id: approved.body.action.result.taskId } });
  assert.equal(task.assignedToId, sarah.user.id);

  const again = await as(sarah).post(`/api/ai/actions/${proposal.id}/approve`).expect(409);
  assert.equal(again.body.code, 'ACTION_NOT_PENDING');
  await as(sarah).post(`/api/ai/actions/${proposal.id}/reject`).expect(409);

  const trail = await prisma.auditLog.findMany({ where: { entityType: 'ai_action', entityId: proposal.id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(trail.map((t) => t.action), ['approve', 'execute']);
});

test('proposals outside the user\'s book are dropped; rejected ones never run', async () => {
  const foreign = await actions.propose(sarah.user, { type: 'CREATE_TASK', payload: { title: 'x', contactId: mikeContact.id }, source: 'chat' });
  assert.equal(foreign, null);

  const proposal = await actions.propose(sarah.user, { type: 'LOG_ACTIVITY', payload: { type: 'NOTE', contactId: sarahContact.id, notes: 'AI note' }, source: 'chat' });
  assert.equal(proposal.risk, 'medium');
  const rejected = await as(sarah).post(`/api/ai/actions/${proposal.id}/reject`, { note: 'not now' }).expect(200);
  assert.equal(rejected.body.action.status, 'REJECTED');
  await as(sarah).post(`/api/ai/actions/${proposal.id}/approve`).expect(409);
  assert.equal(await prisma.activity.count({ where: { notes: 'AI note', contactId: sarahContact.id } }), 0);

  const pending = await as(sarah).get('/api/ai/actions?status=PENDING').expect(200);
  assert.ok(!pending.body.actions.some((a) => a.id === proposal.id));
});

test('an action whose record left the user\'s book fails safely on approval', async () => {
  const deal = await prisma.deal.findFirstOrThrow({ where: { ownerId: sarah.user.id, contact: { ownerId: sarah.user.id }, stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } } });
  const proposal = await actions.propose(sarah.user, { type: 'UPDATE_DEAL_STAGE', payload: { dealId: deal.id, toStage: 'NEGOTIATION' }, source: 'chat' });
  const ownerBefore = deal.ownerId;
  await prisma.deal.update({ where: { id: deal.id }, data: { ownerId: mike.user.id } });
  await prisma.contact.update({ where: { id: deal.contactId }, data: { ownerId: mike.user.id } });
  try {
    const res = await as(sarah).post(`/api/ai/actions/${proposal.id}/approve`).expect(200);
    assert.equal(res.body.action.status, 'FAILED');
    assert.equal((await prisma.deal.findUnique({ where: { id: deal.id } })).stage, deal.stage, 'the stage did not change');
  } finally {
    await prisma.deal.update({ where: { id: deal.id }, data: { ownerId: ownerBefore } });
    await prisma.contact.update({ where: { id: deal.contactId }, data: { ownerId: sarah.user.id } });
  }
});

test('a call recording is stored, queued for transcription and can be retried after a failure', async () => {
  const upload = (who, contactId, type = 'audio/webm') => request(app).post('/api/activities/upload-audio').set(bearer(who.token))
    .field('contactId', contactId).attach('audio', Buffer.from('not really audio'), { filename: 'call.webm', contentType: type });

  await upload(sarah, mikeContact.id).expect(404);
  await upload(sarah, sarahContact.id, 'application/pdf').expect(415);

  const mark = recorded.length;
  const res = await upload(sarah, sarahContact.id).expect(202);
  const { activity } = res.body;
  created.activities.push(activity.id);
  assert.equal(activity.type, 'TRANSCRIPT');
  assert.deepEqual(activity.metadata, { status: 'processing' });
  assert.ok(recorded.slice(mark).some((j) => j.name === 'transcribe' && j.opts.dedupe === `transcribe:${activity.id}`));

  await as(sarah).post(`/api/activities/${activity.id}/retry-transcription`).expect(409); // still processing

  const savedKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    assert.match((await transcription.transcribe(activity.id)).failed, /not configured/);
  } finally {
    if (savedKey !== undefined) process.env.GROQ_API_KEY = savedKey;
  }
  const failed = await prisma.activity.findUnique({ where: { id: activity.id } });
  assert.equal(failed.metadata.status, 'failed');

  const retried = await as(sarah).post(`/api/activities/${activity.id}/retry-transcription`).expect(202);
  assert.equal(retried.body.activity.metadata.status, 'processing');

  const link = await as(sarah).get(`/api/activities/${activity.id}/audio-url`).expect(200);
  const audio = await request(app).get(link.body.url).expect(200);
  assert.equal(String(audio.body), 'not really audio');
  await as(mike).get(`/api/activities/${activity.id}/audio-url`).expect(404);

  await as(sarah).del(`/api/activities/${activity.id}`).expect(200);
  created.activities.pop();
  await request(app).get(link.body.url).expect(404); // the file went with the activity
});

test('the audit log is for admins and filters by record type', async () => {
  await as(sarah).get('/api/audit-logs').expect(403);
  const res = await as(admin).get('/api/audit-logs?entityType=ai_action&limit=5').expect(200);
  assert.ok(res.body.entries.length > 0);
  assert.ok(res.body.entries.every((e) => e.entityType === 'ai_action'));
  assert.ok(res.body.entityTypes.includes('ai_action'));
  assert.equal(res.body.entries[0].actor.id, sarah.user.id);
});
