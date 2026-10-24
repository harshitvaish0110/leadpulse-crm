"""
LeadPulse ML Service — Flask API for AI/ML predictions.
Provides sentiment analysis, lead/churn scoring, revenue forecasting,
RAG pipeline, and audio transcription endpoints.
"""

import hmac
import os
from flask import Flask, jsonify, request
from dotenv import load_dotenv
from werkzeug.exceptions import HTTPException

load_dotenv()


def create_app():
    """Application factory for the Flask ML service."""
    app = Flask(__name__)

    # Only the API server calls this service (no browser access, so no CORS).
    # Every route except /health needs X-ML-Token; without a token configured
    # the check is skipped in development and everything is refused in production.
    token = os.getenv("ML_SERVICE_TOKEN", "")
    production = os.getenv("FLASK_ENV") == "production"

    @app.before_request
    def require_token():
        if request.path == "/health":
            return None
        if not token:
            return (jsonify({"error": "ML_SERVICE_TOKEN is not configured"}), 503) if production else None
        if not hmac.compare_digest(request.headers.get("X-ML-Token", ""), token):
            return jsonify({"error": "Unauthorized"}), 401
        return None

    # ── Register blueprints ────────────────────────────────
    from routes.sentiment import sentiment_bp
    from routes.predict import predict_bp
    from routes.forecast import forecast_bp
    from routes.rag import rag_bp
    from routes.transcribe import transcribe_bp

    app.register_blueprint(sentiment_bp, url_prefix="/sentiment")
    app.register_blueprint(predict_bp, url_prefix="/predict")
    app.register_blueprint(forecast_bp, url_prefix="/forecast")
    app.register_blueprint(rag_bp, url_prefix="/rag")
    app.register_blueprint(transcribe_bp, url_prefix="/transcribe")

    # ── Health check ───────────────────────────────────────
    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok", "service": "leadpulse-ml"})

    # ── Global error handler ───────────────────────────────
    @app.errorhandler(Exception)
    def handle_error(error):
        if isinstance(error, HTTPException):
            return jsonify({"error": error.description}), error.code
        app.logger.exception("Unhandled error")
        return jsonify({"error": "Internal Server Error"}), 500

    return app


if __name__ == "__main__":
    app = create_app()
    port  = int(os.getenv("FLASK_PORT", 5001))
    debug = os.getenv("FLASK_ENV", "development") == "development"
    # use_reloader=False prevents the watchdog from restarting the server
    # every time it detects changes in the large transformers package tree.
    app.run(host="0.0.0.0", port=port, debug=debug, use_reloader=False)
