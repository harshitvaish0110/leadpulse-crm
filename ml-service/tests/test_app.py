"""Smoke tests for the ML service: the app factory boots and lightweight routes respond."""
import pytest

from app import create_app


@pytest.fixture()
def client():
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
