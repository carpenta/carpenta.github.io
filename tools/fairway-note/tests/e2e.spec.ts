import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  // Hole 3 on 새별 is a par 5; changing it to par 3 takes 2 off the front nine's par 36.
  await expect(page.locator('.par-pick [aria-checked="true"]')).toHaveText('Par 5');
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
  await expect(front.locator('.par-row .sum')).toHaveText('34');
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
  await expect(page.locator('#course-name')).toHaveText('에버리스 새별·레이크');
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

for (const [width, height] of [[375, 553], [390, 664]]) {
  test.describe(`on a short phone screen ${width}×${height}`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('shows the whole hole card between the summary and the hole bar after moving to the next hole', async ({ page }) => {
      await page.goto('/');
      await page.locator('#next-hole').tap();
      await expect(page.locator('#hole-title')).toHaveText('2번 홀');
      const summary = (await page.locator('.summary').boundingBox())!;
      const bar = (await page.locator('.hole-move').boundingBox())!;
      const below = summary.y + summary.height;
      for (const selector of ['#hole-title', '.par-pick']) {
        expect((await page.locator(selector).boundingBox())!.y, selector).toBeGreaterThanOrEqual(below);
      }
      for (const key of ['driver', 'approach', 'putts', 'ob', 'mulligan']) {
        for (const side of ['minus', 'plus']) {
          const box = (await page.locator(`.counter-${key} .${side}`).boundingBox())!;
          expect(box.y, `${key} ${side}`).toBeGreaterThanOrEqual(below);
          expect(box.y + box.height, `${key} ${side}`).toBeLessThanOrEqual(bar.y);
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
      }
      for (const radio of await page.locator('.par-pick button').all()) {
        expect((await radio.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });

    test('keeps the link back to the site visible but away from the top edge', async ({ page }) => {
      await page.goto('/');
      const home = page.locator('a.home-link');
      await expect(home).toBeVisible();
      const box = (await home.boundingBox())!;
      const header = (await page.locator('header.top').boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(16);
      // Sits low in the header, not in the top corner, with small text.
      expect(box.y + box.height / 2).toBeGreaterThan(header.y + header.height / 2 + 4);
      expect(await home.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(12);
    });
  });
}

test('scrolls a hole card to just below the summary, whatever its height', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 553 });
  await page.goto('/');
  const padding = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop));
  const summary = (await page.locator('.summary').boundingBox())!;
  expect(padding).toBeGreaterThanOrEqual(summary.height);
  expect(padding).toBeLessThanOrEqual(summary.height + 8);
});

test('labels are large and dark enough to read in sunlight', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  const checks = await page.evaluate(() => {
    const rgb = (s: string) => s.match(/[\d.]+/g)!.map(Number);
    const lum = (s: string) => {
      const [r, g, b] = rgb(s).slice(0, 3).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const background = (el: Element | null): string => {
      while (el) {
        const bg = getComputedStyle(el).backgroundColor;
        if (rgb(bg)[3] !== 0) return bg;
        el = el.parentElement;
      }
      return 'rgb(255, 255, 255)';
    };
    return ['.stat .label', '.hole-nav .tab-no', '.counter-label span', '.scorecard th[scope="row"]', '.metrics dt'].map((selector) => {
      const el = document.querySelector(selector)!;
      const style = getComputedStyle(el);
      const [a, b] = [lum(style.color), lum(background(el))].sort((x, y) => y - x);
      return { selector, size: parseFloat(style.fontSize), contrast: (a + 0.05) / (b + 0.05) };
    });
  });
  for (const { selector, size, contrast } of checks) {
    expect(size, selector).toBeGreaterThanOrEqual(13);
    expect(contrast, selector).toBeGreaterThanOrEqual(4.5);
  }
});

test('makes a usable minus button clearly stronger than a disabled one', async ({ page }) => {
  await page.goto('/');
  await tap(page, 'driver');
  const look = (selector: string) => page.locator(selector).evaluate((el) => {
    const s = getComputedStyle(el);
    return { opacity: Number(s.opacity), border: parseFloat(s.borderTopWidth), color: s.color };
  });
  const on = await look('.counter-driver .minus');
  const off = await look('.counter-approach .minus');
  expect(on.opacity).toBe(1);
  expect(on.border).toBeGreaterThanOrEqual(2);
  expect(off.opacity).toBeLessThanOrEqual(0.5);
  expect(on.color).not.toBe(off.color);
});

test('keeps the screen on while recording when the browser allows it', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { wakeRequests: string[] };
    w.wakeRequests = [];
    Object.defineProperty(Navigator.prototype, 'wakeLock', {
      configurable: true,
      value: { request: async (type: string) => { w.wakeRequests.push(type); return { released: false, release: async () => {}, addEventListener() {} }; } },
    });
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as unknown as { wakeRequests: string[] }).wakeRequests)).toEqual(['screen']);
});

