/**
 * LeadPulse — Outgoing webhooks.
 *
 * Services call emit(event, data) after a change commits; each subscribed,
 * active webhook gets a `webhook-deliver` job, retried with backoff for about
 * a quarter of an hour. A delivery is a JSON POST:
 *
 *   { id, event, createdAt, data }
 *   X-LeadPulse-Event, X-LeadPulse-Delivery (= id), X-LeadPulse-Timestamp (unix s)
 *   X-LeadPulse-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *
 * Receivers verify the signature over the raw body and reject old timestamps.
 * Signing secrets are encrypted at rest and shown once, on creation or rotation.
 * Each webhook keeps its last 20 attempts in `recentDeliveries`.
 */

'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { audit } = require('../lib/audit');
const { encrypt, decrypt, EncryptionUnavailableError } = require('../lib/crypto');
const { safePost, postTarget } = require('../lib/safeFetch');
const { ApiError } = require('../middleware/error.middleware');
const { enqueue } = require('../queues/queue');

const EVENTS = ['contact.created', 'deal.stage_changed', 'task.overdue'];
const MAX_DELIVERIES = 20;
const ATTEMPTS = 6; // retries after 30 s, 1, 2, 4 and 8 min
const WEBHOOK_SELECT = { id: true, url: true, events: true, isActive: true, recentDeliveries: true, createdAt: true, updatedAt: true };

const invalid = (path, msg) => ApiError.validation([{ path, msg }]);
const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE === 'true' && process.env.NODE_ENV !== 'production';
const newSecret = () => `whsec_${crypto.randomBytes(24).toString('base64url')}`;

