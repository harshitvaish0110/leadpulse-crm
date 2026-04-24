from typing import Dict

from fastapi import FastAPI
from pydantic import BaseModel, Field
from textblob import TextBlob

app = FastAPI(title="LeadPulse Intelligence Service")


class PredictScoreRequest(BaseModel):
    industry: str = Field(..., example="technology")
    companySize: int = Field(..., example=120)
    source: str = Field(..., example="ORGANIC")
    interactionCount: int = Field(..., example=3)
    recentSentiment: float = Field(..., ge=-1.0, le=1.0, example=0.4)


class PredictScoreResponse(BaseModel):
    score: float


class AnalyzeSentimentRequest(BaseModel):
    text: str = Field(..., example="The client was excited about our solution.")


class AnalyzeSentimentResponse(BaseModel):
    sentiment: float


def clamp(value: float, minimum: float = -1.0, maximum: float = 1.0) -> float:
    return max(min(value, maximum), minimum)


def compute_conversion_score(data: PredictScoreRequest) -> float:
    industry_boosts: Dict[str, float] = {
        "technology": 0.12,
        "finance": 0.08,
        "healthcare": 0.07,
        "manufacturing": 0.04,
        "education": 0.03,
    }
    source_weights: Dict[str, float] = {
        "ORGANIC": 0.12,
        "OUTBOUND": 0.05,
        "REFERRAL": 0.15,
    }

    base_score = 0.2
    industry_score = industry_boosts.get(data.industry.lower(), 0.05)
    source_score = source_weights.get(data.source.upper(), 0.05)
    size_score = min(data.companySize / 1000.0, 1.0) * 0.2
    interaction_score = min(data.interactionCount * 0.06, 0.24)
    sentiment_score = (data.recentSentiment + 1.0) / 2.0 * 0.3

    raw_score = base_score + industry_score + source_score + size_score + interaction_score + sentiment_score
    normalized = clamp(raw_score, 0.0, 1.0)
    return round(normalized, 3)


@app.post("/predict-score", response_model=PredictScoreResponse)
def predict_score(payload: PredictScoreRequest) -> PredictScoreResponse:
    score = compute_conversion_score(payload)
    return PredictScoreResponse(score=score)


@app.post("/analyze-sentiment", response_model=AnalyzeSentimentResponse)
def analyze_sentiment(payload: AnalyzeSentimentRequest) -> AnalyzeSentimentResponse:
    text = payload.text.strip()
    if not text:
        return AnalyzeSentimentResponse(sentiment=0.0)

    sentiment = TextBlob(text).sentiment.polarity
    clamped = clamp(sentiment, -1.0, 1.0)
    return AnalyzeSentimentResponse(sentiment=round(clamped, 3))


@app.get("/health")
def health_check() -> Dict[str, str]:
    return {"status": "ok", "service": "leadpulse-intelligence"}
