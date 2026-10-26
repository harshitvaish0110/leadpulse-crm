/**
 * LeadPulse — Workspace configuration: name, timezone and currency, pipeline
 * stages and tags. Reads are open to every role; writes are ADMIN only (routes).
 *
 * Pipeline stages: every base stage keeps at least one column, so a deal moved
 * by base stage (the approval gate, imports) always has a column to land in.
 * Deleting a column that still holds deals moves them through changeStage, so
 * history, close dates, scores and webhooks behave as if each was dragged.
 *
 * Tags: contacts store tag names; the `tags` table holds their colour and
 * lead-source flag. Renames and deletes rewrite every contact in one statement.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { audit } = require('../lib/audit');
const { logger } = require('../lib/logger');
const { workspace, setWorkspace } = require('../lib/workspace');
const { ApiError } = require('../middleware/error.middleware');
const { registerSchedules } = require('../queues/queue');
const { reindex, afterBulkChange } = require('../queues/triggers');
const { DEAL_STAGES, changeStage } = require('./deals.service');

const HEX = /^#[0-9a-f]{6}$/i;
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const WORKSPACE_SELECT = { companyName: true, timezone: true, currency: true };
const STAGE_SELECT = { id: true, label: true, color: true, baseStage: true, position: true };
const TAG_SELECT = { id: true, name: true, color: true, isSource: true };

const invalid = (path, msg) => ApiError.validation([{ path, msg }]);

function isTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ── Workspace ──────────────────────────────────────────────────────────────────

async function getWorkspace() {
  const row = await prisma.orgSettings.findUnique({ where: { id: 1 }, select: WORKSPACE_SELECT });
  return { ...workspace(), ...row };
}

async function updateWorkspace(req, input) {
  const data = {};
  if (input.companyName !== undefined) {
    const name = String(input.companyName).trim();
    // It appears in email subjects, so no control characters (a newline there would start a new header).
    if (!name || name.length > 80 || /\p{Cc}/u.test(name)) throw invalid('companyName', 'The workspace name must be 1–80 characters on one line');
    data.companyName = name;
  }
  if (input.timezone !== undefined) {
    if (!isTimezone(input.timezone)) throw invalid('timezone', 'Unknown timezone');
    data.timezone = input.timezone;
  }
  if (input.currency !== undefined) {
    const code = String(input.currency).toUpperCase();
    if (!CURRENCIES.has(code)) throw invalid('currency', 'Unknown currency code');
    data.currency = code;
  }

  const before = await getWorkspace();
  const row = await prisma.orgSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data, select: WORKSPACE_SELECT });
  await audit(req, { action: 'update', entityType: 'workspace', entityId: '1', before, after: data });
  setWorkspace(row);
  // The nightly pipeline runs at SCORING_CRON in the workspace timezone.
  if (data.timezone && data.timezone !== before.timezone && process.env.NODE_ENV !== 'test') {
    registerSchedules().catch((err) => logger.warn({ event: 'schedules_update_failed', err: err.message }, 'Could not move the job schedules'));
  }
  return row;
}

// ── Pipeline stages ────────────────────────────────────────────────────────────

/** Board columns in order; admins also get each column's deal count for the editor. */
async function listStages(user) {
  const admin = user.role === 'ADMIN';
  const stages = await prisma.pipelineStage.findMany({
    orderBy: { position: 'asc' },
    select: { ...STAGE_SELECT, ...(admin && { _count: { select: { deals: true } } }) },
  });
  return stages.map(({ _count, ...s }) => (admin ? { ...s, dealCount: _count.deals } : s));
}

function stageFields(input, { partial }) {
  const data = {};
  if (input.label !== undefined || !partial) {
    const label = String(input.label ?? '').trim();
    if (!label || label.length > 40) throw invalid('label', 'The stage name must be 1–40 characters');
    data.label = label;
  }
  if (input.color !== undefined) {
    if (!HEX.test(input.color)) throw invalid('color', 'color must be a hex colour such as #6366f1');
    data.color = input.color.toLowerCase();
  }
  if (input.baseStage !== undefined || !partial) {
    if (!DEAL_STAGES.includes(input.baseStage)) throw invalid('baseStage', `baseStage must be one of: ${DEAL_STAGES.join(', ')}`);
    data.baseStage = input.baseStage;
  }
  return data;
}

