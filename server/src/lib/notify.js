/**
 * LeadPulse — Persisted notifications. Each one is stored for the bell (so it
 * survives a reload) and pushed live to the user as `notification:new`.
 */

'use strict';

const { prisma } = require('./prisma');
const { emitToUsers } = require('./realtime');
const { logger } = require('./logger');

const SELECT = { id: true, type: true, title: true, message: true, link: true, data: true, readAt: true, createdAt: true };

/**
 * @param {string[]} userIds  recipients (falsy and duplicate ids are ignored)
 * @param {{ type: string, title: string, message: string, link?: string, data?: object }} notification
 */
async function notify(userIds, { type, title, message, link = null, data = undefined }) {
  const recipients = [...new Set(userIds.filter(Boolean))];
  await Promise.all(recipients.map(async (userId) => {
    try {
      const row = await prisma.notification.create({
        data: { userId, type, title, message: String(message).slice(0, 500), link, data },
        select: SELECT,
      });
      emitToUsers([userId], 'notification:new', row);
    } catch (err) {
      logger.warn({ event: 'notify_failed', err: err.message }, 'Notification failed');
    }
  }));
}

module.exports = { notify, NOTIFICATION_SELECT: SELECT };
