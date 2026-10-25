/**
 * LeadPulse CRM — Express Application Factory
 */

'use strict';

const crypto   = require('crypto');
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');

const authRoutes       = require('./routes/auth.routes');
const contactRoutes    = require('./routes/contacts.routes');
const companyRoutes    = require('./routes/companies.routes');
const dealRoutes       = require('./routes/deals.routes');
const activityRoutes   = require('./routes/activities.routes');
const taskRoutes       = require('./routes/tasks.routes');
const analyticsRoutes  = require('./routes/analytics.routes');
const aiRoutes         = require('./routes/ai.routes');
const usersRoutes      = require('./routes/users.routes');
const settingsRoutes   = require('./routes/settings.routes');

const { ApiError, errorHandler, notFoundHandler } = require('./middleware/error.middleware');
const { allowedOrigins } = require('./lib/env');

const REQUEST_ID = /^[\w.-]{1,100}$/;

function createApp() {
  const app = express();
  const origins = new Set(allowedOrigins());

  // Render/Vercel terminate TLS in front of us; needed for req.ip and rate limits.
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  });

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));

  app.use(cors({
    origin: (origin, callback) => {
      // No Origin header: same-origin requests, curl, server-to-server.
      if (!origin || origins.has(origin)) return callback(null, true);
      callback(new ApiError(`Origin ${origin} is not allowed`, 403, 'CORS_REJECTED'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'Content-Disposition'],
  }));

  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    skip: () => process.env.NODE_ENV === 'test',
  }));
  // 1 MB everywhere except routes that declare their own, larger limit.
  const LARGE_BODY_ROUTES = new Set(['/api/contacts/import']);
  const json = express.json({ limit: '1mb' });
  app.use((req, res, next) => (LARGE_BODY_ROUTES.has(req.path) ? next() : json(req, res, next)));

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
  app.use('/api/settings',   settingsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
