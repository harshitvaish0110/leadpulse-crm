/**
 * LeadPulse CRM — Global error & not-found middleware.
 *
 * Every error response uses the same envelope:
 *   { success: false, error: "<human message>", code: "<MACHINE_CODE>", details?, requestId }
 */

'use strict';

/**
 * Structured API error. Controllers throw these to set a status and code.
 */
class ApiError extends Error {
  /**
   * @param {string} message  Human-readable message
   * @param {number} status   HTTP status code (default 500)
   * @param {string} [code]   Machine-readable code
   * @param {object} [meta]   Extra data (e.g. validation errors)
   */
  constructor(message, status = 500, code = null, meta = null) {
    super(message);
    this.name   = 'ApiError';
    this.status = status;
    this.code   = code || STATUS_CODES[status] || 'ERROR';
    this.meta   = meta;
  }

  static badRequest(message, meta, code)   { return new ApiError(message || 'Bad request', 400, code || 'BAD_REQUEST', meta); }
  static unauthorized(message, code)       { return new ApiError(message || 'Unauthorized', 401, code || 'UNAUTHORIZED'); }
  static forbidden(message, code)          { return new ApiError(message || 'Forbidden', 403, code || 'FORBIDDEN'); }
  static notFound(message, code)           { return new ApiError(message || 'Not found', 404, code || 'NOT_FOUND'); }
  static conflict(message, code)           { return new ApiError(message || 'Conflict', 409, code || 'CONFLICT'); }
  static validation(details, message)      { return new ApiError(message || 'Validation failed', 422, 'VALIDATION_ERROR', details); }
  static internal(message)                 { return new ApiError(message || 'Internal server error', 500, 'INTERNAL'); }
}

const STATUS_CODES = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
  409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 422: 'VALIDATION_ERROR', 429: 'RATE_LIMITED',
  502: 'UPSTREAM_ERROR', 503: 'UNAVAILABLE',
};

function send(res, req, status, error, code, details) {
  res.status(status).json({
    success: false,
    error,
    code,
    ...(details && { details }),
    ...(req.id && { requestId: req.id }),
  });
}

/** 404 for unmatched routes. */
function notFoundHandler(req, res) {
  send(res, req, 404, `Route ${req.method} ${req.originalUrl} does not exist`, 'ROUTE_NOT_FOUND');
}

/** Global error handler — must be registered last (4 args). */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (res.headersSent) {
    // Streaming responses (SSE) can fail after headers are sent; just end the stream.
    console.error('[ERROR after headers sent]', err);
    return res.end();
  }

  const isProd = process.env.NODE_ENV === 'production';
  const kind = err?.constructor?.name;

  if (err instanceof ApiError) {
    return send(res, req, err.status, err.message, err.code, err.meta || undefined);
  }

  // ── Prisma ────────────────────────────────────────────────────────────────
  if (kind === 'PrismaClientKnownRequestError') {
    if (err.code === 'P2002') {
      const target = err.meta?.target;
      const field = Array.isArray(target) ? target.join(', ') : (target || 'field');
      return send(res, req, 409, `A record with this ${field} already exists.`, 'DUPLICATE');
    }
    if (err.code === 'P2025') return send(res, req, 404, 'The requested record does not exist.', 'NOT_FOUND');
    if (err.code === 'P2003') return send(res, req, 422, 'A referenced record does not exist.', 'INVALID_REFERENCE');
  }
  if (kind === 'PrismaClientValidationError') {
    // e.g. an unknown enum value in a filter — a client error, not a server fault.
    return send(res, req, 400, 'Invalid request parameters.', 'INVALID_PARAMETERS');
  }

  // ── Body parsing, uploads, CORS ───────────────────────────────────────────
  if (err.type === 'entity.parse.failed') return send(res, req, 400, 'Malformed JSON body.', 'MALFORMED_JSON');
  if (err.type === 'entity.too.large') return send(res, req, 413, 'Request body is too large.', 'PAYLOAD_TOO_LARGE');
  if (kind === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return send(res, req, status, err.message, err.code);
  }
  if (err.code === 'CORS_REJECTED') return send(res, req, 403, err.message, 'CORS_REJECTED');

  // ── JWT ───────────────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return send(res, req, 401, 'Invalid or expired token', 'INVALID_TOKEN');
  }

  // ── Unknown ───────────────────────────────────────────────────────────────
  console.error(`[ERROR] ${req.method} ${req.originalUrl} (${req.id || '-'})`, err);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    code: 'INTERNAL',
    ...(req.id && { requestId: req.id }),
    ...(!isProd && { message: err.message, stack: err.stack }),
  });
}

module.exports = { ApiError, notFoundHandler, errorHandler };
