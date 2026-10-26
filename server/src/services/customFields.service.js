/**
 * LeadPulse — Custom fields for contacts and deals.
 *
 * Definitions live in `custom_field_definitions`; values in each record's
 * `customFields` JSON, keyed by the definition's `key` (camelCase of the label,
 * fixed once created). Writes merge into the stored object: a key that is sent
 * is validated and set, null or '' clears it, and keys not sent are left alone,
 * including ones the app itself sets without a definition (enrichment's
 * `budgetTier`). "Required" is enforced when a record is created through the
 * API and when a value is cleared; CSV imports don't set custom fields.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { audit } = require('../lib/audit');
const { ApiError } = require('../middleware/error.middleware');

const ENTITIES = ['CONTACT', 'DEAL'];
const TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT'];
const MAX_TEXT = 500;
const FIELD_SELECT = { id: true, entity: true, key: true, label: true, type: true, options: true, required: true, position: true };

const invalid = (path, msg) => ApiError.validation([{ path, msg }]);

function checkEntity(entity) {
  if (!ENTITIES.includes(entity)) throw invalid('entity', `entity must be one of: ${ENTITIES.join(', ')}`);
  return entity;
}

/** "Budget tier" → "budgetTier"; "2025 renewal" → "field2025Renewal". */
function keyFor(label) {
  const words = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const key = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('').slice(0, 40);
  return /^[a-z]/.test(key) ? key : `field${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

function checkOptions(options) {
  const list = Array.isArray(options) ? [...new Set(options.map((o) => String(o).trim()).filter(Boolean))] : [];
  if (!list.length || list.length > 50 || list.some((o) => o.length > 60)) {
    throw invalid('options', 'A select field needs 1–50 options of at most 60 characters');
  }
  return list;
}

function checkLabel(label) {
  const value = String(label ?? '').trim();
  if (!value || value.length > 60) throw invalid('label', 'The field name must be 1–60 characters');
  return value;
}

async function listFields(entity) {
  return prisma.customFieldDefinition.findMany({
    where: entity ? { entity: checkEntity(entity) } : {},
    orderBy: [{ entity: 'asc' }, { position: 'asc' }],
    select: FIELD_SELECT,
  });
}

async function createField(req, input) {
  const entity = checkEntity(input.entity);
  const label = checkLabel(input.label);
  if (!TYPES.includes(input.type)) throw invalid('type', `type must be one of: ${TYPES.join(', ')}`);
  const options = input.type === 'SELECT' ? checkOptions(input.options) : undefined;

  const taken = new Set((await prisma.customFieldDefinition.findMany({ where: { entity }, select: { key: true } })).map((f) => f.key));
  const base = keyFor(label);
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}${n}`;

  const last = await prisma.customFieldDefinition.aggregate({ where: { entity }, _max: { position: true } });
  const field = await prisma.customFieldDefinition.create({
    data: { entity, key, label, type: input.type, options, required: input.required === true, position: (last._max.position ?? -1) + 1 },
    select: FIELD_SELECT,
  });
  await audit(req, { action: 'create', entityType: 'custom_field', entityId: field.id, after: field });
  return field;
}

/** Label, options and required can change; the key and type can't (stored values depend on them). */
async function updateField(req, id, input) {
  const before = await prisma.customFieldDefinition.findUnique({ where: { id }, select: FIELD_SELECT });
  if (!before) throw ApiError.notFound('Custom field not found');
  const data = {};
  if (input.label !== undefined) data.label = checkLabel(input.label);
  if (input.required !== undefined) data.required = input.required === true;
  if (input.options !== undefined) {
    if (before.type !== 'SELECT') throw invalid('options', 'Only select fields have options');
    data.options = checkOptions(input.options);
  }
  const field = await prisma.customFieldDefinition.update({ where: { id }, data, select: FIELD_SELECT });
  await audit(req, { action: 'update', entityType: 'custom_field', entityId: id, before, after: data });
  return field;
}

