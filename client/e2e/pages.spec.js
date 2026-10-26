import { test, expect } from '@playwright/test';

/**
 * Every page and tab renders for a manager without a crash, an error
 * boundary or a console error. Read-only: nothing is created or changed.
 */

test.use({ viewport: { width: 1600, height: 1000 } });

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function firstId(request, token, path, key) {
  const res = await request.get(path, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json())[key][0].id;
}

test('every page renders cleanly for a manager', async ({ page, request }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  // Network failures are checked by URL below; the browser's generic "failed to load" console line is not.
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (!res.url().includes('/api/') || res.status() < 400) return;
    // Before signing in, the session check on /login is expected to answer 401.
    if (res.status() === 401 && res.url().endsWith('/api/auth/refresh')) return;
    errors.push(`HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
  });

  const login = await request.post('/api/auth/login', { data: { email: 'raj@leadpulse.dev', password: 'password123' } });
  const { accessToken } = await login.json();
  const contactId = await firstId(request, accessToken, '/api/contacts?limit=1', 'contacts');
  const companyId = await firstId(request, accessToken, '/api/companies?limit=1', 'companies');
  const dealId = await firstId(request, accessToken, '/api/deals?view=list&limit=1', 'deals');

  await signIn(page, 'raj@leadpulse.dev');

  const pages = [
    ['/my-day', "Today's briefing"],
    ['/dashboard', 'Revenue'],
    ['/contacts', 'All Contacts'],
    ['/contacts?status=ACTIVE&score=HOT&sort=churnRisk:desc', 'All Contacts'],
    ...['overview', 'activities', 'deals', 'emails', 'tasks', 'insights'].map((tab) => [`/contacts/${contactId}?tab=${tab}`, 'Churn risk']),
    ['/companies', 'Companies'],
    ...['contacts', 'deals', 'activities'].map((tab) => [`/companies/${companyId}?tab=${tab}`, 'Back to Companies']),
    ['/deals', 'Deals Pipeline'],
    ['/deals?view=list&sort=value:desc', 'Deals Pipeline'],
    [`/deals/${dealId}`, 'Attachments'],
    ['/activities', 'Activities'],
    ['/tasks', 'My Tasks'],
    ['/tasks?view=all&mode=calendar', 'All Tasks'],
    ['/analytics', 'Pipeline funnel'],
    ['/analytics?range=30d', 'Lead sources'],
    ['/ai-assistant', 'AI'],
    ['/settings/profile', 'Your profile'],
  ];

  for (const [path, marker] of pages) {
    await page.goto(path);
    await expect(page.getByText(marker).first(), `${path} shows "${marker}"`).toBeVisible();
    await expect(page.getByText('Something went wrong on this page'), `${path} has no page error`).toHaveCount(0);
    await expect(page.getByText('could not be shown'), `${path} has no section error`).toHaveCount(0);
    await page.waitForTimeout(400); // let late renders and requests surface errors
  }

  // Admin-only settings are refused politely for a manager.
  await page.goto('/settings/users');
  await expect(page.getByText('You need admin access')).toBeVisible();

  expect(errors, errors.join('\n')).toEqual([]);
});
