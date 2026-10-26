'use strict';

/**
 * Workspace configuration through the API: workspace settings, the pipeline
 * stage editor, tags, custom fields, saved API keys, webhooks and invitations.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { app, request, prisma, bearer, login, teardown } = require('./helpers');
const { recorded } = require('../../src/queues/queue');
const { money } = require('../../src/lib/workspace');
const webhooks = require('../../src/services/webhooks.service');

// Saved keys and webhook secrets need an encryption key; the receiver below runs on this machine.
process.env.ENCRYPTION_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.WEBHOOK_ALLOW_PRIVATE = 'true';

let admin, sarah, workspaceBefore;
const created = { stages: [], tags: [], fields: [], contacts: [], deals: [], webhooks: [], invitations: [] };

before(async () => {
  [admin, sarah] = await Promise.all([login('admin@leadpulse.dev'), login('sarah@leadpulse.dev')]);
  workspaceBefore = (await as(admin).get('/api/settings/workspace').expect(200)).body.workspace;
});

after(async () => {
  await as(admin).patch('/api/settings/workspace').send(workspaceBefore);
  await prisma.deal.deleteMany({ where: { id: { in: created.deals } } });
  await prisma.contact.deleteMany({ where: { id: { in: created.contacts } } });
  await prisma.pipelineStage.deleteMany({ where: { id: { in: created.stages }, deals: { none: {} } } });
  await prisma.tag.deleteMany({ where: { id: { in: created.tags } } });
  await prisma.customFieldDefinition.deleteMany({ where: { id: { in: created.fields } } });
  await prisma.webhook.deleteMany({ where: { id: { in: created.webhooks } } });
  await prisma.invitation.deleteMany({ where: { id: { in: created.invitations } } });
  await prisma.integrationCredential.deleteMany({ where: { provider: 'CLEARBIT_API_KEY' } });
  await teardown();
});

function as(who) {
  const send = (method) => (url) => request(app)[method](url).set(bearer(who.token));
  return { get: send('get'), post: send('post'), patch: send('patch'), put: send('put'), delete: send('delete') };
}

async function newContact(fields = {}) {
  const { contact } = (await as(admin).post('/api/contacts')
    .send({ firstName: 'Settings', lastName: 'Test', email: `settings+${crypto.randomUUID()}@example.com`, ...fields }).expect(201)).body;
  created.contacts.push(contact.id);
  return contact;
}

test('workspace: everyone reads it, only admins change it, and the currency reaches server-side text', async () => {
  const read = (await as(sarah).get('/api/settings/workspace').expect(200)).body.workspace;
  assert.deepEqual(Object.keys(read).sort(), ['companyName', 'currency', 'timezone']);
  await as(sarah).patch('/api/settings/workspace').send({ currency: 'EUR' }).expect(403);

  await as(admin).patch('/api/settings/workspace').send({ timezone: 'Mars/Olympus' }).expect(422);
  await as(admin).patch('/api/settings/workspace').send({ currency: 'XYZ1' }).expect(422);
  await as(admin).patch('/api/settings/workspace').send({ companyName: 'Acme\r\nBcc: everyone@example.com' }).expect(422);
  const saved = (await as(admin).patch('/api/settings/workspace').send({ companyName: 'Acme Sales', currency: 'eur' }).expect(200)).body.workspace;
  assert.equal(saved.currency, 'EUR');
  assert.equal(money(1200), '€1,200');

  const entry = await prisma.auditLog.findFirst({ where: { entityType: 'workspace', actorId: admin.user.id }, orderBy: { createdAt: 'desc' } });
  assert.equal(entry.after.currency, 'EUR');
});

test('stages: a new column sits after its base stage; the last column of a base stage stays', async () => {
  await as(sarah).post('/api/settings/pipeline-stages').send({ label: 'Nope', baseStage: 'CONTACTED' }).expect(403);
  await as(admin).post('/api/settings/pipeline-stages').send({ label: 'Bad', baseStage: 'NOT_A_STAGE' }).expect(422);

  const { stage } = (await as(admin).post('/api/settings/pipeline-stages').send({ label: 'Discovery', color: '#10B981', baseStage: 'CONTACTED' }).expect(201)).body;
  created.stages.push(stage.id);
  assert.equal(stage.color, '#10b981');

  const stages = (await as(admin).get('/api/settings/pipeline-stages').expect(200)).body.stages;
  const contacted = stages.filter((s) => s.baseStage === 'CONTACTED');
  assert.equal(contacted.at(-1).id, stage.id, 'after the other CONTACTED columns');
  assert.ok(stages.every((s) => typeof s.dealCount === 'number'));
  const repView = (await as(sarah).get('/api/settings/pipeline-stages').expect(200)).body.stages;
  assert.ok(repView.every((s) => s.dealCount === undefined), 'counts are org-wide, so admins only');

  const onlyLead = stages.filter((s) => s.baseStage === 'LEAD');
  if (onlyLead.length === 1) await as(admin).delete(`/api/settings/pipeline-stages/${onlyLead[0].id}`).expect(409);

  await as(admin).put('/api/settings/pipeline-stages/order').send({ ids: stages.slice(1).map((s) => s.id) }).expect(422);
  const reversed = [...stages].reverse().map((s) => s.id);
  const reordered = (await as(admin).put('/api/settings/pipeline-stages/order').send({ ids: reversed }).expect(200)).body.stages;
  assert.deepEqual(reordered.map((s) => s.id), reversed);
  await as(admin).put('/api/settings/pipeline-stages/order').send({ ids: stages.map((s) => s.id) }).expect(200);
});

test('stages: deleting a column with deals needs a destination and moves them like a drag', async () => {
  const [discoveryId] = created.stages;
  const contacted = (await prisma.pipelineStage.findFirst({ where: { baseStage: 'CONTACTED', id: { not: discoveryId } }, orderBy: { position: 'asc' } }));
  const contact = await newContact();
  const { deal } = (await as(admin).post('/api/deals').send({ title: 'Stage editor deal', contactId: contact.id, pipelineStageId: discoveryId }).expect(201)).body;
  created.deals.push(deal.id);
  assert.equal(deal.stage, 'CONTACTED');

  await as(admin).patch(`/api/settings/pipeline-stages/${discoveryId}`).send({ baseStage: 'DEMO' }).expect(409);
  await as(admin).patch(`/api/settings/pipeline-stages/${discoveryId}`).send({ label: 'Discovery call' }).expect(200);

  await as(admin).delete(`/api/settings/pipeline-stages/${discoveryId}`).expect(422);
  const res = await as(admin).delete(`/api/settings/pipeline-stages/${discoveryId}?moveTo=${contacted.id}`).expect(200);
  assert.equal(res.body.moved, 1);

  const moved = await prisma.deal.findUnique({ where: { id: deal.id } });
  assert.equal(moved.pipelineStageId, contacted.id);
  const last = await prisma.dealStageHistory.findFirst({ where: { dealId: deal.id }, orderBy: { changedAt: 'desc' } });
  assert.equal(last.fromStageId, discoveryId);
  assert.equal(last.toStageId, contacted.id);
  assert.equal(await prisma.pipelineStage.count({ where: { id: discoveryId } }), 0);
});

test('tags: new tags are registered, renames and merges rewrite contacts, deletes remove them', async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [alpha, beta, zeta] = ['Alpha', 'Beta', 'Zeta'].map((n) => `${n} ${suffix}`);
  const contact = await newContact({ tags: [alpha] });
  await as(sarah).post('/api/settings/tags').send({ name: zeta }).expect(403);

  const listed = (await as(admin).get('/api/settings/tags').expect(200)).body.tags;
  const alphaTag = listed.find((t) => t.name === alpha);
  assert.ok(alphaTag, 'a tag first used on a contact appears in the tag list');
  assert.equal(alphaTag.contactCount, 1);
  created.tags.push(alphaTag.id);

  const zetaTag = (await as(admin).post('/api/settings/tags').send({ name: zeta, color: '#FF0000', isSource: true }).expect(201)).body.tag;
  created.tags.push(zetaTag.id);
  await as(admin).post('/api/settings/tags').send({ name: zeta }).expect(409);

  const renamed = (await as(admin).patch(`/api/settings/tags/${alphaTag.id}`).send({ name: beta }).expect(200)).body;
  assert.equal(renamed.merged, false);
  assert.equal(renamed.contacts, 1);
  assert.deepEqual((await prisma.contact.findUnique({ where: { id: contact.id } })).tags, [beta]);

  await as(admin).patch(`/api/contacts/${contact.id}`).send({ tags: [beta, zeta] }).expect(200);
  const merged = (await as(admin).patch(`/api/settings/tags/${alphaTag.id}`).send({ name: zeta }).expect(200)).body;
  assert.equal(merged.merged, true);
  assert.equal(merged.tag.id, zetaTag.id);
  assert.equal(merged.tag.isSource, true, 'the surviving tag keeps its settings');
  assert.deepEqual((await prisma.contact.findUnique({ where: { id: contact.id } })).tags, [zeta], 'one copy after the merge');
  assert.equal(await prisma.tag.count({ where: { id: alphaTag.id } }), 0);

  assert.equal((await as(admin).delete(`/api/settings/tags/${zetaTag.id}`).expect(200)).body.contacts, 1);
  assert.deepEqual((await prisma.contact.findUnique({ where: { id: contact.id } })).tags, []);
});

test('custom fields: types and options are enforced, required applies on create, values merge', async () => {
  await as(sarah).post('/api/settings/custom-fields').send({ entity: 'DEAL', label: 'x', type: 'TEXT' }).expect(403);
  await as(admin).post('/api/settings/custom-fields').send({ entity: 'DEAL', label: 'Plan', type: 'SELECT', options: [] }).expect(422);

  const label = `Plan ${crypto.randomUUID().slice(0, 4)}`;
  const plan = (await as(admin).post('/api/settings/custom-fields')
    .send({ entity: 'DEAL', label, type: 'SELECT', options: ['Starter', 'Growth', 'Starter'], required: true }).expect(201)).body.field;
  created.fields.push(plan.id);
  assert.match(plan.key, /^plan[A-Za-z0-9]+$/);
  assert.deepEqual(plan.options, ['Starter', 'Growth']);
  const seats = (await as(admin).post('/api/settings/custom-fields').send({ entity: 'DEAL', label: `Seats ${plan.key}`, type: 'NUMBER' }).expect(201)).body.field;
  created.fields.push(seats.id);

  const contact = await newContact();
  const base = { title: 'Custom field deal', contactId: contact.id };
  await as(admin).post('/api/deals').send(base).expect(422);
  await as(admin).post('/api/deals').send({ ...base, customFields: { [plan.key]: 'Enterprise' } }).expect(422);
  await as(admin).post('/api/deals').send({ ...base, customFields: { [plan.key]: 'Growth', notAField: 1 } }).expect(422);
  const { deal } = (await as(admin).post('/api/deals').send({ ...base, customFields: { [plan.key]: 'Growth', [seats.key]: '25' } }).expect(201)).body;
  created.deals.push(deal.id);
  assert.deepEqual(deal.customFields, { [plan.key]: 'Growth', [seats.key]: 25 });

  await as(admin).patch(`/api/deals/${deal.id}`).send({ customFields: { [plan.key]: null } }).expect(422);
  await as(admin).patch(`/api/deals/${deal.id}`).send({ customFields: { [seats.key]: 'many' } }).expect(422);
  const updated = (await as(admin).patch(`/api/deals/${deal.id}`).send({ customFields: { [seats.key]: null } }).expect(200)).body.deal;
  assert.deepEqual(updated.customFields, { [plan.key]: 'Growth' }, 'only the sent key changes');

  assert.ok((await as(admin).delete(`/api/settings/custom-fields/${plan.id}`).expect(200)).body.cleared >= 1);
  assert.deepEqual((await prisma.deal.findUnique({ where: { id: deal.id } })).customFields, {});
});

test('integrations: a saved key is encrypted, never returned, and used ahead of nothing but .env', async () => {
  await as(sarah).get('/api/settings/integrations').expect(403);
  const status = (id, body) => body.keys.find((k) => k.id === id);
  const envClearbit = Boolean(process.env.CLEARBIT_API_KEY);
  const key = `cb_test_${crypto.randomBytes(12).toString('hex')}`;

  await as(admin).put('/api/settings/integrations/clearbit').send({ apiKey: 'short' }).expect(422);
  const res = await as(admin).put('/api/settings/integrations/clearbit').send({ apiKey: key }).expect(200);
  assert.ok(!JSON.stringify(res.body).includes(key), 'the key never comes back');
  if (!envClearbit) {
    assert.equal(status('clearbit', res.body).source, 'ui');
    assert.equal(status('clearbit', res.body).last4, key.slice(-4));
  }
  const row = await prisma.integrationCredential.findUnique({ where: { provider: 'CLEARBIT_API_KEY' } });
  assert.match(row.encryptedValue, /^v1:/);
  assert.ok(!row.encryptedValue.includes(key));

  const removed = (await as(admin).delete('/api/settings/integrations/clearbit').expect(200)).body;
  if (!envClearbit) assert.equal(status('clearbit', removed).source, null);
  await as(admin).delete('/api/settings/integrations/clearbit').expect(404);
  await as(admin).put('/api/settings/integrations/nope').send({ apiKey: key }).expect(404);

  const saved = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  try {
    const refused = await as(admin).put('/api/settings/integrations/clearbit').send({ apiKey: key }).expect(503);
    assert.equal(refused.body.code, 'ENCRYPTION_NOT_CONFIGURED');
  } finally {
    process.env.ENCRYPTION_KEY = saved;
  }

  const email = (await as(admin).post('/api/settings/integrations/email/test').send({}).expect(200)).body.result;
  assert.equal(email.ok, true);
});

/** A receiver on 127.0.0.1 that verifies each delivery the way an integrator would. */
async function startReceiver(secret) {
  const received = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const timestamp = req.headers['x-leadpulse-timestamp'];
      const expected = `sha256=${crypto.createHmac('sha256', secret.value).update(`${timestamp}.${raw}`).digest('hex')}`;
      const given = String(req.headers['x-leadpulse-signature']);
      const valid = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
      received.push({ valid, event: req.headers['x-leadpulse-event'], body: JSON.parse(raw) });
      res.writeHead(valid ? 200 : 401).end();
    });
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  return { received, url: `http://127.0.0.1:${server.address().port}/hooks/leadpulse`, close: () => new Promise((r) => { server.close(r); }) };
}

