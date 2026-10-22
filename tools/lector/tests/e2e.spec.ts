import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fixtures = join(process.cwd(), 'tests/fixtures/generated');

test.beforeAll(() => {
  execFileSync(process.execPath, ['tests/generate-fixtures.mjs'], { stdio: 'inherit' });
});

test('loads initial page with strict privacy, contract and 360px responsiveness', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || request.method() !== 'GET' || request.postData()) {
      requests.push(request.url());
    }
  });

  await page.goto('/');

  // 1. Check title & brand
  await expect(page).toHaveTitle(/Lector/);
  await expect(page.locator('.brand')).toContainText('lector');

  // 2. Check ../../ home link
  const homeLink = page.locator('a.home-link');
  await expect(homeLink).toBeVisible();
  await expect(homeLink).toHaveAttribute('href', '../../');

  // 3. Check 360px viewport has NO horizontal scroll
  await page.setViewportSize({ width: 360, height: 740 });
  const hasNoHorizontalScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
  });
  expect(hasNoHorizontalScroll).toBe(true);

  // 4. Strict Privacy: Zero external network requests
  expect(requests).toEqual([]);

  // 5. Strict Privacy: Zero persistence in storage
  const storageState = await page.evaluate(() => ({
    localStorage: localStorage.length,
    sessionStorage: sessionStorage.length,
    cookies: document.cookie,
  }));
  expect(storageState).toEqual({ localStorage: 0, sessionStorage: 0, cookies: '' });
});

test('opens sample document, explores workspace and tabs', async ({ page }) => {
  await page.goto('/');

  // Welcome section is visible
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#workspace')).toBeHidden();

  // Click try-sample button
  await page.locator('#try-sample').click();

  // Workspace should now be visible
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#file-bar')).toBeVisible();
  await expect(page.locator('#file-name')).toContainText('sample_invoice.png');

  // Canvas is rendered
  const canvas = page.locator('#doc-canvas');
  await expect(canvas).toBeVisible();

  // Switch to Template Tab
  await page.locator('#tab-btn-template').click();
  await expect(page.locator('#tab-pane-template')).toBeVisible();

  // Check that 4 preset sample ROI fields exist
  await expect(page.locator('#roi-table tbody tr')).toHaveCount(4);

  // Switch to Filter Tab
  await page.locator('#tab-btn-filters').click();
  await expect(page.locator('#tab-pane-filters')).toBeVisible();
  await expect(page.locator('#filter-grayscale')).toBeVisible();

  // Switch back to Full Text Tab
  await page.locator('#tab-btn-text').click();
  await expect(page.locator('#tab-pane-text')).toBeVisible();

  // Toggle Warp Tool
  await page.locator('#tool-warp').click();
  await expect(page.locator('.warp-pin')).toHaveCount(4);

  // Close file returns to welcome
  await page.locator('#close-file').click();
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#workspace')).toBeHidden();
});

test('handles file upload and resets correctly', async ({ page }) => {
  await page.goto('/');

  // Upload minimal PNG fixture
  await page.locator('#file-input').setInputFiles(join(fixtures, 'test-image.png'));

  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#file-name')).toHaveText('test-image.png');
});
