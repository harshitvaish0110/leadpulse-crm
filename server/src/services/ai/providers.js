/**
 * LeadPulse — LLM provider adapters.
 *
 * Every adapter has the same shape:
 *   { name, model(), enabled(),
 *     complete(msgs, { maxTokens, temperature, json, signal }) → { text, tokens },
 *     stream(msgs, { maxTokens, temperature, signal }, onDelta) → { tokens } }
 * `msgs` are { role: 'system'|'user'|'assistant', content }. Errors carry the
 * HTTP `status` when there is one; the gateway decides about retries and fallback.
 * Model ids change as providers retire them, so each one comes from the environment.
 * API keys come from secrets.js: the environment, else a key saved in Settings.
 */

'use strict';

const { GoogleGenAI } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');
const { secret, keyedClient } = require('../../lib/secrets');

const systemText = (msgs) => msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n') || undefined;
const chatTurns = (msgs) => msgs.filter((m) => m.role !== 'system');

function httpError(provider, status, body) {
  let detail = String(body ?? '');
  try {
    const { error } = JSON.parse(body);
    // OpenRouter puts the upstream provider's reason in metadata.raw.
    detail = [error?.message, error?.metadata?.raw].filter(Boolean).join(': ') || detail;
  } catch { /* not JSON */ }
  return Object.assign(new Error(`${provider} HTTP ${status}: ${detail.slice(0, 300)}`), { status });
}

// ── Gemini (@google/genai) ─────────────────────────────────────────────────────
function gemini() {
  const sdk = keyedClient('GEMINI_API_KEY', (apiKey) => new GoogleGenAI({ apiKey }));
  const model = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const request = (msgs, { maxTokens, temperature, json, signal }) => ({
    model: model(),
    contents: chatTurns(msgs).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    config: {
      systemInstruction: systemText(msgs),
      maxOutputTokens: maxTokens,
      temperature,
      // 2.5 Flash "thinks" out of the same token budget, which truncates short answers.
      ...(model().includes('flash') && { thinkingConfig: { thinkingBudget: 0 } }),
      ...(json && { responseMimeType: 'application/json' }),
      abortSignal: signal,
    },
  });
  const tokens = (usage) => usage?.totalTokenCount ?? 0;

  return {
    name: 'gemini',
    model,
    enabled: () => Boolean(secret('GEMINI_API_KEY')),
    async complete(msgs, opts) {
      const res = await sdk().models.generateContent(request(msgs, opts));
      return { text: res.text ?? '', tokens: tokens(res.usageMetadata) };
    },
    async stream(msgs, opts, onDelta) {
      let usage;
      for await (const chunk of await sdk().models.generateContentStream(request(msgs, opts))) {
        if (chunk.text) onDelta(chunk.text);
        usage = chunk.usageMetadata ?? usage;
      }
      return { tokens: tokens(usage) };
    },
  };
}

// ── OpenAI-compatible chat completions (Groq, OpenRouter, OpenAI) ────────────────

/** Yields each JSON `data:` payload of an OpenAI-style event stream. */
async function* eventData(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith('data:')) continue; // blank lines and ": keep-alive" comments
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      yield JSON.parse(data);
    }
  }
}

/**
 * @param {object} cfg
 * @param {string} cfg.name
 * @param {string} cfg.baseURL
 * @param {string} cfg.keyEnv
 * @param {string} cfg.modelEnv
 * @param {string} cfg.defaultModel
 * @param {boolean} [cfg.jsonMode=true]   supports response_format json_object
 * @param {string} [cfg.tokenParam='max_completion_tokens']
 * @param {object} [cfg.headers]
 * @param {(model: string) => object} [cfg.extra]  provider-specific body fields
 */
