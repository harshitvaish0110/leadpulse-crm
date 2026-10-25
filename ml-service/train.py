"""
Trains the churn and win-probability models from the feature views and writes
models/churn.joblib, models/win.json and models/metadata.json.

    python train.py              # train, gate on ROC-AUC, save
    python train.py --dry-run    # report metrics only

Training reads the same ml_contact_features / ml_deal_features views the API uses
to build serving rows, so the two can never disagree about what a feature means.
Metrics come from 5-fold cross-validation; a model below the AUC gate is not saved.
"""

import argparse
import datetime as dt
import json
import os
import sys
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import psycopg2
import sklearn
import xgboost
from dotenv import load_dotenv
from sklearn.calibration import CalibratedClassifierCV
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

from services.features import CHURN_FEATURES, WIN_FEATURES

warnings.filterwarnings("ignore", category=UserWarning)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

MODELS_DIR = Path(__file__).resolve().parent / "models"
MIN_AUC = 0.70
SEED = 42


def connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set")
    return psycopg2.connect(url.split("?")[0])  # psycopg2 does not accept Prisma's ?schema=


def churn_model():
    return Pipeline([
        ("scale", StandardScaler()),
        ("model", CalibratedClassifierCV(LogisticRegression(class_weight="balanced", max_iter=2000), cv=5)),
    ])


def win_model():
    return XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.9,
                         random_state=SEED, n_jobs=1, verbosity=0)


def evaluate(make_model, X: pd.DataFrame, y: pd.Series) -> dict:
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    proba = cross_val_predict(make_model(), X, y, cv=folds, method="predict_proba")[:, 1]
    return {
        "roc_auc": round(float(roc_auc_score(y, proba)), 4),
        "brier": round(float(brier_score_loss(y, proba)), 4),
        "accuracy": round(float(accuracy_score(y, proba >= 0.5)), 4),
    }


def next_version(previous) -> str:
    today = dt.date.today().strftime("%Y.%m.%d")
    if previous and previous.startswith(today + "-"):
        return f"{today}-{int(previous.rsplit('-', 1)[1]) + 1}"
    return f"{today}-1"


def train(kind, frame, features, label, make_model, dry_run, previous_meta):
    # Plain arrays in feature order: exactly what the prediction route builds from named rows.
    X, y = frame[features].astype(float).to_numpy(), frame[label].astype(int)
    if y.nunique() < 2 or y.value_counts().min() < 5:
        print(f"[{kind}] not enough examples of each outcome (n={len(y)}, positives={int(y.sum())}); skipped")
        return None
    metrics = evaluate(make_model, X, y)
    passed = metrics["roc_auc"] >= MIN_AUC
    print(f"[{kind}] n={len(y)} positives={int(y.sum())} {metrics} gate={'PASS' if passed else 'FAIL'} (AUC >= {MIN_AUC})")
    if dry_run or not passed:
        return None

    model = make_model().fit(X, y)
    if kind == "churn":
        joblib.dump(model, MODELS_DIR / "churn.joblib")
    else:
        model.save_model(MODELS_DIR / "win.json")
    return {
        "version": next_version(previous_meta.get(kind, {}).get("version")),
        "trained_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "n_samples": int(len(y)),
        "positives": int(y.sum()),
        "features": features,
        "metrics": metrics,
        "libraries": {"scikit-learn": sklearn.__version__, "xgboost": xgboost.__version__, "numpy": np.__version__},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--dry-run", action="store_true", help="report metrics without saving models")
    args = parser.parse_args()

    with connect() as conn:
        contacts = pd.read_sql("SELECT * FROM ml_contact_features WHERE status IN ('ACTIVE', 'INACTIVE', 'CHURNED')", conn)
        deals = pd.read_sql("SELECT * FROM ml_deal_features WHERE is_closed = 1", conn)
    contacts["churned"] = (contacts["status"] == "CHURNED").astype(int)

    MODELS_DIR.mkdir(exist_ok=True)
    meta_path = MODELS_DIR / "metadata.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

    results = {
        "churn": train("churn", contacts, CHURN_FEATURES, "churned", churn_model, args.dry_run, meta),
        "win": train("win", deals, WIN_FEATURES, "won", win_model, args.dry_run, meta),
    }
    saved = {k: v for k, v in results.items() if v}
    if saved:
        meta.update(saved)
        meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        print(f"Saved {', '.join(saved)} -> {MODELS_DIR}")
    return 0 if args.dry_run or len(saved) == 2 else 1


if __name__ == "__main__":
    sys.exit(main())
