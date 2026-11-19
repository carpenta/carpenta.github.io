import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'fairway-note:round:v1';

async function tap(page: Page, key: string, times = 1) {
  const label = { driver: '드라이버', approach: '어프로치', putts: '퍼터', ob: 'OB', mulligan: '멀리건' }[key]!;
  for (let i = 0; i < times; i++) await page.getByRole('button', { name: `${label} 하나 더하기` }).click();
}

const count = (page: Page, key: string) => page.locator(`.counter-${key} output`);

// Any console error or uncaught exception (CSP violations are reported as console errors) fails the test.
test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  (testInfo as unknown as { pageErrors: string[] }).pageErrors = errors;
});

test.afterEach(async ({}, testInfo) => {
  expect((testInfo as unknown as { pageErrors: string[] }).pageErrors).toEqual([]);
});

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

test('keeps an unreadable or newer saved value instead of overwriting it', async ({ page }) => {
  await page.goto('/');
  const future = JSON.stringify({ version: 2, note: 'saved by a newer version' });
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, future]);
  await page.reload();
  await expect(page.locator('#sum-strokes')).toHaveText('0');
  await expect(page.locator('#save-state')).toContainText('따로 보관');
  // Opening the page alone writes nothing over the stored value.
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(future);
  await page.reload();
  await tap(page, 'driver');
  const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  const copies = Object.entries(stored).filter(([k]) => k.startsWith('fairway-note:corrupt:'));
  expect(copies.map(([, v]) => v)).toEqual([future]);
  expect(JSON.parse(stored[STORAGE_KEY]).holes[0].driver).toBe(1);
});

test('does not save an empty round just by opening the page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await tap(page, 'putts');
  expect(await page.evaluate((key) => localStorage.getItem(key) !== null, STORAGE_KEY)).toBe(true);
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
  await expect(page).toHaveTitle('Fairway Note');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fairway Note');
  await expect(page.locator('#course-name')).toHaveText('에버리스 동코스');
  const home = page.locator('a.home-link');
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute('href', '../../');
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await expect(page.locator('#analysis .headline')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test('keeps a hole in progress out of the score until it is putted', async ({ page }) => {
  await page.goto('/');
  await tap(page, 'driver');
  await expect(page.locator('#hole-strokes')).toHaveText('1');
  await expect(page.locator('#hole-name')).toContainText('진행 중');
  await expect(page.locator('#hole-topar')).toHaveText('');
  await expect(page.locator('#sum-strokes')).toHaveText('0');
  await expect(page.locator('#sum-holes')).toHaveText('0/18');
  await expect(page.locator('#hole-tabs button').first()).toHaveClass(/in-progress/);
  await expect(page.locator('#analysis')).toContainText('홀을 기록하면');

  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await expect(page.locator('#hole-name')).toHaveText('파');
  await expect(page.locator('#sum-strokes')).toHaveText('4');
});

test('counts a chip-in once the player moves to the next hole', async ({ page }) => {
  await page.goto('/');
  await tap(page, 'driver');
  await tap(page, 'approach', 2);
  await expect(page.locator('#sum-strokes')).toHaveText('0');
  await page.locator('#next-hole').click();
  await expect(page.locator('#sum-strokes')).toHaveText('3');
  await expect(page.locator('#sum-topar')).toHaveText('-1');
});

test('a mulligan alone does not start a hole', async ({ page }) => {
  await page.goto('/');
  await tap(page, 'mulligan');
  await expect(page.locator('#sum-mulligan')).toHaveText('1');
  await expect(page.locator('#hole-tabs .tab-score').first()).toHaveText('·');
  await expect(page.locator('#hole-name')).toHaveText('아직 기록 없음');
  await expect(page.locator('#analysis')).toContainText('홀을 기록하면');
});

test('stops counting at 15', async ({ page }) => {
  await page.goto('/');
  await tap(page, 'approach', 15);
  await expect(count(page, 'approach')).toHaveText('15');
  await expect(page.getByRole('button', { name: '어프로치 하나 더하기' })).toBeDisabled();
});

test('keeps the hole title visible below the summary after jumping from the scorecard', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await page.getByRole('button', { name: '12번 홀로 가기' }).click();
  await expect(page.locator('#hole-title')).toHaveText('12번 홀');
  const summary = await page.locator('.summary').boundingBox();
  const title = await page.locator('#hole-title').boundingBox();
  const par = await page.locator('.par-pick').boundingBox();
  expect(title!.y).toBeGreaterThanOrEqual(summary!.y + summary!.height);
  expect(par!.y).toBeGreaterThanOrEqual(summary!.y + summary!.height);
});

test('moves the par selection with arrow keys', async ({ page }) => {
  await page.goto('/');
  const radios = page.locator('.par-pick button');
  await expect(radios.nth(1)).toHaveAttribute('tabindex', '0');
  await expect(radios.nth(0)).toHaveAttribute('tabindex', '-1');
  await radios.nth(1).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Par 5' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Par 5' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Par 3' })).toBeFocused();
  await expect(page.locator('.scorecard .par-row td').first()).toHaveText('3');
});

test('announces taps in one live region', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[aria-live]')).toHaveCount(1);
  await tap(page, 'putts');
  await expect(page.locator('#announce')).toHaveText('1번 홀 퍼터 1, 1타');
  await page.locator('#next-hole').click();
  await expect(page.locator('#announce')).toHaveText('2번 홀, Par 4');
});

