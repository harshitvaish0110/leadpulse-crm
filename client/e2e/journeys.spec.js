import { test, expect } from '@playwright/test';

/**
 * Short user journeys on the list pages, as a sales rep. Each journey creates
 * its own records through the API and removes them afterwards.
 */

const run = Date.now();
let token;
const created = { contacts: [], tasks: [] };

test.use({ viewport: { width: 1600, height: 1000 } });

const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/auth/login', { data: { email: 'sarah@leadpulse.dev', password: 'password123' } });
  token = (await res.json()).accessToken;
});

test.afterAll(async ({ request }) => {
  for (const id of created.tasks) await request.delete(`/api/tasks/${id}`, auth());
  for (const id of created.contacts) await request.delete(`/api/contacts/${id}`, auth());
});

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('sarah@leadpulse.dev');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/my-day$/); // sales reps start on My Day
});

test('contacts: filter from the URL, then tag and delete in bulk', async ({ page, request }) => {
  for (const n of [1, 2]) {
    const res = await request.post('/api/contacts', { ...auth(), data: { firstName: 'Bulk', lastName: `Journey ${run} ${n}`, email: `journey+${run}-${n}@example.com` } });
    created.contacts.push((await res.json()).contact.id);
  }

  await page.goto(`/contacts?q=${run}`);
  await expect(page.getByRole('row').filter({ hasText: `Journey ${run}` })).toHaveCount(2);

  await page.getByLabel('Select all on this page').check();
  // An existing tag, so the journey does not leave a new one behind.
  await page.getByRole('region', { name: 'Bulk actions' }).getByLabel('Tag').fill('VIP');
  await page.getByRole('button', { name: 'Add tag' }).click();
  await expect(page.getByText('Tagged 2 contacts')).toBeVisible();
  for (const id of created.contacts) {
    const contact = (await (await request.get(`/api/contacts/${id}`, auth())).json()).contact;
    expect(contact.tags).toContain('VIP');
  }

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('Select all on this page').check();
  await page.getByRole('region', { name: 'Bulk actions' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Deleted 2 contacts')).toBeVisible();
  await expect(page.getByText('No contacts found')).toBeVisible();
  created.contacts.length = 0;
});

test('tasks: quick-add from the floating button, then complete it', async ({ page, request }) => {
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add task' }).click();
  const title = `Journey task ${run}`;
  await page.getByLabel('Task title').fill(title);
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await page.getByLabel('Due date').fill(iso);
  await page.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.getByText('Task created')).toBeVisible();

  const todayGroup = page.locator('section', { has: page.getByRole('heading', { name: /Due today/ }) });
  await expect(todayGroup.getByText(title)).toBeVisible();

  const tasks = (await (await request.get('/api/tasks', { ...auth(), params: { limit: 100, completed: 'false' } })).json()).tasks;
  const task = tasks.find((t) => t.title === title);
  created.tasks.push(task.id);

  // Completing is optimistic: the row leaves the group at once, so click rather than check().
  await page.getByLabel(`Mark "${title}" done`).click();
  await expect(todayGroup.getByText(title)).toHaveCount(0);
  await expect.poll(async () => (await (await request.get('/api/tasks', { ...auth(), params: { limit: 100, completed: 'true' } })).json())
    .tasks.some((t) => t.id === task.id)).toBe(true);
});

test('deals: the list view sorts by value from the column header', async ({ page }) => {
  await page.goto('/deals');
  await page.getByRole('button', { name: 'List' }).click();
  await expect(page).toHaveURL(/view=list/);
  await page.getByRole('button', { name: 'Value' }).click();
  await expect(page).toHaveURL(/sort=value%3Adesc|sort=value:desc/);
  const cells = page.getByRole('row').locator('td:nth-child(4)');
  await expect(cells.first()).toBeVisible();
  const amount = (v) => Number(v.replace(/[$,K]/g, '').replace('M', '')) * (v.includes('M') ? 1e6 : v.includes('K') ? 1e3 : 1);
  // The previous page stays on screen until the sorted one arrives, so wait for the order to change.
  await expect.poll(async () => {
    const values = (await cells.allTextContents()).slice(0, 5).map(amount);
    return values.length > 1 && values.every((v, i) => i === 0 || values[i - 1] >= v);
  }).toBe(true);
});

test('analytics: the date range applies to the page and is kept in the URL', async ({ page }) => {
  await page.goto('/analytics');
  await page.getByRole('button', { name: '30 days' }).click();
  await expect(page).toHaveURL(/range=30d/);
  await expect(page.getByRole('heading', { name: 'Pipeline funnel' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
});
