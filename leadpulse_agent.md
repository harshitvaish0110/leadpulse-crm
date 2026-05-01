# LEADPULSE — AI AGENT BUILD INSTRUCTIONS
## Complete Step-by-Step Guide for Building an AI-Powered CRM from Scratch

---

## HOW TO USE THIS FILE (READ FIRST)

You are an AI agent tasked with building **Leadpulse**, a full-stack AI-powered CRM application. This document is your complete instruction set. Follow these rules absolutely:

1. **Read each step fully before executing it.** Do not skim.
2. **Execute steps one at a time.** Never skip ahead.
3. **After completing every step, run the CONFIRM block** at the end of that step. Do not proceed until all checks pass.
4. **If a check fails**, fix the problem before moving on. Do not paper over errors.
5. **Write complete, working code** — no placeholders, no TODOs, no `// implement later`.
6. **Every file you create must be production-quality.** Use proper error handling, input validation, and consistent naming.
7. **When you encounter an ambiguity**, resolve it using the architecture described in this file. Use your best judgment only as a last resort.
8. **After every major phase**, pause and run all phase-level checks before starting the next phase.

---

## PROJECT IDENTITY

- **Name:** Leadpulse
- **Type:** AI-Powered CRM (Customer Relationship Management)
- **Purpose:** Portfolio + learning project
- **Target users:** Sales teams, sales reps, sales managers

---

## TECH STACK (NON-NEGOTIABLE — USE EXACTLY THESE)

### Frontend (`/client`)
| Package | Version | Purpose |
|---|---|---|
| React | 18 | UI framework |
| Vite | latest | Build tool |
| react-router-dom | v6 | Client routing |
| tailwindcss | latest | Styling (utility classes only — no custom CSS) |
| @tanstack/react-query | v5 | Server state + caching |
| zustand | latest | Global client state |
| axios | latest | HTTP client |
| @dnd-kit/core + @dnd-kit/sortable | latest | Kanban drag-and-drop |
| recharts | latest | All charts |
| react-hot-toast | latest | Toast notifications |
| lucide-react | latest | Icons |
| socket.io-client | latest | Real-time events |
| papaparse | latest | CSV parsing |

### Backend (`/server`)
| Package | Version | Purpose |
|---|---|---|
| express | latest | REST API |
| @prisma/client + prisma | latest | ORM |
| jsonwebtoken | latest | JWT auth |
| bcryptjs | latest | Password hashing |
| socket.io | latest | Real-time events |
| multer | latest | File uploads |
| node-cron | latest | Scheduled jobs |
| express-validator | latest | Input validation |
| cors | latest | CORS middleware |
| helmet | latest | Security headers |
| morgan | latest | Request logging |
| dotenv | latest | Env vars |
| @anthropic-ai/sdk | latest | Claude API |
| axios | latest | HTTP client (calls ML service) |
| nodemailer | latest | Email sending |
| json2csv | latest | CSV export |
| @faker-js/faker | dev | Seed data |
| nodemon | dev | Hot reload |

### ML Service (`/ml-service`)
| Package | Purpose |
|---|---|
| flask | REST API |
| flask-cors | CORS |
| psycopg2-binary | PostgreSQL |
| pgvector | Vector operations |
| scikit-learn | Churn + lead scoring models |
| xgboost | Win probability model |
| prophet | Revenue forecasting |
| transformers | Sentiment analysis (HuggingFace) |
| torch | Required by transformers |
| anthropic | Claude API |
| openai | Whisper + embeddings |
| langchain | RAG pipeline |
| langchain-anthropic | LangChain Claude integration |
| pandas + numpy | Data processing |
| joblib | Model serialization |
| python-dotenv | Env vars |

### Infrastructure
- **Database:** PostgreSQL 16 + pgvector extension (use `pgvector/pgvector:pg16` Docker image)
- **Local dev:** Docker + docker-compose
- **Frontend deploy:** Vercel
- **Backend deploy:** Render (2 services — Node + Python)
- **DB hosting:** Supabase (free tier — has pgvector built-in)

---

## COMPLETE FOLDER STRUCTURE

Create exactly this structure before writing any code:

```
leadpulse/
├── client/
│   ├── public/
│   │   └── favicon.ico
│   └── src/
│       ├── api/
│       │   ├── axiosInstance.js
│       │   ├── auth.js
│       │   ├── contacts.js
│       │   ├── companies.js
│       │   ├── deals.js
│       │   ├── activities.js
│       │   ├── tasks.js
│       │   ├── analytics.js
│       │   └── ai.js
│       ├── components/
│       │   ├── layout/
│       │   │   ├── AppShell.jsx
│       │   │   ├── Sidebar.jsx
│       │   │   └── TopBar.jsx
│       │   ├── ui/
│       │   │   ├── Button.jsx
│       │   │   ├── Badge.jsx
│       │   │   ├── Modal.jsx
│       │   │   ├── Input.jsx
│       │   │   ├── Skeleton.jsx
│       │   │   ├── EmptyState.jsx
│       │   │   ├── Avatar.jsx
│       │   │   └── SlideOver.jsx
│       │   ├── contacts/
│       │   │   ├── ContactTable.jsx
│       │   │   ├── ContactForm.jsx
│       │   │   ├── ContactCard.jsx
│       │   │   └── ContactFilters.jsx
│       │   ├── deals/
│       │   │   ├── KanbanBoard.jsx
│       │   │   ├── KanbanColumn.jsx
│       │   │   ├── DealCard.jsx
│       │   │   └── DealForm.jsx
│       │   ├── activities/
│       │   │   ├── ActivityFeed.jsx
│       │   │   ├── ActivityItem.jsx
│       │   │   └── LogActivityModal.jsx
│       │   └── ai/
│       │       ├── EmailComposer.jsx
│       │       ├── NextActionCard.jsx
│       │       ├── DealSummaryPanel.jsx
│       │       ├── SmartReplyBar.jsx
│       │       └── ChatWidget.jsx
│       ├── hooks/
│       │   ├── useAuth.js
│       │   ├── useContacts.js
│       │   ├── useCompanies.js
│       │   ├── useDeals.js
│       │   ├── useActivities.js
│       │   ├── useTasks.js
│       │   └── useSocket.js
│       ├── pages/
│       │   ├── auth/
│       │   │   ├── Login.jsx
│       │   │   └── Register.jsx
│       │   ├── Dashboard.jsx
│       │   ├── contacts/
│       │   │   ├── ContactsList.jsx
│       │   │   └── ContactDetail.jsx
│       │   ├── companies/
│       │   │   ├── CompaniesList.jsx
│       │   │   └── CompanyDetail.jsx
│       │   ├── deals/
│       │   │   ├── DealsPipeline.jsx
│       │   │   └── DealDetail.jsx
│       │   ├── Activities.jsx
│       │   ├── Tasks.jsx
│       │   ├── Analytics.jsx
│       │   ├── AIAssistant.jsx
│       │   └── settings/
│       │       ├── GeneralSettings.jsx
│       │       ├── UsersSettings.jsx
│       │       └── IntegrationsSettings.jsx
│       ├── store/
│       │   ├── authStore.js
│       │   └── uiStore.js
│       ├── App.jsx
│       ├── main.jsx
│       └── index.css
│
├── server/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.routes.js
│   │   │   ├── contacts.routes.js
│   │   │   ├── companies.routes.js
│   │   │   ├── deals.routes.js
│   │   │   ├── activities.routes.js
│   │   │   ├── tasks.routes.js
│   │   │   ├── analytics.routes.js
│   │   │   └── ai.routes.js
│   │   ├── controllers/
│   │   │   ├── auth.controller.js
│   │   │   ├── contacts.controller.js
│   │   │   ├── companies.controller.js
│   │   │   ├── deals.controller.js
│   │   │   ├── activities.controller.js
│   │   │   ├── tasks.controller.js
│   │   │   ├── analytics.controller.js
│   │   │   └── ai.controller.js
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js
│   │   │   └── error.middleware.js
│   │   ├── services/
│   │   │   ├── claude.service.js
│   │   │   ├── scoring.service.js
│   │   │   └── ml.service.js
│   │   ├── jobs/
│   │   │   └── scoring.job.js
│   │   └── app.js
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.js
│   ├── server.js
│   └── package.json
│
├── ml-service/
│   ├── app.py
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── sentiment.py
│   │   ├── predict.py
│   │   ├── forecast.py
│   │   ├── rag.py
│   │   └── transcribe.py
│   ├── services/
│   │   ├── __init__.py
│   │   ├── claude_service.py
│   │   ├── embedding_service.py
│   │   └── vector_store.py
│   ├── models/
│   │   └── .gitkeep
│   ├── train.py
│   └── requirements.txt
│
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

---

## ENVIRONMENT VARIABLES

Create `.env.example` at the root and `.env` (filled with real values, never committed):

```env
# ── DATABASE ──────────────────────────────────────
DATABASE_URL=postgresql://leadpulse:leadpulse_secret@localhost:5432/leadpulse_db

# ── NODE SERVER ───────────────────────────────────
PORT=3001
JWT_SECRET=leadpulse-change-this-to-a-random-64-char-string-in-production
JWT_EXPIRES_IN=7d
ML_SERVICE_URL=http://localhost:5001
CLIENT_URL=http://localhost:5173

# ── PYTHON ML SERVICE ─────────────────────────────
FLASK_PORT=5001
FLASK_ENV=development
ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
OPENAI_API_KEY=sk-YOUR_KEY_HERE
CLEARBIT_API_KEY=                        # optional

# ── REACT CLIENT ──────────────────────────────────
VITE_API_URL=http://localhost:3001
VITE_SOCKET_URL=http://localhost:3001
```

---

# PHASE 0 — PROJECT INITIALIZATION

## Step 0.1 — Create the monorepo root

```bash
mkdir leadpulse && cd leadpulse
git init
echo "node_modules/\n.env\n*.pkl\n__pycache__/\n.venv/\ndist/\nuploads/" > .gitignore
```

**CONFIRM 0.1:**
- [ ] `leadpulse/` directory exists
- [ ] `.git/` directory exists inside it
- [ ] `.gitignore` contains `node_modules/` and `.env`

---

## Step 0.2 — Create docker-compose.yml

Create `docker-compose.yml` at the project root with the following exact content:

```yaml
version: '3.9'

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: leadpulse_postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: leadpulse_db
      POSTGRES_USER: leadpulse
      POSTGRES_PASSWORD: leadpulse_secret
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U leadpulse -d leadpulse_db"]
      interval: 10s
      timeout: 5s
      retries: 5

  server:
    build:
      context: ./server
      dockerfile: Dockerfile
    container_name: leadpulse_server
    restart: unless-stopped
    ports:
      - "3001:3001"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./server:/app
      - /app/node_modules
    command: npm run dev

  ml-service:
    build:
      context: ./ml-service
      dockerfile: Dockerfile
    container_name: leadpulse_ml
    restart: unless-stopped
    ports:
      - "5001:5001"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./ml-service:/app
    command: python app.py

  client:
    build:
      context: ./client
      dockerfile: Dockerfile
    container_name: leadpulse_client
    restart: unless-stopped
    ports:
      - "5173:5173"
    env_file: .env
    depends_on:
      - server
    volumes:
      - ./client:/app
      - /app/node_modules
    command: npm run dev -- --host

volumes:
  postgres_data:
```

**CONFIRM 0.2:**
- [ ] `docker-compose.yml` exists at the project root
- [ ] File has 4 services: postgres, server, ml-service, client
- [ ] Run `docker-compose config` — it should parse without errors

---

## Step 0.3 — Initialize the Node.js server

```bash
cd server
npm init -y
npm install express @prisma/client prisma jsonwebtoken bcryptjs socket.io \
  multer node-cron express-validator cors helmet morgan dotenv \
  @anthropic-ai/sdk axios nodemailer json2csv
npm install -D nodemon @faker-js/faker
npx prisma init
```

Create `server/package.json` scripts section — update it to:
```json
{
  "scripts": {
    "dev": "nodemon server.js",
    "start": "node server.js",
    "seed": "node prisma/seed.js",
    "migrate": "npx prisma migrate dev"
  }
}
```

Create `server/Dockerfile`:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
EXPOSE 3001
CMD ["npm", "run", "dev"]
```

**CONFIRM 0.3:**
- [ ] `server/node_modules/` exists
- [ ] `server/prisma/schema.prisma` exists
- [ ] `server/package.json` has all listed scripts
- [ ] Run `node -e "require('express')"` from inside `/server` — no error

---

## Step 0.4 — Initialize the React client

```bash
cd client
npm create vite@latest . -- --template react
npm install
npm install react-router-dom @tanstack/react-query zustand axios \
  @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities \
  recharts react-hot-toast lucide-react socket.io-client papaparse
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Update `client/tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        }
      }
    },
  },
  plugins: [],
}
```

Replace contents of `client/src/index.css` with:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

Create `client/Dockerfile`:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]
```

**CONFIRM 0.4:**
- [ ] `client/node_modules/` exists
- [ ] `client/tailwind.config.js` has the `content` array pointing to `./src/**/*.{js,jsx}`
- [ ] `client/src/index.css` starts with `@tailwind base;`
- [ ] Run `npm run build` from `/client` — it should succeed with no errors

---

## Step 0.5 — Initialize the Python ML service

```bash
cd ml-service
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install flask flask-cors psycopg2-binary pgvector \
  scikit-learn xgboost prophet transformers torch \
  anthropic openai langchain langchain-anthropic \
  pandas numpy joblib python-dotenv
pip freeze > requirements.txt
touch app.py train.py
mkdir -p routes services models
touch routes/__init__.py services/__init__.py models/.gitkeep
```

Create `ml-service/Dockerfile`:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5001
CMD ["python", "app.py"]
```

**CONFIRM 0.5:**
- [ ] `ml-service/.venv/` exists
- [ ] `ml-service/requirements.txt` is populated with all packages
- [ ] Run `python -c "import flask, sklearn, xgboost, anthropic"` — no ImportError
- [ ] `ml-service/routes/__init__.py` exists

---

## Step 0.6 — Start PostgreSQL and enable pgvector

```bash
# From the project root:
docker-compose up postgres -d

# Wait 10 seconds, then verify:
docker-compose ps
# Expected: leadpulse_postgres is "Up" and "healthy"

# Connect and enable vector extension:
docker exec -it leadpulse_postgres psql -U leadpulse -d leadpulse_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
# Expected output: CREATE EXTENSION
```

**CONFIRM 0.6:**
- [ ] `docker-compose ps` shows postgres as healthy
- [ ] `CREATE EXTENSION IF NOT EXISTS vector;` runs without error
- [ ] Run `docker exec -it leadpulse_postgres psql -U leadpulse -d leadpulse_db -c "\dx"` — `vector` appears in the extension list

---

# PHASE 1 — DATABASE SCHEMA

## Step 1.1 — Write the complete Prisma schema

Replace the contents of `server/prisma/schema.prisma` with the complete schema below. Write every model exactly as specified — field names, types, relations, and defaults must be exact.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── ENUMS ────────────────────────────────────────────────────────────────

enum Role {
  ADMIN
  SALES_REP
}

enum ContactStatus {
  LEAD
  ACTIVE
  INACTIVE
  CHURNED
}

enum DealStage {
  LEAD
  CONTACTED
  DEMO
  PROPOSAL
  NEGOTIATION
  CLOSED_WON
  CLOSED_LOST
}

enum ActivityType {
  CALL
  EMAIL
  MEETING
  NOTE
  TRANSCRIPT
}

enum SentimentLabel {
  POSITIVE
  NEUTRAL
  NEGATIVE
  AT_RISK
}

enum TaskPriority {
  LOW
  MEDIUM
  HIGH
}

enum EmailStatus {
  DRAFT
  SENT
  FAILED
}

// ─── MODELS ───────────────────────────────────────────────────────────────

model User {
  id            String    @id @default(uuid())
  email         String    @unique
  passwordHash  String
  firstName     String
  lastName      String
  role          Role      @default(SALES_REP)
  lastLoginAt   DateTime?
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  contacts      Contact[]   @relation("ContactOwner")
  deals         Deal[]      @relation("DealOwner")
  activities    Activity[]
  tasks         Task[]      @relation("TaskAssignee")
  createdTasks  Task[]      @relation("TaskCreator")
  emailDrafts   EmailDraft[]
  aiLogs        AiLog[]
}

model Company {
  id          String    @id @default(uuid())
  name        String
  domain      String    @unique
  industry    String?
  size        Int?
  country     String?
  website     String?
  description String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  contacts    Contact[]
}

model Contact {
  id                    String         @id @default(uuid())
  firstName             String
  lastName              String
  email                 String         @unique
  phone                 String?
  title                 String?
  linkedinUrl           String?
  status                ContactStatus  @default(LEAD)
  leadScore             Int            @default(0)
  leadScoreLabel        String?        // HOT | WARM | COLD
  leadScoreExplanation  String?
  churnRisk             Float          @default(0)
  sentimentScore        Float          @default(0.5)
  nextBestAction        Json?
  tags                  String[]
  customFields          Json?
  companyId             String?
  ownerId               String?
  createdAt             DateTime       @default(now())
  updatedAt             DateTime       @updatedAt

  company     Company?    @relation(fields: [companyId], references: [id])
  owner       User?       @relation("ContactOwner", fields: [ownerId], references: [id])
  deals       Deal[]
  activities  Activity[]
  tasks       Task[]
  emailDrafts EmailDraft[]
  aiLogs      AiLog[]
}

model Deal {
  id               String     @id @default(uuid())
  title            String
  value            Decimal    @default(0)
  stage            DealStage  @default(LEAD)
  winProbability   Float      @default(0)
  expectedCloseDate DateTime?
  lostReason       String?
  notes            String?
  contactId        String
  ownerId          String?
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt

  contact     Contact    @relation(fields: [contactId], references: [id], onDelete: Cascade)
  owner       User?      @relation("DealOwner", fields: [ownerId], references: [id])
  activities  Activity[]
  tasks       Task[]
  aiLogs      AiLog[]
}

model Activity {
  id              String          @id @default(uuid())
  type            ActivityType
  subject         String?
  notes           String?
  sentiment       SentimentLabel?
  sentimentScore  Float?
  transcript      String?
  audioUrl        String?
  durationMinutes Int?
  metadata        Json?           // stores structured extraction from transcription
  contactId       String
  dealId          String?
  userId          String
  occurredAt      DateTime        @default(now())
  createdAt       DateTime        @default(now())

  contact   Contact   @relation(fields: [contactId], references: [id], onDelete: Cascade)
  deal      Deal?     @relation(fields: [dealId], references: [id])
  user      User      @relation(fields: [userId], references: [id])
}

model Task {
  id           String       @id @default(uuid())
  title        String
  description  String?
  dueDate      DateTime?
  priority     TaskPriority @default(MEDIUM)
  completed    Boolean      @default(false)
  completedAt  DateTime?
  contactId    String?
  dealId       String?
  assignedToId String
  createdById  String
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  contact     Contact?  @relation(fields: [contactId], references: [id])
  deal        Deal?     @relation(fields: [dealId], references: [id])
  assignedTo  User      @relation("TaskAssignee", fields: [assignedToId], references: [id])
  createdBy   User      @relation("TaskCreator", fields: [createdById], references: [id])
}

model EmailDraft {
  id          String      @id @default(uuid())
  subject     String?
  body        String
  status      EmailStatus @default(DRAFT)
  aiGenerated Boolean     @default(false)
  sentAt      DateTime?
  contactId   String
  createdById String
  createdAt   DateTime    @default(now())

  contact     Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)
  createdBy   User     @relation(fields: [createdById], references: [id])
}

model Embedding {
  id         String   @id @default(uuid())
  recordType String
  recordId   String
  content    String
  vector     Unsupported("vector(1536)")?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([recordType, recordId])
  @@index([recordType, recordId])
}

model AiLog {
  id         String   @id @default(uuid())
  feature    String
  contactId  String?
  dealId     String?
  userId     String
  input      Json
  output     Json
  tokensUsed Int      @default(0)
  createdAt  DateTime @default(now())

  contact  Contact? @relation(fields: [contactId], references: [id])
  deal     Deal?    @relation(fields: [dealId], references: [id])
  user     User     @relation(fields: [userId], references: [id])
}
```

