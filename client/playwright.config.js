import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests against a running stack (`docker compose up`) with the
 * demo seed loaded. Override the target with E2E_BASE_URL.
 */
export default defineConfig({
  testDir: './e2e',
  // The dev stack compiles pages on demand and computes forecasts per request, so allow headroom.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
