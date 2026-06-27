/**
 * LeadPulse — Multi-Provider AI Service
 *
 * Provider chain (in order):
 *   1. Google Gemini  (GEMINI_API_KEY)     — primary, best quality
 *   2. Groq / Llama   (GROQ_API_KEY)       — first fallback, very fast
 *   3. OpenRouter     (OPENROUTER_API_KEY) — second fallback, many free models
 *
 * Any provider whose API key is missing in .env is silently skipped.
 * This means you can deploy with just one key and add more later.
 *
 * Public API (unchanged from the old claude.service.js):
 *   getText(prompt, systemPrompt?, maxTokens?)  → Promise<string>
 *   getJSON(prompt, systemPrompt?)              → Promise<object>
 *   streamResponse(prompt, systemPrompt?, res)  → writes SSE to res
 *   logAICall(...)                              → fire-and-forget DB log
 *
 * Get free keys:
 *   Gemini    → https://aistudio.google.com/apikey
 *   Groq      → https://console.groq.com
 *   OpenRouter→ https://openrouter.ai
 */

'use strict';

const { GoogleGenAI } = require('@google/genai');
const Groq            = require('groq-sdk');
const axios           = require('axios');

// ── Lazy-init clients ─────────────────────────────────────────────────────────
let _gemini = null;
let _groq   = null;

function getGemini() {
  if (!_gemini) _gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _gemini;
}

function getGroq() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const RETRY_DELAY  = 2000; // ms between retries per provider
const RETRYABLE    = new Set([429, 500, 503, 529]);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function stripFences(text) {
  return text.replace(/```(?:json)?\n?/g, '').replace(/\n?```/g, '').trim();
}

// ── Provider implementations ──────────────────────────────────────────────────

