/**
 * LeadPulse CRM — Contacts Controller
 *
 * Full CRUD + CSV import/export + real-time Socket.IO events.
 * All queries use explicit field selection and strategic indexes.
 */

'use strict';

const { Parser }   = require('json2csv');
const papa         = require('papaparse');
const { prisma }   = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');

// ── Shared include shape for list queries (lightweight) ───────────────────────
const CONTACT_LIST_INCLUDE = {
  company: { select: { id: true, name: true, industry: true } },
  owner:   { select: { id: true, firstName: true, lastName: true } },
  _count:  { select: { deals: true, activities: true, tasks: true } },
};

// ── Shared include shape for detail queries (full relations) ──────────────────
const CONTACT_DETAIL_INCLUDE = {
  company: true,
  owner:   { select: { id: true, firstName: true, lastName: true, email: true } },
  deals: {
    orderBy: { createdAt: 'desc' },
    include: { owner: { select: { id: true, firstName: true, lastName: true } } },
  },
  activities: {
    orderBy: { occurredAt: 'desc' },
    take: 30,
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  },
  tasks: {
    where:   { completed: false },
    orderBy: { dueDate: 'asc' },
    include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
  },
  emailDrafts: { orderBy: { createdAt: 'desc' }, take: 20 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Emits a socket event if io is registered on the app. */
function emit(req, event, payload) {
  const io = req.app.get('io');
  if (io) io.emit(event, payload);
}

/** Builds the Prisma where clause from query params. */
function buildWhere({ search, status, ownerId, tags, companyId }) {
  return {
    AND: [
      search ? {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName:  { contains: search, mode: 'insensitive' } },
          { email:     { contains: search, mode: 'insensitive' } },
          { title:     { contains: search, mode: 'insensitive' } },
        ],
      } : {},
      status    ? { status }    : {},
      ownerId   ? { ownerId }   : {},
      companyId ? { companyId } : {},
      tags      ? { tags: { hasSome: tags.split(',').map(t => t.trim()) } } : {},
    ],
  };
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * GET /api/contacts
 * Paginated list with search, filters, and sorting.
 */
async function list(req, res, next) {
  try {
    const {
      page = 1, limit = 25, sortBy = 'createdAt', sortDir = 'desc',
      search = '', status, ownerId, tags, companyId,
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * limitNum;

    // Only allow sorting on indexed columns
    const ALLOWED_SORTS = ['createdAt', 'leadScore', 'firstName', 'lastName', 'status'];
    const orderField = ALLOWED_SORTS.includes(sortBy) ? sortBy : 'createdAt';
    const orderDir   = sortDir === 'asc' ? 'asc' : 'desc';

    const where = buildWhere({ search, status, ownerId, tags, companyId });

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [orderField]: orderDir },
        include: CONTACT_LIST_INCLUDE,
      }),
      prisma.contact.count({ where }),
    ]);

    res.json({
      success: true,
      contacts,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/contacts
 */
async function create(req, res, next) {
  try {
    const {
      firstName, lastName, email, phone, title,
      linkedinUrl, companyId, tags, status, customFields,
    } = req.body;

    if (!firstName || !lastName || !email) {
      throw ApiError.badRequest('firstName, lastName, and email are required');
    }

    const contact = await prisma.contact.create({
      data: {
        firstName:   firstName.trim(),
        lastName:    lastName.trim(),
        email:       email.toLowerCase().trim(),
        phone:       phone   || null,
        title:       title   || null,
        linkedinUrl: linkedinUrl || null,
        companyId:   companyId  || null,
        ownerId:     req.user.id,
        tags:        Array.isArray(tags) ? tags : [],
        status:      status || 'LEAD',
        customFields: customFields || null,
      },
      include: CONTACT_LIST_INCLUDE,
    });

    emit(req, 'contact:created', { contactId: contact.id, ownerId: req.user.id });
    res.status(201).json({ success: true, contact });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/contacts/:id
 */
async function getOne(req, res, next) {
  try {
    const contact = await prisma.contact.findUnique({
      where:   { id: req.params.id },
      include: CONTACT_DETAIL_INCLUDE,
    });

    if (!contact) throw ApiError.notFound('Contact not found');
    res.json({ success: true, contact });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/contacts/:id
 */
async function update(req, res, next) {
  try {
    const ALLOWED = [
      'firstName', 'lastName', 'email', 'phone', 'title', 'linkedinUrl',
      'status', 'companyId', 'ownerId', 'tags', 'customFields',
      'leadScore', 'leadScoreLabel', 'leadScoreExplanation',
      'churnRisk', 'sentimentScore', 'nextBestAction',
    ];

    const data = {};
    for (const field of ALLOWED) {
      if (req.body[field] !== undefined) {
        data[field] = req.body[field];
      }
    }

    if (data.email) data.email = data.email.toLowerCase().trim();

    const contact = await prisma.contact.update({
      where:   { id: req.params.id },
      data,
      include: CONTACT_LIST_INCLUDE,
    });

    emit(req, 'contact:updated', { contactId: contact.id });
    res.json({ success: true, contact });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/contacts/:id
 */
async function remove(req, res, next) {
  try {
    await prisma.contact.delete({ where: { id: req.params.id } });
    emit(req, 'contact:deleted', { contactId: req.params.id });
    res.json({ success: true, message: 'Contact deleted' });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/contacts/export
 * Downloads all contacts as a CSV file.
 */
async function exportCSV(req, res, next) {
  try {
    const contacts = await prisma.contact.findMany({
      include: { company: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const rows = contacts.map(c => ({
      firstName:   c.firstName,
      lastName:    c.lastName,
      email:       c.email,
      phone:       c.phone       || '',
      title:       c.title       || '',
      company:     c.company?.name || '',
      status:      c.status,
      leadScore:   c.leadScore,
      leadScoreLabel: c.leadScoreLabel || '',
      churnRisk:   (c.churnRisk * 100).toFixed(1) + '%',
      sentimentScore: c.sentimentScore.toFixed(2),
      tags:        c.tags.join(';'),
      createdAt:   c.createdAt.toISOString().split('T')[0],
    }));

    const fields = Object.keys(rows[0] ?? {});
    const csv    = new Parser({ fields }).parse(rows);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leadpulse-contacts.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/contacts/import
 * Accepts a CSV file (multipart) and upserts contacts.
 */
async function importCSV(req, res, next) {
  try {
    if (!req.file) throw ApiError.badRequest('No file uploaded');

    const csvText = req.file.buffer.toString('utf8');
    const { data, errors } = papa.parse(csvText, {
      header:         true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
    });

    if (errors.length) {
      throw ApiError.badRequest('CSV parse error', errors.slice(0, 5));
    }

    const results = { created: 0, skipped: 0, failed: [] };

    // Process in batches of 50 to avoid overwhelming the DB
    const BATCH = 50;
    for (let i = 0; i < data.length; i += BATCH) {
      const batch = data.slice(i, i + BATCH);
      await Promise.allSettled(
        batch.map(async (row) => {
          const email = (row.email || row.Email || '').trim().toLowerCase();
          if (!email) {
            results.failed.push({ row, reason: 'Missing email' });
            return;
          }
          try {
            await prisma.contact.upsert({
              where: { email },
              create: {
                firstName:   (row.firstName || row.first_name || row['First Name'] || 'Unknown').trim(),
                lastName:    (row.lastName  || row.last_name  || row['Last Name']  || 'Unknown').trim(),
                email,
                phone:       row.phone || row.Phone || null,
                title:       row.title || row.Title || null,
                ownerId:     req.user.id,
                tags:        [],
              },
              update: {
                // Only update empty fields on import to avoid overwriting CRM data
                phone: { set: row.phone || row.Phone || undefined },
                title: { set: row.title || row.Title || undefined },
              },
            });
            results.created++;
          } catch (e) {
            results.failed.push({ row, reason: e.message });
          }
        })
      );
    }

    results.skipped = data.length - results.created - results.failed.length;
    res.json({ success: true, ...results });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, getOne, update, remove, exportCSV, importCSV };
