/**
 * LeadPulse — Scoring Service
 * Calculates lead score (0–120) using a rules-based algorithm.
 * Gemini explanation is only generated on-demand (single contact),
 * NOT during the bulk nightly job — to preserve API quota.
 */

'use strict';

const { prisma } = require('../lib/prisma');

const STAGE_WEIGHT = {
  LEAD: 0, CONTACTED: 1, DEMO: 2, PROPOSAL: 3, NEGOTIATION: 4,
};

/** Build a fast, deterministic explanation without calling any AI. */
function _ruleExplanation(score, label, daysSince, recentCount, openDeal, sentimentScore) {
  const recency   = daysSince <= 7   ? 'recently active'
                  : daysSince <= 30  ? 'active last month'
                  : daysSince <= 90  ? 'somewhat inactive'
                  : 'long inactive';
  const sentiment = sentimentScore > 0.7 ? 'positive'
                  : sentimentScore < 0.3 ? 'negative' : 'neutral';
  const deal      = openDeal ? `with an open ${openDeal.stage} deal` : 'no open deals';
  return `${label} lead — ${recency} (${recentCount} actions/30d), ${sentiment} sentiment, ${deal}.`;
}

/** Call Gemini ONLY when explicitly requested (single contact, user-triggered). */
async function _aiExplanation(score, label, daysSince, recentCount, openDeal, sentimentScore) {
  try {
    const { getText } = require('./ai.service');
    const prompt = `Lead score: ${score}/120. Label: ${label}. Days since last contact: ${daysSince}. Recent activities (30d): ${recentCount}. Open deal stage: ${openDeal?.stage || 'none'}. Sentiment: ${Math.round(sentimentScore * 100)}%.
Write exactly ONE sentence explaining this lead score. Start with "${label} lead —"`;
    return await getText(prompt, 'You are a CRM analyst. Write a single concise sentence explaining a lead score.');
  } catch {
    return _ruleExplanation(score, label, daysSince, recentCount, openDeal, sentimentScore);
  }
}

/**
 * Calculates and persists lead score for a single contact.
 * @param {string}  contactId
 * @param {boolean} [useAI=false]  Set true only for on-demand single-contact calls (not bulk job).
 * @returns {{ score, label, explanation }}
 */
async function calculateAndSaveLeadScore(contactId, useAI = false) {
  const contact = await prisma.contact.findUnique({
    where:   { id: contactId },
    include: {
      activities: { orderBy: { occurredAt: 'desc' }, take: 30 },
      deals:      { where: { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } } },
    },
  });
  if (!contact) throw new Error(`Contact ${contactId} not found`);

  const now         = Date.now();
  const lastAct     = contact.activities[0];
  const daysSince   = lastAct ? Math.floor((now - new Date(lastAct.occurredAt)) / 86_400_000) : 999;
  const recentCount = contact.activities.filter(
    a => (now - new Date(a.occurredAt)) < 30 * 86_400_000
  ).length;
  const openDeal       = contact.deals[0] || null;
  const sentimentScore = contact.sentimentScore ?? 0.5;

  let score = 0;

  // Recency (max 40 pts)
  if (daysSince <= 7)       score += 40;
  else if (daysSince <= 30) score += 20;
  else if (daysSince <= 90) score +=  5;

  // Activity volume (max 30 pts)
  if (recentCount >= 10)    score += 30;
  else if (recentCount >= 4) score += 20;
  else if (recentCount >= 1) score += 10;

  // Open deal value + stage (max 50 pts)
  if (openDeal) {
    const val = Number(openDeal.value);
    if (val > 50_000)      score += 30;
    else if (val > 10_000) score += 20;
    else                   score += 10;

    const stageBonus = (STAGE_WEIGHT[openDeal.stage] || 0) * 4;
    score += Math.min(stageBonus, 20);
  }

  // Sentiment bonus/penalty (±10 pts)
  if (sentimentScore > 0.70)      score += 10;
  else if (sentimentScore < 0.30) score -= 10;

  // Clamp to 0–120
  score = Math.max(0, Math.min(120, score));

  const label       = score > 80 ? 'HOT' : score > 40 ? 'WARM' : 'COLD';
  // Use AI explanation only for on-demand single-contact requests, rules-based for bulk job
  const explanation = useAI
    ? await _aiExplanation(score, label, daysSince, recentCount, openDeal, sentimentScore)
    : _ruleExplanation(score, label, daysSince, recentCount, openDeal, sentimentScore);

  await prisma.contact.update({
    where: { id: contactId },
    data:  { leadScore: score, leadScoreLabel: label, leadScoreExplanation: explanation },
  });

  return { score, label, explanation };
}

module.exports = { calculateAndSaveLeadScore };
