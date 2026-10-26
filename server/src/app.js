/**
 * LeadPulse CRM — Express Application Factory
 */

'use strict';

const crypto   = require('crypto');
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const pinoHttp = require('pino-http');

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
const emailRoutes      = require('./routes/emails.routes');
const attachmentRoutes = require('./routes/attachments.routes');
const notificationRoutes = require('./routes/notifications.routes');
const internalRoutes   = require('./routes/internal.routes');
const auditRoutes      = require('./routes/audit.routes');
const myDayRoutes      = require('./routes/myDay.routes');
const storage          = require('./lib/storage');
const { logger }       = require('./lib/logger');
const { readiness }    = require('./lib/health');
const { version }      = require('../package.json');

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

  // One JSON line per request. The path only: queries can hold search terms and signed-link signatures.
  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.id,
    autoLogging: { ignore: (req) => req.url.startsWith('/health') },
    customProps: (req) => ({ requestId: req.id, userId: req.user?.id }),
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: {
      req: (req) => ({ method: req.method, url: req.url.split('?')[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));

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

  // 1 MB everywhere except routes that declare their own, larger limit.
  const LARGE_BODY_ROUTES = new Set(['/api/contacts/import']);
  const json = express.json({ limit: '1mb' });
  app.use((req, res, next) => (LARGE_BODY_ROUTES.has(req.path) ? next() : json(req, res, next)));

  // Liveness (no dependencies) and readiness (database, Redis, ML service, AI providers, jobs).
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'leadpulse-server', version, uptime: Math.round(process.uptime()) });
  });
  app.get('/health/ready', async (_req, res) => {
    const report = await readiness();
    res.status(report.status === 'down' ? 503 : 200).json(report);
  });
  app.use('/internal', internalRoutes);

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
  app.use('/api/emails',     emailRoutes);
  app.use('/api/attachments', attachmentRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/audit-logs', auditRoutes);
  app.use('/api',            myDayRoutes);

  // Signed, short-lived download links for private files (no auth header: links open in the browser).
  app.get('/api/files/*key', (req, res) => {
    const key = [].concat(req.params.key).join('/');
    const file = storage.verify(key, req.query);
    res.download(file, String(req.query.name || 'download'), { headers: { 'Cache-Control': 'private, no-store' } }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ success: false, error: 'File not found', code: 'NOT_FOUND' });
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
