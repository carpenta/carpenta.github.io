import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'fairway-note:round:v1';
const PREFS_KEY = 'fairway-note:prefs:v1';
const LABEL: Record<string, string> = { driver: '드라이버', approach: '어프로치', putts: '퍼터', ob: 'OB', hazard: '해저드' };

/** Opens the tool with nothing saved and accepts the course the picker offers (Everis 새별·레이크 by default). */
async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await expect(page.locator('#picker')).toBeHidden();
}

/** One tap per stroke on a club's + or on a penalty stake. */
async function tap(page: Page, key: string, times = 1) {
  for (let i = 0; i < times; i++) await page.getByRole('button', { name: `${LABEL[key]} 하나 더하기` }).click();
}

/** Mulligans live behind 더보기. */
async function mulligan(page: Page, times = 1) {
  await page.getByRole('button', { name: '더보기' }).click();
  for (let i = 0; i < times; i++) await page.locator('#more').getByRole('button', { name: '멀리건 하나 더하기' }).click();
  await page.locator('#more').getByRole('button', { name: '닫기' }).click();
  await expect(page.locator('#more')).toBeHidden();
}

const count = (page: Page, key: string) => page.locator(`.club-${key} .count`);
const tab = (page: Page, name: '기록' | '스코어카드') => page.getByRole('tab', { name });
const next = (page: Page) => page.locator('#go-next');

async function showCard(page: Page) {
  await tab(page, '스코어카드').click();
  await expect(page.locator('#card-view')).toBeVisible();
}

async function showEntry(page: Page) {
  await tab(page, '기록').click();
  await expect(page.locator('#entry')).toBeVisible();
}

const sideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);

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

test('counts each club with one tap and totals the round without network or other storage', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || request.method() !== 'GET' || request.postData()) requests.push(request.url());
  });
  await open(page);
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  await expect(page.locator('#hole-par')).toHaveText('Par 4');

  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await expect(count(page, 'driver')).toHaveText('1');
  await expect(count(page, 'approach')).toHaveText('1');
  await expect(count(page, 'putts')).toHaveText('2');
  await expect(page.locator('#hole-strokes')).toHaveText('4');
  await expect(page.locator('#hole-name')).toHaveText('파');

  await next(page).click();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
  await tap(page, 'driver', 2);
  await tap(page, 'ob');
  await tap(page, 'approach');
  await tap(page, 'putts', 3);
  await mulligan(page);
  await expect(page.locator('#hole-strokes')).toHaveText('7');
  await page.getByRole('button', { name: '퍼터 하나 빼기' }).click();
  await expect(count(page, 'putts')).toHaveText('2');
  await expect(page.locator('#hole-strokes')).toHaveText('6');
  await expect(page.locator('#hole-name')).toHaveText('더블 보기');

  await next(page).click();
  // Hole 3 on 새별 is a par 5.
  await expect(page.locator('#hole-par')).toHaveText('Par 5');
  await tap(page, 'driver');
  await tap(page, 'approach', 2);
  await tap(page, 'putts');
  await expect(page.locator('#hole-name')).toHaveText('버디');
  await expect(page.locator('#hole-run')).toContainText('+1');

  await showCard(page);
  await expect(page.locator('#sum-strokes')).toHaveText('14');
  await expect(page.locator('#sum-topar')).toHaveText('+1');
  await expect(page.locator('#sum-holes')).toHaveText('3/18');
  await expect(page.locator('#sum-putts')).toHaveText('5');
  await expect(page.locator('#sum-penalty')).toHaveText('1');
  await expect(page.locator('#sum-mulligan')).toHaveText('1');
  const front = page.locator('.scorecard').first();
  await expect(front.locator('.par-row .sum')).toHaveText('36');
  await expect(front.locator('.strokes-row .sum')).toHaveText('14');

  expect(requests).toEqual([]);
  expect(await page.evaluate(() => ({
    keys: Object.keys(localStorage).sort(),
    sessionStorage: sessionStorage.length,
    cookies: document.cookie,
  }))).toEqual({ keys: [PREFS_KEY, STORAGE_KEY].sort(), sessionStorage: 0, cookies: '' });
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
});

test('shows the hole score with its scorecard mark, in red under par', async ({ page }) => {
  await open(page);
  const score = page.locator('#hole-strokes');
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await expect(score).toHaveClass(/mark-par/);
  await tap(page, 'approach');
  await expect(score).toHaveText('5');
  await expect(score).toHaveClass(/mark-bogey/);
  await tap(page, 'approach');
  await expect(score).toHaveClass(/mark-double/);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '어프로치 하나 빼기' }).click();
  await expect(score).toHaveText('3');
  await expect(score).toHaveClass(/mark-birdie/);
  const red = 'rgb(192, 57, 43)';
  expect(await score.evaluate((el) => getComputedStyle(el).color)).toBe(red);
  expect(await score.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).not.toBe('0px');
  await page.getByRole('button', { name: '퍼터 하나 빼기' }).click();
  await expect(score).toHaveClass(/mark-eagle/);
  await expect(page.locator('#hole-name')).toHaveText('이글 이하');
});

test('adds a penalty stroke for each OB or hazard stake and takes it off with its minus', async ({ page }) => {
  await open(page);
  const unOb = page.getByRole('button', { name: 'OB 하나 빼기' });
  await expect(unOb).toBeHidden();
  await tap(page, 'driver');
  await tap(page, 'ob');
  await expect(page.locator('#stake-ob .badge')).toHaveText('1');
  await expect(unOb).toBeVisible();
  await expect(page.locator('#hole-strokes')).toHaveText('2');
  await tap(page, 'hazard', 2);
  await expect(page.locator('#stake-hazard .badge')).toHaveText('2');
  await expect(page.locator('#hole-strokes')).toHaveText('4');
  await page.getByRole('button', { name: '해저드 하나 빼기' }).click();
  await expect(page.locator('#hole-strokes')).toHaveText('3');
  await unOb.click();
  await expect(unOb).toBeHidden();
  await expect(page.locator('#hole-strokes')).toHaveText('2');
  await tap(page, 'putts');
  await next(page).click();
  expect((await stored(page)).holes[0]).toEqual({ par: 4, driver: 1, approach: 0, putts: 1, ob: 0, hazard: 1, mulligan: 0 });
  await showCard(page);
  await expect(page.locator('#sum-penalty')).toHaveText('1');
  await expect(page.locator('#analysis')).toContainText('해저드 1회로 벌타 1타가 더해졌습니다');
});

