/**
 * LeadPulse CRM — Nightly Scoring Cron Job
 * Placeholder — full ML scoring implemented in Phase 7.
 */

'use strict';

const cron = require('node-cron');

// Runs at 2am every night
cron.schedule('0 2 * * *', async () => {
  console.log('[Scoring Job] Nightly lead + churn scoring started…');
  // Phase 7: call ML service to score all contacts
  console.log('[Scoring Job] Complete (Phase 7 implementation pending)');
});

console.log('[Scoring Job] Registered: nightly at 02:00');
