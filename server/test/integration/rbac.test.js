'use strict';

/**
 * Record-level access: reps see their own book, out-of-scope
 * records are 404, managers see everything, socket events stay in scope.
 */

const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { app, request, prisma, bearer, login, teardown } = require('./helpers');
const { attachSocket, closeSocket } = require('../../src/lib/realtime');

let sarah, emily, raj;
let emilyContact, emilyDeal, emilyActivity;

before(async () => {
  [sarah, emily, raj] = await Promise.all([
    login('sarah@leadpulse.dev'), login('emily@leadpulse.dev'), login('raj@leadpulse.dev'),
  ]);
  emilyContact = await prisma.contact.findFirstOrThrow({ where: { ownerId: emily.user.id } });
  emilyDeal = await prisma.deal.findFirstOrThrow({ where: { ownerId: emily.user.id, contact: { ownerId: emily.user.id } } });
  emilyActivity = await prisma.activity.findFirstOrThrow({ where: { userId: emily.user.id, contact: { ownerId: emily.user.id } } });
});

after(teardown);

const get = (session, url) => request(app).get(url).set(bearer(session.token));

test('a rep lists only their own contacts', async () => {
  const res = await get(sarah, '/api/contacts?limit=100').expect(200);
  const own = await prisma.contact.count({ where: { ownerId: sarah.user.id } });
  assert.equal(res.body.meta.total, own);
  assert.ok(res.body.contacts.every((c) => c.owner?.id === sarah.user.id));
});

test("another rep's records are indistinguishable from missing ones", async () => {
  const contact = await get(sarah, `/api/contacts/${emilyContact.id}`).expect(404);
  assert.equal(contact.body.code, 'NOT_FOUND');
  await get(sarah, `/api/deals/${emilyDeal.id}`).expect(404);
  await get(sarah, `/api/activities/${emilyActivity.id}`).expect(404);

  await request(app).patch(`/api/contacts/${emilyContact.id}`).set(bearer(sarah.token)).send({ title: 'pwned' }).expect(404);
  await request(app).patch(`/api/deals/${emilyDeal.id}/stage`).set(bearer(sarah.token)).send({ stage: 'CLOSED_LOST' }).expect(404);
  await request(app).delete(`/api/contacts/${emilyContact.id}`).set(bearer(sarah.token)).expect(404);
  await request(app).delete(`/api/deals/${emilyDeal.id}`).set(bearer(sarah.token)).expect(404);

  const untouched = await prisma.deal.findUnique({ where: { id: emilyDeal.id } });
  assert.equal(untouched.stage, emilyDeal.stage);
  assert.ok(await prisma.contact.findUnique({ where: { id: emilyContact.id } }));
});

test('AI endpoints apply the same scope', async () => {
  await request(app).post(`/api/ai/deal-summary/${emilyDeal.id}`).set(bearer(sarah.token)).expect(404);
  await request(app).post('/api/ai/compose-email').set(bearer(sarah.token)).send({ contactId: emilyContact.id, bulletPoints: ['Follow up'] }).expect(404);
  await request(app).post(`/api/ai/contact-narrative/${emilyContact.id}`).set(bearer(sarah.token)).expect(404);
  await request(app).post(`/api/ai/lead-score/${emilyContact.id}/explain`).set(bearer(sarah.token)).expect(404);
  await request(app).post(`/api/ai/enrich-contact/${emilyContact.id}/apply`).set(bearer(sarah.token)).send({ fields: { title: 'x' } }).expect(404);
  await request(app).post('/api/ai/next-action').set(bearer(sarah.token)).send({ contactId: emilyContact.id }).expect(404);
  await request(app).post('/api/ai/enrich-contact').set(bearer(sarah.token)).send({ contactId: emilyContact.id }).expect(404);
});

test('writes cannot attach to or assign into another rep\'s book', async () => {
  await request(app).post('/api/activities').set(bearer(sarah.token))
    .send({ type: 'NOTE', contactId: emilyContact.id, notes: 'x' }).expect(404);
  await request(app).post('/api/deals').set(bearer(sarah.token))
    .send({ title: 'x', contactId: emilyContact.id }).expect(404);
  await request(app).post('/api/tasks').set(bearer(sarah.token))
    .send({ title: 'x', contactId: emilyContact.id }).expect(404);
  const owner = await request(app).post('/api/contacts').set(bearer(sarah.token))
    .send({ firstName: 'x', lastName: 'y', email: `rbac+${Date.now()}@example.com`, ownerId: emily.user.id }).expect(403);
  assert.equal(owner.body.code, 'OWNER_NOT_ALLOWED');
});