**CONFIRM 1.1:**
- [ ] `server/prisma/schema.prisma` contains all 9 models: User, Company, Contact, Deal, Activity, Task, EmailDraft, Embedding, AiLog
- [ ] All 7 enums are defined
- [ ] Run `npx prisma validate` from `/server` — output: `The schema at prisma/schema.prisma is valid`

---

## Step 1.2 — Run the initial migration

```bash
cd server
npx prisma migrate dev --name init
npx prisma generate
```

This creates all tables in PostgreSQL and generates the Prisma Client.

After the migration, add the pgvector index manually. Create a new migration:

```bash
npx prisma migrate dev --create-only --name add_vector_index
```

Open the newly created migration SQL file in `server/prisma/migrations/` and replace its contents with:

```sql
-- Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add ivfflat index on the vector column for fast similarity search
CREATE INDEX IF NOT EXISTS embeddings_vector_idx
ON embeddings USING ivfflat (vector vector_cosine_ops)
WITH (lists = 100);
```

Apply it:
```bash
npx prisma migrate dev
```

**CONFIRM 1.2:**
- [ ] Running `npx prisma migrate status` shows all migrations as Applied
- [ ] Connect to PostgreSQL and run `\dt` — all 9 tables exist
- [ ] Run `\dx` — `vector` extension is listed
- [ ] Run `\di` — `embeddings_vector_idx` index exists

---

## Step 1.3 — Write and run the seed script

Create `server/prisma/seed.js`. This script must generate realistic data for ML model training and testing. Write the complete script:

```javascript
const { PrismaClient } = require('@prisma/client');
const { faker } = require('@faker-js/faker');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const STAGES = ['LEAD','CONTACTED','DEMO','PROPOSAL','NEGOTIATION','CLOSED_WON','CLOSED_LOST'];
const ACTIVITY_TYPES = ['CALL','EMAIL','MEETING','NOTE'];
const INDUSTRIES = ['Technology','Finance','Healthcare','Retail','Manufacturing','Education','Real Estate','Media'];
const TAGS = ['VIP','Cold Lead','Hot Lead','Partner','Enterprise','SMB','Referral','Event Lead'];
const SENTIMENTS = ['POSITIVE','NEUTRAL','NEGATIVE'];

async function main() {
  console.log('🌱 Seeding Leadpulse database...');

  // Clear existing data (in reverse FK order)
  await prisma.aiLog.deleteMany();
  await prisma.embedding.deleteMany();
  await prisma.emailDraft.deleteMany();
  await prisma.task.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.user.deleteMany();

  // ── USERS ────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@leadpulse.dev',
      passwordHash,
      firstName: 'Alex',
      lastName: 'Admin',
      role: 'ADMIN',
    }
  });

  const reps = await Promise.all([
    prisma.user.create({ data: { email: 'sarah@leadpulse.dev', passwordHash, firstName: 'Sarah', lastName: 'Chen', role: 'SALES_REP' } }),
    prisma.user.create({ data: { email: 'raj@leadpulse.dev', passwordHash, firstName: 'Raj', lastName: 'Patel', role: 'SALES_REP' } }),
    prisma.user.create({ data: { email: 'emily@leadpulse.dev', passwordHash, firstName: 'Emily', lastName: 'Torres', role: 'SALES_REP' } }),
  ]);

  const allUsers = [admin, ...reps];
  console.log(`✓ Created ${allUsers.length} users`);

  // ── COMPANIES ─────────────────────────────────────────────
  const companies = [];
  for (let i = 0; i < 30; i++) {
    const name = faker.company.name();
    companies.push(await prisma.company.create({
      data: {
        name,
        domain: faker.internet.domainName(),
        industry: faker.helpers.arrayElement(INDUSTRIES),
        size: faker.helpers.arrayElement([10, 50, 100, 250, 500, 1000, 5000]),
        country: faker.helpers.arrayElement(['India', 'USA', 'UK', 'Germany', 'Singapore']),
        website: `https://${faker.internet.domainName()}`,
        description: faker.company.catchPhrase(),
      }
    }));
  }
  console.log(`✓ Created ${companies.length} companies`);

  // ── CONTACTS ──────────────────────────────────────────────
  const contacts = [];
  const statuses = ['LEAD','ACTIVE','ACTIVE','ACTIVE','INACTIVE','CHURNED']; // 17% churn rate

  for (let i = 0; i < 200; i++) {
    const status = faker.helpers.arrayElement(statuses);
    const company = faker.helpers.arrayElement(companies);
    const owner = faker.helpers.arrayElement(allUsers);

    contacts.push(await prisma.contact.create({
      data: {
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        email: faker.internet.email(),
        phone: faker.phone.number(),
        title: faker.person.jobTitle(),
        linkedinUrl: `https://linkedin.com/in/${faker.internet.username()}`,
        status,
        leadScore: faker.number.int({ min: 0, max: 120 }),
        churnRisk: status === 'CHURNED' ? faker.number.float({ min: 0.6, max: 1, fractionDigits: 2 })
                                        : faker.number.float({ min: 0, max: 0.5, fractionDigits: 2 }),
        sentimentScore: status === 'CHURNED' ? faker.number.float({ min: 0.1, max: 0.35, fractionDigits: 2 })
                                             : faker.number.float({ min: 0.4, max: 0.95, fractionDigits: 2 }),
        tags: faker.helpers.arrayElements(TAGS, { min: 0, max: 3 }),
        companyId: company.id,
        ownerId: owner.id,
      }
    }));
  }
  console.log(`✓ Created ${contacts.length} contacts`);

  // ── DEALS ─────────────────────────────────────────────────
  const deals = [];
  const stageWeights = ['LEAD','CONTACTED','CONTACTED','DEMO','DEMO','PROPOSAL','NEGOTIATION','CLOSED_WON','CLOSED_WON','CLOSED_LOST','CLOSED_LOST','CLOSED_LOST'];

  for (let i = 0; i < 120; i++) {
    const contact = faker.helpers.arrayElement(contacts);
    const owner = faker.helpers.arrayElement(allUsers);
    const stage = faker.helpers.arrayElement(stageWeights);
    const daysAgo = faker.number.int({ min: 1, max: 365 });

    deals.push(await prisma.deal.create({
      data: {
        title: `${faker.commerce.productName()} Deal`,
        value: faker.number.int({ min: 5000, max: 250000 }),
        stage,
        winProbability: stage === 'CLOSED_WON' ? 1 :
                        stage === 'CLOSED_LOST' ? 0 :
                        faker.number.float({ min: 0.1, max: 0.9, fractionDigits: 2 }),
        expectedCloseDate: faker.date.future({ years: 1 }),
        lostReason: stage === 'CLOSED_LOST' ? faker.helpers.arrayElement(['Price too high','Chose competitor','No budget','No decision','Timing']) : null,
        contactId: contact.id,
        ownerId: owner.id,
        createdAt: faker.date.past({ years: 1 }),
      }
    }));
  }
  console.log(`✓ Created ${deals.length} deals`);

  // ── ACTIVITIES ────────────────────────────────────────────
  const noteTemplates = [
    'Customer seemed very interested in the enterprise plan. Follow up next week.',
    'Had a great discovery call. They mentioned budget concerns but are keen to proceed.',
    'Demo went well. Technical team had questions about API integrations.',
    'Customer is comparing us with a competitor. Need to send comparison doc.',
    'Lost contact — not responding to emails. May have churned.',
    'Signed the contract. Very excited about onboarding.',
    'Pricing objection raised. Sent discount approval request to manager.',
    'Call went poorly. Customer frustrated with current product issues.',
  ];

  let activityCount = 0;
  for (const contact of contacts) {
    const numActivities = faker.number.int({ min: 1, max: 8 });
    for (let i = 0; i < numActivities; i++) {
      const type = faker.helpers.arrayElement(ACTIVITY_TYPES);
      const sentiment = contact.status === 'CHURNED'
        ? faker.helpers.arrayElement(['NEGATIVE','AT_RISK'])
        : faker.helpers.arrayElement(SENTIMENTS);

      await prisma.activity.create({
        data: {
          type,
          subject: type === 'EMAIL' ? faker.lorem.sentence() : null,
          notes: faker.helpers.arrayElement(noteTemplates),
          sentiment,
          sentimentScore: sentiment === 'POSITIVE' ? faker.number.float({ min: 0.7, max: 1, fractionDigits: 2 })
                        : sentiment === 'NEUTRAL'   ? faker.number.float({ min: 0.4, max: 0.7, fractionDigits: 2 })
                        : sentiment === 'NEGATIVE'  ? faker.number.float({ min: 0.2, max: 0.4, fractionDigits: 2 })
                        :                             faker.number.float({ min: 0, max: 0.2, fractionDigits: 2 }),
          durationMinutes: type === 'CALL' ? faker.number.int({ min: 5, max: 90 }) : null,
          contactId: contact.id,
          dealId: faker.helpers.maybe(() => faker.helpers.arrayElement(deals).id, { probability: 0.4 }),
          userId: contact.ownerId || admin.id,
          occurredAt: faker.date.past({ years: 1 }),
        }
      });
      activityCount++;
    }
  }
  console.log(`✓ Created ${activityCount} activities`);

  // ── TASKS ─────────────────────────────────────────────────
  let taskCount = 0;
  for (let i = 0; i < 80; i++) {
    const contact = faker.helpers.arrayElement(contacts);
    const assignee = faker.helpers.arrayElement(allUsers);
    await prisma.task.create({
      data: {
        title: faker.helpers.arrayElement([
          'Follow up via email', 'Schedule demo', 'Send proposal',
          'Call to discuss pricing', 'Send contract', 'Check in after demo',
          'Prepare presentation', 'Research competitor pricing',
        ]),
        dueDate: faker.date.soon({ days: 30 }),
        priority: faker.helpers.arrayElement(['LOW','MEDIUM','HIGH']),
        completed: faker.datatype.boolean({ probability: 0.3 }),
        contactId: contact.id,
        assignedToId: assignee.id,
        createdById: admin.id,
      }
    });
    taskCount++;
  }
  console.log(`✓ Created ${taskCount} tasks`);

  console.log('\n✅ Seeding complete!');
  console.log('\n🔑 Test credentials:');
  console.log('   Admin:    admin@leadpulse.dev / password123');
  console.log('   Sales Rep: sarah@leadpulse.dev / password123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

Run the seed:
```bash
cd server && npm run seed
```

**CONFIRM 1.3:**
- [ ] Seed script runs without any errors
- [ ] Output shows: `✓ Created 4 users`, `✓ Created 30 companies`, `✓ Created 200 contacts`, `✓ Created 120 deals`
- [ ] Connect to DB and run `SELECT COUNT(*) FROM contacts;` — returns 200
- [ ] Run `SELECT COUNT(*) FROM activities;` — returns at least 300

---

# PHASE 2 — BACKEND: AUTH SYSTEM

## Step 2.1 — Create the Express app entry point

Create `server/src/app.js` — the full Express application setup:

```javascript
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static file serving for audio uploads ────────────────────
app.use('/uploads', express.static('uploads'));

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth.routes'));
app.use('/api/contacts',   require('./routes/contacts.routes'));
app.use('/api/companies',  require('./routes/companies.routes'));
app.use('/api/deals',      require('./routes/deals.routes'));
app.use('/api/activities', require('./routes/activities.routes'));
app.use('/api/tasks',      require('./routes/tasks.routes'));
app.use('/api/analytics',  require('./routes/analytics.routes'));
app.use('/api/ai',         require('./routes/ai.routes'));

// ── Health check ─────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'leadpulse-api' }));

// ── Error middleware (must be last) ──────────────────────────
app.use(require('./middleware/error.middleware'));

module.exports = app;
```

Create `server/server.js` — the entry point with Socket.io:

```javascript
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = require('./src/app');

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

// Make io available to controllers via global
global.io = io;

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;
  if (userId) {
    socket.join(userId);
    console.log(`Socket connected: user ${userId}`);
  }
  socket.on('disconnect', () => console.log(`Socket disconnected: user ${userId}`));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Leadpulse server running on port ${PORT}`);

  // Start nightly scoring cron job
  require('./src/jobs/scoring.job');
});
```

**CONFIRM 2.1:**
- [ ] `server/src/app.js` exists with all route mounts
- [ ] `server/server.js` exists with Socket.io setup
- [ ] File imports will not fail — create empty placeholder route files now if needed

---

## Step 2.2 — Create middleware files

Create `server/src/middleware/auth.middleware.js`:

```javascript
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch fresh user from DB to ensure they're still active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Invalid token' });
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    next(err);
  }
};
```

Create `server/src/middleware/error.middleware.js`:

```javascript
module.exports = (err, req, res, next) => {
  console.error('[Error]', err.message);
  console.error(err.stack);

  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'A record with this value already exists' });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }

  res.status(err.statusCode || 500).json({
    error: err.message || 'Internal server error',
  });
};
```

**CONFIRM 2.2:**
- [ ] Both middleware files exist with the correct logic
- [ ] `auth.middleware.js` fetches the user from the DB (not just trusts the token payload)
- [ ] `error.middleware.js` handles Prisma error codes P2002 and P2025

---

## Step 2.3 — Create auth routes and controller

Create `server/src/routes/auth.routes.js`:

```javascript
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/auth.controller');
const auth = require('../middleware/auth.middleware');

router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('firstName').trim().notEmpty(),
  body('lastName').trim().notEmpty(),
], ctrl.register);

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], ctrl.login);

router.get('/me', auth, ctrl.me);
router.post('/logout', auth, ctrl.logout);

module.exports = router;
```

Create `server/src/controllers/auth.controller.js` with the full implementation:

```javascript
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

const prisma = new PrismaClient();

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

exports.register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, firstName, lastName } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, firstName, lastName },
      select: { id: true, email: true, firstName: true, lastName: true, role: true }
    });

    const token = generateToken(user.id);
    res.status(201).json({ token, user });
  } catch (err) { next(err); }
};

exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    // Update last login time
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = generateToken(user.id);
    const { passwordHash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) { next(err); }
};

exports.me = async (req, res) => {
  res.json({ user: req.user });
};

exports.logout = async (req, res) => {
  // JWT is stateless — client discards the token
  res.json({ message: 'Logged out successfully' });
};
```

**CONFIRM 2.3:**
- [ ] Start the server: `cd server && npm run dev` — no startup errors
- [ ] Test with curl or Postman:
  - `POST http://localhost:3001/api/auth/register` with body `{"email":"test@test.com","password":"password123","firstName":"Test","lastName":"User"}` — returns `{ token, user }`
  - `POST http://localhost:3001/api/auth/login` with same credentials — returns `{ token, user }`
  - `GET http://localhost:3001/api/auth/me` with `Authorization: Bearer {token}` — returns `{ user }`
- [ ] `GET http://localhost:3001/api/health` returns `{ status: 'ok' }`

---

# PHASE 3 — BACKEND: CORE CRM ROUTES

## Step 3.1 — Contacts API (full CRUD + import/export)

Create `server/src/routes/contacts.routes.js`:

```javascript
const router = require('express').Router();
const { body, query } = require('express-validator');
const ctrl = require('../controllers/contacts.controller');
const auth = require('../middleware/auth.middleware');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

router.use(auth); // All contacts routes require auth

router.get('/',         ctrl.list);
router.post('/',        ctrl.create);
router.get('/export',   ctrl.exportCSV);
router.post('/import',  upload.single('file'), ctrl.importCSV);
router.get('/:id',      ctrl.getOne);
router.patch('/:id',    ctrl.update);
router.delete('/:id',   ctrl.remove);

module.exports = router;
```

Create `server/src/controllers/contacts.controller.js` — implement every method in full:

