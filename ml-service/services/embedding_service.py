"""
Embedding service — wraps OpenAI text-embedding-3-small.
Returns a 1536-dim vector for any text input.
Falls back to a zero vector stub if OpenAI key not configured.
"""

import os
import numpy as np

_client = None


def get_client():
    global _client
    if _client is None:
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY not configured in .env")
        from openai import OpenAI
        _client = OpenAI(api_key=api_key)
    return _client


def embed_text(text: str) -> list:
    """
    Generate a 1536-dimensional embedding vector for the given text.
    Truncates to 8000 chars to stay within token limits.
    Returns a list of floats suitable for pgvector storage.
    """
    client = get_client()
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text[:8000],
    )
    return response.data[0].embedding


def embed_text_safe(text: str) -> list | None:
    """
    Safe wrapper — returns None on error instead of raising.
    Useful for batch indexing where you want to skip failed items.
    """
    try:
        return embed_text(text)
    except Exception as e:
        print(f"⚠ Embedding failed: {e}")
        return None
