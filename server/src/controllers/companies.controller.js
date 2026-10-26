/**
 * LeadPulse CRM — Companies Controller
 */

'use strict';

const { prisma }   = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { scoped, scopeFor } = require('../middleware/auth.middleware');
const { afterCompanyChange } = require('../queues/triggers');
const { removeFromIndex } = require('../services/semanticIndex.service');

const COMPANY_LIST_INCLUDE = {
  _count: { select: { contacts: true } },
};

/** Companies are org-shared; the contact sub-list follows the caller's contact scope. */
const companyDetailInclude = (user) => ({
  contacts: {
    where: scopeFor(user, 'contact'),
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, firstName: true, lastName: true,
      email: true, title: true, status: true, leadScore: true,
      _count: { select: { deals: true } },
    },
  },
  _count: { select: { contacts: true } },
});

function buildWhere({ search, industry, country }) {
  return {
    AND: [
      search ? {
        OR: [
          { name:   { contains: search, mode: 'insensitive' } },
          { domain: { contains: search, mode: 'insensitive' } },
        ],
      } : {},
      industry ? { industry } : {},
      country  ? { country }  : {},
    ],
  };
}

async function list(req, res, next) {
  try {
    const { page = 1, limit = 25, search = '', industry, country, sortBy = 'name', sortDir = 'asc' } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * limitNum;
    const where    = buildWhere({ search, industry, country });

    const ALLOWED_SORTS = ['name', 'createdAt', 'size'];
    const orderField = ALLOWED_SORTS.includes(sortBy) ? sortBy : 'name';

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        skip,
        take:    limitNum,
        orderBy: { [orderField]: sortDir === 'desc' ? 'desc' : 'asc' },
        include: COMPANY_LIST_INCLUDE,
      }),
      prisma.company.count({ where }),
    ]);

    res.json({
      success: true,
      companies,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { name, domain, industry, size, country, website, description } = req.body;

    if (!name || !domain) throw ApiError.badRequest('name and domain are required');

    const company = await prisma.company.create({
      data: {
        name:        name.trim(),
        domain:      domain.toLowerCase().trim(),
        industry:    industry    || null,
        size:        size        ? parseInt(size, 10) : null,
        country:     country     || null,
        website:     website     || null,
        description: description || null,
      },
      include: COMPANY_LIST_INCLUDE,
    });

    afterCompanyChange(company.id);
    res.status(201).json({ success: true, company });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const company = await prisma.company.findUnique({
      where:   { id: req.params.id },
      include: companyDetailInclude(req.user),
    });
    if (!company) throw ApiError.notFound('Company not found');

    // Counts follow the caller's scope, like the tabs they summarise.
    const atCompany = { contact: { companyId: company.id } };
    const [contacts, deals, activities] = await Promise.all([
      prisma.contact.count({ where: scoped(req.user, 'contact', { companyId: company.id }) }),
      prisma.deal.count({ where: scoped(req.user, 'deal', atCompany) }),
      prisma.activity.count({ where: scoped(req.user, 'activity', atCompany) }),
    ]);
    res.json({ success: true, company: { ...company, stats: { contacts, deals, activities } } });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const ALLOWED = ['name', 'domain', 'industry', 'size', 'country', 'website', 'description'];
    const data = {};
    for (const f of ALLOWED) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }
    if (data.domain) data.domain = data.domain.toLowerCase().trim();
    if (data.size)   data.size   = parseInt(data.size, 10);

    const company = await prisma.company.update({
      where:   { id: req.params.id },
      data,
      include: COMPANY_LIST_INCLUDE,
    });

    afterCompanyChange(company.id);
    res.json({ success: true, company });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    // Guard: don't delete companies that still have contacts
    const contactCount = await prisma.contact.count({ where: { companyId: req.params.id } });
    if (contactCount > 0) {
      throw ApiError.conflict(
        `Cannot delete — ${contactCount} contact(s) are linked to this company. Reassign them first.`
      );
    }

    await prisma.company.delete({ where: { id: req.params.id } });
    await removeFromIndex({ company: [req.params.id] });
    res.json({ success: true, message: 'Company deleted' });
  } catch (err) {
    next(err);
  }
}

/** GET /api/companies/industries — distinct industries for the list filter. */
async function industries(_req, res) {
  const rows = await prisma.company.findMany({
    where: { industry: { not: null } }, distinct: ['industry'], select: { industry: true }, orderBy: { industry: 'asc' },
  });
  res.json({ success: true, industries: rows.map((r) => r.industry) });
}

module.exports = { list, create, getOne, update, remove, industries };
