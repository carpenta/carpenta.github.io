import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// The same e2e tests on WebKit with an iPhone profile (390×664, touch, mobile viewport), for iPhone Safari
// and the home-screen web app. Own port, results and report folders, so it never reuses or overwrites the
// Chromium run. Findings: docs/WEBKIT-QA.md.
const PORT = 4185;

export default defineConfig({
  ...base,
  outputDir: 'test-results/webkit',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/webkit' }]],
  use: {
    ...base.use,
    baseURL: `http://127.0.0.1:${PORT}`,
    // WebKit applies the page's CSP (style-src 'self') to the <style> Playwright adds to hide the caret in a
    // screenshot, and logs "Refused to apply a stylesheet", which the suite counts as an app error. A context
    // closed mid-test is screenshotted too, so the backup test would always fail. The trace (screencast and
    // DOM snapshots) covers failures instead.
    screenshot: 'off',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: {
    command: `bun run build && bun run preview --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
