/**
 * LeadPulse CRM — Database Seed Script
 *
 * Generates realistic, statistically balanced data for:
 * - ML model training (churn, lead scoring, win probability)
 * - UI development and testing
 * - Demo purposes
 *
 * Usage: npm run seed
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const { faker } = require('@faker-js/faker');
const bcrypt = require('bcryptjs');

// ── Prisma client with adapter ────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ── Seed constants ─────────────────────────────────────────────────────────────
const DEAL_STAGES = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];
const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE'];
const SENTIMENT_LABELS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'];

const INDUSTRIES = [
  'Technology', 'Finance', 'Healthcare', 'Retail',
  'Manufacturing', 'Education', 'Real Estate', 'Media',
  'Logistics', 'SaaS',
];

const TAGS = [
  'VIP', 'Cold Lead', 'Hot Lead', 'Partner',
  'Enterprise', 'SMB', 'Referral', 'Event Lead',
  'Inbound', 'Outbound',
];

// Realistic activity notes for sentiment training
const POSITIVE_NOTES = [
  'Customer signed the contract. Very excited about onboarding next week.',
  'Excellent demo — prospect asked about expanding to 3 teams immediately.',
  'Budget approved. Moving forward with enterprise plan.',
  'Decision maker loved the ROI dashboard. Ready to proceed.',
  'Champion reached out proactively — wants to schedule kickoff.',
];

const NEUTRAL_NOTES = [
  'Left voicemail. Will follow up in 3 business days.',
  'Sent product overview and pricing sheet. Awaiting response.',
  'Discovery call completed. Gathering requirements from their team.',
  'Rescheduled demo to next Tuesday. No concerns raised.',
  "CC'd their procurement team. Standard evaluation process.",
];

const NEGATIVE_NOTES = [
  'Customer frustrated with response times. At risk of churning.',
  'Lost contact — not responding to emails or calls for 2 weeks.',
  'Chose competitor. Primary concern was pricing.',
  'Decision postponed indefinitely — budget freeze.',
  'Call went poorly. Customer reported ongoing product issues.',
];

const AT_RISK_NOTES = [
  'Usage metrics dropped 60% this month. Need urgent check-in.',
  'Champion left the company. No internal sponsor now.',
  'Competitor demo scheduled for next week. Need to accelerate.',
  'Invoice overdue — relationship strained.',
];

const LOST_REASONS = [
  'Price too high', 'Chose competitor', 'No budget',
  'No decision made', 'Poor timing', 'Feature gap',
];

const TASK_TITLES = [
  'Follow up via email', 'Schedule product demo', 'Send pricing proposal',
  'Call to discuss contract terms', 'Send onboarding docs', 'Check in after demo',
  'Prepare executive presentation', 'Research competitor pricing',
  'Arrange reference call', 'Send case study', 'Schedule QBR',
];

// ── Helper utilities ───────────────────────────────────────────────────────────

/**
 * Returns a sentiment score within the appropriate range for the given label.
 */
function sentimentScoreFor(label) {
  const ranges = {
    POSITIVE: [0.70, 1.00],
    NEUTRAL:  [0.40, 0.70],
    NEGATIVE: [0.15, 0.40],
    AT_RISK:  [0.00, 0.20],
  };
  const [min, max] = ranges[label] ?? [0.4, 0.7];
  return faker.number.float({ min, max, fractionDigits: 2 });
}

/**
 * Returns a churn risk float for a given contact status.
 * Churned contacts have high risk; active contacts have low.
 */
function churnRiskFor(status) {
  const ranges = {
    CHURNED:  [0.60, 1.00],
    INACTIVE: [0.35, 0.65],
    LEAD:     [0.05, 0.35],
    ACTIVE:   [0.00, 0.25],
  };
  const [min, max] = ranges[status] ?? [0.05, 0.5];
  return faker.number.float({ min, max, fractionDigits: 2 });
}

/**
 * Picks a note appropriate to the sentiment label.
 */
function noteForSentiment(label) {
  const pools = {
    POSITIVE: POSITIVE_NOTES,
    NEUTRAL:  NEUTRAL_NOTES,
    NEGATIVE: NEGATIVE_NOTES,
    AT_RISK:  AT_RISK_NOTES,
  };
  return faker.helpers.arrayElement(pools[label] ?? NEUTRAL_NOTES);
}

