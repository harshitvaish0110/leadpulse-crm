/**
 * LeadPulse — Background job handlers by name. Each one is idempotent: running
 * it twice leaves the same result, so retries and duplicates are harmless.
 *
 * Run one job now, in this process:  node src/queues/jobs.js <name> ['<json data>']
 *   e.g. npm run job -- nightly '{"force":true}'
 */

'use strict';

if (require.main === module) process.env.SERVICE_NAME ||= 'leadpulse-job'; // before the logger is created

const activities = require('../services/activities.service');
const scoring = require('../services/scoring.service');
const semanticIndex = require('../services/semanticIndex.service');
const forecast = require('../services/forecast.service');
const nightly = require('../services/nightly.service');
const tasks = require('../services/tasks.service');
const nextActions = require('../services/nextAction.service');
const transcription = require('../services/transcription.service');

const handlers = {
  sentiment:         ({ activityId }) => activities.scoreSentiment(activityId),
  'rescore-contact': ({ contactId }) => scoring.rescoreContact(contactId),
  'rescore-deal':    ({ dealId }) => scoring.rescoreDeal(dealId),
  'reindex-record':  ({ type, id }) => semanticIndex.reindexRecord(type, id),
  'reindex-all':     () => semanticIndex.reindexAll(),
  forecast:          (data) => forecast.computeForecast(data),
  nightly:           ({ force }) => nightly.runNightly({ force: Boolean(force) }),
  'task-reminders':  () => tasks.sendReminders(),
  'nba-batch':       () => nextActions.refreshNextActions(),
  transcribe:        ({ activityId }, job) => transcription.transcribe(activityId, job),
};

module.exports = { handlers };

if (require.main === module) {
  const { logger } = require('../lib/logger');
  const { relayThroughRedis } = require('../lib/realtime');
  const [name, json] = process.argv.slice(2);
  if (!handlers[name]) {
    console.error(`Usage: node src/queues/jobs.js <${Object.keys(handlers).join('|')}> ['<json data>']`);
    process.exit(2);
  }
  relayThroughRedis(); // live updates reach open browsers through the API
  Promise.resolve()
    .then(() => handlers[name](json ? JSON.parse(json) : {}))
    .then((result) => {
      logger.info({ event: 'job_completed', jobName: name, result }, 'Job completed');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ event: 'job_failed', jobName: name, err: err.message }, 'Job failed');
      process.exit(1);
    });
}
