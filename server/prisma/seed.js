/**
 * LeadPulse CRM — Demo seed
 *
 * Generates a deterministic, realistic workspace with 24 months of history.
 * Correlations are deliberate so the ML models have something real to learn:
 *   - churned contacts went quiet long ago and their sentiment soured,
 *   - won deals got further in the pipeline, had more (and more recent)
 *     activity and more senior contacts than lost deals.
 *
 * Usage:  npm run seed      (also run by `prisma migrate reset`)
 * Guard:  refuses to run with NODE_ENV=production unless SEED_DEMO=true.
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });

const bcrypt = require('bcryptjs');
const { faker } = require('@faker-js/faker');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const { computeLeadScore, explainLeadScore } = require('../src/services/leadScore');

if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO !== 'true') {
  console.error('Refusing to seed: NODE_ENV=production and SEED_DEMO is not "true".');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ── Randomness helpers (all seeded) ──────────────────────────────────────────
faker.seed(42);

const DAY = 86_400_000;
const NOW = Date.now();
const at = (ms) => new Date(Math.min(ms, NOW));
const daysAgo = (d) => new Date(NOW - d * DAY);
const id = () => faker.string.uuid();
const rand = (min, max) => faker.number.float({ min, max });
const randInt = (min, max) => faker.number.int({ min, max });
const pick = (arr) => faker.helpers.arrayElement(arr);
const chance = (p) => faker.datatype.boolean({ probability: p });
const weighted = (pairs) => faker.helpers.weightedArrayElement(pairs.map(([value, weight]) => ({ value, weight })));
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// ── Reference data ───────────────────────────────────────────────────────────
const STAGES = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION'];
const PIPELINE = [
  ['Lead', '#6b7280', 'LEAD'], ['Contacted', '#6366f1', 'CONTACTED'], ['Demo', '#8b5cf6', 'DEMO'],
  ['Proposal', '#f59e0b', 'PROPOSAL'], ['Negotiation', '#f97316', 'NEGOTIATION'],
  ['Won', '#10b981', 'CLOSED_WON'], ['Lost', '#ef4444', 'CLOSED_LOST'],
];

const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education', 'Real Estate', 'Media', 'Logistics', 'SaaS'];
const COUNTRIES = ['India', 'USA', 'UK', 'Germany', 'Singapore', 'Australia', 'Canada'];

const SOURCE_TAGS = ['Inbound', 'Outbound', 'Referral', 'Event Lead', 'Partner'];
const OTHER_TAGS = ['VIP', 'Enterprise', 'SMB', 'Champion', 'Renewal', 'Hot Lead'];

// Titles grouped by the seniority levels used by lp_title_seniority().
const TITLES = {
  3: ['CEO', 'CTO', 'CFO', 'COO', 'VP of Sales', 'VP of Engineering', 'Vice President, Operations', 'Founder', 'Co-Founder & CEO', 'President'],
  2: ['Director of Sales', 'Director of IT', 'Head of Procurement', 'Head of Growth', 'Director of Operations', 'Head of Marketing'],
  1: ['Sales Manager', 'IT Manager', 'Team Lead', 'Senior Engineer', 'Procurement Manager', 'Operations Manager', 'Principal Consultant'],
  0: ['Account Executive', 'Business Analyst', 'Software Engineer', 'Coordinator', 'Specialist', 'Associate', 'Analyst'],
};

const NOTES = {
  POSITIVE: [
    'Great call — they want to roll this out to two more teams next quarter.',
    'Demo landed well; the champion is presenting our ROI numbers to leadership.',
    'Budget approved on their side. Legal review starts Monday.',
    'Very positive feedback on the onboarding plan. Asked for a kickoff date.',
    'They loved the analytics dashboard and asked about the enterprise tier.',
    'Champion reached out proactively to schedule the next session.',
  ],
  NEUTRAL: [
    'Left a voicemail; will follow up later this week.',
    'Sent the pricing sheet and product overview. Awaiting their review.',
    'Discovery call done. Gathering requirements from their IT team.',
    'Demo moved to next Tuesday at their request. No concerns raised.',
    'Looped in their procurement team; standard evaluation process.',
    'Quick check-in. They are comparing timelines internally.',
  ],
  NEGATIVE: [
    'They pushed back hard on price and asked for a 30% discount.',
    'Stakeholder seemed distracted; the decision keeps slipping.',
    'Concerns about integration effort with their legacy ERP.',
    'Budget freeze announced — the project is on hold until next quarter.',
    'Unhappy with response times on the last two support tickets.',
  ],
  AT_RISK: [
    'Usage dropped sharply this month. Need an urgent check-in.',
    'Our champion left the company; no internal sponsor anymore.',
    'They are running a competitor trial next week.',
    'Invoice is overdue and they have gone quiet on email.',
    'Customer is frustrated and mentioned cancelling the contract.',
  ],
};

const SENTIMENT_BANDS = { POSITIVE: [0.71, 0.99], NEUTRAL: [0.4, 0.7], NEGATIVE: [0.2, 0.39], AT_RISK: [0.02, 0.19] };

const SUBJECTS = {
  CALL: ['Discovery call', 'Follow-up call', 'Pricing discussion', 'Check-in call', 'Renewal call'],
  EMAIL: ['Follow-up on our conversation', 'Proposal and next steps', 'Quick question', 'Recap from today'],
  MEETING: ['Product demo', 'Executive briefing', 'Onboarding workshop', 'Quarterly business review'],
  NOTE: ['Internal note', 'Account update', 'Deal update'],
};

const LOST_REASONS = ['Price too high', 'Chose competitor', 'No budget', 'No decision made', 'Poor timing', 'Feature gap'];

const TASK_TITLES = [
  'Follow up via email', 'Schedule product demo', 'Send pricing proposal', 'Call to discuss contract terms',
  'Send onboarding docs', 'Check in after demo', 'Prepare executive presentation', 'Research competitor pricing',
  'Arrange reference call', 'Send case study', 'Schedule QBR',
];

const INBOUND_EMAILS = [
  ['Pricing for 50 seats', 'Hi, could you share pricing for roughly 50 seats on an annual plan? We would also like to understand what is included in onboarding.'],
  ['Demo recording', 'Thanks for the demo yesterday. Could you send over the recording so I can share it with our CFO?'],
  ['Onboarding timeline', 'We are a bit worried about the onboarding timeline. Our team is stretched this quarter — is a phased rollout possible?'],
  ['Security questionnaire', 'Our security team needs a completed questionnaire and your SOC 2 report before we can proceed.'],
  ['Budget update', 'Quick update: budget approval has been pushed to next month. Can we keep the current proposal valid until then?'],
  ['Integration question', 'Does your platform integrate with Salesforce and HubSpot out of the box, or is that custom work?'],
];

const OUTBOUND_EMAILS = [
  ['Great speaking today', 'Thanks for your time today. As discussed, I have attached the proposal and a short summary of next steps.'],
  ['Following up', 'Just following up on the proposal I sent last week. Happy to walk through any questions on a quick call.'],
  ['Recap and next steps', 'Here is a quick recap of our meeting and the timeline we agreed on. Let me know if anything needs adjusting.'],
];

// ── Generation ───────────────────────────────────────────────────────────────

async function truncateAll() {
  const tables = [
    'ai_messages', 'ai_action_requests', 'ai_conversations', 'ai_logs', 'embeddings', 'score_snapshots',
    'notifications', 'audit_logs', 'refresh_tokens', 'invitations', 'attachments', 'email_drafts', 'tasks',
    'activities', 'deal_stage_history', 'deals', 'pipeline_stages', 'contacts', 'companies', 'tags',
    'custom_field_definitions', 'integration_credentials', 'webhooks', 'org_settings', 'users',
  ];
  // TRUNCATE does not fire the row-level append-only trigger on audit_logs.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

async function createMany(model, rows, chunk = 1000) {
  for (let i = 0; i < rows.length; i += chunk) {
    await prisma[model].createMany({ data: rows.slice(i, i + chunk) });
  }
}

function sentimentLabel(status, progress = 0.5) {
  switch (status) {
    case 'CHURNED':
      return weighted([['POSITIVE', 30 * (1 - progress) + 10], ['NEUTRAL', 35], ['NEGATIVE', 15 + 20 * progress], ['AT_RISK', 5 + 20 * progress]]);
    case 'INACTIVE':
      return weighted([['POSITIVE', 28], ['NEUTRAL', 45], ['NEGATIVE', 18], ['AT_RISK', 9]]);
    case 'LEAD':
      return weighted([['POSITIVE', 35], ['NEUTRAL', 50], ['NEGATIVE', 12], ['AT_RISK', 3]]);
    default:
      return weighted([['POSITIVE', 42], ['NEUTRAL', 40], ['NEGATIVE', 13], ['AT_RISK', 5]]);
  }
}

function makeActivity({ contact, dealId = null, occurredAt, label, userId }) {
  const type = weighted([['CALL', 30], ['EMAIL', 35], ['MEETING', 15], ['NOTE', 20]]);
  const [lo, hi] = SENTIMENT_BANDS[label];
  return {
    id: id(),
    type,
    subject: pick(SUBJECTS[type]),
    notes: pick(NOTES[label]),
    sentiment: label,
    sentimentScore: round(rand(lo, hi)),
    durationMinutes: type === 'CALL' ? randInt(5, 45) : type === 'MEETING' ? randInt(20, 90) : null,
    contactId: contact.id,
    dealId,
    userId,
    occurredAt,
    createdAt: occurredAt,
  };
}

/** Contact timeline window derived from its lifecycle status. */
function contactWindow(status) {
  // Ranges overlap on purpose: some active customers go quiet for a while and
  // some churned customers left only recently, so recency alone is not decisive.
  let firstTouch, lastTouch;
  switch (status) {
    case 'LEAD':     firstTouch = rand(20, 180);  lastTouch = rand(0, 45); break;
    case 'INACTIVE': firstTouch = rand(150, 720); lastTouch = rand(20, 170); break;
    case 'CHURNED':  firstTouch = rand(220, 720); lastTouch = chance(0.3) ? rand(15, 60) : rand(60, 420); break;
    default:         firstTouch = rand(90, 720);  lastTouch = chance(0.2) ? rand(30, 100) : rand(0, 40);
  }
  if (firstTouch < lastTouch + 15) firstTouch = lastTouch + 15 + rand(0, 30);
  return { firstTouch: NOW - firstTouch * DAY, lastTouch: NOW - lastTouch * DAY };
}

