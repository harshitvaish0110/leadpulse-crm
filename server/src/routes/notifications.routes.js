/**
 * LeadPulse CRM — The signed-in user's notifications.
 *
 * GET   /api/notifications?unread=true&limit=20   { notifications, unread }
 * PATCH /api/notifications/read-all
 * PATCH /api/notifications/:id/read
 */

'use strict';

const { Router } = require('express');
const { prisma } = require('../lib/prisma');
const { NOTIFICATION_SELECT } = require('../lib/notify');
const { authenticate, scopeFor } = require('../middleware/auth.middleware');

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const mine = scopeFor(req.user, 'notification');
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({
      where:   { ...mine, ...(req.query.unread === 'true' && { readAt: null }) },
      orderBy: { createdAt: 'desc' },
      take:    limit,
      select:  NOTIFICATION_SELECT,
    }),
    prisma.notification.count({ where: { ...mine, readAt: null } }),
  ]);
  res.json({ success: true, notifications, unread });
});

router.patch('/read-all', async (req, res) => {
  const { count } = await prisma.notification.updateMany({
    where: { ...scopeFor(req.user, 'notification'), readAt: null },
    data:  { readAt: new Date() },
  });
  res.json({ success: true, updated: count });
});

router.patch('/:id/read', async (req, res) => {
  const notification = await prisma.notification.update({
    where:  { id: req.params.id, ...scopeFor(req.user, 'notification') },
    data:   { readAt: new Date() },
    select: NOTIFICATION_SELECT,
  });
  res.json({ success: true, notification });
});

module.exports = router;
