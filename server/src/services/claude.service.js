/**
 * LeadPulse — AI Service (Google Gemini via @google/genai)
 *
 * Key design decisions:
 *  - Tries a list of fallback models in order if one is busy/unavailable.
 *  - Retries up to 3 times with 2-second delay between attempts.
 *  - getJSON returns parsed object; streamResponse writes SSE to res.
 *  - getText returns plain string.
 *
 * Free key: https://aistudio.google.com/apikey
 */

'use strict';

const { GoogleGenAI } = require('@google/genai');

// Ordered list — first available/non-busy model wins
// Confirmed working on this API key (AQ. prefix = GCP project key)
const MODELS = [
  'models/gemini-2.5-flash',      // primary — best quality
  'models/gemini-2.5-flash-lite', // fallback — lighter, still works
];

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // ms

let _ai = null;

function getAI() {
  if (_ai) return _ai;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-gemini-api-key-here') {
    throw new Error(
      'GEMINI_API_KEY not set. Get a FREE key at https://aistudio.google.com/apikey'
    );
  }
  _ai = new GoogleGenAI({ apiKey });
  return _ai;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Try a Gemini call across multiple models with retries.
 * @param {Function} fn - async fn(ai, model) => result
 */
async function withFallback(fn) {
  const ai = getAI();
  let lastErr;

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn(ai, model);
      } catch (err) {
        const status = err.status || err.code || 0;
        const isRetryable = status === 503 || status === 429 || status === 500;
        lastErr = err;

        if (!isRetryable) break; // wrong model / auth — skip to next model
        if (attempt < MAX_RETRIES) {
          console.warn(`[Gemini] ${model} attempt ${attempt} failed (${status}), retrying in ${RETRY_DELAY}ms...`);
          await sleep(RETRY_DELAY);
        }
      }
    }
    console.warn(`[Gemini] Skipping ${model}, trying next fallback...`);
  }

  throw lastErr;
}

/**
 * Stream a Gemini response as SSE to the HTTP response object.
 */
async function streamResponse(prompt, systemPrompt = '', res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_URL || '*');
  res.flushHeaders?.();

  try {
    await withFallback(async (ai, model) => {
      const response = await ai.models.generateContentStream({
        model,
        config: {
          systemInstruction: systemPrompt || 'You are a helpful CRM assistant.',
          maxOutputTokens: 1200,
          temperature: 0.7,
        },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      for await (const chunk of response) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
    });
  } catch (err) {
    console.error('[Gemini streamResponse error]', err.message);
    res.write(`data: ${JSON.stringify({ text: '\n[AI temporarily unavailable — please try again in a moment]' })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * Get a structured JSON response from Gemini.
 */
async function getJSON(prompt, systemPrompt = '') {
  return withFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      config: {
        systemInstruction:
          (systemPrompt || 'You are a helpful assistant.') +
          ' IMPORTANT: Reply with valid JSON only. No markdown fences, no explanation.',
        maxOutputTokens: 800,
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    let text = response.text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/```(?:json)?/g, '').trim();
    }
    return JSON.parse(text);
  });
}

/**
 * Get a plain-text (non-streaming) response from Gemini.
 */
async function getText(prompt, systemPrompt = '', maxTokens = 400) {
  return withFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      config: {
        systemInstruction: systemPrompt || 'You are a helpful CRM assistant.',
        maxOutputTokens: maxTokens,
        temperature: 0.5,
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return response.text;
  });
}

/**
 * Log an AI feature call to the database (fire-and-forget).
 */
async function logAICall(feature, userId, input, output, tokensUsed = 0, contactId = null, dealId = null) {
  try {
    const { prisma } = require('../lib/prisma');
    await prisma.aiLog.create({
      data: {
        feature,
        userId,
        input: JSON.stringify(input),
        output: output ? JSON.stringify(output) : null,
        tokensUsed: tokensUsed || 0,
        contactId: contactId || null,
        dealId: dealId || null,
      },
    });
  } catch (e) {
    console.warn('[AI Log] Failed to write:', e.message);
  }
}

module.exports = { streamResponse, getJSON, getText, logAICall };
