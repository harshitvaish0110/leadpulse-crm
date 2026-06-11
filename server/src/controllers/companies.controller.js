/**
 * LeadPulse CRM — Companies Controller
 */

'use strict';

const { prisma }   = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');

const COMPANY_LIST_INCLUDE = {
  _count: { select: { contacts: true } },
};

const COMPANY_DETAIL_INCLUDE = {
  contacts: {
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, firstName: true, lastName: true,
      email: true, title: true, status: true, leadScore: true,
      _count: { select: { deals: true } },
    },
  },
  _count: { select: { contacts: true } },
};

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

    res.status(201).json({ success: true, company });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const company = await prisma.company.findUnique({
      where:   { id: req.params.id },
      include: COMPANY_DETAIL_INCLUDE,
    });

    if (!company) throw ApiError.notFound('Company not found');
    res.json({ success: true, company });
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
    res.json({ success: true, message: 'Company deleted' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, getOne, update, remove };
