'use strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ||= 'x'.repeat(32);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { splitText, chunksFor, TEMPLATES } = require('../../src/services/semanticIndex.service');
const { pool } = require('../../src/lib/prisma');

after(() => pool.end());

test('text up to 1,500 characters stays one chunk', () => {
  assert.deepEqual(splitText('a'.repeat(1500)), ['a'.repeat(1500)]);
});

test('longer text becomes 1,000-character windows overlapping by 200', () => {
  const text = Array.from({ length: 3000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
  const chunks = splitText(text);
  assert.deepEqual(chunks.map((c) => c.length), [1000, 1000, 1000, 600]);
  assert.equal(chunks[1].slice(0, 200), chunks[0].slice(800));
  assert.equal(chunks.at(-1), text.slice(2400), 'the end of the text is covered');
});

test('chunks are hashed by content, so unchanged records are not re-embedded', () => {
  const activity = {
    id: 'a1', type: 'CALL', occurredAt: new Date('2026-10-01'), subject: 'Kickoff', notes: 'Discussed rollout.', sentiment: 'AT_RISK',
    contact: { firstName: 'Ana', lastName: 'Lee', company: { name: 'Acme' } }, deal: { title: 'Renewal' }, metadata: null,
  };
  const [first] = chunksFor('activity', [activity]);
  const [again] = chunksFor('activity', [{ ...activity }]);
  const [edited] = chunksFor('activity', [{ ...activity, notes: 'Discussed rollout and pricing.' }]);
  assert.equal(first.contentHash, again.contentHash);
  assert.notEqual(first.contentHash, edited.contentHash);
  assert.match(first.content, /CALL on 2026-10-01 with Ana Lee \(Acme\) about Renewal: Kickoff\./);
  assert.match(first.content, /Sentiment at risk\./);
});

test('contact text names the owner, scores and open deals', () => {
  const text = TEMPLATES.contact({
    firstName: 'Ana', lastName: 'Lee', title: 'CTO', company: { name: 'Acme' }, status: 'ACTIVE',
    leadScore: 72, leadScoreLabel: 'WARM', churnRisk: 0.35, sentimentScore: 0.8, owner: { firstName: 'Sarah', lastName: 'Kim' },
    tags: ['VIP'], deals: [{ title: 'Renewal', stage: 'PROPOSAL', value: 12000 }], activities: [],
  });
  assert.match(text, /Lead score 72 \(WARM\)\. Churn risk 35%\. Sentiment positive\./);
  assert.match(text, /Owner Sarah Kim\. Tags VIP\./);
  assert.match(text, /Open deals: Renewal \(PROPOSAL, \$12,000\)\./);
});
