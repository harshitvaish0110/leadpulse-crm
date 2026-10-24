/**
 * LeadPulse CRM — Authentication & authorization middleware.
 *
 * - `authenticate` verifies the Bearer access token and attaches the live user.
 * - `requireRole` gates routes by role.
 * - `scopeFor` is the single source of record-level access rules.
 *   Every data access must merge it into its `where`.
 */

'use strict';

const jwt = require('jsonwebtoken');
const { ApiError } = require('./error.middleware');
const { prisma }   = require('../lib/prisma');

const PRIVILEGED_ROLES = new Set(['ADMIN', 'MANAGER']);

/** Resources that are personal to the user regardless of role. */
const PERSONAL_RESOURCES = new Set(['aiConversation', 'aiActionRequest', 'notification']);

const isPrivileged = (user) => PRIVILEGED_ROLES.has(user?.role);

/**
 * Validates `Authorization: Bearer <access token>` and attaches `req.user`.
 */
async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw ApiError.unauthorized('No token provided', 'NO_TOKEN');

    const user = await userFromAccessToken(header.slice(7));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Verifies an access token and loads the active user it belongs to.
 * Shared by HTTP auth and the Socket.IO handshake.
 */
async function userFromAccessToken(token) {
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    throw err.name === 'TokenExpiredError'
      ? ApiError.unauthorized('Token has expired', 'TOKEN_EXPIRED')
      : ApiError.unauthorized('Invalid token', 'INVALID_TOKEN');
  }
  if (decoded.typ && decoded.typ !== 'access') throw ApiError.unauthorized('Invalid token', 'INVALID_TOKEN');

  const userId = decoded.sub ?? decoded.userId; // `userId` = tokens issued before refresh sessions existed
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
  });
  if (!user) throw ApiError.unauthorized('User no longer exists', 'INVALID_TOKEN');
  if (!user.isActive) throw ApiError.forbidden('Account is deactivated', 'ACCOUNT_DISABLED');
  return user;
}

/**
 * Route guard: allow only the given roles. Use after `authenticate`.
 * @example router.delete('/:id', requireRole('ADMIN', 'MANAGER'), handler)
 */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`Requires one of: ${roles.join(', ')}`, 'ROLE_REQUIRED'));
    }
    next();
  };
}

/**
 * Prisma `where` fragment limiting `resource` to what `user` may access.
 * ADMIN and MANAGER see every CRM record; SALES_REP sees their own book.
 * Personal resources (conversations, AI actions, notifications) are always per user.
 *
 * @param {{ id: string, role: string }} user
 * @param {'contact'|'deal'|'activity'|'task'|'emailDraft'|'attachment'|'company'|'aiConversation'|'aiActionRequest'|'notification'} resource
 * @returns {object}
 */
function scopeFor(user, resource) {
  const uid = user.id;
  if (PERSONAL_RESOURCES.has(resource)) return { userId: uid };
  if (isPrivileged(user)) return {};

  switch (resource) {
    case 'contact':    return { ownerId: uid };
    case 'deal':       return { OR: [{ ownerId: uid }, { contact: { ownerId: uid } }] };
    case 'activity':   return { OR: [{ userId: uid }, { contact: { ownerId: uid } }] };
    case 'task':       return { OR: [{ assignedToId: uid }, { createdById: uid }, { contact: { ownerId: uid } }] };
    case 'emailDraft': return { contact: { ownerId: uid } };
    case 'attachment': return { OR: [{ deal: scopeFor(user, 'deal') }, { contact: { ownerId: uid } }] };
    case 'company':    return {}; // companies are shared across the organisation
    default:
      throw new Error(`scopeFor: unknown resource "${resource}"`);
  }
}

/** Combine a query `where` with the caller's scope. */
function scoped(user, resource, where = {}) {
  const scope = scopeFor(user, resource);
  if (!Object.keys(scope).length) return where;
  if (!Object.keys(where).length) return scope;
  return { AND: [where, scope] };
}

const MODEL_FOR = {
  contact: 'contact', deal: 'deal', activity: 'activity', task: 'task',
  emailDraft: 'emailDraft', attachment: 'attachment',
  aiConversation: 'aiConversation', aiActionRequest: 'aiActionRequest', notification: 'notification',
};

const LABEL_FOR = {
  contact: 'Contact', deal: 'Deal', activity: 'Activity', task: 'Task', emailDraft: 'Email',
  attachment: 'Attachment', aiConversation: 'Conversation', aiActionRequest: 'Action', notification: 'Notification',
};

/**
 * Throws 404 unless the record exists inside the caller's scope.
 * Out-of-scope records are indistinguishable from missing ones.
 * @returns {Promise<object>} the selected fields of the record
 */
async function assertInScope(user, resource, id, select = { id: true }) {
  if (!id) throw ApiError.notFound(`${LABEL_FOR[resource]} not found`);
  const record = await prisma[MODEL_FOR[resource]].findFirst({
    where: { id, ...scoped(user, resource) },
    select,
  });
  if (!record) throw ApiError.notFound(`${LABEL_FOR[resource]} not found`);
  return record;
}

/** Shorthand for the most common parent check on write paths. */
const assertContactInScope = (user, contactId, select) => assertInScope(user, 'contact', contactId, select);

/**
 * Validates a requested `ownerId`: reps may only assign themselves,
 * ADMIN/MANAGER may assign any active user. Returns undefined when none was requested.
 */
async function resolveOwnerId(user, ownerId) {
  if (ownerId === undefined || ownerId === null || ownerId === '') return undefined;
  if (ownerId === user.id) return ownerId;
  if (!isPrivileged(user)) throw ApiError.forbidden('You can only assign records to yourself', 'OWNER_NOT_ALLOWED');
  const owner = await prisma.user.findFirst({ where: { id: ownerId, isActive: true }, select: { id: true } });
  if (!owner) throw ApiError.validation([{ path: 'ownerId', msg: 'Owner must be an active user' }]);
  return ownerId;
}

module.exports = {
  authenticate,
  userFromAccessToken,
  requireRole,
  isPrivileged,
  scopeFor,
  scoped,
  assertInScope,
  assertContactInScope,
  resolveOwnerId,
};
