'use strict';

/**
 * Endpoints behind the CRM pages: contact filters, bulk actions, import, export
 * and snapshots; the email workspace; attachments; deal board, list and history;
 * analytics reports; notifications. Everything created here is removed afterwards.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, request, prisma, bearer, login, teardown } = require('./helpers');

const run = Date.now();
const mail = (tag) => `crm-pages+${tag}-${run}@example.com`;
const created = { contacts: new Set(), companies: new Set(), tasks: new Set() };
let sarah, emily, raj, sarahContact, emilyContact, sarahDeal, emilyDeal;

before(async () => {
  [sarah, emily, raj] = await Promise.all([login('sarah@leadpulse.dev'), login('emily@leadpulse.dev'), login('raj@leadpulse.dev')]);
  sarahContact = await prisma.contact.findFirstOrThrow({ where: { ownerId: sarah.user.id }, orderBy: { createdAt: 'asc' } });
  emilyContact = await prisma.contact.findFirstOrThrow({ where: { ownerId: emily.user.id } });
  sarahDeal = await prisma.deal.findFirstOrThrow({ where: { ownerId: sarah.user.id, contactId: sarahContact.id } });
  emilyDeal = await prisma.deal.findFirstOrThrow({ where: { ownerId: emily.user.id, contact: { ownerId: emily.user.id } } });
});

after(async () => {
  await prisma.task.deleteMany({ where: { id: { in: [...created.tasks] } } });
  await prisma.notification.deleteMany({ where: { data: { path: ['run'], equals: run } } });
  await prisma.contact.deleteMany({ where: { OR: [{ id: { in: [...created.contacts] } }, { email: { contains: `-${run}@example.com` } }] } });
  await prisma.company.deleteMany({ where: { id: { in: [...created.companies] } } });
  await teardown();
});

const as = (session) => ({
  get:    (url, query) => request(app).get(url).query(query ?? {}).set(bearer(session.token)),
  post:   (url, body) => request(app).post(url).set(bearer(session.token)).send(body),
  patch:  (url, body) => request(app).patch(url).set(bearer(session.token)).send(body),
  delete: (url) => request(app).delete(url).set(bearer(session.token)),
});

async function newContact(session, tag) {
  const res = await as(session).post('/api/contacts', { firstName: 'Page', lastName: `Test ${tag}`, email: mail(tag) }).expect(201);
  created.contacts.add(res.body.contact.id);
  return res.body.contact;
}

// ── Contacts ────────────────────────────────────────────────────────────────

test('contact list filters by score label and at-risk, and sorts by churn risk', async () => {
  const hot = await as(sarah).get('/api/contacts', { scoreLabel: 'HOT', limit: 100 }).expect(200);
  assert.ok(hot.body.contacts.every((c) => c.leadScoreLabel === 'HOT'));

  const risky = await as(sarah).get('/api/contacts', { atRisk: 'true', limit: 100 }).expect(200);
  assert.ok(risky.body.contacts.every((c) => c.churnRisk > 0.6 || c.sentimentScore < 0.3));

  const sorted = (await as(sarah).get('/api/contacts', { sortBy: 'churnRisk', sortDir: 'desc', limit: 50 }).expect(200)).body.contacts;
  assert.deepEqual(sorted.map((c) => c.churnRisk), [...sorted.map((c) => c.churnRisk)].sort((a, b) => b - a));
});

test('bulk actions are scope-checked and deletes leave an audit snapshot', async () => {
  const [a, b] = [await newContact(sarah, 'bulk-a'), await newContact(sarah, 'bulk-b')];
  const ids = [a.id, b.id, emilyContact.id];

  const tagged = await as(sarah).post('/api/contacts/bulk', { ids, action: 'tag', tag: `Bulk ${run}` }).expect(200);
  assert.deepEqual([tagged.body.updated, tagged.body.skipped], [2, 1]);
  assert.ok((await prisma.contact.findUnique({ where: { id: a.id } })).tags.includes(`Bulk ${run}`));
  assert.ok(!(await prisma.contact.findUnique({ where: { id: emilyContact.id } })).tags.includes(`Bulk ${run}`));

  const untagged = await as(sarah).post('/api/contacts/bulk', { ids: [a.id], action: 'untag', tag: `Bulk ${run}` }).expect(200);
  assert.equal(untagged.body.updated, 1);

  const assign = await as(sarah).post('/api/contacts/bulk', { ids: [a.id], action: 'assign', ownerId: emily.user.id }).expect(403);
  assert.equal(assign.body.code, 'OWNER_NOT_ALLOWED');

  const removed = await as(sarah).post('/api/contacts/bulk', { ids, action: 'delete' }).expect(200);
  assert.deepEqual([removed.body.updated, removed.body.skipped], [2, 1]);
  const logs = await prisma.auditLog.findMany({ where: { action: 'delete', entityId: { in: [a.id, b.id] } } });
  assert.equal(logs.length, 2);
  assert.equal(logs.find((l) => l.entityId === a.id).before.email, a.email);
  assert.ok(await prisma.contact.findUnique({ where: { id: emilyContact.id } }));

  await prisma.tag.deleteMany({ where: { name: `Bulk ${run}` } });
});

test('import creates, fills empty fields only, and reports rows it cannot take', async () => {
  const own = await newContact(sarah, 'import-own');
  const rows = [
    { firstName: 'Imp', lastName: 'New', email: mail('import-new'), company: `Importco ${run}`, tags: 'Inbound;VIP', status: 'active' },
    { firstName: 'Imp', lastName: 'Again', email: mail('import-new') },
    { firstName: 'Changed', lastName: 'Name', email: own.email, phone: '+1 555 0100', title: 'Buyer' },
    { firstName: 'Not', lastName: 'Mine', email: emilyContact.email, phone: '000' },
    { firstName: 'Bad', lastName: 'Status', email: mail('import-bad'), status: 'PROSPECT' },
    { firstName: 'No', lastName: 'Email' },
  ];
  const res = await as(sarah).post('/api/contacts/import', { rows }).expect(200);
  assert.equal(res.body.created, 1);
  assert.equal(res.body.updated, 1);
  assert.deepEqual(res.body.failed.map((f) => f.row), [2, 4, 5, 6]);

  const fresh = await prisma.contact.findUnique({ where: { email: mail('import-new') }, include: { company: true } });
  created.contacts.add(fresh.id);
  created.companies.add(fresh.companyId);
  assert.equal(fresh.ownerId, sarah.user.id);
  assert.equal(fresh.status, 'ACTIVE');
  assert.deepEqual(fresh.tags, ['Inbound', 'VIP']);
  assert.equal(fresh.company.name, `Importco ${run}`);

  const filled = await prisma.contact.findUnique({ where: { id: own.id } });
  assert.equal(filled.firstName, 'Page', 'existing values are kept');
  assert.equal(filled.phone, '+1 555 0100');
  assert.equal((await prisma.contact.findUnique({ where: { id: emilyContact.id } })).phone, emilyContact.phone);
});

test('export honours filters and starts with a UTF-8 BOM', async () => {
  const res = await as(sarah).get('/api/contacts/export', { status: 'LEAD' }).expect(200);
  assert.ok(res.text.startsWith('﻿'));
  const lines = res.text.trim().split('\n').slice(1);
  assert.equal(lines.length, await prisma.contact.count({ where: { ownerId: sarah.user.id, status: 'LEAD' } }));
});

test('snapshots return a scoped, ordered series', async () => {
  const res = await as(sarah).get(`/api/contacts/${sarahContact.id}/snapshots`, { metric: 'churnRisk', days: 365 }).expect(200);
  const times = res.body.points.map((p) => new Date(p.takenAt).getTime());
  assert.ok(times.length > 0);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  await as(sarah).get(`/api/contacts/${emilyContact.id}/snapshots`).expect(404);
  await as(sarah).get(`/api/contacts/${sarahContact.id}/snapshots`, { metric: 'mood' }).expect(422);
});

// ── Email workspace ─────────────────────────────────────────────────────────

test('emails: draft, log received, edit, send once, scoped', async () => {
  const contact = await newContact(sarah, 'email');
  const inbound = await as(sarah).post('/api/emails', { contactId: contact.id, direction: 'INBOUND', subject: 'Question', body: 'Can we talk pricing?' }).expect(201);
  assert.equal(inbound.body.email.status, 'RECEIVED');
  const draft = (await as(sarah).post('/api/emails', { contactId: contact.id, subject: 'Re: Question', body: 'Sure, how about Tuesday?' }).expect(201)).body.email;
  assert.equal(draft.status, 'DRAFT');

  await as(sarah).patch(`/api/emails/${draft.id}`, { body: 'Sure, Tuesday at 10?' }).expect(200);
  const thread = (await as(sarah).get('/api/emails', { contactId: contact.id }).expect(200)).body.emails;
  assert.deepEqual(thread.map((e) => e.direction), ['INBOUND', 'OUTBOUND']);

  const sent = await as(sarah).post(`/api/emails/${draft.id}/send`).expect(200);
  assert.equal(sent.body.email.status, 'SENT');
  assert.ok(sent.body.email.sentAt);
  assert.equal(await prisma.activity.count({ where: { contactId: contact.id, type: 'EMAIL' } }), 1);

  await as(sarah).post(`/api/emails/${draft.id}/send`).expect(409);
  await as(sarah).patch(`/api/emails/${draft.id}`, { body: 'late edit' }).expect(409);

  assert.deepEqual((await as(emily).get('/api/emails', { contactId: contact.id }).expect(200)).body.emails, []);
  await as(emily).delete(`/api/emails/${inbound.body.email.id}`).expect(404);
  await as(emily).post('/api/emails', { contactId: contact.id, body: 'hi' }).expect(404);
  await as(sarah).delete(`/api/emails/${inbound.body.email.id}`).expect(204);
});

// ── Attachments ─────────────────────────────────────────────────────────────

test('attachments upload privately and download only through a valid signed link', async () => {
  const pdf = Buffer.from('%PDF-1.4\n% smoke test attachment\n');
  const up = await request(app).post('/api/attachments').set(bearer(sarah.token))
    .field('dealId', sarahDeal.id).attach('file', pdf, { filename: '../../quote.pdf', contentType: 'application/pdf' }).expect(201);
  const attachment = up.body.attachment;
  assert.equal(attachment.fileName, 'quote.pdf', 'path components in the client file name are dropped');

  const listed = (await as(sarah).get('/api/attachments', { dealId: sarahDeal.id }).expect(200)).body.attachments;
  assert.ok(listed.some((a) => a.id === attachment.id));

  const { url } = (await as(sarah).get(`/api/attachments/${attachment.id}/url`).expect(200)).body;
  const file = await request(app).get(url).buffer(true).parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
  assert.deepEqual(file.body, pdf);
  await request(app).get(url.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64))).expect(403);

  await as(emily).get(`/api/attachments/${attachment.id}/url`).expect(404);
  await request(app).post('/api/attachments').set(bearer(sarah.token))
    .field('dealId', emilyDeal.id).attach('file', pdf, { filename: 'x.pdf', contentType: 'application/pdf' }).expect(404);
  await request(app).post('/api/attachments').set(bearer(sarah.token))
    .field('dealId', sarahDeal.id).attach('file', Buffer.from('<script>'), { filename: 'x.html', contentType: 'text/html' }).expect(422);

  await as(sarah).delete(`/api/attachments/${attachment.id}`).expect(204);
  await request(app).get(url).expect(404);
});

// ── Deals ───────────────────────────────────────────────────────────────────

test('the board has one column per pipeline stage and the list filters and sorts', async () => {
  const board = (await as(raj).get('/api/deals').expect(200)).body.columns;
  assert.equal(board.length, await prisma.pipelineStage.count());
  assert.equal(board.reduce((n, c) => n + c.count, 0), await prisma.deal.count());
  assert.ok(board.flatMap((c) => c.deals).every((d) => Number.isInteger(d.daysInStage)));

  const page = (await as(raj).get('/api/deals', { view: 'list', minValue: 20000, sortBy: 'value', sortDir: 'asc', limit: 30 }).expect(200)).body.deals;
  const values = page.map((d) => Number(d.value));
  assert.ok(values.every((v) => v >= 20000));
  assert.deepEqual(values, [...values].sort((a, b) => a - b));
});

test('deal history lists stage changes with labels, scoped', async () => {
  const history = (await as(sarah).get(`/api/deals/${sarahDeal.id}/history`).expect(200)).body.history;
  assert.ok(history.length >= 1);
  assert.ok(history[0].toLabel);
  await as(sarah).get(`/api/deals/${emilyDeal.id}/history`).expect(404);
});

// ── Analytics ───────────────────────────────────────────────────────────────

test('analytics reports respect date ranges and return 0-1 rates', async () => {
  const funnel = (await as(raj).get('/api/analytics/funnel').expect(200)).body.baseStages;
  assert.deepEqual(funnel.map((s) => s.baseStage), ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON']);
  assert.ok(funnel.every((s, i) => i === 0 || s.count <= funnel[i - 1].count));

  const sources = (await as(raj).get('/api/analytics/lead-sources', { from: '2000-01-01' }).expect(200)).body.sources;
  assert.equal(sources.length, 5);
  assert.ok(sources.some((s) => s.count > 0));

  const revenue = (await as(raj).get('/api/analytics/revenue', { from: '2026-01-01', to: '2026-06-30' }).expect(200)).body.historical;
  assert.deepEqual(revenue.map((m) => m.ds), ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']);

  const overview = (await as(sarah).get('/api/analytics/overview').expect(200)).body.stats;
  assert.ok(overview.winRate >= 0 && overview.winRate <= 1);

  await as(raj).get('/api/analytics/win-loss', { from: '2026-06-01', to: '2026-01-01' }).expect(422);

  const actions = (await as(raj).get('/api/analytics/next-actions', { limit: 10 }).expect(200)).body.items;
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const ranks = actions.map((a) => rank[a.recommendation.urgency] ?? 3);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

// ── Notifications & settings ────────────────────────────────────────────────

test('assigning a task to someone else creates a notification they can read', async () => {
  const task = (await as(raj).post('/api/tasks', { title: `Call back ${run}`, assignedToId: sarah.user.id }).expect(201)).body.task;
  created.tasks.add(task.id);
  // notify() is fire-and-forget; give it a moment to persist.
  await new Promise((r) => setTimeout(r, 300));
  await prisma.notification.updateMany({ where: { userId: sarah.user.id, data: { path: ['taskId'], equals: task.id } }, data: { data: { taskId: task.id, run } } });

  const inbox = (await as(sarah).get('/api/notifications', { unread: 'true' }).expect(200)).body;
  const mine = inbox.notifications.find((n) => n.data?.taskId === task.id);
  assert.ok(mine, 'notification delivered');
  assert.equal(mine.type, 'task');

  await as(emily).patch(`/api/notifications/${mine.id}/read`).expect(404);
  await as(sarah).patch(`/api/notifications/${mine.id}/read`).expect(200);
  const after = (await as(sarah).get('/api/notifications').expect(200)).body.notifications.find((n) => n.id === mine.id);
  assert.ok(after.readAt);
});

test('every role can read tags and pipeline stages', async () => {
  const tags = (await as(sarah).get('/api/settings/tags').expect(200)).body.tags;
  assert.equal(tags.filter((t) => t.isSource).length, 5);
  const stages = (await as(sarah).get('/api/settings/pipeline-stages').expect(200)).body.stages;
  assert.deepEqual(stages.map((s) => s.position), [...stages.map((s) => s.position)].sort((a, b) => a - b));
});
