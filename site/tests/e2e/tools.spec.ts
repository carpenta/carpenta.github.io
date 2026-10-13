import { test, expect } from '@playwright/test';
import registry from '../../src/data/tools.json' with { type: 'json' };

test('the korean tools page lists every registered tool', async ({ page }) => {
  await page.goto('/tools/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.getByRole('heading', { level: 2, name: '도구', exact: true })).toBeVisible();
  await expect(page.locator('a[data-tool]')).toHaveCount(registry.length);
  for (const tool of registry) {
    const link = page.locator(`a[data-tool="${tool.slug}"]`);
    await expect(link).toHaveAttribute('href', `/tools/${tool.slug}/`);
    await expect(link).toContainText(tool.title.ko);
    await expect(link).toContainText(tool.description.ko);
  }
});

test('the english tools page uses english copy and the same tool urls', async ({ page }) => {
  await page.goto('/en/tools/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  for (const tool of registry) {
    const link = page.locator(`a[data-tool="${tool.slug}"]`);
    await expect(link).toHaveAttribute('href', `/tools/${tool.slug}/`);
    await expect(link).toContainText(tool.title.en);
  }
});

test('the language switch on the tools page stays on the tools page', async ({ page }) => {
  await page.goto('/tools/');
  await page.getByRole('link', { name: 'EN', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/tools\/$/);
});

test('the sidebar name returns to the home page', async ({ page }) => {
  await page.goto('/en/tools/');
  await page.getByRole('link', { name: 'Cho Il-hwan' }).click();
  await expect(page).toHaveURL(/\/en\/$/);
});

for (const path of ['/tools/', '/en/tools/']) {
  test(`${path} has no horizontal scroll at 360px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
