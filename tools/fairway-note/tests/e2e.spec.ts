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

/** One tap per stroke on a club's + or on a penalty. */
async function tap(page: Page, key: string, times = 1) {
  for (let i = 0; i < times; i++) await page.getByRole('button', { name: `${LABEL[key]} 하나 더하기` }).click();
}

const count = (page: Page, key: string) => page.locator(`#count-${key}`);
const tab = (page: Page, name: '기록' | '스코어카드') => page.getByRole('tab', { name });
const next = (page: Page) => page.locator('#go-next');
const sideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);

async function showCard(page: Page) {
  await tab(page, '스코어카드').click();
  await expect(page.locator('#card-view')).toBeVisible();
}

async function showEntry(page: Page) {
  await tab(page, '기록').click();
  await expect(page.locator('#entry')).toBeVisible();
}

async function menu(page: Page) {
  await page.getByRole('button', { name: '메뉴' }).click();
  await expect(page.locator('#menu')).toBeVisible();
}

const oldRound = (holes: Record<number, Record<string, number>>, extra: Record<string, unknown> = {}) => {
  const list = Array.from({ length: 18 }, (_, i) => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0, ...holes[i] }));
  return JSON.stringify({ version: 1, date: '2026-01-01', current: 1, holes: list, ...extra });
};

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
  await expect(page.locator('#hole-strokes')).toHaveText('–');
  await expect(page.locator('#hole-name')).toHaveText('기록 전');

  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await expect(count(page, 'driver')).toHaveText('1');
  await expect(count(page, 'putts')).toHaveText('2');
  await expect(page.locator('#hole-strokes')).toHaveText('4');
  await expect(page.locator('#hole-name')).toHaveText('파');

  await next(page).click();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
  await tap(page, 'driver', 2);
  await tap(page, 'ob');
  await tap(page, 'approach');
  await tap(page, 'putts', 3);
  await page.getByRole('button', { name: '퍼터 하나 빼기' }).click();
  await expect(page.locator('#hole-strokes')).toHaveText('6');
  await expect(page.locator('#hole-name')).toHaveText('더블 보기');

  await next(page).click();
  await expect(page.locator('#hole-par')).toHaveText('Par 5');
  await tap(page, 'driver');
  await tap(page, 'approach', 2);
  await tap(page, 'putts');
  await expect(page.locator('#hole-name')).toHaveText('버디');

  await showCard(page);
  await expect(page.locator('#sum-strokes')).toHaveText('14');
  await expect(page.locator('#sum-topar')).toHaveText('+1');
  await expect(page.locator('#sum-putts')).toHaveText('5');
  await expect(page.locator('#sum-ob')).toHaveText('1');
  await expect(page.locator('#tot-holes')).toHaveText('3홀');
  await expect(page.locator('#scorecard [data-hole="1"] .m')).toHaveAttribute('data-mark', 'double');

  expect(requests).toEqual([]);
  expect(await page.evaluate(() => ({ keys: Object.keys(localStorage).sort(), sessionStorage: sessionStorage.length, cookies: document.cookie })))
    .toEqual({ keys: [PREFS_KEY, STORAGE_KEY].sort(), sessionStorage: 0, cookies: '' });
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
});

test('shows the hole score in the badge with its scorecard mark, red under par', async ({ page }) => {
  await open(page);
  const mark = page.locator('#bmark');
  const badge = page.locator('#badge');
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await expect(mark).toHaveAttribute('data-mark', 'par');
  await expect(badge).toHaveAttribute('data-tone', 'par');
  await tap(page, 'approach');
  await expect(mark).toHaveAttribute('data-mark', 'bogey');
  await expect(page.locator('#hole-name')).toHaveText('보기');
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '어프로치 하나 빼기' }).click();
  await expect(page.locator('#hole-strokes')).toHaveText('3');
  await expect(mark).toHaveAttribute('data-mark', 'birdie');
  expect(await badge.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(192, 57, 43)');
  await page.getByRole('button', { name: '퍼터 하나 빼기' }).click();
  await expect(mark).toHaveAttribute('data-mark', 'eagle');
  await expect(page.locator('#hole-name')).toHaveText('이글');
  await expect(badge).toHaveAttribute('aria-label', '이 홀 2타, 이글');
});

