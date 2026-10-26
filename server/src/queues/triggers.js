/**
 * LeadPulse — What has to be recomputed after a CRM write.
 *
 * Services call these after they commit. Each enqueues coalesced background
 * work (see queue.js), so a burst of edits to one record costs one rescore and
 * one reindex. They never throw and never delay the response.
 *
 *   sentiment        new activity with notes          → label + contact rolling mean
 *   rescore-contact  any change to its activities/deals → lead score (5 s debounce)
 *   rescore-deal     deal or its activities changed    → win probability (5 s debounce)
 *   reindex-record   record or what its text mentions  → semantic index (10 s debounce)
 */

'use strict';

const { enqueue } = require('./queue');

const CLOSED = new Set(['CLOSED_WON', 'CLOSED_LOST']);
const SENTIMENT_TYPES = new Set(['NOTE', 'CALL', 'EMAIL', 'MEETING']);

const rescoreContact = (id) => id && enqueue('rescore-contact', { contactId: id }, { dedupe: `rescore-contact:${id}`, delay: 5000 });
const rescoreDeal = (id) => id && enqueue('rescore-deal', { dealId: id }, { dedupe: `rescore-deal:${id}`, delay: 5000 });
const reindex = (type, id) => id && enqueue('reindex-record', { type, id }, { dedupe: `reindex:${type}:${id}`, delay: 10_000 });

/** Contact created or edited (its own fields only). */
function afterContactChange(contactId, { created = false } = {}) {
  if (created) rescoreContact(contactId);
  reindex('contact', contactId);
}

/** Deal created, edited, moved or deleted. The contact's lead score and text include its open deals. */
function afterDealChange({ id, contactId, stage }, { deleted = false } = {}) {
  if (!deleted && !CLOSED.has(stage)) rescoreDeal(id);
  if (!deleted) reindex('deal', id);
  rescoreContact(contactId);
  reindex('contact', contactId);
}

/** Activity logged or deleted: feeds sentiment, both scores and three index entries. */
function afterActivityChange({ id, type, notes, contactId, dealId }, { created = false, deleted = false } = {}) {
  if (created && SENTIMENT_TYPES.has(type) && notes?.trim()) enqueue('sentiment', { activityId: id }, { dedupe: `sentiment:${id}` });
  if (!deleted) reindex('activity', id);
  rescoreContact(contactId);
  reindex('contact', contactId);
  if (dealId) {
    rescoreDeal(dealId);
    reindex('deal', dealId);
  }
}

function afterCompanyChange(companyId) {
  reindex('company', companyId);
}

/** Many contacts changed at once (import): one pass over the whole index instead of a job per row. */
function afterBulkChange() {
  enqueue('reindex-all', {}, { dedupe: 'reindex-all', delay: 10_000, attempts: 1 });
}

module.exports = {
  SENTIMENT_TYPES,
  afterContactChange, afterDealChange, afterActivityChange, afterCompanyChange, afterBulkChange, reindex, rescoreContact,
};
