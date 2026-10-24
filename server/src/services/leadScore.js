/**
 * LeadPulse — Lead score rules.
 *
 * Pure functions with no I/O, shared by the seed, the scoring job and tests.
 *
 *   Recency (days since latest activity)   0–7 → 40 · 8–30 → 20 · >30 / none → 0
 *   Volume  (activities in last 30 days)   0 → 0 · 1–3 → 10 · 4–10 → 20 · >10 → 30
 *   Value   (sum of open deal values)      0 → 0 · <10k → 10 · 10k–50k → 20 · >50k → 30
 *   Stage   (any open deal at PROPOSAL or NEGOTIATION)  +20
 *   Label   HOT > 80 · WARM 40–80 · COLD < 40   (max 120)
 */

'use strict';

const DAY_MS = 86_400_000;
const LATE_STAGES = new Set(['PROPOSAL', 'NEGOTIATION']);

/**
 * @param {object}   input
 * @param {Date|string|null} input.lastActivityAt
 * @param {number}   input.activityCount30d
 * @param {{ value: number|string, stage: string }[]} [input.openDeals]
 * @param {Date}     [input.now]
 * @returns {{ score: number, label: 'HOT'|'WARM'|'COLD', components: object }}
 */
function computeLeadScore({ lastActivityAt, activityCount30d = 0, openDeals = [], now = new Date() }) {
  const daysSince = lastActivityAt == null
    ? null
    : Math.max(0, Math.floor((now.getTime() - new Date(lastActivityAt).getTime()) / DAY_MS));

  const recency = daysSince === null ? 0 : daysSince <= 7 ? 40 : daysSince <= 30 ? 20 : 0;

  const n = activityCount30d;
  const volume = n > 10 ? 30 : n >= 4 ? 20 : n >= 1 ? 10 : 0;

  const openValue = openDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);
  const value = openValue > 50_000 ? 30 : openValue >= 10_000 ? 20 : openValue > 0 ? 10 : 0;

  const stage = openDeals.some((d) => LATE_STAGES.has(d.stage)) ? 20 : 0;

  const score = Math.min(120, recency + volume + value + stage);
  const label = score > 80 ? 'HOT' : score >= 40 ? 'WARM' : 'COLD';

  return { score, label, components: { daysSince, recency, activityCount30d: n, volume, openValue, value, stage } };
}

function compactMoney(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/**
 * Deterministic one-sentence explanation, e.g.
 * "Warm — contacted 3d ago, 2 touches in 30d, $24K open pipeline at proposal stage or later."
 */
function explainLeadScore({ label, components }) {
  const { daysSince, activityCount30d, openValue, stage } = components;
  const parts = [
    daysSince === null ? 'no activity yet'
      : daysSince === 0 ? 'contacted today'
      : daysSince <= 30 ? `contacted ${daysSince}d ago`
      : `no contact for ${daysSince}d`,
    `${activityCount30d} touch${activityCount30d === 1 ? '' : 'es'} in 30d`,
    openValue > 0
      ? `${compactMoney(openValue)} open pipeline${stage ? ' at proposal stage or later' : ''}`
      : 'no open deals',
  ];
  return `${label.charAt(0)}${label.slice(1).toLowerCase()} — ${parts.join(', ')}.`;
}

module.exports = { computeLeadScore, explainLeadScore };
