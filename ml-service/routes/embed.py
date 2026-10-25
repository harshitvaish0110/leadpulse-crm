"""
Sentence embeddings for semantic search.

POST /embed  { texts: [≤ 64] }  ->  { vectors: [[384 floats], ...], dim: 384, model }
Vectors are L2-normalised, so cosine similarity is a dot product.
"""

from flask import Blueprint, jsonify, request

from services import onnx_models

embed_bp = Blueprint("embed", __name__)

MAX_BATCH = 64
MAX_CHARS = 8000
MODEL = "all-MiniLM-L6-v2 (int8 ONNX)"


@embed_bp.route("", methods=["POST"])
def embed():
    texts = (request.get_json(silent=True) or {}).get("texts")
    if not isinstance(texts, list) or not texts or not all(isinstance(t, str) and t.strip() for t in texts):
        return jsonify({"error": "texts must be a non-empty list of non-empty strings"}), 400
    if len(texts) > MAX_BATCH:
        return jsonify({"error": f"at most {MAX_BATCH} texts per request"}), 422
    if not onnx_models.available(onnx_models.EMBEDDER):
        return jsonify({"error": "The embedding model is not installed"}), 503

    vectors = onnx_models.embed([t.strip()[:MAX_CHARS] for t in texts])
    return jsonify({"vectors": [[round(float(x), 6) for x in v] for v in vectors], "dim": int(vectors.shape[1]), "model": MODEL})
