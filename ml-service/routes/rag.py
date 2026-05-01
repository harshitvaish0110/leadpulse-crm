"""RAG (Retrieval-Augmented Generation) route — semantic search over CRM data."""

from flask import Blueprint, request, jsonify

rag_bp = Blueprint("rag", __name__)


@rag_bp.route("/query", methods=["POST"])
def query():
    """
    POST /rag/query
    Body: { "question": "...", "userId": "..." }
    Returns: { "answer": "...", "sources": [...] }
    """
    data = request.get_json()
    question = data.get("question", "")

    if not question.strip():
        return jsonify({"error": "No question provided"}), 400

    # Stub — will use LangChain + pgvector in Phase 5
    return jsonify({
        "answer": "RAG pipeline not yet configured. This will be implemented in Phase 5.",
        "sources": [],
    })
