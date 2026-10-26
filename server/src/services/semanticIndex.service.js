/**
 * LeadPulse — Semantic index of CRM records (embeddings table, pgvector).
 *
 * Each contact, deal, company and activity is rendered as a short text, split
 * into windows when long, embedded by the ML service (384-dim MiniLM) and
 * upserted by (recordType, recordId, chunkIndex). Unchanged text (same sha256)
 * is never re-embedded. Search fuses vector similarity and full-text rank with
 * reciprocal rank fusion, limited to records the caller may see.
 */

'use strict';

const crypto = require('crypto');
const { prisma } = require('../lib/prisma');
const { ml } = require('../lib/mlClient');
const { isPrivileged } = require('../middleware/auth.middleware');

const TYPES = ['contact', 'deal', 'company', 'activity'];
const CLOSED = ['CLOSED_WON', 'CLOSED_LOST'];
const PAGE = 200;
const EMBED_BATCH = 32;
const SPLIT_OVER = 1500;
const WINDOW = 1000;
const OVERLAP = 200;

// ── Text templates ─────────────────────────────────────────────────────────────
const fullName = (p) => (p ? `${p.firstName} ${p.lastName}` : 'unassigned');
const money = (v) => `$${Math.round(Number(v || 0)).toLocaleString('en-US')}`;
const pct = (p) => `${Math.round((p ?? 0) * 100)}%`;
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'not set');
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const sentimentWord = (s) => (s > 0.7 ? 'positive' : s >= 0.4 ? 'neutral' : s >= 0.2 ? 'negative' : 'at risk');

const TEMPLATES = {
  contact: (c) => {
    const last = c.activities[0];
    return [
      `Contact: ${fullName(c)} — ${c.title || 'no title'} at ${c.company?.name || 'no company'}.`,
      `Status ${c.status}. Lead score ${c.leadScore} (${c.leadScoreLabel || 'unscored'}). Churn risk ${pct(c.churnRisk)}. Sentiment ${sentimentWord(c.sentimentScore)}.`,
      `Owner ${fullName(c.owner)}. Tags ${c.tags.length ? c.tags.join(', ') : 'none'}.`,
      `Open deals: ${c.deals.length ? c.deals.map((d) => `${d.title} (${d.stage}, ${money(d.value)})`).join('; ') : 'none'}.`,
      last ? `Last activity ${day(last.occurredAt)} ${last.type}: ${clip(last.notes || last.subject || '', 200)}` : 'No activity yet.',
    ].join(' ');
  },
  deal: (d) => [
    `Deal: ${d.title} for ${fullName(d.contact)} at ${d.contact?.company?.name || 'no company'}.`,
    `Stage ${d.pipelineStage?.label || d.stage}. Value ${money(d.value)}. Win probability ${pct(d.winProbability)}. Expected close ${day(d.expectedCloseDate)}.`,
    `Owner ${fullName(d.owner)}.`,
    d.lostReason ? `Lost reason: ${clip(d.lostReason, 200)}.` : '',
    d.notes ? `Notes: ${clip(d.notes, 400)}.` : '',
    d.activities.length ? `Recent: ${d.activities.map((a) => `${day(a.occurredAt)} ${a.type}: ${clip(a.notes || a.subject || '', 150)}`).join(' | ')}` : '',
  ].filter(Boolean).join(' '),
  company: (c) => [
    `Company: ${c.name} (${c.domain}).`,
    `Industry ${c.industry || 'unknown'}. Size ${c.size ?? 'unknown'}. Country ${c.country || 'unknown'}.`,
    c.description ? `${clip(c.description, 300)}.` : '',
    `Contacts: ${c._count.contacts}. Open pipeline ${money(c.openPipeline)}.`,
  ].filter(Boolean).join(' '),
  activity: (a) => {
    const meta = a.metadata && typeof a.metadata === 'object' ? a.metadata : {};
    const items = Array.isArray(meta.actionItems) ? meta.actionItems.join('; ') : '';
    return [
      `${a.type} on ${day(a.occurredAt)} with ${fullName(a.contact)} (${a.contact?.company?.name || 'no company'})${a.deal ? ` about ${a.deal.title}` : ''}: ${a.subject || 'no subject'}.`,
      a.notes ? `Notes: ${a.notes.replace(/\s+/g, ' ').trim()}` : '',
      a.sentiment ? `Sentiment ${a.sentiment.toLowerCase().replace('_', ' ')}.` : '',
      meta.summary && meta.summary !== a.notes ? `Summary: ${meta.summary}` : '',
      items ? `Action items: ${items}` : '',
    ].filter(Boolean).join(' ');
  },
};

