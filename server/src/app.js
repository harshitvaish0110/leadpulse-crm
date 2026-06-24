/**
 * LeadPulse CRM — Express Application Factory
 * Updated to mount all Phase 3 routes.
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const path     = require('path');

const authRoutes       = require('./routes/auth.routes');
const contactRoutes    = require('./routes/contacts.routes');
const companyRoutes    = require('./routes/companies.routes');
const dealRoutes       = require('./routes/deals.routes');
const activityRoutes   = require('./routes/activities.routes');
const taskRoutes       = require('./routes/tasks.routes');
const analyticsRoutes  = require('./routes/analytics.routes');
const aiRoutes         = require('./routes/ai.routes');
const usersRoutes      = require('./routes/users.routes');

const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');

function createApp() {
  const app = express();

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  }));

  app.use(cors({
    origin: (origin, callback) => {
      // Build allowed list: base + any extra production origins from env
      const base = [
        'http://localhost:5173',
        'http://localhost:3000',
        process.env.CLIENT_URL,
        process.env.EXTRA_ORIGINS,
      ].filter(Boolean);

      // Allow any *.vercel.app subdomain (preview deployments)
      const isVercel = origin && /^https:\/\/[\w-]+\.vercel\.app$/.test(origin);

      if (!origin || base.includes(origin) || isVercel) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'leadpulse-server', timestamp: new Date().toISOString() });
  });

  // ── API routes ──────────────────────────────────────────────────────────────
  app.use('/api/auth',       authRoutes);
  app.use('/api/contacts',   contactRoutes);
  app.use('/api/companies',  companyRoutes);
  app.use('/api/deals',      dealRoutes);
  app.use('/api/activities', activityRoutes);
  app.use('/api/tasks',      taskRoutes);
  app.use('/api/analytics',  analyticsRoutes);
  app.use('/api/ai',         aiRoutes);
  app.use('/api/users',      usersRoutes);
  app.use('/api/settings',   usersRoutes); // integrations endpoint

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
