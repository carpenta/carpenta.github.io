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

test('every featured project shows a design diagram', async ({ page }) => {
  for (const path of ['/', '/en/']) {
    await page.goto(path);
    const diagrams = page.locator('#projects figure.diagram');
    await expect(diagrams).toHaveCount(3);
    for (const d of await diagrams.all()) {
      await expect(d.locator('figcaption')).not.toBeEmpty();
      expect(await d.locator('.dia-node').count()).toBeGreaterThan(3);
    }
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
  await page.getByRole('link', { name: 'English', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/$/);
  await page.getByRole('link', { name: '한국어', exact: true }).click();
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
  const lang = page.getByRole('link', { name: 'English', exact: true });
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
  const link = page.getByRole('navigation', { name: '언어' }).getByRole('link', { name: 'English' });
  await expect(link).toHaveAttribute('href', '/en/');
  await expect(link).toHaveAttribute('hreflang', 'en');
  await expect(link.locator('svg')).toBeVisible();
});

const bg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

test('the theme follows the system setting on first visit', async ({ browser }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ colorScheme });
    const page = await context.newPage();
    await page.goto('/');
    expect(await bg(page)).toBe(colorScheme === 'light' ? 'rgb(247, 248, 250)' : 'rgb(13, 19, 32)');
    await context.close();
  }
});

test('the theme toggle switches and remembers the theme', async ({ browser }) => {
  for (const path of ['/', '/en/']) {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto(path);
    const toggle = page.locator('button.theme-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle.locator('svg:visible')).toHaveCount(1);
    const darkLabel = await toggle.getAttribute('aria-label');
    expect(darkLabel).toBeTruthy();
    const darkIcon = await toggle.locator('svg:visible').getAttribute('class');
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await bg(page)).toBe('rgb(247, 248, 250)');
    expect(await toggle.getAttribute('aria-label')).not.toBe(darkLabel);
    expect(await toggle.locator('svg:visible').getAttribute('class')).not.toBe(darkIcon);
    await page.reload();
    expect(await bg(page)).toBe('rgb(247, 248, 250)');
    await page.locator('button.theme-toggle').click();
    expect(await bg(page)).toBe('rgb(13, 19, 32)');
    await context.close();
  }
});

test('the theme toggle stays visible at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await expect(page.locator('button.theme-toggle')).toBeVisible();
});

test('each employer shows its logo before the name, enSalt keeps an empty slot', async ({ page }) => {
  await page.goto('/');
  const jobs = page.locator('#experience > ol > li');
  await expect(jobs).toHaveCount(5);
  for (let i = 0; i < 4; i++) {
    const img = jobs.nth(i).locator('h3 img.company-logo');
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute('alt', '');
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  const last = jobs.nth(4).locator('h3');
  await expect(last.locator('img')).toHaveCount(0);
  await expect(last.locator('.company-logo')).toHaveCount(1);
});
