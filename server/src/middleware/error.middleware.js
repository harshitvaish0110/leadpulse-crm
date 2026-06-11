/**
 * LeadPulse CRM — Global Error & Not-Found Middleware
 */

'use strict';

/**
 * Structured API error class.
 * Controllers can throw this to communicate a specific HTTP status.
 */
class ApiError extends Error {
  /**
   * @param {string} message  Human-readable message
   * @param {number} status   HTTP status code (default 500)
   * @param {object} [meta]   Optional extra data (e.g. validation errors)
   */
  constructor(message, status = 500, meta = null) {
    super(message);
    this.name    = 'ApiError';
    this.status  = status;
    this.meta    = meta;
  }

  static badRequest(message, meta)    { return new ApiError(message, 400, meta); }
  static unauthorized(message)        { return new ApiError(message || 'Unauthorized', 401); }
  static forbidden(message)          { return new ApiError(message || 'Forbidden', 403); }
  static notFound(message)           { return new ApiError(message || 'Not found', 404); }
  static conflict(message)           { return new ApiError(message || 'Conflict', 409); }
  static internal(message)           { return new ApiError(message || 'Internal server error', 500); }
}

/**
 * 404 handler — catches any route that didn't match.
 */
function notFoundHandler(req, res, _next) {
  res.status(404).json({
    success: false,
    error:   'Not Found',
    message: `Route ${req.method} ${req.originalUrl} does not exist`,
  });
}

/**
 * Global error handler — must be registered last (4 args).
 * Handles Prisma errors, ApiErrors, and generic errors uniformly.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const isDev = process.env.NODE_ENV !== 'production';

  // ── Prisma-specific error mapping ──────────────────────────────────────────
  if (err.constructor?.name === 'PrismaClientKnownRequestError') {
    if (err.code === 'P2002') {
      // Unique constraint violation
      const field = err.meta?.target?.join(', ') ?? 'field';
      return res.status(409).json({
        success: false,
        error:   'Conflict',
        message: `A record with this ${field} already exists.`,
      });
    }
    if (err.code === 'P2025') {
      // Record not found
      return res.status(404).json({
        success: false,
        error:   'Not Found',
        message: 'The requested record does not exist.',
      });
    }
  }

  // ── express-validator errors (passed as array) ────────────────────────────
  if (Array.isArray(err)) {
    return res.status(422).json({
      success: false,
      error:   'Validation Error',
      errors:  err,
    });
  }

  // ── ApiError ──────────────────────────────────────────────────────────────
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false,
      error:   err.message,
      ...(err.meta && { details: err.meta }),
    });
  }

  // ── JWT errors ────────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error:   'Invalid or expired token',
    });
  }

  // ── Fallback: unknown error ───────────────────────────────────────────────
  console.error('[ERROR]', err);
  res.status(500).json({
    success: false,
    error:   'Internal Server Error',
    ...(isDev && { message: err.message, stack: err.stack }),
  });
}

module.exports = { ApiError, notFoundHandler, errorHandler };