test('works without errors when screen wake is missing or refused', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await tap(page, 'driver');
  await expect(page.locator('#hole-strokes')).toHaveText('1');

  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'wakeLock', {
      configurable: true,
      value: { request: async () => { throw new DOMException('no', 'NotAllowedError'); } },
    });
  });
  await page.reload();
  await expect(page.locator('#hole-strokes')).toHaveText('1');
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
  expect(url.searchParams.get('subject')).toMatch(/^에버리스 새별·레이크 \d{4}년 \d{1,2}월 \d{1,2}일 라운드 4타 \(E\)$/);
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

test('opens and records offline after the first visit', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.summary')!).position)).toBe('sticky');
  await expect(page.locator('.counter-driver .plus svg')).toBeVisible();
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await expect(count(page, 'driver')).toHaveText('1');
  await expect(page.locator('#hole-strokes')).toHaveText('3');
  await context.setOffline(false);
});

test('precaches every built file under the tool path', async ({ request }) => {
  const source = await (await request.get('sw.js')).text();
  for (const file of ['index.html', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
    expect(source).toContain(`"${file}"`);
  }
  expect(source).toMatch(/"assets\/[^"]+\.js"/);
  expect(source).toMatch(/"assets\/[^"]+\.css"/);
  expect(source).not.toMatch(/"\//);
  expect(source).toMatch(/fairway-note-[0-9a-f]{12}/);
});

test('offers to reopen when a new version is waiting', async ({ page }) => {
  // The next deploy is the same ./sw.js URL with different bytes, as on GitHub Pages. The preview
  // server reads dist/ from disk and the browser cannot be intercepted for its worker fetch, so the
  // built file is changed in place and restored afterwards.
  const swPath = fileURLToPath(new URL('../dist/sw.js', import.meta.url));
  const original = readFileSync(swPath, 'utf8');
  try {
    await page.goto('/');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    const prompt = page.getByRole('button', { name: '새 버전이 있습니다 · 다시 열기' });
    await expect(prompt).toHaveCount(0);
    await tap(page, 'driver');

    writeFileSync(swPath, `${original}\n// next deploy\n`);
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect(prompt).toBeVisible();
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting !== null)).toBe(true);
    // The prompt does not block the page.
    await tap(page, 'putts');
    await expect(page.locator('#hole-strokes')).toHaveText('2');

    const reloaded = page.waitForEvent('load');
    await prompt.click();
    await reloaded;
    await expect(page.locator('#hole-strokes')).toHaveText('2');
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting)).toBeNull();
    await expect(prompt).toHaveCount(0);
  } finally {
    writeFileSync(swPath, original);
  }
});

/* ---------- shot details ---------- */

const tray = (page: Page) => page.locator('#shot-tray');
const chip = (page: Page, name: string) => tray(page).getByRole('button', { name, exact: true });

test('tags the shot just added without slowing the tap', async ({ page }) => {
  await page.goto('/');
  await expect(tray(page)).toBeHidden();
  await tap(page, 'driver');
  // The stroke is recorded by the tap alone; the chips are optional.
  await expect(page.locator('#hole-strokes')).toHaveText('1');
  await expect(tray(page)).toBeVisible();
  await expect(tray(page)).toHaveAttribute('aria-label', '드라이버 1번째 샷 세부');
  await expect(tray(page).getByRole('button')).toHaveText(['페어웨이', '좌', '우', '좌 OB', '우 OB', '헛스윙', '뒤땅/토핑']);

  await chip(page, '좌 OB').click();
  await expect(chip(page, '좌 OB')).toHaveAttribute('aria-pressed', 'true');
  await expect(count(page, 'ob')).toHaveText('1');
  await expect(page.locator('#hole-strokes')).toHaveText('2');
  // Changing OB side never counts the OB twice; tapping the chosen chip again clears it and its OB.
  await chip(page, '우 OB').click();
  await expect(count(page, 'ob')).toHaveText('1');
  await chip(page, '우 OB').click();
  await expect(count(page, 'ob')).toHaveText('0');
  await expect(chip(page, '우 OB')).toHaveAttribute('aria-pressed', 'false');
  await chip(page, '우').click();

  await tap(page, 'approach');
  await expect(tray(page)).toHaveAttribute('aria-label', '어프로치 1번째 샷 세부');
  await expect(tray(page).getByRole('button')).toHaveText(['온그린', '짧음', '김', '좌', '우', '벙커', '해저드', '헛스윙']);
  await chip(page, '벙커').click();
  // Minus removes the last stroke with its tag, and closes the chips.
  await page.getByRole('button', { name: '어프로치 하나 빼기' }).click();
  await expect(tray(page)).toBeHidden();
  await tap(page, 'putts');
  await expect(tray(page).getByRole('button')).toHaveText(['들어감', '짧음', '김', '좌', '우']);
  await chip(page, '들어감').click();
  await page.locator('#next-hole').click();
  await expect(tray(page)).toBeHidden();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).holes[0], STORAGE_KEY);
  expect(saved).toEqual({ par: 4, driver: 1, approach: 0, putts: 1, ob: 0, mulligan: 0, tags: { driver: ['right'], putts: ['in'] } });
});

