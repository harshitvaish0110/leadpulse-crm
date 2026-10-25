/**
 * LeadPulse CRM — Contacts Controller
 *
 * Reads, export and snapshots live here; writes go through contacts.service.
 */

'use strict';

const { Parser }   = require('json2csv');
const { prisma }   = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { scoped, scopeFor, assertContactInScope } = require('../middleware/auth.middleware');
const contacts = require('../services/contacts.service');

const { CONTACT_LIST_INCLUDE } = contacts;

const CONTACT_DETAIL_INCLUDE = {
  company: true,
  owner:   { select: { id: true, firstName: true, lastName: true, email: true } },
  deals: {
    where:   { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } },
    orderBy: { createdAt: 'desc' },
    select:  { id: true, title: true, value: true, stage: true, winProbability: true, expectedCloseDate: true, stageChangedAt: true },
  },
  _count: { select: { deals: true, activities: true, tasks: true, emailDrafts: true } },
};

const SORTABLE = ['createdAt', 'firstName', 'lastName', 'leadScore', 'churnRisk', 'status'];
const SNAPSHOT_METRICS = ['leadScore', 'churnRisk', 'sentimentScore'];

/** Where clause for list and export filters, limited to the caller's scope. */
function buildWhere(user, { search, status, ownerId, tags, companyId, scoreLabel, atRisk, ids }) {
  const term = String(search ?? '').trim();
  return scoped(user, 'contact', {
    AND: [
      ids ? { id: { in: String(ids).split(',').map((id) => id.trim()).filter(Boolean) } } : {},
      term ? {
        OR: [
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName:  { contains: term, mode: 'insensitive' } },
          { email:     { contains: term, mode: 'insensitive' } },
          { title:     { contains: term, mode: 'insensitive' } },
        ],
      } : {},
      status     ? { status }     : {},
      ownerId    ? { ownerId: ownerId === 'none' ? null : ownerId } : {},
      companyId  ? { companyId }  : {},
      scoreLabel ? { leadScoreLabel: String(scoreLabel).toUpperCase() } : {},
      tags       ? { tags: { hasSome: String(tags).split(',').map((t) => t.trim()).filter(Boolean) } } : {},
      atRisk === 'true' ? { OR: [{ churnRisk: { gt: 0.6 } }, { sentimentScore: { lt: 0.3 } }] } : {},
    ],
  });
}

const orderFor = ({ sortBy, sortDir }) => ({
  [SORTABLE.includes(sortBy) ? sortBy : 'createdAt']: sortDir === 'asc' ? 'asc' : 'desc',
});

/** GET /api/contacts */
async function list(req, res) {
  const pageNum  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const where = buildWhere(req.user, req.query);

  const [items, total] = await Promise.all([
    prisma.contact.findMany({
      where, skip: (pageNum - 1) * limitNum, take: limitNum,
      orderBy: [orderFor(req.query), { id: 'asc' }],
      include: CONTACT_LIST_INCLUDE,
    }),
    prisma.contact.count({ where }),
  ]);

  res.json({
    success: true,
    contacts: items,
    meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
  });
}

/** POST /api/contacts */
async function create(req, res) {
  res.status(201).json({ success: true, contact: await contacts.createContact(req.user, req.body ?? {}) });
}

/** GET /api/contacts/:id */
async function getOne(req, res) {
  const contact = await prisma.contact.findFirst({
    where:   { id: req.params.id, ...scopeFor(req.user, 'contact') },
    include: CONTACT_DETAIL_INCLUDE,
  });
  if (!contact) throw ApiError.notFound('Contact not found');
  res.json({ success: true, contact });
}

/** PATCH /api/contacts/:id */
async function update(req, res) {
  res.json({ success: true, contact: await contacts.updateContact(req.user, req.params.id, req.body ?? {}, req) });
}

/** DELETE /api/contacts/:id — writes an audit snapshot; deals, activities and emails cascade. */
async function remove(req, res) {
  await contacts.deleteContact(req.user, req.params.id, req);
  res.json({ success: true, message: 'Contact deleted' });
}

/** POST /api/contacts/bulk — `{ ids, action: assign|tag|untag|delete, ownerId?, tag? }` */
async function bulk(req, res) {
  res.json({ success: true, ...(await contacts.bulkAction(req.user, req.body ?? {}, req)) });
}

/** POST /api/contacts/import — `{ rows: [{ firstName, lastName, email, phone, title, company, tags, status }] }` */
async function importRows(req, res) {
  res.json({ success: true, ...(await contacts.importContacts(req.user, req.body?.rows)) });
}

const EXPORT_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'title', 'company', 'status',
  'leadScore', 'leadScoreLabel', 'churnRisk', 'sentimentScore', 'tags', 'owner', 'createdAt'];

/**
 * GET /api/contacts/export — the caller's contacts matching the list filters
 * (or `ids=a,b,c`), as UTF-8 CSV with a BOM so spreadsheet apps detect the encoding.
 */
async function exportCSV(req, res) {
  const rows = await prisma.contact.findMany({
    where:   buildWhere(req.user, req.query),
    include: { company: { select: { name: true } }, owner: { select: { firstName: true, lastName: true } } },
    orderBy: [orderFor(req.query), { id: 'asc' }],
    take:    10_000,
  });

  const csv = new Parser({ fields: EXPORT_FIELDS }).parse(rows.map((c) => ({
    firstName:      c.firstName,
    lastName:       c.lastName,
    email:          c.email,
    phone:          c.phone || '',
    title:          c.title || '',
    company:        c.company?.name || '',
    status:         c.status,
    leadScore:      c.leadScore,
    leadScoreLabel: c.leadScoreLabel || '',
    churnRisk:      c.churnRisk.toFixed(3),
    sentimentScore: c.sentimentScore.toFixed(2),
    tags:           c.tags.join(';'),
    owner:          c.owner ? `${c.owner.firstName} ${c.owner.lastName}` : '',
    createdAt:      c.createdAt.toISOString().slice(0, 10),
  })));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leadpulse-contacts.csv"');
  res.send(`﻿${csv}`);
}

/** GET /api/contacts/:id/snapshots?metric=leadScore|churnRisk|sentimentScore&days=90 */
async function snapshots(req, res) {
  await assertContactInScope(req.user, req.params.id);
  const metric = req.query.metric || 'leadScore';
  if (!SNAPSHOT_METRICS.includes(metric)) {
    throw ApiError.validation([{ path: 'metric', msg: `metric must be one of: ${SNAPSHOT_METRICS.join(', ')}` }]);
  }
  const days = Math.min(730, Math.max(1, parseInt(req.query.days, 10) || 90));
  const points = await prisma.scoreSnapshot.findMany({
    where:   { entityType: 'contact', entityId: req.params.id, metric, takenAt: { gte: new Date(Date.now() - days * 86_400_000) } },
    orderBy: { takenAt: 'asc' },
    select:  { takenAt: true, value: true },
  });
  res.json({ success: true, metric, points });
}

module.exports = { list, create, getOne, update, remove, bulk, importRows, exportCSV, snapshots };