/** A new column goes right after the last column with the same base stage. */
async function createStage(req, input) {
  const data = stageFields(input, { partial: false });
  return prisma.$transaction(async (tx) => {
    const sibling = await tx.pipelineStage.findFirst({ where: { baseStage: data.baseStage }, orderBy: { position: 'desc' }, select: { position: true } });
    const last = await tx.pipelineStage.aggregate({ _max: { position: true } });
    const position = sibling ? sibling.position + 1 : (last._max.position ?? -1) + 1;
    await tx.pipelineStage.updateMany({ where: { position: { gte: position } }, data: { position: { increment: 1 } } });
    const stage = await tx.pipelineStage.create({ data: { ...data, position }, select: STAGE_SELECT });
    await audit(req, { action: 'create', entityType: 'pipeline_stage', entityId: stage.id, after: stage }, tx);
    return stage;
  });
}

async function updateStage(req, id, input) {
  const data = stageFields(input, { partial: true });
  const before = await prisma.pipelineStage.findUnique({ where: { id }, select: { ...STAGE_SELECT, _count: { select: { deals: true } } } });
  if (!before) throw ApiError.notFound('Pipeline stage not found');

  if (data.baseStage && data.baseStage !== before.baseStage) {
    // Deals' base stage drives scores, analytics and close dates; it changes only by moving the deal.
    if (before._count.deals) throw ApiError.conflict(`Move the ${before._count.deals} deals out of "${before.label}" before changing what it maps to`);
    const siblings = await prisma.pipelineStage.count({ where: { baseStage: before.baseStage } });
    if (siblings <= 1) throw ApiError.conflict(`"${before.label}" is the only column for ${before.baseStage}; add another one first`);
  }

  const { _count, ...snapshot } = before;
  const stage = await prisma.pipelineStage.update({ where: { id }, data, select: STAGE_SELECT });
  await audit(req, { action: 'update', entityType: 'pipeline_stage', entityId: id, before: snapshot, after: data });
  return stage;
}

/** `ids` must list every stage exactly once, in the new order. */
async function reorderStages(req, ids) {
  const existing = await prisma.pipelineStage.findMany({ select: { id: true } });
  const all = new Set(existing.map((s) => s.id));
  if (!Array.isArray(ids) || ids.length !== all.size || new Set(ids).size !== ids.length || !ids.every((id) => all.has(id))) {
    throw invalid('ids', 'ids must list every pipeline stage exactly once');
  }
  await prisma.$transaction([
    ...ids.map((id, position) => prisma.pipelineStage.update({ where: { id }, data: { position } })),
    audit(req, { action: 'reorder', entityType: 'pipeline_stage', after: { ids } }),
  ]);
  return listStages(req.user);
}

/** Deletes a column; its deals move to `moveTo` first. */
async function removeStage(req, id, moveTo) {
  const stage = await prisma.pipelineStage.findUnique({ where: { id }, select: { ...STAGE_SELECT, _count: { select: { deals: true } } } });
  if (!stage) throw ApiError.notFound('Pipeline stage not found');
  const siblings = await prisma.pipelineStage.count({ where: { baseStage: stage.baseStage } });
  if (siblings <= 1) throw ApiError.conflict(`"${stage.label}" is the only column for ${stage.baseStage}; every base stage needs one`);

  let moved = 0;
  if (stage._count.deals) {
    if (!moveTo || moveTo === id) throw invalid('moveTo', `Choose where the ${stage._count.deals} deals in "${stage.label}" should go`);
    if (!(await prisma.pipelineStage.findUnique({ where: { id: moveTo }, select: { id: true } }))) throw invalid('moveTo', 'Unknown pipeline stage');
    const deals = await prisma.deal.findMany({ where: { pipelineStageId: id }, select: { id: true } });
    // One changeStage per deal, inside the request (about 10 ms each). Fine for hundreds; move it to a job if columns hold thousands.
    for (const deal of deals) await changeStage(req.user, deal.id, { pipelineStageId: moveTo });
    moved = deals.length;
  }

  const { _count, ...snapshot } = stage;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.pipelineStage.delete({ where: { id, deals: { none: {} } } });
      await audit(req, { action: 'delete', entityType: 'pipeline_stage', entityId: id, before: snapshot, after: { movedTo: moveTo ?? null, moved } }, tx);
    });
  } catch (err) {
    if (err.code === 'P2025') throw ApiError.conflict('Deals were added to this stage meanwhile; try again');
    throw err;
  }
  return { moved };
}

// ── Tags ───────────────────────────────────────────────────────────────────────

/** Trimmed, de-duplicated tags of at most 40 characters. */
function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(/[;,]/);
  return [...new Set(list.map((t) => String(t).trim()).filter(Boolean).map((t) => t.slice(0, 40)))];
}

/** Adds tags first used on a contact to the tags table, so the tag manager lists them. */
async function registerTags(names) {
  if (names?.length) await prisma.tag.createMany({ data: names.map((name) => ({ name })), skipDuplicates: true });
}