test('opens a club’s shots in a panel to tag them, while + stays one tap', async ({ page }) => {
  await open(page);
  const sheet = page.locator('#shots');
  await tap(page, 'driver');
  await expect(page.locator('#hole-strokes')).toHaveText('1');
  // A tap records the stroke and shows nothing else.
  await expect(sheet).toBeHidden();
  await tap(page, 'driver');
  const drives = page.getByRole('button', { name: '드라이버 샷 세부 보기' });
  await drives.click();
  await expect(sheet).toBeVisible();
  await expect(page.locator('#shots-title')).toHaveText('드라이버 샷 세부');
  await expect(sheet.locator('.shot')).toHaveCount(2);
  await expect(sheet.locator('.shot').first().getByRole('button')).toHaveText(['페어웨이', '좌', '우', '좌 OB', '우 OB', '헛스윙', '뒤땅/토핑']);
  expect(await page.evaluate(() => document.getElementById('shots')!.contains(document.activeElement))).toBe(true);

  const first = sheet.locator('.shot').nth(0);
  await first.getByRole('button', { name: '좌 OB', exact: true }).click();
  await expect(first.getByRole('button', { name: '좌 OB', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#stake-ob .badge')).toHaveText('1');
  await sheet.locator('.shot').nth(1).getByRole('button', { name: '페어웨이', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(drives).toBeFocused();
  await expect(page.locator('#hole-strokes')).toHaveText('3');

  // Tapping the chosen chip again clears it, with the OB it added.
  await drives.click();
  await expect(first.getByRole('button', { name: '좌 OB', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await first.getByRole('button', { name: '좌 OB', exact: true }).click();
  await expect(page.locator('#stake-ob .badge')).toHaveText('0');
  await sheet.getByRole('button', { name: '닫기' }).click();
  await expect(sheet).toBeHidden();
  // A club with no shots has nothing to open.
  await expect(page.getByRole('button', { name: '어프로치 샷 세부 보기' })).toBeDisabled();
  expect((await stored(page)).holes[0]).toEqual({ par: 4, driver: 2, approach: 0, putts: 0, ob: 0, hazard: 0, mulligan: 0, tags: { driver: [null, 'fairway'] } });
});

test('summarises shot details in the analysis and the email', async ({ page }) => {
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await page.getByRole('button', { name: '퍼터 샷 세부 보기' }).click();
  const shots = page.locator('#shots .shot');
  await shots.nth(1).getByRole('button', { name: '들어감', exact: true }).click();
  await shots.nth(0).getByRole('button', { name: '짧음', exact: true }).click();
  await page.locator('#shots').getByRole('button', { name: '닫기' }).click();
  await expect(page.locator('.club-putts .count')).toHaveClass(/has-tags/);
  await expect(page.locator('.club-driver .count')).not.toHaveClass(/has-tags/);
  await tap(page, 'ob');
  await next(page).click();
  await showCard(page);
  await expect(page.locator('#analysis .details')).toContainText('퍼트: 들어감 1 · 짧음 1');
  const body = new URL(await page.locator('#send-email').getAttribute('href') as string).searchParams.get('body')!;
  expect(body).toContain('[샷 세부]');
  expect(body).toContain('1번 Par4: 4타 (E) 드1 어0 퍼2 OB 1 · 퍼 짧음, 들어감');
});

test('shows no detail section for a round without tags', async ({ page }) => {
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await next(page).click();
  await showCard(page);
  await expect(page.locator('#analysis .headline')).toBeVisible();
  await expect(page.locator('#analysis .details')).toHaveCount(0);
});

test('switches between 기록 and 스코어카드 with the tabs and arrow keys', async ({ page }) => {
  await open(page);
  const entry = tab(page, '기록');
  const card = tab(page, '스코어카드');
  await expect(entry).toHaveAttribute('aria-selected', 'true');
  await expect(card).toHaveAttribute('aria-controls', 'card-view');
  // 기록 shows the current hole only: no totals bar and no strip of hole tabs.
  await expect(page.locator('#card-view')).toBeHidden();
  await expect(page.locator('.summary')).toBeHidden();
  await expect(page.locator('#hole-tabs')).toHaveCount(0);

  await card.click();
  await expect(card).toHaveAttribute('aria-selected', 'true');
  await expect(entry).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#entry')).toBeHidden();
  await expect(page.locator('.summary')).toBeVisible();
  await expect(page.locator('#analysis')).toBeVisible();
  await expect(page.locator('#scorecard')).toBeVisible();

  await card.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(entry).toBeFocused();
  await expect(page.locator('#entry')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(card).toBeFocused();
  await expect(page.locator('#card-view')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.locator('#entry')).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.locator('#card-view')).toBeVisible();
  await expect(entry).toHaveAttribute('tabindex', '-1');
  await expect(card).toHaveAttribute('tabindex', '0');
});

test('opens a hole from the scorecard in 기록', async ({ page }) => {
  await open(page);
  await showCard(page);
  await page.getByRole('button', { name: '12번 홀로 가기', exact: true }).click();
  await expect(page.locator('#entry')).toBeVisible();
  await expect(tab(page, '기록')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#hole-title')).toHaveText('12번 홀');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('changes a hole’s par from the scorecard, not from 기록', async ({ page }) => {
  await open(page);
  await expect(page.locator('#entry').getByRole('radio')).toHaveCount(0);
  await showCard(page);
  await page.getByRole('button', { name: '1번 홀 Par 4 바꾸기', exact: true }).click();
  const dialog = page.locator('#par-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Par 4' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Par 3' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.scorecard .par-row td').first()).toHaveText('3');
  await expect(page.locator('.scorecard').first().locator('.par-row .sum')).toHaveText('35');

  // Cancel and Escape keep the par.
  await page.getByRole('button', { name: '1번 홀 Par 3 바꾸기', exact: true }).click();
  await dialog.getByRole('button', { name: '취소' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: '1번 홀 Par 3 바꾸기', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.scorecard .par-row td').first()).toHaveText('3');

  await showEntry(page);
  await expect(page.locator('#hole-par')).toHaveText('Par 3');
});

test('draws the hole by its par, without notes when the course has none', async ({ page }) => {
  await open(page);
  const panel = page.locator('#hole-panel');
  await expect(panel.locator('svg.hole-art')).toBeVisible();
  await expect(panel.locator('.art-fairway')).toHaveCount(1);
  await expect(page.locator('#hole-distance')).toBeHidden();
  await expect(page.locator('#hole-notes')).toBeHidden();
  await expect(page.getByRole('link', { name: '공식 홀 안내' })).toHaveCount(0);
  const greenY = async () => Number(await panel.locator('.art-green').getAttribute('cy'));
  const par4 = await greenY();
  await page.getByRole('button', { name: '다음 홀로 이동' }).click();
  await page.getByRole('button', { name: '다음 홀로 이동' }).click();
  await expect(page.locator('#hole-par')).toHaveText('Par 5');
  expect(await greenY()).toBeLessThan(par4);
  await page.getByRole('button', { name: '다음 홀로 이동' }).click();
  await expect(page.locator('#hole-par')).toHaveText('Par 3');
  await expect(panel.locator('.art-fairway')).toHaveCount(0);
  expect(await greenY()).toBeGreaterThan(par4);
});

test.describe('with hole notes in the course data', () => {
  // The bundle has no hole notes yet, so this test adds some for Everis 새별 hole 1 to the served script.
  // A service worker would serve the script from its cache, so it is kept out of this test.
  test.use({ serviceWorkers: 'block' });

  test('shows the length, the layout note and the official guide link, and bends a dogleg', async ({ page }) => {
    // The 새별 nine as the bundler writes it: a JS object literal (keys bare or quoted, any string quotes).
    const q = '["\'`]';
    const key = (k: string) => `${q}?${k}${q}?`;
    const nine = new RegExp(`(${key('id')}:${q}saebyul${q},${key('name')}:\\{${key('ko')}:${q}새별${q},${key('en')}:null\\},${key('par')}:\\[4,4,5,3,4,4,3,5,4\\])`);
    const notes = ',"holes":[{"distances":[{"tee":"화이트","length":352,"unit":"m"}],"layout":"우 도그렉","guideUrl":"https://example.test/everis/saebyul/1"}]';
    let patched = false;
    await page.route('**/assets/*.js', async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      if (nine.test(body)) {
        body = body.replace(nine, `$1${notes}`);
        patched = true;
      }
      await route.fulfill({ response, body });
    });
    await open(page);
    expect(patched).toBe(true);
    await expect(page.locator('#hole-distance')).toHaveText('화이트 352m');
    await expect(page.locator('#hole-layout')).toHaveText('우 도그렉');
    const guide = page.getByRole('link', { name: '공식 홀 안내' });
    await expect(guide).toHaveAttribute('href', 'https://example.test/everis/saebyul/1');
    await expect(guide).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(guide).toHaveAttribute('target', '_blank');
    expect(Number(await page.locator('#hole-panel .art-green').getAttribute('cx'))).toBeGreaterThan(30);
    // Hole 2 has no notes: the panel shows the par alone again.
    await page.getByRole('button', { name: '다음 홀로 이동' }).click();
    await expect(page.locator('#hole-distance')).toBeHidden();
    await expect(page.locator('#hole-notes')).toBeHidden();
  });
});

test('keeps the round after reload and starts a new one on request', async ({ page }) => {
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await showCard(page);
  await page.getByRole('button', { name: '5번 홀로 가기', exact: true }).click();
  await expect(page.locator('#hole-title')).toHaveText('5번 홀');
  await page.reload();
  await expect(page.locator('#hole-title')).toHaveText('5번 홀');
  await expect(page.locator('#hole-run')).toContainText('3타');

  await showCard(page);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#new-round').click();
  await expect(page.locator('#sum-strokes')).toHaveText('3');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#new-round').click();
  // Cancelling the course picker keeps the round.
  await page.getByRole('button', { name: '취소' }).click();
  await expect(page.locator('#sum-strokes')).toHaveText('3');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#new-round').click();
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  // A new round opens on its first hole.
  await expect(page.locator('#entry')).toBeVisible();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  await expect(page.locator('#sum-strokes')).toHaveText('0');
});

test('ignores a broken saved round', async ({ page }) => {
  await open(page);
  await page.evaluate((key) => localStorage.setItem(key, '{"version":1,"holes":"x"}'), STORAGE_KEY);
  await page.reload();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  await expect(page.locator('#hole-strokes')).toHaveText('0');
});

test('keeps an unreadable or newer saved value instead of overwriting it', async ({ page }) => {
  await open(page);
  const future = JSON.stringify({ version: 2, note: 'saved by a newer version' });
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, future]);
  await page.reload();
  await expect(page.locator('#notice')).toContainText('따로 보관');
  await expect(page.locator('#save-state')).toContainText('따로 보관');
  // Opening the page alone writes nothing over the stored value.
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(future);
  await page.reload();
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await tap(page, 'driver');
  const all = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  const copies = Object.entries(all).filter(([k]) => k.startsWith('fairway-note:corrupt:'));
  expect(copies.map(([, v]) => v)).toEqual([future]);
  expect(JSON.parse(all[STORAGE_KEY]).holes[0].driver).toBe(1);
  await expect(page.locator('#notice')).toBeHidden();
});

test('does not save anything just by opening the page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#picker')).toBeVisible();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key) !== null, STORAGE_KEY)).toBe(true);
});

test('moves between holes from the hole panel and stops at the ends', async ({ page }) => {
  await open(page);
  await expect(page.locator('#prev-hole')).toBeDisabled();
  await page.locator('#next-hole').click();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
  await page.locator('#prev-hole').click();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  // ‹ › only move: nothing is recorded.
  await expect(page.locator('#hole-strokes')).toHaveText('0');
  await showCard(page);
  await page.getByRole('button', { name: '18번 홀로 가기', exact: true }).click();
  await expect(page.locator('#hole-title')).toHaveText('18번 홀');
  await expect(page.locator('#next-hole')).toBeDisabled();
  await expect(page.getByRole('button', { name: '드라이버 하나 빼기' })).toBeDisabled();
  // On the last hole the button below the card opens the scorecard.
  await expect(next(page)).toHaveText('스코어카드 보기');
  await next(page).click();
  await expect(page.locator('#card-view')).toBeVisible();
});

test('links back to the site and fits a 360px screen in both views', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page);
  await expect(page).toHaveTitle('Fairway Note');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fairway Note');
  await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·레이크');
  const home = page.locator('a.home-link');
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute('href', '../../');
  await tap(page, 'driver');
  await tap(page, 'ob');
  await tap(page, 'hazard');
  await tap(page, 'putts', 2);
  expect(await sideScroll(page)).toBe(0);
  await showCard(page);
  await expect(page.locator('#analysis .headline')).toBeVisible();
  await expect(home).toBeVisible();
  expect(await sideScroll(page)).toBe(0);
});