/** Long text becomes overlapping 1,000-character windows; short text stays one chunk. */
function splitText(text) {
  if (text.length <= SPLIT_OVER) return [text];
  const chunks = [];
  for (let start = 0; ; start += WINDOW - OVERLAP) {
    chunks.push(text.slice(start, start + WINDOW));
    if (start + WINDOW >= text.length) return chunks;
  }
}

// ── Loading records (one query per page, with what the templates need) ─────────
const person = { select: { firstName: true, lastName: true } };

const LOADERS = {
  contact: (where, take) => prisma.contact.findMany({
    where, take, orderBy: { id: 'asc' },
    include: {
      company: { select: { name: true } },
      owner: person,
      deals: { where: { stage: { notIn: CLOSED } }, select: { title: true, stage: true, value: true } },
      activities: { take: 1, orderBy: { occurredAt: 'desc' }, select: { type: true, subject: true, notes: true, occurredAt: true } },
    },
  }),
  deal: (where, take) => prisma.deal.findMany({
    where, take, orderBy: { id: 'asc' },
    include: {
      contact: { select: { firstName: true, lastName: true, company: { select: { name: true } } } },
      owner: person,
      pipelineStage: { select: { label: true } },
      activities: { take: 3, orderBy: { occurredAt: 'desc' }, select: { type: true, subject: true, notes: true, occurredAt: true } },
    },
  }),
  company: async (where, take) => {
    const companies = await prisma.company.findMany({ where, take, orderBy: { id: 'asc' }, include: { _count: { select: { contacts: true } } } });
    if (!companies.length) return companies;
    const ids = companies.map((c) => c.id);
    const sums = await prisma.$queryRaw`
      SELECT c."companyId" AS id, SUM(d."value")::float AS total
      FROM "deals" d JOIN "contacts" c ON c."id" = d."contactId"
      WHERE c."companyId" = ANY(${ids}::text[]) AND d."stage" NOT IN ('CLOSED_WON', 'CLOSED_LOST')
      GROUP BY 1`;
    const byId = new Map(sums.map((s) => [s.id, s.total]));
    return companies.map((c) => ({ ...c, openPipeline: byId.get(c.id) ?? 0 }));
  },
  activity: (where, take) => prisma.activity.findMany({
    where, take, orderBy: { id: 'asc' },
    include: {
      contact: { select: { firstName: true, lastName: true, company: { select: { name: true } } } },
      deal: { select: { title: true } },
    },
  }),
};

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const vectorLiteral = (v) => `[${v.join(',')}]`;

/** Chunks for loaded records: [{ recordId, chunkIndex, content, contentHash }]. */
function chunksFor(type, records) {
  return records.flatMap((r) => splitText(TEMPLATES[type](r)).map((content, chunkIndex) => ({
    recordId: r.id, chunkIndex, content, contentHash: sha256(content),
  })));
}

async function embed(texts) {
  const { data } = await ml.post('/embed', { texts }, { timeout: 60_000 });
  return data.vectors;
}