test('adds a penalty stroke for each OB or hazard and takes the last one off with 빼기', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: 'OB 하나 빼기' })).toHaveCount(0);
  await tap(page, 'driver');
  await tap(page, 'ob');
  await expect(page.locator('#stake-ob .pen-count')).toHaveText('1');
  await expect(page.locator('#hole-strokes')).toHaveText('2');
  await tap(page, 'hazard', 2);
  await expect(page.locator('#hole-strokes')).toHaveText('4');
  await page.getByRole('button', { name: '해저드 하나 빼기' }).click();
  await expect(page.locator('#stake-hazard .pen-count')).toHaveText('1');
  await page.getByRole('button', { name: '해저드 하나 빼기' }).click();
  // Then the OB added before them.
  await page.getByRole('button', { name: 'OB 하나 빼기' }).click();
  await expect(page.locator('#hole-strokes')).toHaveText('1');
  await tap(page, 'hazard');
  await tap(page, 'putts');
  await next(page).click();
  expect((await stored(page)).holes[0]).toEqual({ par: 4, driver: 1, approach: 0, putts: 1, ob: 0, hazard: 1, mulligan: 0 });
  await showCard(page);
  await expect(page.locator('#sum-hazard')).toHaveText('1');
  await expect(page.locator('#analysis')).toContainText('해저드 1회로 벌타 1타가 더해졌습니다');
});

