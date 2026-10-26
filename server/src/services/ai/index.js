/**
 * LeadPulse — AI gateway. Every LLM call in the app goes through here.
 *
 * A call is described by a prompt spec from prompts.js:
 *   { feature, messages, maxTokens, temperature, json?, schema?, normalise?, mock? }
 *
 * Providers are tried in order (providers.js). Per provider: one retry after 2 s
 * on a transient error (429/5xx, connection reset), otherwise straight to the next
 * provider. Providers with an open circuit breaker are skipped. A stream never
 * falls back once text has reached the client — the user would see it twice — so a
 * mid-stream failure ends the stream with an `error` event instead. A client that
 * disconnects aborts the upstream request. Every attempt is written to `ai_logs`.
 */

'use strict';

const { setTimeout: sleep } = require('node:timers/promises');
const { ApiError } = require('../../middleware/error.middleware');
const { sseStart, sseSend, sseEnd, clientGone } = require('../../lib/sse');
const { createBreaker } = require('./breaker');
const { providerChain, PROVIDERS, DEFAULT_ORDER } = require('./providers');
const { logAICall } = require('./logging');

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const RETRYABLE_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

const isRetryable = (err) => RETRYABLE_STATUS.has(Number(err?.status)) || RETRYABLE_CODES.has(err?.code ?? err?.cause?.code);

const unavailable = (cause) => Object.assign(
  new ApiError('The AI service is temporarily unavailable. Please try again in a moment.', 502, 'AI_UNAVAILABLE'),
  { cause },
);

/** Strips code fences, parses, then applies the feature's normaliser (which throws on bad shapes). */
function parseJSON(text, normalise = (v) => v) {
  try {
    const raw = JSON.parse(String(text).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
    return { ok: true, value: normalise(raw) };
  } catch (err) {
    return { ok: false, err };
  }
}

/**
 * @param {object}   [deps]
 * @param {() => object[]} [deps.chain]     enabled providers, in order
 * @param {object}   [deps.breaker]
 * @param {Function} [deps.log]
 * @param {number}   [deps.retryDelayMs]
 * @param {{ complete: number, stream: number }} [deps.timeoutMs]
 */
function createGateway({
  chain = providerChain,
  breaker = createBreaker(),
  log = logAICall,
  retryDelayMs = 2000,
  timeoutMs = { complete: 45_000, stream: 90_000 },
} = {}) {
  /**
   * Runs `call(provider, signal, state)` down the provider chain.
   * `state.streamed` is set by stream() once any text has been delivered.
   */
  async function run(spec, opts, kind, call) {
    const providers = chain();
    if (!providers.length) {
      throw new ApiError('No AI provider is configured. Add GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY.', 503, 'AI_NOT_CONFIGURED');
    }

    const state = { streamed: false };
    let failed = null; // the last failed attempt, logged once we know what followed it
    let lastErr;

    for (const provider of providers) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (!breaker.allow(provider.name)) break;
        if (failed) log({ ...failed, status: 'fallback' });
        failed = null;

        const entry = { ...opts.log, feature: spec.feature, provider: provider.name, model: provider.model() };
        const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs[kind])].filter(Boolean));
        const started = Date.now();
        try {
          const result = await call(provider, signal, state);
          breaker.success(provider.name);
          log({ ...entry, status: 'ok', latencyMs: Date.now() - started, tokensUsed: result.tokens, output: result.text });
          return { ...result, provider: provider.name };
        } catch (err) {
          const latencyMs = Date.now() - started;
          if (opts.signal?.aborted) {
            log({ ...entry, status: 'aborted', latencyMs });
            throw Object.assign(new Error('Request aborted by the client'), { name: 'AbortError' });
          }
          lastErr = err;
          breaker.failure(provider.name);
          if (state.streamed) {
            log({ ...entry, status: 'error', latencyMs, errorMessage: err.message });
            throw unavailable(err);
          }
          failed = { ...entry, latencyMs, errorMessage: err.message };
          if (attempt === 2 || !isRetryable(err)) break;
          await sleep(retryDelayMs, undefined, opts.signal ? { signal: opts.signal } : undefined);
        }
      }
    }
    if (failed) log({ ...failed, status: 'error' });
    throw unavailable(lastErr);
  }

  const params = (spec) => ({ maxTokens: spec.maxTokens ?? 600, temperature: spec.temperature ?? 0.5, mock: spec.mock });

  /** @returns {Promise<{ text: string, provider: string, tokens: number }>} */
  function getText(spec, opts = {}) {
    return run(spec, opts, 'complete', (p, signal) => p.complete(spec.messages, { ...params(spec), json: spec.json, signal }));
  }

  /**
   * JSON answer, normalised by `spec.normalise`. One repair round-trip if the first
   * answer doesn't parse or validate; then 502 AI_BAD_OUTPUT.
   * @returns {Promise<{ data: object, provider: string }>}
   */
  async function getJSON(spec, opts = {}) {
    const ask = (messages) => run(spec, opts, 'complete', (p, signal) => p.complete(messages, { ...params(spec), json: true, signal }));

    const first = await ask(spec.messages);
    const parsed = parseJSON(first.text, spec.normalise);
    if (parsed.ok) return { data: parsed.value, provider: first.provider };

    const repair = await ask([
      ...spec.messages,
      { role: 'assistant', content: first.text || '(empty)' },
      { role: 'user', content: `That was not valid. Return only valid JSON matching: ${spec.schema || 'the requested format'}` },
    ]);
    const repaired = parseJSON(repair.text, spec.normalise);
    if (repaired.ok) return { data: repaired.value, provider: repair.provider };
    throw new ApiError('The AI answered in an unexpected format. Please try again.', 502, 'AI_BAD_OUTPUT');
  }

  /** Streams text to `onDelta`. @returns {Promise<{ text: string, provider: string, tokens: number }>} */
  function stream(spec, opts, onDelta) {
    return run(spec, opts, 'stream', async (p, signal, state) => {
      const parts = [];
      const { tokens } = await p.stream(spec.messages, { ...params(spec), signal }, (text) => {
        state.streamed = true;
        parts.push(text);
        onDelta(text);
      });
      return { text: parts.join(''), tokens };
    });
  }

  /**
   * Streams the answer as SSE (`delta`… then `done { provider }` or `error { code, message }`)
   * and ends the response. Validation must happen before this is called.
   * @returns {Promise<object|null>} the stream result, or null if it failed or the client left
   */
  async function streamToResponse(res, spec, opts = {}) {
    const signal = clientGone(res);
    sseStart(res);
    try {
      const result = await stream(spec, { ...opts, signal }, (text) => sseSend(res, 'delta', { text }));
      sseSend(res, 'done', { provider: result.provider });
      return result;
    } catch (err) {
      if (!signal.aborted) {
        const known = err instanceof ApiError;
        sseSend(res, 'error', {
          code: known ? err.code : 'AI_UNAVAILABLE',
          message: known ? err.message : 'The AI service is temporarily unavailable. Please try again.',
        });
      }
      return null;
    } finally {
      sseEnd(res);
    }
  }

  /** Breaker state per provider ('disabled' without a key), for /health/ready. */
  function providerStates() {
    if (process.env.AI_MOCK === 'true') return { mock: 'closed' };
    return Object.fromEntries(DEFAULT_ORDER.map((name) => [name, PROVIDERS[name].enabled() ? breaker.state(name) : 'disabled']));
  }

  return { getText, getJSON, stream, streamToResponse, providerStates };
}

module.exports = { ...createGateway(), createGateway, parseJSON, isRetryable };
