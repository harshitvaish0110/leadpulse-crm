"""
Sentiment analysis route.
Uses HuggingFace distilbert for fast, accurate sentiment classification.
Model is loaded once at startup and reused across all requests.
"""

from flask import Blueprint, request, jsonify
import os

sentiment_bp = Blueprint("sentiment", __name__)

# ── Load model once at startup (lazy on first request if memory constrained) ──
_classifier = None

def get_classifier():
    global _classifier
    if _classifier is None:
        try:
            from transformers import pipeline
            print("Loading sentiment model (distilbert)...")
            _classifier = pipeline(
                "sentiment-analysis",
                model="distilbert-base-uncased-finetuned-sst-2-english",
                device=-1,   # -1 = CPU; 0 = first GPU
                truncation=True,
                max_length=512,
            )
            print("[OK] Sentiment model loaded")
        except Exception as e:
            print(f"[WARN] Could not load transformer model: {e}. Using fallback keyword heuristic.")
            _classifier = "fallback"
    return _classifier


def _keyword_fallback(text: str) -> tuple[str, float]:
    """Simple keyword-based fallback when transformer unavailable."""
    text_lower = text.lower()
    positive_words = {"great", "excellent", "happy", "love", "good", "amazing", "wonderful", "fantastic", "pleased", "satisfied"}
    negative_words = {"bad", "terrible", "horrible", "hate", "disappointed", "awful", "worst", "dissatisfied", "angry", "frustrat"}
    
    pos = sum(1 for w in positive_words if w in text_lower)
    neg = sum(1 for w in negative_words if w in text_lower)
    
    if pos > neg:
        return "POSITIVE", 0.75
    elif neg > pos:
        return "NEGATIVE", 0.25
    return "NEUTRAL", 0.5


def _map_sentiment(label: str, score: float) -> tuple[str, float]:
    """Convert HuggingFace output → LeadPulse sentiment label."""
    positive_score = score if label == "POSITIVE" else 1.0 - score
    if positive_score > 0.75:
        return "POSITIVE", round(positive_score, 4)
    elif positive_score > 0.45:
        return "NEUTRAL", round(positive_score, 4)
    elif positive_score > 0.20:
        return "NEGATIVE", round(positive_score, 4)
    return "AT_RISK", round(positive_score, 4)


@sentiment_bp.route("/analyze", methods=["POST"])
def analyze():
    """
    POST /sentiment/analyze
    Body: { "text": "..." }
    Returns: { "mapped_sentiment": "POSITIVE|NEUTRAL|NEGATIVE|AT_RISK", "score": 0.0-1.0 }
    """
    data = request.get_json(silent=True) or {}
    text = data.get("text", "").strip()

    if not text:
        return jsonify({"error": "No text provided"}), 400

    clf = get_classifier()

    if clf == "fallback":
        mapped_label, mapped_score = _keyword_fallback(text)
        return jsonify({
            "raw_label": mapped_label,
            "raw_score": mapped_score,
            "mapped_sentiment": mapped_label,
            "score": mapped_score,
            "source": "keyword-fallback",
        })

    try:
        result = clf(text[:512])[0]
        mapped_label, mapped_score = _map_sentiment(result["label"], result["score"])
        return jsonify({
            "raw_label": result["label"],
            "raw_score": round(result["score"], 4),
            "mapped_sentiment": mapped_label,
            "score": mapped_score,
            "source": "distilbert",
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@sentiment_bp.route("/batch", methods=["POST"])
def batch_analyze():
    """
    POST /sentiment/batch
    Body: { "texts": ["text1", "text2", ...] }
    Returns: { "results": [{ "mapped_sentiment": ..., "score": ... }, ...] }
    """
    data = request.get_json(silent=True) or {}
    texts = data.get("texts", [])

    if not texts:
        return jsonify({"error": "No texts provided"}), 400

    clf = get_classifier()
    results = []

    for text in texts[:50]:  # cap at 50 to avoid timeouts
        if not text or not text.strip():
            results.append({"mapped_sentiment": "NEUTRAL", "score": 0.5})
            continue
        if clf == "fallback":
            mapped_label, mapped_score = _keyword_fallback(text)
            results.append({"mapped_sentiment": mapped_label, "score": mapped_score})
        else:
            try:
                r = clf(text[:512])[0]
                mapped_label, mapped_score = _map_sentiment(r["label"], r["score"])
                results.append({"mapped_sentiment": mapped_label, "score": mapped_score})
            except Exception:
                results.append({"mapped_sentiment": "NEUTRAL", "score": 0.5})

    return jsonify({"results": results})