test('records the tee shot on the 상세 pad as the first drive’s detail', async ({ page }) => {
  await open(page);
  await expect(page.locator('#detail')).toBeHidden();
  await page.getByRole('button', { name: '상세', exact: true }).click();
  await expect(page.getByRole('button', { name: '상세', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#tee-val')).toHaveText('선택 안 함');
  // A tee result with no drive counted yet counts the tee shot.
  await page.getByRole('button', { name: '우', exact: true }).click();
  await expect(count(page, 'driver')).toHaveText('1');
  await expect(page.locator('#tee-val')).toHaveText('우');
  await expect(page.getByRole('button', { name: '우', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '많이 우' }).click();
  await expect(page.locator('#tee-val')).toHaveText('많이 우');
  await expect(page.getByRole('button', { name: '우', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '뒤땅/토핑' }).click();
  await expect(page.locator('#tee-val')).toHaveText('뒤땅/토핑');
  await page.getByRole('button', { name: '뒤땅/토핑' }).click();
  await expect(page.locator('#tee-val')).toHaveText('선택 안 함');
  await expect(count(page, 'driver')).toHaveText('1');
  await page.getByRole('button', { name: '페어웨이' }).click();
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  expect((await stored(page)).holes[0].tags).toEqual({ driver: ['fairway'] });
  // The penalties stay under the pad in 상세.
  await tap(page, 'ob');
  await expect(page.locator('#undo-detail')).toHaveText('OB 빼기');
  await next(page).click();
  await next(page).click();
  await next(page).click();
  await expect(page.locator('#hole-par')).toHaveText('Par 3');
  await expect(page.getByRole('button', { name: '온그린' })).toBeVisible();
  await showCard(page);
  const body = new URL(await page.locator('#send-email').getAttribute('href') as string).searchParams.get('body')!;
  expect(body).toContain('1번 Par4: 5타 (+1) 드1 어1 퍼2 OB 1 · 드 페어웨이');
  await expect(page.locator('#analysis .details')).toContainText('티샷: 페어웨이 1');
});

test('switches between 스코어카드 and 기록 with the tabs and arrow keys', async ({ page }) => {
  await open(page);
  const card = tab(page, '스코어카드');
  const entry = tab(page, '기록');
  await expect(entry).toHaveAttribute('aria-selected', 'true');
  await expect(card).toHaveAttribute('aria-controls', 'card-view');
  await expect(page.locator('#card-view')).toBeHidden();
  await card.click();
  await expect(page.locator('#entry')).toBeHidden();
  await expect(page.locator('#analysis')).toBeVisible();
  await card.focus();
  await page.keyboard.press('ArrowRight');
  await expect(entry).toBeFocused();
  await expect(page.locator('#entry')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(card).toBeFocused();
  await expect(page.locator('#card-view')).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.locator('#entry')).toBeVisible();
  await expect(card).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#app-version')).toHaveText('v4');
});

test('opens a hole from the scorecard in 기록, and shows the current one', async ({ page }) => {
  await open(page);
  await showCard(page);
  await expect(page.locator('#scorecard [data-hole="0"]')).toHaveAttribute('aria-current', 'true');
  await page.locator('#scorecard [data-hole="11"]').click();
  await expect(page.locator('#entry')).toBeVisible();
  await expect(page.locator('#hole-title')).toHaveText('12번 홀');
  await showCard(page);
  await expect(page.locator('#scorecard [data-hole="11"]')).toHaveAttribute('aria-current', 'true');
});

test('changes the hole’s par from the menu, which also holds mulligans and the version', async ({ page }) => {
  await open(page);
  await menu(page);
  await expect(page.locator('#menu-version')).toHaveText('v4');
  await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·레이크');
  await page.getByRole('button', { name: '멀리건 하나 더하기' }).click();
  await expect(page.locator('#mulligan-count')).toHaveText('1');
  await page.locator('#par-open').click();
  const dialog = page.locator('#par-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Par 4' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Par 3' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#hole-par')).toHaveText('Par 3');
  // A mulligan alone does not record the hole.
  await expect(page.locator('#hole-name')).toHaveText('기록 전');
  await showCard(page);
  await expect(page.locator('#scorecard .col[data-hole] .pr').first()).toHaveText('3');
  await expect(page.locator('#analysis')).toContainText('홀을 기록하면');
});

test('draws the hole behind the screen by its par, new for each hole', async ({ page }) => {
  await open(page);
  const course = page.locator('#course');
  await expect(course.locator('.fairway')).toHaveCount(1);
  await expect(course.locator('.flag')).toHaveCount(1);
  const greenD = async () => course.locator('.green').getAttribute('d');
  const first = await greenD();
  await page.getByRole('button', { name: '다음 홀로 이동' }).click();
  expect(await greenD()).not.toBe(first);
  await page.getByRole('button', { name: '다음 홀로 이동' }).click();
  await page.getByRole('button', { name: '다음 홀로 이동' }).click();
  await expect(page.locator('#hole-par')).toHaveText('Par 3');
  await expect(course.locator('.fairway')).toHaveCount(0);
  await expect(page.locator('#hole-distance')).toBeHidden();
  await expect(page.getByRole('link', { name: /공식 홀 안내/ })).toHaveCount(0);
});

test.describe('with hole notes in the course data', () => {
  // The bundle has no hole notes yet, so this test adds some for Everis 새별 holes 1 and 2 to the served script.
  test.use({ serviceWorkers: 'block', viewport: { width: 375, height: 667 } });

  test('shows the length, handicap, layout note and official guide link, and bends a dogleg', async ({ page }) => {
    const q = '["\'`]';
    const key = (k: string) => `${q}?${k}${q}?`;
    const nine = new RegExp(`(${key('id')}:${q}saebyul${q},${key('name')}:\\{${key('ko')}:${q}새별${q},${key('en')}:null\\},${key('par')}:\\[4,4,5,3,4,4,3,5,4\\])`);
    const notes = ',"holes":[{"distances":[{"tee":"화이트","length":352,"unit":"m"}],"layout":"우 도그렉","guideUrl":"https://example.test/everis/saebyul/1","si":5},{"distances":[{"length":376,"unit":"m"}]}]';
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
    await expect(page.locator('#hole-si')).toHaveText('HDCP 5');
    await expect(page.locator('#hole-layout')).toHaveText('우 도그렉');
    const guide = page.getByRole('link', { name: /공식 홀 안내/ });
    await expect(guide).toHaveAttribute('href', 'https://example.test/everis/saebyul/1');
    await expect(guide).toHaveAttribute('rel', 'noopener noreferrer');
    const straight = await page.evaluate(() => innerWidth * 0.47);
    const box = (await page.locator('#course .green').boundingBox())!;
    expect(box.x + box.width / 2).toBeGreaterThan(straight);
    await page.getByRole('button', { name: '다음 홀로 이동' }).click();
    // A length with no tee name.
    await expect(page.locator('#hole-distance')).toHaveText('376m');
    await expect(page.locator('#hole-si')).toBeHidden();
    await expect(guide).toHaveCount(0);
  });
});

test('keeps the round after reload and starts a new one on request', async ({ page }) => {
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await showCard(page);
  await page.locator('#scorecard [data-hole="4"]').click();
  await page.reload();
  await expect(page.locator('#hole-title')).toHaveText('5번 홀');
  await expect(page.locator('#sum-strokes')).toHaveText('3');

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
  await expect(page.locator('#entry')).toBeVisible();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  await expect(page.locator('#sum-strokes')).toHaveText('0');
});

test('ignores a broken saved round and keeps a newer one aside instead of overwriting it', async ({ page }) => {
  await open(page);
  await page.evaluate((key) => localStorage.setItem(key, '{"version":1,"holes":"x"}'), STORAGE_KEY);
  await page.reload();
  await expect(page.locator('#hole-strokes')).toHaveText('–');
  const future = JSON.stringify({ version: 2, note: 'saved by a newer version' });
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, future]);
  await page.reload();
  await expect(page.locator('#notice')).toContainText('따로 보관');
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(future);
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await tap(page, 'driver');
  const all = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  expect(Object.entries(all).filter(([k]) => k.startsWith('fairway-note:corrupt:')).map(([, v]) => v)).toContain(future);
  expect(JSON.parse(all[STORAGE_KEY]).holes[0].driver).toBe(1);
  await expect(page.locator('#notice')).toBeHidden();
});

test('does not save anything just by opening the page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#picker')).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key) !== null, STORAGE_KEY)).toBe(true);
});

