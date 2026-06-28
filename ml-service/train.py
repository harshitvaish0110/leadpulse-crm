"""
Model Training Script — trains churn and win-probability models from LeadPulse seed data.

Usage:
    cd ml-service
    python train.py

Prerequisites:
    1. PostgreSQL running with seeded data (cd server && npx prisma db seed)
    2. .env file with DATABASE_URL set
    3. pip install scikit-learn xgboost pandas numpy joblib psycopg2-binary
"""

import os
import sys
import warnings
warnings.filterwarnings("ignore")

from dotenv import load_dotenv
load_dotenv()

import psycopg2
import pandas as pd
import numpy as np
import joblib
from pathlib import Path
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, roc_auc_score

# Ensure models/ directory exists
MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)


def connect():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("❌ DATABASE_URL not set in .env")
        sys.exit(1)
    return psycopg2.connect(db_url)


# ── CHURN MODEL ───────────────────────────────────────────────────────────────

def train_churn_model(conn):
    print("\n─── Training Churn Model ───────────────────────────────")

    df = pd.read_sql("""
        SELECT
            c.id,
            c.status,
            COALESCE(c."sentimentScore", 0.5)                               AS sentiment_score,
            COALESCE(c."leadScore", 0)                                      AS lead_score,
            COALESCE(EXTRACT(DAY FROM NOW() - MAX(a."occurredAt")), 999)    AS days_since_last_contact,
            COUNT(CASE WHEN a."occurredAt" > NOW() - INTERVAL '30 days' THEN 1 END) AS activity_last_30,
            COUNT(CASE WHEN a."occurredAt" > NOW() - INTERVAL '90 days' THEN 1 END) AS activity_last_90,
            COUNT(DISTINCT d.id)                                             AS deal_count,
            COALESCE(SUM(CAST(d.value AS FLOAT)), 0)                        AS total_deal_value,
            CASE WHEN EXISTS (
                SELECT 1 FROM deals d2
                WHERE d2."contactId" = c.id
                  AND d2.stage NOT IN ('CLOSED_WON', 'CLOSED_LOST')
            ) THEN 1 ELSE 0 END                                              AS has_open_deal
        FROM contacts c
        LEFT JOIN activities a ON a."contactId" = c.id
        LEFT JOIN deals d ON d."contactId" = c.id
        WHERE c.status IN ('ACTIVE', 'CHURNED', 'INACTIVE')
        GROUP BY c.id, c.status, c."sentimentScore", c."leadScore"
    """, conn)

    print(f"  Rows fetched: {len(df)}")
    print(f"  Status distribution:\n{df['status'].value_counts().to_string()}")

    df["churned"] = (df["status"] == "CHURNED").astype(int)

    FEATURES = [
        "days_since_last_contact", "activity_last_30", "activity_last_90",
        "sentiment_score", "lead_score", "deal_count", "total_deal_value", "has_open_deal"
    ]

    X = df[FEATURES].fillna(0).values
    y = df["churned"].values

    if y.sum() < 5:
        print("  ⚠ Not enough churned contacts (<5) to train a meaningful model.")
        print("    Creating a heuristic placeholder model...")
        # Fit a trivial model on synthetic data
        X_syn = np.random.rand(50, 8)
        y_syn = (X_syn[:, 0] > 0.5).astype(int)  # days_since_last > 0.5 → churn
        scaler = StandardScaler()
        X_syn_s = scaler.fit_transform(X_syn)
        model = LogisticRegression(random_state=42)
        model.fit(X_syn_s, y_syn)
    else:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        scaler  = StandardScaler()
        X_train = scaler.fit_transform(X_train)
        X_test  = scaler.transform(X_test)

        model = LogisticRegression(
            random_state=42, max_iter=1000, class_weight="balanced"
        )
        model.fit(X_train, y_train)

        acc = model.score(X_test, y_test)
        try:
            auc = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])
        except Exception:
            auc = 0.0

        print(f"\n  Churn Model — Accuracy: {acc:.2%}  |  AUC-ROC: {auc:.3f}")
        print(classification_report(y_test, model.predict(X_test)))

    joblib.dump(model,  MODELS_DIR / "churn_model.pkl")
    joblib.dump(scaler, MODELS_DIR / "churn_scaler.pkl")
    print("  ✓ Saved: models/churn_model.pkl + churn_scaler.pkl")
    return True