test('tasks, activities and analytics are scoped for reps', async () => {
  const uid = sarah.user.id;
  const tasks = await get(sarah, '/api/tasks?limit=100').expect(200);
  const taskIds = tasks.body.tasks.map((t) => t.id);
  const inScope = await prisma.task.count({
    where: { id: { in: taskIds }, OR: [{ assignedToId: uid }, { createdById: uid }, { contact: { ownerId: uid } }] },
  });
  assert.equal(inScope, taskIds.length);

  const acts = await get(sarah, `/api/activities?limit=100&contactId=${emilyContact.id}`).expect(200);
  assert.ok(acts.body.activities.every((a) => a.user?.id === uid));

  const overview = await get(sarah, '/api/analytics/overview').expect(200);
  assert.equal(overview.body.stats.totalContacts, await prisma.contact.count({ where: { ownerId: uid } }));

  const reps = await get(sarah, '/api/analytics/rep-performance').expect(200);
  assert.deepEqual(reps.body.reps.map((r) => r.user.id), [uid]);
});

test('CSV export contains only the caller\'s contacts', async () => {
  const res = await get(sarah, '/api/contacts/export').expect(200);
  assert.match(res.headers['content-type'], /text\/csv/);
  const rows = res.text.trim().split('\n').length - 1;
  assert.equal(rows, await prisma.contact.count({ where: { ownerId: sarah.user.id } }));
  assert.ok(!res.text.includes(emilyContact.email));
});

test('managers see every record', async () => {
  await get(raj, `/api/contacts/${emilyContact.id}`).expect(200);
  await get(raj, `/api/deals/${emilyDeal.id}`).expect(200);
  const list = await get(raj, '/api/contacts?limit=1').expect(200);
  assert.equal(list.body.meta.total, await prisma.contact.count());
});

test('role-gated routes', async () => {
  await get(sarah, '/api/users').expect(403);
  await get(raj, '/api/users').expect(403);
  await get(sarah, '/api/settings/integrations').expect(403);
  const dir = await get(sarah, '/api/users/directory').expect(200);
  assert.ok(dir.body.users.length >= 5);
  assert.equal(dir.body.users[0].email, undefined);
  const company = await prisma.company.findFirstOrThrow();
  await request(app).delete(`/api/companies/${company.id}`).set(bearer(sarah.token)).expect(403);
});

test('contact PATCH ignores system-computed fields', async () => {
  const own = await prisma.contact.findFirstOrThrow({ where: { ownerId: sarah.user.id } });
  await request(app).patch(`/api/contacts/${own.id}`).set(bearer(sarah.token))
    .send({ leadScore: 120, churnRisk: 0, title: own.title }).expect(200);
  const after = await prisma.contact.findUnique({ where: { id: own.id } });
  assert.equal(after.leadScore, own.leadScore);
  assert.equal(after.churnRisk, own.churnRisk);
});

test('sockets require a valid token and only receive in-scope events', async () => {
  const server = http.createServer(app);
  attachSocket(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://localhost:${server.address().port}`;
  const open = (token) => new Promise((resolve, reject) => {
    const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (err) => { s.close(); reject(err); });
  });

  try {
    await assert.rejects(open('not-a-token'), (err) => err.data?.code === 'INVALID_TOKEN');

    const [sEmily, sSarah, sRaj] = await Promise.all([open(emily.token), open(sarah.token), open(raj.token)]);
    const received = { emily: 0, sarah: 0, raj: 0 };
    sEmily.on('contact:updated', () => received.emily++);
    sSarah.on('contact:updated', () => received.sarah++);
    sRaj.on('contact:updated', () => received.raj++);

    await request(server).patch(`/api/contacts/${emilyContact.id}`).set(bearer(emily.token))
      .send({ title: emilyContact.title }).expect(200);
    await new Promise((r) => setTimeout(r, 300));

    assert.deepEqual(received, { emily: 1, sarah: 0, raj: 1 });
    [sEmily, sSarah, sRaj].forEach((s) => s.close());
  } finally {
    await closeSocket();
    await new Promise((resolve) => server.close(resolve));
  }
});
