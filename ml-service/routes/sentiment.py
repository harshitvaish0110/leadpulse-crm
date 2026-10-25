"""
Sentiment of activity notes.

POST /sentiment/analyze  { text }            -> { label, score, mapped_sentiment, source }
POST /sentiment/batch    { texts: [≤ 50] }   -> { results: [...] }

`score` is P(positive) in 0–1. `mapped_sentiment` uses the product bands:
p > 0.7 POSITIVE · 0.4–0.7 NEUTRAL · 0.2–0.4 NEGATIVE · < 0.2 AT_RISK.
Falls back to a keyword heuristic when the ONNX model is unavailable.
"""

import re

from flask import Blueprint, jsonify, request

from services import onnx_models

sentiment_bp = Blueprint("sentiment", __name__)

MAX_CHARS = 5000
MAX_BATCH = 50

_POSITIVE = re.compile(r"\b(great|excellent|happy|love[sd]?|good|amazing|wonderful|fantastic|pleased|satisfied|excited|impressed|thrilled|perfect)\b")
_NEGATIVE = re.compile(r"\b(bad|terrible|horrible|hate[sd]?|disappoint\w*|awful|worst|dissatisfied|angry|frustrat\w*|cancel\w*|churn\w*|unhappy|complain\w*)\b")


def map_sentiment(p: float) -> str:
    if p > 0.7:
        return "POSITIVE"
    if p >= 0.4:
        return "NEUTRAL"
    if p >= 0.2:
        return "NEGATIVE"
    return "AT_RISK"


def keyword_probability(text: str) -> float:
    """Rough P(positive) from sentiment words; 0.5 when there is no signal."""
    lowered = text.lower()
    pos, neg = len(_POSITIVE.findall(lowered)), len(_NEGATIVE.findall(lowered))
    if pos == neg:
        return 0.5
    return 0.8 if pos > neg else 0.15


def score_texts(texts: list[str]) -> tuple[list[float], str]:
    """P(positive) for each text, from the model when available."""
    if onnx_models.available(onnx_models.SENTIMENT):
        try:
            return [float(p) for p in onnx_models.positive_probability(texts)], "onnx"
        except Exception as err:  # noqa: BLE001 — keep serving with the fallback
            print(f"[sentiment] model failed, using keywords: {err}", flush=True)
    return [keyword_probability(t) for t in texts], "keyword"


def _result(p: float, source: str) -> dict:
    return {
        "label": "POSITIVE" if p >= 0.5 else "NEGATIVE",
        "score": round(p, 4),
        "mapped_sentiment": map_sentiment(p),
        "source": source,
    }


@sentiment_bp.route("/analyze", methods=["POST"])
def analyze():
    text = str((request.get_json(silent=True) or {}).get("text") or "").strip()
    if not text:
        return jsonify({"error": "text is required"}), 400
    [p], source = score_texts([text[:MAX_CHARS]])
    return jsonify(_result(p, source))


@sentiment_bp.route("/batch", methods=["POST"])
def batch():
    texts = (request.get_json(silent=True) or {}).get("texts")
    if not isinstance(texts, list) or not texts:
        return jsonify({"error": "texts must be a non-empty list"}), 400
    if len(texts) > MAX_BATCH:
        return jsonify({"error": f"at most {MAX_BATCH} texts per request"}), 422
    cleaned = [str(t or "").strip()[:MAX_CHARS] for t in texts]
    scored = [i for i, t in enumerate(cleaned) if t]
    probs, source = score_texts([cleaned[i] for i in scored]) if scored else ([], "keyword")
    by_index = dict(zip(scored, probs))
    return jsonify({"results": [_result(by_index.get(i, 0.5), source) for i in range(len(cleaned))]})