```javascript
const { PrismaClient } = require('@prisma/client');
const { Parser } = require('json2csv');
const papa = require('papaparse');
const scoringService = require('../services/scoring.service');

const prisma = new PrismaClient();

// GET /api/contacts
exports.list = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 25,
      search = '',
      status,
      ownerId,
      tags,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      AND: [
        search ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName:  { contains: search, mode: 'insensitive' } },
            { email:     { contains: search, mode: 'insensitive' } },
          ]
        } : {},
        status ? { status } : {},
        ownerId ? { ownerId } : {},
        tags ? { tags: { hasSome: tags.split(',') } } : {},
      ]
    };

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true } },
          owner:   { select: { id: true, firstName: true, lastName: true } },
          _count:  { select: { deals: true, activities: true } },
        },
      }),
      prisma.contact.count({ where }),
    ]);

    res.json({
      contacts,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) { next(err); }
};

// POST /api/contacts
exports.create = async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, title, linkedinUrl, companyId, tags, status } = req.body;

    const contact = await prisma.contact.create({
      data: {
        firstName, lastName, email,
        phone: phone || null,
        title: title || null,
        linkedinUrl: linkedinUrl || null,
        companyId: companyId || null,
        ownerId: req.user.id,
        tags: tags || [],
        status: status || 'LEAD',
      },
      include: {
        company: { select: { id: true, name: true } },
        owner:   { select: { id: true, firstName: true, lastName: true } },
      }
    });

    // Emit real-time event
    if (global.io) global.io.emit('contact:created', { contactId: contact.id });

    res.status(201).json(contact);
  } catch (err) { next(err); }
};

// GET /api/contacts/:id
exports.getOne = async (req, res, next) => {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: {
        company: true,
        owner:   { select: { id: true, firstName: true, lastName: true, email: true } },
        deals: {
          orderBy: { createdAt: 'desc' },
          include: { owner: { select: { id: true, firstName: true, lastName: true } } }
        },
        activities: {
          orderBy: { occurredAt: 'desc' },
          take: 30,
          include: { user: { select: { id: true, firstName: true, lastName: true } } }
        },
        tasks: {
          where: { completed: false },
          orderBy: { dueDate: 'asc' },
          include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } }
        },
        emailDrafts: { orderBy: { createdAt: 'desc' }, take: 20 },
      }
    });

    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(contact);
  } catch (err) { next(err); }
};

// PATCH /api/contacts/:id
exports.update = async (req, res, next) => {
  try {
    const allowed = ['firstName','lastName','email','phone','title','linkedinUrl','status','companyId','ownerId','tags','customFields','leadScore','churnRisk','sentimentScore','nextBestAction','leadScoreLabel','leadScoreExplanation'];
    const data = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) data[f] = req.body[f]; });

    const contact = await prisma.contact.update({
      where: { id: req.params.id },
      data,
      include: {
        company: { select: { id: true, name: true } },
        owner:   { select: { id: true, firstName: true, lastName: true } },
      }
    });

    if (global.io) global.io.emit('contact:updated', { contactId: contact.id });
    res.json(contact);
  } catch (err) { next(err); }
};

// DELETE /api/contacts/:id
exports.remove = async (req, res, next) => {
  try {
    await prisma.contact.delete({ where: { id: req.params.id } });
    res.json({ message: 'Contact deleted' });
  } catch (err) { next(err); }
};

// GET /api/contacts/export
exports.exportCSV = async (req, res, next) => {
  try {
    const contacts = await prisma.contact.findMany({
      include: { company: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const fields = ['firstName','lastName','email','phone','title','status','leadScore','churnRisk'];
    const data = contacts.map(c => ({
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone || '',
      title: c.title || '',
      status: c.status,
      leadScore: c.leadScore,
      churnRisk: (c.churnRisk * 100).toFixed(0) + '%',
    }));

    const parser = new Parser({ fields });
    const csv = parser.parse(data);

    res.header('Content-Type', 'text/csv');
    res.attachment('leadpulse-contacts.csv');
    res.send(csv);
  } catch (err) { next(err); }
};

// POST /api/contacts/import
exports.importCSV = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const csvText = req.file.buffer.toString('utf8');
    const { data, errors } = papa.parse(csvText, { header: true, skipEmptyLines: true });

    if (errors.length) return res.status(400).json({ error: 'CSV parse error', details: errors });

    const created = [];
    const failed = [];

    for (const row of data) {
      try {
        const contact = await prisma.contact.create({
          data: {
            firstName: row.firstName || row.first_name || 'Unknown',
            lastName:  row.lastName  || row.last_name  || 'Unknown',
            email:     row.email,
            phone:     row.phone  || null,
            title:     row.title  || null,
            ownerId:   req.user.id,
            tags:      [],
          }
        });
        created.push(contact.id);
      } catch (e) {
        failed.push({ row, reason: e.message });
      }
    }

    res.json({ created: created.length, failed: failed.length, failedRows: failed });
  } catch (err) { next(err); }
};
```

**CONFIRM 3.1:**
- [ ] Restart server — no errors
- [ ] `GET http://localhost:3001/api/contacts` with auth header — returns `{ contacts: [...], total: 200, ... }`
- [ ] `POST http://localhost:3001/api/contacts` with `{ firstName, lastName, email }` — creates and returns the contact
- [ ] `GET http://localhost:3001/api/contacts/{id}` — returns full contact with relations
- [ ] `PATCH http://localhost:3001/api/contacts/{id}` with `{ title: "CTO" }` — updates title
- [ ] `GET http://localhost:3001/api/contacts/export` — downloads a CSV file

---

## Step 3.2 — Companies API

Create `server/src/routes/companies.routes.js` and `server/src/controllers/companies.controller.js`.

Implement these endpoints completely:

**`GET /api/companies`** — paginated list with search by name/domain, filter by industry. Returns each company with its contact count.

```javascript
exports.list = async (req, res, next) => {
  try {
    const { page = 1, limit = 25, search = '', industry } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {
      AND: [
        search ? {
          OR: [
            { name:   { contains: search, mode: 'insensitive' } },
            { domain: { contains: search, mode: 'insensitive' } },
          ]
        } : {},
        industry ? { industry } : {},
      ]
    };

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { name: 'asc' },
        include: { _count: { select: { contacts: true } } }
      }),
      prisma.company.count({ where }),
    ]);

    res.json({ companies, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
};
```

**`POST /api/companies`** — create company with name, domain, industry, size, country, website, description

**`GET /api/companies/:id`** — returns company with all contacts and their deals

**`PATCH /api/companies/:id`** — partial update

**`DELETE /api/companies/:id`** — delete (only if no contacts linked, else return 409)

**CONFIRM 3.2:**
- [ ] `GET /api/companies` returns paginated companies with `_count.contacts`
- [ ] `POST /api/companies` creates a company
- [ ] `GET /api/companies/{id}` returns company with contacts array

---

## Step 3.3 — Deals API (including Kanban grouping)

Create `server/src/routes/deals.routes.js` and `server/src/controllers/deals.controller.js`.

The most important endpoint is the Kanban-grouped list:

```javascript
// GET /api/deals?view=kanban  OR  GET /api/deals?view=list
exports.list = async (req, res, next) => {
  try {
    const { view = 'kanban', ownerId, search } = req.query;

    const where = {
      AND: [
        ownerId ? { ownerId } : {},
        search ? { title: { contains: search, mode: 'insensitive' } } : {},
      ]
    };

    if (view === 'kanban') {
      const stages = ['LEAD','CONTACTED','DEMO','PROPOSAL','NEGOTIATION','CLOSED_WON','CLOSED_LOST'];
      const result = {};

      await Promise.all(stages.map(async (stage) => {
        const deals = await prisma.deal.findMany({
          where: { ...where, stage },
          orderBy: { createdAt: 'desc' },
          include: {
            contact: { select: { id: true, firstName: true, lastName: true } },
            owner:   { select: { id: true, firstName: true, lastName: true } },
          }
        });
        const totalValue = deals.reduce((sum, d) => sum + Number(d.value), 0);
        result[stage] = { deals, totalValue, count: deals.length };
      }));

      return res.json(result);
    }

    // List view
    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
          owner:   { select: { id: true, firstName: true, lastName: true } },
        }
      }),
      prisma.deal.count({ where }),
    ]);
    res.json({ deals, total });
  } catch (err) { next(err); }
};
```

Implement these additional endpoints:

**`POST /api/deals`** — create deal with title, value, stage, contactId, expectedCloseDate

**`GET /api/deals/:id`** — full deal with contact, owner, activities (last 20), tasks

**`PATCH /api/deals/:id`** — partial update

**`PATCH /api/deals/:id/stage`** — update only the stage. After updating, emit a Socket.io event: `global.io.to(deal.ownerId).emit('deal:stage_changed', { dealId, title, newStage })`

**`DELETE /api/deals/:id`** — delete deal

**CONFIRM 3.3:**
- [ ] `GET /api/deals?view=kanban` returns an object with 7 keys (one per stage), each with `{ deals, totalValue, count }`
- [ ] `POST /api/deals` creates a deal
- [ ] `PATCH /api/deals/{id}/stage` with `{ stage: "PROPOSAL" }` updates the stage
- [ ] Verify in the DB that the stage changed

---

## Step 3.4 — Activities API

Create `server/src/routes/activities.routes.js` and `server/src/controllers/activities.controller.js`.

**`GET /api/activities`** — paginated, filterable by `type`, `contactId`, `dealId`, date range

**`POST /api/activities`** — create activity. After creation:
1. If `type` is `NOTE` or `CALL` and `notes` is present, call the ML service to get sentiment
2. Update the activity record with the sentiment label and score
3. Recalculate the contact's rolling average `sentimentScore` from all their activities
4. Update the contact record

```javascript
exports.create = async (req, res, next) => {
  try {
    const { type, subject, notes, contactId, dealId, durationMinutes, occurredAt } = req.body;

    const activity = await prisma.activity.create({
      data: {
        type, subject: subject || null,
        notes: notes || null,
        durationMinutes: durationMinutes || null,
        contactId,
        dealId: dealId || null,
        userId: req.user.id,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        user:    { select: { id: true, firstName: true, lastName: true } },
      }
    });

    // Run sentiment analysis asynchronously (don't block the response)
    if (['NOTE','CALL'].includes(type) && notes) {
      setImmediate(async () => {
        try {
          const axios = require('axios');
          const mlRes = await axios.post(`${process.env.ML_SERVICE_URL}/sentiment/analyze`, { text: notes });
          const { mapped_sentiment, score } = mlRes.data;

          await prisma.activity.update({
            where: { id: activity.id },
            data: { sentiment: mapped_sentiment, sentimentScore: score }
          });

          // Recalculate rolling average sentiment for the contact
          const activities = await prisma.activity.findMany({
            where: { contactId, sentimentScore: { not: null } },
            select: { sentimentScore: true }
          });
          if (activities.length > 0) {
            const avgSentiment = activities.reduce((s, a) => s + a.sentimentScore, 0) / activities.length;
            await prisma.contact.update({
              where: { id: contactId },
              data: { sentimentScore: avgSentiment }
            });
          }
        } catch (e) {
          console.error('Sentiment analysis failed (non-blocking):', e.message);
        }
      });
    }

    if (global.io) global.io.emit('activity:created', { contactId });
    res.status(201).json(activity);
  } catch (err) { next(err); }
};
```

**`POST /api/activities/upload-audio`** — accept multipart audio file, send to ML service for transcription, create an activity of type TRANSCRIPT

**`DELETE /api/activities/:id`** — delete activity

**CONFIRM 3.4:**
- [ ] `GET /api/activities` returns paginated activities with contact and user included
- [ ] `POST /api/activities` with `{ type: "NOTE", notes: "Great call!", contactId: "..." }` creates the activity
- [ ] Wait 2 seconds, then check the activity in the DB — it should have a `sentiment` value

---

## Step 3.5 — Tasks, Analytics, and AI route stubs

Create `server/src/routes/tasks.routes.js` and `server/src/controllers/tasks.controller.js` with full implementation:

**Endpoints:** `GET /` (filter by assignedToId, contactId, completed), `POST /`, `PATCH /:id`, `DELETE /:id`, `PATCH /:id/complete` (sets `completed: true` and `completedAt: new Date()`)

Create `server/src/routes/analytics.routes.js` and `server/src/controllers/analytics.controller.js`:

**`GET /api/analytics/revenue`** — group closed won deals by month for the past 12 months:
```javascript
exports.revenue = async (req, res, next) => {
  try {
    const deals = await prisma.deal.findMany({
      where: { stage: 'CLOSED_WON', createdAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) } },
      select: { value: true, createdAt: true }
    });

    // Group by month
    const monthly = {};
    deals.forEach(d => {
      const key = d.createdAt.toISOString().slice(0, 7); // "2024-01"
      monthly[key] = (monthly[key] || 0) + Number(d.value);
    });

    const historical = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ds, y]) => ({ ds: ds + '-01', y }));

    res.json({ historical });
  } catch (err) { next(err); }
};
```

**`GET /api/analytics/pipeline`** — count and sum of deals per stage

**`GET /api/analytics/win-loss`** — count of CLOSED_WON vs CLOSED_LOST

**`GET /api/analytics/rep-performance`** — closed deals and revenue grouped by owner

**`GET /api/analytics/sentiment-trends`** — average sentiment score per week for the past 12 weeks

Create `server/src/routes/ai.routes.js` — stub all 7 AI endpoints now (implement in Phase 6):
```javascript
const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const ctrl = require('../controllers/ai.controller');

router.use(auth);
router.post('/compose-email',    ctrl.composeEmail);
router.post('/deal-summary/:id', ctrl.dealSummary);
router.post('/smart-reply',      ctrl.smartReply);
router.post('/next-action/:id',  ctrl.nextAction);
router.post('/enrich-contact',   ctrl.enrichContact);
router.get('/chat',              ctrl.chat);
router.post('/transcribe',       ctrl.transcribe);

module.exports = router;
```

Create `server/src/controllers/ai.controller.js` with stub functions that return `res.json({ message: 'Coming soon' })` — these will be replaced in Phase 6.

**CONFIRM 3.5:**
- [ ] Server starts with no errors — all route files are importable
- [ ] `GET /api/tasks` returns tasks array
- [ ] `GET /api/analytics/revenue` returns `{ historical: [...] }`
- [ ] `GET /api/analytics/pipeline` returns deals grouped by stage
- [ ] `GET /api/ai/chat` returns the stub message

---

# PHASE 4 — FRONTEND: FOUNDATION

## Step 4.1 — Create Zustand stores

Create `client/src/store/authStore.js`:

```javascript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: (token, user) => set({ token, user }),
      logout: () => {
        set({ token: null, user: null });
      },
      updateUser: (user) => set({ user }),
    }),
    {
      name: 'leadpulse-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
    }
  )
);
```

Create `client/src/store/uiStore.js`:

```javascript
import { create } from 'zustand';

export const useUIStore = create((set, get) => ({
  sidebarOpen: true,
  notifications: [],
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  addNotification: (notification) => {
    const id = Date.now().toString();
    set((s) => ({
      notifications: [{ id, read: false, createdAt: new Date(), ...notification }, ...s.notifications].slice(0, 50)
    }));
    return id;
  },
  markAllRead: () => set((s) => ({ notifications: s.notifications.map(n => ({ ...n, read: true })) })),
  unreadCount: () => get().notifications.filter(n => !n.read).length,
}));
```

**CONFIRM 4.1:**
- [ ] Both store files exist with the correct exports
- [ ] `useAuthStore` uses `persist` middleware so the token survives page refresh

---

## Step 4.2 — Create the Axios instance

Create `client/src/api/axiosInstance.js`:

```javascript
import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  timeout: 30000,
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 — log out and redirect
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
```

Create all API wrapper files. Each file exports functions that call the corresponding server endpoint:

**`client/src/api/contacts.js`:**
```javascript
import api from './axiosInstance';

export const getContacts = (params) => api.get('/api/contacts', { params });
export const getContact  = (id) => api.get(`/api/contacts/${id}`);
export const createContact = (data) => api.post('/api/contacts', data);
export const updateContact = (id, data) => api.patch(`/api/contacts/${id}`, data);
export const deleteContact = (id) => api.delete(`/api/contacts/${id}`);
export const exportContacts = () => api.get('/api/contacts/export', { responseType: 'blob' });
export const importContacts = (file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post('/api/contacts/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
};
```

Create similar files for `companies.js`, `deals.js`, `activities.js`, `tasks.js`, `analytics.js`, and `ai.js`. Each should export named functions for every API endpoint.

**CONFIRM 4.2:**
- [ ] All 8 API files exist in `client/src/api/`
- [ ] `axiosInstance.js` has both the request interceptor (attaches JWT) and response interceptor (handles 401)

---

## Step 4.3 — Build shared UI components

Create each component in `client/src/components/ui/`. These must be production-quality, reusable components.

**`Button.jsx`** — supports variants (primary, secondary, danger, ghost) and sizes (sm, md, lg):
```jsx
export default function Button({ children, variant = 'primary', size = 'md', loading = false, disabled = false, onClick, type = 'button', className = '' }) {
  const base = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2';
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500 disabled:bg-indigo-300',
    secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 focus:ring-indigo-500',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    ghost: 'text-gray-600 hover:bg-gray-100 focus:ring-gray-400',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${sizes[size]} ${disabled || loading ? 'cursor-not-allowed opacity-60' : ''} ${className}`}
    >
      {loading && <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
      {children}
    </button>
  );
}
```

**`Badge.jsx`** — supports color variants:
```jsx
export default function Badge({ children, variant = 'gray', size = 'sm' }) {
  const variants = {
    green:  'bg-green-100 text-green-800',
    red:    'bg-red-100 text-red-800',
    amber:  'bg-amber-100 text-amber-800',
    blue:   'bg-blue-100 text-blue-800',
    indigo: 'bg-indigo-100 text-indigo-800',
    gray:   'bg-gray-100 text-gray-700',
    purple: 'bg-purple-100 text-purple-800',
  };
  const sizes = { sm: 'px-2 py-0.5 text-xs', md: 'px-2.5 py-1 text-sm' };
  return (
    <span className={`inline-flex items-center font-medium rounded-full ${variants[variant]} ${sizes[size]}`}>
      {children}
    </span>
  );
}
```

**`Modal.jsx`** — centered overlay with backdrop blur:
```jsx
import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-xl w-full ${sizes[size]} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
```

**`Input.jsx`** — labeled input with error state:
```jsx
export default function Input({ label, error, className = '', ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <input
        className={`w-full border rounded-lg px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${error ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-white hover:border-gray-400'}`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
```

**`Skeleton.jsx`** — animated loading placeholder:
```jsx
export default function Skeleton({ className = '', lines = 1 }) {
  if (lines > 1) {
    return (
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={`animate-pulse bg-gray-200 rounded ${i === lines - 1 ? 'w-3/4' : 'w-full'} h-4`} />
        ))}
      </div>
    );
  }
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}
```

**`EmptyState.jsx`** — empty list placeholder:
```jsx
import { Inbox } from 'lucide-react';
import Button from './Button';

