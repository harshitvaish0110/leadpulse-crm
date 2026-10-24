"""Smoke tests for the ML service: the app factory boots and lightweight routes respond."""
import pytest

from app import create_app


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.delenv("ML_SERVICE_TOKEN", raising=False)
    monkeypatch.delenv("FLASK_ENV", raising=False)
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.get_json()["status"] == "ok"


def test_sentiment_requires_text(client):
    res = client.post("/sentiment/analyze", json={})
    assert res.status_code == 400


def test_churn_rejects_wrong_feature_count(client):
    res = client.post("/predict/churn", json={"features": [1, 2, 3]})
    assert res.status_code == 400


def test_forecast_needs_two_points(client):
    res = client.post("/forecast/revenue", json={"historical": [{"ds": "2026-01-01", "y": 100}]})
    assert res.status_code == 200
    assert res.get_json()["forecast"] == []


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
