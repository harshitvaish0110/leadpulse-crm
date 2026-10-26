/**
 * LeadPulse — Contact writes: CRUD, bulk actions and CSV import.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { audit } = require('../lib/audit');
const { ApiError } = require('../middleware/error.middleware');
const { scopeFor, isPrivileged, resolveOwnerId } = require('../middleware/auth.middleware');
const { emitScoped } = require('../lib/realtime');
const { afterContactChange, afterBulkChange, reindex } = require('../queues/triggers');
const { removeFromIndex } = require('./semanticIndex.service');

const STATUSES = ['LEAD', 'ACTIVE', 'INACTIVE', 'CHURNED'];
const EDITABLE = ['firstName', 'lastName', 'email', 'phone', 'title', 'linkedinUrl', 'status', 'companyId', 'tags', 'customFields'];
const MAX_BULK = 500;
const MAX_IMPORT = 5000;
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com']);

const CONTACT_LIST_INCLUDE = {
  company: { select: { id: true, name: true, industry: true } },
  owner:   { select: { id: true, firstName: true, lastName: true } },
  _count:  { select: { deals: true, activities: true, tasks: true } },
};

const invalid = (path, msg) => ApiError.validation([{ path, msg }]);
const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();
const isEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/** Trimmed, de-duplicated tags of at most 40 characters. */
function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(/[;,]/);
  return [...new Set(list.map((t) => String(t).trim()).filter(Boolean).map((t) => t.slice(0, 40)))];
}

function checkStatus(status) {
  if (status !== undefined && !STATUSES.includes(status)) throw invalid('status', `status must be one of: ${STATUSES.join(', ')}`);
}

async function createContact(user, input) {
  const { firstName, lastName } = input;
  const email = normalizeEmail(input.email);
  if (!firstName?.trim() || !lastName?.trim() || !email) throw ApiError.badRequest('firstName, lastName and email are required');
  if (!isEmail(email)) throw invalid('email', 'Must be a valid email');
  checkStatus(input.status);
  const ownerId = (await resolveOwnerId(user, input.ownerId)) ?? user.id;

  const contact = await prisma.contact.create({
    data: {
      firstName:    firstName.trim(),
      lastName:     lastName.trim(),
      email,
      phone:        input.phone || null,
      title:        input.title || null,
      linkedinUrl:  input.linkedinUrl || null,
      companyId:    input.companyId || null,
      ownerId,
      tags:         cleanTags(input.tags),
      status:       input.status || 'LEAD',
      customFields: input.customFields || undefined,
    },
    include: CONTACT_LIST_INCLUDE,
  });
  emitScoped([contact.ownerId], 'contact:created', { contactId: contact.id });
  afterContactChange(contact.id, { created: true });
  return contact;
}

/** Editable fields only: scores, churn, sentiment and next best action are system-computed. */
async function updateContact(user, contactId, input, req) {
  const data = {};
  for (const field of EDITABLE) if (input[field] !== undefined) data[field] = input[field];
  if (data.email !== undefined) {
    data.email = normalizeEmail(data.email);
    if (!isEmail(data.email)) throw invalid('email', 'Must be a valid email');
  }
  for (const f of ['firstName', 'lastName']) {
    if (data[f] !== undefined && !String(data[f]).trim()) throw invalid(f, `${f} cannot be empty`);
  }
  checkStatus(data.status);
  if (data.tags !== undefined) data.tags = cleanTags(data.tags);
  for (const f of ['phone', 'title', 'linkedinUrl', 'companyId']) if (data[f] === '') data[f] = null;
  if (input.ownerId !== undefined) data.ownerId = await resolveOwnerId(user, input.ownerId);

  const where = { id: contactId, ...scopeFor(user, 'contact') };
  const before = await prisma.contact.findFirst({ where, select: { ownerId: true, ...Object.fromEntries(Object.keys(data).map((k) => [k, true])) } });
  if (!before) throw ApiError.notFound('Contact not found');

  const contact = await prisma.contact.update({ where, data, include: CONTACT_LIST_INCLUDE });
  if (req) await audit(req, { action: 'update', entityType: 'contact', entityId: contactId, before, after: data });

  // A reassigned contact also disappears from the previous owner's views.
  emitScoped([contact.ownerId, before.ownerId], 'contact:updated', { contactId: contact.id });
  afterContactChange(contact.id);
  return contact;
}

