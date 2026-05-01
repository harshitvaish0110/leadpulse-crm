"""Prediction routes — lead scoring, churn risk, win probability."""

from flask import Blueprint, request, jsonify

predict_bp = Blueprint("predict", __name__)


@predict_bp.route("/lead-score", methods=["POST"])
def lead_score():
    """Predict lead score for a contact."""
    data = request.get_json()
    return jsonify({
        "score": 50,
        "label": "WARM",
        "explanation": "Stub — model not yet trained",
    })


@predict_bp.route("/churn-risk", methods=["POST"])
def churn_risk():
    """Predict churn risk for a contact."""
    data = request.get_json()
    return jsonify({
        "risk": 0.3,
        "label": "LOW",
        "factors": [],
    })


@predict_bp.route("/win-probability", methods=["POST"])
def win_probability():
    """Predict win probability for a deal."""
    data = request.get_json()
    return jsonify({
        "probability": 0.5,
        "factors": [],
    })
