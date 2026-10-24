'use strict';

/**
 * Schema guard tests. They protect the database
 * objects Prisma does not manage, which a careless `prisma migrate dev` could drop.
 * Requires a migrated (and seeded) database at DATABASE_URL.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env'), quiet: true });

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
after(() => pool.end());

const one = async (sql, params) => (await pool.query(sql, params)).rows[0];

/** Run statements in a transaction that is always rolled back. */
async function inRollback(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

test('ML feature views return exactly one row per entity (no join fan-out)', async () => {
  const c = await one('SELECT (SELECT COUNT(*) FROM ml_contact_features)::int v, (SELECT COUNT(*) FROM contacts)::int t');
  assert.equal(c.v, c.t);
  const d = await one('SELECT (SELECT COUNT(*) FROM ml_deal_features)::int v, (SELECT COUNT(*) FROM deals)::int t');
  assert.equal(d.v, d.t);
});

test('hand-managed indexes exist', async () => {
  const { rows } = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)`,
    [['embeddings_vector_hnsw', 'embeddings_tsv_gin', 'contacts_tags_gin', 'activities_contact_occurred_idx']],
  );
  assert.deepEqual(rows.map((r) => r.indexname).sort(),
    ['activities_contact_occurred_idx', 'contacts_tags_gin', 'embeddings_tsv_gin', 'embeddings_vector_hnsw']);
});

test('embeddings use 384-dim vectors and a generated tsvector column', async () => {
  const v = await one(`SELECT format_type(atttypid, atttypmod) t FROM pg_attribute
                       WHERE attrelid = 'embeddings'::regclass AND attname = 'vector'`);
  assert.equal(v.t, 'vector(384)');
  const g = await one(`SELECT attgenerated FROM pg_attribute WHERE attrelid = 'embeddings'::regclass AND attname = 'contentTsv'`);
  assert.equal(g.attgenerated, 's');
});

test('audit_logs is append-only', async () => {
  await inRollback(async (db) => {
    await db.query(`INSERT INTO audit_logs (id, action, "entityType") VALUES ('guard-test', 'create', 'test')`);
    await db.query('SAVEPOINT s');
    await assert.rejects(db.query(`UPDATE audit_logs SET action = 'x' WHERE id = 'guard-test'`), /append-only/);
    await db.query('ROLLBACK TO SAVEPOINT s');
    await assert.rejects(db.query(`DELETE FROM audit_logs WHERE id = 'guard-test'`), /append-only/);
  });
});

test('CHECK constraints reject out-of-range scores', async () => {
  const cases = [
    `UPDATE contacts SET "churnRisk" = 1.5`,
    `UPDATE contacts SET "sentimentScore" = -0.1`,
    `UPDATE contacts SET "leadScore" = 121`,
    `UPDATE contacts SET "leadScoreLabel" = 'LUKEWARM'`,
    `UPDATE org_settings SET id = 2`,
  ];
  for (const sql of cases) {
    await inRollback(async (db) => {
      await assert.rejects(db.query(`${sql} WHERE ctid = (SELECT ctid FROM ${sql.split(' ')[1]} LIMIT 1)`), /violates check constraint/, sql);
    });
  }
});

test('every deal maps to a pipeline stage with the same base stage', async () => {
  const r = await one(`SELECT COUNT(*)::int n FROM deals d LEFT JOIN pipeline_stages ps ON ps.id = d."pipelineStageId"
                       WHERE ps.id IS NULL OR ps."baseStage" <> d.stage`);
  assert.equal(r.n, 0);
  const stages = await one(`SELECT COUNT(DISTINCT "baseStage")::int n FROM pipeline_stages`);
  assert.equal(stages.n, 7);
});

test('closed deals have closedAt and a stage history', async () => {
  const r = await one(`SELECT COUNT(*)::int n FROM deals d
                       WHERE (d.stage IN ('CLOSED_WON','CLOSED_LOST') AND d."closedAt" IS NULL)
                          OR NOT EXISTS (SELECT 1 FROM deal_stage_history h WHERE h."dealId" = d.id)`);
  assert.equal(r.n, 0);
});