# ── WIN PROBABILITY MODEL ─────────────────────────────────────────────────────

def train_win_model(conn):
    print("\n─── Training Win Probability Model ─────────────────────")

    STAGE_MAP = {
        "LEAD": 0, "CONTACTED": 1, "DEMO": 2,
        "PROPOSAL": 3, "NEGOTIATION": 4, "CLOSED_WON": 5, "CLOSED_LOST": 5
    }

    df = pd.read_sql("""
        SELECT
            d.id,
            d.stage,
            CAST(d.value AS FLOAT)                                          AS value,
            COALESCE(EXTRACT(DAY FROM NOW() - d."updatedAt"), 0)            AS days_in_stage,
            COUNT(a.id)                                                      AS total_activities,
            COUNT(CASE WHEN a."occurredAt" > NOW() - INTERVAL '7 days' THEN 1 END) AS activity_last_7,
            COALESCE(co.size, 50)                                            AS company_size
        FROM deals d
        LEFT JOIN activities a  ON a."dealId" = d.id
        LEFT JOIN contacts c    ON c.id = d."contactId"
        LEFT JOIN companies co  ON co.id = c."companyId"
        WHERE d.stage IN ('CLOSED_WON', 'CLOSED_LOST')
        GROUP BY d.id, d.stage, d.value, d."updatedAt", co.size
    """, conn)

    print(f"  Closed deals fetched: {len(df)}")

    df["won"]       = (df["stage"] == "CLOSED_WON").astype(int)
    df["stage_num"] = df["stage"].map(STAGE_MAP).fillna(0)

    FEATURES = ["stage_num", "value", "days_in_stage", "total_activities", "activity_last_7", "company_size"]
    X = df[FEATURES].fillna(0).values
    y = df["won"].values

    if len(X) < 10:
        print("  ⚠ Not enough closed deals (<10) to train win model. Creating placeholder.")
        try:
            import xgboost as xgb
            model = xgb.XGBClassifier(n_estimators=1, random_state=42, eval_metric="logloss")
        except ImportError:
            from sklearn.linear_model import LogisticRegression
            model = LogisticRegression()
        model.fit([[0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1]], [0, 1])
    else:
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

        try:
            import xgboost as xgb
            model = xgb.XGBClassifier(
                n_estimators=100, max_depth=4, learning_rate=0.1,
                random_state=42, eval_metric="logloss", verbosity=0,
            )
        except ImportError:
            print("  XGBoost not available — falling back to LogisticRegression")
            from sklearn.linear_model import LogisticRegression
            model = LogisticRegression(random_state=42)

        model.fit(X_train, y_train)

        acc = model.score(X_test, y_test)
        try:
            auc = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])
        except Exception:
            auc = 0.0

        print(f"\n  Win Model — Accuracy: {acc:.2%}  |  AUC-ROC: {auc:.3f}")
        print(classification_report(y_test, model.predict(X_test)))

    joblib.dump(model, MODELS_DIR / "win_prob_model.pkl")
    print("  ✓ Saved: models/win_prob_model.pkl")
    return True


# ── ENTRY POINT ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("LeadPulse Model Training")
    print("=" * 50)

    conn = connect()
    try:
        train_churn_model(conn)
        train_win_model(conn)
        print("\n✅ All models trained and saved to ml-service/models/")
        print("   Restart the Flask service to load the new models.")
    finally:
        conn.close()
