"""
RAG pipeline route — semantic search over CRM data + Claude streaming answer.
Exposes a Server-Sent Events endpoint for real-time response streaming.
"""

import json
from flask import Blueprint, request, jsonify, Response, stream_with_context

rag_bp = Blueprint("rag", __name__)


def _build_context(results: list) -> str:
    """Format retrieved chunks into a readable context block for Claude."""
    lines = []
    for i, r in enumerate(results, 1):
        lines.append(f"[{i}] {r['type'].upper()} (id: {r['id'][:8]})\n{r['content']}")
    return "\n\n---\n\n".join(lines)


def _sse(data: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(data)}\n\n"


@rag_bp.route("/query", methods=["GET"])
def query():
    """
    GET /rag/query?question=...&history=[]
    Returns: Server-Sent Events stream with text chunks, then a done event with sources.
    """
    question    = request.args.get("question", "").strip()
    history_raw = request.args.get("history", "[]")

    if not question:
        return jsonify({"error": "No question provided"}), 400

    try:
        history = json.loads(history_raw)
    except (json.JSONDecodeError, TypeError):
        history = []

    def generate():
        # ── Step 1: Embed the question ─────────────────────────────────
        try:
            from services.embedding_service import embed_text
            query_vector = embed_text(question)
        except Exception as e:
            yield _sse({"error": f"Embedding failed: {str(e)}", "done": True, "sources": []})
            return

        # ── Step 2: Retrieve similar chunks from pgvector ─────────────
        try:
            from services.vector_store import search_similar
            results = search_similar(query_vector, limit=5)
        except Exception as e:
            yield _sse({"error": f"Vector search failed: {str(e)}", "done": True, "sources": []})
            return

        # ── Step 3: Handle no results ──────────────────────────────────
        if not results:
            yield _sse({"text": "I couldn't find any relevant data in your CRM for that question."})
            yield _sse({"done": True, "sources": []})
            return

        context = _build_context(results)
        sources = [{"type": r["type"], "id": r["id"], "name": r["content"].split("\n")[0]} for r in results]

        # ── Step 4: Stream Claude's answer ─────────────────────────────
        try:
            from services.claude_service import stream_rag_answer
            for chunk in stream_rag_answer(question, context, history):
                yield _sse({"text": chunk})
            yield _sse({"done": True, "sources": sources})
        except RuntimeError as e:
            # API key not configured — return a helpful message
            yield _sse({"text": str(e)})
            yield _sse({"done": True, "sources": sources})
        except Exception as e:
            yield _sse({"error": str(e), "done": True, "sources": []})

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


@rag_bp.route("/index", methods=["POST"])
def index():
    """
    POST /rag/index
    Triggers a full re-indexing of all CRM data into the embeddings table.
    Long-running — runs synchronously (consider a task queue for production).
    """
    try:
        from services.indexer import run_indexing
        counts = run_indexing()
        return jsonify({"message": "Indexing complete", "counts": counts})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@rag_bp.route("/status", methods=["GET"])
def status():
    """GET /rag/status — returns count of indexed records by type."""
    try:
        from services.vector_store import count_embeddings
        counts = count_embeddings()
        return jsonify({"indexed": counts, "total": sum(counts.values())})
    except Exception as e:
        return jsonify({"error": str(e), "indexed": {}, "total": 0})