export default function EmptyState({ icon: Icon = Inbox, title, description, actionLabel, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
        <Icon size={28} className="text-gray-400" />
      </div>
      <h3 className="text-base font-semibold text-gray-900 mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 max-w-sm mb-6">{description}</p>}
      {actionLabel && onAction && (
        <Button onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  );
}
```

**`Avatar.jsx`** — initials avatar with colour based on name:
```jsx
export default function Avatar({ firstName = '', lastName = '', size = 'md', src }) {
  const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
  const colours = ['bg-indigo-500','bg-purple-500','bg-pink-500','bg-red-500','bg-orange-500','bg-amber-500','bg-green-500','bg-teal-500'];
  const colourIndex = (firstName.charCodeAt(0) || 0) % colours.length;
  const sizes = { xs: 'w-6 h-6 text-xs', sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base' };

  if (src) return <img src={src} className={`${sizes[size]} rounded-full object-cover`} alt={initials} />;

  return (
    <div className={`${sizes[size]} ${colours[colourIndex]} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}>
      {initials}
    </div>
  );
}
```

**`SlideOver.jsx`** — right-side sliding panel:
```jsx
import { X } from 'lucide-react';

export default function SlideOver({ isOpen, onClose, title, children, width = 'max-w-md' }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`relative bg-white h-full ${width} w-full shadow-2xl flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
```

**CONFIRM 4.3:**
- [ ] All 8 UI component files exist in `client/src/components/ui/`
- [ ] Import each component in a test page and verify they render without errors
- [ ] Button shows a spinner when `loading={true}`
- [ ] Modal traps scroll when open (body overflow hidden)
- [ ] Avatar generates coloured initials when no `src` is provided

---

## Step 4.4 — Build the App Shell (Sidebar + TopBar + Layout)

Create `client/src/components/layout/Sidebar.jsx`:

The sidebar must be exactly as specified:
- 240px wide, fixed left, full height, `bg-gray-900`
- Leadpulse logo text at top in white
- Navigation items with icons from lucide-react
- Active item: `bg-indigo-600 text-white rounded-lg`
- Inactive items: `text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg`
- On mobile: hidden off-screen, slides in when `sidebarOpen` is true in `uiStore`

```jsx
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, TrendingUp,
  Activity, CheckSquare, BarChart2, Sparkles, Settings
} from 'lucide-react';
import { useUIStore } from '../../store/uiStore';

const NAV_ITEMS = [
  { label: 'Dashboard',     href: '/dashboard',        icon: LayoutDashboard },
  { label: 'Contacts',      href: '/contacts',         icon: Users },
  { label: 'Companies',     href: '/companies',        icon: Building2 },
  { label: 'Deals',         href: '/deals',            icon: TrendingUp },
  { label: 'Activities',    href: '/activities',       icon: Activity },
  { label: 'Tasks',         href: '/tasks',            icon: CheckSquare },
  { label: 'Analytics',     href: '/analytics',        icon: BarChart2 },
  { label: 'AI Assistant',  href: '/ai-assistant',     icon: Sparkles, highlight: true },
  { label: 'Settings',      href: '/settings/general', icon: Settings },
];

export default function Sidebar() {
  const { sidebarOpen } = useUIStore();

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => useUIStore.getState().toggleSidebar()} />
      )}

      <aside className={`fixed left-0 top-0 z-30 h-full w-60 bg-gray-900 flex flex-col transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:z-auto`}>

        {/* Logo */}
        <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-800">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Sparkles size={16} className="text-white" />
          </div>
          <span className="text-white font-bold text-lg tracking-tight">Leadpulse</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(({ label, href, icon: Icon, highlight }) => (
            <NavLink
              key={href}
              to={href}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                ${isActive
                  ? 'bg-indigo-600 text-white'
                  : highlight
                    ? 'text-indigo-400 hover:bg-gray-800 hover:text-indigo-300'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom user info */}
        <div className="px-3 pb-4 border-t border-gray-800 pt-4">
          <div className="flex items-center gap-2 px-3 py-2 text-gray-400 text-xs">
            <div className="w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-bold">L</div>
            <span>Leadpulse v1.0</span>
          </div>
        </div>
      </aside>
    </>
  );
}
```

Create `client/src/components/layout/TopBar.jsx`:

```jsx
import { Bell, Menu, ChevronDown, LogOut, User } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useUIStore } from '../../store/uiStore';
import Avatar from '../ui/Avatar';

export default function TopBar({ title }) {
  const { user, logout } = useAuthStore();
  const { notifications, markAllRead, toggleSidebar } = useUIStore();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const navigate = useNavigate();

  const unread = notifications.filter(n => !n.read).length;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="h-15 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0" style={{ height: 60 }}>
      <div className="flex items-center gap-4">
        <button onClick={toggleSidebar} className="lg:hidden text-gray-500 hover:text-gray-700">
          <Menu size={20} />
        </button>
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => { setNotifOpen(!notifOpen); setUserMenuOpen(false); markAllRead(); }}
            className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Bell size={20} />
            {unread > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-12 w-80 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900">Notifications</p>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="text-center text-sm text-gray-500 py-8">No notifications yet</p>
                ) : notifications.slice(0, 10).map(n => (
                  <div key={n.id} className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50">
                    <p className="text-sm text-gray-700">{n.message}</p>
                    <p className="text-xs text-gray-400 mt-1">{new Date(n.createdAt).toLocaleTimeString()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => { setUserMenuOpen(!userMenuOpen); setNotifOpen(false); }}
            className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Avatar firstName={user?.firstName} lastName={user?.lastName} size="sm" />
            <span className="text-sm font-medium text-gray-700 hidden md:block">{user?.firstName}</span>
            <ChevronDown size={14} className="text-gray-400" />
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-12 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-gray-500">{user?.email}</p>
              </div>
              <button onClick={handleLogout} className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors">
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
```

Create `client/src/components/layout/AppShell.jsx`:

```jsx
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const PAGE_TITLES = {
  '/dashboard': 'Dashboard',
  '/contacts': 'Contacts',
  '/companies': 'Companies',
  '/deals': 'Deals Pipeline',
  '/activities': 'Activities',
  '/tasks': 'Tasks',
  '/analytics': 'Analytics',
  '/ai-assistant': 'AI Assistant',
  '/settings/general': 'Settings',
  '/settings/users': 'Team & Users',
  '/settings/integrations': 'Integrations',
};

export default function AppShell() {
  const location = useLocation();
  const title = Object.entries(PAGE_TITLES).find(([path]) =>
    location.pathname.startsWith(path)
  )?.[1] || 'Leadpulse';

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} />
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
```

**CONFIRM 4.4:**
- [ ] Sidebar renders with all 9 navigation items and icons
- [ ] Active nav item is highlighted in indigo
- [ ] Clicking a nav item navigates to the correct route
- [ ] TopBar shows the page title, notification bell, and user avatar
- [ ] Logout button logs out and redirects to `/login`
- [ ] On mobile (<1024px), sidebar is hidden; hamburger button toggles it

---

## Step 4.5 — Build Auth pages and configure routing

Create `client/src/pages/auth/Login.jsx` — a complete login page:

```jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import api from '../../api/axiosInstance';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';

export default function Login() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/api/auth/login', form);
      login(data.token, data.user);
      toast.success(`Welcome back, ${data.user.firstName}!`);
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-xl mb-4">
            <Sparkles size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Leadpulse</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in to your account</p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              label="Email address"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@company.com"
              required
              autoFocus
            />
            <Input
              label="Password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              required
            />
            <Button type="submit" loading={loading} className="w-full" size="lg">
              Sign in
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Don't have an account?{' '}
            <Link to="/register" className="text-indigo-600 font-medium hover:text-indigo-700">Create one</Link>
          </p>

          {/* Demo credentials */}
          <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 text-center">
            Demo: <strong>admin@leadpulse.dev</strong> / <strong>password123</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
```

Create `client/src/pages/auth/Register.jsx` — similar to login but with firstName, lastName, confirmPassword fields.

Create `client/src/components/layout/PrivateRoute.jsx`:
```jsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

export default function PrivateRoute() {
  const { token } = useAuthStore();
  return token ? <Outlet /> : <Navigate to="/login" replace />;
}
```

Create placeholder pages for all 15 routes. Each placeholder renders the page name and a coming soon message:
```jsx
// Template for each placeholder page:
export default function PageName() {
  return (
    <div className="text-center py-20">
      <h2 className="text-2xl font-bold text-gray-900">Page Name</h2>
      <p className="text-gray-500 mt-2">Under construction</p>
    </div>
  );
}
```

Create all 15 placeholder pages now: `Dashboard.jsx`, `contacts/ContactsList.jsx`, `contacts/ContactDetail.jsx`, `companies/CompaniesList.jsx`, `companies/CompanyDetail.jsx`, `deals/DealsPipeline.jsx`, `deals/DealDetail.jsx`, `Activities.jsx`, `Tasks.jsx`, `Analytics.jsx`, `AIAssistant.jsx`, `settings/GeneralSettings.jsx`, `settings/UsersSettings.jsx`, `settings/IntegrationsSettings.jsx`

Wire everything in `client/src/App.jsx`:

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import PrivateRoute from './components/layout/PrivateRoute';
import AppShell from './components/layout/AppShell';

// Auth pages
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';

// App pages (import all 15)
import Dashboard from './pages/Dashboard';
import ContactsList from './pages/contacts/ContactsList';
import ContactDetail from './pages/contacts/ContactDetail';
import CompaniesList from './pages/companies/CompaniesList';
import CompanyDetail from './pages/companies/CompanyDetail';
import DealsPipeline from './pages/deals/DealsPipeline';
import DealDetail from './pages/deals/DealDetail';
import Activities from './pages/Activities';
import Tasks from './pages/Tasks';
import Analytics from './pages/Analytics';
import AIAssistant from './pages/AIAssistant';
import GeneralSettings from './pages/settings/GeneralSettings';
import UsersSettings from './pages/settings/UsersSettings';
import IntegrationsSettings from './pages/settings/IntegrationsSettings';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30 * 1000, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />

          <Route element={<PrivateRoute />}>
            <Route element={<AppShell />}>
              <Route path="/dashboard"         element={<Dashboard />} />
              <Route path="/contacts"          element={<ContactsList />} />
              <Route path="/contacts/:id"      element={<ContactDetail />} />
              <Route path="/companies"         element={<CompaniesList />} />
              <Route path="/companies/:id"     element={<CompanyDetail />} />
              <Route path="/deals"             element={<DealsPipeline />} />
              <Route path="/deals/:id"         element={<DealDetail />} />
              <Route path="/activities"        element={<Activities />} />
              <Route path="/tasks"             element={<Tasks />} />
              <Route path="/analytics"         element={<Analytics />} />
              <Route path="/ai-assistant"      element={<AIAssistant />} />
              <Route path="/settings/general"       element={<GeneralSettings />} />
              <Route path="/settings/users"         element={<UsersSettings />} />
              <Route path="/settings/integrations"  element={<IntegrationsSettings />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}
```

**CONFIRM 4.5:**
- [ ] Run `npm run dev` in `/client` — no compilation errors
- [ ] Go to `http://localhost:5173` — redirects to `/login`
- [ ] Login with `admin@leadpulse.dev / password123` — redirects to `/dashboard` (placeholder page)
- [ ] Sidebar shows all 9 items with correct icons
- [ ] Clicking each sidebar item navigates to the correct route
- [ ] Refreshing the page after login keeps you logged in (persisted store)
- [ ] Clicking logout redirects to `/login`

---

# PHASE 5 — FRONTEND: ALL 15 PAGES (DETAILED)

## Step 5.1 — Dashboard Page

Replace `client/src/pages/Dashboard.jsx` with the full implementation.

**Layout:** 4 metric cards on top, then a 60/40 split: left = revenue chart, right = pipeline health. Below: at-risk contacts panel and next best actions. Bottom: recent activity feed.

**Metric cards** — fetch from `/api/analytics/*`:
- Total Contacts: `GET /api/contacts?limit=1` → use `total` from response
- Open Deals: `GET /api/analytics/pipeline` → sum counts of non-closed stages
- Revenue This Month: `GET /api/analytics/revenue` → last month's value
- Win Rate: `GET /api/analytics/win-loss` → won / (won + lost) as percentage

**Each metric card** must show: icon, label, value (large), and a subtle trend indicator.

**Revenue Chart** — use Recharts `AreaChart` with data from `GET /api/analytics/revenue`. Show historical data as a solid area and forecast as a dashed line. Use `ResponsiveContainer` to fill the card width.

**Pipeline health** — horizontal `BarChart` from Recharts showing deal count per stage.

**At-Risk Contacts** — `GET /api/contacts?limit=5&churnRisk=high` — show contacts where churnRisk > 0.6 as a list. Each row: avatar, name, company, churn risk badge, "Take Action" button that navigates to the contact detail.

**Recent Activity Feed** — `GET /api/activities?limit=15` — show last 15 activities as a vertical timeline. Each entry: icon by type, contact name (link), notes excerpt, timestamp.

```jsx
// Key structure of Dashboard.jsx:
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Users, TrendingUp, DollarSign, Target, AlertTriangle, Activity } from 'lucide-react';
// ... import api functions

export default function Dashboard() {
  const { data: revenueData }   = useQuery({ queryKey: ['analytics','revenue'],   queryFn: () => getRevenue() });
  const { data: pipelineData }  = useQuery({ queryKey: ['analytics','pipeline'],  queryFn: () => getPipeline() });
  const { data: winLossData }   = useQuery({ queryKey: ['analytics','win-loss'],  queryFn: () => getWinLoss() });
  const { data: contactsData }  = useQuery({ queryKey: ['contacts','total'],      queryFn: () => getContacts({ limit: 1 }) });
  const { data: activitiesData }= useQuery({ queryKey: ['activities','recent'],   queryFn: () => getActivities({ limit: 15 }) });

  // Render 4 metric cards, revenue chart, pipeline chart, at-risk list, activity feed
  // Show Skeleton components while loading
  // Show real numbers when data is available
}
```

**CONFIRM 5.1:**
- [ ] Dashboard loads with all 4 metric cards showing real numbers
- [ ] Revenue AreaChart renders with real monthly data
- [ ] Pipeline BarChart renders with deal counts per stage
- [ ] At-risk contacts list shows contacts with high churn risk
- [ ] Activity feed shows the last 15 activities
- [ ] All sections show skeleton loaders while data is fetching

---

## Step 5.2 — Contacts List Page

Replace `client/src/pages/contacts/ContactsList.jsx` with the full implementation.

**Structure:**
- Header: page title + Import CSV button + Export CSV button + Add Contact button
- Filter bar: search input (debounced 300ms) + Status dropdown + Owner dropdown
- Contacts table with sticky header
- Pagination controls

**Table columns:** Checkbox | Avatar + Name (link to detail) | Company | Email | Phone | Lead Score badge | Churn Risk % | Owner | Created | Actions (edit, delete)

**Lead Score badge** colours:
- HOT → red badge
- WARM → amber badge
- COLD → blue badge

**Churn Risk** — display as a percentage: `(churnRisk * 100).toFixed(0) + '%'`, coloured red if > 60%, amber if > 30%, green otherwise.

**Add Contact button** opens a `SlideOver` with `ContactForm`:

`ContactForm.jsx` must have: firstName, lastName, email, phone, title, companyId (searchable dropdown), tags, status. On submit: call `createContact()`, invalidate contacts query, show success toast, close the slide-over.

**CSV Import** — clicking Import opens a Modal with a file input. On file select, preview the first 5 rows. On confirm, call `importContacts(file)` and show results.

**CSV Export** — clicking Export calls `exportContacts()`, creates a blob URL, and triggers a download.

**Bulk actions** — when rows are selected (checkbox), show a bulk action bar above the table with: "Assign owner", "Add tag", "Delete selected".

```jsx
// Key hooks pattern:
const [search, setSearch] = useState('');
const [debouncedSearch, setDebouncedSearch] = useState('');
const [page, setPage] = useState(1);
const [statusFilter, setStatusFilter] = useState('');
const [slideOverOpen, setSlideOverOpen] = useState(false);
const [selectedIds, setSelectedIds] = useState([]);

useEffect(() => {
  const timer = setTimeout(() => setDebouncedSearch(search), 300);
  return () => clearTimeout(timer);
}, [search]);

const { data, isLoading } = useQuery({
  queryKey: ['contacts', page, debouncedSearch, statusFilter],
  queryFn: () => getContacts({ page, search: debouncedSearch, status: statusFilter }),
});
```

**CONFIRM 5.2:**
- [ ] Contacts table loads with real data — 200 contacts from seed
- [ ] Search input filters results in real time (after 300ms debounce)
- [ ] Status dropdown filters by LEAD, ACTIVE, INACTIVE, CHURNED
- [ ] Clicking a contact's name navigates to `/contacts/{id}`
- [ ] Lead Score shows correct badge colour (HOT=red, WARM=amber, COLD=blue)
- [ ] Add Contact slide-over opens, form submits, new contact appears in table
- [ ] Export CSV button triggers a file download

---

## Step 5.3 — Contact Detail Page

Replace `client/src/pages/contacts/ContactDetail.jsx` with the full implementation.

**Layout:** Two-column — left panel (35%) fixed info, right panel (65%) tabbed content.

**Left panel must show:**
- Large Avatar with initials
- Full name (h1), title, company link
- Clickable email (mailto link)
- Phone number
- Status badge
- Lead Score badge + one-sentence explanation text below it
- Churn Risk: horizontal progress bar, red fill, percentage label
- Sentiment: coloured indicator dot (green/amber/red)
- Edit button → opens edit slide-over
- Floating "Enrich" button in top-right corner

**Right tabs — implement all 6:**

**Overview tab:**
- `NextActionCard` component at the top (see AI components)
- Linked deals: 2-3 deal cards showing stage, value, win probability
- Recent activities: last 5 as mini timeline items

**Activities tab:**
- Full activity timeline, newest first
- Each item: icon by type (phone/mail/users/file for call/email/meeting/note), date, notes text, rep name
- "Log Activity" button opens `LogActivityModal`

**Deals tab:**
- Grid of deal cards. Each card: title, stage badge, value, win probability bar, expected close date, owner
- "Add Deal" button opens deal creation modal with contactId pre-filled

**Emails tab:**
- List of email drafts (from emailDrafts relation)
- "Compose" button opens `EmailComposer` side panel
- `SmartReplyBar` below the most recent email

**Tasks tab:**
- Table of linked tasks: title, due date, priority, assignee, complete checkbox
- "Add Task" inline form at the top

**AI Insights tab:**
- Sentiment trend: LineChart showing sentimentScore over time (from activities data)
- Lead Score history
- AI-generated narrative: a button "Generate Relationship Summary" that calls the next-action AI endpoint and shows a paragraph narrative

**CONFIRM 5.3:**
- [ ] Contact detail page loads for any contact ID
- [ ] Left panel shows all fields including churn risk progress bar
- [ ] All 6 tabs are clickable and render content
- [ ] Activities tab shows the timeline with correct icons per type
- [ ] Deals tab shows deal cards with win probability bars
- [ ] Log Activity modal opens and submits successfully

---

## Step 5.4 — Companies List and Detail Pages

**CompaniesList.jsx** — similar pattern to ContactsList:
- Table: Company name | Domain | Industry | Size | Contact count | Website | Actions
- Search by name/domain, filter by industry dropdown
- Add Company slide-over with: name, domain, industry (select), size, country, website, description

**CompanyDetail.jsx** — two-column layout:
- Left: company header with name, domain badge, industry badge, size, website link, description
- Right tabs: Contacts (table of all linked contacts), Deals (all deals via contacts), Activities (combined activity feed)

**CONFIRM 5.4:**
- [ ] Companies list loads with contact counts
- [ ] Clicking a company navigates to its detail page
- [ ] Company detail shows contacts and deals tabs with real data

---

## Step 5.5 — Deals Pipeline (Kanban)

Replace `client/src/pages/deals/DealsPipeline.jsx` with the full Kanban implementation.

**Installation reminder:** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` must already be installed.

**Structure:**
```
Header: "Deals Pipeline" + filter bar (owner, date range) + "List view" toggle
Kanban board: horizontal scroll container with 7 KanbanColumn components
```

**KanbanColumn.jsx** — each column must show:
- Stage name (formatted: "CLOSED_WON" → "Closed Won")
- Deal count badge
- Total value (formatted as currency: ₹1,20,000 or $120,000)
- "+ Add Deal" button in header
- List of `DealCard` components (droppable zone)

**DealCard.jsx** — each card must show:
- Deal title
- Contact name + avatar (small)
- Value in large text
- Win probability bar: `<div className="h-1.5 rounded-full bg-gray-200"><div style={{ width: `${prob*100}%` }} className={`h-1.5 rounded-full ${prob > 0.6 ? 'bg-green-500' : prob > 0.3 ? 'bg-amber-500' : 'bg-red-500'}`} /></div>`
- Days in current stage (calculate from `updatedAt`)
- Owner avatar (right side)
- Click to navigate to deal detail

**Drag and drop** with @dnd-kit:
```jsx
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// In DealCard — make it sortable:
const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id });
const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

// In DealsPipeline — handle drag end:
const handleDragEnd = async (event) => {
  const { active, over } = event;
  if (!over || active.id === over.id) return;

  // Determine new stage from the drop target column
  const newStage = over.id; // column IDs are stage names

  // Optimistic update: update local React Query cache immediately
  queryClient.setQueryData(['deals','kanban'], (old) => {
    // Move the deal from its old stage to the new stage
    // ...
  });

  // Then call the API
  try {
    await updateDealStage(active.id, newStage);
  } catch {
    // Revert optimistic update on failure
    queryClient.invalidateQueries(['deals','kanban']);
    toast.error('Failed to update deal stage');
  }
};
```

**CONFIRM 5.5:**
- [ ] Kanban board renders all 7 columns with deals in the correct stage
- [ ] Each column shows deal count and total value
- [ ] Win probability bars are coloured correctly (green/amber/red)
- [ ] Dragging a card to another column calls the API and updates the DB
- [ ] Optimistic UI update makes the move feel instant (no loading state)
- [ ] Clicking a deal card navigates to its detail page

---

## Step 5.6 — Deal Detail Page

`DealDetail.jsx` — two-column layout:

**Left column (40%):**
- Deal title (editable inline)
- Value (large, currency-formatted)
- Stage selector dropdown — on change, immediately calls `PATCH /api/deals/:id/stage`
- Stage change mini-timeline (show previous stages with dates)
- Expected close date picker
- Linked contact card (avatar, name, company — clickable)
- Owner selector
- File attachments section (upload/download list)

**Right column (60%):**
- `DealSummaryPanel` at top (see AI components section)
- Win probability gauge: large circular chart using Recharts `RadialBarChart`
- `NextActionCard` (next best action recommendation)
- Activity timeline (same as contact activities tab)
- Notes section (free text, auto-save)

**CONFIRM 5.6:**
- [ ] Deal detail page loads for any deal ID
- [ ] Stage dropdown updates the deal stage in DB when changed
- [ ] Win probability gauge shows the correct percentage
- [ ] Activity timeline shows activities linked to this deal

---

## Step 5.7 — Activities Page

`Activities.jsx` — full-page activity feed with filters.

**Layout:**
- Left filter panel (fixed 260px): Type checkboxes (Call, Email, Meeting, Note, Transcript), Date range pickers, Contact search autocomplete, Rep dropdown
- Main area: paginated chronological feed + "Log Activity" FAB button

**Activity feed item** must show:
- Type icon (phone=call, mail=email, users=meeting, file-text=note, mic=transcript) in a coloured circle
- Contact name (clickable link)
- Deal name if linked (clickable link)
- Notes excerpt (max 2 lines, truncated)
- Sentiment badge if present (green/amber/red dot)
- Rep avatar + name
- Relative timestamp (e.g., "2 hours ago", "3 days ago")
- If type=TRANSCRIPT: expandable section showing structured summary

**Log Activity Modal** must have:
- Type selector (radio buttons with icons)
- Contact search (autocomplete calling `/api/contacts?search=...`)
- Deal search (optional autocomplete)
- Date/time picker
- Duration input (shown only when type=CALL)
- Notes textarea
- Audio file upload (shown when type=CALL — triggers transcription pipeline)

When audio file is uploaded and "Transcribe" is clicked:
1. Show loading spinner
2. Call `POST /api/activities/upload-audio` with the file
3. On response: populate the notes field with the AI summary
4. Show expandable "Full Transcript" section

**CONFIRM 5.7:**
- [ ] Activities page shows paginated feed with all activity types
- [ ] Type filter checkboxes filter the list correctly
- [ ] Log Activity modal opens and submits successfully
- [ ] New activity appears in the feed after creation (React Query invalidation)
- [ ] Sentiment badges appear on activities that have sentiment data

---

## Step 5.8 — Tasks Page

`Tasks.jsx` — two views toggled by tabs.

**My Tasks tab:**
- Grouped sections: Overdue (red background), Due Today (amber), This Week, Later, Completed (collapsed by default)
- Each task row: checkbox (click to complete — optimistic update), task title, contact/deal chip (clickable), due date, priority badge (HIGH=red, MEDIUM=amber, LOW=gray)
- Overdue tasks: entire row has `bg-red-50` background, date shown in red
- "Add Task" FAB button (bottom-right, fixed position)

**All Tasks tab** (admin only — hide if user.role !== 'ADMIN'):
- Same as My Tasks but shows tasks for all users
- Sortable table view instead of grouped view

**Add Task quick-form:**
- Opens as a modal
- Fields: title, due date, priority, contact (autocomplete), deal (autocomplete), assignee (user list)

**CONFIRM 5.8:**
- [ ] Tasks are grouped correctly by due date category
- [ ] Overdue tasks show with red background
- [ ] Clicking a checkbox completes the task (optimistic update — checkbox ticks immediately)
- [ ] Add Task modal submits and new task appears in the list

---

## Step 5.9 — Analytics Page

`Analytics.jsx` — data-heavy dashboard with 6 charts.

**Date range filter** at the top: 30d | 90d | 6mo | 1yr | Custom. Changes the `dateRange` state which re-fetches all charts.

**Chart 1 — Revenue (full width):**
`ComposedChart` showing historical actual revenue + Prophet 90-day forecast:
- Historical: `Area` fill with `stroke="#4f46e5"`, `fill="#e0e7ff"`
- Forecast: `Line` dashed `strokeDasharray="5 5"` with `stroke="#a78bfa"`
- Confidence band: second `Area` between yhat_lower and yhat_upper, semi-transparent

**Chart 2 — Pipeline Funnel (left half):**
`FunnelChart` from Recharts showing deal count per stage, top to bottom.

**Chart 3 — Win/Loss (right half):**
`PieChart` with two slices: green for won, red for lost. Show percentage in centre using a custom label.

**Chart 4 — Rep Performance (full width):**
`BarChart` grouped: each rep has two bars — deals closed count (left) and revenue (right). X-axis shows rep name.

**Chart 5 — Sentiment Trends (left half):**
`LineChart` showing average weekly sentiment score over past 12 weeks. Y-axis 0–1, reference line at 0.5.

**Chart 6 — Lead Sources (right half):**
`PieChart` based on contact tags breakdown.

All charts must:
- Use `ResponsiveContainer` so they fill their parent
- Show `Skeleton` while loading
- Show `EmptyState` if no data available
- Have proper axis labels and tooltips

**CONFIRM 5.9:**
- [ ] All 6 charts render with real data from the seed database
- [ ] Date range filter re-fetches and updates all charts
- [ ] Revenue chart shows both historical and forecast lines
- [ ] Charts are responsive and don't overflow their containers

---

## Step 5.10 — AI Assistant Page

`AIAssistant.jsx` — full-page RAG chat interface.

**Layout:**
- Left sidebar (25%, min-width 200px): "New Chat" button, conversation history list (stored in local state for now), suggested question chips
- Main chat area (75%): messages list + input bar fixed at bottom

**Suggested questions** (shown when chat is empty):
```
"Which deals are at risk this week?"
"Summarise my pipeline"
"Who are my hottest leads?"
"Which contacts haven't been contacted in 30 days?"
"What was the outcome of my last call with Acme?"
```

**Chat message component:**
- User message: right-aligned, indigo background
- AI message: left-aligned, white card with shadow
- AI message must show: response text (rendered as markdown), sources chips below (`[Contact: John Smith]`, `[Deal: SaaS Deal]` etc.), each chip is a clickable link

**Streaming:** Use the `EventSource` API to stream responses:
```javascript
const sendMessage = (question) => {
  setMessages(prev => [...prev, { role: 'user', content: question }]);
  setStreaming(true);
  const currentAnswer = { role: 'assistant', content: '', sources: [] };
  setMessages(prev => [...prev, currentAnswer]);

  const url = `${import.meta.env.VITE_API_URL}/api/ai/chat?question=${encodeURIComponent(question)}`;
  const source = new EventSource(url);

  source.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.done) {
      setMessages(prev => {
        const msgs = [...prev];
        msgs[msgs.length - 1].sources = data.sources || [];
        return msgs;
      });
      source.close();
      setStreaming(false);
      return;
    }
    setMessages(prev => {
      const msgs = [...prev];
      msgs[msgs.length - 1].content += data.text;
      return msgs;
    });
  };

  source.onerror = () => { source.close(); setStreaming(false); };
};
```

**CONFIRM 5.10:**
- [ ] AI Assistant page renders with the two-panel layout
- [ ] Suggested questions appear as clickable chips when the chat is empty
- [ ] Clicking a suggestion sends it as a message
- [ ] AI response streams in character by character (test once AI is connected — stub for now)
- [ ] Sources chips appear below each AI response

---

## Step 5.11 — Settings Pages

**GeneralSettings.jsx:**
- Company info form: Company name input, logo upload (image preview)
- Pipeline stages editor: editable list showing all stages. Each stage has a text input and delete button. Drag to reorder. "Save Stages" button.
- Custom fields section: table listing custom field name, type, target (Contact/Deal), delete button. "Add Field" inline form.
- Tags manager: chip display of all tags, delete button on each, "Add tag" text input.

**UsersSettings.jsx:**
- Users table: Avatar, Name, Email, Role (dropdown — ADMIN/SALES_REP), Last login, Active toggle, Actions
- "Invite User" button opens a modal with email input. On submit: call a server endpoint that creates a pending user (or sends an email — stub the email for now)
- Role change saves immediately via `PATCH /api/users/:id`

**IntegrationsSettings.jsx:**
- Integration cards for: Anthropic API, OpenAI API, Clearbit API, SMTP Email
- Each card: logo placeholder, name, description, status badge (Connected/Not configured), API key input (masked with show/hide toggle), "Test Connection" button, "Save" button
- Test Connection button calls `POST /api/settings/test-integration` with the integration name

**CONFIRM 5.11:**
- [ ] All three settings pages render without errors
- [ ] General settings form saves company name
- [ ] Users table loads and shows all 4 seed users
- [ ] Integration cards show status and allow key input

---

# PHASE 6 — PYTHON ML SERVICE

## Step 6.1 — Flask app setup

Create `ml-service/app.py`:

```python
from flask import Flask
from flask_cors import CORS
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

