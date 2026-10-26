/**
 * LeadPulse — Call recordings → transcript → structured notes.
 *
 * The upload stores the audio privately and creates a TRANSCRIPT activity with
 * `metadata.status: 'processing'`; the `transcribe` job then sends the audio to
 * Groq Whisper, turns the transcript into notes (summary, action items,
 * objections, pricing, topics, next steps) through the AI gateway and queues
 * sentiment scoring of the summary. Transient failures are retried; the last
 * failure marks the activity `failed` with a reason, and the user can retry.
 */

'use strict';

const path = require('path');
const Groq = require('groq-sdk');
const { toFile } = require('groq-sdk');
const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const storage = require('../lib/storage');
const { emitScoped } = require('../lib/realtime');
const { notify } = require('../lib/notify');
const { enqueue } = require('../queues/queue');
const triggers = require('../queues/triggers');
const ai = require('./ai');
const prompts = require('./ai/prompts');
const { secret, keyedClient } = require('../lib/secrets');

const MAX_CONCURRENT = 2; // Groq's free tier limits audio requests; keep a burst of uploads queued here
const STUCK_AFTER_MS = 2 * 60_000;

const groq = keyedClient('GROQ_API_KEY', (apiKey) => new Groq({ apiKey, maxRetries: 0 }));

let running = 0;
const waiting = [];
async function withSlot(fn) {
  while (running >= MAX_CONCURRENT) await new Promise((resolve) => { waiting.push(resolve); });
  running += 1;
  try {
    return await fn();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/** Queues transcription of one recording (retried with 30 s, then 60 s backoff). */
function queueTranscription(activityId) {
  return enqueue('transcribe', { activityId }, { dedupe: `transcribe:${activityId}`, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } });
}

const SELECT = { id: true, audioKey: true, metadata: true, contactId: true, dealId: true, userId: true, type: true, notes: true, contact: { select: { ownerId: true } } };

async function markFailed(activity, reason) {
  await prisma.activity.update({
    where: { id: activity.id },
    data: { metadata: { ...(activity.metadata ?? {}), status: 'failed', error: reason } },
  });
  emitScoped([activity.userId, activity.contact.ownerId], 'activity:transcribed', { activityId: activity.id, contactId: activity.contactId, failed: true });
  logger.warn({ event: 'transcription_failed', activityId: activity.id, reason }, 'Transcription failed');
  return { failed: reason };
}

/**
 * Job `transcribe`. Throws (so the job is retried) except on its last attempt,
 * where the failure is recorded on the activity instead.
 */
async function transcribe(activityId, job) {
  const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: SELECT });
  if (!activity?.audioKey) return { skipped: 'no recording' };
  if (activity.metadata?.status === 'done') return { skipped: 'already transcribed' };
  if (!secret('GROQ_API_KEY')) return markFailed(activity, 'Transcription is not configured: add GROQ_API_KEY.');

  try {
    return await withSlot(async () => {
      const audio = await storage.read(activity.audioKey);
      const result = await groq().audio.transcriptions.create({
        file: await toFile(audio, `call${path.extname(activity.audioKey) || '.webm'}`),
        model: process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
        response_format: 'verbose_json',
      }, { timeout: 120_000 });
      const transcript = String(result.text ?? '').trim();
      if (!transcript) return markFailed(activity, 'No speech was detected in the recording.');

      const { data } = await ai.getJSON(prompts.transcriptExtract({ transcript }), {
        log: { userId: activity.userId, contactId: activity.contactId, dealId: activity.dealId, input: { activityId } },
      });
      const minutes = result.duration ? Math.max(1, Math.round(result.duration / 60)) : null;
      await prisma.activity.update({
        where: { id: activityId },
        data: {
          transcript,
          notes: data.summary,
          durationMinutes: minutes,
          metadata: { status: 'done', provider: 'groq', durationSeconds: result.duration ?? null, ...data },
        },
      });

      enqueue('sentiment', { activityId }, { dedupe: `sentiment:${activityId}` }); // scores the summary
      triggers.afterActivityChange(activity); // reindex with the transcript, rescore the contact
      emitScoped([activity.userId, activity.contact.ownerId], 'activity:transcribed', { activityId, contactId: activity.contactId });
      await notify([activity.userId], {
        type: 'transcript', title: 'Call transcribed', message: data.summary.slice(0, 160),
        link: `/contacts/${activity.contactId}?tab=activities`, data: { activityId },
      });
      return { words: transcript.split(/\s+/).length, minutes };
    });
  } catch (err) {
    const lastAttempt = !job || job.attemptsMade + 1 >= (job.opts?.attempts ?? 1);
    if (!lastAttempt) throw err;
    const reason = err.status === 429 ? 'The transcription quota is used up for now. Try again later.' : `Transcription failed: ${String(err.message).slice(0, 200)}`;
    return markFailed(activity, reason);
  }
}

/** Worker start: re-queues recordings left in `processing` by a restart. */
async function recoverStuck() {
  const stuck = await prisma.activity.findMany({
    where: { type: 'TRANSCRIPT', audioKey: { not: null }, createdAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) }, metadata: { path: ['status'], equals: 'processing' } },
    select: { id: true },
  });
  for (const { id } of stuck) await queueTranscription(id);
  if (stuck.length) logger.info({ event: 'transcriptions_recovered', count: stuck.length }, 'Re-queued interrupted transcriptions');
  return stuck.length;
}

module.exports = { transcribe, queueTranscription, recoverStuck };
