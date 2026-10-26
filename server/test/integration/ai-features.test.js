'use strict';

/**
 * Email composer, deal and relationship summaries, smart reply, next best
 * action, lead-score explanation and enrichment, through the mock provider.
 * Records this file changes are restored or deleted afterwards.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, request, prisma, bearer, login, eventually, teardown } = require('./helpers');
const { Prisma } = require('@prisma/client');
const { refreshNextActions } = require('../../src/services/nextAction.service');

const startedAt = new Date();
const SAVED_FIELDS = { nextBestAction: true, nextBestActionAt: true, leadScore: true, leadScoreLabel: true, leadScoreExplanation: true };
let sarah, mike, sarahContact, mikeContact, mikeDeal, saved;
const created = { contacts: [], emails: [] };

before(async () => {
  process.env.AI_MOCK = 'true';
  [sarah, mike] = await Promise.all([login('sarah@leadpulse.dev'), login('mike@leadpulse.dev')]);
  sarahContact = await prisma.contact.findFirstOrThrow({ where: { ownerId: sarah.user.id }, select: { id: true, ...SAVED_FIELDS } });
  mikeContact = await prisma.contact.findFirstOrThrow({ where: { ownerId: mike.user.id } });
  mikeDeal = await prisma.deal.findFirstOrThrow({ where: { ownerId: mike.user.id, contact: { ownerId: mike.user.id } } });
  saved = sarahContact;
});

after(async () => {
  delete process.env.AI_MOCK;
  const { id, ...fields } = saved;
  await prisma.contact.update({ where: { id }, data: { ...fields, nextBestAction: fields.nextBestAction ?? Prisma.DbNull } });
  await prisma.emailDraft.deleteMany({ where: { id: { in: created.emails } } });
  await prisma.contact.deleteMany({ where: { id: { in: created.contacts } } });
  await prisma.aiLog.deleteMany({ where: { createdAt: { gte: startedAt }, OR: [{ provider: 'mock' }, { feature: 'enrich_apply' }] } });
  await teardown();
});

const as = (who) => ({
  get: (url) => request(app).get(url).set(bearer(who.token)),
  post: (url, body) => request(app).post(url).set(bearer(who.token)).send(body),
});

/** POSTs to a streaming endpoint; returns the event names and the concatenated text. */
async function stream(who, url, body) {
  const res = await request(app).post(url).set(bearer(who.token)).send(body ?? {}).buffer(true)
    .parse((r, cb) => {
      let raw = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { raw += c; });
      r.on('end', () => cb(null, raw));
    });
  const events = String(res.body).split('\n\n').filter((b) => /^event:/m.test(b))
    .map((b) => ({ event: /^event: (.+)$/m.exec(b)[1], data: JSON.parse(/^data: (.+)$/m.exec(b)[1]) }));
  return {
    status: res.status,
    type: res.headers['content-type'],
    names: events.map((e) => e.event),
    text: events.filter((e) => e.event === 'delta').map((e) => e.data.text).join(''),
  };
}

test('the email composer rejects bad input before it starts streaming', async () => {
  const base = { contactId: sarahContact.id, bulletPoints: ['Follow up'] };
  await as(sarah).post('/api/ai/compose-email', { ...base, bulletPoints: [] }).expect(422);
  await as(sarah).post('/api/ai/compose-email', { ...base, bulletPoints: Array.from({ length: 11 }, (_, i) => `point ${i}`) }).expect(422);
  await as(sarah).post('/api/ai/compose-email', { ...base, bulletPoints: ['x'.repeat(301)] }).expect(422);
  await as(sarah).post('/api/ai/compose-email', { ...base, tone: 'casual' }).expect(422); // a reply tone, not an email tone
  await as(sarah).post('/api/ai/compose-email', { ...base, contactId: mikeContact.id }).expect(404);
  await as(sarah).post('/api/ai/compose-email', { ...base, dealId: mikeDeal.id }).expect(404);
});