# Register blueprints
from routes.sentiment import sentiment_bp
from routes.predict import predict_bp
from routes.forecast import forecast_bp
from routes.rag import rag_bp
from routes.transcribe import transcribe_bp

app.register_blueprint(sentiment_bp, url_prefix='/sentiment')
app.register_blueprint(predict_bp,   url_prefix='/predict')
app.register_blueprint(forecast_bp,  url_prefix='/forecast')
app.register_blueprint(rag_bp,       url_prefix='/rag')
app.register_blueprint(transcribe_bp, url_prefix='/transcribe')

@app.route('/health')
def health():
    return {'status': 'ok', 'service': 'leadpulse-ml'}

if __name__ == '__main__':
    port = int(os.getenv('FLASK_PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=os.getenv('FLASK_ENV') == 'development')
```

**CONFIRM 6.1:**
- [ ] `python app.py` starts without errors
- [ ] `GET http://localhost:5001/health` returns `{ status: 'ok' }`

---

## Step 6.2 — Sentiment Analysis endpoint

Create `ml-service/routes/sentiment.py`:

```python
from flask import Blueprint, request, jsonify
from transformers import pipeline
import os

sentiment_bp = Blueprint('sentiment', __name__)

# Load model once at startup (not per request)
print("Loading sentiment model...")
classifier = pipeline(
    'sentiment-analysis',
    model='distilbert-base-uncased-finetuned-sst-2-english',
    device=-1  # Use CPU; change to 0 for GPU
)
print("Sentiment model loaded ✓")

def map_sentiment(label, score):
    """Convert HuggingFace output to Leadpulse sentiment label."""
    positive_score = score if label == 'POSITIVE' else 1 - score
    if positive_score > 0.75:   return 'POSITIVE', positive_score
    if positive_score > 0.45:   return 'NEUTRAL',  positive_score
    if positive_score > 0.20:   return 'NEGATIVE', positive_score
    return 'AT_RISK', positive_score

@sentiment_bp.route('/analyze', methods=['POST'])
def analyze():
    data = request.get_json()
    text = data.get('text', '').strip()

    if not text:
        return jsonify({'error': 'No text provided'}), 400

    # Truncate to 512 chars to avoid token limit issues
    result = classifier(text[:512])[0]
    mapped_label, mapped_score = map_sentiment(result['label'], result['score'])

    return jsonify({
        'raw_label': result['label'],
        'raw_score': result['score'],
        'mapped_sentiment': mapped_label,
        'score': mapped_score,
    })
```

**CONFIRM 6.2:**
- [ ] `POST http://localhost:5001/sentiment/analyze` with `{"text": "This customer is very happy!"}` returns `{ mapped_sentiment: "POSITIVE", score: 0.9+ }`
- [ ] Test with negative text: `{"text": "Very disappointed with the service, no support."}` → returns `NEGATIVE` or `AT_RISK`
- [ ] Model loads only once on startup (not on every request)

---

## Step 6.3 — Prediction endpoints (Churn + Win Probability)

First, train the models. Create `ml-service/train.py`:

```python
"""
Train churn and win probability models from Leadpulse database seed data.
Run this AFTER seeding the database: python train.py
"""
import os
import psycopg2
import pandas as pd
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report
import xgboost as xgb
import joblib
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

print("Connecting to database...")
conn = psycopg2.connect(os.getenv('DATABASE_URL'))

# ── CHURN MODEL ──────────────────────────────────────────────────────────────

print("Extracting contact features for churn model...")
contacts_df = pd.read_sql("""
    SELECT
        c.id,
        c.status,
        c.sentiment_score,
        c.lead_score,
        COALESCE(EXTRACT(DAY FROM NOW() - MAX(a.occurred_at)), 999) AS days_since_last_contact,
        COUNT(CASE WHEN a.occurred_at > NOW() - INTERVAL '30 days' THEN 1 END) AS activity_last_30,
        COUNT(CASE WHEN a.occurred_at > NOW() - INTERVAL '90 days' THEN 1 END) AS activity_last_90,
        COUNT(DISTINCT d.id) AS deal_count,
        COALESCE(SUM(CAST(d.value AS FLOAT)), 0) AS total_deal_value,
        CASE WHEN EXISTS (
            SELECT 1 FROM deals d2
            WHERE d2.contact_id = c.id
            AND d2.stage NOT IN ('CLOSED_WON', 'CLOSED_LOST')
        ) THEN 1 ELSE 0 END AS has_open_deal
    FROM contacts c
    LEFT JOIN activities a ON a.contact_id = c.id
    LEFT JOIN deals d ON d.contact_id = c.id
    WHERE c.status IN ('ACTIVE', 'CHURNED', 'INACTIVE')
    GROUP BY c.id, c.status, c.sentiment_score, c.lead_score
""", conn)

contacts_df['churned'] = (contacts_df['status'] == 'CHURNED').astype(int)

features = ['days_since_last_contact','activity_last_30','activity_last_90',
            'sentiment_score','lead_score','deal_count','total_deal_value','has_open_deal']

X = contacts_df[features].fillna(0).values
y = contacts_df['churned'].values

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

scaler = StandardScaler()
X_train_s = scaler.fit_transform(X_train)
X_test_s  = scaler.transform(X_test)

churn_model = LogisticRegression(random_state=42, max_iter=1000, class_weight='balanced')
churn_model.fit(X_train_s, y_train)

print(f"Churn model accuracy: {churn_model.score(X_test_s, y_test):.2%}")
print(classification_report(y_test, churn_model.predict(X_test_s)))

joblib.dump(churn_model, 'models/churn_model.pkl')
joblib.dump(scaler,      'models/churn_scaler.pkl')
print("✓ Churn model saved")

# ── WIN PROBABILITY MODEL ─────────────────────────────────────────────────────

print("Extracting deal features for win probability model...")

stage_map = {'LEAD':0,'CONTACTED':1,'DEMO':2,'PROPOSAL':3,'NEGOTIATION':4,'CLOSED_WON':5,'CLOSED_LOST':5}

deals_df = pd.read_sql("""
    SELECT
        d.id,
        d.stage,
        CAST(d.value AS FLOAT) AS value,
        COALESCE(EXTRACT(DAY FROM NOW() - d.updated_at), 0) AS days_in_stage,
        COUNT(a.id) AS total_activities,
        COUNT(CASE WHEN a.occurred_at > NOW() - INTERVAL '7 days' THEN 1 END) AS activity_last_7,
        COALESCE(c.size, 50) AS company_size
    FROM deals d
    LEFT JOIN activities a ON a.deal_id = d.id
    LEFT JOIN contacts co ON co.id = d.contact_id
    LEFT JOIN companies c ON c.id = co.company_id
    WHERE d.stage IN ('CLOSED_WON', 'CLOSED_LOST')
    GROUP BY d.id, d.stage, d.value, d.updated_at, c.size
""", conn)

deals_df['won'] = (deals_df['stage'] == 'CLOSED_WON').astype(int)
deals_df['stage_num'] = deals_df['stage'].map(stage_map).fillna(0)

deal_features = ['stage_num','value','days_in_stage','total_activities','activity_last_7','company_size']
X_d = deals_df[deal_features].fillna(0).values
y_d = deals_df['won'].values

if len(X_d) > 10:
    X_tr, X_te, y_tr, y_te = train_test_split(X_d, y_d, test_size=0.2, random_state=42)
    win_model = xgb.XGBClassifier(n_estimators=100, max_depth=4, random_state=42,
                                   use_label_encoder=False, eval_metric='logloss')
    win_model.fit(X_tr, y_tr)
    print(f"Win probability model accuracy: {win_model.score(X_te, y_te):.2%}")
    joblib.dump(win_model, 'models/win_prob_model.pkl')
    print("✓ Win probability model saved")
else:
    print("⚠ Not enough closed deals to train win model — creating dummy model")
    # Create a simple default
    win_model = xgb.XGBClassifier(n_estimators=1, random_state=42)
    win_model.fit([[0,0,0,0,0,0]], [0])
    joblib.dump(win_model, 'models/win_prob_model.pkl')

conn.close()
print("\n✅ All models trained and saved!")
```

Run: `python train.py`

Create `ml-service/routes/predict.py`:

```python
from flask import Blueprint, request, jsonify
import joblib, numpy as np, os

predict_bp = Blueprint('predict', __name__)

# Load models at startup
churn_model  = joblib.load('models/churn_model.pkl')
churn_scaler = joblib.load('models/churn_scaler.pkl')
win_model    = joblib.load('models/win_prob_model.pkl')

@predict_bp.route('/churn', methods=['POST'])
def predict_churn():
    try:
        features = np.array(request.json['features'], dtype=float).reshape(1, -1)
        scaled = churn_scaler.transform(features)
        risk = float(churn_model.predict_proba(scaled)[0][1])
        return jsonify({'risk': round(risk, 4)})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@predict_bp.route('/win_prob', methods=['POST'])
def predict_win():
    try:
        features = np.array(request.json['features'], dtype=float).reshape(1, -1)
        prob = float(win_model.predict_proba(features)[0][1])
        return jsonify({'probability': round(prob, 4)})
    except Exception as e:
        return jsonify({'error': str(e)}), 400
```

**CONFIRM 6.3:**
- [ ] `python train.py` runs without errors and creates `models/churn_model.pkl` and `models/win_prob_model.pkl`
- [ ] Restart Flask — models load without errors
- [ ] `POST /predict/churn` with `{"features": [30, 2, 5, 0.5, 40, 2, 50000, 1]}` returns `{ risk: 0.xxxx }` between 0 and 1
- [ ] `POST /predict/win_prob` with `{"features": [3, 50000, 7, 10, 3, 100]}` returns `{ probability: 0.xxxx }` between 0 and 1

---

## Step 6.4 — Sales Forecasting (Prophet)

Create `ml-service/routes/forecast.py`:

```python
from flask import Blueprint, request, jsonify
from prophet import Prophet
import pandas as pd
import warnings
warnings.filterwarnings('ignore')

forecast_bp = Blueprint('forecast', __name__)

@forecast_bp.route('/revenue', methods=['POST'])
def revenue():
    try:
        data = request.get_json()
        historical = data.get('historical', [])

        if len(historical) < 2:
            return jsonify({'forecast': [], 'error': 'Not enough historical data (need at least 2 months)'}), 200

        df = pd.DataFrame(historical)
        df['ds'] = pd.to_datetime(df['ds'])
        df['y']  = pd.to_numeric(df['y'], errors='coerce').fillna(0)

        model = Prophet(
            interval_width=0.80,
            yearly_seasonality=True,
            weekly_seasonality=False,
            daily_seasonality=False,
        )
        model.fit(df)

        future   = model.make_future_dataframe(periods=90, freq='D')
        forecast = model.predict(future)

        # Return only the forecast portion (future 90 days)
        future_forecast = forecast[forecast['ds'] > df['ds'].max()][['ds','yhat','yhat_lower','yhat_upper']]
        future_forecast['ds'] = future_forecast['ds'].dt.strftime('%Y-%m-%d')
        future_forecast['yhat']       = future_forecast['yhat'].clip(lower=0).round(2)
        future_forecast['yhat_lower'] = future_forecast['yhat_lower'].clip(lower=0).round(2)
        future_forecast['yhat_upper'] = future_forecast['yhat_upper'].clip(lower=0).round(2)

        return jsonify({'forecast': future_forecast.to_dict(orient='records')})

    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

Update the `GET /api/analytics/revenue` server endpoint to also call the forecast:

```javascript
// In server/src/controllers/analytics.controller.js — revenue endpoint:
exports.revenue = async (req, res, next) => {
  try {
    const deals = await prisma.deal.findMany({
      where: { stage: 'CLOSED_WON' },
      select: { value: true, createdAt: true }
    });

    const monthly = {};
    deals.forEach(d => {
      const key = d.createdAt.toISOString().slice(0, 7);
      monthly[key] = (monthly[key] || 0) + Number(d.value);
    });

    const historical = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ds, y]) => ({ ds: ds + '-01', y }));

    // Call ML service for forecast
    let forecast = [];
    try {
      const mlRes = await axios.post(`${process.env.ML_SERVICE_URL}/forecast/revenue`, { historical });
      forecast = mlRes.data.forecast || [];
    } catch (e) {
      console.warn('Forecast unavailable:', e.message);
    }

    res.json({ historical, forecast });
  } catch (err) { next(err); }
};
```

**CONFIRM 6.4:**
- [ ] `POST /forecast/revenue` with at least 2 months of historical data returns 90 days of forecast data
- [ ] `GET /api/analytics/revenue` now returns both `historical` and `forecast` arrays
- [ ] Analytics page revenue chart shows the dashed forecast line extending 90 days

---

## Step 6.5 — RAG Pipeline (Embeddings + Chat)

Create `ml-service/services/embedding_service.py`:

```python
from openai import OpenAI
import os

