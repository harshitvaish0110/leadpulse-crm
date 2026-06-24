"""
CRM Data Indexer — embeds contacts, deals, and activities into pgvector.
Run this after seeding the DB: python services/indexer.py
Re-run whenever significant data changes to keep search fresh.
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

# Ensure project root is on path when run directly
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


def _contact_to_text(row) -> str:
    id_, first, last, email, title, status, lead_score, lead_label, churn_risk, tags = row
    return (
        f"Contact: {first} {last}\n"
        f"Email: {email or 'unknown'}\n"
        f"Title: {title or 'unknown'}\n"
        f"Status: {status}\n"
        f"Lead Score: {lead_score or 0} ({lead_label or 'unscored'})\n"
        f"Churn Risk: {int((churn_risk or 0) * 100)}%\n"
        f"Tags: {', '.join(tags or [])}"
    )


def _deal_to_text(row) -> str:
    id_, title, value, stage, win_prob, contact_name = row
    return (
        f"Deal: {title}\n"
        f"Value: ${int(value or 0):,}\n"
        f"Stage: {stage}\n"
        f"Win Probability: {int((win_prob or 0) * 100)}%\n"
        f"Contact: {contact_name or 'unknown'}"
    )


def _activity_to_text(row) -> str:
    id_, atype, subject, contact_name, notes, sentiment, occurred_at = row
    return (
        f"Activity ({atype}): {subject or '(no subject)'}\n"
        f"Contact: {contact_name or 'unknown'}\n"
        f"Notes: {notes or 'No notes recorded'}\n"
        f"Sentiment: {sentiment or 'unknown'}\n"
        f"Date: {str(occurred_at)[:10]}"
    )


def run_indexing() -> dict:
    """Index all CRM data and return counts per record type."""
    from services.embedding_service import embed_text_safe
    from services.vector_store import upsert_embedding

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL not set in environment")

    conn = psycopg2.connect(db_url)
    cur  = conn.cursor()
    counts = {"contact": 0, "deal": 0, "activity": 0}

    # ── Index Contacts ────────────────────────────────────────────────
    print("Indexing contacts...")
    cur.execute("""
        SELECT id, first_name, last_name, email, title, status,
               lead_score, lead_score_label, churn_risk, tags
        FROM contacts
        LIMIT 500
    """)
    for row in cur.fetchall():
        text   = _contact_to_text(row)
        vector = embed_text_safe(text)
        if vector:
            upsert_embedding("contact", str(row[0]), text, vector)
            counts["contact"] += 1
    print(f"  ✓ {counts['contact']} contacts indexed")

    # ── Index Deals ───────────────────────────────────────────────────
    print("Indexing deals...")
    cur.execute("""
        SELECT d.id, d.title, d.value, d.stage, d.win_probability,
               CONCAT(c.first_name, ' ', c.last_name)
        FROM deals d
        LEFT JOIN contacts c ON c.id = d.contact_id
        LIMIT 200
    """)
    for row in cur.fetchall():
        text   = _deal_to_text(row)
        vector = embed_text_safe(text)
        if vector:
            upsert_embedding("deal", str(row[0]), text, vector)
            counts["deal"] += 1
    print(f"  ✓ {counts['deal']} deals indexed")

    # ── Index Activities (with notes only) ────────────────────────────
    print("Indexing activities...")
    cur.execute("""
        SELECT a.id, a.type, a.subject,
               CONCAT(c.first_name, ' ', c.last_name),
               a.notes, a.sentiment, a.occurred_at
        FROM activities a
        LEFT JOIN contacts c ON c.id = a.contact_id
        WHERE a.notes IS NOT NULL AND LENGTH(a.notes) > 10
        LIMIT 500
    """)
    for row in cur.fetchall():
        text   = _activity_to_text(row)
        vector = embed_text_safe(text)
        if vector:
            upsert_embedding("activity", str(row[0]), text, vector)
            counts["activity"] += 1
    print(f"  ✓ {counts['activity']} activities indexed")

    cur.close()
    conn.close()
    print(f"\n✅ Indexing complete! Total: {sum(counts.values())} records")
    return counts


if __name__ == "__main__":
    run_indexing()
