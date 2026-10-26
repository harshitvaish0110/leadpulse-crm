/**
 * LeadPulse — Contact enrichment: propose, then apply what the user confirms.
 *
 * The proposal combines the CRM record, optional Clearbit data, the company
 * homepage's public metadata (fetched through safeFetch) and, for LinkedIn
 * input, only the profile slug: LinkedIn pages are never fetched. Nothing is
 * saved until apply(), which writes only the fields the user ticked.
 */

'use strict';

const axios = require('axios');
const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { audit } = require('../lib/audit');
const { safeFetch } = require('../lib/safeFetch');
const { secret } = require('../lib/secrets');
const { ApiError } = require('../middleware/error.middleware');
const { scopeFor } = require('../middleware/auth.middleware');
const ai = require('./ai');
const prompts = require('./ai/prompts');
const { logAICall } = require('./ai/logging');
const { companyFor } = require('./contacts.service');
const { afterContactChange, afterCompanyChange, afterActivityChange } = require('../queues/triggers');

const LINKEDIN = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9_%-]+)\/?$/;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const FIELDS = ['title', 'company', 'companySize', 'industry', 'location', 'estimatedBudgetTier', 'companySummary'];

const invalid = (path, msg) => ApiError.validation([{ path, msg }]);

/** `{ domain }` or `{ linkedinSlug }` from the user's input. */
function parseInput({ domain, linkedinUrl } = {}) {
  if (linkedinUrl) {
    const match = LINKEDIN.exec(String(linkedinUrl).trim());
    if (!match) throw invalid('linkedinUrl', 'Use a profile URL like https://www.linkedin.com/in/jane-doe');
    return { linkedinSlug: decodeURIComponent(match[2]) };
  }
  if (domain) {
    const host = String(domain).trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#:]/)[0].replace(/^www\./, '');
    if (!DOMAIN.test(host)) throw invalid('domain', 'Enter a domain like acme.com');
    return { domain: host };
  }
  throw invalid('domain', 'Enter a company domain or a LinkedIn profile URL');
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

/** Title, description and OpenGraph names from a page's <head>. */
function pageMeta(html) {
  const head = html.slice(0, 100_000);
  const metas = {};
  for (const tag of head.match(/<meta\s[^>]*>/gi) ?? []) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)].map((m) => [m[1].toLowerCase(), m[3] ?? m[4]]));
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content && !metas[key]) metas[key] = decode(attrs.content).trim();
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  return {
    title: title ? decode(title).replace(/\s+/g, ' ').trim() : metas['og:title'] ?? null,
    description: metas.description ?? metas['og:description'] ?? null,
    siteName: metas['og:site_name'] ?? null,
  };
}

/** Public homepage metadata, or null when the site can't be fetched safely. */
async function publicMetaFor(domain) {
  try {
    const page = await safeFetch(`https://${domain}`);
    const meta = pageMeta(page.body);
    return meta.title || meta.description ? meta : null;
  } catch (err) {
    logger.info({ event: 'enrich_fetch_skipped', domain, err: err.message }, 'Homepage metadata unavailable');
    return null;
  }
}

/** Clearbit person/company data when a key is configured; null otherwise or on any failure. */
async function clearbitFor(email) {
  if (!secret('CLEARBIT_API_KEY') || !email) return null;
  try {
    const { data } = await axios.get(`https://person.clearbit.com/v2/combined/find?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${secret('CLEARBIT_API_KEY')}` }, timeout: 10_000,
    });
    return {
      title: data.person?.employment?.title, company: data.company?.name, employees: data.company?.metrics?.employees,
      industry: data.company?.category?.industry, country: data.company?.geo?.country, description: data.company?.description,
    };
  } catch (err) {
    logger.warn({ event: 'clearbit_failed', err: err.message }, 'Clearbit lookup failed');
    return null;
  }
}

/** The CRM's current value for each enrichable field, for the diff. */
const currentFields = (contact) => ({
  title: contact.title ?? null,
  company: contact.company?.name ?? null,
  companySize: contact.company?.size ?? null,
  industry: contact.company?.industry ?? null,
  location: contact.company?.country ?? null,
  estimatedBudgetTier: contact.customFields?.budgetTier ?? null,
  companySummary: contact.company?.description ?? null,
});

async function findScopedContact(user, contactId) {
  if (!contactId) throw ApiError.badRequest('contactId required');
  const contact = await prisma.contact.findFirst({ where: { id: contactId, ...scopeFor(user, 'contact') }, include: { company: true } });
  if (!contact) throw ApiError.notFound('Contact not found');
  return contact;
}

/**
 * POST /ai/enrich-contact — a proposal only; nothing is saved.
 * @returns {Promise<{ source: 'clearbit'|'ai', proposed: object, current: object, confidence: number, domain: string|null, publicMeta: boolean }>}
 */