test('moves between holes, stops at the ends and ends the round on the last hole', async ({ page }) => {
  await open(page);
  await expect(page.locator('#prev-hole')).toBeDisabled();
  await page.locator('#next-hole').click();
  await page.locator('#prev-hole').click();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  await expect(page.locator('#hole-strokes')).toHaveText('–');
  await showCard(page);
  await page.locator('#scorecard [data-hole="17"]').click();
  await expect(page.locator('#next-hole')).toBeDisabled();
  await expect(page.getByRole('button', { name: '드라이버 하나 빼기' })).toBeDisabled();
  await expect(next(page)).toHaveText('라운드 마치기');
  await next(page).click();
  await expect(page.locator('#card-view')).toBeVisible();
});

test('keeps a hole in progress out of the score until it is putted, and counts a chip-in once the player moves on', async ({ page }) => {
  await open(page);
  await tap(page, 'driver');
  await expect(page.locator('#hole-strokes')).toHaveText('1');
  await expect(page.locator('#hole-name')).toHaveText('진행 중');
  await expect(page.locator('#bmark')).toHaveAttribute('data-mark', 'none');
  await expect(page.locator('#sum-strokes')).toHaveText('0');
  await tap(page, 'approach', 2);
  await next(page).click();
  await expect(page.locator('#sum-strokes')).toHaveText('3');
  await expect(page.locator('#sum-topar')).toHaveText('−1');
});

test('stops counting at 15 and announces taps in one live region', async ({ page }) => {
  await open(page);
  await expect(page.locator('[aria-live]')).toHaveCount(1);
  await tap(page, 'putts');
  await expect(page.locator('#announce')).toHaveText('1번 홀 퍼터 1, 1타');
  await tap(page, 'hazard');
  await expect(page.locator('#announce')).toHaveText('1번 홀 해저드 1, 2타');
  await tap(page, 'approach', 15);
  await expect(count(page, 'approach')).toHaveText('15');
  await expect(page.getByRole('button', { name: '어프로치 하나 더하기' })).toBeDisabled();
  await next(page).click();
  await expect(page.locator('#announce')).toHaveText('2번 홀, Par 4');
});

