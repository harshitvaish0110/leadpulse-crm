/**
 * LeadPulse — Deal writes.
 *
 * A deal's stage fields always move together: the base `stage`, the
 * `pipelineStageId` it is shown in, `stageChangedAt`, `closedAt`, the 0–1
 * `winProbability` at terminal stages, and one `deal_stage_history` row per change.
 * Controllers and background executors both go through these functions.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { ApiError } = require('../middleware/error.middleware');
const { scopeFor, assertContactInScope, resolveOwnerId } = require('../middleware/auth.middleware');
const { emitScoped } = require('../lib/realtime');

const DEAL_STAGES = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];
const CLOSED = new Set(['CLOSED_WON', 'CLOSED_LOST']);

const DEAL_LIST_INCLUDE = {
  contact: { select: { id: true, firstName: true, lastName: true, email: true, ownerId: true } },
  owner:   { select: { id: true, firstName: true, lastName: true } },
  pipelineStage: { select: { id: true, label: true, color: true, position: true } },
};

/** Deal events go to the deal owner, the contact owner and managers. */
const emitDeal = (deal, event, payload) => emitScoped([deal.ownerId, deal.contact?.ownerId], event, payload);

const invalid = (path, msg) => ApiError.validation([{ path, msg }]);

/**
 * Resolves `{ stage, pipelineStageId }` from either a pipeline stage id or a base stage.
 * A base stage alone maps to its default column (lowest position).
 */
async function resolveStage(db, { stage, pipelineStageId }) {
  if (pipelineStageId) {
    const column = await db.pipelineStage.findUnique({ where: { id: pipelineStageId }, select: { id: true, baseStage: true } });
    if (!column) throw invalid('pipelineStageId', 'Unknown pipeline stage');
    if (stage && stage !== column.baseStage) throw invalid('stage', 'stage does not match the pipeline stage');
    return { stage: column.baseStage, pipelineStageId: column.id };
  }
  if (!DEAL_STAGES.includes(stage)) throw invalid('stage', `stage must be one of: ${DEAL_STAGES.join(', ')}`);
  const column = await db.pipelineStage.findFirst({ where: { baseStage: stage }, orderBy: { position: 'asc' }, select: { id: true } });
  return { stage, pipelineStageId: column?.id ?? null };
}

/** Fields that follow from entering `stage` at `now`. */
const stageEffects = (stage, now) => ({
  stageChangedAt: now,
  closedAt: CLOSED.has(stage) ? now : null,
  ...(stage === 'CLOSED_WON' && { winProbability: 1 }),
  ...(stage === 'CLOSED_LOST' && { winProbability: 0 }),
});

function parseValue(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw invalid('value', 'value must be a non-negative number');
  return n;
}

function parseDate(value, path) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw invalid(path, `${path} must be a date`);
  return d;
}

async function createDeal(user, input) {
  const { title, contactId, notes, lostReason } = input;
  if (!title?.trim() || !contactId) throw ApiError.badRequest('title and contactId are required');

  await assertContactInScope(user, contactId);
  const ownerId = (await resolveOwnerId(user, input.ownerId)) ?? user.id;
  const value = parseValue(input.value) ?? 0;
  const expectedCloseDate = parseDate(input.expectedCloseDate, 'expectedCloseDate') ?? null;
  const now = new Date();

  const deal = await prisma.$transaction(async (tx) => {
    const target = await resolveStage(tx, {
      stage: input.stage || (input.pipelineStageId ? undefined : 'LEAD'),
      pipelineStageId: input.pipelineStageId,
    });
    const created = await tx.deal.create({
      data: {
        title: title.trim(), value, expectedCloseDate,
        notes: notes || null, lostReason: lostReason || null,
        contactId, ownerId,
        ...target, ...stageEffects(target.stage, now),
      },
      include: DEAL_LIST_INCLUDE,
    });
    await tx.dealStageHistory.create({
      data: { dealId: created.id, toStage: target.stage, toStageId: target.pipelineStageId, changedById: user.id, changedAt: now },
    });
    return created;
  });

  emitDeal(deal, 'deal:created', { dealId: deal.id, stage: deal.stage });
  return deal;
}