test('keeps a hole in progress out of the score until it is putted', async ({ page }) => {
  await open(page);
  await tap(page, 'driver');
  await expect(page.locator('#hole-strokes')).toHaveText('1');
  await expect(page.locator('#hole-name')).toContainText('진행 중');
  await expect(page.locator('#hole-strokes')).not.toHaveClass(/mark-/);
  await expect(page.locator('#hole-run')).not.toContainText('1타');
  await showCard(page);
  await expect(page.locator('#sum-strokes')).toHaveText('0');
  await expect(page.locator('#sum-holes')).toHaveText('0/18');
  await expect(page.locator('#analysis')).toContainText('홀을 기록하면');

  await showEntry(page);
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await expect(page.locator('#hole-name')).toHaveText('파');
  await expect(page.locator('#hole-run')).toContainText('4타');
});

test('counts a chip-in once the player moves to the next hole', async ({ page }) => {
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'approach', 2);
  await next(page).click();
  await showCard(page);
  await expect(page.locator('#sum-strokes')).toHaveText('3');
  await expect(page.locator('#sum-topar')).toHaveText('-1');
});

test('notes a mulligan behind 더보기 without starting the hole', async ({ page }) => {
  await open(page);
  await mulligan(page, 2);
  await expect(page.locator('#hole-name')).toHaveText('아직 기록 없음');
  await page.getByRole('button', { name: '더보기' }).click();
  await expect(page.locator('#mulligan-count')).toHaveText('2');
  await page.locator('#more').getByRole('button', { name: '멀리건 하나 빼기' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#more')).toBeHidden();
  await expect(page.getByRole('button', { name: '더보기' })).toBeFocused();
  await showCard(page);
  await expect(page.locator('#sum-mulligan')).toHaveText('1');
  await expect(page.locator('#analysis')).toContainText('홀을 기록하면');
});

test('stops counting at 15', async ({ page }) => {
  await open(page);
  await tap(page, 'approach', 15);
  await expect(count(page, 'approach')).toHaveText('15');
  await expect(page.getByRole('button', { name: '어프로치 하나 더하기' })).toBeDisabled();
});

test('announces taps in one live region', async ({ page }) => {
  await open(page);
  await expect(page.locator('[aria-live]')).toHaveCount(1);
  await tap(page, 'putts');
  await expect(page.locator('#announce')).toHaveText('1번 홀 퍼터 1, 1타');
  await tap(page, 'hazard');
  await expect(page.locator('#announce')).toHaveText('1번 홀 해저드 1, 2타');
  await next(page).click();
  await expect(page.locator('#announce')).toHaveText('2번 홀, Par 4');
});

test('says so on the entry screen when the round cannot be saved', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('denied', 'SecurityError'); };
  });
  await open(page);
  await tap(page, 'driver');
  await expect(page.locator('#notice')).toContainText('저장할 수 없습니다');
  await expect(page.locator('#hole-strokes')).toHaveText('1');
});

test('opens the course picker first when an older version left an empty round', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => {
    // Versions before "nothing saved until the first edit" saved an untouched round on open.
    const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 }));
    localStorage.setItem(key, JSON.stringify({ version: 1, date: '2026-11-19', current: 0, holes }));
  }, STORAGE_KEY);
  await page.reload();
  await expect(page.locator('#picker')).toBeVisible();
  // Nothing was recorded, so there is no round to go back to.
  await expect(page.locator('#picker-cancel')).toBeHidden();
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·레이크');
});

test('keeps a round just started from the picker after a reload, before any tap', async ({ page }) => {
  await open(page);
  await page.reload();
  // The round has its course, so it is not an untouched round from an older version.
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
});

test('opens the course picker first for a round from an earlier day, and can go back to it', async ({ page }) => {
  await open(page);
  await page.evaluate((key) => {
    const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 }));
    holes[0] = { par: 4, driver: 1, approach: 1, putts: 2, ob: 0, mulligan: 0 };
    localStorage.setItem(key, JSON.stringify({ version: 1, date: '2026-01-01', current: 1, holes }));
  }, STORAGE_KEY);
  await page.reload();
  await expect(page.locator('#picker')).toBeVisible();
  const back = page.locator('#picker-cancel');
  await expect(back).toHaveText('지난 라운드 이어서');

  // Starting a new round from here still asks before the earlier round is wiped.
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await expect(page.locator('#sum-strokes')).toHaveText('4');
  await expect(page.locator('#stale')).toBeVisible();

  await page.reload();
  await back.click();
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#stale')).toBeHidden();
  await expect(page.locator('#sum-strokes')).toHaveText('4');
  // Going back counts as continuing: the round is not offered again on the next load.
  await page.reload();
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
});