/** `sha256=<hex>` over `<timestamp>.<body>`. */
const sign = (secret, timestamp, body) => `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

function sealed(secret) {
  try {
    return encrypt(secret);
  } catch (err) {
    if (err instanceof EncryptionUnavailableError) {
      throw new ApiError('Set ENCRYPTION_KEY on the server to create webhooks: their signing secrets are stored encrypted.', 503, 'ENCRYPTION_NOT_CONFIGURED');
    }
    throw err;
  }
}

// ── Payloads: the record as the API returns it, without internal or derived fields ─

const contactPayload = (c) => ({
  id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, title: c.title,
  status: c.status, companyId: c.companyId, ownerId: c.ownerId, tags: c.tags, createdAt: c.createdAt,
});

const dealPayload = (d) => ({
  id: d.id, title: d.title, value: Number(d.value), stage: d.stage,
  pipelineStage: d.pipelineStage ? { id: d.pipelineStage.id, label: d.pipelineStage.label } : null,
  contactId: d.contactId, ownerId: d.ownerId, expectedCloseDate: d.expectedCloseDate, closedAt: d.closedAt,
});

const taskPayload = (t) => ({
  id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority,
  assignedToId: t.assignedToId, contactId: t.contactId, dealId: t.dealId,
});

// ── Management (ADMIN) ─────────────────────────────────────────────────────────

function checkEvents(events) {
  if (!Array.isArray(events) || !events.length || events.some((e) => !EVENTS.includes(e))) {
    throw invalid('events', `events must be a non-empty list of: ${EVENTS.join(', ')}`);
  }
  return [...new Set(events)];
}

async function checkUrl(url) {
  if (typeof url !== 'string' || url.length > 2000) throw invalid('url', 'url is required');
  try {
    await postTarget(url.trim(), { allowPrivate: allowPrivate() });
  } catch (err) {
    throw invalid('url', err.message);
  }
  return url.trim();
}

const listWebhooks = () => prisma.webhook.findMany({ orderBy: { createdAt: 'asc' }, select: WEBHOOK_SELECT });

/** @returns {Promise<{ webhook: object, secret: string }>} the secret is only ever returned here and by rotateSecret */
async function createWebhook(req, input) {
  const url = await checkUrl(input.url);
  const events = checkEvents(input.events);
  const secret = newSecret();
  const webhook = await prisma.webhook.create({
    data: { url, events, secretEncrypted: sealed(secret), createdById: req.user.id },
    select: WEBHOOK_SELECT,
  });
  await audit(req, { action: 'create', entityType: 'webhook', entityId: webhook.id, after: { url, events } });
  return { webhook, secret };
}

async function updateWebhook(req, id, input) {
  const before = await prisma.webhook.findUnique({ where: { id }, select: { url: true, events: true, isActive: true } });
  if (!before) throw ApiError.notFound('Webhook not found');
  const data = {};
  if (input.url !== undefined) data.url = await checkUrl(input.url);
  if (input.events !== undefined) data.events = checkEvents(input.events);
  if (input.isActive !== undefined) data.isActive = input.isActive === true;
  const webhook = await prisma.webhook.update({ where: { id }, data, select: WEBHOOK_SELECT });
  await audit(req, { action: 'update', entityType: 'webhook', entityId: id, before, after: data });
  return webhook;
}

async function rotateSecret(req, id) {
  const secret = newSecret();
  await prisma.webhook.update({ where: { id }, data: { secretEncrypted: sealed(secret) }, select: { id: true } });
  await audit(req, { action: 'rotate_secret', entityType: 'webhook', entityId: id });
  return { secret };
}

async function removeWebhook(req, id) {
  const before = await prisma.webhook.findUnique({ where: { id }, select: { url: true, events: true, isActive: true } });
  if (!before) throw ApiError.notFound('Webhook not found');
  await prisma.webhook.delete({ where: { id } });
  await audit(req, { action: 'delete', entityType: 'webhook', entityId: id, before });
}

// ── Delivery ───────────────────────────────────────────────────────────────────

/** Adds one attempt to the front of the webhook's last-20 list, atomically. */
async function recordDelivery(webhookId, entry) {
  await prisma.$executeRaw`
    UPDATE "webhooks" SET "recentDeliveries" = (
      SELECT COALESCE(jsonb_agg(e ORDER BY n), '[]'::jsonb)
      FROM (
        SELECT e, n FROM jsonb_array_elements(${JSON.stringify([entry])}::jsonb || "recentDeliveries") WITH ORDINALITY AS t(e, n)
        ORDER BY n LIMIT ${MAX_DELIVERIES}
      ) latest
    )
    WHERE "id" = ${webhookId}`;
}

/** One signed POST; never throws. */
async function post(webhook, { deliveryId, event, occurredAt, data }) {
  const body = JSON.stringify({ id: deliveryId, event, createdAt: occurredAt, data });
  const timestamp = Math.floor(Date.now() / 1000);
  const started = Date.now();
  const at = new Date().toISOString();
  try {
    const { status } = await safePost(webhook.url, body, {
      'Content-Type': 'application/json',
      'User-Agent': 'LeadPulse-Webhooks/1.0',
      'X-LeadPulse-Event': event,
      'X-LeadPulse-Delivery': deliveryId,
      'X-LeadPulse-Timestamp': String(timestamp),
      'X-LeadPulse-Signature': sign(decrypt(webhook.secretEncrypted), timestamp, body),
    }, { allowPrivate: allowPrivate() });
    return { ok: status >= 200 && status < 300, statusCode: status, durationMs: Date.now() - started, at };
  } catch (err) {
    return { ok: false, statusCode: null, error: String(err.message).slice(0, 200), durationMs: Date.now() - started, at };
  }
}

/**
 * Job `webhook-deliver`. A failed attempt throws so the queue retries it, except
 * the last one (and inline runs, which have no retries), which is just recorded.
 */
async function deliver({ webhookId, deliveryId, event, occurredAt, data }, job) {
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId }, select: { url: true, isActive: true, secretEncrypted: true } });
  if (!webhook?.isActive) return { skipped: 'webhook deleted or paused' };
  const attempt = (job?.attemptsMade ?? 0) + 1;
  const result = await post(webhook, { deliveryId, event, occurredAt, data });
  await recordDelivery(webhookId, { id: deliveryId, event, attempt, ...result });
  if (!result.ok && job && attempt < (job.opts?.attempts ?? 1)) {
    throw new Error(`Webhook delivery failed: ${result.error ?? `HTTP ${result.statusCode}`}`);
  }
  return result;
}

/** Sends a `ping` now and returns the attempt, for the "Send test" button. */
async function sendTest(req, id) {
  const webhook = await prisma.webhook.findUnique({ where: { id }, select: { url: true, secretEncrypted: true } });
  if (!webhook) throw ApiError.notFound('Webhook not found');
  const delivery = { deliveryId: crypto.randomUUID(), event: 'ping', occurredAt: new Date().toISOString(), data: { message: 'Test delivery from LeadPulse', sentBy: req.user.id } };
  const result = await post(webhook, delivery);
  const entry = { id: delivery.deliveryId, event: 'ping', attempt: 1, ...result };
  await recordDelivery(id, entry);
  return entry;
}

/**
 * Queues a delivery of `event` to every active webhook subscribed to it.
 * Fire-and-forget: never throws and never delays the caller.
 */
function emit(event, data) {
  const occurredAt = new Date().toISOString();
  prisma.webhook.findMany({ where: { isActive: true, events: { has: event } }, select: { id: true } })
    .then((webhooks) => Promise.all(webhooks.map((w) => {
      const deliveryId = crypto.randomUUID();
      return enqueue('webhook-deliver', { webhookId: w.id, deliveryId, event, occurredAt, data }, {
        jobId: `webhook-${deliveryId}`, attempts: ATTEMPTS, backoff: { type: 'exponential', delay: 30_000 },
      });
    })))
    .catch((err) => logger.warn({ event: 'webhook_emit_failed', webhookEvent: event, err: err.message }, 'Could not queue webhook deliveries'));
}

module.exports = {
  EVENTS, sign, contactPayload, dealPayload, taskPayload,
  listWebhooks, createWebhook, updateWebhook, rotateSecret, removeWebhook,
  deliver, sendTest, emit,
};
