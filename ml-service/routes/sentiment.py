"""Sentiment analysis route — analyzes text and returns sentiment label + score."""

from flask import Blueprint, request, jsonify

sentiment_bp = Blueprint("sentiment", __name__)


@sentiment_bp.route("/analyze", methods=["POST"])
def analyze():
    """
    POST /sentiment/analyze
    Body: { "text": "..." }
    Returns: { "label": "POSITIVE|NEUTRAL|NEGATIVE", "score": 0.0-1.0, "mapped_sentiment": "..." }
    """
    data = request.get_json()
    text = data.get("text", "")

    if not text.strip():
        return jsonify({"error": "No text provided"}), 400

    # Stub — will be replaced with HuggingFace transformer in Phase 5
    return jsonify({
        "label": "NEUTRAL",
        "score": 0.5,
        "mapped_sentiment": "NEUTRAL",
        "message": "Stub response — ML model not yet loaded",
    })
