"""
Vector store — pgvector operations for the LeadPulse embeddings table.
Handles upserts and cosine similarity search via psycopg2 + pgvector.
"""

import os
import numpy as np

def _get_connection():
    """Return a fresh psycopg2 connection with pgvector registered."""
    import psycopg2
    from pgvector.psycopg2 import register_vector

    conn = psycopg2.connect(os.getenv("DATABASE_URL"))
    register_vector(conn)
    return conn


def upsert_embedding(record_type: str, record_id: str, content: str, vector: list) -> None:
    """
    Insert or update an embedding record.
    Uses ON CONFLICT on (record_type, record_id) to upsert cleanly.
    """
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO embeddings (id, record_type, record_id, content, vector, created_at, updated_at)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, NOW(), NOW())
                ON CONFLICT (record_type, record_id)
                DO UPDATE SET
                    content    = EXCLUDED.content,
                    vector     = EXCLUDED.vector,
                    updated_at = NOW()
                """,
                (record_type, record_id, content, np.array(vector)),
            )
        conn.commit()
    finally:
        conn.close()


def search_similar(query_vector: list, limit: int = 5, record_types: list = None) -> list:
    """
    Return top-k records most similar to the query vector using cosine distance.
    Optionally filter by record_types list (e.g. ['contact', 'deal']).
    """
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            if record_types:
                placeholders = ", ".join(["%s"] * len(record_types))
                cur.execute(
                    f"""
                    SELECT record_type, record_id, content,
                           1 - (vector <=> %s::vector) AS similarity
                    FROM embeddings
                    WHERE record_type IN ({placeholders})
                    ORDER BY vector <=> %s::vector
                    LIMIT %s
                    """,
                    (np.array(query_vector), *record_types, np.array(query_vector), limit),
                )
            else:
                cur.execute(
                    """
                    SELECT record_type, record_id, content,
                           1 - (vector <=> %s::vector) AS similarity
                    FROM embeddings
                    ORDER BY vector <=> %s::vector
                    LIMIT %s
                    """,
                    (np.array(query_vector), np.array(query_vector), limit),
                )

            rows = cur.fetchall()
            return [
                {
                    "type":       row[0],
                    "id":         row[1],
                    "content":    row[2],
                    "similarity": round(float(row[3]), 4),
                }
                for row in rows
            ]
    finally:
        conn.close()


def count_embeddings() -> dict:
    """Return count of indexed records by type — useful for status checks."""
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT record_type, COUNT(*) FROM embeddings GROUP BY record_type"
            )
            rows = cur.fetchall()
            return {row[0]: row[1] for row in rows}
    finally:
        conn.close()