test('webhooks: deliveries are signed, retried by the queue and recorded', async () => {
  await as(sarah).get('/api/settings/webhooks').expect(403);
  await as(admin).post('/api/settings/webhooks').send({ url: 'https://example.com/hook', events: ['contact.deleted'] }).expect(422);

  const secret = { value: '' };
  const receiver = await startReceiver(secret);
  try {
    const res = await as(admin).post('/api/settings/webhooks').send({ url: receiver.url, events: ['contact.created'] }).expect(201);
    created.webhooks.push(res.body.webhook.id);
    secret.value = res.body.secret;
    assert.match(secret.value, /^whsec_/);
    assert.equal(res.body.webhook.secretEncrypted, undefined);
    assert.ok(!JSON.stringify((await as(admin).get('/api/settings/webhooks').expect(200)).body).includes(secret.value), 'the secret is shown once');

    const ping = (await as(admin).post(`/api/settings/webhooks/${res.body.webhook.id}/test`).expect(200)).body.delivery;
    assert.equal(ping.ok, true);
    assert.equal(receiver.received[0].valid, true);
    assert.equal(receiver.received[0].event, 'ping');

    const contact = await newContact();
    const job = await (async () => {
      for (let i = 0; i < 60; i += 1) {
        const found = recorded.find((j) => j.name === 'webhook-deliver' && j.data.data?.contact?.id === contact.id);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    })();
    assert.ok(job, 'creating a contact queues a delivery');
    assert.equal(job.opts.attempts, 6);

    const result = await webhooks.deliver(job.data, { attemptsMade: 0, opts: job.opts });
    assert.equal(result.ok, true);
    const delivered = receiver.received.at(-1);
    assert.equal(delivered.valid, true);
    assert.equal(delivered.event, 'contact.created');
    assert.equal(delivered.body.data.contact.email, contact.email);

    // A receiver that rejects the signature makes the attempt fail, so the queue retries it.
    const rotated = (await as(admin).post(`/api/settings/webhooks/${res.body.webhook.id}/rotate-secret`).expect(200)).body.secret;
    assert.notEqual(rotated, secret.value);
    await assert.rejects(webhooks.deliver(job.data, { attemptsMade: 0, opts: job.opts }), /HTTP 401/);
    const last = await webhooks.deliver(job.data, { attemptsMade: 5, opts: job.opts });
    assert.equal(last.ok, false, 'the final attempt is recorded, not thrown');

    const hook = await prisma.webhook.findUnique({ where: { id: res.body.webhook.id } });
    assert.deepEqual(hook.recentDeliveries.slice(0, 4).map((d) => [d.event, d.ok]),
      [['contact.created', false], ['contact.created', false], ['contact.created', true], ['ping', true]]);
  } finally {
    await receiver.close();
  }

  process.env.WEBHOOK_ALLOW_PRIVATE = 'false';
  try {
    await as(admin).post('/api/settings/webhooks').send({ url: 'http://example.com/hook', events: ['task.overdue'] }).expect(422);
    await as(admin).post('/api/settings/webhooks').send({ url: 'https://127.0.0.1/hook', events: ['task.overdue'] }).expect(422);
  } finally {
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
  }
});

test('invitations are emailed and can be resent with a fresh link', async () => {
  const email = `invite+${crypto.randomUUID()}@example.com`;
  const created1 = (await as(admin).post('/api/users/invite').send({ email, role: 'MANAGER' }).expect(201)).body;
  created.invitations.push(created1.invitation.id);
  assert.equal(created1.email.sent, true);
  const firstToken = new URL(created1.inviteUrl).searchParams.get('token');

  const resent = (await as(admin).post(`/api/users/invitations/${created1.invitation.id}/resend`).expect(200)).body;
  assert.equal(resent.email.sent, true);
  const secondToken = new URL(resent.inviteUrl).searchParams.get('token');
  assert.notEqual(secondToken, firstToken);
  await request(app).get(`/api/auth/invite/${firstToken}`).expect(404);
  await request(app).get(`/api/auth/invite/${secondToken}`).expect(200);

  await as(sarah).post(`/api/users/invitations/${created1.invitation.id}/resend`).expect(403);
  await as(admin).delete(`/api/users/invitations/${created1.invitation.id}`).expect(204);
  await as(admin).post(`/api/users/invitations/${created1.invitation.id}/resend`).expect(404);

  const trail = await prisma.auditLog.findMany({ where: { entityType: 'invitation', entityId: created1.invitation.id } });
  assert.deepEqual(trail.map((t) => t.action).sort(), ['invite', 'invite_resend', 'invite_revoke']);
});
