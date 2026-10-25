"""ML service tests: auth, sentiment, embeddings, predictions and forecasting."""

import json
from pathlib import Path

import numpy as np
import pytest

from app import create_app
from routes.sentiment import keyword_probability, map_sentiment
from services import model_store, onnx_models
from services.features import CHURN_FEATURES, WIN_FEATURES

needs_sentiment = pytest.mark.skipif(not onnx_models.available(onnx_models.SENTIMENT), reason="run scripts/fetch_models.py first")
needs_embedder = pytest.mark.skipif(not onnx_models.available(onnx_models.EMBEDDER), reason="run scripts/fetch_models.py first")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.delenv("ML_SERVICE_TOKEN", raising=False)
    monkeypatch.delenv("FLASK_ENV", raising=False)
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


@pytest.fixture()
def untrained(monkeypatch, tmp_path):
    """No trained churn/win artifacts: predictions use the heuristics."""
    monkeypatch.setattr(model_store, "MODELS_DIR", tmp_path)
    model_store.reset()
    yield
    model_store.reset()


# ── Service ─────────────────────────────────────────────────────────────────

def test_health_reports_models(client):
    body = client.get("/health").get_json()
    assert body["status"] == "ok"
    assert set(body["models"]) == {"sentiment", "embedder", "churn", "win"}


def test_token_required_when_configured(monkeypatch):
    monkeypatch.setenv("ML_SERVICE_TOKEN", "secret")
    client = create_app().test_client()
    assert client.get("/health").status_code == 200
    assert client.post("/sentiment/analyze", json={"text": "hi"}).status_code == 401
    assert client.post("/sentiment/analyze", json={}, headers={"X-ML-Token": "wrong"}).status_code == 401
    assert client.post("/sentiment/analyze", json={}, headers={"X-ML-Token": "secret"}).status_code == 400


def test_production_without_token_refuses(monkeypatch):
    monkeypatch.delenv("ML_SERVICE_TOKEN", raising=False)
    monkeypatch.setenv("FLASK_ENV", "production")
    assert create_app().test_client().post("/predict/churn", json={}).status_code == 503


def test_unknown_route_is_404_not_500(client):
    assert client.get("/nope").status_code == 404


# ── Sentiment ───────────────────────────────────────────────────────────────

def test_sentiment_bands():
    assert [map_sentiment(p) for p in (0.95, 0.71, 0.7, 0.4, 0.39, 0.2, 0.19, 0.0)] == [
        "POSITIVE", "POSITIVE", "NEUTRAL", "NEUTRAL", "NEGATIVE", "NEGATIVE", "AT_RISK", "AT_RISK"]


def test_sentiment_requires_text(client):
    assert client.post("/sentiment/analyze", json={}).status_code == 400


def test_keyword_fallback_when_model_missing(client, monkeypatch):
    monkeypatch.setattr(onnx_models, "available", lambda name: False)
    body = client.post("/sentiment/analyze", json={"text": "They are frustrated and want to cancel"}).get_json()
    assert body["source"] == "keyword"
    assert body["mapped_sentiment"] == "AT_RISK"
    assert keyword_probability("nothing to see here") == 0.5


def test_sentiment_batch_limits_and_blanks(client):
    assert client.post("/sentiment/batch", json={"texts": ["x"] * 51}).status_code == 422
    results = client.post("/sentiment/batch", json={"texts": ["", "great news"]}).get_json()["results"]
    assert len(results) == 2 and results[0]["score"] == 0.5


@needs_sentiment
def test_sentiment_golden_set_accuracy():
    golden = json.loads((Path(__file__).parent / "sentiment_golden.json").read_text(encoding="utf-8"))
    probs = onnx_models.positive_probability([g["text"] for g in golden])
    correct = sum((p >= 0.5) == (g["label"] == "POSITIVE") for p, g in zip(probs, golden))
    accuracy = correct / len(golden)
    assert accuracy >= 0.85, f"golden-set accuracy {accuracy:.0%}"


# ── Embeddings ──────────────────────────────────────────────────────────────

@needs_embedder
def test_embeddings_are_normalised_and_meaningful(client):
    texts = ["Acme renewal is at risk because of pricing", "Pricing concerns may cost us the Acme renewal", "Lunch menu for Friday"]
    body = client.post("/embed", json={"texts": texts}).get_json()
    vectors = np.array(body["vectors"])
    assert body["dim"] == 384 and vectors.shape == (3, 384)
    assert np.allclose(np.linalg.norm(vectors, axis=1), 1.0, atol=1e-3)
    assert vectors[0] @ vectors[1] > vectors[0] @ vectors[2] + 0.2