test('the email composer streams a subject line, a blank line and the body', async () => {
  const res = await stream(sarah, '/api/ai/compose-email', { contactId: sarahContact.id, bulletPoints: ['Thank them', 'Propose a call'], tone: 'concise' });
  assert.equal(res.status, 200);
  assert.match(res.type, /text\/event-stream/);
  assert.equal(res.names.at(-1), 'done');
  assert.match(res.text, /^Subject: .+\n\n\S/);
});

test('the relationship summary streams for the owner and is hidden from other reps', async () => {
  const res = await stream(sarah, `/api/ai/contact-narrative/${sarahContact.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.names.at(-1), 'done');
  assert.match(res.text, /\*\*Watch out for:\*\*/);
  await as(mike).post(`/api/ai/contact-narrative/${sarahContact.id}`).expect(404);
});

test('a smart reply answers a received email only, and records the tone', async () => {
  const email = async (direction, subject) => {
    const res = await as(sarah).post('/api/emails', { contactId: sarahContact.id, direction, subject, body: 'Could you send the updated pricing?' }).expect(201);
    created.emails.push(res.body.email.id);
    return res.body.email;
  };
  const received = await email('INBOUND', 'Pricing question');
  const draft = await email('OUTBOUND', 'Our draft');

  const res = await as(sarah).post('/api/ai/smart-reply', { contactId: sarahContact.id, emailId: received.id, tone: 'urgent' }).expect(200);
  assert.ok(res.body.reply.length > 10);
  assert.doesNotMatch(res.body.reply, /^subject:/i);

  await as(sarah).post('/api/ai/smart-reply', { contactId: sarahContact.id, emailId: draft.id, tone: 'urgent' }).expect(422);
  await as(sarah).post('/api/ai/smart-reply', { contactId: sarahContact.id, emailId: received.id, tone: 'friendly' }).expect(422);
  await as(sarah).post('/api/ai/smart-reply', { contactId: mikeContact.id, emailId: received.id, tone: 'casual' }).expect(404);
  await as(mike).post('/api/ai/smart-reply', { emailId: received.id, tone: 'casual' }).expect(404);

  const log = await eventually(() => prisma.aiLog.findFirst({ where: { feature: 'smart_reply', userId: sarah.user.id, createdAt: { gte: startedAt }, input: { path: ['tone'], equals: 'urgent' } } }));
  assert.deepEqual(log.input, { tone: 'urgent', emailId: received.id });
});

test('a next best action is stored on the contact with its time', async () => {
  const res = await as(sarah).post(`/api/ai/next-action/${sarahContact.id}`, {}).expect(200);
  assert.ok(['EMAIL', 'CALL', 'MEETING', 'TASK'].includes(res.body.recommendation.type));
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(res.body.recommendation.urgency));

  const stored = await prisma.contact.findUnique({ where: { id: sarahContact.id }, select: { nextBestAction: true, nextBestActionAt: true } });
  assert.deepEqual(stored.nextBestAction, res.body.recommendation);
  assert.equal(stored.nextBestActionAt.toISOString(), res.body.generatedAt);

  await as(mike).post(`/api/ai/next-action/${sarahContact.id}`, {}).expect(404);
  const otherDeal = await prisma.deal.findFirst({ where: { ownerId: sarah.user.id, contactId: { not: sarahContact.id } } });
  if (otherDeal) await as(sarah).post(`/api/ai/next-action/${sarahContact.id}`, { dealId: otherDeal.id }).expect(422);
});

test('the nightly batch refreshes due recommendations and spares fresh ones', async () => {
  const due = await prisma.contact.findFirst({
    where: { status: { in: ['LEAD', 'ACTIVE'] }, leadScoreLabel: { in: ['HOT', 'WARM'] }, OR: [{ nextBestActionAt: null }, { nextBestActionAt: { lt: new Date(Date.now() - 3 * 86_400_000) } }] },
    orderBy: [{ leadScore: 'desc' }, { id: 'asc' }], // the same tie-break as the batch
    select: { id: true, nextBestAction: true, nextBestActionAt: true },
  });
  if (!due) return; // every recommendation is fresh; nothing to refresh
  try {
    const result = await refreshNextActions({ limit: 1, spacingMs: 0 });
    assert.deepEqual(result, { due: 1, refreshed: 1 });
    const after = await prisma.contact.findUnique({ where: { id: due.id }, select: { nextBestActionAt: true } });
    assert.ok(after.nextBestActionAt > startedAt);
  } finally {
    await prisma.contact.update({ where: { id: due.id }, data: { nextBestAction: due.nextBestAction ?? Prisma.DbNull, nextBestActionAt: due.nextBestActionAt } });
  }
});

test('"Explain with AI" stores one sentence that starts with the label', async () => {
  const res = await as(sarah).post(`/api/ai/lead-score/${sarahContact.id}/explain`).expect(200);
  const label = `${res.body.label.charAt(0)}${res.body.label.slice(1).toLowerCase()}`;
  assert.ok(res.body.explanation.startsWith(`${label} — `), res.body.explanation);
  const stored = await prisma.contact.findUnique({ where: { id: sarahContact.id }, select: { leadScoreExplanation: true, leadScore: true } });
  assert.equal(stored.leadScoreExplanation, res.body.explanation);
  assert.equal(stored.leadScore, res.body.score);
  await as(mike).post(`/api/ai/lead-score/${sarahContact.id}/explain`).expect(404);
});

test('enrichment proposes without saving, then applies only the confirmed fields', async () => {
  const contact = (await as(sarah).post('/api/contacts', { firstName: 'Enrich', lastName: 'Target', email: `enrich.target.${Date.now()}@example.com`, title: 'Analyst' }).expect(201)).body.contact;
  created.contacts.push(contact.id);

  await as(sarah).post('/api/ai/enrich-contact', { contactId: contact.id, linkedinUrl: 'https://evil.example/in/x' }).expect(422);
  await as(sarah).post('/api/ai/enrich-contact', { contactId: contact.id, domain: 'not a domain' }).expect(422);
  await as(sarah).post('/api/ai/enrich-contact', { contactId: contact.id }).expect(422);
  await as(mike).post('/api/ai/enrich-contact', { contactId: contact.id, linkedinUrl: 'https://www.linkedin.com/in/enrich-target' }).expect(404);

  // LinkedIn input is never fetched, so this runs offline.
  const preview = await as(sarah).post('/api/ai/enrich-contact', { contactId: contact.id, linkedinUrl: 'https://www.linkedin.com/in/enrich-target' }).expect(200);
  assert.equal(preview.body.source, 'ai');
  assert.equal(preview.body.current.title, 'Analyst');
  assert.ok(preview.body.confidence >= 0 && preview.body.confidence <= 1);
  const unchanged = await prisma.contact.findUnique({ where: { id: contact.id }, select: { title: true, customFields: true } });
  assert.deepEqual(unchanged, { title: 'Analyst', customFields: null }, 'a preview saves nothing');

  await as(sarah).post(`/api/ai/enrich-contact/${contact.id}/apply`, { fields: { industry: 'Software' } }).expect(422); // no company to put it on
  await as(sarah).post(`/api/ai/enrich-contact/${contact.id}/apply`, { fields: { ownerId: mike.user.id } }).expect(422);
  await as(sarah).post(`/api/ai/enrich-contact/${contact.id}/apply`, { fields: {} }).expect(422);

  const applied = await as(sarah).post(`/api/ai/enrich-contact/${contact.id}/apply`, { fields: { title: 'Head of Data', estimatedBudgetTier: 'mid' } }).expect(200);
  assert.equal(applied.body.contact.title, 'Head of Data');
  assert.deepEqual(applied.body.contact.customFields, { budgetTier: 'MID' });

  const note = await prisma.activity.findFirst({ where: { contactId: contact.id, type: 'NOTE' } });
  assert.equal(note.notes, 'Contact enriched via AI (fields: title, estimatedBudgetTier)');
  const entry = await prisma.auditLog.findFirst({ where: { entityType: 'contact', entityId: contact.id, action: 'update' }, orderBy: { createdAt: 'desc' } });
  assert.equal(entry.after.title, 'Head of Data');
  assert.equal(entry.before.title, 'Analyst');
});
