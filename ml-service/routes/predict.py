"""
Churn and win-probability predictions from named feature rows.

POST /predict/churn     { rows: [{ id, <churn features> }] }  -> { predictions: [{ id, risk }], model_version, source }
POST /predict/win_prob  { rows: [{ id, <win features> }] }    -> { predictions: [{ id, probability }], model_version, source }

Each row must contain exactly `id` plus the model's features (models/metadata.json);
anything else is a 422, so a schema drift between the API and the model is caught
instead of silently mis-scored. Probabilities are 0–1.
"""

import math

import numpy as np
from flask import Blueprint, jsonify, request

from services import model_store

predict_bp = Blueprint("predict", __name__)

MAX_ROWS = 1000


def _validate(kind: str, rows):
    if not isinstance(rows, list) or not rows:
        return None, ("rows must be a non-empty list", 400)
    if len(rows) > MAX_ROWS:
        return None, (f"at most {MAX_ROWS} rows per request", 422)
    expected = set(model_store.features(kind)) | {"id"}
    for i, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) != expected:
            got = sorted(row) if isinstance(row, dict) else type(row).__name__
            return None, (f"row {i}: keys must be exactly {sorted(expected)}, got {got}", 422)
        for key in expected - {"id"}:
            value = row[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                return None, (f"row {i}: {key} must be a finite number", 422)
    return rows, None


def _predict(kind: str, output_key: str):
    rows, error = _validate(kind, (request.get_json(silent=True) or {}).get("rows"))
    if error:
        message, status = error
        return jsonify({"error": message}), status

    names = model_store.features(kind)
    model = model_store.get(kind)
    if model is not None:
        matrix = np.array([[float(r[n]) for n in names] for r in rows], dtype=np.float64)
        probs = model.predict_proba(matrix)[:, 1]
        source = "model"
    else:
        probs = [model_store.heuristic(kind, r) for r in rows]
        source = "heuristic"

    return jsonify({
        "predictions": [{"id": r["id"], output_key: round(float(min(1.0, max(0.0, p))), 4)} for r, p in zip(rows, probs)],
        "model_version": model_store.version(kind) if model is not None else None,
        "source": source,
    })


@predict_bp.route("/churn", methods=["POST"])
def churn():
    return _predict("churn", "risk")


@predict_bp.route("/win_prob", methods=["POST"])
def win_probability():
    return _predict("win", "probability")
