# LeadPulse Python Intelligence Service

This service runs on a separate port (default: `8000`) and provides ML-style APIs for the Express backend.

## Install

```bash
python -m pip install -r requirements.txt
python -m textblob.download_corpora
```

## Run

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## Endpoints

- `POST /predict-score`
  - Request body: `{ industry, companySize, source, interactionCount, recentSentiment }`
  - Response body: `{ score: 0.0-1.0 }`

- `POST /analyze-sentiment`
  - Request body: `{ text }`
  - Response body: `{ sentiment: -1.0-1.0 }`

- `GET /health`
  - Response body: `{ status: "ok", service: "leadpulse-intelligence" }`