test('says so when the round cannot be saved', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('denied', 'SecurityError'); };
  });
  await page.goto('/');
  await tap(page, 'driver');
  await expect(page.locator('#save-state')).toContainText('저장할 수 없습니다');
  await expect(page.locator('#hole-strokes')).toHaveText('1');
});

test('offers to continue or replace a round from an earlier day', async ({ page }) => {
  await page.goto('/');
  const old = await page.evaluate((key) => {
    const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 }));
    holes[0] = { par: 4, driver: 1, approach: 1, putts: 2, ob: 0, mulligan: 0 };
    const value = JSON.stringify({ version: 1, date: '2026-01-01', current: 1, holes });
    localStorage.setItem(key, value);
    return value;
  }, STORAGE_KEY);
  expect(old).toContain('2026-01-01');
  await page.reload();
  await expect(page.locator('#stale')).toBeVisible();
  await expect(page.locator('#stale-text')).toContainText('2026년 1월 1일');
  await page.locator('#stale-keep').click();
  await expect(page.locator('#stale')).toBeHidden();
  await expect(page.locator('#sum-strokes')).toHaveText('4');

  // Choosing to continue keeps the banner away on the next load.
  await page.reload();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
  await expect(page.locator('#stale')).toBeHidden();
  await expect(page.locator('#sum-strokes')).toHaveText('4');
});

test('asks before the earlier-day banner replaces a round', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => {
    const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 }));
    holes[0] = { par: 4, driver: 1, approach: 1, putts: 2, ob: 0, mulligan: 0 };
    localStorage.setItem(key, JSON.stringify({ version: 1, date: '2026-01-01', current: 1, holes }));
  }, STORAGE_KEY);
  await page.reload();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#stale-new').click();
  await expect(page.locator('#sum-strokes')).toHaveText('4');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#stale-new').click();
  await expect(page.locator('#stale')).toBeHidden();
  await expect(page.locator('#sum-strokes')).toHaveText('0');
  await page.reload();
  await expect(page.locator('#stale')).toBeHidden();
});

test('keeps a round that crosses midnight without the earlier-day banner', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 19, 23, 40) });
  await page.goto('/');
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await page.locator('#next-hole').click();
  await page.clock.setSystemTime(new Date(2026, 10, 20, 0, 20));
  await page.reload();
  await expect(page.locator('#stale')).toBeHidden();
  await expect(page.locator('#sum-strokes')).toHaveText('4');
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');

  // Half a day later the round is offered again, and one tap does not wipe it.
  await page.clock.setSystemTime(new Date(2026, 10, 20, 12, 30));
  await page.reload();
  await expect(page.locator('#stale')).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#stale-new').click();
  await expect(page.locator('#sum-strokes')).toHaveText('4');
});

test('follows a round saved in another tab', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('/');
  await second.goto('/');
  await tap(first, 'driver');
  await tap(first, 'putts', 2);
  await expect(second.locator('#sum-strokes')).toHaveText('3');
});

