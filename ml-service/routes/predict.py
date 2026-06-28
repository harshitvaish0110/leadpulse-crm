"""
Churn + Win-Probability prediction routes.
Models are trained via train.py and loaded once at startup.
Falls back to heuristic scoring if model files are not yet trained.
"""

from flask import Blueprint, request, jsonify
import numpy as np
import os

predict_bp = Blueprint("predict", __name__)

# ── Lazy model loading ────────────────────────────────────────────────────────
_churn_model = None
_churn_scaler = None
_win_model = None
_models_loaded = False


def _load_models():
    global _churn_model, _churn_scaler, _win_model, _models_loaded
    if _models_loaded:
        return
    try:
        import joblib
        base = os.path.join(os.path.dirname(__file__), "..", "models")
        churn_path  = os.path.join(base, "churn_model.pkl")
        scaler_path = os.path.join(base, "churn_scaler.pkl")
        win_path    = os.path.join(base, "win_prob_model.pkl")

        if os.path.exists(churn_path) and os.path.exists(scaler_path):
            _churn_model  = joblib.load(churn_path)
            _churn_scaler = joblib.load(scaler_path)
            print("[OK] Churn model loaded")
        else:
            print("[WARN] Churn model not found — run python train.py first. Using heuristic fallback.")

        if os.path.exists(win_path):
            _win_model = joblib.load(win_path)
            print("[OK] Win probability model loaded")
        else:
            print("[WARN] Win probability model not found — using heuristic fallback.")

    except ImportError:
        print("[WARN] joblib/sklearn not available. Using heuristic fallback.")
    finally:
        _models_loaded = True


def _heuristic_churn(features: list) -> float:
    """
    Heuristic churn risk when model not trained.
    features: [days_since_last_contact, activity_last_30, activity_last_90,
               sentiment_score, lead_score, deal_count, total_deal_value, has_open_deal]
    """
    days, act30, act90, sentiment, lead_score, deals, value, has_open = features
    risk = 0.5
    if days > 60:   risk += 0.2
    if days > 30:   risk += 0.1
    if act30 == 0:  risk += 0.15
    if sentiment < 0.3: risk += 0.15
    if has_open:    risk -= 0.2
    if deals > 2:   risk -= 0.1
    return round(max(0.0, min(1.0, risk)), 4)


def _heuristic_win(features: list) -> float:
    """
    Heuristic win probability when model not trained.
    features: [stage_num, value, days_in_stage, total_activities, activity_last_7, company_size]
    """
    stage_num, value, days_in_stage, total_act, act_7, company_size = features
    # stage_num: 0=LEAD...4=NEGOTIATION, 5=WON/LOST
    base = [0.05, 0.15, 0.30, 0.50, 0.70].get(int(stage_num), 0.50) if hasattr([0.05], 'get') else [0.05, 0.15, 0.30, 0.50, 0.70][min(int(stage_num), 4)]
    if act_7 > 3:      base += 0.1
    if days_in_stage > 30: base -= 0.1
    return round(max(0.0, min(0.99, base)), 4)


@predict_bp.route("/churn", methods=["POST"])
def predict_churn():
    """
    POST /predict/churn
    Body: { "features": [days_since_last_contact, activity_last_30, activity_last_90,
                          sentiment_score, lead_score, deal_count, total_deal_value, has_open_deal] }
    Returns: { "risk": 0.0-1.0 }
    """
    _load_models()
    data = request.get_json(silent=True) or {}
    raw_features = data.get("features", [])

    if len(raw_features) != 8:
        return jsonify({"error": "Expected 8 features"}), 400

    if _churn_model is None or _churn_scaler is None:
        return jsonify({
            "risk": _heuristic_churn(raw_features),
            "source": "heuristic",
        })

    try:
        features = np.array(raw_features, dtype=float).reshape(1, -1)
        scaled   = _churn_scaler.transform(features)
        risk     = float(_churn_model.predict_proba(scaled)[0][1])
        return jsonify({"risk": round(risk, 4), "source": "model"})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@predict_bp.route("/win_prob", methods=["POST"])
def predict_win():
    """
    POST /predict/win_prob
    Body: { "features": [stage_num, value, days_in_stage, total_activities, activity_last_7, company_size] }
    Returns: { "probability": 0.0-1.0 }
    """
    _load_models()
    data = request.get_json(silent=True) or {}
    raw_features = data.get("features", [])

    if len(raw_features) != 6:
        return jsonify({"error": "Expected 6 features"}), 400

    if _win_model is None:
        return jsonify({
            "probability": _heuristic_win(raw_features),
            "source": "heuristic",
        })

    try:
        features    = np.array(raw_features, dtype=float).reshape(1, -1)
        probability = float(_win_model.predict_proba(features)[0][1])
        return jsonify({"probability": round(probability, 4), "source": "model"})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
