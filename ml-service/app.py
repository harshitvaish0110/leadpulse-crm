"""
LeadPulse ML service: sentiment, embeddings, churn and win-probability
predictions, and revenue forecasts. It needs no database to serve; the API sends
the feature rows it reads from the ml_*_features views.
"""

import hmac
import os

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

load_dotenv()
os.environ.setdefault("OMP_NUM_THREADS", "1")


def _memory_mb():
    """Resident set size of this process in MB (Linux); peak RSS elsewhere."""
    try:
        with open("/proc/self/status", encoding="ascii") as status:
            for line in status:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024)
    except OSError:
        pass
    try:
        import resource  # Unix only
        return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)
    except ImportError:
        return None


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

    from routes.embed import embed_bp
    from routes.forecast import forecast_bp
    from routes.predict import predict_bp
    from routes.sentiment import sentiment_bp

    app.register_blueprint(sentiment_bp, url_prefix="/sentiment")
    app.register_blueprint(embed_bp, url_prefix="/embed")
    app.register_blueprint(predict_bp, url_prefix="/predict")
    app.register_blueprint(forecast_bp, url_prefix="/forecast")

    @app.route("/health", methods=["GET"])
    def health():
        from services import model_store, onnx_models

        meta = model_store.metadata()
        return jsonify({
            "status": "ok",
            "service": "leadpulse-ml",
            "models": {
                "sentiment": onnx_models.available(onnx_models.SENTIMENT),
                "embedder": onnx_models.available(onnx_models.EMBEDDER),
                "churn": (model_store.MODELS_DIR / model_store.ARTIFACTS["churn"]).exists(),
                "win": (model_store.MODELS_DIR / model_store.ARTIFACTS["win"]).exists(),
            },
            "versions": {kind: meta.get(kind, {}).get("version") for kind in ("churn", "win")},
            "memoryMb": _memory_mb(),
        })

    @app.errorhandler(Exception)
    def handle_error(error):
        if isinstance(error, HTTPException):
            return jsonify({"error": error.description}), error.code
        app.logger.exception("Unhandled error")
        return jsonify({"error": "Internal Server Error"}), 500

    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=int(os.getenv("FLASK_PORT", "5001")))
