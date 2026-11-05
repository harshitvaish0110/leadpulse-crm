'use strict';

/**
 * A public demo account can read and edit, but the actions that would spoil
 * the demo for the next visitor are refused. Every refused request below is
 * also harmless if the guard were missing (bad payload, empty list, unknown id).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, request, prisma, bearer, login, teardown } = require('./helpers');

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
let mike, sarah;

before(async () => {
  process.env.DEMO_ACCOUNT_EMAILS = ' Mike@leadpulse.dev , someone@example.com';
  [mike, sarah] = await Promise.all([login('mike@leadpulse.dev'), login('sarah@leadpulse.dev')]);
});

after(async () => {
  delete process.env.DEMO_ACCOUNT_EMAILS;
  await teardown();
});

test('the demo account can look around and edit its records', async () => {
  await request(app).get('/api/contacts?limit=1').set(bearer(mike.token)).expect(200);
  const contact = await prisma.contact.findFirstOrThrow({ where: { ownerId: mike.user.id }, orderBy: { id: 'asc' } });
  await request(app).patch(`/api/contacts/${contact.id}`).set(bearer(mike.token)).send({ firstName: contact.firstName }).expect(200);
});

test('deletes, handing records away, uploads, sending email and account changes are refused', async () => {
  const refused = [
    request(app).delete(`/api/contacts/${UNKNOWN}`),
    request(app).post('/api/contacts/bulk').send({ ids: [], action: 'assign', ownerId: sarah.user.id }),
    request(app).post('/api/contacts/bulk').send({ ids: [], action: 'delete' }),
    request(app).post('/api/auth/change-password').send({ currentPassword: 'password123', newPassword: 'x' }),
    request(app).patch('/api/auth/me').send({ email: 'not-an-email' }),
    request(app).post('/api/attachments'),
    request(app).post('/api/activities/upload-audio'),
    request(app).post(`/api/emails/${UNKNOWN}/send`),
  ];
  for (const pending of refused) {
    const res = await pending.set(bearer(mike.token));
    assert.equal(res.status, 403, `${res.req.method} ${res.req.path}`);
    assert.equal(res.body.code, 'DEMO_RESTRICTED');
  }
});

test('other accounts are not restricted', async () => {
  const res = await request(app).post('/api/contacts/bulk').set(bearer(sarah.token)).send({ ids: [], action: 'delete' });
  assert.notEqual(res.body.code, 'DEMO_RESTRICTED');
});