function openaiCompatible({ name, baseURL, keyEnv, modelEnv, defaultModel, jsonMode = true, tokenParam = 'max_completion_tokens', headers = {}, extra = () => ({}) }) {
  const model = () => process.env[modelEnv] || defaultModel;

  async function post(msgs, { maxTokens, temperature, json, signal }, stream) {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${secret(keyEnv)}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        model: model(),
        messages: msgs,
        temperature,
        [tokenParam]: maxTokens,
        stream,
        ...(json && jsonMode && { response_format: { type: 'json_object' } }),
        ...extra(model()),
      }),
    });
    if (!res.ok) throw httpError(name, res.status, await res.text().catch(() => ''));
    return res;
  }

  const tokens = (usage) => usage?.total_tokens ?? 0;

  return {
    name,
    model,
    enabled: () => Boolean(secret(keyEnv)),
    async complete(msgs, opts) {
      const data = await (await post(msgs, opts, false)).json();
      return { text: data.choices?.[0]?.message?.content ?? '', tokens: tokens(data.usage) };
    },
    async stream(msgs, opts, onDelta) {
      const res = await post(msgs, opts, true);
      let usage;
      for await (const chunk of eventData(res.body)) {
        if (chunk.error) throw httpError(name, chunk.error.code || 502, JSON.stringify(chunk));
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) onDelta(text);
        usage = chunk.usage ?? chunk.x_groq?.usage ?? usage;
      }
      return { tokens: tokens(usage) };
    },
  };
}

// ── Anthropic (@anthropic-ai/sdk) ──────────────────────────────────────────────
function anthropic() {
  // The gateway owns retries, so the SDK's own are switched off.
  const sdk = keyedClient('ANTHROPIC_API_KEY', (apiKey) => new Anthropic({ apiKey, maxRetries: 0 }));
  const model = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const body = (msgs, { maxTokens, temperature }) => ({
    model: model(), max_tokens: maxTokens, temperature, system: systemText(msgs), messages: chatTurns(msgs),
  });
  const tokens = (usage) => (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);

  return {
    name: 'anthropic',
    model,
    enabled: () => Boolean(secret('ANTHROPIC_API_KEY')),
    async complete(msgs, opts) {
      const res = await sdk().messages.create(body(msgs, opts), { signal: opts.signal });
      return { text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), tokens: tokens(res.usage) };
    },
    async stream(msgs, opts, onDelta) {
      const stream = sdk().messages.stream(body(msgs, opts), { signal: opts.signal });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onDelta(event.delta.text);
      }
      return { tokens: tokens((await stream.finalMessage()).usage) };
    },
  };
}

// ── Mock (AI_MOCK=true): deterministic, feature-shaped output for tests and demos ─
function mock() {
  const textFor = (opts) => (typeof opts.mock === 'string' ? opts.mock : 'This is a mock AI response from LeadPulse.');
  return {
    name: 'mock',
    model: () => 'mock',
    enabled: () => true,
    async complete(_msgs, opts) {
      return { text: opts.json ? JSON.stringify(opts.mock ?? {}) : textFor(opts), tokens: 0 };
    },
    async stream(_msgs, opts, onDelta) {
      for (const word of textFor(opts).split(/(?<= )/)) {
        opts.signal?.throwIfAborted();
        onDelta(word);
        await new Promise((resolve) => setImmediate(resolve));
      }
      return { tokens: 0 };
    },
  };
}

const PROVIDERS = {
  gemini: gemini(),
  groq: openaiCompatible({
    name: 'groq', baseURL: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'openai/gpt-oss-120b',
    // gpt-oss reasons out of the completion budget; keep that short for CRM-sized answers.
    extra: (model) => (model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
  }),
  openrouter: openaiCompatible({
    name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'google/gemma-4-31b-it:free',
    jsonMode: false, tokenParam: 'max_tokens', // free models vary in support; JSON is asked for in the prompt
    headers: { 'HTTP-Referer': 'https://leadpulse-crm.app', 'X-Title': 'LeadPulse CRM' },
  }),
  anthropic: anthropic(),
  openai: openaiCompatible({
    name: 'openai', baseURL: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-4o-mini',
  }),
};

const DEFAULT_ORDER = ['gemini', 'groq', 'openrouter', 'anthropic', 'openai'];
const MOCK = mock();

/** Enabled providers in AI_PROVIDER_ORDER (or the default order); only the mock when AI_MOCK=true. */
function providerChain(env = process.env) {
  if (env.AI_MOCK === 'true') return [MOCK];
  const order = env.AI_PROVIDER_ORDER ? env.AI_PROVIDER_ORDER.split(',').map((s) => s.trim().toLowerCase()) : DEFAULT_ORDER;
  return order.map((name) => PROVIDERS[name]).filter((p) => p?.enabled());
}

module.exports = { PROVIDERS, DEFAULT_ORDER, providerChain, eventData, httpError };
