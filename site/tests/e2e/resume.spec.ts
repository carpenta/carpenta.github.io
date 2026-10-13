import { test, expect } from '@playwright/test';

const SECTIONS = ['Introduction', 'Skills', 'Work Experience', 'Education', 'Certificates', 'Project Highlights'];

test('the korean résumé follows the reference structure in order', async ({ page }) => {
  await page.goto('/resume/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('조일환');
  await expect(page.locator('main h2')).toHaveText(SECTIONS);
  await expect(page.locator('.highlight')).toHaveCount(3);
  for (const label of ['배경 및 해결 과제', '기술적 의사결정', '결과']) {
    await expect(page.locator('.highlight').first().getByText(label, { exact: true })).toBeVisible();
  }
});

test('the english résumé is fully translated', async ({ page }) => {
  await page.goto('/en/resume/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cho Il-hwan');
  await expect(page.locator('main h2')).toHaveText(SECTIONS);
  await expect(page.locator('main')).not.toContainText(/[가-힣]/);
});

test('the résumé header carries email and github and no phone', async ({ page }) => {
  await page.goto('/resume/');
  const header = page.locator('.resume-header');
  await expect(header).not.toContainText('Phone');
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(header.getByRole('link', { name: 'carpenta.dev@gmail.com' })).toHaveAttribute('href', 'mailto:carpenta.dev@gmail.com');
  await expect(header.getByRole('link', { name: 'GitHub', exact: true })).toHaveAttribute('href', 'https://github.com/carpenta');
});

test('screen-only controls are hidden when printing', async ({ page }) => {
  await page.goto('/resume/');
  await expect(page.locator('.resume-bar')).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.resume-bar')).toBeHidden();
});

test('the résumé renders korean text in the self-hosted font', async ({ page }) => {
  await page.goto('/resume/');
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Pretendard Variable' && f.status === 'loaded');
  });
  expect(loaded).toBe(true);
});

test('both pdf files are downloadable', async ({ request }) => {
  for (const path of [encodeURI('/resume/조일환_이력서.pdf'), '/resume/Cho_Il-hwan_Resume.pdf']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type']).toContain('pdf');
  }
});

for (const path of ['/resume/', '/en/resume/']) {
  test(`${path} has no horizontal scroll at 360px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

for (const path of ['/resume/', '/en/resume/']) {
  test(`${path} is noindex with no canonical, alternate or og:url`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"]')).toHaveCount(0);
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /\S/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /\S/);
  });
}

test('the résumé bar switches between the korean and english résumé', async ({ page }) => {
  await page.goto('/resume/');
  const ko = page.locator('.resume-bar').getByRole('navigation', { name: '언어' });
  await expect(ko.getByRole('link', { name: 'KO' })).toHaveAttribute('aria-current', 'true');
  await ko.getByRole('link', { name: 'EN' }).click();
  await expect(page).toHaveURL(/\/en\/resume\/$/);
  const en = page.locator('.resume-bar').getByRole('navigation', { name: 'Language' });
  await expect(en.getByRole('link', { name: 'EN' })).toHaveAttribute('aria-current', 'true');
  await en.getByRole('link', { name: 'KO' }).click();
  await expect(page).toHaveURL(/\/resume\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
});