/**
 * Build a deal's stage path and timestamps inside the contact's window.
 * Won deals reach further and move faster; lost deals stall early and dwell longer.
 */
function dealTimeline(outcome, win) {
  let ordinals, dwell;
  if (outcome === 'CLOSED_WON') {
    const furthest = weighted([[1, 5], [2, 15], [3, 30], [4, 50]]);
    ordinals = [...Array(furthest + 1).keys()];
    dwell = () => rand(4, 25);
  } else if (outcome === 'CLOSED_LOST') {
    const furthest = weighted([[0, 12], [1, 22], [2, 26], [3, 22], [4, 18]]);
    ordinals = [...Array(furthest + 1).keys()];
    dwell = () => rand(5, 35);
  } else {
    const current = weighted([[0, 20], [1, 25], [2, 22], [3, 18], [4, 15]]);
    ordinals = [...Array(current + 1).keys()];
    dwell = () => rand(5, 30);
  }
  if (ordinals.length > 2 && chance(0.2)) ordinals = ordinals.filter((o) => o !== 1); // sometimes skip CONTACTED

  const closed = outcome !== 'OPEN';
  const gaps = ordinals.slice(1).map(() => dwell());
  if (closed) gaps.push(dwell()); // last open stage → close
  let total = gaps.reduce((a, b) => a + b, 0) * DAY;

  const span = win.lastTouch - win.firstTouch - DAY;
  if (total > span) {
    const scale = span / total;
    gaps.forEach((g, i) => { gaps[i] = g * scale; });
    total = span;
  }

  // End point: close date (closed) or the latest stage change (open).
  const end = closed
    ? rand(win.firstTouch + total, win.lastTouch)
    : Math.max(win.firstTouch + total, win.lastTouch - rand(0, 20) * DAY);
  const start = end - total;

  const entries = [];
  let t = start;
  ordinals.forEach((o, i) => {
    if (i > 0) t += gaps[i - 1] * DAY;
    entries.push({ stage: STAGES[o], at: t });
  });
  if (closed) entries.push({ stage: outcome, at: end });

  return { createdAt: start, entries, end, furthest: ordinals[ordinals.length - 1] };
}

