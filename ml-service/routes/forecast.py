"""Revenue forecasting route — time series predictions using Prophet."""

from flask import Blueprint, request, jsonify

forecast_bp = Blueprint("forecast", __name__)


@forecast_bp.route("/revenue", methods=["POST"])
def revenue():
    """
    POST /forecast/revenue
    Body: { "historical": [{ "ds": "2024-01-01", "y": 50000 }, ...] }
    Returns: { "forecast": [...], "summary": {...} }
    """
    data = request.get_json()
    historical = data.get("historical", [])

    if not historical:
        return jsonify({"error": "No historical data provided"}), 400

    # Stub — will use Prophet in Phase 5
    return jsonify({
        "forecast": [],
        "summary": {"message": "Stub — Prophet model not yet configured"},
    })