test('keeps its round when another tab removes the saved one', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('/');
  await tap(first, 'driver');
  await tap(first, 'putts', 2);
  await second.goto('/');
  await expect(second.locator('#sum-strokes')).toHaveText('3');
  await first.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await expect(second.locator('#save-state')).toContainText('다음 입력 때 다시 저장');
  await expect(second.locator('#sum-strokes')).toHaveText('3');
  await second.locator('#next-hole').click();
  const stored = await second.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
  expect(stored.holes[0]).toMatchObject({ driver: 1, putts: 2 });
  await expect(second.locator('#save-state')).toContainText('자동 저장');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 600 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('records a hole by touch with every counter and the hole bar on one screen', async ({ page }) => {
    await page.goto('/');
    // Moving to a hole places its card under the summary; do the same for the first hole.
    await page.locator('#hole-tabs button').nth(1).tap();
    await page.locator('#prev-hole').tap();
    await expect(page.locator('#hole-title')).toHaveText('1번 홀');
    const summary = (await page.locator('.summary').boundingBox())!;
    const bar = (await page.locator('.hole-move').boundingBox())!;
    expect(bar.y + bar.height).toBeCloseTo(600, 0);
    for (const key of ['driver', 'approach', 'putts', 'ob', 'mulligan']) {
      const plus = (await page.locator(`.counter-${key} .plus`).boundingBox())!;
      expect(plus.y).toBeGreaterThanOrEqual(summary.y + summary.height);
      expect(plus.y + plus.height / 2).toBeLessThan(bar.y);
      expect(plus.height).toBeGreaterThanOrEqual(48);
      expect(plus.width).toBeGreaterThanOrEqual(48);
    }
    await page.locator('.counter-driver .plus').tap();
    await page.locator('.counter-approach .plus').tap();
    await page.locator('.counter-putts .plus').tap();
    await page.locator('.counter-putts .plus').tap();
    await expect(page.locator('#hole-strokes')).toHaveText('4');
    await page.locator('#next-hole').tap();
    await expect(page.locator('#hole-title')).toHaveText('2번 홀');
    await expect(page.locator('#sum-strokes')).toHaveText('4');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test('keeps the end of the page clear of the hole bar', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bar = (await page.locator('.hole-move').boundingBox())!;
    const button = (await page.locator('#new-round').boundingBox())!;
    expect(button.y + button.height).toBeLessThanOrEqual(bar.y);
  });

  test('fits a 320px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await page.locator('.counter-ob .plus').tap();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});

test('can be added to the home screen', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('./manifest.webmanifest');
  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({ name: 'Fairway Note', short_name: 'Fairway Note', start_url: './', scope: './', display: 'standalone' });
  for (const icon of [...manifest.icons.map((i: { src: string }) => i.src), 'apple-touch-icon.png']) {
    const response = await request.get(icon);
    expect(response.status(), icon).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
  }
});

test('shows a club icon on each + button', async ({ page }) => {
  await page.goto('/');
  for (const key of ['driver', 'approach', 'putts', 'ob', 'mulligan']) {
    const plus = page.locator(`.counter-${key} .plus`);
    await expect(plus.locator('svg')).toBeVisible();
    await expect(plus.locator('.plus-mark')).toHaveText('+');
  }
});

test('sends the round by email through the mail app', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#send-actions')).toBeHidden();
  await expect(page.locator('#send-note')).toContainText('홀을 끝내면');
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  const email = page.getByRole('link', { name: '이메일로 보내기' });
  await expect(email).toBeVisible();
  const href = (await email.getAttribute('href'))!;
  const url = new URL(href);
  expect(url.protocol).toBe('mailto:');
  expect(url.pathname).toBe('');
  expect(url.searchParams.get('subject')).toMatch(/^에버리스 동코스 \d{4}년 \d{1,2}월 \d{1,2}일 라운드 4타 \(E\)$/);
  expect(url.searchParams.get('body')).toContain('1번 Par4: 4타 (E) 드1 어1 퍼2');
});

test('shares the round with the phone share sheet', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    navigator.share = async (data) => { (window as unknown as { shared: unknown[] }).shared.push(data); };
  });
  await page.goto('/');
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await page.getByRole('button', { name: '공유하기' }).click();
  const shared = await page.evaluate(() => (window as unknown as { shared: { title: string; text: string }[] }).shared);
  expect(shared).toHaveLength(1);
  expect(shared[0].title).toContain('3타 (-1)');
  expect(shared[0].text).toContain('1번 Par4: 3타 (-1) 드1 어0 퍼2');
});

test('copies the round when the browser cannot share', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
  });
  await page.goto('/');
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await page.getByRole('button', { name: '결과 복사' }).click();
  await expect(page.locator('#send-status')).toContainText('복사했습니다');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('1번 Par4: 3타 (-1)');
});