/** Index entries of contacts and of the deals and activities that are deleted with them (read before deleting). */
async function indexEntriesOf(contactIds) {
  const [deals, activities] = await Promise.all([
    prisma.deal.findMany({ where: { contactId: { in: contactIds } }, select: { id: true } }),
    prisma.activity.findMany({ where: { contactId: { in: contactIds } }, select: { id: true } }),
  ]);
  return { contact: contactIds, deal: deals.map((d) => d.id), activity: activities.map((a) => a.id) };
}

async function deleteContact(user, contactId, req) {
  const where = { id: contactId, ...scopeFor(user, 'contact') };
  const snapshot = await prisma.contact.findFirst({ where });
  if (!snapshot) throw ApiError.notFound('Contact not found');
  const indexed = await indexEntriesOf([contactId]);
  await prisma.$transaction(async (tx) => {
    await audit(req, { action: 'delete', entityType: 'contact', entityId: contactId, before: snapshot }, tx);
    await tx.contact.delete({ where });
  });
  await removeFromIndex(indexed);
  emitScoped([snapshot.ownerId], 'contact:deleted', { contactId });
}

/**
 * POST /contacts/bulk — every id is scope-checked; ids outside the caller's scope are skipped.
 * @returns {Promise<{ updated: number, skipped: number }>}
 */
