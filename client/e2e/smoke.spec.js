import { test, expect } from '@playwright/test';

/**
 * Smoke test of the core CRM loop as a sales rep: sign in, survive a reload,
 * create a contact, log an activity, create a deal, drag it to another column,
 * and edit deal notes that must still be there after a reload.
 * Everything it creates is deleted afterwards.
 */

const run = Date.now();
const contact = { firstName: 'Smoke', lastName: `Test ${run}`, email: `smoke+${run}@example.com` };
const dealTitle = `Smoke deal ${run}`;
const notes = `Pilot scoped for 3 seats (${run})`;

let api; // { token, contactId }

// Wide enough to show all seven pipeline columns without horizontal scrolling.
test.use({ viewport: { width: 2560, height: 1100 } });

async function apiLogin(request) {
  const res = await request.post('/api/auth/login', { data: { email: 'sarah@leadpulse.dev', password: 'password123' } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).accessToken;
}

test.afterAll(async ({ request }) => {
  if (!api?.contactId) return;
  const token = api.token || (await apiLogin(request));
  // Deals and activities cascade with the contact.
  await request.delete(`/api/contacts/${api.contactId}`, { headers: { Authorization: `Bearer ${token}` } });
});

test('core CRM flow as a sales rep', async ({ page, request }) => {
  // Protected pages bounce to login and come back afterwards.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  await page.getByLabel('Email address').fill('sarah@leadpulse.dev');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // The session is restored from the refresh cookie after a reload.
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Total Contacts')).toBeVisible();

  // Create a contact.
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Add Contact' }).click();
  await page.getByLabel('First name').fill(contact.firstName);
  await page.getByLabel('Last name').fill(contact.lastName);
  await page.getByLabel('Email').fill(contact.email);
  await page.getByRole('button', { name: 'Create Contact' }).click();
  await expect(page.getByText('Contact created')).toBeVisible();

  await page.getByPlaceholder('Search contacts...').fill(contact.email);
  await page.getByText(`${contact.firstName} ${contact.lastName}`).first().click();
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);
  api = { contactId: page.url().split('/').pop() };

  // Log an activity on it (from the contact's Activities tab).
  await page.getByRole('tab', { name: 'Activities' }).click();
  await page.getByRole('button', { name: 'Log Activity' }).first().click();
  await page.getByLabel('Subject').fill('Smoke test call');
  await page.locator('form textarea').fill('Great call, they want a pilot.');
  await page.getByRole('button', { name: 'Log Activity' }).last().click();
  await expect(page.getByText('Activity logged')).toBeVisible();
  await expect(page.getByText('Smoke test call')).toBeVisible();

  // Create a deal for the contact (it starts in Lead).
  await page.goto('/deals');
  await page.getByRole('button', { name: 'Add Deal' }).first().click();
  await page.getByLabel('Deal title').fill(dealTitle);
  await page.getByLabel('Value ($)').fill('4200');
  await page.getByLabel('Contact').selectOption(api.contactId);
  await page.getByRole('button', { name: 'Create Deal' }).click();
  await expect(page.getByText('Deal created')).toBeVisible();

  // Drag it onto the Demo column's background (not onto another card). The
  // viewport is wide enough that the board never scrolls, so the measured
  // positions stay valid; if the overlay doesn't show our deal, the drag is
  // cancelled so no other deal can be moved by mistake.
  const handle = page.getByLabel(`Move ${dealTitle}`);
  const target = page.locator('[data-stage="DEMO"]');
  await expect(handle).toBeInViewport();
  await expect(target).toBeInViewport();
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 15, from.y + from.height / 2, { steps: 5 });
  if ((await page.getByText(dealTitle).count()) < 2) {
    await page.keyboard.press('Escape');
    await page.mouse.up();
    throw new Error('The drag did not pick up the test deal');
  }
  // Columns stretch to the tallest one, so aim near the top where it is on screen.
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 25 });
  const stageSaved = page.waitForResponse((r) => r.url().includes(`/stage`) && r.request().method() === 'PATCH');
  await page.mouse.up();
  const stageRes = await stageSaved;
  expect(stageRes.request().postDataJSON().pipelineStageId).toBe(await target.getAttribute('data-stage-id'));
  expect(stageRes.ok()).toBeTruthy();

  api.token = await apiLogin(request);
  const deals = await request.get('/api/deals', {
    params: { view: 'list', contactId: api.contactId },
    headers: { Authorization: `Bearer ${api.token}` },
  });
  const deal = (await deals.json()).deals.find((d) => d.title === dealTitle);
  expect(deal.stage).toBe('DEMO');

  // Notes are loaded before editing and survive a reload.
  await page.goto(`/deals/${deal.id}`);
  const editor = page.getByLabel('Notes');
  await expect(editor).toHaveValue('');
  const notesSaved = page.waitForResponse((r) => r.url().endsWith(`/api/deals/${deal.id}`) && r.request().method() === 'PATCH');
  await editor.fill(notes);
  expect((await notesSaved).ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByLabel('Notes')).toHaveValue(notes);
});
