# LeadPulse CRM

> A full-stack, AI-powered Customer Relationship Management system built with Node.js, React, Python, and Google Gemini.

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![React](https://img.shields.io/badge/react-18-blue)
![Python](https://img.shields.io/badge/python-%3E%3D3.10-yellow)

---

## ✨ Features

| Feature | Description |
|---|---|
| 📊 **Dashboard** | Live KPIs — pipeline value, open deals, churn risk, activity feed |
| 👥 **Contacts** | Full contact management with lead scoring, sentiment tracking, churn risk |
| 💼 **Deals Pipeline** | Kanban board with drag-and-drop stage management and win probability |
| 🏢 **Companies** | Company profiles linked to contacts and deals |
| ✅ **Tasks** | Task management with due dates, priorities, and completion tracking |
| 📈 **Analytics** | Revenue trends, win/loss ratios, rep performance, sentiment trends |
| 🤖 **AI Email Composer** | Generate personalized sales emails from bullet points using Gemini AI |
| 🧠 **AI Deal Briefing** | Streaming deal summary with risks and talking points |
| ⚡ **Next Best Action** | AI-powered recommendation for what to do next for any contact |
| 💬 **Smart Reply** | Generate 3 reply options for incoming emails |
| 🔍 **AI Chat Assistant** | RAG-powered chat that answers questions about your CRM data |
| 🔔 **Real-time Alerts** | Socket.IO churn alerts and live deal score updates |
| 🌙 **Nightly Scoring** | Automated lead scoring and churn risk calculation every night |

---

## 🏗️ Architecture

```
leadpulse-crm/
├── client/          # React 18 + Vite + Tailwind CSS frontend
├── server/          # Node.js + Express + Prisma ORM backend
├── ml-service/      # Python Flask ML service (scoring, RAG, sentiment)
└── docker-compose.yml
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite, Tailwind CSS, Zustand, React Query, Socket.IO Client |
| **Backend** | Node.js, Express, Prisma ORM, Socket.IO, node-cron |
| **Database** | PostgreSQL 15 + pgvector (for RAG embeddings) |
| **ML Service** | Python, Flask, scikit-learn, XGBoost, Prophet, HuggingFace Transformers |
| **AI** | Google Gemini 2.5 Flash (via `@google/genai` SDK) |
| **Auth** | JWT (access + refresh tokens) |
| **Deployment** | Render (Node + Python), Supabase (PostgreSQL) |

---

## 🚀 Getting Started (Local)

### Prerequisites

- Node.js ≥ 18
- Python ≥ 3.10
- Docker Desktop (for PostgreSQL)
- A free [Google Gemini API key](https://aistudio.google.com/apikey)

### 1. Clone & Install

```bash
git clone https://github.com/harshitvaish0110/leadpulse-crm.git
cd leadpulse-crm

# Install server dependencies
cd server && npm install && cd ..

# Install client dependencies
cd client && npm install && cd ..

# Install Python dependencies
cd ml-service && pip install -r requirements.txt && cd ..
```

### 2. Configure Environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and set:

```env
# Required
DATABASE_URL=postgresql://leadpulse:leadpulse@localhost:5432/leadpulse
JWT_SECRET=your-super-secret-key-change-this
GEMINI_API_KEY=your-gemini-api-key-here   # Get free at https://aistudio.google.com/apikey

# Optional
CLEARBIT_API_KEY=   # For contact enrichment (leave blank to use AI fallback)
```

### 3. Start the Database

```bash
docker compose up postgres -d
```

### 4. Run Database Migrations & Seed

```bash
cd server
npx prisma migrate deploy
npx prisma db seed
```

### 5. Start All Services

Open **3 terminal windows**:

```bash
# Terminal 1 — Backend API (port 3001)
cd server && npm run dev

# Terminal 2 — Frontend (port 5173)
cd client && npm run dev

# Terminal 3 — ML Service (port 5001) [optional for core features]
cd ml-service && python app.py
```

### 6. Open in Browser

```
http://localhost:5173
```

**Default login credentials:**
```
Email:    admin@leadpulse.dev
Password: password123
```

---

## 🤖 AI Features

All AI features use **Google Gemini 2.5 Flash** (free tier). The service includes automatic retry logic and model fallback to handle rate limits gracefully.

> **Note:** The Gemini free tier resets daily at **12:30 PM IST**. For unlimited usage, enable billing on your GCP project (costs ~$0.001/request).

### What each AI feature does

| Feature | Where to find it | How to use |
|---|---|---|
| **Email Composer** | Contact Detail → AI Tools tab | Type bullet points → Generate Email |
| **Deal Briefing** | Deal Detail → AI Deal Briefing card | Click the refresh icon |
| **Next Best Action** | Contact Detail → AI Recommendation card | Click Generate Recommendation |
| **Smart Reply** | Contact Detail → AI Tools tab | Paste an email → get 3 reply options |
| **AI Chat** | Left sidebar → AI Assistant | Ask questions about your CRM data |

---

## 🗃️ Database Schema (Key Models)

```
User → owns → Contacts, Deals, Tasks, Activities
Contact → belongs to → Company
Contact → has many → Deals, Activities, Tasks
Deal → has many → Activities
Activity → sentiment scored by ML service
Contact → leadScore, churnRisk (updated nightly by scoring job)
```

---

## 📁 Project Structure

```
server/
├── src/
│   ├── controllers/     # Route handlers (contacts, deals, ai, analytics...)
│   ├── routes/          # Express route definitions
│   ├── services/        # claude.service.js (Gemini AI), scoring.service.js
│   ├── middleware/       # auth, error handling
│   ├── jobs/            # scoring.job.js (nightly cron)
│   └── lib/             # Prisma client
├── prisma/
│   ├── schema.prisma    # Database schema
│   └── seed.js          # Demo data (150 contacts, 50 deals...)
└── server.js

client/
├── src/
│   ├── pages/           # Dashboard, Contacts, Deals, Companies, Tasks, Analytics, AI, Settings
│   ├── components/      # Reusable UI + AI components
│   │   └── ai/          # EmailComposer, DealSummaryPanel, NextActionCard, SmartReplyBar
│   ├── api/             # Axios API helpers
│   ├── hooks/           # useSocket, useAuth
│   └── store/           # Zustand state stores

ml-service/
├── routes/              # /predict, /rag, /sentiment, /forecast, /transcribe
├── services/            # claude_service.py (Gemini), embedding_service.py, vector_store.py
└── train.py             # Train local ML models
```

---

## 🚢 Deployment

See [`deployment_guide.md`](./deployment_guide.md) for full step-by-step instructions to deploy on:
- **Render** — Node.js backend + Python ML service
- **Supabase** — PostgreSQL database with pgvector
- **Vercel** — React frontend (optional)

---

## 🔑 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Secret for signing JWT tokens |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key (free at aistudio.google.com) |
| `ML_SERVICE_URL` | ❌ | URL of Python ML service (default: http://localhost:5001) |
| `CLIENT_URL` | ❌ | Frontend URL for CORS (default: http://localhost:5173) |
| `CLEARBIT_API_KEY` | ❌ | Contact enrichment (falls back to AI if not set) |
| `PORT` | ❌ | Server port (default: 3001) |
| `FLASK_PORT` | ❌ | ML service port (default: 5001) |

---

## 📝 License

MIT © 2026 LeadPulse