test('offers to continue or replace a round from an earlier day', async ({ page }) => {
  await open(page);
  await page.evaluate((key) => {
    const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 }));
    holes[0] = { par: 4, driver: 1, approach: 1, putts: 2, ob: 0, mulligan: 0 };
    localStorage.setItem(key, JSON.stringify({ version: 1, date: '2026-01-01', current: 1, holes }));
  }, STORAGE_KEY);
  await page.reload();
  // The course picker opens first for an earlier-day round; Esc closes it and the banner stays.
  await page.keyboard.press('Escape');
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#stale')).toBeVisible();
  await expect(page.locator('#stale-text')).toContainText('2026년 1월 1일');
  await page.locator('#stale-keep').click();
  await expect(page.locator('#stale')).toBeHidden();
  await expect(page.locator('#hole-run')).toContainText('4타');

  // Choosing to continue keeps the banner away on the next load.
  await page.reload();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
  await expect(page.locator('#stale')).toBeHidden();
  await expect(page.locator('#hole-run')).toContainText('4타');
});

test('asks before the earlier-day banner replaces a round', async ({ page }) => {
  await open(page);
  await page.evaluate((key) => {
    const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 }));
    holes[0] = { par: 4, driver: 1, approach: 1, putts: 2, ob: 0, mulligan: 0 };
    localStorage.setItem(key, JSON.stringify({ version: 1, date: '2026-01-01', current: 1, holes }));
  }, STORAGE_KEY);
  await page.reload();
  // The course picker opens first for an earlier-day round; Esc closes it and the banner stays.
  await page.keyboard.press('Escape');
  await expect(page.locator('#picker')).toBeHidden();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#stale-new').click();
  await expect(page.locator('#hole-run')).toContainText('4타');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#stale-new').click();
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await expect(page.locator('#stale')).toBeHidden();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  await expect(page.locator('#hole-run')).not.toContainText('4타');
  await page.reload();
  await expect(page.locator('#stale')).toBeHidden();
});

test('keeps a round that crosses midnight without the earlier-day banner', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 19, 23, 40) });
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await next(page).click();
  await page.clock.setSystemTime(new Date(2026, 10, 20, 0, 20));
  await page.reload();
  await expect(page.locator('#stale')).toBeHidden();
  await expect(page.locator('#hole-run')).toContainText('4타');
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');

  // Half a day later the round is offered again, and one tap does not wipe it.
  await page.clock.setSystemTime(new Date(2026, 10, 20, 12, 30));
  await page.reload();
  // The course picker opens first for an earlier-day round; Esc closes it and the banner stays.
  await page.keyboard.press('Escape');
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#stale')).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#stale-new').click();
  await expect(page.locator('#hole-run')).toContainText('4타');
});

test('follows a round saved in another tab', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('/');
  await second.goto('/');
  await first.getByRole('button', { name: '이 코스로 시작' }).click();
  // The other tab was still choosing its first course; it follows the round that was started.
  await expect(second.locator('#picker')).toBeHidden();
  await tap(first, 'driver');
  await tap(first, 'putts', 2);
  await expect(second.locator('#hole-strokes')).toHaveText('3');
  await expect(second.locator('#hole-run')).toContainText('3타');
});

test('keeps its round when another tab removes the saved one', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await open(first);
  await tap(first, 'driver');
  await tap(first, 'putts', 2);
  await second.goto('/');
  await expect(second.locator('#hole-strokes')).toHaveText('3');
  await first.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await expect(second.locator('#notice')).toContainText('다음 입력 때 다시 저장');
  await expect(second.locator('#hole-strokes')).toHaveText('3');
  await next(second).click();
  expect((await stored(second)).holes[0]).toMatchObject({ driver: 1, putts: 2 });
  await expect(second.locator('#notice')).toBeHidden();
  await expect(second.locator('#save-state')).toContainText('자동 저장');
});

for (const [width, height] of [[375, 553], [390, 664]]) {
  test.describe(`on a ${width}×${height} phone`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('shows the whole 기록 screen without scrolling, above the bottom tab bar', async ({ page }) => {
      await open(page);
      const check = async () => {
        expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
        expect(await sideScroll(page)).toBe(0);
        const tabs = (await page.locator('#views').boundingBox())!;
        expect(tabs.y + tabs.height).toBeCloseTo(height, 0);
        expect(tabs.height).toBeGreaterThanOrEqual(56);
        const go = (await next(page).boundingBox())!;
        expect(go.y + go.height).toBeLessThanOrEqual(tabs.y);
        expect(go.height).toBeGreaterThanOrEqual(48);
        const header = (await page.locator('header.top').boundingBox())!;
        const targets = ['#prev-hole', '#next-hole', '#more-open', '#stake-ob', '#stake-hazard'];
        for (const key of ['driver', 'approach', 'putts']) targets.push(`.club-${key} .plus`, `.club-${key} .count`, `.club-${key} .minus`);
        for (const selector of targets) {
          const box = (await page.locator(selector).boundingBox())!;
          expect(box.y, selector).toBeGreaterThanOrEqual(header.y + header.height);
          expect(box.y + box.height, selector).toBeLessThanOrEqual(go.y);
          expect(box.height, selector).toBeGreaterThanOrEqual(48);
          expect(box.width, selector).toBeGreaterThanOrEqual(48);
        }
        // At least 8px between neighbouring targets.
        for (const key of ['driver', 'approach', 'putts']) {
          const [count, plus, minus] = await Promise.all(['.count', '.plus', '.minus'].map(async (s) => (await page.locator(`.club-${key} ${s}`).boundingBox())!));
          expect(plus.y - (count.y + count.height), key).toBeGreaterThanOrEqual(8);
          expect(minus.y - (plus.y + plus.height), key).toBeGreaterThanOrEqual(8);
        }
        const [d, a, p] = await Promise.all(['driver', 'approach', 'putts'].map(async (k) => (await page.locator(`.club-${k} .plus`).boundingBox())!));
        expect(a.x - (d.x + d.width)).toBeGreaterThanOrEqual(8);
        expect(p.x - (a.x + a.width)).toBeGreaterThanOrEqual(8);
        await expect(page.locator('#hole-panel svg.hole-art')).toBeVisible();
      };
      await check();
      await next(page).tap();
      await expect(page.locator('#hole-title')).toHaveText('2번 홀');
      await check();
      await page.locator('#stake-ob').tap();
      await expect(page.getByRole('button', { name: 'OB 하나 빼기' })).toBeVisible();
      await check();
    });

    test('switches views from the bottom tabs and keeps the end of the scorecard clear of them', async ({ page }) => {
      await open(page);
      await tab(page, '스코어카드').tap();
      await expect(page.locator('.summary')).toBeVisible();
      await expect(next(page)).toBeHidden();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const tabs = (await page.locator('#views').boundingBox())!;
      const button = (await page.locator('#new-round').boundingBox())!;
      expect(button.y + button.height).toBeLessThanOrEqual(tabs.y);
      expect(tabs.y + tabs.height).toBeCloseTo(height, 0);
      expect(await sideScroll(page)).toBe(0);
      await tab(page, '기록').tap();
      await expect(page.locator('#hole-title')).toBeVisible();
      await expect(next(page)).toBeVisible();
    });

    test('keeps the link back to the site visible but away from the top edge', async ({ page }) => {
      await open(page);
      const home = page.locator('a.home-link');
      await expect(home).toBeVisible();
      const box = (await home.boundingBox())!;
      const header = (await page.locator('header.top').boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(8);
      // Sits low in the header, not in the top corner, with small text.
      expect(box.y + box.height / 2).toBeGreaterThan(header.y + header.height / 2);
      expect(await home.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(12);
    });

    test('opens the shot panel within the screen with large chips', async ({ page }) => {
      await open(page);
      await page.locator('.club-driver .plus').tap();
      await page.locator('.club-driver .count').tap();
      const sheet = page.locator('#shots');
      await expect(sheet).toBeVisible();
      const box = (await sheet.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      for (const chip of await sheet.locator('.chip').all()) {
        const c = (await chip.boundingBox())!;
        expect(c.height).toBeGreaterThanOrEqual(44);
        expect(c.x + c.width).toBeLessThanOrEqual(width);
      }
      expect(await sideScroll(page)).toBe(0);
    });
  });
}

test('on a wide screen puts the view switch at the top', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page);
  const tabs = (await page.locator('#views').boundingBox())!;
  const panel = (await page.locator('#hole-panel').boundingBox())!;
  expect(tabs.y + tabs.height).toBeLessThanOrEqual(panel.y);
  await showCard(page);
  await expect(page.locator('#analysis')).toBeVisible();
});