def test_embed_validation(client):
    assert client.post("/embed", json={"texts": []}).status_code == 400
    assert client.post("/embed", json={"texts": ["ok", ""]}).status_code == 400
    assert client.post("/embed", json={"texts": ["x"] * 65}).status_code == 422


# ── Predictions ─────────────────────────────────────────────────────────────

def churn_row(**over):
    row = {"id": "c1", "days_since_last_contact": 120.0, "activity_count_30d": 0, "activity_count_90d": 1,
           "avg_sentiment": 0.3, "deal_count": 1, "total_deal_value": 5000.0, "has_open_deal": 0}
    return {**row, **over}


def win_row(**over):
    row = {"id": "d1", "stage_ordinal": 3, "deal_value": 25000.0, "days_in_current_stage": 12.0,
           "total_activities": 9, "activity_last_7d": 2, "contact_seniority": 2, "company_size": 250}
    return {**row, **over}


def test_feature_rows_match_the_definitions():
    assert set(churn_row()) - {"id"} == set(CHURN_FEATURES)
    assert set(win_row()) - {"id"} == set(WIN_FEATURES)


def test_predict_rejects_schema_drift(client):
    bad = churn_row()
    del bad["avg_sentiment"]
    assert client.post("/predict/churn", json={"rows": [bad]}).status_code == 422
    assert client.post("/predict/churn", json={"rows": [churn_row(extra=1)]}).status_code == 422
    assert client.post("/predict/churn", json={"rows": [churn_row(avg_sentiment="high")]}).status_code == 422
    assert client.post("/predict/win_prob", json={"rows": [win_row(deal_value=float("nan"))]}).status_code == 422
    assert client.post("/predict/churn", json={"features": [1, 2, 3]}).status_code == 400


def test_heuristics_until_trained(client, untrained):
    body = client.post("/predict/churn", json={"rows": [churn_row(), churn_row(id="c2", days_since_last_contact=2.0, activity_count_30d=8, avg_sentiment=0.8, has_open_deal=1)]}).get_json()
    assert body["source"] == "heuristic" and body["model_version"] is None
    risks = {p["id"]: p["risk"] for p in body["predictions"]}
    assert risks["c1"] > risks["c2"]
    win = client.post("/predict/win_prob", json={"rows": [win_row()]}).get_json()
    assert 0 <= win["predictions"][0]["probability"] <= 1


@pytest.mark.skipif(not (model_store.MODELS_DIR / "churn.joblib").exists(), reason="run train.py first")
def test_trained_models_score_rows(client):
    model_store.reset()
    churn = client.post("/predict/churn", json={"rows": [churn_row()]}).get_json()
    win = client.post("/predict/win_prob", json={"rows": [win_row(), win_row(id="d2", stage_ordinal=0, activity_last_7d=0)]}).get_json()
    assert churn["source"] == "model" and churn["model_version"]
    assert 0 <= churn["predictions"][0]["risk"] <= 1
    assert all(0 <= p["probability"] <= 1 for p in win["predictions"])


# ── Forecast ────────────────────────────────────────────────────────────────

def months(n, start=(2025, 1)):
    year, month = start
    out = []
    for i in range(n):
        m = month - 1 + i
        out.append({"ds": f"{year + m // 12}-{m % 12 + 1:02d}-01", "y": 1000 + 100 * i})
    return out


def test_forecast_needs_two_points(client):
    body = client.post("/forecast/revenue", json={"historical": months(1)}).get_json()
    assert body["forecast"] == [] and body["source"] == "none"


def test_short_history_uses_the_linear_trend(client):
    body = client.post("/forecast/revenue", json={"historical": months(4), "periods": 3}).get_json()
    assert body["source"] == "linear"
    assert [f["ds"] for f in body["forecast"]] == ["2025-05-01", "2025-06-01", "2025-07-01"]
    assert body["forecast"][0]["yhat"] == pytest.approx(1400, rel=0.01)
    assert all(f["yhat_lower"] <= f["yhat"] <= f["yhat_upper"] for f in body["forecast"])


def test_forecast_validation(client):
    assert client.post("/forecast/revenue", json={"historical": months(4), "periods": 0}).status_code == 422
    assert client.post("/forecast/revenue", json={"historical": [{"ds": "nope", "y": 1}, {"ds": "2025-01-01", "y": 2}]}).status_code == 422
