'use strict';

/**
 * Quick search, structured queries in the assistant, and My Day with its
 * briefing, through the mock provider. Everything stays inside the caller's book.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, request, prisma, bearer, login, eventually, teardown } = require('./helpers');
const crmQueries = require('../../src/services/crmQueries.service');
const { localDate } = require('../../src/lib/dates');
const { workspace } = require('../../src/lib/workspace');

const startedAt = new Date();
let sarah, mike, admin, mikeContact;
const created = { tasks: [], conversations: [] };

before(async () => {
  process.env.AI_MOCK = 'true';
  [sarah, mike, admin] = await Promise.all(['sarah', 'mike', 'admin'].map((u) => login(`${u}@leadpulse.dev`)));
  mikeContact = await prisma.contact.findFirstOrThrow({ where: { ownerId: mike.user.id }, orderBy: { id: 'asc' } });
});

after(async () => {
  delete process.env.AI_MOCK;
  await prisma.task.deleteMany({ where: { id: { in: created.tasks } } });
  await prisma.aiConversation.deleteMany({ where: { id: { in: created.conversations } } });
  await prisma.dailyBriefing.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.aiLog.deleteMany({ where: { provider: 'mock', createdAt: { gte: startedAt } } });
  await teardown();
});

const get = (who, url) => request(app).get(url).set(bearer(who.token));
const sarahsDeal = (userId) => ({ OR: [{ ownerId: userId }, { contact: { ownerId: userId } }] });

async function ask(who, question) {
  const res = await request(app).post('/api/ai/chat').set(bearer(who.token)).send({ question }).buffer(true)
    .parse((r, cb) => {
      let raw = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { raw += c; });
      r.on('end', () => cb(null, raw));
    });
  const events = String(res.body).split('\n\n').filter((b) => /^event:/m.test(b))
    .map((b) => ({ event: /^event: (.+)$/m.exec(b)[1], data: JSON.parse(/^data: (.+)$/m.exec(b)[1]) }));
  const done = events.find((e) => e.event === 'done')?.data;
  if (done) created.conversations.push(done.conversationId);
  return { sources: events.find((e) => e.event === 'sources')?.data.sources ?? [], done };
}

test('quick search finds records by every word typed, only inside the caller\'s book', async () => {
  const query = `${mikeContact.firstName} ${mikeContact.lastName.slice(0, 3)}`;
  const asAdmin = (await get(admin, `/api/search?q=${encodeURIComponent(query)}`).expect(200)).body.results;
  assert.ok(asAdmin.contacts.some((c) => c.id === mikeContact.id));
  const asSarah = (await get(sarah, `/api/search?q=${encodeURIComponent(query)}`).expect(200)).body.results;
  assert.ok(!asSarah.contacts.some((c) => c.id === mikeContact.id), "another rep's contact never shows up");
  assert.deepEqual((await get(sarah, '/api/search?q=').expect(200)).body.results, { contacts: [], deals: [], companies: [] });
  await request(app).get('/api/search?q=x').expect(401);
});

test('a query plan is checked: unknown tools and parameters are dropped, numbers clamped', () => {
  assert.deepEqual(crmQueries.checkPlan({ queries: [{ tool: 'drop_tables' }, { tool: 'deals', minValue: '100000', limit: 99, closeTo: 'soon', stages: ['proposal', 'NOPE'] }] }), [
    { tool: 'deals', status: 'open', stages: ['PROPOSAL'], minValue: 100000, sort: 'value', limit: 10 },
  ]);
  assert.equal(crmQueries.checkPlan({ queries: [{ tool: 'tasks' }, { tool: 'tasks' }, { tool: 'tasks' }] }).length, 2);
  assert.deepEqual(crmQueries.checkPlan('nonsense'), []);
});

test('structured queries only ever see the caller\'s deals', async () => {
  const [query] = crmQueries.checkPlan({ queries: [{ tool: 'deals', status: 'any' }] });
  const records = await crmQueries.runQueries(sarah.user, [query], { tz: workspace().timezone });
  const rows = records.filter((r) => r.fromQuery);
  const allowed = new Set((await prisma.deal.findMany({ where: sarahsDeal(sarah.user.id), select: { id: true } })).map((d) => d.id));
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => allowed.has(r.recordId)));
  assert.match(records[0].content, new RegExp(`: ${allowed.size} match`), 'the header counts the whole book, not just the listed rows');
});

test('the assistant answers "deals over 100k" from a database query and links those deals', async () => {
  const { sources, done } = await ask(sarah, 'Which deals over 100k should I focus on?');
  assert.ok(done, 'the stream finished');
  const plan = await eventually(() => prisma.aiLog.findFirst({ where: { feature: 'plan_queries', userId: sarah.user.id, createdAt: { gte: startedAt } } }));
  assert.ok(plan, 'the plan call was made and logged');

  const deals = sources.filter((s) => s.type === 'deal');
  assert.ok(deals.length > 0, 'the cited query result brings its deals as sources');
  const rows = await prisma.deal.findMany({ where: { id: { in: deals.map((d) => d.id) } }, select: { value: true, stage: true, ownerId: true, contact: { select: { ownerId: true } } } });
  assert.ok(rows.every((d) => Number(d.value) >= 100000 && !d.stage.startsWith('CLOSED')));
  assert.ok(rows.every((d) => d.ownerId === sarah.user.id || d.contact.ownerId === sarah.user.id));
});

test('My Day lists the user\'s own tasks by day, and the briefing is written on request', async () => {
  const today = localDate(new Date(), workspace().timezone);
  const due = (offsetDays) => new Date(Date.parse(`${today}T12:00:00Z`) + offsetDays * 86_400_000);
  for (const [title, offset] of [['My Day overdue check', -2], ['My Day today check', 0], ['My Day later check', 3]]) {
    const task = await prisma.task.create({ data: { title, dueDate: due(offset), assignedToId: sarah.user.id, createdById: sarah.user.id } });
    created.tasks.push(task.id);
  }
  const mikesTask = await prisma.task.create({ data: { title: 'Not Sarah\'s task', dueDate: due(0), assignedToId: mike.user.id, createdById: mike.user.id } });
  created.tasks.push(mikesTask.id);

  const day = (await get(sarah, '/api/my-day').expect(200)).body.day;
  assert.equal(day.date, today);
  const titles = (list) => list.map((t) => t.title);
  assert.ok(titles(day.tasks.overdue).includes('My Day overdue check'));
  assert.ok(titles(day.tasks.today).includes('My Day today check'));
  assert.ok(titles(day.tasks.upcoming).includes('My Day later check'));
  assert.ok(![...day.tasks.overdue, ...day.tasks.today, ...day.tasks.upcoming].some((t) => t.id === mikesTask.id));
  const book = new Set((await prisma.deal.findMany({ where: sarahsDeal(sarah.user.id), select: { id: true } })).map((d) => d.id));
  assert.ok([...day.closing, ...day.stalled].every((d) => book.has(d.id)));
  assert.equal(day.pipeline.count, await prisma.deal.count({ where: { ...sarahsDeal(sarah.user.id), stage: { in: ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION'] } } }));

  const written = (await request(app).post('/api/ai/briefing').set(bearer(sarah.token)).expect(200)).body.briefing;
  assert.ok(written.content.length > 20);
  assert.equal((await get(sarah, '/api/my-day').expect(200)).body.day.briefing.content, written.content);
  await request(app).post('/api/ai/briefing').set(bearer(sarah.token)).expect(200);
  assert.equal(await prisma.dailyBriefing.count({ where: { userId: sarah.user.id, date: today } }), 1, 'rewriting replaces the day\'s briefing');
  assert.equal((await get(mike, '/api/my-day').expect(200)).body.day.briefing?.content === written.content, false, 'briefings are per user');
});

test('"contacts of <company>" lists exactly the caller\'s contacts there', async () => {
  const company = await prisma.company.findFirstOrThrow({
    where: { AND: [{ contacts: { some: { ownerId: sarah.user.id } } }, { contacts: { some: { ownerId: { not: sarah.user.id } } } }] },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const { sources } = await ask(sarah, `give me all contacts of ${company.name}`);
  const mine = await prisma.contact.findMany({ where: { companyId: company.id, ownerId: sarah.user.id }, select: { id: true } });
  const listed = sources.filter((s) => s.type === 'contact').map((s) => s.id).sort();
  assert.deepEqual(listed, mine.map((c) => c.id).sort(), 'all of hers at that company, and nobody else\'s');
});

test('"what should I focus on today?" answers from the caller\'s day', async () => {
  const task = await prisma.task.create({
    // The most overdue task, so it is among the few the answer's links show first.
    data: { title: 'Focus check overdue', dueDate: new Date(Date.now() - 400 * 86_400_000), priority: 'HIGH', assignedToId: sarah.user.id, createdById: sarah.user.id },
  });
  created.tasks.push(task.id);
  const { sources, done } = await ask(sarah, 'What should I focus on today?');
  assert.ok(done);
  assert.ok(sources.some((s) => s.type === 'task' && s.id === task.id), 'her overdue task is a source');
  const tasks = await prisma.task.findMany({ where: { id: { in: sources.filter((s) => s.type === 'task').map((s) => s.id) } }, select: { assignedToId: true } });
  assert.ok(tasks.every((t) => t.assignedToId === sarah.user.id), 'only her own tasks');
});
