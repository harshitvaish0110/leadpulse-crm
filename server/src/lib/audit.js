/**
 * LeadPulse — Audit trail. `audit_logs` is append-only (a trigger rejects
 * UPDATE and DELETE), so entries are written once and never edited.
 */

'use strict';

const { prisma } = require('./prisma');

/** Dates and Decimals become plain JSON values. */
const toJson = (value) => (value === undefined || value === null ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Records who did what. `before`/`after` are snapshots of the record.
 * @param {import('express').Request|null} req  source of actor, request id and IP (null for system jobs)
 * @param {{ action: string, entityType: string, entityId?: string, before?: object, after?: object }} entry
 * @param {object} [db]  a transaction client, so the entry commits with the change it describes
 */
function audit(req, { action, entityType, entityId, before, after }, db = prisma) {
  return db.auditLog.create({
    data: {
      actorId:   req?.user?.id ?? null,
      action,
      entityType,
      entityId:  entityId ?? null,
      before:    toJson(before),
      after:     toJson(after),
      requestId: req?.id ?? null,
      ip:        req?.ip ?? null,
    },
  });
}

module.exports = { audit };