// ── Truncation (reverse FK order) ─────────────────────────────────────────────
async function truncateAll() {
  const tables = [
    'ai_logs', 'embeddings', 'email_drafts', 'tasks',
    'activities', 'deals', 'contacts', 'companies', 'users',
  ];
  // Use raw SQL TRUNCATE with CASCADE to handle FKs efficiently
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`
  );
}

// ── Main seed function ─────────────────────────────────────────────────────────
async function main() {
  console.log('\n🌱  Seeding LeadPulse database...\n');

  // Clear existing data
  await truncateAll();
  console.log('✓  Cleared all tables');

  // ── 1. USERS ─────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('password123', 12);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@leadpulse.dev',
      passwordHash,
      firstName: 'Alex',
      lastName: 'Admin',
      role: 'ADMIN',
    },
  });

  const salesReps = await Promise.all([
    prisma.user.create({ data: { email: 'sarah@leadpulse.dev', passwordHash, firstName: 'Sarah', lastName: 'Chen', role: 'SALES_REP' } }),
    prisma.user.create({ data: { email: 'raj@leadpulse.dev',   passwordHash, firstName: 'Raj',   lastName: 'Patel',  role: 'SALES_REP' } }),
    prisma.user.create({ data: { email: 'emily@leadpulse.dev', passwordHash, firstName: 'Emily', lastName: 'Torres', role: 'SALES_REP' } }),
  ]);

  const allUsers = [admin, ...salesReps];
  console.log(`✓  Created ${allUsers.length} users`);

  // ── 2. COMPANIES ──────────────────────────────────────────────────────────────
  const companyData = Array.from({ length: 30 }, () => ({
    name:        faker.company.name(),
    domain:      `${faker.word.noun()}-${faker.number.int({ min: 100, max: 999 })}.${faker.internet.domainSuffix()}`,
    industry:    faker.helpers.arrayElement(INDUSTRIES),
    size:        faker.helpers.arrayElement([10, 50, 100, 250, 500, 1000, 5000]),
    country:     faker.helpers.arrayElement(['India', 'USA', 'UK', 'Germany', 'Singapore', 'Australia']),
    website:     faker.internet.url(),
    description: faker.company.catchPhrase(),
  }));

  await prisma.company.createMany({ data: companyData });
  const companies = await prisma.company.findMany();
  console.log(`✓  Created ${companies.length} companies`);

  // ── 3. CONTACTS ───────────────────────────────────────────────────────────────
  // Status distribution: ~60% ACTIVE, 15% LEAD, 10% INACTIVE, 15% CHURNED
  // This mirrors a realistic CRM with a meaningful churn rate for ML training.
  const statusPool = [
    ...Array(12).fill('ACTIVE'),
    ...Array(3).fill('LEAD'),
    ...Array(2).fill('INACTIVE'),
    ...Array(3).fill('CHURNED'),
  ];

  const contactsToCreate = Array.from({ length: 200 }, () => {
    const status = faker.helpers.arrayElement(statusPool);
    return {
      firstName:     faker.person.firstName(),
      lastName:      faker.person.lastName(),
      email:         faker.internet.email(),
      phone:         faker.phone.number(),
      title:         faker.person.jobTitle(),
      linkedinUrl:   `https://linkedin.com/in/${faker.internet.username()}`,
      status,
      leadScore:     faker.number.int({ min: 0, max: 100 }),
      churnRisk:     churnRiskFor(status),
      sentimentScore: faker.number.float({
        min: status === 'CHURNED' ? 0.05 : 0.35,
        max: status === 'CHURNED' ? 0.35 : 0.95,
        fractionDigits: 2,
      }),
      tags:          faker.helpers.arrayElements(TAGS, { min: 0, max: 3 }),
      companyId:     faker.helpers.arrayElement(companies).id,
      ownerId:       faker.helpers.arrayElement(allUsers).id,
    };
  });

  await prisma.contact.createMany({ data: contactsToCreate });
  const contacts = await prisma.contact.findMany({ select: { id: true, status: true, ownerId: true } });
  console.log(`✓  Created ${contacts.length} contacts`);

  // ── 4. DEALS ──────────────────────────────────────────────────────────────────
  // Stage distribution weighted to match real pipeline shape (more CLOSED_LOST than WON)
  const stagePool = [
    'LEAD', 'CONTACTED', 'CONTACTED',
    'DEMO', 'DEMO', 'PROPOSAL',
    'NEGOTIATION',
    'CLOSED_WON', 'CLOSED_WON',
    'CLOSED_LOST', 'CLOSED_LOST', 'CLOSED_LOST',
  ];

  const stageWinProb = {
    LEAD:         () => faker.number.float({ min: 0.05, max: 0.15, fractionDigits: 2 }),
    CONTACTED:    () => faker.number.float({ min: 0.10, max: 0.25, fractionDigits: 2 }),
    DEMO:         () => faker.number.float({ min: 0.20, max: 0.45, fractionDigits: 2 }),
    PROPOSAL:     () => faker.number.float({ min: 0.35, max: 0.60, fractionDigits: 2 }),
    NEGOTIATION:  () => faker.number.float({ min: 0.55, max: 0.85, fractionDigits: 2 }),
    CLOSED_WON:   () => 1.0,
    CLOSED_LOST:  () => 0.0,
  };

  const dealsToCreate = Array.from({ length: 120 }, () => {
    const contact = faker.helpers.arrayElement(contacts);
    const stage   = faker.helpers.arrayElement(stagePool);
    return {
      title:             `${faker.commerce.productName()} Deal`,
      value:             faker.number.int({ min: 5000, max: 250000 }),
      stage,
      winProbability:    stageWinProb[stage](),
      expectedCloseDate: faker.date.future({ years: 1 }),
      lostReason:        stage === 'CLOSED_LOST' ? faker.helpers.arrayElement(LOST_REASONS) : null,
      contactId:         contact.id,
      ownerId:           contact.ownerId ?? faker.helpers.arrayElement(allUsers).id,
      createdAt:         faker.date.past({ years: 1 }),
    };
  });

  await prisma.deal.createMany({ data: dealsToCreate });
  const deals = await prisma.deal.findMany({ select: { id: true } });
  console.log(`✓  Created ${deals.length} deals`);

  // ── 5. ACTIVITIES ─────────────────────────────────────────────────────────────
  // Generate 3-8 activities per contact for realistic ML training data.
  const activitiesToCreate = [];

  for (const contact of contacts) {
    const count = faker.number.int({ min: 3, max: 8 });

    for (let i = 0; i < count; i++) {
      const type = faker.helpers.arrayElement(ACTIVITY_TYPES);

      // Sentiment distribution driven by contact status
      const sentimentLabel =
        contact.status === 'CHURNED'
          ? faker.helpers.arrayElement(['NEGATIVE', 'NEGATIVE', 'AT_RISK'])
          : contact.status === 'INACTIVE'
          ? faker.helpers.arrayElement(['NEUTRAL', 'NEGATIVE', 'AT_RISK'])
          : faker.helpers.arrayElement([...SENTIMENT_LABELS, 'POSITIVE', 'POSITIVE']); // active skews positive

      activitiesToCreate.push({
        type,
        subject:        type === 'EMAIL' ? faker.lorem.sentence() : null,
        notes:          noteForSentiment(sentimentLabel),
        sentiment:      sentimentLabel,
        sentimentScore: sentimentScoreFor(sentimentLabel),
        durationMinutes: type === 'CALL' || type === 'MEETING'
          ? faker.number.int({ min: 5, max: 90 })
          : null,
        contactId:  contact.id,
        dealId:     faker.helpers.maybe(() => faker.helpers.arrayElement(deals).id, { probability: 0.4 }),
        userId:     contact.ownerId ?? admin.id,
        occurredAt: faker.date.past({ years: 1 }),
      });
    }
  }

  // Batch insert in chunks to avoid hitting parameter limits
  const CHUNK = 500;
  for (let i = 0; i < activitiesToCreate.length; i += CHUNK) {
    await prisma.activity.createMany({ data: activitiesToCreate.slice(i, i + CHUNK) });
  }
  console.log(`✓  Created ${activitiesToCreate.length} activities`);

  // ── 6. TASKS ──────────────────────────────────────────────────────────────────
  const tasksToCreate = Array.from({ length: 80 }, () => {
    const contact  = faker.helpers.arrayElement(contacts);
    const assignee = faker.helpers.arrayElement(allUsers);
    const completed = faker.datatype.boolean({ probability: 0.3 });
    const dueDate   = faker.date.soon({ days: 30 });
    return {
      title:       faker.helpers.arrayElement(TASK_TITLES),
      dueDate,
      priority:    faker.helpers.arrayElement(['LOW', 'MEDIUM', 'HIGH']),
      completed,
      completedAt: completed ? faker.date.recent({ days: 7 }) : null,
      contactId:   contact.id,
      assignedToId: assignee.id,
      createdById:  admin.id,
    };
  });

  await prisma.task.createMany({ data: tasksToCreate });
  console.log(`✓  Created ${tasksToCreate.length} tasks`);

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n✅  Seeding complete!\n');
  console.log('🔑  Test credentials:');
  console.log('    Admin:     admin@leadpulse.dev  /  password123');
  console.log('    Sales Rep: sarah@leadpulse.dev  /  password123');
  console.log('    Sales Rep: raj@leadpulse.dev    /  password123');
  console.log('    Sales Rep: emily@leadpulse.dev  /  password123');
  console.log('');
}

main()
  .catch((err) => {
    console.error('\n❌  Seed failed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
    await prisma.$disconnect();
  });
