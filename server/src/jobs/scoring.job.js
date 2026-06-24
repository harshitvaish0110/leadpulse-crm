/**
 * LeadPulse — Nightly Scoring Job
 *
 * Runs at 2:00 AM IST every night (configurable via env).
 * Also runs 8 seconds after server startup to populate fresh data.
 *
 * For each LEAD/ACTIVE contact:
 *   1. Calls ML service for churn probability
 *   2. Calls ML service for win probability (on open deals)
 *   3. Recalculates lead score using scoring.service
 *   4. Emits churn alert via Socket.io if risk > 70%
 */

'use strict';

const cron   = require('node-cron');
const axios  = require('axios');
const { prisma } = require('../lib/prisma');
const { calculateAndSaveLeadScore } = require('../services/scoring.service');

const ML_URL     = process.env.ML_SERVICE_URL || 'http://localhost:5001';
const CRON_EXPR  = process.env.SCORING_CRON   || '0 2 * * *';
const TZ         = process.env.TZ             || 'Asia/Kolkata';
const BATCH_SIZE = 20; // Process contacts in batches to avoid overwhelming ML service

const STAGE_ORDER = {
  LEAD: 0, CONTACTED: 1, DEMO: 2, PROPOSAL: 3, NEGOTIATION: 4,
};

async function scoreContact(contact, now) {
  const lastAct   = contact.activities[0];
  const daysSince = lastAct ? Math.floor((now - new Date(lastAct.occurredAt)) / 86_400_000) : 999;
  const last30    = contact.activities.filter(a => (now - new Date(a.occurredAt)) < 30 * 86_400_000).length;
  const last90    = contact.activities.filter(a => (now - new Date(a.occurredAt)) < 90 * 86_400_000).length;
  const openDeal  = contact.deals.find(d => !['CLOSED_WON', 'CLOSED_LOST'].includes(d.stage));
  const totalVal  = contact.deals.reduce((s, d) => s + Number(d.value || 0), 0);

  // ── Churn prediction ───────────────────────────────────────────────────────
  try {
    const churnFeatures = [
      daysSince, last30, last90,
      contact.sentimentScore ?? 0.5,
      contact.leadScore ?? 0,
      contact.deals.length,
      totalVal,
      openDeal ? 1 : 0,
    ];
    const { data: churnData } = await axios.post(
      `${ML_URL}/predict/churn`,
      { features: churnFeatures },
      { timeout: 8_000 }
    );

    const newChurnRisk = churnData.risk ?? contact.churnRisk;
    await prisma.contact.update({
      where: { id: contact.id },
      data:  { churnRisk: newChurnRisk },
    });

    // Emit real-time alert for high-risk contacts
    const io = global.io;
    if (newChurnRisk > 0.7 && io && contact.ownerId) {
      io.to(contact.ownerId).emit('contact:churn_alert', {
        contactId: contact.id,
        name:      `${contact.firstName} ${contact.lastName}`,
        churnRisk: newChurnRisk,
      });
    }
  } catch (e) {
    console.warn(`[Scoring] Churn prediction skipped for ${contact.id}:`, e.message);
  }

  // ── Win probability (open deal only) ──────────────────────────────────────
  if (openDeal) {
    try {
      const daysInStage = Math.floor((now - new Date(openDeal.updatedAt)) / 86_400_000);
      const dealFeatures = [
        STAGE_ORDER[openDeal.stage] ?? 0,
        Number(openDeal.value ?? 0),
        daysInStage,
        contact.activities.length,
        last30,
        100, // default company size
      ];
      const { data: winData } = await axios.post(
        `${ML_URL}/predict/win_prob`,
        { features: dealFeatures },
        { timeout: 8_000 }
      );

      if (winData.probability !== undefined) {
        await prisma.deal.update({
          where: { id: openDeal.id },
          data:  { winProbability: Math.round(winData.probability * 100) },
        });

        // Notify deal owner of stage update
        const io = global.io;
        if (io && openDeal.ownerId) {
          io.to(openDeal.ownerId).emit('deal:score_updated', {
            dealId:      openDeal.id,
            winProb:     winData.probability,
          });
        }
      }
    } catch (e) {
      console.warn(`[Scoring] Win prob skipped for deal ${openDeal.id}:`, e.message);
    }
  }

  // ── Lead score (rules-based + Claude) ─────────────────────────────────────
  try {
    await calculateAndSaveLeadScore(contact.id);
  } catch (e) {
    console.warn(`[Scoring] Lead score skipped for ${contact.id}:`, e.message);
  }
}

async function runNightlyScoring() {
  console.log('[Scoring Job] Starting nightly ML scoring...');
  const startTime = Date.now();

  const contacts = await prisma.contact.findMany({
    where:   { status: { in: ['LEAD', 'ACTIVE'] } },
    include: {
      activities: { orderBy: { occurredAt: 'desc' }, take: 90 },
      deals:      true,
    },
  });

  console.log(`[Scoring Job] Processing ${contacts.length} contacts in batches of ${BATCH_SIZE}...`);

  let updated = 0;
  let failed  = 0;
  const now   = Date.now();

  // Process in batches
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (contact) => {
        try {
          await scoreContact(contact, now);
          updated++;
        } catch (e) {
          failed++;
          console.error(`[Scoring Job] Failed for contact ${contact.id}:`, e.message);
        }
      })
    );
    // Small delay between batches to be gentle on the ML service
    if (i + BATCH_SIZE < contacts.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Scoring Job] ✓ Done — ${updated} updated, ${failed} failed (${elapsed}s)`);
}

// ── Schedule ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  cron.schedule(CRON_EXPR, runNightlyScoring, { timezone: TZ });
  console.log(`[Scoring Job] Scheduled: "${CRON_EXPR}" (${TZ})`);

  // Run after 8s delay on startup so DB is ready
  setTimeout(runNightlyScoring, 8_000);
}

module.exports = { runNightlyScoring };
