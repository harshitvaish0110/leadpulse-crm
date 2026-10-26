/**
 * LeadPulse — Workspace settings (the `org_settings` singleton) for code that
 * can't wait for the database, such as prompt and index text builders.
 *
 * server.js and worker.js load the row at start and every minute; the process
 * that saves a change updates its cache at once.
 */

'use strict';

const { prisma } = require('./prisma');
const { logger } = require('./logger');

const DEFAULTS = { companyName: 'LeadPulse', timezone: 'Asia/Kolkata', currency: 'USD' };
const SELECT = { companyName: true, timezone: true, currency: true };

let cached = { ...DEFAULTS };
let loading = null;

/** Reloads the cache from the database; never throws. */
function refreshWorkspace() {
  loading ??= prisma.orgSettings.findUnique({ where: { id: 1 }, select: SELECT })
    .then((row) => { cached = { ...DEFAULTS, ...row }; })
    .catch((err) => logger.warn({ event: 'workspace_load_failed', err: err.message }, 'Could not load workspace settings'))
    .finally(() => { loading = null; });
  return loading;
}

/** The cached settings (defaults until the first load). */
const workspace = () => cached;

/** Called after a save, so this process uses the new values immediately. */
function setWorkspace(row) {
  cached = { ...DEFAULTS, ...row };
}

const formats = new Map();

/** Whole amounts in the workspace currency: "$120,000", "€4,500", "₹75,000". */
function money(value) {
  const { currency } = workspace();
  if (!formats.has(currency)) {
    formats.set(currency, new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }));
  }
  return formats.get(currency).format(Math.round(Number(value || 0)));
}

module.exports = { DEFAULTS, workspace, refreshWorkspace, setWorkspace, money };
