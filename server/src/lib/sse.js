/**
 * LeadPulse — Server-sent events writer.
 *
 * Every streaming endpoint uses named events: `delta`, `sources`, `actions`,
 * then exactly one terminal `done` or `error`. A comment line every 15 s keeps
 * proxies from closing an idle stream.
 */

'use strict';

const HEARTBEAT_MS = 15_000;

/** Sends the stream headers and starts the heartbeat. Call once validation has passed. */
function sseStart(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const timer = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  timer.unref();
  res.on('close', () => clearInterval(timer));
}

/** Writes one event; a no-op once the client has gone. */
function sseSend(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseEnd(res) {
  if (!res.writableEnded) res.end();
}

/**
 * AbortSignal that fires when the client disconnects before the response ends.
 * (`req` emits 'close' as soon as its body has been read, so the response is watched instead.)
 */
function clientGone(res) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort(new Error('Client disconnected'));
  });
  return controller.signal;
}

module.exports = { sseStart, sseSend, sseEnd, clientGone, HEARTBEAT_MS };