async function bulkAction(user, { ids, action, ownerId, tag }, req) {
  if (!Array.isArray(ids) || !ids.length) throw invalid('ids', 'ids must be a non-empty array');
  if (ids.length > MAX_BULK) throw invalid('ids', `at most ${MAX_BULK} contacts per request`);
  if (!['assign', 'tag', 'untag', 'delete'].includes(action)) throw invalid('action', 'action must be assign, tag, untag or delete');

  const inScope = await prisma.contact.findMany({
    where:  { id: { in: [...new Set(ids)] }, ...scopeFor(user, 'contact') },
    select: { id: true, ownerId: true },
  });
  const targetIds = inScope.map((c) => c.id);
  const skipped = ids.length - targetIds.length;
  const owners = inScope.map((c) => c.ownerId);
  if (!targetIds.length) return { updated: 0, skipped };

  if (action === 'assign') {
    const newOwner = await resolveOwnerId(user, ownerId);
    if (!newOwner) throw invalid('ownerId', 'ownerId is required for assign');
    const { count } = await prisma.contact.updateMany({ where: { id: { in: targetIds } }, data: { ownerId: newOwner } });
    await audit(req, { action: 'bulk_assign', entityType: 'contact', after: { ids: targetIds, ownerId: newOwner } });
    emitScoped([...owners, newOwner], 'contact:updated', { contactIds: targetIds });
    targetIds.forEach((id) => reindex('contact', id));
    return { updated: count, skipped };
  }

  if (action === 'tag' || action === 'untag') {
    const [name] = cleanTags([tag]);
    if (!name) throw invalid('tag', 'tag is required');
    const count = action === 'tag'
      ? await prisma.$executeRaw`UPDATE "contacts" SET "tags" = array_append("tags", ${name}), "updatedAt" = NOW()
          WHERE "id" = ANY(${targetIds}::text[]) AND NOT (${name} = ANY("tags"))`
      : await prisma.$executeRaw`UPDATE "contacts" SET "tags" = array_remove("tags", ${name}), "updatedAt" = NOW()
          WHERE "id" = ANY(${targetIds}::text[]) AND ${name} = ANY("tags")`;
    if (action === 'tag') await prisma.tag.upsert({ where: { name }, create: { name }, update: {} });
    emitScoped(owners, 'contact:updated', { contactIds: targetIds });
    targetIds.forEach((id) => reindex('contact', id));
    return { updated: count, skipped: skipped + (targetIds.length - count) };
  }

  // delete
  const snapshots = await prisma.contact.findMany({ where: { id: { in: targetIds } } });
  const indexed = await indexEntriesOf(targetIds);
  await prisma.$transaction(async (tx) => {
    for (const before of snapshots) await audit(req, { action: 'delete', entityType: 'contact', entityId: before.id, before }, tx);
    await tx.contact.deleteMany({ where: { id: { in: targetIds } } });
  });
  await removeFromIndex(indexed);
  emitScoped(owners, 'contact:deleted', { contactIds: targetIds });
  return { updated: snapshots.length, skipped };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';

/** Finds a company by name (case-insensitive) or creates one, using the email domain when it is a business domain. */
async function companyFor(name, email, cache) {
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  let company = await prisma.company.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
  if (!company) {
    const emailDomain = email.split('@')[1];
    const candidates = [!FREE_MAIL.has(emailDomain) && emailDomain, slug(name)].filter(Boolean);
    for (const domain of candidates) {
      const existing = await prisma.company.findUnique({ where: { domain }, select: { id: true } });
      if (existing) { company = existing; break; }
    }
    if (!company) {
      company = await prisma.company.upsert({
        where: { domain: candidates[0] }, create: { name, domain: candidates[0] }, update: {}, select: { id: true },
      });
    }
  }
  cache.set(key, company.id);
  return company.id;
}

/**
 * POST /contacts/import — rows already mapped to contact fields by the client.
 * Upserts by email: new contacts are created for the caller; existing ones in scope
 * only get their empty fields filled; contacts owned by someone else are reported.
 * @returns {Promise<{ created: number, updated: number, failed: { row: number, reason: string }[] }>}
 */
async function importContacts(user, rows) {
  if (!Array.isArray(rows) || !rows.length) throw invalid('rows', 'rows must be a non-empty array');
  if (rows.length > MAX_IMPORT) throw invalid('rows', `at most ${MAX_IMPORT} rows per import`);

  const result = { created: 0, updated: 0, failed: [] };
  const companies = new Map();
  const seen = new Set();

  for (const [index, raw] of rows.entries()) {
    const row = index + 1;
    try {
      const email = normalizeEmail(raw.email);
      if (!isEmail(email)) { result.failed.push({ row, reason: 'Missing or invalid email' }); continue; }
      if (seen.has(email)) { result.failed.push({ row, reason: 'Duplicate email in file' }); continue; }
      seen.add(email);

      const status = raw.status ? String(raw.status).trim().toUpperCase() : undefined;
      if (status && !STATUSES.includes(status)) { result.failed.push({ row, reason: `Unknown status "${raw.status}"` }); continue; }

      const companyName = String(raw.company ?? '').trim();
      const companyId = companyName ? await companyFor(companyName, email, companies) : null;
      const tags = cleanTags(raw.tags);
      const fields = {
        firstName: String(raw.firstName ?? '').trim(),
        lastName:  String(raw.lastName ?? '').trim(),
        phone:     String(raw.phone ?? '').trim() || null,
        title:     String(raw.title ?? '').trim() || null,
      };

      const existing = await prisma.contact.findUnique({
        where:  { email },
        select: { id: true, ownerId: true, phone: true, title: true, companyId: true, tags: true },
      });

      if (!existing) {
        if (!fields.firstName || !fields.lastName) { result.failed.push({ row, reason: 'Missing first or last name' }); continue; }
        await prisma.contact.create({
          data: { ...fields, email, companyId, tags, status: status || 'LEAD', ownerId: user.id },
        });
        result.created += 1;
        continue;
      }

      if (!isPrivileged(user) && existing.ownerId !== user.id) {
        result.failed.push({ row, reason: 'A contact with this email belongs to another user' });
        continue;
      }
      // Fill only what is empty, so an import never overwrites CRM data.
      await prisma.contact.update({
        where: { id: existing.id },
        data: {
          phone:     existing.phone ?? fields.phone,
          title:     existing.title ?? fields.title,
          companyId: existing.companyId ?? companyId,
          tags:      [...new Set([...existing.tags, ...tags])],
        },
      });
      result.updated += 1;
    } catch (err) {
      result.failed.push({ row, reason: err.code === 'P2002' ? 'Duplicate value' : 'Could not save this row' });
    }
  }

  if (result.created || result.updated) {
    emitScoped([user.id], 'contact:created', { imported: result.created + result.updated });
    afterBulkChange();
  }
  return result;
}

module.exports = {
  STATUSES, CONTACT_LIST_INCLUDE,
  createContact, updateContact, deleteContact, bulkAction, importContacts, cleanTags,
};