const PROVIDERS = [
  // ── 1. Google Gemini ────────────────────────────────────────────────────────
  {
    name:      'Gemini',
    available: () => !!process.env.GEMINI_API_KEY,

    async getText(prompt, systemPrompt, maxTokens) {
      const ai = getGemini();
      const response = await ai.models.generateContent({
        model:    'models/gemini-2.5-flash',
        config: {
          systemInstruction: systemPrompt || 'You are a helpful CRM assistant.',
          maxOutputTokens:   maxTokens || 400,
          temperature:       0.5,
        },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      return response.text;
    },

    async getJSON(prompt, systemPrompt) {
      const ai = getGemini();
      const response = await ai.models.generateContent({
        model:    'models/gemini-2.5-flash',
        config: {
          systemInstruction:
            (systemPrompt || 'You are a helpful assistant.') +
            ' IMPORTANT: Reply with valid JSON only. No markdown fences, no explanation.',
          maxOutputTokens:  800,
          temperature:      0.2,
          responseMimeType: 'application/json',
        },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      return JSON.parse(stripFences(response.text));
    },

    async stream(prompt, systemPrompt, res) {
      const ai = getGemini();
      const response = await ai.models.generateContentStream({
        model:    'models/gemini-2.5-flash',
        config: {
          systemInstruction: systemPrompt || 'You are a helpful CRM assistant.',
          maxOutputTokens:   1200,
          temperature:       0.7,
        },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      for await (const chunk of response) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
    },
  },

  // ── 2. Groq / Llama 3.1 ─────────────────────────────────────────────────────
  {
    name:      'Groq',
    available: () => !!process.env.GROQ_API_KEY,

    _buildMessages(prompt, systemPrompt) {
      const msgs = [];
      if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
      msgs.push({ role: 'user', content: prompt });
      return msgs;
    },

    async getText(prompt, systemPrompt, maxTokens) {
      const groq = getGroq();
      const res  = await groq.chat.completions.create({
        model:       'llama-3.3-70b-versatile',
        messages:    this._buildMessages(prompt, systemPrompt || 'You are a helpful CRM assistant.'),
        temperature: 0.5,
        max_tokens:  maxTokens || 400,
      });
      return res.choices[0].message.content;
    },

    async getJSON(prompt, systemPrompt) {
      const groq = getGroq();
      const res  = await groq.chat.completions.create({
        model:           'llama-3.3-70b-versatile',
        messages:        this._buildMessages(prompt, systemPrompt || 'You are a helpful assistant.'),
        temperature:     0.2,
        max_tokens:      800,
        response_format: { type: 'json_object' },
      });
      return JSON.parse(res.choices[0].message.content);
    },

    async stream(prompt, systemPrompt, res) {
      const groq = getGroq();
      const stream = await groq.chat.completions.create({
        model:       'llama-3.3-70b-versatile',
        messages:    this._buildMessages(prompt, systemPrompt || 'You are a helpful CRM assistant.'),
        temperature: 0.7,
        max_tokens:  1200,
        stream:      true,
      });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    },
  },

  // ── 3. OpenRouter (free Llama 3.1 8B) ────────────────────────────────────────
  {
    name:      'OpenRouter',
    available: () => !!process.env.OPENROUTER_API_KEY,

    _headers() {
      return {
        Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://leadpulse-crm.app',
        'X-Title':      'LeadPulse CRM',
      };
    },

    _buildMessages(prompt, systemPrompt) {
      const msgs = [];
      if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
      msgs.push({ role: 'user', content: prompt });
      return msgs;
    },

    async getText(prompt, systemPrompt, maxTokens) {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model:       'google/gemma-4-31b-it:free',
          messages:    this._buildMessages(prompt, systemPrompt || 'You are a helpful CRM assistant.'),
          temperature: 0.5,
          max_tokens:  maxTokens || 400,
        },
        { headers: this._headers(), timeout: 30000 }
      );
      return res.data.choices[0].message.content;
    },

    async getJSON(prompt, systemPrompt) {
      // Free tier may not support response_format — use prompt-based JSON
      const jsonPrompt = `${prompt}\n\nIMPORTANT: Reply with valid JSON only. No markdown, no explanation.`;
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model:       'google/gemma-4-31b-it:free',
          messages:    this._buildMessages(jsonPrompt, systemPrompt || 'You are a helpful assistant.'),
          temperature: 0.2,
          max_tokens:  800,
        },
        { headers: this._headers(), timeout: 30000 }
      );
      return JSON.parse(stripFences(res.data.choices[0].message.content));
    },

    async stream(prompt, systemPrompt, res) {
      // OpenRouter free tier: do a regular (non-streaming) call, then emit as one chunk
      const text = await this.getText(prompt, systemPrompt, 1200);
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    },
  },
];

// ── Core fallback engine ──────────────────────────────────────────────────────

/**
 * Try each configured provider in order.
 * Per provider: up to 2 attempts with a 2-second pause on retryable errors.
 * Non-retryable errors (400, 401, 403) skip to the next provider immediately.
 *
 * @param {'getText'|'getJSON'|'stream'} method
 * @param {...any} args  arguments forwarded to the provider method
 */
async function withFallback(method, ...args) {
  const available = PROVIDERS.filter(p => p.available());

  if (available.length === 0) {
    throw new Error(
      'No AI provider configured. Set GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY in .env'
    );
  }

  let lastErr;

  for (const provider of available) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[AI] ${provider.name} → ${method} (attempt ${attempt})`);
        return await provider[method](...args);
      } catch (err) {
        lastErr = err;
        const status = err.status || err.response?.status || err.code || 0;
        console.warn(`[AI] ${provider.name} failed: HTTP ${status} — ${err.message}`);

        if (!RETRYABLE.has(Number(status))) break; // non-retryable — skip to next provider
        if (attempt < 2) {
          console.warn(`[AI] Retrying ${provider.name} in ${RETRY_DELAY}ms...`);
          await sleep(RETRY_DELAY);
        }
      }
    }
    console.warn(`[AI] ${provider.name} exhausted, trying next provider...`);
  }

  throw lastErr;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a plain-text AI response.
 * @param {string} prompt
 * @param {string} [systemPrompt]
 * @param {number} [maxTokens=400]
 * @returns {Promise<string>}
 */
async function getText(prompt, systemPrompt = '', maxTokens = 400) {
  return withFallback('getText', prompt, systemPrompt, maxTokens);
}

/**
 * Get a structured JSON object from the AI.
 * @param {string} prompt
 * @param {string} [systemPrompt]
 * @returns {Promise<object>}
 */
async function getJSON(prompt, systemPrompt = '') {
  return withFallback('getJSON', prompt, systemPrompt);
}

/**
 * Stream an AI response as SSE to the HTTP response object.
 * Sets headers, writes chunks, and calls res.end().
 * @param {string} prompt
 * @param {string} [systemPrompt]
 * @param {object} res  Express response object
 */
async function streamResponse(prompt, systemPrompt = '', res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_URL || '*');
  res.flushHeaders?.();

  try {
    await withFallback('stream', prompt, systemPrompt, res);
  } catch (err) {
    console.error('[AI streamResponse] All providers failed:', err.message);
    res.write(
      `data: ${JSON.stringify({ text: '\n[AI temporarily unavailable — please try again in a moment]' })}\n\n`
    );
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * Log an AI feature call to the database (fire-and-forget, never throws).
 */
async function logAICall(feature, userId, input, output, tokensUsed = 0, contactId = null, dealId = null) {
  try {
    const { prisma } = require('../lib/prisma');
    await prisma.aiLog.create({
      data: {
        feature,
        userId,
        input:      JSON.stringify(input),
        output:     output ? JSON.stringify(output) : null,
        tokensUsed: tokensUsed || 0,
        contactId:  contactId || null,
        dealId:     dealId    || null,
      },
    });
  } catch (e) {
    console.warn('[AI Log] Failed to write:', e.message);
  }
}

module.exports = { getText, getJSON, streamResponse, logAICall };