/** Tags for pickers; admins also get how many contacts use each one. */
async function listTags(user) {
  const tags = await prisma.tag.findMany({ orderBy: [{ isSource: 'desc' }, { name: 'asc' }], select: TAG_SELECT });
  if (user.role !== 'ADMIN') return tags;
  const counts = await prisma.$queryRaw`SELECT t AS "name", COUNT(*)::int AS "count" FROM "contacts", unnest("tags") AS t GROUP BY t`;
  const byName = new Map(counts.map((r) => [r.name, r.count]));
  return tags.map((t) => ({ ...t, contactCount: byName.get(t.name) ?? 0 }));
}

function tagFields(input, { partial }) {
  const data = {};
  if (input.name !== undefined || !partial) {
    const [name] = cleanTags([input.name ?? '']);
    if (!name) throw invalid('name', 'The tag name is required');
    data.name = name;
  }
  if (input.color !== undefined) {
    if (!HEX.test(input.color)) throw invalid('color', 'color must be a hex colour such as #6366f1');
    data.color = input.color.toLowerCase();
  }
  if (input.isSource !== undefined) data.isSource = input.isSource === true;
  return data;
}

/** A large rename re-indexes everything in one pass; a small one record by record. */
function reindexContacts(ids) {
  if (ids.length > 50) afterBulkChange();
  else ids.forEach((id) => reindex('contact', id));
}

async function createTag(req, input) {
  const data = tagFields(input, { partial: false });
  if (await prisma.tag.findUnique({ where: { name: data.name }, select: { id: true } })) throw ApiError.conflict(`The tag "${data.name}" already exists`);
  const tag = await prisma.tag.create({ data, select: TAG_SELECT });
  await audit(req, { action: 'create', entityType: 'tag', entityId: tag.id, after: tag });
  return tag;
}

/**
 * Renames (on every contact), recolours or flags a tag. Renaming to the name of
 * another tag merges the two: contacts keep one copy, the other tag's settings win.
 * @returns {Promise<{ tag: object, merged: boolean, contacts: number }>}
 */
async function updateTag(req, id, input) {
  const data = tagFields(input, { partial: true });
  const before = await prisma.tag.findUnique({ where: { id }, select: TAG_SELECT });
  if (!before) throw ApiError.notFound('Tag not found');

  const renaming = data.name !== undefined && data.name !== before.name;
  const target = renaming ? await prisma.tag.findUnique({ where: { name: data.name }, select: TAG_SELECT }) : null;

  const result = await prisma.$transaction(async (tx) => {
    const rows = renaming
      ? await tx.$queryRaw`
          UPDATE "contacts"
          SET "tags" = CASE WHEN ${data.name} = ANY("tags") THEN array_remove("tags", ${before.name})
                            ELSE array_replace("tags", ${before.name}, ${data.name}) END,
              "updatedAt" = NOW()
          WHERE ${before.name} = ANY("tags")
          RETURNING "id"`
      : [];
    let tag;
    if (target) {
      await tx.tag.delete({ where: { id } });
      tag = target;
    } else {
      tag = await tx.tag.update({ where: { id }, data, select: TAG_SELECT });
    }
    await audit(req, {
      action: target ? 'merge' : 'update', entityType: 'tag', entityId: id, before, after: { ...data, ...(target && { mergedInto: target.id }), contacts: rows.length },
    }, tx);
    return { tag, merged: Boolean(target), contactIds: rows.map((r) => r.id) };
  });

  reindexContacts(result.contactIds);
  return { tag: result.tag, merged: result.merged, contacts: result.contactIds.length };
}

/** Removes the tag from every contact, then deletes it. */
async function removeTag(req, id) {
  const before = await prisma.tag.findUnique({ where: { id }, select: TAG_SELECT });
  if (!before) throw ApiError.notFound('Tag not found');
  const contactIds = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      UPDATE "contacts" SET "tags" = array_remove("tags", ${before.name}), "updatedAt" = NOW()
      WHERE ${before.name} = ANY("tags")
      RETURNING "id"`;
    await tx.tag.delete({ where: { id } });
    await audit(req, { action: 'delete', entityType: 'tag', entityId: id, before, after: { contacts: rows.length } }, tx);
    return rows.map((r) => r.id);
  });
  reindexContacts(contactIds);
  return { contacts: contactIds.length };
}

module.exports = {
  getWorkspace, updateWorkspace,
  listStages, createStage, updateStage, reorderStages, removeStage,
  cleanTags, registerTags, listTags, createTag, updateTag, removeTag,
};
