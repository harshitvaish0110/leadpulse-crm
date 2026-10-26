'use strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ||= 'x'.repeat(32);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createGateway } = require('../../src/services/ai');
const { createBreaker } = require('../../src/services/ai/breaker');
const { pool } = require('../../src/lib/prisma');

after(() => pool.end());

const spec = { feature: 'test', messages: [{ role: 'user', content: 'hi' }] };
const failure = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

/** Scripted provider: `complete`/`stream` behaviours receive the call number (1-based). */
function provider(name, { complete, stream } = {}) {
  const p = {
    name,
    calls: 0,
    model: () => `${name}-model`,
    enabled: () => true,
    async complete(msgs, opts) {
      p.calls += 1;
      return complete(p.calls, opts);
    },
    async stream(msgs, opts, onDelta) {
      p.calls += 1;
      return stream(p.calls, opts, onDelta);
    },
  };
  return p;
}

function gatewayWith(providers, extra = {}) {
  const logs = [];
  const gateway = createGateway({ chain: () => providers, log: (e) => logs.push(e), retryDelayMs: 0, ...extra });
  return { gateway, logs, statuses: () => logs.map((l) => `${l.provider}:${l.status}`) };
}

test('a transient failure is retried once, then the next provider answers', async () => {
  const a = provider('a', { complete: () => { throw failure(503); } });
  const b = provider('b', { complete: () => ({ text: 'from b', tokens: 5 }) });
  const { gateway, statuses } = gatewayWith([a, b]);

  const result = await gateway.getText(spec);
  assert.equal(result.text, 'from b');
  assert.equal(result.provider, 'b');
  assert.equal(a.calls, 2);
  assert.deepEqual(statuses(), ['a:fallback', 'a:fallback', 'b:ok']);
});

test('a non-retryable failure goes straight to the next provider', async () => {
  const a = provider('a', { complete: () => { throw failure(401); } });
  const b = provider('b', { complete: () => ({ text: 'ok', tokens: 0 }) });
  const { gateway } = gatewayWith([a, b]);
  await gateway.getText(spec);
  assert.equal(a.calls, 1);
});

test('when every provider fails the error is AI_UNAVAILABLE and the last attempt is logged as an error', async () => {
  const a = provider('a', { complete: () => { throw failure(400); } });
  const { gateway, statuses } = gatewayWith([a]);
  await assert.rejects(gateway.getText(spec), (err) => err.code === 'AI_UNAVAILABLE' && err.status === 502);
  assert.deepEqual(statuses(), ['a:error']);
});

test('no configured provider is a 503 AI_NOT_CONFIGURED', async () => {
  const { gateway } = gatewayWith([]);
  await assert.rejects(gateway.getText(spec), (err) => err.code === 'AI_NOT_CONFIGURED' && err.status === 503);
});

test('a stream that fails before its first chunk falls back to the next provider', async () => {
  const a = provider('a', { stream: () => { throw failure(429); } });
  const b = provider('b', { stream: async (_n, _o, onDelta) => { onDelta('Hello '); onDelta('world'); return { tokens: 2 }; } });
  const { gateway } = gatewayWith([a, b]);

  const deltas = [];
  const result = await gateway.stream(spec, {}, (t) => deltas.push(t));
  assert.equal(result.provider, 'b');
  assert.deepEqual(deltas, ['Hello ', 'world']);
});

test('a stream that fails mid-way never falls back, so no text is repeated', async () => {
  const a = provider('a', { stream: async (_n, _o, onDelta) => { onDelta('Hel'); onDelta('lo'); throw failure(503); } });
  const b = provider('b', { stream: async (_n, _o, onDelta) => { onDelta('Hello'); return { tokens: 1 }; } });
  const { gateway, statuses } = gatewayWith([a, b]);

  const deltas = [];
  await assert.rejects(gateway.stream(spec, {}, (t) => deltas.push(t)), (err) => err.code === 'AI_UNAVAILABLE');
  assert.deepEqual(deltas, ['Hel', 'lo']);
  assert.equal(a.calls, 1, 'no retry after output');
  assert.equal(b.calls, 0, 'no fallback after output');
  assert.deepEqual(statuses(), ['a:error']);
});

/** Starts `app` on a random port; returns { url, close }. */
function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

