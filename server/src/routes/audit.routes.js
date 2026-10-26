/**
 * LeadPulse — Audit log (ADMIN). Entries are append-only; this only reads them.
 * GET /api/audit-logs?entityType=&entityId=&actorId=&action=&page=&limit=
 */

'use strict';

const { Router } = require('express');
const { prisma } = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

const router = Router();
router.use(authenticate, requireRole('ADMIN'));

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : undefined);

router.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const where = Object.fromEntries(Object.entries({
    entityType: text(req.query.entityType), entityId: text(req.query.entityId),
    actorId: text(req.query.actorId), action: text(req.query.action),
  }).filter(([, v]) => v !== undefined));

  const [rows, total, types] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } }),
  ]);
  // audit_logs has no foreign keys (it must outlive deleted users), so actors are looked up here.
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))];
  const actors = new Map((await prisma.user.findMany({
    where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true, email: true },
  })).map((u) => [u.id, u]));

  res.json({
    success: true,
    entries: rows.map((r) => ({ ...r, actor: r.actorId ? actors.get(r.actorId) ?? { id: r.actorId, deleted: true } : null })),
    entityTypes: types.map((t) => t.entityType),
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
});

module.exports = router;