async function main() {
  console.log('\n🌱  Seeding LeadPulse demo workspace…\n');
  await truncateAll();

  // ── Workspace configuration ────────────────────────────────────────────────
  await prisma.orgSettings.create({ data: { id: 1, companyName: 'LeadPulse', timezone: 'Asia/Kolkata', currency: 'USD' } });

  const stageRows = PIPELINE.map(([label, color, baseStage], position) => ({ id: id(), label, color, baseStage, position }));
  await createMany('pipelineStage', stageRows);
  const stageId = Object.fromEntries(stageRows.map((s) => [s.baseStage, s.id]));

  await createMany('tag', [
    ...SOURCE_TAGS.map((name) => ({ id: id(), name, isSource: true, color: '#0ea5e9' })),
    ...OTHER_TAGS.map((name) => ({ id: id(), name, color: '#6366f1' })),
  ]);

  await createMany('customFieldDefinition', [
    { id: id(), entity: 'CONTACT', key: 'budgetTier', label: 'Budget tier', type: 'SELECT', options: ['SMB', 'MID', 'ENTERPRISE'], position: 0 },
    { id: id(), entity: 'CONTACT', key: 'preferredChannel', label: 'Preferred channel', type: 'SELECT', options: ['Email', 'Phone', 'Video'], position: 1 },
    { id: id(), entity: 'DEAL', key: 'competitor', label: 'Main competitor', type: 'TEXT', position: 0 },
  ]);

  // ── Users ──────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('password123', 12);
  const created = daysAgo(740);
  const users = [
    { id: id(), email: 'admin@leadpulse.dev', firstName: 'Alex', lastName: 'Morgan', role: 'ADMIN' },
    { id: id(), email: 'raj@leadpulse.dev', firstName: 'Raj', lastName: 'Patel', role: 'MANAGER' },
    { id: id(), email: 'sarah@leadpulse.dev', firstName: 'Sarah', lastName: 'Chen', role: 'SALES_REP' },
    { id: id(), email: 'emily@leadpulse.dev', firstName: 'Emily', lastName: 'Torres', role: 'SALES_REP' },
    { id: id(), email: 'mike@leadpulse.dev', firstName: 'Mike', lastName: 'Johnson', role: 'SALES_REP' },
  ].map((u) => ({ ...u, passwordHash, createdAt: created, lastLoginAt: daysAgo(rand(0, 5)) }));
  await createMany('user', users);
  const [admin, manager, ...reps] = users;

  // ── Companies ──────────────────────────────────────────────────────────────
  const usedDomains = new Set();
  const companies = Array.from({ length: 40 }, () => {
    const name = faker.company.name();
    let domain = `${slug(name).slice(0, 30)}.com`;
    while (usedDomains.has(domain)) domain = `${slug(name).slice(0, 26)}-${randInt(10, 99)}.com`;
    usedDomains.add(domain);
    return {
      id: id(), name, domain,
      industry: pick(INDUSTRIES),
      size: pick([10, 25, 50, 120, 250, 500, 1200, 5000]),
      country: pick(COUNTRIES),
      website: `https://www.${domain}`,
      description: faker.company.catchPhrase(),
      createdAt: daysAgo(rand(400, 730)),
    };
  });
  await createMany('company', companies);

  // ── Contacts, deals, histories, activities ─────────────────────────────────
  const contacts = [];
  const deals = [];
  const history = [];
  const activities = [];

  for (let i = 0; i < 300; i++) {
    const status = weighted([['ACTIVE', 55], ['LEAD', 15], ['INACTIVE', 12], ['CHURNED', 18]]);
    const seniority = weighted([[0, 35], [1, 30], [2, 20], [3, 15]]);
    const company = chance(0.92) ? pick(companies) : null;
    const owner = weighted([[reps[0], 30], [reps[1], 25], [reps[2], 25], [manager, 10], [admin, 5], [null, 5]]);
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const win = contactWindow(status);

    const tags = [];
    if (chance(0.85)) tags.push(pick(SOURCE_TAGS));
    tags.push(...faker.helpers.arrayElements(OTHER_TAGS, { min: 0, max: 2 }));

    const contact = {
      id: id(),
      firstName,
      lastName,
      email: `${slug(firstName)}.${slug(lastName)}.${i}@${company ? company.domain : 'example.com'}`,
      phone: faker.phone.number({ style: 'international' }),
      title: pick(TITLES[seniority]),
      linkedinUrl: `https://www.linkedin.com/in/${slug(firstName)}-${slug(lastName)}-${i}`,
      status,
      tags,
      customFields: chance(0.4) ? { budgetTier: pick(['SMB', 'MID', 'ENTERPRISE']) } : undefined,
      companyId: company?.id ?? null,
      ownerId: owner?.id ?? null,
      createdAt: new Date(win.firstTouch - rand(0, 10) * DAY),
      _win: win,
      _seniority: seniority,
    };
    contacts.push(contact);
    const actorId = owner?.id ?? pick(reps).id;

    // Deals for this contact
    const dealCount = {
      ACTIVE: weighted([[1, 40], [2, 40], [3, 20]]),
      LEAD: weighted([[0, 35], [1, 50], [2, 15]]),
      INACTIVE: weighted([[1, 60], [2, 40]]),
      CHURNED: weighted([[1, 65], [2, 35]]),
    }[status];

    const seniorityBoost = [0.7, 0.9, 1.15, 1.4][seniority];
    for (let d = 0; d < dealCount; d++) {
      const base = { ACTIVE: [42, 28, 30], LEAD: [8, 17, 75], INACTIVE: [30, 45, 25], CHURNED: [20, 75, 5] }[status];
      const outcome = weighted([['CLOSED_WON', base[0] * seniorityBoost], ['CLOSED_LOST', base[1]], ['OPEN', base[2]]]);
      const tl = dealTimeline(outcome, win);
      const value = Math.round(Math.exp(rand(Math.log(5_000), Math.log(250_000))) / 500) * 500;
      const last = tl.entries[tl.entries.length - 1];
      const closed = outcome !== 'OPEN';
      const prior = [0.08, 0.18, 0.32, 0.5, 0.68][tl.furthest];

      const deal = {
        id: id(),
        title: `${company ? company.name.split(/[ ,]/)[0] : lastName} — ${faker.commerce.productName()}`,
        value,
        stage: last.stage,
        pipelineStageId: stageId[last.stage],
        winProbability: outcome === 'CLOSED_WON' ? 1 : outcome === 'CLOSED_LOST' ? 0 : round(Math.min(0.95, Math.max(0.02, prior + rand(-0.07, 0.07)))),
        expectedCloseDate: closed
          ? new Date(tl.end + rand(-10, 10) * DAY)
          : new Date(Math.max(NOW + 3 * DAY, last.at + rand(15, 90) * DAY)),
        stageChangedAt: at(last.at),
        closedAt: closed ? at(tl.end) : null,
        lostReason: outcome === 'CLOSED_LOST' ? pick(LOST_REASONS) : null,
        notes: chance(0.4) ? faker.lorem.sentence() : null,
        customFields: chance(0.3) ? { competitor: faker.company.name() } : undefined,
        contactId: contact.id,
        ownerId: contact.ownerId,
        createdAt: at(tl.createdAt),
        _outcome: outcome,
      };
      deals.push(deal);

      tl.entries.forEach((e, idx) => {
        history.push({
          id: id(),
          dealId: deal.id,
          fromStage: idx === 0 ? null : tl.entries[idx - 1].stage,
          toStage: e.stage,
          fromStageId: idx === 0 ? null : stageId[tl.entries[idx - 1].stage],
          toStageId: stageId[e.stage],
          changedById: contact.ownerId,
          changedAt: at(e.at),
        });
      });

      // Deal activities: won deals tend to have more, and usually some in the final week
      // (closing calls); lost deals sometimes do too (last-ditch negotiation).
      const n = outcome === 'CLOSED_WON' ? randInt(2, 9) : outcome === 'CLOSED_LOST' ? randInt(1, 7) : randInt(2, 7);
      const endMs = closed ? tl.end : Math.max(tl.createdAt + DAY, win.lastTouch);
      const closingCount = outcome === 'CLOSED_WON' ? (chance(0.7) ? randInt(1, 2) : 0)
        : outcome === 'CLOSED_LOST' ? (chance(0.35) ? 1 : 0) : 0;
      for (let k = 0; k < n; k++) {
        const closing = k < closingCount;
        const ms = closing ? endMs - rand(0, 6) * DAY : rand(tl.createdAt, endMs);
        const label = outcome === 'CLOSED_WON'
          ? weighted([['POSITIVE', 48], ['NEUTRAL', 38], ['NEGATIVE', 11], ['AT_RISK', 3]])
          : outcome === 'CLOSED_LOST'
            ? weighted([['POSITIVE', 22], ['NEUTRAL', 42], ['NEGATIVE', 24], ['AT_RISK', 12]])
            : sentimentLabel(status, (ms - win.firstTouch) / (win.lastTouch - win.firstTouch));
        activities.push(makeActivity({ contact, dealId: deal.id, occurredAt: at(Math.max(tl.createdAt, ms)), label, userId: actorId }));
      }
    }

    // General contact activities; the last one pins the contact's recency.
    const general = { ACTIVE: randInt(3, 6), LEAD: randInt(2, 5), INACTIVE: randInt(2, 4), CHURNED: randInt(2, 4) }[status];
    for (let k = 0; k < general; k++) {
      const ms = k === 0 ? win.lastTouch : rand(win.firstTouch, win.lastTouch);
      const progress = (ms - win.firstTouch) / (win.lastTouch - win.firstTouch);
      activities.push(makeActivity({ contact, occurredAt: at(ms), label: sentimentLabel(status, progress), userId: actorId }));
    }
  }

  // ── Derived contact scores (same rules as the scoring service) ─────────────────
  const actsByContact = new Map();
  for (const a of activities) {
    if (!actsByContact.has(a.contactId)) actsByContact.set(a.contactId, []);
    actsByContact.get(a.contactId).push(a);
  }
  const openDealsByContact = new Map();
  for (const d of deals) {
    if (d._outcome !== 'OPEN') continue;
    if (!openDealsByContact.has(d.contactId)) openDealsByContact.set(d.contactId, []);
    openDealsByContact.get(d.contactId).push(d);
  }

  const now = new Date(NOW);
  const churnRange = { CHURNED: [0.62, 0.95], INACTIVE: [0.35, 0.65], LEAD: [0.08, 0.4], ACTIVE: [0.02, 0.3] };
  for (const c of contacts) {
    const acts = (actsByContact.get(c.id) || []).sort((a, b) => b.occurredAt - a.occurredAt);
    const last10 = acts.slice(0, 10);
    c.sentimentScore = last10.length ? round(last10.reduce((s, a) => s + a.sentimentScore, 0) / last10.length, 2) : 0.5;
    c.churnRisk = round(rand(...churnRange[c.status]));
    const result = computeLeadScore({
      lastActivityAt: acts[0]?.occurredAt ?? null,
      activityCount30d: acts.filter((a) => NOW - a.occurredAt < 30 * DAY).length,
      openDeals: openDealsByContact.get(c.id) || [],
      now,
    });
    c.leadScore = result.score;
    c.leadScoreLabel = result.label;
    c.leadScoreExplanation = explainLeadScore(result);
  }

  // A handful of stored next-best-actions so the dashboard is populated before the nightly batch.
  const nbaCandidates = contacts
    .filter((c) => c.ownerId && ['HOT', 'WARM'].includes(c.leadScoreLabel) && openDealsByContact.has(c.id))
    .sort((a, b) => b.leadScore - a.leadScore)
    .slice(0, 20);
  for (const c of nbaCandidates) {
    const deal = openDealsByContact.get(c.id)[0];
    c.nextBestAction = weighted([
      [{ action: `Call ${c.firstName} to confirm next steps on "${deal.title}"`, reason: 'Deal is active and the contact engaged recently — keep momentum.', urgency: 'HIGH', type: 'CALL' }, 3],
      [{ action: `Email ${c.firstName} a recap and proposed timeline`, reason: 'A written recap helps them circulate the proposal internally.', urgency: 'MEDIUM', type: 'EMAIL' }, 3],
      [{ action: `Schedule a demo with ${c.firstName}'s wider team`, reason: 'More stakeholders reduce single-champion risk.', urgency: 'MEDIUM', type: 'MEETING' }, 2],
      [{ action: `Create a task to send a tailored case study to ${c.firstName}`, reason: 'Social proof addresses lingering evaluation concerns.', urgency: 'LOW', type: 'TASK' }, 1],
    ]);
    c.nextBestActionAt = daysAgo(rand(0, 2));
  }

  await createMany('contact', contacts.map(({ _win, _seniority, ...c }) => c));
  await createMany('deal', deals.map(({ _outcome, ...d }) => d));
  await createMany('dealStageHistory', history);
  await createMany('activity', activities);

  // ── Score snapshots: six monthly points per contact, four per open deal ────
  const snapshots = [];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  for (const c of contacts) {
    for (let m = 5; m >= 0; m--) {
      const takenAt = daysAgo(m * 30 + rand(0, 3));
      const drift = m / 5;
      snapshots.push(
        { id: id(), entityType: 'contact', entityId: c.id, metric: 'leadScore', value: m === 0 ? c.leadScore : clamp(Math.round(c.leadScore + rand(-25, 25) * drift), 0, 120), takenAt },
        { id: id(), entityType: 'contact', entityId: c.id, metric: 'churnRisk', value: m === 0 ? c.churnRisk : round(clamp(c.churnRisk + rand(-0.25, 0.1) * drift, 0, 1)), takenAt },
        { id: id(), entityType: 'contact', entityId: c.id, metric: 'sentimentScore', value: m === 0 ? c.sentimentScore : round(clamp(c.sentimentScore + rand(-0.1, 0.2) * drift, 0, 1)), takenAt },
      );
    }
  }
  for (const d of deals.filter((x) => x._outcome === 'OPEN')) {
    for (let k = 3; k >= 0; k--) {
      snapshots.push({ id: id(), entityType: 'deal', entityId: d.id, metric: 'winProbability', value: k === 0 ? d.winProbability : round(clamp(d.winProbability + rand(-0.15, 0.05) * k, 0, 1)), takenAt: daysAgo(k * 14) });
    }
  }
  await createMany('scoreSnapshot', snapshots);

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const taskContacts = contacts.filter((c) => ['ACTIVE', 'LEAD'].includes(c.status));
  const tasks = Array.from({ length: 120 }, () => {
    const c = pick(taskContacts);
    const assignee = users.find((u) => u.id === c.ownerId) ?? pick(reps);
    const completed = chance(0.3);
    const due = weighted([['overdue', 20], ['today', 15], ['week', 25], ['later', 30], ['none', 10]]);
    const dueDate = {
      overdue: daysAgo(rand(1, 10)),
      today: new Date(NOW + rand(1, 8) * 3_600_000),
      week: new Date(NOW + rand(1, 6) * DAY),
      later: new Date(NOW + rand(7, 45) * DAY),
      none: null,
    }[due];
    const openDeal = openDealsByContact.get(c.id)?.[0];
    return {
      id: id(),
      title: pick(TASK_TITLES),
      description: chance(0.5) ? faker.lorem.sentence() : null,
      dueDate,
      priority: weighted([['LOW', 25], ['MEDIUM', 50], ['HIGH', 25]]),
      completed,
      completedAt: completed ? daysAgo(rand(0, 7)) : null,
      contactId: c.id,
      dealId: openDeal && chance(0.5) ? openDeal.id : null,
      assignedToId: assignee.id,
      createdById: chance(0.7) ? assignee.id : manager.id,
      createdAt: daysAgo(rand(1, 30)),
    };
  });
  await createMany('task', tasks);

  // ── Email workspace: inbound + sent threads and a few drafts ───────────────
  const emails = [];
  for (const c of faker.helpers.arrayElements(taskContacts, 55)) {
    const ownerId = c.ownerId ?? pick(reps).id;
    const threadEnd = Math.min(NOW - 3_600_000, c._win.lastTouch);
    let t = threadEnd - rand(10, 60) * DAY;
    const length = randInt(2, 4);
    for (let k = 0; k < length; k++) {
      t = Math.min(threadEnd, t + rand(1, 8) * DAY);
      const inbound = k % 2 === 1 || (k === 0 && chance(0.4));
      if (inbound) {
        const [subject, body] = pick(INBOUND_EMAILS);
        emails.push({ id: id(), direction: 'INBOUND', status: 'RECEIVED', subject, body, receivedAt: at(t), contactId: c.id, createdById: ownerId, createdAt: at(t) });
      } else {
        const [subject, body] = pick(OUTBOUND_EMAILS);
        emails.push({ id: id(), direction: 'OUTBOUND', status: 'SENT', subject, body, sentAt: at(t), contactId: c.id, createdById: ownerId, createdAt: at(t) });
      }
    }
    if (chance(0.15)) {
      emails.push({
        id: id(), direction: 'OUTBOUND', status: 'DRAFT', subject: 'Re: next steps',
        body: `Hi ${c.firstName},\n\nThanks for the update — I have put together a short plan for a phased rollout. Would Thursday work for a 20-minute call?\n\nBest regards`,
        aiGenerated: true, tone: 'professional', contactId: c.id, createdById: ownerId, createdAt: daysAgo(rand(0, 3)),
      });
    }
  }
  await createMany('emailDraft', emails);

  // ── Notifications (a few unread per rep) ───────────────────────────────────
  const notifications = [];
  for (const u of [...reps, manager]) {
    const mine = deals.filter((d) => d.ownerId === u.id && d._outcome === 'OPEN').slice(0, 2);
    for (const d of mine) {
      notifications.push({ id: id(), userId: u.id, type: 'deal', title: 'Deal stage updated', message: `"${d.title}" moved to ${d.stage.charAt(0)}${d.stage.slice(1).toLowerCase()}`, link: `/deals/${d.id}`, createdAt: daysAgo(rand(0, 3)) });
    }
    const risky = contacts.find((c) => c.ownerId === u.id && c.churnRisk > 0.7);
    if (risky) {
      notifications.push({ id: id(), userId: u.id, type: 'churn', title: 'Churn alert', message: `${risky.firstName} ${risky.lastName} has ${Math.round(risky.churnRisk * 100)}% churn risk`, link: `/contacts/${risky.id}`, createdAt: daysAgo(rand(0, 2)), readAt: chance(0.3) ? daysAgo(0) : null });
    }
  }
  await createMany('notification', notifications);

  // ── Summary ────────────────────────────────────────────────────────────────
  const closed = deals.filter((d) => d._outcome !== 'OPEN');
  const won = closed.filter((d) => d._outcome === 'CLOSED_WON').length;
  const counts = {
    users: users.length, companies: companies.length, contacts: contacts.length,
    deals: `${deals.length} (${closed.length} closed: ${won} won / ${closed.length - won} lost)`,
    stageHistory: history.length, activities: activities.length, tasks: tasks.length,
    emails: emails.length, snapshots: snapshots.length, notifications: notifications.length,
  };
  for (const [k, v] of Object.entries(counts)) console.log(`✓  ${k.padEnd(13)} ${v}`);
  console.log('\n🔑  Demo accounts (password: password123)');
  for (const u of users) console.log(`    ${u.role.padEnd(10)} ${u.email}`);
  console.log('');
}

main()
  .catch((err) => {
    console.error('\n❌  Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