/**
 * Moves a deal to `{ stage }` and/or `{ pipelineStageId }` (plus an optional `lostReason`
 * when it enters CLOSED_LOST). A no-op when nothing changes.
 */
async function changeStage(user, dealId, target) {
  const where = { id: dealId, ...scopeFor(user, 'deal') };
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.deal.findFirst({ where, select: { stage: true, pipelineStageId: true } });
    if (!before) throw ApiError.notFound('Deal not found');

    const unchanged = (!target.pipelineStageId && target.stage === before.stage)
      || target.pipelineStageId === before.pipelineStageId;
    if (unchanged) return { before, deal: await tx.deal.findFirst({ where, include: DEAL_LIST_INCLUDE }), changed: false };

    const next = await resolveStage(tx, target);
    const lostReason = next.stage === 'CLOSED_LOST' && target.lostReason ? String(target.lostReason).trim().slice(0, 200) : undefined;
    const deal = await tx.deal.update({
      where,
      data: { ...next, ...stageEffects(next.stage, now), ...(lostReason && { lostReason }) },
      include: DEAL_LIST_INCLUDE,
    });
    await tx.dealStageHistory.create({
      data: {
        dealId, fromStage: before.stage, toStage: next.stage,
        fromStageId: before.pipelineStageId, toStageId: next.pipelineStageId,
        changedById: user.id, changedAt: now,
      },
    });
    return { before, deal, changed: true };
  });

  if (result.changed) {
    emitDeal(result.deal, 'deal:stage_changed', {
      dealId:    result.deal.id,
      title:     result.deal.title,
      fromStage: result.before.stage,
      toStage:   result.deal.stage,
      value:     Number(result.deal.value),
    });
  }
  return result.deal;
}

/** Editable fields only; `winProbability` is computed by the scoring job. */
async function updateDeal(user, dealId, input) {
  const data = {};
  if (input.title !== undefined) {
    if (!String(input.title).trim()) throw invalid('title', 'title cannot be empty');
    data.title = String(input.title).trim();
  }
  if (input.notes !== undefined) data.notes = input.notes || null;
  if (input.lostReason !== undefined) data.lostReason = input.lostReason || null;
  const value = parseValue(input.value);
  if (value !== undefined) data.value = value;
  const expectedCloseDate = parseDate(input.expectedCloseDate, 'expectedCloseDate');
  if (expectedCloseDate !== undefined) data.expectedCloseDate = expectedCloseDate;
  if (input.ownerId !== undefined) data.ownerId = await resolveOwnerId(user, input.ownerId);

  let deal = null;
  if (input.stage !== undefined || input.pipelineStageId !== undefined) {
    deal = await changeStage(user, dealId, { stage: input.stage, pipelineStageId: input.pipelineStageId });
  }
  if (Object.keys(data).length) {
    deal = await prisma.deal.update({ where: { id: dealId, ...scopeFor(user, 'deal') }, data, include: DEAL_LIST_INCLUDE });
    emitDeal(deal, 'deal:updated', { dealId: deal.id });
  }
  return deal ?? prisma.deal.findFirstOrThrow({ where: { id: dealId, ...scopeFor(user, 'deal') }, include: DEAL_LIST_INCLUDE });
}

async function deleteDeal(user, dealId) {
  const deal = await prisma.deal.delete({
    where:  { id: dealId, ...scopeFor(user, 'deal') },
    select: { id: true, ownerId: true, contact: { select: { ownerId: true } } },
  });
  emitDeal(deal, 'deal:deleted', { dealId: deal.id });
}

module.exports = { DEAL_STAGES, DEAL_LIST_INCLUDE, createDeal, changeStage, updateDeal, deleteDeal };