test('keeps the scorecard below its sticky totals when scrolled to', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 553 });
  await open(page);
  await showCard(page);
  const padding = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop));
  const summary = (await page.locator('.summary').boundingBox())!;
  expect(padding).toBeGreaterThanOrEqual(summary.height);
  expect(padding).toBeLessThanOrEqual(summary.height + 8);
});

test('labels are large and dark enough to read in sunlight', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  const measure = (selectors: string[]) => page.evaluate((list) => {
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
    return list.map((selector) => {
      const el = document.querySelector(selector)!;
      const style = getComputedStyle(el);
      const [a, b] = [lum(style.color), lum(background(el))].sort((x, y) => y - x);
      return { selector, size: parseFloat(style.fontSize), contrast: (a + 0.05) / (b + 0.05) };
    });
  }, selectors);
  const checks = await measure(['.club-name', '.hole-meta', '#hole-name', '#hole-run', '.stake .label', '.tab-label', '#course-name']);
  await showCard(page);
  checks.push(...await measure(['.stat .label', '.scorecard th[scope="row"]', '.metrics dt', '.tab-label']));
  for (const { selector, size, contrast } of checks) {
    expect(size, selector).toBeGreaterThanOrEqual(13);
    expect(contrast, selector).toBeGreaterThanOrEqual(4.5);
  }
});

test('makes a usable minus button clearly stronger than a disabled one', async ({ page }) => {
  await open(page);
  await tap(page, 'driver');
  const look = (selector: string) => page.locator(selector).evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: parseFloat(s.borderTopWidth), color: s.color, background: s.backgroundColor };
  });
  const on = await look('.club-driver .minus');
  const off = await look('.club-approach .minus');
  expect(on.border).toBeGreaterThanOrEqual(2);
  // A disabled state is a lighter fill with the label kept, not opacity alone.
  expect(on.color).not.toBe(off.color);
  expect(on.background).not.toBe(off.background);
  expect(await page.locator('.club-approach .minus').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
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
  await open(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { wakeRequests: string[] }).wakeRequests)).toEqual(['screen']);
});

test('works without errors when screen wake is missing or refused', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, value: undefined });
  });
  await open(page);
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
  await open(page);
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

test('shows each club’s icon and the two stakes', async ({ page }) => {
  await open(page);
  for (const key of ['driver', 'approach', 'putts']) await expect(page.locator(`.club-${key} .club-head svg`)).toBeVisible();
  await expect(page.locator('#stake-ob')).toContainText('OB');
  await expect(page.locator('#stake-hazard')).toContainText('해저드');
});

test('sends the round by email through the mail app', async ({ page }) => {
  await open(page);
  await showCard(page);
  await expect(page.locator('#send-actions')).toBeHidden();
  await expect(page.locator('#send-note')).toContainText('홀을 끝내면');
  await showEntry(page);
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await showCard(page);
  const email = page.getByRole('link', { name: '이메일로 보내기' });
  await expect(email).toBeVisible();
  const url = new URL((await email.getAttribute('href'))!);
  expect(url.protocol).toBe('mailto:');
  expect(url.pathname).toBe('');
  expect(url.searchParams.get('subject')).toMatch(/^에버리스 골프리조트 새별·레이크 \d{4}년 \d{1,2}월 \d{1,2}일 라운드 4타 \(E\)$/);
  expect(url.searchParams.get('body')).toContain('1번 Par4: 4타 (E) 드1 어1 퍼2');
});

test('shares the round with the phone share sheet', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    navigator.share = async (data) => { (window as unknown as { shared: unknown[] }).shared.push(data); };
  });
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await showCard(page);
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
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await showCard(page);
  await page.getByRole('button', { name: '결과 복사' }).click();
  await expect(page.locator('#send-status')).toContainText('복사했습니다');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('1번 Par4: 3타 (-1)');
});

test('opens and records offline after the first visit', async ({ page, context }) => {
  await open(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  // The stylesheet came from the cache too.
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.clubs')!).display)).toBe('grid');
  await expect(page.locator('.club-driver .club-head svg')).toBeVisible();
  await tap(page, 'driver');
  await tap(page, 'hazard');
  await tap(page, 'putts', 2);
  await expect(count(page, 'driver')).toHaveText('1');
  await expect(page.locator('#hole-strokes')).toHaveText('4');
  await showCard(page);
  await expect(page.locator('#sum-strokes')).toHaveText('4');
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
    await open(page);
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

test('loads a round with unreadable tags, keeping its scores and the original value', async ({ page }) => {
  await page.goto('/');
  const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 }));
  holes[0] = { ...holes[0], driver: 1, putts: 2, tags: { driver: ['slice'], putts: [null, 'in'] } } as typeof holes[0];
  const value = JSON.stringify({ version: 1, date: '2026-11-19', current: 1, holes, lastEdited: Date.now() });
  await page.evaluate(([key, v]) => localStorage.setItem(key, v), [STORAGE_KEY, value]);
  await page.reload();
  await expect(page.locator('#hole-run')).toContainText('3타');
  await expect(page.locator('#notice')).toContainText('세부 기록 일부');
  await tap(page, 'driver');
  const all = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  expect(Object.entries(all).filter(([k]) => k.startsWith('fairway-note:corrupt:')).map(([, v]) => v)).toEqual([value]);
  expect(JSON.parse(all[STORAGE_KEY]).holes[0].tags).toEqual({ putts: [null, 'in'] });
});

