import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test-browser', testMatch: '*.spec.ts',
  workers: 1, timeout: 45_000, globalTimeout: 5 * 60_000,
  expect: { timeout: 10_000 }, forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  projects: ['chromium', 'webkit'].map(browser => ({ name: browser, use: { browserName: browser as 'chromium' | 'webkit' } })),
  reporter: [['list'], ['json', { outputFile: 'node_modules/.cache/verba-health/results.json' }]],
  outputDir: 'node_modules/.cache/verba-health/artifacts',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