/** POSTs and collects the SSE events of the response. */
function collectEvents(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body.split('\n\n').filter(Boolean).map((block) => {
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        return { event, data: data && JSON.parse(data) };
      })));
    });
    req.on('error', reject);
    req.end();
  });
}

test('streamToResponse ends a failed stream with exactly one error event and no done', async () => {
  const a = provider('a', { stream: async (_n, _o, onDelta) => { onDelta('partial'); throw failure(500); } });
  const { gateway } = gatewayWith([a]);
  const app = express();
  app.post('/s', (_req, res) => gateway.streamToResponse(res, spec));
  const server = await listen(app);
  try {
    const events = await collectEvents(`${server.url}/s`);
    assert.deepEqual(events.map((e) => e.event), ['delta', 'error']);
    assert.equal(events[0].data.text, 'partial');
    assert.equal(events[1].data.code, 'AI_UNAVAILABLE');
  } finally {
    server.close();
  }
});

test('streamToResponse sends delta events then done with the provider', async () => {
  const a = provider('a', { stream: async (_n, _o, onDelta) => { onDelta('one '); onDelta('two'); return { tokens: 2 }; } });
  const { gateway } = gatewayWith([a]);
  const app = express();
  app.post('/s', (_req, res) => gateway.streamToResponse(res, spec));
  const server = await listen(app);
  try {
    const events = await collectEvents(`${server.url}/s`);
    assert.deepEqual(events.map((e) => e.event), ['delta', 'delta', 'done']);
    assert.deepEqual(events[2].data, { provider: 'a' });
  } finally {
    server.close();
  }
});

test('a client that disconnects mid-stream aborts the upstream request', async () => {
  let upstreamAborted;
  const aborted = new Promise((resolve) => { upstreamAborted = resolve; });
  const a = provider('a', {
    stream: (_n, opts, onDelta) => new Promise((_resolve, reject) => {
      onDelta('first chunk');
      opts.signal.addEventListener('abort', () => { upstreamAborted(true); reject(new Error('aborted')); }, { once: true });
    }),
  });
  const b = provider('b', { stream: async () => ({ tokens: 0 }) });
  const { gateway, statuses } = gatewayWith([a, b]);
  const app = express();
  let finished;
  const done = new Promise((resolve) => { finished = resolve; });
  app.post('/s', async (_req, res) => { await gateway.streamToResponse(res, spec); finished(); });
  const server = await listen(app);
  try {
    const req = http.request(`${server.url}/s`, { method: 'POST' }, (res) => {
      res.once('data', () => req.destroy()); // the browser tab closes after the first chunk
    });
    req.on('error', () => {});
    req.end();

    assert.equal(await Promise.race([aborted, new Promise((r) => setTimeout(() => r(false), 3000))]), true);
    await done;
    assert.equal(b.calls, 0, 'an abort is not a provider failure');
    assert.deepEqual(statuses(), ['a:aborted']);
  } finally {
    server.close();
  }
});

test('getJSON makes one repair attempt, then gives up with AI_BAD_OUTPUT', async () => {
  const normalise = (o) => {
    if (typeof o.reply !== 'string') throw new Error('missing reply');
    return { reply: o.reply };
  };
  const answers = ['Sure! Here you go', '```json\n{"reply": "Hi there"}\n```'];
  const fixable = provider('a', { complete: (n) => ({ text: answers[n - 1], tokens: 0 }) });
  const ok = await gatewayWith([fixable]).gateway.getJSON({ ...spec, json: true, normalise, schema: '{"reply": string}' });
  assert.deepEqual(ok.data, { reply: 'Hi there' });
  assert.equal(fixable.calls, 2);

  const hopeless = provider('a', { complete: () => ({ text: '{"nope": 1}', tokens: 0 }) });
  await assert.rejects(
    gatewayWith([hopeless]).gateway.getJSON({ ...spec, json: true, normalise }),
    (err) => err.code === 'AI_BAD_OUTPUT' && err.status === 502,
  );
  assert.equal(hopeless.calls, 2);
});

test('a provider with an open breaker is skipped', async () => {
  const breaker = createBreaker({ threshold: 3 });
  const a = provider('a', { complete: () => { throw failure(400); } });
  const b = provider('b', { complete: () => ({ text: 'b', tokens: 0 }) });
  const { gateway } = gatewayWith([a, b], { breaker });
  for (let i = 0; i < 3; i += 1) await gateway.getText(spec);
  assert.equal(a.calls, 3);
  assert.equal(breaker.state('a'), 'open');

  await gateway.getText(spec);
  assert.equal(a.calls, 3, 'not called while open');
});