test.describe('course picker', () => {
  test.use({ viewport: { width: 375, height: 553 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('offers the remembered course first and starts it with one tap, on one short screen', async ({ page }) => {
    await page.goto('/');
    const picker = page.locator('#picker');
    await expect(picker).toBeVisible();
    await expect(page.getByRole('button', { name: '취소' })).toBeHidden();
    await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트 새별·레이크');
    await expect(page.locator('#picker-list [aria-pressed="true"]')).toContainText('에버리스');
    await expect(page.getByRole('button', { name: '이 코스로 시작' })).toBeFocused();
    const start = (await page.getByRole('button', { name: '이 코스로 시작' }).boundingBox())!;
    expect(start.y + start.height).toBeLessThanOrEqual(553);
    expect(start.height).toBeGreaterThanOrEqual(48);
    expect((await page.locator('#picker-list').boundingBox())!.height).toBeGreaterThanOrEqual(96);
    expect(await sideScroll(page)).toBe(0);
    expect(await page.locator('#picker-list').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);

    // Pine as the back nine: holes 10-18 take Pine's pars.
    await page.locator('#picker-chosen').getByRole('radio', { name: '파인' }).nth(1).tap();
    await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트 새별·파인');
    await page.getByRole('button', { name: '이 코스로 시작' }).tap();
    await expect(picker).toBeHidden();
    await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·파인');
    const pars = await page.locator('.scorecard .par-row td').allTextContents();
    expect(pars.slice(10, 19)).toEqual(['4', '4', '4', '5', '3', '4', '4', '3', '5']);
    const source = page.locator('#par-source a');
    await expect(source).toHaveText('공식 스코어카드');
    expect(await source.getAttribute('href')).toContain('shinangolf.com');
    await expect(page.locator('#par-source')).toContainText('2026-11-19 확인');

    await page.reload();
    await expect(picker).toBeHidden();
    await tab(page, '스코어카드').tap();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#new-round').tap();
    await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트 새별·파인');
    await expect(page.getByRole('button', { name: '취소' })).toBeVisible();
  });

  test('finds a course by initial consonants and area, and swaps the nines of an 18-hole course', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '제주', exact: true }).tap();
    const regions = await page.locator('#picker-list .course:not(.custom) span').allTextContents();
    expect(regions.length).toBeGreaterThan(5);
    expect(regions.every((r) => r.startsWith('제주 '))).toBe(true);

    await page.getByRole('searchbox', { name: '골프장 검색' }).fill('ㅌㄷ');
    await page.locator('#picker-list button', { hasText: '테디밸리' }).tap();
    await expect(page.locator('#picker-chosen')).toContainText('전반 테디 · 후반 밸리');
    await page.getByRole('button', { name: '전·후반 바꾸기' }).tap();
    await expect(page.locator('#picker-label')).toHaveText('테디밸리 골프앤리조트 밸리·테디');
    await page.getByRole('button', { name: '이 코스로 시작' }).tap();
    await expect(page.locator('#course-name')).toHaveText('테디밸리 골프앤리조트 밸리·테디');

    await tab(page, '스코어카드').tap();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#new-round').tap();
    await page.getByRole('searchbox', { name: '골프장 검색' }).fill('없는골프장이름');
    await expect(page.locator('#picker-list')).toContainText('찾는 골프장이 없습니다');
  });

  test('starts an unlisted course with its name and par 4 on every hole', async ({ page }) => {
    await page.goto('/');
    await page.locator('#picker-list button', { hasText: '직접 입력' }).tap();
    await page.getByRole('textbox', { name: '골프장 이름' }).fill('동네 골프장');
    await expect(page.locator('#picker-label')).toHaveText('동네 골프장');
    await page.getByRole('button', { name: '이 코스로 시작' }).tap();
    await expect(page.locator('#course-name')).toHaveText('동네 골프장');
    expect(new Set(await page.locator('.scorecard .par-row td:not(.sum)').allTextContents())).toEqual(new Set(['4']));
    await expect(page.locator('#par-source')).toContainText('Par 4로 시작');
    await expect(page.locator('#par-source a')).toHaveCount(0);
    await page.locator('.club-driver .plus').tap();
    await page.locator('.club-putts .plus').tap();
    await page.locator('.club-putts .plus').tap();
    await tab(page, '스코어카드').tap();
    const href = (await page.getByRole('link', { name: '이메일로 보내기' }).getAttribute('href'))!;
    expect(new URL(href).searchParams.get('subject')).toMatch(/^동네 골프장 \d{4}년/);

    // The typed course is remembered for the next round.
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#new-round').tap();
    await expect(page.getByRole('textbox', { name: '골프장 이름' })).toHaveValue('동네 골프장');
  });
});

test('keeps the pars of a round saved before courses could be chosen', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => {
    const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 }));
    holes[0] = { par: 3, driver: 1, approach: 0, putts: 2, ob: 0, mulligan: 0 };
    localStorage.setItem(key, JSON.stringify({ version: 1, date: '2026-11-19', current: 1, holes, lastEdited: Date.now() }));
  }, STORAGE_KEY);
  await page.reload();
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·레이크');
  const pars = await page.locator('.scorecard .par-row td').allTextContents();
  expect(pars.slice(0, 3)).toEqual(['3', '4', '4']);
  await expect(page.locator('#hole-run')).toContainText('3타');
});

/* ---------- past rounds and backup ---------- */

const HISTORY_KEY = 'fairway-note:history:v1';
const pastItems = (page: Page) => page.locator('#history-list .past-item');

/** Opens the page with nothing saved and starts the course the picker offers. */
async function openRound(page: Page) {
  await open(page);
}

/** Finishes the hole on screen in 4 (a drive, an approach, two putts) and moves to the next hole. */
async function parHole(page: Page) {
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await page.locator('#next-hole').click();
}

/** Accepts the next question and gives back its text. */
function accept(page: Page): Promise<string> {
  return new Promise((resolve) => page.once('dialog', (dialog) => {
    resolve(dialog.message());
    void dialog.accept();
  }));
}

/** Starts a new round from the footer, accepting the question and the course the picker offers, and gives back the question. */
async function startNewRound(page: Page): Promise<string> {
  const asked = accept(page);
  await page.locator('#new-round').click();
  const question = await asked;
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await expect(page.locator('#picker')).toBeHidden();
  return question;
}

/** Puts finished 18-hole rounds (all par 4, two putts, 72 plus `bogeys` strokes) dated 1, 2, 3… October into the history. */
async function seedHistory(page: Page, bogeys: number[]) {
  await page.evaluate(([key, list]) => {
    const value = list.map((n, i) => {
      const date = `2026-10-${String(i + 1).padStart(2, '0')}`;
      const holes = Array.from({ length: 18 }, (_, h) => ({ par: 4, driver: 1, approach: h < n ? 2 : 1, putts: 2, ob: 0, mulligan: 0 }));
      return { id: `seed-${i}`, endedAt: Date.parse(`${date}T18:00:00`), round: { version: 1, date, current: 17, holes } };
    });
    localStorage.setItem(key, JSON.stringify(value));
  }, [HISTORY_KEY, bogeys] as const);
  await page.reload();
}

/** A saved round on `date` with hole 1 played as given and the player on hole 2. */
function savedRound(date: string, hole: { driver: number; approach: number; putts: number }) {
  const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 }));
  holes[0] = { ...holes[0], ...hole };
  return { version: 1, date, current: 1, holes };
}

/** Writes a file for the file picker into the test's output folder. */
function pickable(name: string, content: unknown): string {
  const path = test.info().outputPath(name);
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

test('keeps a finished round among past rounds when a new one starts', async ({ page }) => {
  await openRound(page);
  await expect(page.getByRole('heading', { name: '지난 라운드' })).toBeVisible();
  await expect(page.locator('#history-empty')).toBeVisible();
  await parHole(page);
  await tap(page, 'driver', 2);
  await tap(page, 'ob');
  await tap(page, 'putts', 2);
  expect(await startNewRound(page)).toBe('지금 라운드를 지난 라운드에 보관하고 새로 시작할까요?');
  await expect(page.locator('#sum-strokes')).toHaveText('0');
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');

  await expect(pastItems(page)).toHaveCount(1);
  const item = pastItems(page).first();
  await expect(item.locator('.past-when')).toHaveText(/^\d{4}년 \d{1,2}월 \d{1,2}일$/);
  await expect(item.locator('.past-where')).toHaveText('에버리스 골프리조트 새별·레이크');
  await expect(item.locator('.past-score')).toHaveText('9타 +1');
  await expect(item.locator('.past-meta')).toHaveText('2홀 · 퍼트 4 · OB 1');
  await expect(page.locator('#history-empty')).toBeHidden();
  await expect(page.locator('#history-status')).toContainText('라운드를 지난 라운드에 보관했습니다');
  // Kept under its own key next to the new round, and still there after a reload.
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual([HISTORY_KEY, PREFS_KEY, STORAGE_KEY].sort());
  await page.reload();
  await expect(pastItems(page)).toHaveCount(1);

  // A round with nothing finished is not kept, and the question says so.
  await tap(page, 'driver');
  expect(await startNewRound(page)).toBe('끝낸 홀이 없어 지난 라운드에 보관하지 않습니다. 지금 라운드를 지우고 새로 시작할까요?');
  await expect(page.locator('#hole-strokes')).toHaveText('0');
  await expect(pastItems(page)).toHaveCount(1);
});

test('the earlier-day banner keeps the old round among past rounds too', async ({ page }) => {
  await openRound(page);
  await page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [STORAGE_KEY, savedRound('2026-01-01', { driver: 1, approach: 1, putts: 2 })] as const);
  await page.reload();
  // The course picker opens first for an earlier-day round; Esc closes it and the banner stays.
  await expect(page.locator('#picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#stale')).toBeVisible();
  const asked = accept(page);
  await page.locator('#stale-new').click();
  expect(await asked).toBe('지금 라운드를 지난 라운드에 보관하고 새로 시작할까요?');
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await expect(page.locator('#stale')).toBeHidden();
  await expect(pastItems(page)).toHaveCount(1);
  await expect(pastItems(page).first().locator('.past-when')).toHaveText('2026년 1월 1일');
  await expect(pastItems(page).first().locator('.past-score')).toHaveText('4타 E');
});

