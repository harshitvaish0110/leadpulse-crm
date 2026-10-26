'use strict';

/**
 * Background-job triggers, the nightly trigger endpoint, readiness, scoped
 * semantic retrieval and the AI endpoints (mock provider) against the real database.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, request, prisma, bearer, login, teardown } = require('./helpers');
const { recorded } = require('../../src/queues/queue');
const { retrieve } = require('../../src/services/semanticIndex.service');

const startedAt = new Date();
const TEST_CHUNK = 900; // index rows written by this file use a chunk index real records never reach
let sarah, mike, raj, admin, sarahContact, mikeContact;
const created = { activities: [] };

before(async () => {
  process.env.AI_MOCK = 'true';
  [sarah, mike, raj, admin] = await Promise.all(['sarah', 'mike', 'raj', 'admin'].map((u) => login(`${u}@leadpulse.dev`)));
  sarahContact = await prisma.contact.findFirstOrThrow({ where: { ownerId: sarah.user.id } });
  mikeContact = await prisma.contact.findFirstOrThrow({ where: { ownerId: mike.user.id } });
});

after(async () => {
  delete process.env.AI_MOCK;
  delete process.env.INTERNAL_JOB_TOKEN;
  await prisma.$executeRaw`DELETE FROM "embeddings" WHERE "chunkIndex" = ${TEST_CHUNK}`;
  await prisma.activity.deleteMany({ where: { id: { in: created.activities } } });
  await prisma.aiLog.deleteMany({ where: { provider: 'mock', createdAt: { gte: startedAt } } });
  await teardown();
});

const as = (who) => ({
  get: (url) => request(app).get(url).set(bearer(who.token)),
  post: (url, body) => request(app).post(url).set(bearer(who.token)).send(body),
  del: (url) => request(app).delete(url).set(bearer(who.token)),
});
const jobsSince = (n) => recorded.slice(n).map((j) => `${j.name}${j.opts.dedupe ? ` ${j.opts.dedupe}` : ''}`);

test('logging an activity queues sentiment, both rescores and reindexing, without waiting for them', async () => {
  const deal = await prisma.deal.findFirstOrThrow({ where: { contactId: sarahContact.id } }).catch(() => null);
  const mark = recorded.length;
  const res = await as(sarah).post('/api/activities', {
    type: 'CALL', contactId: sarahContact.id, dealId: deal?.id, notes: 'Great call, they want a proposal next week.',
  }).expect(201);
  const { id } = res.body.activity;
  created.activities.push(id);

  const jobs = jobsSince(mark);
  assert.ok(jobs.includes(`sentiment sentiment:${id}`));
  assert.ok(jobs.includes(`rescore-contact rescore-contact:${sarahContact.id}`));
  assert.ok(jobs.includes(`reindex-record reindex:activity:${id}`));
  assert.ok(jobs.includes(`reindex-record reindex:contact:${sarahContact.id}`));
  if (deal) assert.ok(jobs.includes(`rescore-deal rescore-deal:${deal.id}`));
  assert.equal(res.body.activity.sentiment, null, 'sentiment arrives later, from the job');

  const del = recorded.length;
  await as(sarah).del(`/api/activities/${id}`).expect(200);
  created.activities.pop();
  assert.ok(jobsSince(del).includes(`rescore-contact rescore-contact:${sarahContact.id}`), 'a delete rescores the contact');
});

test('a note without text queues no sentiment job', async () => {
  const mark = recorded.length;
  const res = await as(sarah).post('/api/activities', { type: 'MEETING', contactId: sarahContact.id }).expect(201);
  created.activities.push(res.body.activity.id);
  assert.ok(!jobsSince(mark).some((j) => j.startsWith('sentiment')));
});

test('POST /internal/jobs/nightly needs the internal token', async () => {
  delete process.env.INTERNAL_JOB_TOKEN;
  await request(app).post('/internal/jobs/nightly').expect(503);

  process.env.INTERNAL_JOB_TOKEN = 'test-internal-token';
  await request(app).post('/internal/jobs/nightly').expect(401);
  await request(app).post('/internal/jobs/nightly').set('X-Internal-Token', 'wrong').expect(401);
  await request(app).post('/internal/jobs/nightly').set(bearer(admin.token)).expect(401); // a user session is not enough

  const mark = recorded.length;
  const res = await request(app).post('/internal/jobs/nightly').set('X-Internal-Token', 'test-internal-token').expect(202);
  assert.deepEqual(res.body.enqueued, ['nightly']);
  const [job] = recorded.slice(mark);
  assert.equal(job.name, 'nightly');
  assert.equal(job.opts.jobId, `nightly-${res.body.date}`, 'one nightly run per day');
});

test('GET /health/ready reports each dependency and is 200 while the database is up', async () => {
  const res = await request(app).get('/health/ready').expect(200);
  assert.equal(res.body.components.database, 'ok');
  assert.ok(['ok', 'degraded'].includes(res.body.status));
  assert.deepEqual(res.body.components.aiProviders, { mock: 'closed' });
  assert.ok(['ok', 'down', 'disabled'].includes(res.body.components.redis));
});

/** A 384-dim unit vector pointing along `axis`. */
const axis = (i) => Array.from({ length: 384 }, (_, k) => (k === i ? 1 : 0));

