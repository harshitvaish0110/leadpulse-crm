"""
LeadPulse ML Service — Flask API for AI/ML predictions.
Provides sentiment analysis, lead/churn scoring, revenue forecasting,
RAG pipeline, and audio transcription endpoints.
"""

import os
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()


def create_app():
    """Application factory for the Flask ML service."""
    app = Flask(__name__)

    CORS(app, resources={r"/*": {"origins": "*"}})

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
        app.logger.error(f"Unhandled error: {error}")
        return jsonify({"error": str(error)}), 500

    return app


if __name__ == "__main__":
    app = create_app()
    port = int(os.getenv("FLASK_PORT", 5001))
    debug = os.getenv("FLASK_ENV", "development") == "development"
    app.run(host="0.0.0.0", port=port, debug=debug)
