import { test, expect } from '@playwright/test';

test('korean home is served at the root', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('조일환');
});

test('english home is served under /en/', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cho Il-hwan');
});

test('each page points at its translation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', 'https://carpenta.github.io/en/');
  await page.goto('/en/');
  await expect(page.locator('link[rel="alternate"][hreflang="ko"]')).toHaveAttribute('href', 'https://carpenta.github.io/');
});

test('the self-hosted font loads', async ({ page }) => {
  await page.goto('/');
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some(
      (f) => f.family.replace(/["']/g, '') === 'Pretendard Variable' && f.status === 'loaded',
    );
  });
  expect(loaded).toBe(true);
});

test('korean home shows every employer and the section headings', async ({ page }) => {
  await page.goto('/');
  for (const name of ['호랑이얼굴', 'SK텔레콤', '카카오페이', '카카오', '(주)enSalt']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  for (const name of ['경력', '기술', '프로젝트', '도구']) {
    await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
  }
  await expect(page.getByText('Developer', { exact: true }).first()).toBeVisible();
});

test('home has no education or certificates section', async ({ page }) => {
  for (const path of ['/', '/en/']) {
    await page.goto(path);
    await expect(page.locator('#education')).toHaveCount(0);
    await expect(page.locator('a[href="#education"]')).toHaveCount(0);
  }
});

test('english home shows translated content', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.getByRole('heading', { name: 'SK Telecom', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Experience', exact: true })).toBeVisible();
  await expect(page.getByText('호랑이얼굴')).toHaveCount(0);
});

test('the language switch goes to the matching page and back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'EN', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/$/);
  await page.getByRole('link', { name: 'KO', exact: true }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:4321\/$/);
});

test('contact details from the résumé are present', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'carpenta.dev@gmail.com' })).toHaveAttribute('href', 'mailto:carpenta.dev@gmail.com');
  await expect(page.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/carpenta');
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
});

test('the public pages link nowhere near the résumé', async ({ page }) => {
  for (const path of ['/', '/en/', '/tools/', '/en/tools/']) {
    await page.goto(path);
    await expect(page.locator('a[href*="resume" i]'), path).toHaveCount(0);
  }
});

test('the tools preview links to the tool and to the full list', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.getByRole('link', { name: /Folio/ })).toHaveAttribute('href', '/tools/folio/');
  await expect(page.getByRole('link', { name: 'All tools' })).toHaveAttribute('href', '/en/tools/');
});

for (const path of ['/', '/en/']) {
  test(`${path} has no horizontal scroll at 360px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('the 404 page sends visitors to the home page and the tools', async ({ page }) => {
  await page.goto('/404.html');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('페이지를 찾을 수 없습니다');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Page not found');
  await expect(page.getByRole('link', { name: '홈' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: '도구' })).toHaveAttribute('href', '/tools/');
});

test('sidebar contact links stay reachable in a short desktop window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.goto('/');
  const lang = page.getByRole('link', { name: 'EN', exact: true });
  await lang.scrollIntoViewIfNeeded();
  await expect(lang).toBeInViewport();
});

test('the 404 page is noindex and does not claim to be the home page', async ({ page }) => {
  await page.goto('/404.html');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('link[rel="alternate"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  await page.goto('/');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://carpenta.github.io/');
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test('the language switch is a labelled navigation landmark', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: '언어' }).getByRole('link', { name: 'EN' })).toHaveAttribute('href', '/en/');
});
