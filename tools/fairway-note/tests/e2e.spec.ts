import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'fairway-note:round:v1';

async function tap(page: Page, key: string, times = 1) {
  const label = { driver: '드라이버', approach: '어프로치', putts: '퍼터', ob: 'OB', mulligan: '멀리건' }[key]!;
  for (let i = 0; i < times; i++) await page.getByRole('button', { name: `${label} 하나 더하기` }).click();
}

const count = (page: Page, key: string) => page.locator(`.counter-${key} output`);

test('records holes by tapping and totals them without network or other storage', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || request.method() !== 'GET' || request.postData()) requests.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  await expect(page.locator('.par-pick [aria-checked="true"]')).toHaveText('Par 4');

  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await expect(page.locator('#hole-strokes')).toHaveText('4');
  await expect(page.locator('#hole-name')).toHaveText('파');

  await page.locator('#next-hole').click();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
  await tap(page, 'driver', 2);
  await tap(page, 'ob');
  await tap(page, 'mulligan');
  await tap(page, 'approach');
  await tap(page, 'putts', 3);
  await expect(page.locator('#hole-strokes')).toHaveText('7');
  await expect(page.locator('#hole-topar')).toHaveText('+3');

  await page.getByRole('button', { name: '퍼터 하나 빼기' }).click();
  await expect(count(page, 'putts')).toHaveText('2');
  await expect(page.locator('#hole-strokes')).toHaveText('6');

  await page.locator('#next-hole').click();
  await page.getByRole('radio', { name: 'Par 3' }).click();
  await tap(page, 'driver');
  await tap(page, 'putts');
  await expect(page.locator('#hole-name')).toHaveText('버디');

  await expect(page.locator('#sum-strokes')).toHaveText('12');
  await expect(page.locator('#sum-topar')).toHaveText('+1');
  await expect(page.locator('#sum-holes')).toHaveText('3/18');
  await expect(page.locator('#sum-putts')).toHaveText('5');
  await expect(page.locator('#sum-ob')).toHaveText('1');
  await expect(page.locator('#sum-mulligan')).toHaveText('1');
  await expect(page.locator('#hole-tabs li').nth(1)).toHaveText('26');

  const front = page.locator('.scorecard').first();
  await expect(front.locator('.par-row .sum')).toHaveText('35');
  await expect(front.locator('.strokes-row .sum')).toHaveText('12');

  expect(requests).toEqual([]);
  expect(await page.evaluate(() => ({
    keys: Object.keys(localStorage),
    sessionStorage: sessionStorage.length,
    cookies: document.cookie,
  }))).toEqual({ keys: [STORAGE_KEY], sessionStorage: 0, cookies: '' });
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
});

test('shows the round analysis', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#analysis')).toContainText('홀을 기록하면');
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 3);
  await page.locator('#next-hole').click();
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);

  const analysis = page.locator('#analysis');
  await expect(analysis.locator('.headline')).toContainText('2홀 9타 +1');
  await expect(analysis).toContainText('3퍼트 이상1홀');
  await expect(analysis).toContainText('그린 적중2/2 (100%)');
  await expect(analysis).toContainText('가장 많이 잃은 곳은 퍼트입니다 (+1타)');
  await expect(analysis).toContainText('가장 잘한 홀 2번 (E) · 가장 아쉬운 홀 1번 (+1)');
  await expect(analysis.locator('.metrics.three')).toContainText('Par 44.5타 (2홀)');
});

test('keeps the round after reload and starts a new one on request', async ({ page }) => {
  await page.goto('/');
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await page.locator('#hole-tabs button').nth(4).click();
  await expect(page.locator('#hole-title')).toHaveText('5번 홀');
  await page.reload();
  await expect(page.locator('#hole-title')).toHaveText('5번 홀');
  await expect(page.locator('#sum-strokes')).toHaveText('3');

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#new-round').click();
  await expect(page.locator('#sum-strokes')).toHaveText('3');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#new-round').click();
  await expect(page.locator('#sum-strokes')).toHaveText('0');
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
});

test('ignores a broken saved round', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.setItem(key, '{"version":1,"holes":"x"}'), STORAGE_KEY);
  await page.reload();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  await expect(page.locator('#sum-strokes')).toHaveText('0');
});

test('jumps to a hole from the scorecard and stops at the ends', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#prev-hole')).toBeDisabled();
  await page.getByRole('button', { name: '18번 홀로 가기' }).click();
  await expect(page.locator('#hole-title')).toHaveText('18번 홀');
  await expect(page.locator('#next-hole')).toBeDisabled();
  await expect(page.getByRole('button', { name: '드라이버 하나 빼기' })).toBeDisabled();
});

test('links back to the site and fits a 360px screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const home = page.locator('a.home-link');
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute('href', '../../');
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await expect(page.locator('#analysis .headline')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});