_client = None

def get_client():
    global _client
    if not _client:
        _client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
    return _client

def embed_text(text: str) -> list:
    """Generate a 1536-dim embedding vector for the given text."""
    client = get_client()
    response = client.embeddings.create(
        model='text-embedding-3-small',
        input=text[:8000],  # Truncate to stay within token limits
    )
    return response.data[0].embedding
```

Create `ml-service/services/vector_store.py`:

```python
import psycopg2
from pgvector.psycopg2 import register_vector
import numpy as np
import os

def get_connection():
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    register_vector(conn)
    return conn

def upsert_embedding(record_type: str, record_id: str, content: str, vector: list):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO embeddings (id, record_type, record_id, content, vector, created_at, updated_at)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, NOW(), NOW())
                ON CONFLICT (record_type, record_id)
                DO UPDATE SET content = EXCLUDED.content, vector = EXCLUDED.vector, updated_at = NOW()
            """, (record_type, record_id, content, np.array(vector)))
        conn.commit()
    finally:
        conn.close()

def search_similar(query_vector: list, limit: int = 5) -> list:
    """Return top-k records most similar to the query vector."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT record_type, record_id, content,
                       1 - (vector <=> %s::vector) AS similarity
                FROM embeddings
                ORDER BY vector <=> %s::vector
                LIMIT %s
            """, (np.array(query_vector), np.array(query_vector), limit))
            rows = cur.fetchall()
            return [{'type': r[0], 'id': r[1], 'content': r[2], 'similarity': float(r[3])} for r in rows]
    finally:
        conn.close()
```

Create an indexing script `ml-service/services/indexer.py` that:
1. Fetches all contacts, deals, and activities from the DB
2. Converts each to a descriptive text chunk
3. Embeds each chunk
4. Upserts into the embeddings table

```python
import psycopg2
import os
from embedding_service import embed_text
from vector_store import upsert_embedding
from dotenv import load_dotenv

load_dotenv()

def contact_to_text(row) -> str:
    return f"""Contact: {row[1]} {row[2]}
Email: {row[3]}
Title: {row[4] or 'Unknown'}
Status: {row[5]}
Lead Score: {row[6]} ({row[7] or 'unscored'})
Churn Risk: {int((row[8] or 0) * 100)}%
Tags: {', '.join(row[9] or [])}"""

def deal_to_text(row) -> str:
    return f"""Deal: {row[1]}
Value: ${int(row[2]):,}
Stage: {row[3]}
Win Probability: {int((row[4] or 0) * 100)}%
Contact: {row[5]}"""

def activity_to_text(row) -> str:
    return f"""Activity ({row[1]}): {row[2] or ''}
Contact: {row[3]}
Notes: {row[4] or 'No notes'}
Sentiment: {row[5] or 'Unknown'}
Date: {str(row[6])[:10]}"""

def run_indexing():
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor()

    print("Indexing contacts...")
    cur.execute("SELECT id, first_name, last_name, email, title, status, lead_score, lead_score_label, churn_risk, tags FROM contacts LIMIT 500")
    for row in cur.fetchall():
        text = contact_to_text(row)
        vector = embed_text(text)
        upsert_embedding('contact', str(row[0]), text, vector)
    print(f"  ✓ Contacts indexed")

    print("Indexing deals...")
    cur.execute("""
        SELECT d.id, d.title, d.value, d.stage, d.win_probability,
               CONCAT(c.first_name, ' ', c.last_name)
        FROM deals d JOIN contacts c ON c.id = d.contact_id LIMIT 200
    """)
    for row in cur.fetchall():
        text = deal_to_text(row)
        vector = embed_text(text)
        upsert_embedding('deal', str(row[0]), text, vector)
    print(f"  ✓ Deals indexed")

    print("Indexing activities...")
    cur.execute("""
        SELECT a.id, a.type, a.subject, CONCAT(c.first_name, ' ', c.last_name),
               a.notes, a.sentiment, a.occurred_at
        FROM activities a JOIN contacts c ON c.id = a.contact_id
        WHERE a.notes IS NOT NULL LIMIT 500
    """)
    for row in cur.fetchall():
        text = activity_to_text(row)
        vector = embed_text(text)
        upsert_embedding('activity', str(row[0]), text, vector)
    print(f"  ✓ Activities indexed")

    conn.close()
    print("\n✅ Indexing complete!")

if __name__ == '__main__':
    run_indexing()
```

Run indexing: `python services/indexer.py`

Create `ml-service/services/claude_service.py`:

```python
import anthropic
import os

_client = None

def get_client():
    global _client
    if not _client:
        _client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
    return _client

def stream_rag_answer(question: str, context: str, history: list = []) -> str:
    """Stream a RAG-grounded answer from Claude."""
    client = get_client()

    system = """You are Leadpulse's AI CRM assistant. You answer questions about the user's CRM data.
RULES:
1. Answer ONLY from the provided CRM data context below.
2. If the answer is not in the context, say: "I don't have that information in your CRM data."
3. Be concise and specific. Reference contact names, deal titles, and actual values.
4. Never invent or hallucinate CRM data."""

    user_content = f"""CRM Data Context:
{context}

Question: {question}"""

    messages = []
    for h in history[-6:]:  # Include last 6 messages for context
        messages.append({'role': h['role'], 'content': h['content']})
    messages.append({'role': 'user', 'content': user_content})

    with client.messages.stream(
        model='claude-sonnet-4-20250514',
        max_tokens=800,
        system=system,
        messages=messages,
    ) as stream:
        for text in stream.text_stream:
            yield text
```

Create `ml-service/routes/rag.py`:

```python
from flask import Blueprint, request, jsonify, Response, stream_with_context
from services.embedding_service import embed_text
from services.vector_store import search_similar
from services.claude_service import stream_rag_answer
import json

rag_bp = Blueprint('rag', __name__)

@rag_bp.route('/query', methods=['GET'])
def query():
    question = request.args.get('question', '').strip()
    history_raw = request.args.get('history', '[]')

    if not question:
        return jsonify({'error': 'No question provided'}), 400

    try:
        history = json.loads(history_raw)
    except:
        history = []

    query_vector = embed_text(question)
    results = search_similar(query_vector, limit=5)

    if not results:
        def empty_gen():
            yield f"data: {json.dumps({'text': 'I could not find any relevant CRM data for your question.'})}\n\n"
            yield f"data: {json.dumps({'done': True, 'sources': []})}\n\n"
        return Response(stream_with_context(empty_gen()), content_type='text/event-stream')

    context = '\n\n---\n\n'.join([
        f"[{r['type'].upper()} {r['id'][:8]}]\n{r['content']}"
        for r in results
    ])
    sources = [{'type': r['type'], 'id': r['id']} for r in results]

    def generate():
        try:
            for chunk in stream_rag_answer(question, context, history):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
            yield f"data: {json.dumps({'done': True, 'sources': sources})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e), 'done': True, 'sources': []})}\n\n"

    return Response(stream_with_context(generate()), content_type='text/event-stream')

@rag_bp.route('/index', methods=['POST'])
def index():
    """Trigger re-indexing of all CRM data."""
    try:
        from services.indexer import run_indexing
        run_indexing()
        return jsonify({'message': 'Indexing complete'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

The server's `ai.routes.js` → `chat` endpoint must proxy to the ML service and forward the SSE stream:

```javascript
// In server/src/controllers/ai.controller.js:
exports.chat = async (req, res) => {
  const question = req.query.question || '';
  const history = req.query.history || '[]';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_URL);

  try {
    const response = await require('axios')({
      method: 'GET',
      url: `${process.env.ML_SERVICE_URL}/rag/query`,
      params: { question, history },
      responseType: 'stream',
    });
    response.data.pipe(res);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: 'AI service unavailable', done: true, sources: [] })}\n\n`);
    res.end();
  }
};
```

**CONFIRM 6.5:**
- [ ] `python services/indexer.py` runs and populates the `embeddings` table (check with `SELECT COUNT(*) FROM embeddings;`)
- [ ] `GET /rag/query?question=Who+are+my+hot+leads` returns SSE events with text chunks
- [ ] Server `/api/ai/chat?question=...` proxies the stream correctly
- [ ] AI Assistant page receives the streamed response and shows sources chips

---

## Step 6.6 — Voice Transcription endpoint

Create `ml-service/routes/transcribe.py`:

```python
from flask import Blueprint, request, jsonify
from openai import OpenAI
import anthropic, json, os, tempfile

transcribe_bp = Blueprint('transcribe', __name__)

@transcribe_bp.route('/', methods=['POST'])
def transcribe():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio']

    try:
        # Step 1: Save to temp file (Whisper needs a file path or file object)
        with tempfile.NamedTemporaryFile(suffix=f'.{audio_file.filename.split(".")[-1]}', delete=False) as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name

        # Step 2: Transcribe with Whisper
        openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
        with open(tmp_path, 'rb') as f:
            transcript = openai_client.audio.transcriptions.create(
                model='whisper-1',
                file=f,
                language='en'
            )
        os.unlink(tmp_path)  # Clean up temp file

        # Step 3: Extract structured data with Claude
        claude_client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
        extraction = claude_client.messages.create(
            model='claude-sonnet-4-20250514',
            max_tokens=1000,
            system='You extract structured sales call data. Reply with valid JSON only, no markdown.',
            messages=[{
                'role': 'user',
                'content': f"""Extract from this sales call transcript:
{{
  "summary": "3-sentence summary of the call",
  "actionItems": ["list", "of", "action", "items"],
  "sentiment": "POSITIVE | NEUTRAL | NEGATIVE",
  "pricingMentions": ["any pricing or budget figures mentioned"],
  "objections": ["any customer objections raised"],
  "nextSteps": "agreed next step if any"
}}