test('breaker: opens after 3 failures in the window, lets one trial through after 10 minutes', () => {
  let now = 0;
  const breaker = createBreaker({ now: () => now });
  breaker.failure('p');
  breaker.failure('p');
  assert.equal(breaker.allow('p'), true);
  breaker.failure('p');
  assert.equal(breaker.state('p'), 'open');
  assert.equal(breaker.allow('p'), false);

  now += 10 * 60_000;
  assert.equal(breaker.state('p'), 'half-open');
  assert.equal(breaker.allow('p'), true, 'one trial');
  assert.equal(breaker.allow('p'), false, 'only one trial at a time');
  breaker.failure('p');
  assert.equal(breaker.state('p'), 'open', 'a failed trial re-opens it');

  now += 10 * 60_000;
  assert.equal(breaker.allow('p'), true);
  breaker.success('p');
  assert.equal(breaker.state('p'), 'closed');
});

test('breaker: failures older than 5 minutes do not count', () => {
  let now = 0;
  const breaker = createBreaker({ now: () => now });
  breaker.failure('p');
  breaker.failure('p');
  now += 5 * 60_000 + 1;
  breaker.failure('p');
  assert.equal(breaker.state('p'), 'closed');
});

test('a spent quota is not retried, and the provider is skipped until it resets', async () => {
  let now = 1_000_000;
  const breaker = createBreaker({ now: () => now });
  const spent = Object.assign(failure(429), { retryAfterMs: 15 * 3_600_000 });
  const flash = provider('flash', { complete: () => { throw spent; } });
  const lite = provider('lite', { complete: () => ({ text: 'from lite', tokens: 0 }) });
  const { gateway } = gatewayWith([flash, lite], { breaker });

  assert.equal((await gateway.getText(spec)).provider, 'lite');
  assert.equal(flash.calls, 1, 'no retry on a spent quota');
  assert.equal(breaker.reopensAt('flash'), now + 15 * 3_600_000);

  await gateway.getText(spec);
  assert.equal(flash.calls, 1, 'skipped while the quota is spent');

  now += 15 * 3_600_000;
  await gateway.getText(spec);
  assert.equal(flash.calls, 2, 'tried again once it resets');
});

test('a short wait (a per-minute burst) is still retried', async () => {
  const burst = provider('burst', { complete: (n) => { if (n === 1) throw Object.assign(failure(429), { retryAfterMs: 5000 }); return { text: 'ok', tokens: 0 }; } });
  const { gateway } = gatewayWith([burst]);
  assert.equal((await gateway.getText(spec)).text, 'ok');
  assert.equal(burst.calls, 2);
});

test('breaker: trip opens it for the given time', () => {
  let now = 0;
  const breaker = createBreaker({ now: () => now });
  breaker.trip('p', 3_600_000);
  assert.equal(breaker.state('p'), 'open');
  assert.equal(breaker.allow('p'), false);
  now += 3_600_000;
  assert.equal(breaker.reopensAt('p'), null);
  assert.equal(breaker.allow('p'), true, 'a trial once the time is up');
});

test('providers report the wait they asked for: Retry-After, Google RetryInfo or "retry in"', () => {
  const { retryAfterMs, httpError, DEFAULT_ORDER } = require('../../src/services/ai/providers');
  const google = '{"error":{"code":429,"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"55305s"}]}}';
  assert.equal(retryAfterMs(google), 55_305_000);
  assert.equal(retryAfterMs(JSON.stringify({ message: google })), 55_305_000, 'also when the JSON is nested in a message');
  assert.equal(retryAfterMs('Please retry in 15h21m45.5s.'), 55_305_500);
  assert.equal(retryAfterMs('', '30'), 30_000);
  assert.equal(retryAfterMs('try again later'), null);
  assert.equal(httpError('groq', 429, '{}', '120').retryAfterMs, 120_000);
  assert.equal(httpError('groq', 500, '{}', '120').retryAfterMs, null, 'only for 429');
  assert.deepEqual(DEFAULT_ORDER.slice(0, 3), ['gemini', 'gemini-lite', 'groq']);
});
