"""
Revenue forecasting route using Prophet.
Accepts historical monthly revenue data and returns a 90-day forward forecast
with confidence intervals (yhat_lower, yhat_upper).
"""

from flask import Blueprint, request, jsonify
import warnings
warnings.filterwarnings("ignore")

forecast_bp = Blueprint("forecast", __name__)


@forecast_bp.route("/revenue", methods=["POST"])
def revenue():
    """
    POST /forecast/revenue
    Body: { "historical": [{ "ds": "2024-01-01", "y": 12500 }, ...] }
    Returns: { "forecast": [{ "ds": "...", "yhat": ..., "yhat_lower": ..., "yhat_upper": ... }] }
    Requires at least 2 data points. Returns 90-day forward forecast.
    """
    data = request.get_json(silent=True) or {}
    historical = data.get("historical", [])

    if len(historical) < 2:
        return jsonify({
            "forecast": [],
            "message": "Need at least 2 months of historical data for forecasting",
        }), 200

    try:
        import pandas as pd
        from prophet import Prophet

        df = pd.DataFrame(historical)
        df["ds"] = pd.to_datetime(df["ds"])
        df["y"]  = pd.to_numeric(df["y"], errors="coerce").fillna(0)

        # Remove outliers that would skew the model (values > 10x median)
        median = df["y"].median()
        if median > 0:
            df = df[df["y"] <= median * 10]

        model = Prophet(
            interval_width=0.80,
            yearly_seasonality=True,
            weekly_seasonality=False,
            daily_seasonality=False,
            seasonality_mode="multiplicative" if df["y"].min() > 0 else "additive",
        )
        model.fit(df)

        # Forecast 90 days ahead
        future   = model.make_future_dataframe(periods=90, freq="D")
        forecast = model.predict(future)

        # Return only future portion (after last historical date)
        future_only = forecast[forecast["ds"] > df["ds"].max()][
            ["ds", "yhat", "yhat_lower", "yhat_upper"]
        ].copy()

        # Clip negative values
        for col in ["yhat", "yhat_lower", "yhat_upper"]:
            future_only[col] = future_only[col].clip(lower=0).round(2)

        future_only["ds"] = future_only["ds"].dt.strftime("%Y-%m-%d")

        return jsonify({
            "forecast": future_only.to_dict(orient="records"),
            "periods": len(future_only),
        })

    except ImportError:
        # Prophet not installed — return a simple linear extrapolation
        return _linear_extrapolation(historical)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _linear_extrapolation(historical: list) -> tuple:
    """Simple linear trend extrapolation when Prophet is not available."""
    import datetime

    values = [h["y"] for h in historical]
    if len(values) < 2:
        return jsonify({"forecast": [], "message": "Not enough data"}), 200

    # Calculate average monthly growth
    avg = sum(values) / len(values)
    growth = (values[-1] - values[0]) / max(len(values) - 1, 1)

    last_date = datetime.date.fromisoformat(historical[-1]["ds"])
    forecast = []
    for i in range(1, 91):
        d = last_date + datetime.timedelta(days=i)
        # Daily value estimate with slight growth
        daily_val = max(0, (avg + growth * (i / 30)) / 30)
        margin = daily_val * 0.2
        forecast.append({
            "ds": d.isoformat(),
            "yhat": round(daily_val, 2),
            "yhat_lower": round(max(0, daily_val - margin), 2),
            "yhat_upper": round(daily_val + margin, 2),
        })

    return jsonify({"forecast": forecast, "source": "linear-extrapolation"})