test('says so on 기록 when the round cannot be saved', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('denied', 'SecurityError'); };
  });
  await open(page);
  await tap(page, 'driver');
  await expect(page.locator('#notice')).toContainText('저장할 수 없습니다');
  await expect(page.locator('#hole-strokes')).toHaveText('1');
});

test('offers to continue or replace a round from an earlier day, and asks before replacing it', async ({ page }) => {
  await open(page);
  await page.evaluate(([key, v]) => localStorage.setItem(key, v), [STORAGE_KEY, oldRound({ 0: { driver: 1, approach: 1, putts: 2 } })]);
  await page.reload();
  await expect(page.locator('#stale')).toBeVisible();
  await expect(page.locator('#stale-text')).toContainText('2026년 1월 1일');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#stale-new').click();
  await expect(page.locator('#sum-strokes')).toHaveText('4');
  await page.locator('#stale-keep').click();
  await expect(page.locator('#stale')).toBeHidden();
  await page.reload();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
  await expect(page.locator('#stale')).toBeHidden();
});

test('keeps a round that crosses midnight without the earlier-day banner', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 19, 23, 40) });
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await next(page).click();
  await page.clock.setSystemTime(new Date(2026, 10, 20, 0, 20));
  await page.reload();
  await expect(page.locator('#stale')).toBeHidden();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
  await page.clock.setSystemTime(new Date(2026, 10, 20, 12, 30));
  await page.reload();
  await expect(page.locator('#stale')).toBeVisible();
});

test('follows a round saved in another tab, and keeps its own when the other tab removes it', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('/');
  await second.goto('/');
  await first.getByRole('button', { name: '이 코스로 시작' }).click();
  await expect(second.locator('#picker')).toBeHidden();
  await tap(first, 'driver');
  await tap(first, 'putts', 2);
  await expect(second.locator('#hole-strokes')).toHaveText('3');
  await first.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await expect(second.locator('#notice')).toContainText('다음 입력 때 다시 저장');
  await next(second).click();
  expect((await stored(second)).holes[0]).toMatchObject({ driver: 1, putts: 2 });
  await expect(second.locator('#notice')).toBeHidden();
});

for (const [width, height] of [[375, 553], [375, 667]]) {
  test.describe(`on a ${width}×${height} phone`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('shows the whole 기록 screen without any scrolling, with clear counts and large targets', async ({ page }) => {
      await open(page);
      const check = async () => {
        expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0);
        expect(await page.locator('#sheet').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
        expect(await sideScroll(page)).toBe(0);
        const tabs = (await page.locator('#views').boundingBox())!;
        expect(tabs.y + tabs.height).toBeCloseTo(height, 0);
        expect(tabs.height).toBeGreaterThanOrEqual(56);
        const go = (await next(page).boundingBox())!;
        expect(go.y + go.height).toBeLessThanOrEqual(tabs.y);
        for (const selector of ['#prev-hole', '#next-hole', '.home-link', '#stake-ob', '#stake-hazard', ...['driver', 'approach', 'putts'].flatMap((k) => [`.club-${k} .plus`, `.club-${k} .minus`])]) {
          const box = (await page.locator(selector).first().boundingBox())!;
          expect(box.y + box.height, selector).toBeLessThanOrEqual(go.y);
          expect(box.height, selector).toBeGreaterThanOrEqual(48);
          expect(box.width, selector).toBeGreaterThanOrEqual(48);
        }
        // The count keeps at least 8px clear of the round + and −.
        for (const key of ['driver', 'approach', 'putts']) {
          const [plus, n, minus] = await Promise.all([`.club-${key} .plus span`, `#count-${key}`, `.club-${key} .minus span`].map(async (s) => (await page.locator(s).boundingBox())!));
          expect(n.y - (plus.y + plus.height), key).toBeGreaterThanOrEqual(8);
          expect(minus.y - (n.y + n.height), key).toBeGreaterThanOrEqual(8);
        }
      };
      await check();
      await next(page).tap();
      await expect(page.locator('#hole-title')).toHaveText('2번 홀');
      await page.locator('#stake-ob').tap();
      await page.locator('.club-driver .plus').tap();
      await check();
    });

    test('scrolls the scorecard inside its view, clear of the tab bar', async ({ page }) => {
      await open(page);
      await tab(page, '스코어카드').tap();
      await page.locator('#card-view').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      const tabs = (await page.locator('#views').boundingBox())!;
      const button = (await page.locator('#new-round').boundingBox())!;
      expect(button.y + button.height).toBeLessThanOrEqual(tabs.y);
      expect(await sideScroll(page)).toBe(0);
      await expect(page.locator('.home-link')).toBeVisible();
    });
  });
}

