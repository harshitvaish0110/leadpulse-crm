'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeLeadScore, explainLeadScore } = require('../../src/services/leadScore');

const NOW = new Date('2026-10-25T12:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000);
const score = (input) => computeLeadScore({ now: NOW, ...input });

test('recency boundaries: 0/7 → 40, 8/30 → 20, 31/none → 0', () => {
  for (const [days, pts] of [[0, 40], [7, 40], [8, 20], [30, 20], [31, 0]]) {
    assert.equal(score({ lastActivityAt: daysAgo(days) }).components.recency, pts, `days=${days}`);
  }
  assert.equal(score({ lastActivityAt: null }).components.recency, 0);
});

test('volume boundaries: 0 → 0, 1/3 → 10, 4/10 → 20, 11 → 30', () => {
  for (const [n, pts] of [[0, 0], [1, 10], [3, 10], [4, 20], [10, 20], [11, 30]]) {
    assert.equal(score({ activityCount30d: n }).components.volume, pts, `n=${n}`);
  }
});

test('open value boundaries: 0 → 0, 9,999 → 10, 10,000/50,000 → 20, 50,001 → 30 (summed)', () => {
  for (const [v, pts] of [[0, 0], [9_999, 10], [10_000, 20], [50_000, 20], [50_001, 30]]) {
    assert.equal(score({ openDeals: [{ value: v, stage: 'LEAD' }] }).components.value, pts, `v=${v}`);
  }
  assert.equal(score({ openDeals: [{ value: '30000', stage: 'LEAD' }, { value: 30_000, stage: 'DEMO' }] }).components.value, 30);
});

test('stage bonus only for PROPOSAL or NEGOTIATION', () => {
  assert.equal(score({ openDeals: [{ value: 1, stage: 'DEMO' }] }).components.stage, 0);
  assert.equal(score({ openDeals: [{ value: 1, stage: 'PROPOSAL' }] }).components.stage, 20);
  assert.equal(score({ openDeals: [{ value: 1, stage: 'NEGOTIATION' }] }).components.stage, 20);
});

test('labels: 40 is WARM, 80 is WARM, 81+ HOT, 39 COLD', () => {
  assert.equal(score({ lastActivityAt: daysAgo(1) }).label, 'WARM');                               // 40
  assert.equal(score({ lastActivityAt: daysAgo(1), activityCount30d: 11, openDeals: [{ value: 5_000, stage: 'LEAD' }] }).score, 80);
  assert.equal(score({ lastActivityAt: daysAgo(1), activityCount30d: 11, openDeals: [{ value: 5_000, stage: 'LEAD' }] }).label, 'WARM');
  assert.equal(score({ lastActivityAt: daysAgo(1), activityCount30d: 11, openDeals: [{ value: 10_000, stage: 'LEAD' }] }).label, 'HOT');
  assert.equal(score({ lastActivityAt: daysAgo(20), activityCount30d: 1 }).label, 'COLD');        // 30
});

test('maximum score is 120', () => {
  const r = score({ lastActivityAt: daysAgo(0), activityCount30d: 50, openDeals: [{ value: 1e6, stage: 'NEGOTIATION' }] });
  assert.equal(r.score, 120);
  assert.equal(r.label, 'HOT');
});

test('explanation starts with the capitalised label', () => {
  const r = score({ lastActivityAt: daysAgo(3), activityCount30d: 2, openDeals: [{ value: 24_000, stage: 'PROPOSAL' }] });
  assert.equal(explainLeadScore(r), 'Hot — contacted 3d ago, 2 touches in 30d, $24K open pipeline at proposal stage or later.');
  assert.match(explainLeadScore(score({ lastActivityAt: null })), /^Cold — no activity yet/);
});