test('a new course from the earlier-day picker keeps the earlier round among past rounds; going back keeps nothing', async ({ page }) => {
  await openRound(page);
  const earlier = (date: string) => page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [STORAGE_KEY, savedRound(date, { driver: 1, approach: 1, putts: 2 })] as const);
  await earlier('2026-01-01');
  await page.reload();
  await expect(page.locator('#picker')).toBeVisible();
  const asked = accept(page);
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  expect(await asked).toBe('2026년 1월 1일 라운드를 지난 라운드에 보관하고 새로 시작할까요?');
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#sum-strokes')).toHaveText('0');
  await expect(pastItems(page)).toHaveCount(1);
  await expect(pastItems(page).first().locator('.past-when')).toHaveText('2026년 1월 1일');

  // Going back continues the earlier round, so nothing new is kept.
  await earlier('2026-01-02');
  await page.reload();
  await page.locator('#picker-cancel').click();
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#sum-strokes')).toHaveText('4');
  await expect(pastItems(page)).toHaveCount(1);
});

test('opens a past round read-only with its report, and deletes it only after asking', async ({ page }) => {
  await openRound(page);
  await parHole(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await startNewRound(page);
  await tap(page, 'putts');

  await pastItems(page).first().click();
  const dialog = page.locator('#past');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#past-title')).toHaveText(/^\d{4}년 \d{1,2}월 \d{1,2}일 라운드$/);
  await expect(page.locator('#past-course')).toHaveText('에버리스 골프리조트 새별·레이크');
  await expect(dialog.locator('.scorecard')).toHaveCount(2);
  // Read-only: no links to holes and nothing to tap a stroke into.
  await expect(dialog.locator('.scorecard button, .counter')).toHaveCount(0);
  await expect(dialog.locator('.strokes-row .sum').first()).toHaveText('7');
  await expect(dialog.locator('.headline')).toContainText('2홀 7타');
  const body = new URL((await dialog.getByRole('link', { name: '이메일로 보내기' }).getAttribute('href'))!).searchParams.get('body')!;
  expect(body).toContain('1번 Par4: 4타 (E) 드1 어1 퍼2');
  expect(body).toContain('2번 Par4: 3타 (-1) 드1 어0 퍼2');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // The round being recorded is untouched.
  await expect(page.locator('#hole-strokes')).toHaveText('1');

  await pastItems(page).first().click();
  let question = '';
  page.once('dialog', (d) => {
    question = d.message();
    void d.dismiss();
  });
  await dialog.getByRole('button', { name: '이 라운드 지우기' }).click();
  expect(question).toContain('되돌릴 수 없습니다');
  await expect(dialog).toBeVisible();
  await expect(pastItems(page)).toHaveCount(1);
  await dialog.getByRole('button', { name: '닫기' }).click();
  await expect(dialog).toBeHidden();

  await pastItems(page).first().click();
  const asked = accept(page);
  await dialog.getByRole('button', { name: '이 라운드 지우기' }).click();
  await asked;
  await expect(dialog).toBeHidden();
  await expect(pastItems(page)).toHaveCount(0);
  await expect(page.locator('#history-empty')).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), HISTORY_KEY)).toBeNull();
});

test('saves a backup file and restores it in a fresh browser', async ({ page, browser }, testInfo) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.protocol.startsWith('http') && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || request.method() !== 'GET') outside.push(`${request.method()} ${request.url()}`);
  });
  await openRound(page);
  await parHole(page);
  await startNewRound(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 파일 저장' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^fairway-note-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  expect(Object.keys(backup).sort()).toEqual(['app', 'current', 'exportedAt', 'format', 'history']);
  expect(backup).toMatchObject({ app: 'fairway-note', format: 1 });
  expect(Number.isNaN(Date.parse(backup.exportedAt))).toBe(false);
  expect(backup.history).toHaveLength(1);
  expect(backup.history[0]).toMatchObject({ id: expect.any(String), endedAt: expect.any(Number), round: { version: 1 } });
  expect(backup.history[0].round.holes[0]).toMatchObject({ driver: 1, approach: 1, putts: 2 });
  expect(backup.current.holes[0]).toMatchObject({ driver: 1, approach: 0, putts: 2 });
  await expect(page.locator('#backup-status')).toContainText('백업 파일을 만들었습니다');
  expect(outside).toEqual([]);

  const fresh = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const other = await fresh.newPage();
  const errors: string[] = [];
  other.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  other.on('pageerror', (error) => errors.push(error.message));
  await openRound(other);
  await expect(pastItems(other)).toHaveCount(0);
  const chooser = other.waitForEvent('filechooser');
  await other.getByRole('button', { name: '백업 파일 가져오기' }).click();
  // This browser has nothing to lose, but the backup's round in progress still only replaces it when the player agrees.
  const asked = accept(other);
  await (await chooser).setFiles(file);
  expect(await asked).toContain('진행 중이던 라운드');
  await expect(other.locator('#backup-status')).toHaveText('지난 라운드 1개를 가져왔습니다. 진행 중이던 라운드를 지금 라운드로 불러왔습니다.');
  await expect(pastItems(other)).toHaveCount(1);
  await expect(other.locator('#hole-strokes')).toHaveText('3');
  // The same file again adds nothing.
  await other.locator('#backup-file').setInputFiles(file);
  await expect(other.locator('#backup-status')).toHaveText('가져온 지난 라운드는 없습니다. 이미 있는 2개는 건너뛰었습니다.');
  await expect(pastItems(other)).toHaveCount(1);
  await fresh.close();
  expect(errors).toEqual([]);
});

test('never replaces the round being recorded without asking', async ({ page }) => {
  await openRound(page);
  await parHole(page);
  const past = { id: 'from-backup', endedAt: Date.parse('2026-10-01T18:00:00'), round: savedRound('2026-10-01', { driver: 1, approach: 2, putts: 2 }) };
  const file = pickable('other-phone.json', {
    app: 'fairway-note', format: 1, exportedAt: '2026-11-02T00:00:00.000Z',
    current: savedRound('2026-11-01', { driver: 2, approach: 1, putts: 2 }), history: [past, { id: 'broken' }],
  });

  // Declining keeps this round and files the backup's round among past rounds.
  let question = '';
  page.once('dialog', (d) => {
    question = d.message();
    void d.dismiss();
  });
  await page.locator('#backup-file').setInputFiles(file);
  await expect(page.locator('#backup-status')).toHaveText('지난 라운드 1개를 가져왔습니다. 진행 중이던 라운드는 지난 라운드에 넣었습니다. 읽을 수 없는 1개는 넣지 않았습니다.');
  expect(question).toContain('2026년 11월 1일');
  expect(question).toContain('지금 라운드는 지난 라운드에 보관합니다');
  await expect(page.locator('#sum-strokes')).toHaveText('4');
  await expect(pastItems(page)).toHaveCount(2);

  // Agreeing keeps this round among past rounds first, then switches to the backup's.
  const another = pickable('third-phone.json', {
    app: 'fairway-note', format: 1, exportedAt: '2026-11-03T00:00:00.000Z',
    current: savedRound('2026-11-03', { driver: 1, approach: 0, putts: 1 }), history: [],
  });
  const asked = accept(page);
  await page.locator('#backup-file').setInputFiles(another);
  await asked;
  await expect(page.locator('#backup-status')).toHaveText('가져온 지난 라운드는 없습니다. 진행 중이던 라운드를 지금 라운드로 불러왔습니다.');
  await expect(page.locator('#sum-strokes')).toHaveText('2');
  await expect(page.locator('#stale')).toBeHidden();
  await expect(pastItems(page)).toHaveCount(3);
});