test('keeps every control within 360px in both views and both modes, with the link back to the site', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page);
  await expect(page).toHaveTitle('Fairway Note');
  const home = page.locator('a.home-link');
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute('href', '../../');
  await tap(page, 'driver');
  await tap(page, 'ob');
  expect(await sideScroll(page)).toBe(0);
  await page.getByRole('button', { name: '상세', exact: true }).click();
  expect(await sideScroll(page)).toBe(0);
  const pad = (await page.locator('#pad').boundingBox())!;
  expect(pad.x).toBeGreaterThanOrEqual(0);
  expect(pad.x + pad.width).toBeLessThanOrEqual(360);
  await showCard(page);
  await expect(home).toBeVisible();
  expect(await sideScroll(page)).toBe(0);
});

test('labels are large and dark enough to read in sunlight, and a disabled minus is not just faded', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts');
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
  const checks = await measure(['.club-lbl', '#hole-par', '#hole-name', '.pen-lbl', '.mode', '.tab-label', '.ver']);
  await showCard(page);
  checks.push(...await measure(['.sum dt', '.rowlbl span', '.col .pr', '.nine-h span', '.metrics dt']));
  for (const { selector, size, contrast } of checks) {
    expect(size, selector).toBeGreaterThanOrEqual(13);
    expect(contrast, selector).toBeGreaterThanOrEqual(4.5);
  }
  await showEntry(page);
  const look = (selector: string) => page.locator(selector).evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, opacity: getComputedStyle(el).opacity }));
  const on = await look('.club-driver .minus span');
  const off = await look('.club-approach .minus span');
  expect(on.background).not.toBe(off.background);
  expect(on.color).not.toBe(off.color);
  expect(off.opacity).toBe('1');
});

test('keeps the screen on while recording when the browser allows it, and works without it', async ({ page }) => {
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
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, value: { request: async () => { throw new DOMException('no', 'NotAllowedError'); } } });
  });
  await page.reload();
  await tap(page, 'driver');
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

test('sends the round by email, shares it, or copies it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
  });
  await open(page);
  await showCard(page);
  await expect(page.locator('#send-actions')).toBeHidden();
  await showEntry(page);
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await showCard(page);
  const url = new URL((await page.getByRole('link', { name: '이메일로 보내기' }).getAttribute('href'))!);
  expect(url.protocol).toBe('mailto:');
  expect(url.searchParams.get('subject')).toMatch(/^에버리스 골프리조트 새별·레이크 \d{4}년 \d{1,2}월 \d{1,2}일 라운드 4타 \(E\)$/);
  expect(url.searchParams.get('body')).toContain('1번 Par4: 4타 (E) 드1 어1 퍼2');
  await page.getByRole('button', { name: '결과 복사' }).click();
  await expect(page.locator('#send-status')).toContainText('복사했습니다');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('1번 Par4: 4타 (E)');
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
  expect(shared[0].title).toContain('3타 (-1)');
});

