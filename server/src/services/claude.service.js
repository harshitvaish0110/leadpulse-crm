/**
 * LeadPulse — AI Service (Google Gemini via @google/genai)
 *
 * Uses the NEW official google-genai SDK (not the deprecated @google/generative-ai).
 * Model: gemini-2.0-flash — FREE tier: 15 req/min, 1M tokens/day.
 * Get key FREE at: https://aistudio.google.com/apikey
 *
 * Same export surface as before:
 *   streamResponse(prompt, systemPrompt, res)
 *   getJSON(prompt, systemPrompt)
 *   getText(prompt, systemPrompt, maxTokens)
 *   logAICall(...)
 */

'use strict';

const { GoogleGenAI } = require('@google/genai');

const MODEL       = 'models/gemini-2.5-flash';   // free quota available on this key
const MINI_MODEL  = 'models/gemini-2.0-flash-lite'; // faster for short responses

let _ai = null;

function getAI() {
  if (_ai) return _ai;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-gemini-api-key-here') {
    throw new Error(
      'GEMINI_API_KEY not set. Get a FREE key at https://aistudio.google.com/apikey and add it to your .env file'
    );
  }
  _ai = new GoogleGenAI({ apiKey });
  return _ai;
}

/**
 * Stream a Gemini response as SSE to the HTTP response object.
 */
async function streamResponse(prompt, systemPrompt = '', res) {
  const ai = getAI();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_URL || '*');
  res.flushHeaders?.();

  try {
    const response = await ai.models.generateContentStream({
      model:  MODEL,
      config: {
        systemInstruction: systemPrompt || 'You are a helpful CRM assistant.',
        maxOutputTokens:   1200,
        temperature:       0.7,
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    for await (const chunk of response) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }
  } catch (err) {
    console.error('[Gemini stream error]', err.message);
    res.write(`data: ${JSON.stringify({ text: '\n[AI service error — check GEMINI_API_KEY]' })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * Get a structured JSON response from Gemini.
 */
async function getJSON(prompt, systemPrompt = '') {
  const ai = getAI();

  const response = await ai.models.generateContent({
    model:  MODEL,
    config: {
      systemInstruction: (systemPrompt || 'You are a helpful assistant.') +
        ' IMPORTANT: Reply with valid JSON only. No markdown fences, no explanation.',
      maxOutputTokens:    800,
      temperature:        0.2,
      responseMimeType:   'application/json',
    },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  let text = response.text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/```(?:json)?/g, '').trim();
  }
  return JSON.parse(text);
}

/**
 * Get a plain-text (non-streaming) response from Gemini.
 */
async function getText(prompt, systemPrompt = '', maxTokens = 400) {
  const ai = getAI();

  const response = await ai.models.generateContent({
    model:  MINI_MODEL,
    config: {
      systemInstruction: systemPrompt || 'You are a helpful CRM assistant.',
      maxOutputTokens:   maxTokens,
      temperature:       0.5,
    },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  return response.text;
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

module.exports = { streamResponse, getJSON, getText, logAICall };