test('rejects files that are not a Fairway Note backup and changes nothing', async ({ page }) => {
  await openRound(page);
  await parHole(page);
  const status = page.locator('#backup-status');
  const files: [string, unknown][] = [
    ['notes.json', 'hello'],
    ['other-app.json', { app: 'other', format: 1, history: [] }],
    ['round.json', savedRound('2026-11-01', { driver: 1, approach: 1, putts: 2 })],
  ];
  for (const [name, content] of files) {
    await status.evaluate((el) => (el.textContent = ''));
    await page.locator('#backup-file').setInputFiles(pickable(name, content));
    await expect(status, name).toHaveText('Fairway Note 백업 파일이 아닙니다. "백업 파일 저장"으로 만든 .json 파일을 골라 주세요.');
  }
  await page.locator('#backup-file').setInputFiles(pickable('newer.json', { app: 'fairway-note', format: 2, history: [] }));
  await expect(status).toContainText('더 새 버전의 Fairway Note가 만든 백업 파일입니다');
  await expect(page.locator('#sum-strokes')).toHaveText('4');
  await expect(pastItems(page)).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), HISTORY_KEY)).toBeNull();
});

test('shows past rounds and saves a backup offline after the first visit', async ({ page, context }) => {
  await openRound(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await parHole(page);
  await startNewRound(page);
  await context.setOffline(true);
  await page.reload();
  await expect(pastItems(page)).toHaveCount(1);
  await pastItems(page).first().click();
  await expect(page.locator('#past .scorecard')).toHaveCount(2);
  await page.getByRole('button', { name: '닫기' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '백업 파일 저장' }).click()]);
  expect(JSON.parse(readFileSync((await download.path())!, 'utf8')).history).toHaveLength(1);
  await context.setOffline(false);
});

test('leaves the past rounds alone while holes are tapped', async ({ page }) => {
  await openRound(page);
  await parHole(page);
  await startNewRound(page);
  await page.locator('#history-list li').first().evaluate((li) => li.setAttribute('data-mark', 'kept'));
  await parHole(page);
  await tap(page, 'mulligan');
  await expect(page.locator('#history-list li[data-mark="kept"]')).toHaveCount(1);
});

test('keeps an unreadable history aside instead of overwriting it', async ({ page }) => {
  await openRound(page);
  await page.evaluate((key) => localStorage.setItem(key, '{"rounds": ['), HISTORY_KEY);
  await page.reload();
  await expect(page.locator('#history-note')).toContainText('따로 보관');
  await parHole(page);
  await startNewRound(page);
  const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  expect(Object.entries(stored).filter(([k]) => k.startsWith('fairway-note:corrupt:')).map(([, v]) => v)).toEqual(['{"rounds": [']);
  expect(JSON.parse(stored[HISTORY_KEY])).toHaveLength(1);
  await expect(page.locator('#history-note')).toBeHidden();
});

test('shows a round kept in another tab', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await openRound(first);
  // The second tab finds the round the first one started, so no picker opens there.
  await second.goto('/');
  await parHole(first);
  await startNewRound(first);
  await expect(pastItems(second)).toHaveCount(1);
  await expect(second.locator('#sum-strokes')).toHaveText('0');
});

test('shares the backup file where the browser can share files', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { sharedFiles: { name: string; type: string; text: string }[] };
    w.sharedFiles = [];
    Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: (data?: ShareData) => Boolean(data?.files?.length) });
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: async (data?: ShareData) => {
        for (const f of data?.files ?? []) w.sharedFiles.push({ name: f.name, type: f.type, text: await f.text() });
      },
    });
  });
  await openRound(page);
  await parHole(page);
  await page.getByRole('button', { name: '백업 파일 공유' }).click();
  await expect(page.locator('#backup-status')).toHaveText('백업 파일을 공유했습니다.');
  const shared = await page.evaluate(() => (window as unknown as { sharedFiles: { name: string; type: string; text: string }[] }).sharedFiles);
  expect(shared).toHaveLength(1);
  expect(shared[0].name).toMatch(/^fairway-note-backup-\d{4}-\d{2}-\d{2}\.json$/);
  expect(shared[0].type).toBe('application/json');
  expect(JSON.parse(shared[0].text)).toMatchObject({ app: 'fairway-note', format: 1, history: [], current: { version: 1 } });
});

test('offers no file sharing where the browser cannot share files', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: undefined });
  });
  await openRound(page);
  await expect(page.getByRole('button', { name: '백업 파일 저장' })).toBeVisible();
  await expect(page.locator('#backup-share')).toBeHidden();
});

for (const [width, height] of [[375, 553], [360, 640]]) {
  test.describe(`past rounds on a ${width}×${height} phone`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('lists rounds with trends and opens one, all without sideways scrolling', async ({ page }) => {
      await openRound(page);
      // 82, 84, 80, 86, 81, 83, 79 strokes on 1–7 October.
      await seedHistory(page, [10, 12, 8, 14, 9, 11, 7]);
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await expect(pastItems(page)).toHaveCount(7);
      await expect(pastItems(page).first().locator('.past-score')).toHaveText('79타 +7');
      const trendsBox = page.locator('#history-trends');
      await expect(trendsBox).toContainText('라운드7회');
      await expect(trendsBox).toContainText('평균 타수82.1 (+10.1)');
      await expect(trendsBox).toContainText('최근 5라운드81.8 (+9.8)');
      await expect(trendsBox).toContainText('그린 적중44%');
      await expect(trendsBox.locator('svg polyline')).toHaveCount(1);
      await expect(trendsBox.locator('[role="img"]')).toHaveAttribute('aria-label', '최근 7라운드 타수: 82, 84, 80, 86, 81, 83, 79');
      expect(await sideways()).toBe(0);
      for (const item of await pastItems(page).all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      // The end of the page stays clear of the hole bar.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const bar = (await page.locator('.hole-move').boundingBox())!;
      for (const name of ['백업 파일 저장', '백업 파일 가져오기']) {
        const button = (await page.getByRole('button', { name }).boundingBox())!;
        expect(button.y + button.height, name).toBeLessThanOrEqual(bar.y);
        expect(button.height, name).toBeGreaterThanOrEqual(44);
      }

      await pastItems(page).first().tap();
      const dialog = page.locator('#past');
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect([box.x, box.y]).toEqual([0, 0]);
      expect(box.width).toBeCloseTo(width, 0);
      expect(box.height).toBeCloseTo(height, 0);
      expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      // The title bar with the close button stays at the top while the round scrolls.
      await dialog.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      const close = dialog.getByRole('button', { name: '닫기' });
      const closeBox = (await close.boundingBox())!;
      expect(closeBox.y).toBeGreaterThanOrEqual(0);
      expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(80);
      expect(closeBox.height).toBeGreaterThanOrEqual(44);
      const remove = (await dialog.getByRole('button', { name: '이 라운드 지우기' }).boundingBox())!;
      expect(remove.y + remove.height).toBeLessThanOrEqual(height);
      await close.tap();
      await expect(dialog).toBeHidden();
    });
  });
}