test('closes the chips after a few seconds, or when another counter is tapped', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await tap(page, 'driver');
  await expect(tray(page)).toBeVisible();
  await page.clock.fastForward(3000);
  await chip(page, '페어웨이').click();
  // A chip tap keeps them open a little longer.
  await page.clock.fastForward(3000);
  await expect(tray(page)).toBeVisible();
  await page.clock.fastForward(4000);
  await expect(tray(page)).toBeHidden();
  await expect(page.locator('#hole-strokes')).toBeVisible();

  await tap(page, 'putts');
  await expect(tray(page)).toBeVisible();
  await tap(page, 'ob');
  await expect(tray(page)).toBeHidden();
  await tap(page, 'mulligan');
  await expect(tray(page)).toBeHidden();
});

test('revisits earlier shots by tapping the count', async ({ page }) => {
  await page.goto('/');
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await chip(page, '들어감').click();
  await tap(page, 'ob');
  await expect(tray(page)).toBeHidden();

  const putts = page.getByRole('button', { name: '퍼터 샷 세부 보기' });
  await putts.click();
  await expect(tray(page)).toHaveAttribute('aria-label', '퍼터 2번째 샷 세부');
  await expect(chip(page, '들어감')).toHaveAttribute('aria-pressed', 'true');
  await putts.click();
  await expect(tray(page)).toHaveAttribute('aria-label', '퍼터 1번째 샷 세부');
  await expect(chip(page, '들어감')).toHaveAttribute('aria-pressed', 'false');
  await chip(page, '짧음').click();
  await expect(page.locator('.counter-putts .count-btn')).toHaveClass(/has-tags/);
  await expect(page.locator('.counter-driver .count-btn')).not.toHaveClass(/has-tags/);
  await expect(page.getByRole('button', { name: '어프로치 샷 세부 보기' })).toBeDisabled();

  await page.locator('#next-hole').click();
  const analysis = page.locator('#analysis');
  await expect(analysis.locator('.details')).toContainText('퍼트: 들어감 1 · 짧음 1');
  const body = new URL(await page.locator('#send-email').getAttribute('href') as string).searchParams.get('body')!;
  expect(body).toContain('[샷 세부]');
  expect(body).toContain('1번 Par4: 4타 (E) 드1 어0 퍼2 OB 1 · 퍼 짧음, 들어감');
});

test('shows no detail section for a round without tags', async ({ page }) => {
  await page.goto('/');
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await page.locator('#next-hole').click();
  await expect(page.locator('#analysis .headline')).toBeVisible();
  await expect(page.locator('#analysis .details')).toHaveCount(0);
});

test('loads a round with unreadable tags, keeping its scores and the original value', async ({ page }) => {
  await page.goto('/');
  const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 }));
  holes[0] = { ...holes[0], driver: 1, putts: 2, tags: { driver: ['slice'], putts: [null, 'in'] } } as typeof holes[0];
  const value = JSON.stringify({ version: 1, date: '2026-11-19', current: 1, holes, lastEdited: Date.now() });
  await page.evaluate(([key, v]) => localStorage.setItem(key, v), [STORAGE_KEY, value]);
  await page.reload();
  await expect(page.locator('#sum-strokes')).toHaveText('3');
  await expect(page.locator('#save-state')).toContainText('세부 기록 일부');
  await tap(page, 'driver');
  const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  expect(Object.entries(stored).filter(([k]) => k.startsWith('fairway-note:corrupt:')).map(([, v]) => v)).toEqual([value]);
  expect(JSON.parse(stored[STORAGE_KEY]).holes[0].tags).toEqual({ putts: [null, 'in'] });
});

for (const [width, height] of [[375, 553], [320, 568]]) {
  test.describe(`shot chips on a ${width}×${height} phone`, () => {
  test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('show without moving any button or covering the hole bar', async ({ page }) => {
    await page.goto('/');
    await page.locator('#next-hole').click();
    const boxes = async () => {
      const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
      for (const key of ['driver', 'approach', 'putts', 'ob', 'mulligan']) {
        for (const side of ['minus', 'plus']) out[`${key} ${side}`] = (await page.locator(`.counter-${key} .${side}`).boundingBox())!;
      }
      return out;
    };
    for (const key of ['driver', 'approach', 'putts']) {
      await tap(page, key);
      await expect(tray(page)).toBeVisible();
      const open = await boxes();
      // Tapping the tray around the chips closes it. Nothing moves either way, so the next tap lands where it aims.
      await tray(page).dispatchEvent('click');
      await expect(tray(page)).toBeHidden();
      const before = await boxes();
      expect(open).toEqual(before);
      await page.getByRole('button', { name: `${{ driver: '드라이버', approach: '어프로치', putts: '퍼터' }[key]} 샷 세부 보기` }).click();
      await expect(tray(page)).toBeVisible();
      const bar = (await page.locator('.hole-move').boundingBox())!;
      for (const box of Object.values(before)) expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
      const summary = (await page.locator('.summary').boundingBox())!;
      const trayBox = (await tray(page).boundingBox())!;
      expect(trayBox.y).toBeGreaterThanOrEqual(summary.y + summary.height);
      expect(trayBox.x + trayBox.width).toBeLessThanOrEqual(width);
      for (const c of await tray(page).getByRole('button').all()) expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(40);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    }
  });
  });
}
