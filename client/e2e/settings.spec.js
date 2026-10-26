import { test, expect } from '@playwright/test';

/** Workspace configuration as an admin: a pipeline stage added in Settings becomes a board column. */

const label = `E2E stage ${Date.now()}`;
let token;

test.use({ viewport: { width: 1600, height: 1000 } });

const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/auth/login', { data: { email: 'admin@leadpulse.dev', password: 'password123' } });
  token = (await res.json()).accessToken;
});

test.afterAll(async ({ request }) => {
  const { stages } = await (await request.get('/api/settings/pipeline-stages', auth())).json();
  for (const s of stages.filter((x) => x.label === label)) await request.delete(`/api/settings/pipeline-stages/${s.id}`, auth());
});

test('pipeline: add a stage in Settings, see it on the board, delete it', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('admin@leadpulse.dev');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/settings/pipeline');
  await page.getByLabel('New stage name').fill(label);
  await page.getByLabel('New stage counts as').selectOption('DEMO');
  await page.getByRole('button', { name: 'Add stage' }).click();
  await expect(page.getByText('Stage added')).toBeVisible();

  const names = page.getByRole('list', { name: 'Pipeline stages' }).getByLabel('Stage name');
  const values = await names.evaluateAll((inputs) => inputs.map((i) => i.value));
  expect(values.indexOf(label)).toBe(values.indexOf('Demo') + 1); // right after the other Demo column

  await page.goto('/deals');
  await expect(page.getByText(label, { exact: true })).toBeVisible();

  await page.goto('/settings/pipeline');
  await page.getByRole('button', { name: `Delete ${label}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete stage' }).click();
  await expect(page.getByText('Stage deleted')).toBeVisible();
  await expect.poll(() => names.evaluateAll((inputs) => inputs.map((i) => i.value))).not.toContain(label);
});