async function reorderFields(req, entity, ids) {
  const existing = await prisma.customFieldDefinition.findMany({ where: { entity: checkEntity(entity) }, select: { id: true } });
  const all = new Set(existing.map((f) => f.id));
  if (!Array.isArray(ids) || ids.length !== all.size || new Set(ids).size !== ids.length || !ids.every((id) => all.has(id))) {
    throw invalid('ids', 'ids must list every field of this entity exactly once');
  }
  await prisma.$transaction([
    ...ids.map((id, position) => prisma.customFieldDefinition.update({ where: { id }, data: { position } })),
    audit(req, { action: 'reorder', entityType: 'custom_field', after: { entity, ids } }),
  ]);
  return listFields(entity);
}

/** Deletes the definition and its value on every record. */
async function removeField(req, id) {
  const field = await prisma.customFieldDefinition.findUnique({ where: { id }, select: FIELD_SELECT });
  if (!field) throw ApiError.notFound('Custom field not found');
  const cleared = await prisma.$transaction(async (tx) => {
    const count = field.entity === 'CONTACT'
      ? await tx.$executeRaw`UPDATE "contacts" SET "customFields" = "customFields" - ${field.key} WHERE jsonb_exists("customFields", ${field.key})`
      : await tx.$executeRaw`UPDATE "deals" SET "customFields" = "customFields" - ${field.key} WHERE jsonb_exists("customFields", ${field.key})`;
    await tx.customFieldDefinition.delete({ where: { id } });
    await audit(req, { action: 'delete', entityType: 'custom_field', entityId: id, before: field, after: { cleared: count } }, tx);
    return count;
  });
  return { cleared };
}

/** One value checked and converted for storage; throws a 422 naming the field. */
function coerce(field, raw) {
  const path = `customFields.${field.key}`;
  switch (field.type) {
    case 'TEXT': {
      const value = String(raw).trim();
      if (value.length > MAX_TEXT) throw invalid(path, `${field.label} must be at most ${MAX_TEXT} characters`);
      return value;
    }
    case 'NUMBER': {
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(value)) throw invalid(path, `${field.label} must be a number`);
      return value;
    }
    case 'DATE': {
      const value = String(raw).trim();
      const d = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
        throw invalid(path, `${field.label} must be a date (YYYY-MM-DD)`);
      }
      return value;
    }
    default: {
      const value = String(raw);
      if (!(field.options ?? []).includes(value)) throw invalid(path, `${field.label} must be one of: ${(field.options ?? []).join(', ')}`);
      return value;
    }
  }
}

/**
 * Validates the `customFields` of a create or update request and merges it into
 * the record's current values.
 * @param {'CONTACT'|'DEAL'} entity
 * @param {object|undefined} input    what the request sent
 * @param {object|null} existing      the record's stored customFields (null on create)
 * @param {{ creating?: boolean }} [opts]
 * @returns {Promise<object|undefined>} the object to store, or undefined to leave it unchanged
 */
async function applyCustomFields(entity, input, existing, { creating = false } = {}) {
  if (input === undefined && !creating) return undefined;
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
    throw invalid('customFields', 'customFields must be an object');
  }
  const fields = await prisma.customFieldDefinition.findMany({ where: { entity }, select: FIELD_SELECT });
  if (input === undefined && !fields.some((f) => f.required)) return undefined;

  const byKey = new Map(fields.map((f) => [f.key, f]));
  const next = { ...(existing ?? {}) };
  for (const [key, raw] of Object.entries(input ?? {})) {
    const field = byKey.get(key);
    if (!field) {
      if (existing && Object.hasOwn(existing, key) && existing[key] === raw) continue; // sent back unchanged
      throw invalid(`customFields.${key}`, `There is no custom field "${key}"`);
    }
    if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
      if (field.required) throw invalid(`customFields.${key}`, `${field.label} is required`);
      delete next[key];
      continue;
    }
    next[key] = coerce(field, raw);
  }
  if (creating) {
    const missing = fields.find((f) => f.required && next[f.key] === undefined);
    if (missing) throw invalid(`customFields.${missing.key}`, `${missing.label} is required`);
  }
  return next;
}

module.exports = {
  ENTITIES, TYPES, keyFor, coerce,
  listFields, createField, updateField, reorderFields, removeField, applyCustomFields,
};