/** Embeds new or changed chunks of `records`, drops chunks past each record's new length. */
async function writeRecords(type, records) {
  if (!records.length) return { records: 0, embedded: 0 };
  const ids = records.map((r) => r.id);
  const chunks = chunksFor(type, records);

  const existing = await prisma.$queryRaw`
    SELECT "recordId", "chunkIndex", "contentHash" FROM "embeddings"
    WHERE "recordType" = ${type} AND "recordId" = ANY(${ids}::text[])`;
  const known = new Set(existing.map((e) => `${e.recordId}:${e.chunkIndex}:${e.contentHash}`));
  const changed = chunks.filter((c) => !known.has(`${c.recordId}:${c.chunkIndex}:${c.contentHash}`));

  for (let i = 0; i < changed.length; i += EMBED_BATCH) {
    const batch = changed.slice(i, i + EMBED_BATCH);
    const vectors = await embed(batch.map((c) => c.content));
    await Promise.all(batch.map((c, k) => prisma.$executeRaw`
      INSERT INTO "embeddings" ("id", "recordType", "recordId", "chunkIndex", "content", "contentHash", "vector", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${type}, ${c.recordId}, ${c.chunkIndex}, ${c.content}, ${c.contentHash}, ${vectorLiteral(vectors[k])}::vector, NOW())
      ON CONFLICT ("recordType", "recordId", "chunkIndex") DO UPDATE
        SET "content" = EXCLUDED."content", "contentHash" = EXCLUDED."contentHash", "vector" = EXCLUDED."vector", "updatedAt" = NOW()`));
  }

  const counts = ids.map((id) => chunks.filter((c) => c.recordId === id).length);
  await prisma.$executeRaw`
    DELETE FROM "embeddings" e
    USING (SELECT unnest(${ids}::text[]) AS id, unnest(${counts}::int[]) AS n) k
    WHERE e."recordType" = ${type} AND e."recordId" = k.id AND e."chunkIndex" >= k.n`;

  return { records: records.length, embedded: changed.length };
}

/** Index entries for one record; removes them if the record no longer exists. */
async function reindexRecord(type, id) {
  if (!TYPES.includes(type)) throw new Error(`Unknown record type "${type}"`);
  const records = await LOADERS[type]({ id }, 1);
  if (!records.length) return { removed: await removeFromIndex({ [type]: [id] }) };
  return writeRecords(type, records);
}

/** Every record of every type, page by page; then orphan cleanup and the timestamp. */
async function reindexAll() {
  const totals = {};
  for (const type of TYPES) {
    const total = { records: 0, embedded: 0 };
    for (let cursor = null; ;) {
      const page = await LOADERS[type](cursor ? { id: { gt: cursor } } : {}, PAGE);
      if (!page.length) break;
      const { records, embedded } = await writeRecords(type, page);
      total.records += records;
      total.embedded += embedded;
      cursor = page.at(-1).id;
    }
    totals[type] = total;
  }
  totals.orphansRemoved = await removeOrphans();
  const now = new Date();
  await prisma.orgSettings.upsert({ where: { id: 1 }, create: { id: 1, lastFullReindexAt: now }, update: { lastFullReindexAt: now } });
  return totals;
}

/** Deletes index rows now (used on delete, so search never returns a deleted record). */
async function removeFromIndex(idsByType) {
  let removed = 0;
  for (const [type, ids] of Object.entries(idsByType)) {
    if (ids?.length) removed += await prisma.$executeRaw`DELETE FROM "embeddings" WHERE "recordType" = ${type} AND "recordId" = ANY(${ids}::text[])`;
  }
  return removed;
}