async function indexRow(recordType, recordId, content, vector) {
  await prisma.$executeRaw`
    INSERT INTO "embeddings" ("id", "recordType", "recordId", "chunkIndex", "content", "contentHash", "vector", "updatedAt")
    VALUES (gen_random_uuid()::text, ${recordType}, ${recordId}, ${TEST_CHUNK}, ${content}, 'test', ${`[${vector.join(',')}]`}::vector, NOW())
    ON CONFLICT ("recordType", "recordId", "chunkIndex") DO NOTHING`;
}

test('semantic retrieval only returns records the caller may see', async () => {
  await indexRow('contact', sarahContact.id, 'zebracorn renewal for sarah', axis(0));
  await indexRow('contact', mikeContact.id, 'zebracorn renewal for mike', axis(1));
  await indexRow('contact', '00000000-0000-0000-0000-000000000000', 'zebracorn renewal for a deleted contact', axis(1));

  const ids = async (who) => (await retrieve(who.user, axis(1), 'zebracorn renewal', 20))
    .filter((r) => r.chunkIndex === TEST_CHUNK).map((r) => r.recordId);

  const forSarah = await ids(sarah);
  assert.ok(forSarah.includes(sarahContact.id), 'her own contact is found by keyword');
  assert.ok(!forSarah.includes(mikeContact.id), "another rep's contact is never returned, even as the closest vector");

  const forRaj = await ids(raj);
  assert.ok(forRaj.includes(mikeContact.id) && forRaj.includes(sarahContact.id), 'managers see every record');
  assert.ok(!forRaj.includes('00000000-0000-0000-0000-000000000000'), 'rows of deleted records are ignored');
});

test('AI endpoints answer through the gateway (mock provider) and log each call', async () => {
  const email = await as(sarah).post('/api/ai/compose-email', { contactId: sarahContact.id, bulletPoints: ['pricing'] }).expect(200);
  assert.ok(email.body.draft.subject && email.body.draft.body);

  await as(sarah).post('/api/ai/compose-email', { contactId: mikeContact.id, bulletPoints: ['x'] }).expect(404);
  await as(sarah).post('/api/ai/compose-email', { contactId: sarahContact.id, tone: 'rude' }).expect(422);

  const action = await as(sarah).post(`/api/ai/next-action/${sarahContact.id}`).expect(200);
  assert.ok(['EMAIL', 'CALL', 'MEETING', 'TASK'].includes(action.body.recommendation.type));

  const log = await prisma.aiLog.findFirst({ where: { feature: 'compose_email', userId: sarah.user.id, createdAt: { gte: startedAt } } });
  assert.equal(log?.provider, 'mock');
  assert.equal(log?.status, 'ok');
});

test('the deal summary streams named SSE events', async () => {
  const deal = await prisma.deal.findFirstOrThrow({ where: { ownerId: sarah.user.id } });
  const res = await as(sarah).post(`/api/ai/deal-summary/${deal.id}`).buffer(true).parse((r, cb) => {
    let body = '';
    r.setEncoding('utf8');
    r.on('data', (c) => { body += c; });
    r.on('end', () => cb(null, body));
  }).expect(200);
  assert.match(res.headers['content-type'], /text\/event-stream/);
  const events = res.body.split('\n\n').filter(Boolean).map((b) => /^event: (.+)$/m.exec(b)?.[1]);
  assert.ok(events.filter((e) => e === 'delta').length > 1);
  assert.equal(events.at(-1), 'done');

  const other = await prisma.deal.findFirstOrThrow({ where: { ownerId: mike.user.id, contact: { ownerId: mike.user.id } } });
  await as(sarah).post(`/api/ai/deal-summary/${other.id}`).expect(404);
});

test('index status and rebuild are admin-only', async () => {
  await as(sarah).get('/api/ai/index/status').expect(403);
  const res = await as(admin).get('/api/ai/index/status').expect(200);
  assert.equal(typeof res.body.types, 'object');

  const mark = recorded.length;
  await as(admin).post('/api/ai/index/rebuild').expect(202);
  assert.deepEqual(jobsSince(mark), ['reindex-all reindex-all']);
});

test('the revenue report includes the weighted pipeline and a forecast status', async () => {
  const res = await as(sarah).get('/api/analytics/revenue').expect(200);
  assert.equal(res.body.pipeline.length, 4, 'this month and three ahead');
  assert.ok(['pending', 'prophet', 'linear', 'unavailable'].includes(res.body.forecastSource));

  const past = await as(sarah).get('/api/analytics/revenue?from=2025-01-01&to=2025-06-30').expect(200);
  assert.equal(past.body.forecastSource, 'none', 'no forecast for a range that ends in the past');
  assert.deepEqual(past.body.pipeline, []);
});
