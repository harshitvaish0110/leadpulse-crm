-- Semantic index moves to local 384-dim embeddings (all-MiniLM-L6-v2) with
-- chunking and hybrid (vector + full-text) retrieval.
--
-- Embeddings are derived data and are rebuilt by the reindex job, so the table is
-- truncated before the vector dimension changes (an exception to expand/contract).
--
-- Prisma does not model the HNSW index, the GIN index on the generated tsvector
-- column, or the generated expression itself. Never let a later migration drop them.

TRUNCATE TABLE "embeddings";

DROP INDEX IF EXISTS "embeddings_recordType_recordId_key";
DROP INDEX IF EXISTS "embeddings_vector_idx";

ALTER TABLE "embeddings"
  ADD COLUMN "chunkIndex"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "contentHash" TEXT    NOT NULL;

ALTER TABLE "embeddings" ALTER COLUMN "vector" TYPE vector(384);

ALTER TABLE "embeddings"
  ADD COLUMN "contentTsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

CREATE UNIQUE INDEX "embeddings_recordType_recordId_chunkIndex_key"
  ON "embeddings" ("recordType", "recordId", "chunkIndex");

CREATE INDEX "embeddings_vector_hnsw"
  ON "embeddings" USING hnsw ("vector" vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX "embeddings_tsv_gin"
  ON "embeddings" USING gin ("contentTsv");
