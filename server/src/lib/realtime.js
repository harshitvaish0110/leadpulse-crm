/**
 * LeadPulse — Socket.IO with handshake auth and server-side rooms.
 *
 * Every socket joins `user:<id>`; ADMIN and MANAGER also join `managers`.
 * Clients never choose their rooms.
 *
 * Processes without Socket.IO (the worker, one-off job runs) can still emit:
 * after relayThroughRedis() their events are published on the `lp:socket`
 * channel and the API process re-emits them to the same rooms.
 */

'use strict';

const { Server } = require('socket.io');
const { userFromAccessToken, isPrivileged } = require('../middleware/auth.middleware');
const { allowedOrigins } = require('./env');
const { redis, connect } = require('./redis');
const { logger } = require('./logger');

const MANAGERS_ROOM = 'managers';
const RELAY_CHANNEL = 'lp:socket';

let io = null;
let relay = false;
let subscriber = null;

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

  // Events emitted by the worker process arrive here.
  subscriber = connect('socket-relay');
  if (subscriber) {
    subscriber.subscribe(RELAY_CHANNEL).catch((err) => logger.warn({ event: 'relay_subscribe_failed', err: err.message }, 'Socket relay unavailable'));
    subscriber.on('message', (_channel, message) => {
      try {
        const { rooms, event, payload } = JSON.parse(message);
        if (Array.isArray(rooms) && rooms.length && typeof event === 'string') io?.to(rooms).emit(event, payload);
      } catch (err) {
        logger.warn({ event: 'relay_bad_message', err: err.message }, 'Ignored a malformed relay message');
      }
    });
  }

  return io;
}

/** In a process without Socket.IO, send events to the API through Redis instead of dropping them. */
function relayThroughRedis() {
  relay = Boolean(redis());
}

function emitToRooms(rooms, event, payload) {
  if (!rooms.length) return;
  if (io) io.to(rooms).emit(event, payload);
  else if (relay) redis()?.publish(RELAY_CHANNEL, JSON.stringify({ rooms, event, payload })).catch(() => {});
}

/** Sends to the given users only. Falsy ids are ignored. */
function emitToUsers(userIds, event, payload) {
  emitToRooms([...new Set(userIds.filter(Boolean))].map((id) => `user:${id}`), event, payload);
}

/** Sends to the record's owners plus every ADMIN/MANAGER (each socket receives it once). */
function emitScoped(ownerIds, event, payload) {
  const rooms = [...new Set(ownerIds.filter(Boolean))].map((id) => `user:${id}`);
  emitToRooms([...rooms, MANAGERS_ROOM], event, payload);
}

async function closeSocket() {
  await subscriber?.quit().catch(() => {});
  subscriber = null;
  if (io) await io.close();
  io = null;
}

module.exports = { attachSocket, relayThroughRedis, emitToUsers, emitScoped, closeSocket };
