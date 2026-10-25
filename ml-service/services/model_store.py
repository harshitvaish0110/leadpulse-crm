"""
Loads the trained churn and win models with their metadata (models/metadata.json),
once per process. Missing artifacts are reported, not fatal: predictions fall back
to transparent heuristics until train.py has been run.
"""

import json
import math
import threading
from pathlib import Path

from services.features import CHURN_FEATURES, WIN_FEATURES

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
ARTIFACTS = {"churn": "churn.joblib", "win": "win.json"}
DEFAULT_FEATURES = {"churn": CHURN_FEATURES, "win": WIN_FEATURES}

_LOCK = threading.Lock()
_LOADED = {}


def metadata() -> dict:
    path = MODELS_DIR / "metadata.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def features(kind: str) -> list[str]:
    return metadata().get(kind, {}).get("features") or DEFAULT_FEATURES[kind]


def version(kind: str):
    return metadata().get(kind, {}).get("version")


def get(kind: str):
    """The fitted model for `kind`, or None when it has not been trained yet."""
    with _LOCK:
        if kind in _LOADED:
            return _LOADED[kind]
        path = MODELS_DIR / ARTIFACTS[kind]
        model = None
        if path.exists():
            if kind == "churn":
                import joblib
                model = joblib.load(path)
            else:
                from xgboost import XGBClassifier
                model = XGBClassifier()
                model.load_model(path)
        _LOADED[kind] = model
        return model


def reset():
    """Forget loaded models (used by tests and after retraining)."""
    with _LOCK:
        _LOADED.clear()


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def heuristic(kind: str, row: dict) -> float:
    """Fallback probability when no trained model exists; deliberately simple."""
    if kind == "churn":
        days = min(row["days_since_last_contact"], 365)
        z = 0.035 * (days - 30) - 0.35 * row["activity_count_30d"] - 4.0 * (row["avg_sentiment"] - 0.5) - 0.6 * row["has_open_deal"]
        return _sigmoid(z)
    base = [0.10, 0.20, 0.35, 0.50, 0.65][max(0, min(4, int(row["stage_ordinal"])))]
    return max(0.02, min(0.95, base + 0.02 * min(row["activity_last_7d"], 5) - 0.002 * min(row["days_in_current_stage"], 90)))
