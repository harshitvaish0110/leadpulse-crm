-- Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add HNSW index on the vector column for fast cosine similarity search.
-- HNSW is preferred over IVFFlat for smaller-to-medium datasets as it
-- requires no training phase and provides better recall at lower ef values.
CREATE INDEX IF NOT EXISTS embeddings_vector_idx
ON embeddings USING hnsw (vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64);