/** Rows whose record is gone (e.g. deleted by a cascade). */
async function removeOrphans() {
  const counts = await Promise.all([
    prisma.$executeRaw`DELETE FROM "embeddings" e WHERE e."recordType" = 'contact' AND NOT EXISTS (SELECT 1 FROM "contacts" x WHERE x."id" = e."recordId")`,
    prisma.$executeRaw`DELETE FROM "embeddings" e WHERE e."recordType" = 'deal' AND NOT EXISTS (SELECT 1 FROM "deals" x WHERE x."id" = e."recordId")`,
    prisma.$executeRaw`DELETE FROM "embeddings" e WHERE e."recordType" = 'company' AND NOT EXISTS (SELECT 1 FROM "companies" x WHERE x."id" = e."recordId")`,
    prisma.$executeRaw`DELETE FROM "embeddings" e WHERE e."recordType" = 'activity' AND NOT EXISTS (SELECT 1 FROM "activities" x WHERE x."id" = e."recordId")`,
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * Hybrid retrieval: top 30 by cosine distance and top 30 by full-text rank,
 * fused with RRF (k = 60), best chunk per record. Only rows whose record still
 * exists and is in the caller's scope (same rules as scopeFor) are considered.
 * @returns {Promise<{ recordType: string, recordId: string, chunkIndex: number, content: string, score: number }[]>}
 */
async function retrieve(user, vector, query, limit = 6) {
  const privileged = isPrivileged(user);
  const uid = user.id;
  const v = vectorLiteral(vector);
  const rows = await prisma.$queryRaw`
    WITH scoped AS (
      SELECT e."id", e."vector", e."contentTsv" FROM "embeddings" e
      WHERE (e."recordType" = 'company'  AND EXISTS (SELECT 1 FROM "companies" co WHERE co."id" = e."recordId"))
         OR (e."recordType" = 'contact'  AND EXISTS (SELECT 1 FROM "contacts" c WHERE c."id" = e."recordId"
                                                    AND (${privileged} OR c."ownerId" = ${uid})))
         OR (e."recordType" = 'deal'     AND EXISTS (SELECT 1 FROM "deals" d JOIN "contacts" c ON c."id" = d."contactId"
                                                    WHERE d."id" = e."recordId" AND (${privileged} OR d."ownerId" = ${uid} OR c."ownerId" = ${uid})))
         OR (e."recordType" = 'activity' AND EXISTS (SELECT 1 FROM "activities" a JOIN "contacts" c ON c."id" = a."contactId"
                                                    WHERE a."id" = e."recordId" AND (${privileged} OR a."userId" = ${uid} OR c."ownerId" = ${uid})))
    ),
    vec AS (
      SELECT "id", ROW_NUMBER() OVER (ORDER BY "vector" <=> ${v}::vector) AS r
      FROM scoped WHERE "vector" IS NOT NULL
      ORDER BY "vector" <=> ${v}::vector LIMIT 30
    ),
    kw AS (
      SELECT s."id", ROW_NUMBER() OVER (ORDER BY ts_rank_cd(s."contentTsv", q) DESC) AS r
      FROM scoped s, websearch_to_tsquery('english', ${query}) q
      WHERE s."contentTsv" @@ q
      ORDER BY ts_rank_cd(s."contentTsv", q) DESC LIMIT 30
    ),
    fused AS (
      SELECT "id", SUM(1.0 / (60 + r)) AS score FROM (SELECT "id", r FROM vec UNION ALL SELECT "id", r FROM kw) u GROUP BY "id"
    )
    SELECT e."recordType", e."recordId", e."chunkIndex", e."content", f.score::float AS score
    FROM fused f JOIN "embeddings" e ON e."id" = f."id"
    ORDER BY f.score DESC
    LIMIT ${limit * 3}`;

  const seen = new Set();
  return rows.filter((r) => {
    const key = `${r.recordType}:${r.recordId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

/** Embeds the question, then retrieve(). */
async function search(user, query, { limit = 6 } = {}) {
  const [vector] = await embed([String(query).slice(0, 2000)]);
  return retrieve(user, vector, query, limit);
}

/** Row counts per record type and the last full rebuild, for the admin status endpoint. */
async function indexStatus() {
  const [rows, settings] = await Promise.all([
    prisma.$queryRaw`SELECT "recordType", COUNT(*)::int AS chunks, COUNT(DISTINCT "recordId")::int AS records FROM "embeddings" GROUP BY 1`,
    prisma.orgSettings.findUnique({ where: { id: 1 }, select: { lastFullReindexAt: true } }),
  ]);
  return {
    types: Object.fromEntries(rows.map((r) => [r.recordType, { records: r.records, chunks: r.chunks }])),
    lastFullReindexAt: settings?.lastFullReindexAt ?? null,
  };
}

module.exports = {
  TYPES, TEMPLATES, splitText, chunksFor,
  reindexRecord, reindexAll, removeFromIndex, removeOrphans, retrieve, search, indexStatus,
};