async function preview(user, { contactId, domain, linkedinUrl }) {
  const contact = await findScopedContact(user, contactId);
  const input = parseInput({ domain, linkedinUrl });
  const [clearbit, publicMeta] = await Promise.all([
    clearbitFor(contact.email),
    input.domain ? publicMetaFor(input.domain) : null,
  ]);

  const { data } = await ai.getJSON(prompts.enrich({ contact, ...input, publicMeta, clearbit }), {
    log: { userId: user.id, contactId: contact.id, input: { ...input, publicMeta: Boolean(publicMeta), clearbit: Boolean(clearbit) } },
  });
  // With neither a readable website nor Clearbit, the proposal is the model's guess from the
  // CRM record alone (or a LinkedIn slug): capped below the 0.5 line where the UI warns.
  const confidence = publicMeta || clearbit ? data.confidence : Math.min(data.confidence, 0.4);
  return {
    source: clearbit ? 'clearbit' : 'ai',
    proposed: { ...data, confidence },
    current: currentFields(contact),
    confidence,
    domain: input.domain ?? null,
    publicMeta: Boolean(publicMeta),
  };
}

/** Only known fields, with the same limits the proposal normaliser applies. */
function cleanFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw invalid('fields', 'fields must be an object');
  const unknown = Object.keys(fields).filter((k) => !FIELDS.includes(k));
  if (unknown.length) throw invalid('fields', `Unknown fields: ${unknown.join(', ')}`);
  const clean = prompts.enrich({ contact: { firstName: '', lastName: '' } }).normalise({ ...fields, confidence: 1 });
  const picked = Object.fromEntries(Object.keys(fields).map((k) => [k, clean[k]]));
  if (!Object.keys(picked).length) throw invalid('fields', 'Choose at least one field');
  return picked;
}

/**
 * POST /ai/enrich-contact/:id/apply — writes the checked fields, logs a NOTE
 * activity, an audit entry and an ai_logs row.
 * @param {string} [domain]  the domain the proposal used, to find or create the company
 */
async function apply(user, contactId, { fields, domain }, req) {
  const contact = await findScopedContact(user, contactId);
  const picked = cleanFields(fields);

  // The company the fields apply to: the proposed one (found or created), else the current one.
  let companyId = contact.companyId;
  if (picked.company && picked.company.toLowerCase() !== contact.company?.name?.toLowerCase()) {
    const host = domain ? parseInput({ domain }).domain : null;
    const byDomain = host && await prisma.company.findUnique({ where: { domain: host }, select: { id: true } });
    companyId = byDomain?.id
      ?? (host
        ? (await prisma.company.create({ data: { name: picked.company, domain: host }, select: { id: true } })).id
        : await companyFor(picked.company, contact.email, new Map()));
  }

  const companyData = Object.fromEntries(Object.entries({
    industry: picked.industry, size: picked.companySize, country: picked.location, description: picked.companySummary,
  }).filter(([, v]) => v !== undefined));
  if (Object.keys(companyData).length && !companyId) throw invalid('fields', 'Choose the company too, so these details have somewhere to go');

  const label = Object.keys(picked).join(', ');
  const result = await prisma.$transaction(async (tx) => {
    const company = companyId && Object.keys(companyData).length
      ? await tx.company.update({ where: { id: companyId }, data: companyData })
      : companyId ? await tx.company.findUnique({ where: { id: companyId } }) : null;

    const updated = await tx.contact.update({
      where: { id: contact.id },
      data: {
        ...(picked.title !== undefined && { title: picked.title }),
        companyId,
        ...(picked.estimatedBudgetTier !== undefined && {
          customFields: { ...(contact.customFields ?? {}), budgetTier: picked.estimatedBudgetTier },
        }),
      },
    });
    const note = await tx.activity.create({
      data: { type: 'NOTE', subject: 'Enrichment', notes: `Contact enriched via AI (fields: ${label})`, contactId: contact.id, userId: user.id },
    });
    await audit(req, {
      action: 'update', entityType: 'contact', entityId: contact.id,
      before: { ...currentFields(contact), companyId: contact.companyId },
      after: { ...picked, companyId },
    }, tx);
    return { contact: updated, company, note };
  });

  logAICall({
    feature: 'enrich_apply', provider: null, model: null, status: 'ok', latencyMs: 0,
    userId: user.id, contactId: contact.id, input: { fields: Object.keys(picked), domain: domain ?? null },
  });
  afterContactChange(contact.id);
  if (companyId) afterCompanyChange(companyId);
  afterActivityChange(result.note, { created: true });
  return { contact: result.contact, company: result.company };
}

module.exports = { preview, apply, parseInput, pageMeta, FIELDS };