test('opens and records offline after the first visit', async ({ page, context }) => {
  await open(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  // The stylesheet and the drawn course came from the cache too.
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.clubs')!).display)).toBe('grid');
  await expect(page.locator('#course .green')).toHaveCount(1);
  await tap(page, 'driver');
  await tap(page, 'hazard');
  await tap(page, 'putts', 2);
  await expect(page.locator('#hole-strokes')).toHaveText('4');
  await context.setOffline(false);
});

test('precaches every built file under the tool path', async ({ request }) => {
  const source = await (await request.get('sw.js')).text();
  for (const file of ['index.html', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) expect(source).toContain(`"${file}"`);
  expect(source).toMatch(/"assets\/[^"]+\.js"/);
  expect(source).toMatch(/"assets\/[^"]+\.css"/);
  expect(source).not.toMatch(/"\//);
  expect(source).not.toContain('design/');
});

test('offers to reopen when a new version is waiting', async ({ page }) => {
  // The next deploy is the same ./sw.js URL with different bytes; the built file is changed in place and restored.
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
    await tap(page, 'putts');
    await expect(page.locator('#hole-strokes')).toHaveText('2');
    const reloaded = page.waitForEvent('load');
    await prompt.click();
    await reloaded;
    await expect(page.locator('#hole-strokes')).toHaveText('2');
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
  await expect(page.locator('#notice')).toContainText('세부 기록 일부');
  await tap(page, 'driver');
  const all = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  expect(Object.entries(all).filter(([k]) => k.startsWith('fairway-note:corrupt:')).map(([, v]) => v)).toEqual([value]);
  expect(JSON.parse(all[STORAGE_KEY]).holes[0].tags).toEqual({ putts: [null, 'in'] });
});

test.describe('course picker', () => {
  test.use({ viewport: { width: 375, height: 553 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('offers the remembered course first and starts it with one tap', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#picker')).toBeVisible();
    await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트 새별·레이크');
    await expect(page.getByRole('button', { name: '이 코스로 시작' })).toBeFocused();
    const start = (await page.getByRole('button', { name: '이 코스로 시작' }).boundingBox())!;
    expect(start.y + start.height).toBeLessThanOrEqual(553);
    expect(await sideScroll(page)).toBe(0);
    await page.locator('#picker-chosen').getByRole('radio', { name: '파인' }).nth(1).tap();
    await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트 새별·파인');
    await page.getByRole('button', { name: '이 코스로 시작' }).tap();
    await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·파인');
    const pars = await page.locator('#scorecard .col[data-hole] .pr').allTextContents();
    expect(pars.slice(9, 18)).toEqual(['4', '4', '4', '5', '3', '4', '4', '3', '5']);
    await expect(page.locator('#par-source a')).toHaveText('공식 스코어카드');
    await page.reload();
    await expect(page.locator('#picker')).toBeHidden();
    await tab(page, '스코어카드').tap();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#new-round').tap();
    await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트 새별·파인');
  });

  test('finds a course by initial consonants and area, and swaps the nines', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '제주', exact: true }).tap();
    const regions = await page.locator('#picker-list .course:not(.custom) span').allTextContents();
    expect(regions.every((r) => r.startsWith('제주 '))).toBe(true);
    await page.getByRole('searchbox', { name: '골프장 검색' }).fill('ㅌㄷ');
    await page.locator('#picker-list button', { hasText: '테디밸리' }).tap();
    await page.getByRole('button', { name: '전·후반 바꾸기' }).tap();
    await page.getByRole('button', { name: '이 코스로 시작' }).tap();
    await expect(page.locator('#course-name')).toHaveText('테디밸리 골프앤리조트 밸리·테디');
  });

  test('starts an unlisted course with its name and par 4 on every hole', async ({ page }) => {
    await page.goto('/');
    await page.locator('#picker-list button', { hasText: '직접 입력' }).tap();
    await page.getByRole('textbox', { name: '골프장 이름' }).fill('동네 골프장');
    await page.getByRole('button', { name: '이 코스로 시작' }).tap();
    await expect(page.locator('#course-name')).toHaveText('동네 골프장');
    expect(new Set(await page.locator('#scorecard .col[data-hole] .pr').allTextContents())).toEqual(new Set(['4']));
    await expect(page.locator('#par-source')).toContainText('Par 4로 시작');
  });
});

test('keeps the pars of a round saved before courses could be chosen', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(([key, v]) => localStorage.setItem(key, v), [STORAGE_KEY, oldRound({ 0: { par: 3, driver: 1, putts: 2 } }, { date: '2026-11-19', lastEdited: Date.now() })]);
  await page.reload();
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·레이크');
  expect((await page.locator('#scorecard .col[data-hole] .pr').allTextContents()).slice(0, 3)).toEqual(['3', '4', '4']);
  await expect(page.locator('#sum-strokes')).toHaveText('3');
});
