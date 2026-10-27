'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkQuery } = require('../../src/services/crmQueries.service');
const { wantsQueries, wantsDay, citedRecords } = require('../../src/services/chat.service');
const { startOfDay, dayBoundary } = require('../../src/lib/dates');
const prompts = require('../../src/services/ai/prompts');

test('query parameters are checked per tool', () => {
  assert.equal(checkQuery({ tool: 'sql', text: 'DROP TABLE' }), null);
  assert.equal(checkQuery(null), null);
  assert.deepEqual(checkQuery({ tool: 'deals' }), { tool: 'deals', status: 'open', sort: 'value', limit: 10 });
  assert.deepEqual(checkQuery({ tool: 'deals', status: 'won', minWinProbability: 5, closeFrom: '2026-02-30x', sort: 'random', owner: '  Sarah  ' }),
    { tool: 'deals', status: 'won', minWinProbability: 1, owner: 'Sarah', sort: 'value', limit: 10 });
  assert.deepEqual(checkQuery({ tool: 'contacts', status: 'lead', scoreLabel: ['hot', 'boiling'], minChurnRisk: -1, limit: 3 }),
    { tool: 'contacts', statuses: ['LEAD'], scoreLabels: ['HOT'], minChurnRisk: 0, sort: 'leadScore', limit: 3 });
  assert.deepEqual(checkQuery({ tool: 'tasks', due: 'yesterday', mine: 'yes', priority: 'high' }), { tool: 'tasks', due: 'any', priorities: ['HIGH'], limit: 10 });
  assert.deepEqual(checkQuery({ tool: 'pipeline_summary', groupBy: 'colour' }), { tool: 'pipeline_summary', groupBy: 'stage', status: 'open' });
  assert.deepEqual(checkQuery({ tool: 'contacts', company: '  Block Group ' }), { tool: 'contacts', company: 'Block Group', sort: 'leadScore', limit: 10 });
});

test('only questions that filter, rank or count records cost a planning call', () => {
  for (const q of ['Which deals over 100k close this month?', 'How many tasks are overdue?', 'list hot leads', 'total pipeline by stage', 'give me all contacts of Block Group']) assert.equal(wantsQueries(q), true, q);
  for (const q of ['What did Art say about pricing?', 'Draft an email to Art', 'hello']) assert.equal(wantsQueries(q), false, q);
});

test('sources follow citations, and a cited query result brings its rows', () => {
  const chunks = [
    { recordType: 'query', recordId: 'tasks' },
    { recordType: 'task', recordId: 't1', fromQuery: true },
    { recordType: 'task', recordId: 't2', fromQuery: true },
    { recordType: 'contact', recordId: 'c1' },
  ];
  assert.deepEqual(citedRecords('Two are overdue [1].', chunks).map((c) => c.recordId), ['tasks', 't1', 't2']);
  assert.deepEqual(citedRecords('See 【4】 and [4].', chunks).map((c) => c.recordId), ['c1']);
  assert.equal(citedRecords('No citations', chunks), null);
  assert.equal(citedRecords('[9]', chunks), null);
});

test('days start at local midnight, across DST and far-east timezones', () => {
  assert.equal(startOfDay(new Date('2026-10-26T13:00:00Z'), 'Asia/Kolkata').toISOString(), '2026-10-25T18:30:00.000Z');
  assert.equal(dayBoundary('2026-11-01', 'America/New_York').toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(dayBoundary('2026-11-01', 'America/New_York', { end: true }).toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(dayBoundary('2026-10-26', 'Pacific/Kiritimati').toISOString(), '2026-10-25T10:00:00.000Z');
});

test("questions about the day get My Day's facts", () => {
  for (const q of ['What should I focus on today?', "What's on my plate this week?", 'Anything urgent?', 'What should I work on first?']) assert.equal(wantsDay(q), true, q);
  for (const q of ['What did Art say about pricing?', 'Draft an email to Art']) assert.equal(wantsDay(q), false, q);
});

test('the planner mock and the briefing tidy-up behave', () => {
  assert.deepEqual(prompts.planQueries({ question: 'deals above 1.5m', today: 'x' }).mock.queries, [{ tool: 'deals', minValue: 1500000, sort: 'value' }]);
  assert.deepEqual(prompts.planQueries({ question: 'who is Art?', today: 'x' }).mock.queries, []);
  assert.deepEqual(prompts.planQueries({ question: 'give me all contacts of Block Group', today: 'x' }).mock.queries, [{ tool: 'contacts', company: 'Block Group' }]);
  assert.equal(prompts.dailyBriefing({ userName: 'Sarah', today: 'x', facts: 'y' }).finish('Good morning, Sarah! Two tasks are overdue.'), 'Two tasks are overdue.');
});
