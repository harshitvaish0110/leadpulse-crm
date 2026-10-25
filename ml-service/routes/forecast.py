"""
Monthly revenue forecast.

POST /forecast/revenue  { historical: [{ ds: "YYYY-MM-01", y }], periods: 3 }
  -> { forecast: [{ ds, yhat, yhat_lower, yhat_upper }], source: "prophet" | "linear" }

Prophet (yearly seasonality, 80 % interval) is imported only when needed; with
fewer than 6 months of history, or if Prophet fails, a least-squares trend with
an 80 % band is used instead. Fitting is slow on small instances, so the API
caches the result rather than calling this per page view.
"""

import datetime as dt

import numpy as np
from flask import Blueprint, jsonify, request

forecast_bp = Blueprint("forecast", __name__)

MIN_PROPHET_POINTS = 6
MAX_PERIODS = 12
Z_80 = 1.2816  # two-sided 80 % interval


def _add_months(date: dt.date, months: int) -> dt.date:
    index = date.month - 1 + months
    return dt.date(date.year + index // 12, index % 12 + 1, 1)


def linear_forecast(values: list[float], last: dt.date, periods: int) -> list[dict]:
    x = np.arange(len(values), dtype=float)
    y = np.asarray(values, dtype=float)
    if len(values) >= 2:
        slope, intercept = np.polyfit(x, y, 1)
        residual = y - (slope * x + intercept)
        spread = float(residual.std(ddof=1)) if len(values) > 2 else abs(float(y.mean())) * 0.2
    else:
        slope, intercept, spread = 0.0, float(y[0]), abs(float(y[0])) * 0.2
    out = []
    for step in range(1, periods + 1):
        yhat = max(0.0, slope * (len(values) - 1 + step) + intercept)
        margin = Z_80 * spread
        out.append({
            "ds": _add_months(last, step).isoformat(),
            "yhat": round(yhat, 2),
            "yhat_lower": round(max(0.0, yhat - margin), 2),
            "yhat_upper": round(yhat + margin, 2),
        })
    return out


def prophet_forecast(dates: list[dt.date], values: list[float], periods: int) -> list[dict]:
    import logging

    # Set before importing Prophet: it logs about the (deliberately absent) plotting libraries on import.
    logging.getLogger("prophet.plot").setLevel(logging.CRITICAL)
    logging.getLogger("cmdstanpy").setLevel(logging.WARNING)

    import pandas as pd
    from prophet import Prophet
    frame = pd.DataFrame({"ds": pd.to_datetime(dates), "y": values})
    # Yearly seasonality needs two full years of months to be identifiable.
    model = Prophet(interval_width=0.8, yearly_seasonality=len(values) >= 24, weekly_seasonality=False, daily_seasonality=False)
    model.fit(frame)
    future = model.make_future_dataframe(periods=periods, freq="MS", include_history=False)
    predicted = model.predict(future)
    return [
        {
            "ds": row.ds.date().isoformat(),
            "yhat": round(max(0.0, row.yhat), 2),
            "yhat_lower": round(max(0.0, row.yhat_lower), 2),
            "yhat_upper": round(max(0.0, row.yhat_upper), 2),
        }
        for row in predicted.itertuples()
    ]


@forecast_bp.route("/revenue", methods=["POST"])
def revenue():
    body = request.get_json(silent=True) or {}
    historical = body.get("historical")
    periods = body.get("periods", 3)
    if not isinstance(historical, list):
        return jsonify({"error": "historical must be a list"}), 400
    if not isinstance(periods, int) or not 1 <= periods <= MAX_PERIODS:
        return jsonify({"error": f"periods must be between 1 and {MAX_PERIODS}"}), 422

    try:
        points = sorted((dt.date.fromisoformat(str(p["ds"])[:10]).replace(day=1), float(p["y"])) for p in historical)
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "each point needs ds (YYYY-MM-DD) and a numeric y"}), 422
    if len(points) < 2:
        return jsonify({"forecast": [], "source": "none", "message": "At least two months of history are needed"})

    dates, values = [d for d, _ in points], [v for _, v in points]
    if len(points) >= MIN_PROPHET_POINTS:
        try:
            return jsonify({"forecast": prophet_forecast(dates, values, periods), "source": "prophet"})
        except Exception as err:  # noqa: BLE001 — degrade to the linear trend
            print(f"[forecast] prophet failed, using linear trend: {err}", flush=True)
    return jsonify({"forecast": linear_forecast(values, dates[-1], periods), "source": "linear"})
