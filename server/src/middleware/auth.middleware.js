/**
 * LeadPulse CRM — Auth Middleware
 *
 * Verifies JWT access tokens and attaches the decoded user to req.user.
 * Supports role-based access control via the `requireRole` factory.
 */

'use strict';

const jwt = require('jsonwebtoken');
const { ApiError } = require('./error.middleware');
const { prisma }   = require('../lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Middleware that validates the Bearer token in the Authorization header.
 * Attaches the full user record to `req.user` if valid.
 */
async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('No token provided');
    }

    const token = header.slice(7); // strip "Bearer "
    let decoded;

    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      throw ApiError.unauthorized(
        jwtErr.name === 'TokenExpiredError'
          ? 'Token has expired'
          : 'Invalid token'
      );
    }

    // Fetch live user to ensure they're still active and exist
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true, email: true, firstName: true,
        lastName: true, role: true, isActive: true,
      },
    });

    if (!user)           throw ApiError.unauthorized('User no longer exists');
    if (!user.isActive)  throw ApiError.forbidden('Account is deactivated');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Factory that returns a middleware enforcing one or more allowed roles.
 * Must be used AFTER `authenticate`.
 *
 * @example
 *   router.delete('/users/:id', authenticate, requireRole('ADMIN'), handler)
 *
 * @param {...string} roles  One or more Role enum values
 */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`Requires one of: ${roles.join(', ')}`));
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
