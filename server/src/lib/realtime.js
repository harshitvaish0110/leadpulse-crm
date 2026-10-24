/**
 * LeadPulse — Socket.IO with handshake auth and server-side rooms.
 *
 * Every socket joins `user:<id>`; ADMIN and MANAGER also join `managers`.
 * Clients never choose their rooms.
 */

'use strict';

const { Server } = require('socket.io');
const { userFromAccessToken, isPrivileged } = require('../middleware/auth.middleware');
const { allowedOrigins } = require('./env');

const MANAGERS_ROOM = 'managers';

let io = null;

function attachSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins(), credentials: true },
    transports: ['websocket', 'polling'],
  });

  io.use(async (socket, next) => {
    try {
      socket.data.user = await userFromAccessToken(socket.handshake.auth?.token || '');
      next();
    } catch (err) {
      const error = new Error(err.message || 'Unauthorized');
      error.data = { code: err.code || 'UNAUTHORIZED' };
      next(error);
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    socket.join(`user:${user.id}`);
    if (isPrivileged(user)) socket.join(MANAGERS_ROOM);
  });

  return io;
}

/** Sends to the given users only. Falsy ids are ignored. */
function emitToUsers(userIds, event, payload) {
  const rooms = [...new Set(userIds.filter(Boolean))].map((id) => `user:${id}`);
  if (io && rooms.length) io.to(rooms).emit(event, payload);
}

/** Sends to the record's owners plus every ADMIN/MANAGER (each socket receives it once). */
function emitScoped(ownerIds, event, payload) {
  if (!io) return;
  const rooms = [...new Set(ownerIds.filter(Boolean))].map((id) => `user:${id}`);
  io.to([...rooms, MANAGERS_ROOM]).emit(event, payload);
}

async function closeSocket() {
  if (io) await io.close();
  io = null;
}

module.exports = { attachSocket, emitToUsers, emitScoped, closeSocket };
