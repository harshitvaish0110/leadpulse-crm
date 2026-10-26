/**
 * LeadPulse — Quick search for the command palette: contacts, deals and
 * companies whose name (or email, domain, contact name) contains every word
 * typed, within the caller's scope. Five of each at most.
 */

'use strict';

const { prisma } = require('../lib/prisma');
const { money } = require('../lib/workspace');
const { scoped } = require('../middleware/auth.middleware');

const LIMIT = 5;
const contains = (field, term) => ({ [field]: { contains: term, mode: 'insensitive' } });
const personMatches = (term) => [contains('firstName', term), contains('lastName', term)];

/** @returns {Promise<{ contacts: object[], deals: object[], companies: object[] }>} */
async function quickSearch(user, query) {
  const terms = String(query ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 4).map((t) => t.slice(0, 60));
  if (!terms.length) return { contacts: [], deals: [], companies: [] };
  const every = (match) => ({ AND: terms.map((t) => ({ OR: match(t) })) });

  const [contacts, deals, companies] = await Promise.all([
    prisma.contact.findMany({
      where: scoped(user, 'contact', every((t) => [...personMatches(t), contains('email', t), { company: contains('name', t) }])),
      orderBy: [{ leadScore: 'desc' }, { id: 'asc' }],
      take: LIMIT,
      select: { id: true, firstName: true, lastName: true, email: true, title: true, company: { select: { name: true } } },
    }),
    prisma.deal.findMany({
      where: scoped(user, 'deal', every((t) => [contains('title', t), { contact: { OR: personMatches(t) } }])),
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: LIMIT,
      select: { id: true, title: true, value: true, stage: true, pipelineStage: { select: { label: true } }, contact: { select: { firstName: true, lastName: true } } },
    }),
    prisma.company.findMany({
      where: every((t) => [contains('name', t), contains('domain', t)]),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: LIMIT,
      select: { id: true, name: true, domain: true, industry: true },
    }),
  ]);

  return {
    contacts: contacts.map((c) => ({
      id: c.id, name: `${c.firstName} ${c.lastName}`, subtitle: [c.title, c.company?.name].filter(Boolean).join(' · ') || c.email,
    })),
    deals: deals.map((d) => ({
      id: d.id, name: d.title, subtitle: `${d.pipelineStage?.label ?? d.stage} · ${money(d.value)} · ${d.contact.firstName} ${d.contact.lastName}`,
    })),
    companies: companies.map((c) => ({ id: c.id, name: c.name, subtitle: [c.industry, c.domain].filter(Boolean).join(' · ') })),
  };
}

module.exports = { quickSearch };