Transcript:
{transcript.text}"""
            }]
        )

        extracted = json.loads(extraction.content[0].text)
        extracted['transcript'] = transcript.text

        return jsonify(extracted)

    except json.JSONDecodeError:
        return jsonify({'transcript': transcript.text, 'summary': 'Could not parse extraction', 'actionItems': [], 'sentiment': 'NEUTRAL', 'pricingMentions': [], 'objections': [], 'nextSteps': ''})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

In the Node.js server, implement `POST /api/activities/upload-audio`:

```javascript
// In activities.routes.js — add multer for audio:
const multer = require('multer');
const upload = multer({
  dest: 'uploads/audio/',
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg','audio/wav','audio/mp4','audio/webm','audio/ogg'];
    cb(null, allowed.includes(file.mimetype));
  }
});

router.post('/upload-audio', auth, upload.single('audio'), ctrl.uploadAudio);
```

```javascript
// In activities.controller.js:
exports.uploadAudio = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });

    const FormData = require('form-data');
    const fs = require('fs');
    const form = new FormData();
    form.append('audio', fs.createReadStream(req.file.path), {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const mlRes = await axios.post(`${process.env.ML_SERVICE_URL}/transcribe/`, form, {
      headers: form.getHeaders(),
      timeout: 120000, // 2 minute timeout for long recordings
    });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    // Create activity record
    const { contactId, dealId } = req.body;
    const extraction = mlRes.data;

    const activity = await prisma.activity.create({
      data: {
        type: 'TRANSCRIPT',
        notes: extraction.summary,
        transcript: extraction.transcript,
        sentiment: extraction.sentiment || 'NEUTRAL',
        metadata: extraction,
        contactId,
        dealId: dealId || null,
        userId: req.user.id,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        user: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    res.json({ activity, extraction });
  } catch (err) { next(err); }
};
```

**CONFIRM 6.6:**
- [ ] Upload a short `.mp3` or `.wav` audio file via Postman to `POST /api/activities/upload-audio` with `contactId`
- [ ] Response contains `{ activity: {...}, extraction: { summary, actionItems, sentiment, transcript } }`
- [ ] The activity appears in the DB with `type=TRANSCRIPT` and the transcript text
- [ ] Audio upload in the Log Activity modal triggers the transcription flow

---

# PHASE 7 — BACKEND: AI FEATURES (CLAUDE API)

## Step 7.1 — Create claude.service.js

Create `server/src/services/claude.service.js`:

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const { PrismaClient } = require('@prisma/client');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const prisma = new PrismaClient();

/**
 * Stream a Claude response as SSE to the HTTP response object.
 * Sets required headers automatically.
 */
async function streamResponse(prompt, systemPrompt = '', res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_URL || '*');
  res.flushHeaders();

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1200,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
    }
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * Get a structured JSON response from Claude.
 * System prompt must instruct Claude to return JSON only.
 */
async function getJSON(prompt, systemPrompt = '') {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    system: systemPrompt + ' IMPORTANT: Reply with valid JSON only. No markdown fences, no explanation, no preamble.',
    messages: [{ role: 'user', content: prompt }],
  });
  const text = message.content[0].text.trim();
  return JSON.parse(text);
}

/**
 * Get a plain text response from Claude (non-streaming).
 */
async function getText(prompt, systemPrompt = '') {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });
  return message.content[0].text;
}

/**
 * Log an AI feature call to the database for monitoring.
 */
async function logAICall(feature, userId, input, output, tokensUsed = 0, contactId = null, dealId = null) {
  try {
    await prisma.aiLog.create({
      data: { feature, userId, input, output: { result: output }, tokensUsed, contactId, dealId }
    });
  } catch (e) {
    console.error('Failed to log AI call:', e.message);
  }
}

module.exports = { streamResponse, getJSON, getText, logAICall };
```

**CONFIRM 7.1:**
- [ ] `claude.service.js` exists with all 4 exported functions
- [ ] Verify `ANTHROPIC_API_KEY` is set in `.env`

---

## Step 7.2 — AI Feature 1: Email Composer

Replace the stub `composeEmail` in `ai.controller.js`:

```javascript
exports.composeEmail = async (req, res, next) => {
  try {
    const { contactId, dealId, bulletPoints } = req.body;

    if (!bulletPoints || !bulletPoints.length) {
      return res.status(400).json({ error: 'Bullet points are required' });
    }

    // Fetch contact context
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: { company: true, deals: { take: 1, orderBy: { createdAt: 'desc' } } }
    });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const deal = contact.deals[0];
    const systemPrompt = `You are a professional sales representative writing on behalf of a sales team.
Write concise, warm, and professional sales emails.
Always include a specific subject line on the first line as "Subject: [subject here]".
Then leave a blank line and write the email body.
Use the contact's first name. Keep emails under 200 words.`;

    const prompt = `Write a sales email to ${contact.firstName} ${contact.lastName} (${contact.title || 'decision maker'} at ${contact.company?.name || 'their company'}).

Current deal stage: ${deal?.stage || 'LEAD'}
Deal value: $${deal ? Number(deal.value).toLocaleString() : 'TBD'}

Key points to cover:
${bulletPoints.map((b, i) => `${i + 1}. ${b}`).join('\n')}

Write a compelling, personalized email addressing all the above points.`;

    // Log async, don't block response
    setImmediate(() => logAICall('email_composer', req.user.id, { contactId, dealId, bulletPoints }, {}, 0, contactId, dealId));

    await streamResponse(prompt, systemPrompt, res);
  } catch (err) {
    if (!res.headersSent) next(err);
  }
};
```

In `client/src/components/ai/EmailComposer.jsx`:

```jsx
import { useState, useRef } from 'react';
import { Send, RefreshCw, Copy, Wand2 } from 'lucide-react';
import Button from '../ui/Button';
import toast from 'react-hot-toast';

export default function EmailComposer({ contactId, dealId, onEmailReady }) {
  const [bullets, setBullets] = useState('');
  const [generatedSubject, setGeneratedSubject] = useState('');
  const [generatedBody, setGeneratedBody] = useState('');
  const [streaming, setStreaming] = useState(false);
  const eventSourceRef = useRef(null);

  const generate = () => {
    const bulletList = bullets.split('\n').filter(b => b.trim());
    if (!bulletList.length) { toast.error('Add at least one bullet point'); return; }

    setGeneratedSubject('');
    setGeneratedBody('');
    setStreaming(true);

    // Close any existing stream
    if (eventSourceRef.current) eventSourceRef.current.close();

    // Use fetch with streaming instead of EventSource (POST method needed)
    fetch(`${import.meta.env.VITE_API_URL}/api/ai/compose-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('leadpulse-auth') ? JSON.parse(localStorage.getItem('leadpulse-auth')).state?.token : ''}`,
      },
      body: JSON.stringify({ contactId, dealId, bulletPoints: bulletList }),
    }).then(async (response) => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) { setStreaming(false); break; }
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
          const data = line.replace('data: ', '').trim();
          if (data === '[DONE]') { setStreaming(false); break; }
          try {
            const { text } = JSON.parse(data);
            fullText += text;
            // Parse subject from first line
            const lines = fullText.split('\n');
            const subjectLine = lines.find(l => l.startsWith('Subject:'));
            if (subjectLine) {
              setGeneratedSubject(subjectLine.replace('Subject:', '').trim());
              setGeneratedBody(lines.filter(l => !l.startsWith('Subject:')).join('\n').trim());
            } else {
              setGeneratedBody(fullText);
            }
          } catch {}
        }
      }
    }).catch(() => { setStreaming(false); toast.error('Failed to generate email'); });
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(`Subject: ${generatedSubject}\n\n${generatedBody}`);
    toast.success('Copied to clipboard!');
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Key points to cover (one per line)
        </label>
        <textarea
          value={bullets}
          onChange={e => setBullets(e.target.value)}
          placeholder={"Follow up on demo from last week\nAddress pricing concern\nPropose next meeting date"}
          rows={5}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      <Button onClick={generate} loading={streaming} className="w-full">
        <Wand2 size={16} className="mr-2" />
        {streaming ? 'Generating...' : 'Generate Email'}
      </Button>

      {(generatedSubject || generatedBody) && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex justify-between items-center">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Generated Email</span>
            <div className="flex gap-2">
              <button onClick={copyToClipboard} className="text-gray-400 hover:text-gray-600 text-xs flex items-center gap-1">
                <Copy size={12} /> Copy
              </button>
              <button onClick={generate} className="text-gray-400 hover:text-gray-600 text-xs flex items-center gap-1">
                <RefreshCw size={12} /> Regenerate
              </button>
            </div>
          </div>
          {generatedSubject && (
            <div className="px-4 py-2 bg-white border-b border-gray-100">
              <span className="text-xs text-gray-500 mr-2">Subject:</span>
              <span className="text-sm font-medium text-gray-900">{generatedSubject}</span>
            </div>
          )}
          <div className="px-4 py-3 bg-white">
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">{generatedBody}</pre>
          </div>
          {onEmailReady && generatedBody && (
            <div className="px-4 py-3 border-t border-gray-100">
              <Button onClick={() => onEmailReady(generatedSubject, generatedBody)} variant="primary" size="sm" className="w-full">
                Use This Email
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

**CONFIRM 7.2:**
- [ ] Open a Contact Detail page → Emails tab → click Compose
- [ ] Enter 2–3 bullet points and click Generate
- [ ] Email text streams in progressively (you see it typing)
- [ ] Subject line is parsed and shown separately
- [ ] "Regenerate" button generates a different version
- [ ] "Copy" button copies the full email to clipboard

---

## Step 7.3 — AI Feature 3: Deal Summary (streaming)

Replace `dealSummary` stub in `ai.controller.js`:

```javascript
exports.dealSummary = async (req, res, next) => {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.id },
      include: {
        contact: { include: { company: true } },
        owner: { select: { firstName: true, lastName: true } },
        activities: { orderBy: { occurredAt: 'desc' }, take: 10,
          include: { user: { select: { firstName: true, lastName: true } } } },
      }
    });
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const activitySummary = deal.activities.map(a =>
      `- ${a.type} on ${new Date(a.occurredAt).toDateString()} (${a.user.firstName}): ${a.notes?.slice(0, 150) || 'No notes'}`
    ).join('\n');

    const prompt = `
Deal: ${deal.title}
Value: $${Number(deal.value).toLocaleString()}
Stage: ${deal.stage}
Contact: ${deal.contact.firstName} ${deal.contact.lastName}, ${deal.contact.title || ''} at ${deal.contact.company?.name || 'Unknown Company'}
Owner: ${deal.owner?.firstName || 'Unassigned'}
Expected Close: ${deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toDateString() : 'Not set'}
Win Probability: ${Math.round((deal.winProbability || 0) * 100)}%

Last ${deal.activities.length} activities:
${activitySummary || 'No activities logged yet'}

Write a 200-word deal briefing using these exact markdown sections:
## Background
## Key Concerns Raised
## Last Interaction
## Recommended Talking Points`;

    const systemPrompt = 'You are an expert sales coach writing deal briefings for sales reps preparing for customer conversations. Be specific, actionable, and concise.';

    setImmediate(() => logAICall('deal_summary', req.user.id, { dealId: req.params.id }, {}, 0, deal.contactId, deal.id));

    await streamResponse(prompt, systemPrompt, res);
  } catch (err) {
    if (!res.headersSent) next(err);
  }
};
```

In `DealSummaryPanel.jsx`:
- Render a card with "Generate AI Summary" button
- On click, stream from `POST /api/ai/deal-summary/:id`
- Display streamed markdown using dangerouslySetInnerHTML with simple markdown-to-html conversion (or install `react-markdown`)
- Show skeleton while generating
- Add "Regenerate" button after first generation

**CONFIRM 7.3:**
- [ ] Deal Detail page shows the DealSummaryPanel card
- [ ] Clicking "Generate AI Summary" streams a formatted briefing
- [ ] Markdown headers (##) render as styled headings
- [ ] Regenerate generates a fresh summary

---

## Step 7.4 — AI Feature 5: Smart Reply

```javascript
// ai.controller.js:
exports.smartReply = async (req, res, next) => {
  try {
    const { emailThread, tone, contactId } = req.body;

    const toneInstructions = {
      professional: 'Write formally and professionally. Use proper greetings and sign-offs.',
      casual: 'Write in a friendly, conversational tone. Keep it warm and approachable.',
      urgent: 'Write with urgency. Make it clear that a quick response is needed. Be direct.',
    };

    const prompt = `Email thread:
${emailThread}

Write a reply to the above email thread. Tone: ${tone || 'professional'}.
${toneInstructions[tone] || toneInstructions.professional}
Keep the reply under 150 words. Start directly with the greeting — do not include Subject line.`;

    const reply = await getText(prompt, 'You are a professional sales rep writing email replies.');

    setImmediate(() => logAICall('smart_reply', req.user.id, { tone, contactId }, { reply }, 0, contactId));

    res.json({ reply });
  } catch (err) { next(err); }
};
```

In `SmartReplyBar.jsx`:
- Three buttons: "Professional", "Casual", "Urgent"
- On click: calls the API, shows loading state, then populates a preview textarea
- "Use Reply" button copies to the email compose box

**CONFIRM 7.4:**
- [ ] SmartReplyBar renders on the Contact Detail Emails tab
- [ ] Clicking "Professional" generates a formal reply
- [ ] Clicking "Casual" generates a different, more friendly version

---

## Step 7.5 — AI Feature 8: Next Best Action

```javascript
// ai.controller.js:
exports.nextAction = async (req, res, next) => {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: {
        deals: { orderBy: { createdAt: 'desc' }, take: 1 },
        activities: { orderBy: { occurredAt: 'desc' }, take: 3 },
      }
    });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const daysSinceLast = contact.activities[0]
      ? Math.floor((Date.now() - new Date(contact.activities[0].occurredAt)) / 86400000)
      : 999;

    const prompt = `Contact situation:
- Name: ${contact.firstName} ${contact.lastName}
- Status: ${contact.status}
- Lead Score: ${contact.leadScore} (${contact.leadScoreLabel || 'unscored'})
- Churn Risk: ${Math.round((contact.churnRisk || 0) * 100)}%
- Days since last contact: ${daysSinceLast}
- Current deal stage: ${contact.deals[0]?.stage || 'No open deal'}
- Deal value: $${contact.deals[0] ? Number(contact.deals[0].value).toLocaleString() : 'N/A'}
- Last 3 activities: ${contact.activities.map(a => `${a.type} (${a.sentiment || 'neutral'})`).join(', ') || 'None'}

What is the single most impactful next action for this sales rep?

Return JSON:
{
  "action": "specific action description",
  "reason": "why this action matters right now (1 sentence)",
  "urgency": "HIGH|MEDIUM|LOW",
  "type": "EMAIL|CALL|TASK|MEETING"
}`;

    const result = await getJSON(prompt, 'You are an expert sales coach. Recommend the single best next action based on the contact\'s current situation.');

    // Store in contact record for display
    await prisma.contact.update({
      where: { id: req.params.id },
      data: { nextBestAction: result }
    });

    setImmediate(() => logAICall('next_best_action', req.user.id, { contactId: req.params.id }, result, 0, req.params.id));

    res.json(result);
  } catch (err) { next(err); }
};
```

In `NextActionCard.jsx`:
```jsx
import { Zap, Mail, Phone, CheckSquare, Users, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import api from '../../api/axiosInstance';
import toast from 'react-hot-toast';

const TYPE_ICONS = { EMAIL: Mail, CALL: Phone, TASK: CheckSquare, MEETING: Users };
const URGENCY_COLOURS = { HIGH: 'red', MEDIUM: 'amber', LOW: 'green' };

export default function NextActionCard({ contactId, action: initialAction, onActionTaken }) {
  const [action, setAction] = useState(initialAction);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await api.post(`/api/ai/next-action/${contactId}`);
      setAction(data);
    } catch { toast.error('Failed to generate recommendation'); }
    finally { setLoading(false); }
  };

  if (!action && !loading) {
    return (
      <div className="border border-dashed border-indigo-200 rounded-xl p-4 text-center">
        <Button variant="secondary" size="sm" onClick={refresh} loading={loading}>
          <Zap size={14} className="mr-1" /> Generate AI Recommendation
        </Button>
      </div>
    );
  }

  const Icon = TYPE_ICONS[action?.type] || Zap;

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Icon size={16} className="text-white" />
          </div>
          <div>
            <p className="text-xs font-medium text-indigo-600 uppercase tracking-wide">Next Best Action</p>
            <Badge variant={URGENCY_COLOURS[action?.urgency] || 'gray'} size="sm">{action?.urgency} Priority</Badge>
          </div>
        </div>
        <button onClick={refresh} disabled={loading} className="text-indigo-400 hover:text-indigo-600">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <p className="text-sm font-semibold text-gray-900 mb-1">{action?.action}</p>
      <p className="text-xs text-gray-500 mb-3">{action?.reason}</p>
      <Button size="sm" onClick={onActionTaken} className="w-full">
        Do It Now
      </Button>
    </div>
  );
}
```

**CONFIRM 7.5:**
- [ ] NextActionCard renders on Contact Detail Overview tab
- [ ] "Generate AI Recommendation" button fetches a recommendation
- [ ] The card shows action, reason, urgency badge, and type icon
- [ ] Recommendation is stored in the contact's DB record (verify in DB)
- [ ] "Refresh" button generates a new recommendation

---

## Step 7.6 — AI Feature 12: Contact Enrichment

```javascript
// ai.controller.js:
exports.enrichContact = async (req, res, next) => {
  try {
    const { contactId, linkedinUrl, domain } = req.body;

    const prompt = `Based on the ${linkedinUrl ? `LinkedIn URL: ${linkedinUrl}` : `company domain: ${domain}`}, provide realistic professional information.

Return JSON:
{
  "title": "professional job title",
  "companyName": "company name",
  "companySize": "number of employees (integer)",
  "industry": "industry sector",
  "location": "City, Country",
  "estimatedBudgetTier": "SMALL (<$10k) | MEDIUM ($10k-$100k) | LARGE ($100k+)",
  "companySummary": "2-sentence company description"
}

If you cannot determine a field with reasonable confidence, use null.`;

    const enrichment = await getJSON(prompt, 'You are a B2B sales intelligence assistant. Provide accurate professional information based on the given identifiers.');

    // Update the contact with enriched data
    const updateData = {};
    if (enrichment.title) updateData.title = enrichment.title;
    if (enrichment.companySummary || enrichment.companyName) {
      // Could create/link company here in a production app
    }
    if (enrichment.customFields) updateData.customFields = enrichment.customFields;

    if (Object.keys(updateData).length > 0) {
      await prisma.contact.update({ where: { id: contactId }, data: updateData });
    }

    // Log the enrichment as an activity
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    await prisma.activity.create({
      data: {
        type: 'NOTE',
        notes: `Contact enriched via AI. Source: ${linkedinUrl || domain}`,
        contactId,
        userId: req.user.id,
      }
    });

    setImmediate(() => logAICall('contact_enrichment', req.user.id, { contactId, linkedinUrl, domain }, enrichment, 0, contactId));

    res.json({ enrichment });
  } catch (err) { next(err); }
};
```

**CONFIRM 7.6:**
- [ ] `POST /api/ai/enrich-contact` with `{ contactId, domain: "salesforce.com" }` returns enrichment data
- [ ] Enrichment modal on Contact Detail shows proposed changes for user to confirm
- [ ] After confirming, contact title updates in the DB

---

## Step 7.7 — AI Feature 2: Lead Scoring (with nightly cron)

Create `server/src/services/scoring.service.js`:

```javascript
const { PrismaClient } = require('@prisma/client');
const { getText } = require('./claude.service');
const prisma = new PrismaClient();

/**
 * Calculate lead score for a contact and update their record.
 * Returns the updated score, label, and explanation.
 */
async function calculateAndSaveLeadScore(contactId) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      activities: { orderBy: { occurredAt: 'desc' }, take: 20 },
      deals: { where: { stage: { notIn: ['CLOSED_WON','CLOSED_LOST'] } } }
    }
  });
  if (!contact) throw new Error('Contact not found');

  const now = Date.now();
  const lastActivity = contact.activities[0];
  const daysSince = lastActivity
    ? Math.floor((now - new Date(lastActivity.occurredAt)) / 86400000)
    : 999;

  let score = 0;

  // Days since last contact (max 40 points)
  if (daysSince <= 7)       score += 40;
  else if (daysSince <= 30) score += 20;
  else if (daysSince <= 90) score += 5;

  // Activity count in last 30 days (max 30 points)
  const recentCount = contact.activities.filter(a =>
    (now - new Date(a.occurredAt)) < 30 * 86400000
  ).length;
  if (recentCount >= 10)     score += 30;
  else if (recentCount >= 4) score += 20;
  else if (recentCount >= 1) score += 10;

  // Open deal value (max 30 points)
  const openDeal = contact.deals[0];
  if (openDeal) {
    const val = Number(openDeal.value);
    if (val > 50000)     score += 30;
    else if (val > 10000) score += 20;
    else                  score += 10;

    // Bonus for advanced stage
    if (['PROPOSAL','NEGOTIATION'].includes(openDeal.stage)) score += 20;
  }

  // Sentiment bonus/penalty
  const sentimentScore = contact.sentimentScore || 0.5;
  if (sentimentScore > 0.7)     score += 10;
  else if (sentimentScore < 0.3) score -= 10;

  // Clamp to 0-120
  score = Math.max(0, Math.min(120, score));

  const label = score > 80 ? 'HOT' : score > 40 ? 'WARM' : 'COLD';

  // Get Claude explanation (brief, 1 sentence)
  let explanation = `${label} — score ${score}/120`;
  try {
    explanation = await getText(
      `Lead score: ${score}/120. Label: ${label}. Days since last contact: ${daysSince}. Recent activities (30d): ${recentCount}. Open deal stage: ${openDeal?.stage || 'none'}. Sentiment: ${(sentimentScore * 100).toFixed(0)}%.
Write exactly ONE sentence explaining this lead score. Start with "${label} lead —"`,
      'You are a CRM analyst. Write a single concise sentence explaining a lead score. No extra commentary.'
    );
  } catch (e) {
    console.error('Lead score explanation failed:', e.message);
  }

  await prisma.contact.update({
    where: { id: contactId },
    data: { leadScore: score, leadScoreLabel: label, leadScoreExplanation: explanation }
  });

  return { score, label, explanation };
}

module.exports = { calculateAndSaveLeadScore };
```

Create `server/src/jobs/scoring.job.js`:

```javascript
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { calculateAndSaveLeadScore } = require('../services/scoring.service');

const prisma = new PrismaClient();

const STAGE_ORDER = { LEAD: 0, CONTACTED: 1, DEMO: 2, PROPOSAL: 3, NEGOTIATION: 4 };

/**
 * Run nightly ML scoring for all active contacts.
 * Updates churnRisk, winProbability, and leadScore.
 */
async function runNightlyScoring() {
  console.log('[Scoring Job] Starting nightly ML scoring...');

  const contacts = await prisma.contact.findMany({
    where: { status: { in: ['LEAD','ACTIVE'] } },
    include: {
      activities: { orderBy: { occurredAt: 'desc' }, take: 90 },
      deals: true,
    }
  });

  let updated = 0;
  for (const contact of contacts) {
    try {
      const now = Date.now();
      const lastActivity = contact.activities[0];
      const daysSince = lastActivity ? Math.floor((now - new Date(lastActivity.occurredAt)) / 86400000) : 999;
      const last30 = contact.activities.filter(a => (now - new Date(a.occurredAt)) < 30 * 86400000).length;
      const last90 = contact.activities.filter(a => (now - new Date(a.occurredAt)) < 90 * 86400000).length;
      const openDeal = contact.deals.find(d => !['CLOSED_WON','CLOSED_LOST'].includes(d.stage));
      const totalDealValue = contact.deals.reduce((s, d) => s + Number(d.value), 0);

      const features = [
        daysSince, last30, last90,
        contact.sentimentScore || 0.5,
        contact.leadScore || 0,
        contact.deals.length,
        totalDealValue,
        openDeal ? 1 : 0,
      ];

      // Call ML service for churn prediction
      const churnRes = await axios.post(`${process.env.ML_SERVICE_URL}/predict/churn`, { features });
      await prisma.contact.update({
        where: { id: contact.id },
        data: { churnRisk: churnRes.data.risk }
      });

      // Score all open deals for this contact
      if (openDeal) {
        const dealFeatures = [
          STAGE_ORDER[openDeal.stage] || 0,
          Number(openDeal.value),
          Math.floor((now - new Date(openDeal.updatedAt)) / 86400000),
          contact.activities.length,
          last30,
          100, // default company size
        ];
        const winRes = await axios.post(`${process.env.ML_SERVICE_URL}/predict/win_prob`, { features: dealFeatures });
        await prisma.deal.update({
          where: { id: openDeal.id },
          data: { winProbability: winRes.data.probability }
        });
      }

      // Recalculate lead score
      await calculateAndSaveLeadScore(contact.id);
      updated++;
    } catch (e) {
      console.error(`[Scoring Job] Failed for contact ${contact.id}:`, e.message);
    }
  }
  console.log(`[Scoring Job] ✓ Scored ${updated}/${contacts.length} contacts`);
}

// Schedule: every night at 2:00 AM
cron.schedule('0 2 * * *', runNightlyScoring, { timezone: 'Asia/Kolkata' });

// Also run immediately on startup for fresh data
setTimeout(runNightlyScoring, 5000);

module.exports = { runNightlyScoring };
```

**CONFIRM 7.7:**
- [ ] After server restart, the scoring job runs after 5 seconds (check console for `[Scoring Job] Starting...`)
- [ ] Check DB: `SELECT lead_score, lead_score_label, churn_risk FROM contacts LIMIT 10;` — values should be updated
- [ ] Contact cards in the UI show updated lead score badges and churn risk percentages

---

# PHASE 8 — SOCKET.IO REAL-TIME EVENTS

## Step 8.1 — Complete Socket.io integration

The `global.io` is already set up in `server.js`. Now ensure all relevant controllers emit events:

In `deals.controller.js` — after stage update:
```javascript
if (global.io) {
  global.io.to(deal.ownerId).emit('deal:stage_changed', {
    dealId: deal.id,
    title: deal.title,
    newStage: stage,
    contactName: `${deal.contact.firstName} ${deal.contact.lastName}`,
  });
}
```

In `activities.controller.js` — after activity creation:
```javascript
if (global.io) global.io.emit('activity:created', { contactId, activityId: activity.id });
```

In the nightly scoring job — for high churn risk contacts:
```javascript
if (contact.churnRisk > 0.7 && global.io) {
  global.io.to(contact.ownerId).emit('contact:churn_alert', {
    contactId: contact.id,
    name: `${contact.firstName} ${contact.lastName}`,
    churnRisk: contact.churnRisk,
  });
}
```

## Step 8.2 — Connect the React client to Socket.io

Create `client/src/hooks/useSocket.js`:

```javascript
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { useUIStore } from '../store/uiStore';
import { useQueryClient } from '@tanstack/react-query';

export function useSocket() {
  const { user, token } = useAuthStore();
  const { addNotification } = useUIStore();
  const queryClient = useQueryClient();
  const socketRef = useRef(null);

  useEffect(() => {
    if (!user || !token) return;

    socketRef.current = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001', {
      query: { userId: user.id },
      auth: { token },
    });

    const socket = socketRef.current;

    socket.on('deal:stage_changed', (data) => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      addNotification({
        type: 'deal',
        message: `Deal "${data.title}" moved to ${data.newStage.replace('_', ' ')}`,
      });
    });

    socket.on('activity:created', () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
    });

    socket.on('contact:updated', () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    });

    socket.on('contact:churn_alert', (data) => {
      addNotification({
        type: 'alert',
        message: `⚠️ Churn alert: ${data.name} — ${Math.round(data.churnRisk * 100)}% risk`,
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [user?.id, token]);

  return socketRef.current;
}
```

Call `useSocket()` inside `AppShell.jsx`:
```jsx
import { useSocket } from '../../hooks/useSocket';

export default function AppShell() {
  useSocket(); // Initialize Socket.io connection for this session
  // ... rest of component
}
```

**CONFIRM 8:**
- [ ] After moving a deal to a new stage in the Kanban, the notification bell shows a new notification immediately (without page refresh)
- [ ] The notification lists the deal title and new stage
- [ ] Logging an activity on one browser tab updates the activity feed on another tab (both logged into the same user)

---

# PHASE 9 — SETTINGS PAGES (FULL IMPLEMENTATION)

## Step 9.1 — General Settings

`GeneralSettings.jsx` must implement:

**Company Info section:**
- Text input for company name — saved to a settings table (create a simple `settings` key-value record in the DB, or use `localStorage` for simplicity in a portfolio project)
- Logo upload: file input → preview image → save button

**Pipeline Stages section:**
- The stages are currently fixed enums. For the UI, display them in order with drag handles (use `@dnd-kit`). Allow renaming and reordering. Show a note that the order is cosmetic — actual DB values remain the enum strings.

**Custom Fields:**
- Table with columns: Field Name, Type (text/number/date/dropdown), Target (Contact/Deal), Delete
- "Add Custom Field" form inline at bottom
- Save to `customFields` JSON column on contacts

**Tags Manager:**
- Chip display of common tags
- Input to add a new tag
- Click x on chip to remove

## Step 9.2 — Users Settings

Add a `/api/users` route to the server:

```javascript
// GET /api/users — list all users (admin only)
exports.listUsers = async (req, res, next) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  const users = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true }
  });
  res.json(users);
};

// PATCH /api/users/:id — update role or isActive (admin only)
exports.updateUser = async (req, res, next) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  const { role, isActive } = req.body;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { role, isActive },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true }
  });
  res.json(user);
};
```

`UsersSettings.jsx` must show:
- Users table (see Phase 5.11)
- Role changes save immediately on dropdown change
- Active toggle saves immediately
- Invite User modal: email input → `POST /api/auth/register` with a default password → user must reset

## Step 9.3 — Integrations Settings

`IntegrationsSettings.jsx` must show:
- Integration cards for Anthropic, OpenAI, Clearbit, SMTP
- Each card: status badge (check if env var is set via `GET /api/settings/integrations`), key input, save, test button
- Add server endpoint `GET /api/settings/integrations` that returns `{ anthropic: boolean, openai: boolean, clearbit: boolean }` — true if the key is present in env vars

**CONFIRM 9:**
- [ ] General Settings page renders all three sections
- [ ] Users Settings page loads and shows all 4 seed users
- [ ] Role dropdown changes update the user's role in the DB
- [ ] Integrations page shows correct connected/not-configured status for each API

---

# PHASE 10 — DEPLOYMENT

## Step 10.1 — Prepare for production

Create a `Procfile` in `/server` for Render:
```
web: node server.js
```

Create a `Procfile` in `/ml-service` for Render:
```
web: python app.py
```

Update CORS in `server/src/app.js` to accept your Vercel URL:
```javascript
app.use(cors({
  origin: [process.env.CLIENT_URL, 'https://YOUR-PROJECT.vercel.app'],
  credentials: true,
}));
```

## Step 10.2 — Deploy PostgreSQL to Supabase

1. Create a new project on supabase.com
2. In the SQL editor: `CREATE EXTENSION IF NOT EXISTS vector;`
3. Copy the connection string from Settings > Database > Connection string (use the "URI" format, not "Connection pooling")
4. Run: `DATABASE_URL=<supabase_url> npx prisma migrate deploy` from `/server`
5. Run: `DATABASE_URL=<supabase_url> npm run seed` from `/server`
6. Run indexing: `DATABASE_URL=<supabase_url> python services/indexer.py` from `/ml-service`

## Step 10.3 — Deploy Node.js server to Render

1. Push all code to GitHub
2. Render → New Web Service → connect repo
3. Root directory: `server`
4. Build command: `npm install && npx prisma generate`
5. Start command: `node server.js`
6. Environment variables: paste all env vars from your `.env` file
7. Deploy

## Step 10.4 — Deploy Python ML service to Render

1. Render → New Web Service → connect same repo
2. Root directory: `ml-service`
3. Build command: `pip install -r requirements.txt && python train.py`
4. Start command: `python app.py`
5. Instance type: at least 512MB RAM (needed for HuggingFace model)
6. Environment variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL`

> ⚠️ First deploy takes 10–15 minutes: HuggingFace downloads the sentiment model (~260MB)

## Step 10.5 — Deploy React client to Vercel

1. Vercel → Import Git Repository
2. Root directory: `client`
3. Framework preset: Vite
4. Environment variables:
   - `VITE_API_URL` = your Render server URL (e.g., `https://leadpulse-server.onrender.com`)
   - `VITE_SOCKET_URL` = same Render server URL
5. Deploy

**CONFIRM 10 — Final Production Checklist:**
- [ ] `https://YOUR-PROJECT.vercel.app` loads the Leadpulse login page
- [ ] Login with `admin@leadpulse.dev / password123` redirects to dashboard
- [ ] All 15 pages load without errors
- [ ] Contacts list shows 200 contacts from seed data
- [ ] Kanban pipeline shows deals in all stages
- [ ] AI Email Composer generates a streaming email
- [ ] AI Chat Assistant responds to a question about the CRM data
- [ ] Sentiment analysis runs when a new activity note is logged
- [ ] Churn risk and lead scores are visible on contact cards
- [ ] No API keys or `.env` files are committed to GitHub (run `git log --all -- .env` to verify)

---

# MASTER CONFIRMATION CHECKLIST

Run through all items before considering the project complete:

## Infrastructure
- [ ] `docker-compose up` starts all 4 services
- [ ] PostgreSQL has all 9 tables and pgvector extension
- [ ] 200 contacts, 120 deals, 500+ activities exist in the DB

## Auth
- [ ] Register creates a new user
- [ ] Login returns a JWT and user object
- [ ] JWT is required for all API endpoints except auth
- [ ] Invalid token returns 401

## Core CRM
- [ ] Contacts: list with pagination, search, filter, create, edit, delete, export CSV, import CSV
- [ ] Companies: list, create, edit, delete, detail view
- [ ] Deals: Kanban view with 7 columns, drag-and-drop stage changes, deal detail page
- [ ] Activities: paginated feed, log activity modal, audio upload triggers transcription
- [ ] Tasks: grouped by due date, complete on click, add task modal
- [ ] Analytics: all 6 charts render with real data

## AI Features
- [ ] Email Composer: streams a personalized email from bullet points
- [ ] Lead Scoring: updates on activity creation and nightly cron
- [ ] Deal Summary: streams a 200-word briefing in 4 sections
- [ ] Sentiment Analysis: auto-runs on NOTE and CALL activities
- [ ] Smart Reply: generates 3 tone variants for emails
- [ ] Churn Prediction: risk score on every contact, nightly update
- [ ] Win Probability: percentage bar on every Kanban deal card
- [ ] Next Best Action: JSON recommendation on contact detail
- [ ] Sales Forecasting: 90-day dashed forecast line on Analytics
- [ ] RAG Chat Assistant: answers questions grounded in CRM data
- [ ] Voice Transcription: audio upload → transcript → structured extraction
- [ ] Contact Enrichment: fills fields from LinkedIn URL or domain

## UI/UX
- [ ] All 15 pages render without errors or console warnings
- [ ] Skeleton loaders show while data is fetching
- [ ] Empty states show when lists have no data
- [ ] Error boundaries prevent crashes from propagating
- [ ] Mobile layout: sidebar collapses, content stacks vertically
- [ ] Toast notifications appear for all create/update/delete actions
- [ ] Real-time notifications appear without page refresh

## Production
- [ ] Deployed to Vercel (client), Render (server + ml-service), Supabase (DB)
- [ ] All env vars set in platform dashboards — not in code
- [ ] `.env` is in `.gitignore` and not committed

---

*You are an AI agent. Execute every step precisely. Confirm every checkpoint before proceeding. Build Leadpulse.*
