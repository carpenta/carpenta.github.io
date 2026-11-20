import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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
const tab = (page: Page, name: '기록' | '스코어카드' | '지난 라운드') => page.getByRole('tab', { name });
const next = (page: Page) => page.locator('#go-next');
const sideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);

async function showCard(page: Page) {
  await tab(page, '스코어카드').click();
  await expect(page.locator('#card-view')).toBeVisible();
}

/** Opens hole `index` from 스코어카드: its nine's table opens the hole strip in 기록, and the hole's cell opens it. */
async function pickHole(page: Page, index: number) {
  await showCard(page);
  await page.locator(`#scorecard .nine-tbl[data-nine="${index < 9 ? 0 : 9}"]`).click();
  await expect(page.locator('#strip')).toBeVisible();
  await page.locator(`#strip [data-jump="${index}"]`).click();
  await expect(page.locator('#strip')).toBeHidden();
}

async function showEntry(page: Page) {
  await tab(page, '기록').click();
  await expect(page.locator('#entry')).toBeVisible();
}

/** Opens the menu, and one of its items when given (새 라운드, 결과 보내기, 백업과 복원, 이 홀 멀리건 …). */
async function menu(page: Page, item?: string) {
  await page.getByRole('button', { name: '메뉴' }).click();
  await expect(page.locator('#menu')).toBeVisible();
  if (item) {
    await page.locator('#menu .mi', { hasText: item }).click();
    await expect(page.locator('#menu .mi', { hasText: item })).toHaveAttribute('aria-expanded', 'true');
  }
}

async function closeMenu(page: Page) {
  await page.locator('#menu-close').click();
  await expect(page.locator('#menu')).toBeHidden();
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
  await expectQuiet(page, 4);
  // The progress chips ("1홀", "이븐") show once a hole is finished.
  await expect(page.locator('#prog-n')).toBeHidden();
  await expect(page.locator('#prog-p')).toBeHidden();

  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await expect(count(page, 'driver')).toHaveText('1');
  await expect(count(page, 'putts')).toHaveText('2');
  await expect(page.locator('#hole-strokes')).toHaveText('4');
  await expect(page.locator('#hole-name')).toHaveText('파');
  await expect(page.locator('#prog-n')).toHaveText('1홀까지');
  await expect(page.locator('#prog-p')).toHaveText('파 대비 이븐');

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
  await expect(page.locator('#prog-n')).toHaveText('3홀까지');
  await expect(page.locator('#prog-p')).toHaveText('파 대비 +1');
  await expect(page.locator('#prog-p')).not.toHaveClass(/under/);

  await showCard(page);
  await expect(page.locator('#sum-strokes')).toHaveText('14');
  await expect(page.locator('#sum-topar')).toHaveText('+1');
  await expect(page.locator('#sum-putts')).toHaveText('5');
  await expect(page.locator('#sum-ob')).toHaveText('1');
  await expect(page.locator('#tot-holes')).toHaveText('3홀');
  await expect(page.locator('#scorecard .r-s [data-col="1"] .m')).toHaveAttribute('data-mark', 'double');

  expect(requests).toEqual([]);
  expect(await page.evaluate(() => ({ keys: Object.keys(localStorage).sort(), sessionStorage: sessionStorage.length, cookies: document.cookie })))
    .toEqual({ keys: [PREFS_KEY, STORAGE_KEY].sort(), sessionStorage: 0, cookies: '' });
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
});

test('shows the hole score in the badge with its scorecard mark, red under par, and marks a birdie once', async ({ page }) => {
  await open(page);
  const mark = page.locator('#bmark');
  const shape = page.locator('#bm');
  const badge = page.locator('#badge');
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await expect(mark).toHaveAttribute('data-mark', 'par');
  await expect(badge).toHaveAttribute('data-tone', 'par');
  await expect(shape.locator('*')).toHaveCount(0);
  await tap(page, 'approach');
  await expect(mark).toHaveAttribute('data-mark', 'bogey');
  await expect(shape.locator('rect')).toHaveCount(1);
  await expect(page.locator('#hole-name')).toHaveText('보기');
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '어프로치 하나 빼기' }).click();
  await expect(page.locator('#hole-strokes')).toHaveText('3');
  await expect(mark).toHaveAttribute('data-mark', 'birdie');
  await expect(shape.locator('circle')).toHaveCount(1);
  await expect(badge).toHaveClass(/celebrate/);
  expect(await badge.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(192, 57, 43)');
  await page.getByRole('button', { name: '퍼터 하나 빼기' }).click();
  await expect(mark).toHaveAttribute('data-mark', 'eagle');
  await expect(shape.locator('circle')).toHaveCount(2);
  await expect(page.locator('#hole-name')).toHaveText('이글');
  await expect(badge).toHaveAttribute('aria-label', '이 홀 2타 이글');
  // Back to par and under again: the moment plays again.
  await tap(page, 'putts', 2);
  await expect(badge).toHaveClass(/settle/);
  await page.getByRole('button', { name: '퍼터 하나 빼기' }).click();
  await expect(mark).toHaveAttribute('data-mark', 'birdie');
  await expect(badge).toHaveClass(/celebrate/);
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
  expect((await stored(page)).holes[0]).toEqual({ par: 4, driver: 1, approach: 0, putts: 1, ob: 0, hazard: 1, mulligan: 0, bunker: 0 });
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
  await page.getByRole('button', { name: '김', exact: true }).click();
  await expect(page.locator('#tee-val')).toHaveText('김');
  // One 미스샷 chip steps 헛스윙 → 뒤땅/토핑 → none.
  const miss = page.locator('#tee-miss');
  await expect(miss).toHaveText('미스샷');
  await miss.click();
  await expect(miss).toHaveText('헛스윙');
  await expect(miss).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#tee-val')).toHaveText('헛스윙');
  await miss.click();
  await expect(miss).toHaveText('뒤땅/토핑');
  await expect(page.locator('#tee-val')).toHaveText('뒤땅/토핑');
  await miss.click();
  await expect(miss).toHaveText('미스샷');
  await expect(miss).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#tee-val')).toHaveText('선택 안 함');
  await expect(count(page, 'driver')).toHaveText('1');
  await page.getByRole('button', { name: '페어웨이' }).click();
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  expect((await stored(page)).holes[0].tags).toEqual({ driver: ['fairway'] });
  // The penalties stay under the pad in 상세, with the same 빼기.
  await tap(page, 'ob');
  await expect(page.locator('#pen-undo')).toHaveText('OB 빼기');
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
  await expect(page.locator('#hist-view')).toBeVisible();
  await expect(tab(page, '지난 라운드')).toBeFocused();
  // The arrows go round the three tabs.
  await page.keyboard.press('ArrowRight');
  await expect(card).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#hist-view')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#entry')).toBeVisible();
  await expect(card).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#app-version')).toHaveText('v18');
});

test('opens a hole from the scorecard in 기록, and shows the current one', async ({ page }) => {
  await open(page);
  await showCard(page);
  // Nothing recorded: a first-run line with a way to the hole, and blank cells, not dashes.
  await expect(page.locator('#sh-empty')).toBeVisible();
  await expect(page.locator('#sc-hero')).toBeHidden();
  await expect(page.locator('#scorecard .r-s [data-col="0"]')).toHaveText('');
  await expect(page.locator('#scorecard .r-h [data-col="0"]')).toHaveClass(/cur/);
  // Each nine is one button: it opens the hole strip in 기록 at that nine.
  const back = page.getByRole('button', { name: /^레이크 후반, 기록 없음\. 눌러서 홀 고르기$/ });
  await back.click();
  await expect(page.locator('#entry')).toBeVisible();
  await expect(page.locator('#strip')).toBeVisible();
  await expect(page.locator('#strip [data-jump="9"]')).toBeFocused();
  await page.locator('#strip [data-jump="11"]').click();
  await expect(page.locator('#hole-title')).toHaveText('12번 홀');
  await showCard(page);
  await expect(page.locator('#scorecard .r-h [data-col="11"]')).toHaveClass(/cur/);
  await expect(page.locator('#scorecard .r-h [data-col="0"]')).not.toHaveClass(/cur/);
  await page.getByRole('button', { name: '12번 홀 기록하기' }).click();
  await expect(page.locator('#entry')).toBeVisible();
  // Once a hole is finished the hero shows the round so far.
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await next(page).click();
  await showCard(page);
  await expect(page.locator('#sc-hero')).toBeVisible();
  await expect(page.locator('#sh-sub')).toHaveText('18홀 중 1홀 기록');
});

test('keeps mulligans, the course and the version in the menu, one panel open at a time', async ({ page }) => {
  await open(page);
  await menu(page);
  await expect(page.locator('#menu-version')).toHaveText('v18');
  await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·레이크');
  // Every item is a 48px button that opens its own panel and closes the one open before.
  for (const item of await page.locator('#menu .mi').all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await page.locator('#menu .mi', { hasText: '앱 정보' }).click();
  await expect(page.locator('#mp-about')).toContainText('Fairway Note v18');
  await page.locator('#menu .mi', { hasText: '이 홀 멀리건' }).click();
  await expect(page.locator('#mp-about')).toBeHidden();
  await page.getByRole('button', { name: '멀리건 하나 더하기' }).click();
  await expect(page.locator('#mulligan-count')).toHaveText('1');
  await expect(page.locator('#mulligan-sub')).toHaveText('1번 홀 1개, 타수에 넣지 않아요');
  await closeMenu(page);
  // A mulligan alone does not record the hole.
  await expect(page.locator('#badge')).toHaveAttribute('data-tone', 'none');
  expect((await stored(page)).holes[0].mulligan).toBe(1);
});

test('changes pars in 파 수정 on the scorecard, one tap per step from 3 to 5', async ({ page }) => {
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await showCard(page);
  const edit = page.getByRole('button', { name: '파 수정' });
  await edit.click();
  await expect(page.locator('#edit-hint')).toBeVisible();
  await expect(page.getByRole('button', { name: '완료' })).toBeVisible();
  // While editing the columns do not open holes; each par is a 48px button.
  await expect(page.locator('#scorecard button[data-hole]')).toHaveCount(0);
  const first = page.locator('#scorecard button[data-par-hole="0"]');
  await expect(page.locator('#scorecard button[data-par-hole]')).toHaveCount(18);
  const box = (await first.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(48);
  expect(box.width).toBeGreaterThanOrEqual(48);
  await first.click();
  await expect(first).toHaveText('5');
  await expect(first).toHaveClass(/changed/);
  await expect(first).toBeFocused();
  await expect(page.locator('#announce')).toHaveText('1번 홀 Par 5');
  // 3 strokes on a par 5 is an eagle now.
  await expect(page.locator('#scorecard .col').first().locator('.m')).toHaveAttribute('data-mark', 'eagle');
  await first.click();
  await expect(first).toHaveText('3');
  await first.click();
  await expect(first).toHaveText('4');
  await expect(first).not.toHaveClass(/changed/);
  await first.click();
  await first.click();
  await expect(first).toHaveText('3');
  await page.getByRole('button', { name: '완료' }).click();
  await expect(page.locator('#edit-hint')).toBeHidden();
  await expect(page.locator('#scorecard .r-p [data-col="0"]')).toHaveText('3');
  expect((await stored(page)).holes[0].par).toBe(3);
  await showEntry(page);
  await expect(page.locator('#hole-par')).toHaveText('Par 3');
  await expect(page.locator('#hole-name')).toHaveText('파');
});

test('moves the round to another course from the menu, keeping its strokes', async ({ page }) => {
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await menu(page, '코스 바꾸기');
  await page.getByRole('button', { name: '다른 코스 고르기' }).click();
  await expect(page.locator('#picker-title')).toHaveText('코스 바꾸기');
  // Lake first, then Saebyul: hole 3 becomes 레이크 3, a par 4.
  await page.locator('#picker-chosen').getByRole('radio', { name: '레이크' }).first().click();
  await page.locator('#picker-chosen').getByRole('radio', { name: '새별' }).nth(1).click();
  await page.getByRole('button', { name: '이 코스로 바꾸기' }).click();
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 레이크·새별');
  expect((await stored(page)).holes[0]).toMatchObject({ driver: 1, putts: 2 });
  expect((await stored(page)).holes[2].par).toBe(4);
  await expect(page.locator('#announce')).toContainText('레이크·새별');
  // The picker is the plain one again next time.
  await menu(page, '새 라운드');
  await page.locator('#new-round').click();
  await expect(page.locator('#picker-title')).toHaveText('어디서 치세요?');
  await expect(page.getByRole('button', { name: '이 코스로 시작' })).toBeVisible();
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
  // Everis publishes this par 3's length.
  await expect(page.locator('#hole-distance')).toHaveText('151 m');
  await expect(course.locator('.water')).toHaveCount(0);
  // 새별 7 is an island green by the course's own guide: the only hole drawn with water.
  await showCard(page);
  await pickHole(page, 6);
  await expect(page.locator('#hole-notes li')).toContainText(['아일랜드 홀']);
  await expect(course.locator('.water')).toHaveCount(1);
  // The tee box sits behind 다음 홀, none of it in the gap above the tab bar.
  for (const index of [0, 1, 3]) {
    await pickHole(page, index);
    const tee = (await course.locator('.tee').boundingBox())!;
    const go = (await next(page).boundingBox())!;
    expect(tee.y, `hole ${index + 1}`).toBeGreaterThanOrEqual(go.y);
    expect(tee.y + tee.height + 3, `hole ${index + 1}`).toBeLessThanOrEqual(go.y + go.height);
  }
});

test.describe('with hole notes in the course data', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('shows the length, handicap, layout note and official guide link, and bends a dogleg', async ({ page }) => {
    await open(page);
    // Everis 새별 1 as its own hole guide gives it: one length with no tee name, the handicap and a short note.
    await expect(page.locator('#hole-distance')).toHaveText('381 m');
    // One header row: Par, length and HDCP in one pill; the note's phrases and the guide behind one 홀 안내 chip.
    await expect(page.locator('#hole-hdcp')).toHaveText('HDCP 3');
    expect((await page.locator('#hole-info').boundingBox())!.height).toBeLessThanOrEqual(34);
    const infoBtn = page.getByRole('button', { name: '홀 안내, 특징 3개' });
    await expect(page.locator('#info-n')).toHaveText('3');
    await infoBtn.click();
    await expect(page.locator('#hole-pop')).toBeVisible();
    await expect(infoBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#hi-title')).toHaveText('1번 홀 안내');
    await expect(page.locator('#hi-facts')).toHaveText('Par 4, 381 m, HDCP 3');
    await expect(page.locator('#hole-notes li')).toHaveText(['내리막', '블라인드 티샷', '좌우 OB']);
    const guide = page.getByRole('link', { name: '공식 홀 안내, 새 창' });
    expect((await guide.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await expect(guide).toHaveAttribute('href', /^https:\/\/[^/]+\//);
    await expect(guide).toHaveAttribute('target', '_blank');
    await expect(guide).toHaveAttribute('rel', 'noopener noreferrer');
    expect(await sideScroll(page)).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#hole-pop')).toBeHidden();
    await expect(infoBtn).toBeFocused();
    // 레이크 1 (hole 10) bends right, so its green sits right of a straight hole's.
    await showCard(page);
    await pickHole(page, 9);
    await expect(page.locator('#hole-notes li')).toHaveText(['우 도그렉', '그린 뒤 내리막']);
    await expect(page.locator('#hole-hdcp')).toHaveText('HDCP 5');
    const straight = await page.evaluate(() => innerWidth * 0.47);
    await expect.poll(async () => {
      const box = (await page.locator('#course .green').boundingBox())!;
      return box.x + box.width / 2;
    }).toBeGreaterThan(straight);
  });
});

test('keeps the round after reload and starts a new one on request', async ({ page }) => {
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await showCard(page);
  await pickHole(page, 4);
  await page.reload();
  await expect(page.locator('#hole-title')).toHaveText('5번 홀');
  await expect(page.locator('#sum-strokes')).toHaveText('3');

  // The menu's 새 라운드 says what will happen; its 취소 and the picker's 취소 both keep the round.
  await menu(page, '새 라운드');
  await expect(page.locator('#new-question')).toHaveText('지금 라운드를 지난 라운드에 보관하고 새로 시작할까요?');
  await page.locator('#mp-new').getByRole('button', { name: '취소' }).click();
  await expect(page.locator('#mp-new')).toBeHidden();
  await page.locator('#menu .mi', { hasText: '새 라운드' }).click();
  await page.locator('#new-round').click();
  await expect(page.locator('#menu')).toBeHidden();
  await page.locator('#picker-cancel').click();
  await expect(page.locator('#sum-strokes')).toHaveText('3');
  await menu(page, '새 라운드');
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
  await expect(page.locator('#badge')).toHaveAttribute('data-tone', 'none');
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
  await expect(page.locator('#badge')).toHaveAttribute('data-tone', 'none');
  await showCard(page);
  await pickHole(page, 17);
  await expect(page.locator('#next-hole')).toBeDisabled();
  await expect(page.getByRole('button', { name: '드라이버 하나 빼기' })).toBeDisabled();
  await expect(next(page)).toHaveText('라운드 마치기');
  // Nothing recorded: a quick check first, then the summary.
  await next(page).click();
  await expect(page.locator('#check')).toBeVisible();
  await expect(page.locator('#check-sub')).toHaveText('18홀 중 0홀을 기록했어요.');
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#sum-vs')).toHaveText('기록한 홀이 없어요');
  await page.getByRole('button', { name: '요약 닫기' }).click();
  await expect(page.locator('#summary')).toBeHidden();
  await expect(next(page)).toBeFocused();
});

/** Writes holes into the round the picker started (today's, on the default course), then reloads. */
async function seed(page: Page, holes: Record<number, Record<string, number>>, current: number) {
  await page.evaluate(([key, list, at]) => {
    const r = JSON.parse(localStorage.getItem(key as string)!);
    for (const [i, v] of Object.entries(list as Record<string, Record<string, number>>)) Object.assign(r.holes[Number(i)], v);
    r.current = at;
    r.lastEdited = Date.now();
    localStorage.setItem(key as string, JSON.stringify(r));
  }, [STORAGE_KEY, holes, current] as const);
  await page.reload();
  await expect(page.locator('#entry')).toBeVisible();
}

test('the hole number opens a strip of all 18 holes, marking a skipped one, and jumps to a hole', async ({ page }) => {
  await open(page);
  // Holes 1, 2 and 4 recorded, hole 3 skipped, now on hole 5. Hole 2 took 10: triple or worse.
  await seed(page, { 0: { driver: 1, approach: 2, putts: 2 }, 1: { driver: 1, approach: 5, putts: 3, ob: 1 }, 3: { driver: 1, approach: 1, putts: 1 } }, 4);
  const holeBtn = page.locator('#hole-btn');
  await expect(holeBtn).toHaveClass(/missed/);
  await expect(holeBtn).toHaveAttribute('aria-label', /기록 안 한 홀 1개/);
  await expect(page.locator('#prog-n')).toHaveText('3홀까지');
  // The tick bar in the hole button: one tick per hole, the skipped one in sand, this one longer.
  const ticks = page.locator('#ticks i');
  await expect(ticks).toHaveCount(18);
  expect(await ticks.evaluateAll((list) => list.map((t) => t.getAttribute('data-t')).slice(0, 6))).toEqual(['done', 'done', 'miss', 'done', 'cur', 'later']);
  await holeBtn.click();
  const strip = page.locator('#strip');
  await expect(strip).toBeVisible();
  await expect(holeBtn).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#strip-note')).toHaveText('기록 안 한 홀 1개');
  await expect(page.locator('#strip-row .scell[data-jump]')).toHaveCount(18);
  await expect(page.locator('[data-jump="2"]')).toHaveAttribute('data-st', 'missed');
  await expect(page.locator('[data-jump="5"]')).toHaveAttribute('data-st', 'later');
  await expect(page.locator('[data-jump="4"]')).toBeFocused();
  await expect(page.locator('[data-jump="1"] .m')).toHaveAttribute('data-mark', 'triple');
  await expect(page.locator('#strip-row .scell.sub')).toHaveText(['전반18', '후반–']);
  expect(await sideScroll(page)).toBe(0);
  // A cell opens its hole; the badge shows the filled square for triple or worse.
  await page.locator('[data-jump="1"]').click();
  await expect(strip).toBeHidden();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
  await expect(holeBtn).toBeFocused();
  await expect(page.locator('#bmark')).toHaveAttribute('data-mark', 'triple');
  // 10 strokes against this hole's par: +5 on a par 5, +6 on a par 4, +7 on a par 3.
  const par = Number((await page.locator('#hole-par').textContent())!.replace('Par ', ''));
  await expect(page.locator('#hole-name')).toHaveText(`+${10 - par}`);
  // A long name is shortened in the badge, and read in full.
  await tap(page, 'putts', 2);
  await page.getByRole('button', { name: '어프로치 하나 빼기' }).click();
  await page.getByRole('button', { name: '어프로치 하나 빼기' }).click();
  await page.getByRole('button', { name: '어프로치 하나 빼기' }).click();
  await page.getByRole('button', { name: 'OB 하나 빼기' }).click();
  await page.getByRole('button', { name: '퍼터 하나 빼기' }).click();
  // Now 1 + 2 + 4 = 7 strokes: 트리플 보기 on this par 4 (Everis 새별 2).
  expect(par).toBe(4);
  await expect(page.locator('#hole-name')).toHaveText('트리플');
  await expect(page.locator('#badge')).toHaveAttribute('aria-label', '이 홀 7타 트리플 보기');
  // Escape closes the strip and keeps the hole.
  await holeBtn.click();
  await page.keyboard.press('Escape');
  await expect(strip).toBeHidden();
  await expect(holeBtn).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
});

/** The badge before the first tap: a light ring with Par over the hole's par, read as such. */
async function expectQuiet(page: Page, par: number) {
  await expect(page.locator('#badge')).toHaveAttribute('data-tone', 'none');
  await expect(page.locator('#hole-name')).toHaveText('Par');
  await expect(page.locator('#hole-strokes')).toHaveText(String(par));
  await expect(page.locator('#badge')).toHaveAttribute('aria-label', `이 홀 아직 기록 전, Par ${par}`);
}

test('다음 홀 on a hole with nothing recorded says it is left blank, and 되돌리기 goes back to it', async ({ page }) => {
  await open(page);
  await next(page).click();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
  await expect(page.locator('#toast-msg')).toHaveText('1번 홀은 비워 두고 넘어갑니다');
  await expect(page.locator('#announce')).toContainText('1번 홀은 비워 두고 넘어갑니다');
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  await expect(page.locator('#toast')).toBeHidden();
  // A recorded hole moves on without the notice; so do the arrows.
  await tap(page, 'driver');
  await tap(page, 'putts');
  await next(page).click();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
  await expect(page.locator('#toast')).toBeHidden();
  await page.getByRole('button', { name: '다음 홀로 이동' }).click();
  await expect(page.locator('#hole-title')).toHaveText('3번 홀');
  await expect(page.locator('#toast')).toBeHidden();
});

test('the progress chip says how far the round has come, and 홀 안내 keeps its place from hole to hole', async ({ page }) => {
  await open(page);
  const infoRight = async () => { const b = (await page.locator('#info-btn').boundingBox())!; return b.x + b.width; };
  const first = await infoRight();
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await next(page).click();
  await expect(page.locator('#prog-n')).toHaveText('1홀까지');
  await expect(page.locator('#prog-p')).toHaveText('파 대비 이븐');
  expect(Math.abs((await infoRight()) - first)).toBeLessThanOrEqual(1);
  await pickHole(page, 4);
  expect(Math.abs((await infoRight()) - first)).toBeLessThanOrEqual(1);
});

test('uses three weights on 기록: values bold, labels medium in muted ink, helper text regular', async ({ page }) => {
  await open(page);
  const style = (selector: string) => page.locator(selector).first().evaluate((el) => { const s = getComputedStyle(el); return [s.fontWeight, s.color]; });
  expect((await style('#count-driver'))[0]).toBe('800');
  expect((await style('#hole-n'))[0]).toBe('800');
  expect(await style('.club-lbl .club-name')).toEqual(['600', 'rgb(78, 100, 80)']);
  expect(await style('#stake-ob .pen-lbl')).toEqual(['600', 'rgb(78, 100, 80)']);
  expect((await style('#hole-par'))[0]).toBe('600');
  expect((await style('.mode'))[0]).toBe('600');
  expect((await style('.tab-label'))[0]).toBe('600');
  expect((await style('#tab-entry .tab-label'))[0]).toBe('600');
  await page.getByRole('button', { name: '상세', exact: true }).click();
  expect(await style('.tee-t')).toEqual(['600', 'rgb(78, 100, 80)']);
  expect((await style('#tee-val'))[0]).toBe('400');
  await page.getByRole('button', { name: '페어웨이' }).click();
  expect((await style('#tee-val'))[0]).toBe('800');
});

/** Holds the pointer on a club's count until the 0 … 5+ picker opens, then lets go. */
async function longPress(page: Page, key: string) {
  const box = (await page.locator(`#count-${key}`).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('#numpick')).toBeVisible();
  await page.mouse.up();
}

test('a long press on a count sets it straight to 0 … 5+, and the toast takes it back', async ({ page }) => {
  await open(page);
  await longPress(page, 'driver');
  await expect(page.locator('#np-title')).toHaveText('드라이버 몇 번 쳤나요?');
  await expect(page.locator('#np-row button')).toHaveText(['0', '1', '2', '3', '4', '5+']);
  await expect(page.getByRole('button', { name: '0번', exact: true })).toBeFocused();
  // Letting go is not a stroke.
  await expect(count(page, 'driver')).toHaveText('0');
  await page.getByRole('button', { name: '3번', exact: true }).click();
  await expect(page.locator('#numpick')).toBeHidden();
  await expect(count(page, 'driver')).toHaveText('3');
  await expect(page.locator('#hole-strokes')).toHaveText('3');
  await expect(page.locator('#toast-msg')).toHaveText('드라이버 3으로');
  await expect(page.getByRole('button', { name: '드라이버 하나 더하기' })).toBeFocused();
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(count(page, 'driver')).toHaveText('0');
  // 5+ is five; a short tap still counts one; Escape leaves the count as it was.
  await longPress(page, 'putts');
  await page.getByRole('button', { name: '5번 이상' }).click();
  await expect(count(page, 'putts')).toHaveText('5');
  await tap(page, 'putts');
  await expect(count(page, 'putts')).toHaveText('6');
  await longPress(page, 'putts');
  await expect(page.getByRole('button', { name: '5번 이상' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#numpick')).toBeHidden();
  await expect(count(page, 'putts')).toHaveText('6');
  expect((await stored(page)).holes[0].putts).toBe(6);
});

/** Holds the pointer on a penalty until the same 0 … 5+ picker opens, then lets go. */
async function longPressPen(page: Page, key: 'ob' | 'hazard' | 'bunker') {
  const box = (await page.locator(`#stake-${key} .pen-icon`).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('#numpick')).toBeVisible();
  await page.mouse.up();
}

test('a long press on a penalty sets its count straight away in either mode, and a tap still adds one', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '상세', exact: true }).click();
  await tap(page, 'ob', 2);
  await expect(page.locator('#stake-ob .pen-count')).toHaveText('2');
  await expect(page.locator('#stake-ob')).toHaveAttribute('aria-describedby', 'lp-hint-pen');
  await longPressPen(page, 'ob');
  await expect(page.locator('#np-title')).toHaveText('OB 몇 번 났나요?');
  await expect(page.getByRole('button', { name: '2번', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '2번', exact: true })).toBeFocused();
  // Letting go adds nothing.
  await expect(page.locator('#stake-ob .pen-count')).toHaveText('2');
  await page.getByRole('button', { name: '0번', exact: true }).click();
  await expect(page.locator('#numpick')).toBeHidden();
  await expect(page.locator('#stake-ob .pen-count')).toBeHidden();
  await expect(page.locator('#badge')).toHaveAttribute('data-tone', 'none');
  await expect(page.locator('#toast-msg')).toHaveText('OB 0으로');
  await expect(page.locator('#stake-ob')).toBeFocused();
  expect((await stored(page)).holes[0].ob).toBe(0);
  // 벙커 in 상세, 해저드 in 기본; a short tap still adds one.
  await longPressPen(page, 'bunker');
  await expect(page.locator('#np-title')).toHaveText('벙커에 몇 번 들어갔나요?');
  await page.getByRole('button', { name: '3번', exact: true }).click();
  await page.getByRole('button', { name: '기본', exact: true }).click();
  await longPressPen(page, 'hazard');
  await page.getByRole('button', { name: '1번', exact: true }).click();
  await tap(page, 'hazard');
  expect((await stored(page)).holes[0]).toMatchObject({ ob: 0, hazard: 2, bunker: 3 });
  // 빼기 takes off the 해저드 just tapped.
  await page.getByRole('button', { name: '해저드 하나 빼기' }).click();
  expect((await stored(page)).holes[0].hazard).toBe(1);
});

test('큰 글씨 in the menu makes the numbers larger, stays after a reload, and still fits small phones', async ({ page }) => {
  await open(page);
  const size = () => page.locator('#count-driver').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const before = await size();
  await menu(page);
  const sw = page.getByRole('switch', { name: /큰 글씨/ });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await closeMenu(page);
  expect(await size()).toBeGreaterThan(before);
  // Kept in the prefs key beside the course choice.
  const prefs = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), PREFS_KEY))!);
  expect(prefs.big).toBe(true);
  expect(prefs.course).toBeTruthy();
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/big/);
  for (const [width, height] of [[375, 667], [375, 553], [360, 640]]) {
    await page.setViewportSize({ width, height });
    expect(await sideScroll(page), `${width}×${height}`).toBe(0);
    expect(await page.locator('#sheet').evaluate((el) => el.scrollHeight - el.clientHeight), `${width}×${height}`).toBeLessThanOrEqual(1);
  }
  // 앱 정보 says what the app promises.
  await menu(page, '앱 정보');
  await expect(page.locator('#mp-about .promise li')).toHaveCount(4);
  await expect(page.locator('#mp-about')).toContainText('계정, 광고, 구독이 없어요.');
});

test('a coach mark on hole 1 of the first round explains the long press once, and never comes back', async ({ page }) => {
  await open(page);
  const coach = page.locator('#coach');
  await expect(coach).toBeVisible();
  await expect(coach).toHaveText('숫자를 길게 누르면 바로 골라요');
  await expect(page.locator('#count-driver')).toBeHidden();
  expect(await sideScroll(page)).toBe(0);
  await tap(page, 'driver');
  await expect(coach).toBeHidden();
  await expect(page.locator('#count-driver')).toBeVisible();
  // Seen is kept in the prefs key beside the course choice; no new storage key.
  const prefs = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), PREFS_KEY))!);
  expect(prefs.coach).toBe(true);
  expect(prefs.course).toBeTruthy();
  await page.getByRole('button', { name: '되돌리기' }).click();
  await page.reload();
  await expect(page.locator('#badge')).toHaveAttribute('data-tone', 'none');
  await expect(coach).toBeHidden();
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual([PREFS_KEY, STORAGE_KEY].sort());
});

test('once a round is kept, 지난 라운드 suggests the home screen in one line, until 알겠어요', async ({ page }) => {
  await open(page);
  const card = page.locator('#home-card');
  await showPast(page);
  await expect(card).toBeHidden();
  await seed(page, { 0: { driver: 1, approach: 1, putts: 2 } }, 1);
  await showCard(page);
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await page.getByRole('button', { name: '지난 라운드에 보관' }).click();
  await expect(page.locator('#hist-view')).toBeVisible();
  // First a calm backup reminder, alone; saving downloads the backup file and says so.
  const reminder = page.locator('#backup-card');
  await expect(reminder).toBeVisible();
  await expect(page.locator('#bk-h')).toHaveText('라운드를 보관했어요');
  await expect(card).toBeHidden();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '백업 파일 저장' }).first().click();
  expect((await download).suggestedFilename()).toMatch(/^fairway-note-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.locator('#bk-h')).toHaveText('백업 파일을 저장했어요');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(reminder).toBeHidden();
  await expect(card).toBeVisible();
  await expect(card.locator('h3')).toHaveText('홈 화면에 추가하면 기록이 더 오래 남아요');
  await expect(page.locator('#hc-more')).toBeHidden();
  await page.getByRole('button', { name: '방법 보기' }).click();
  await expect(page.locator('#hc-more .steps li')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true');
  expect(await sideScroll(page)).toBe(0);
  await page.getByRole('button', { name: '알겠어요' }).click();
  await expect(card).toBeHidden();
  // Put away for good, in the prefs key.
  expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), PREFS_KEY))!).home).toBe(true);
});

test('a 9-hole round from the picker: one nine on every screen, saved and kept as "… 9홀"', async ({ page }) => {
  await page.goto('/');
  const len = page.locator('#picker-len');
  await expect(len.getByRole('button', { name: '18홀' })).toHaveAttribute('aria-pressed', 'true');
  await len.getByRole('button', { name: '9홀' }).click();
  await expect(len.getByRole('button', { name: '9홀' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트 새별 9홀');
  // No 후반: one row, named 코스.
  await expect(page.locator('#picker-front-label')).toHaveText('코스');
  await expect(page.locator('#picker-back-label')).toHaveCount(0);
  await expect(page.locator('#picker-chosen')).toContainText('Par 36');
  await page.locator('#picker-chosen [data-nine="lake"]').click();
  await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트 레이크 9홀');
  expect(await sideScroll(page)).toBe(0);
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  const saved = await stored(page);
  expect(saved.holes).toHaveLength(9);
  expect(saved.course).toEqual({ id: 'everis', name: '에버리스 골프리조트', front: '레이크', back: '' });
  expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), PREFS_KEY))!).holes).toBe(9);
  await expect(page.locator('#ticks i')).toHaveCount(9);
  // Four strokes on each of the nine holes (the first column reads 티샷 on a par 3, so tap by place).
  const plus = (key: string) => page.locator(`.club-${key} .plus`).click();
  for (let k = 0; k < 9; k++) {
    await plus('driver');
    await plus('approach');
    await plus('putts');
    await plus('putts');
    if (k < 8) await next(page).click();
  }
  await expect(page.locator('#hole-title')).toHaveText('9번 홀');
  await expect(page.locator('#next-hole')).toBeDisabled();
  await expect(next(page)).toHaveText('라운드 마치기');
  await page.locator('#hole-btn').click();
  await expect(page.locator('#strip-row .scell[data-jump]')).toHaveCount(9);
  await expect(page.locator('#strip-row .scell.sub')).toHaveText(['합계36']);
  await page.keyboard.press('Escape');
  // 코스 바꾸기 keeps the round's nine holes: no 18홀/9홀 there.
  await menu(page, '코스 바꾸기');
  await page.locator('#change-course').click();
  await expect(page.locator('#picker')).toBeVisible();
  await expect(len).toBeHidden();
  await expect(page.locator('#picker-label')).toContainText('9홀');
  await page.locator('#picker-cancel').click();
  await showCard(page);
  await expect(page.locator('#scorecard .nine-tbl')).toHaveCount(1);
  await expect(page.locator('#scorecard .nt-h b')).toHaveText('레이크');
  await expect(page.locator('#scorecard .r-h .ct-s')).toHaveText(['9홀']);
  // Every hole recorded and putted: the summary opens at once.
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#sum-title')).toHaveText('9홀 라운드 요약');
  await expect(page.locator('#sum-sub')).toContainText('에버리스 골프리조트 레이크 9홀');
  await expect(page.locator('#sum-count')).toHaveText('9홀을 모두 기록했어요');
  await expect(page.locator('#sum-total')).toHaveText('36');
  await expect(page.locator('#sum-stats')).not.toContainText('후반');
  await page.getByRole('button', { name: '지난 라운드에 보관' }).click();
  await expect(page.locator('#history-list .past-item')).toContainText(['레이크 9홀']);
  // The next round offers nine holes again.
  await page.getByRole('button', { name: '코스 고르고 시작' }).click();
  await expect(len.getByRole('button', { name: '9홀' })).toHaveAttribute('aria-pressed', 'true');
});

/** Presses Tab `times` times and checks focus never leaves `dialog` for the page behind it. */
async function focusStaysIn(page: Page, dialog: string, times = 12) {
  for (let k = 0; k < times; k++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate((id) => {
      const el = document.activeElement;
      return el === document.body || el === null || document.getElementById(id)!.contains(el);
    }, dialog);
    expect(inside, `Tab ${k + 1} in #${dialog}`).toBe(true);
  }
}

test('names every control and value for screen readers, keeps focus in each popover and gives it back', async ({ page }) => {
  await open(page);
  // Each pill: a group named for its club, + and − by name, and the count read with the club.
  for (const club of ['드라이버', '어프로치', '퍼터']) {
    const group = page.getByRole('group', { name: club, exact: true });
    await expect(group.getByRole('button', { name: `${club} 하나 더하기` })).toBeVisible();
    await expect(group.getByRole('button', { name: `${club} 하나 빼기` })).toBeVisible();
    await expect(group.getByText(`${club} 0`, { exact: true })).toBeAttached();
  }
  await tap(page, 'driver');
  await tap(page, 'approach', 2);
  await tap(page, 'putts', 2);
  await expect(page.getByRole('group', { name: '어프로치', exact: true }).getByText('어프로치 2', { exact: true })).toBeAttached();
  // The digit itself is hidden from screen readers, so nothing reads a bare "2".
  await expect(page.locator('#count-approach')).toHaveAttribute('aria-hidden', 'true');
  // The badge reads the hole's score in one phrase.
  await expect(page.getByRole('img', { name: '이 홀 5타 보기' })).toBeVisible();

  // The hole button names the hole and the progress the tick bar draws; the strip is a list of holes.
  const holeBtn = page.getByRole('button', { name: /^1번 홀, Par 4\. 홀 목록, 1홀 기록$/ });
  await expect(holeBtn).toBeVisible();
  await expect(page.locator('#ticks')).toHaveAttribute('aria-hidden', 'true');
  await holeBtn.click();
  const strip = page.getByRole('dialog', { name: '홀 목록' });
  await expect(strip).toBeVisible();
  const list = strip.getByRole('list', { name: '홀 목록' });
  await expect(list.getByRole('listitem')).toHaveCount(20);
  await expect(list.getByRole('button', { name: '1번 홀 Par 4, 5타 보기' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(list.getByRole('button', { name: /^2번 홀 Par 4, 기록 없음$/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(list.getByRole('button', { name: /^18번 홀/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(list.getByRole('button', { name: /^1번 홀/ })).toBeFocused();
  await focusStaysIn(page, 'strip');
  await page.keyboard.press('Escape');
  await expect(strip).toBeHidden();
  await expect(page.locator('#hole-btn')).toBeFocused();

  // 홀 안내: focus moves in, stays in, and comes back to the chip.
  const info = page.getByRole('button', { name: /^홀 안내/ });
  await info.click();
  await expect(page.getByRole('dialog', { name: '1번 홀 안내' })).toBeVisible();
  await focusStaysIn(page, 'hole-pop');
  await page.keyboard.press('Escape');
  await expect(info).toBeFocused();

  // The menu and the finish check do the same.
  await page.getByRole('button', { name: '메뉴' }).click();
  await focusStaysIn(page, 'menu');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '메뉴' })).toBeFocused();
  await showCard(page);
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  await expect(page.getByRole('dialog', { name: '라운드를 마칠까요?' })).toBeVisible();
  await focusStaysIn(page, 'check');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '라운드 마치기' })).toBeFocused();
});

test('큰 글씨 keeps every target on 기록 at least 48px in both modes', async ({ page }) => {
  await open(page);
  await menu(page);
  await page.getByRole('switch', { name: /큰 글씨/ }).click();
  await closeMenu(page);
  // A target's box, grown by an invisible ::after touch area where it has one.
  const target = (selector: string) => page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const after = getComputedStyle(el, '::after');
    const grow = (v: string) => (after.content !== 'none' && after.position === 'absolute' ? Math.max(0, -parseFloat(v) || 0) : 0);
    return { w: r.width + grow(after.left) + grow(after.right), h: r.height + grow(after.top) + grow(after.bottom) };
  });
  const selectors = ['#prev-hole', '#next-hole', '#hole-btn', '#info-btn', '.club-driver .plus', '.club-driver .minus', '.club-putts .plus', '#stake-ob', '#stake-hazard', 'button[data-mode="basic"]', 'button[data-mode="detail"]', '#go-next', '#tab-card'];
  for (const [width, height] of [[375, 667], [375, 553]]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['기본', '상세']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      for (const selector of selectors) {
        // 상세 on a short screen moves the header row aside (Par and length go under the hole number), 홀 안내 with it.
        if (selector === '#info-btn' && mode === '상세' && height < 600) {
          await expect(page.locator(selector)).toBeHidden();
          continue;
        }
        const box = await target(selector);
        expect(Math.min(box.w, box.h), `${selector} in ${mode} at ${width}×${height}`).toBeGreaterThanOrEqual(48);
      }
    }
    await page.getByRole('button', { name: '기본', exact: true }).click();
  }
});

test('finishing with one whole nine offers a 9-hole round, and its summary leaves the other nine out', async ({ page }) => {
  await open(page);
  await seed(page, Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i, { driver: 1, approach: 1, putts: 2 }])), 8);
  await showCard(page);
  await expect(page.locator('#legend li')).toHaveCount(7);
  await expect(page.locator('#legend')).toContainText('트리플 이상');
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  await expect(page.locator('#check-title')).toHaveText('9홀 라운드로 마칠까요?');
  await expect(page.locator('#check-sub')).toHaveText('새별 9홀을 모두 기록했어요. 레이크는 기록이 없어요.');
  await expect(page.locator('#check-list')).toBeHidden();
  await page.getByRole('button', { name: '9홀 라운드로 마치기' }).click();
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#sum-title')).toHaveText('9홀 라운드 요약');
  await expect(page.locator('#sum-count')).toHaveText('새별 9홀을 모두 기록했어요');
  await expect(page.locator('#sum-stats')).not.toContainText('후반');
  await page.getByRole('button', { name: '요약 닫기' }).click();
  // Or go on with the other nine.
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  await page.getByRole('button', { name: '레이크 이어서 기록' }).click();
  await expect(page.locator('#entry')).toBeVisible();
  await expect(page.locator('#hole-title')).toHaveText('10번 홀');
});

test('sums up the round on 라운드 마치기 and keeps it among past rounds, then waits for the next course', async ({ page }) => {
  await open(page);
  // 1: par in 4; 2: birdie in 3 with a fairway tee shot; 3 (par 5): 7 with an OB.
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await next(page).click();
  await page.getByRole('button', { name: '상세', exact: true }).click();
  await page.getByRole('button', { name: '페어웨이' }).click();
  await tap(page, 'approach');
  await tap(page, 'putts');
  await page.getByRole('button', { name: '기본', exact: true }).click();
  await next(page).click();
  await tap(page, 'driver');
  await tap(page, 'ob');
  await tap(page, 'approach', 3);
  await tap(page, 'putts', 2);
  await showCard(page);
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  // 15 holes are blank: the quick check names them, and 그대로 마치기 goes on to the summary.
  await expect(page.locator('#check-list li')).toHaveText(['기록 안 한 홀 15개4–18번 홀. 그대로 마치면 기록한 홀만 계산해요.']);
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  const summary = page.locator('#summary');
  await expect(summary).toBeVisible();
  await expect(page.locator('#sum-total')).toHaveText('14');
  await expect(page.locator('#sum-vs')).toHaveText('파 대비 +1');
  await expect(page.locator('#sum-count')).toHaveText('3홀만 기록했어요. 기록한 홀만 계산해요');
  await expect(page.locator('#sum-marks li')).toHaveText(['0이글', '1버디', '1파', '0보기', '1더블', '0트리플+트리플 이상']);
  await expect(page.locator('#sum-stats')).toContainText('전반14타+1');
  await expect(page.locator('#sum-stats')).toContainText('페어웨이 안착1/1100%');
  await expect(page.locator('#sum-stats')).toContainText('벌타OB 1해저드 0');
  await expect(page.locator('#sum-stats')).toContainText('베스트 홀2번 홀버디');
  await expect(page.locator('#sum-insight')).toContainText('타수를 가장 많이 잃은 곳');
  // The whole summary fits a 375×667 screen.
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await summary.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  const mail = new URL((await page.locator('#sum-mail').getAttribute('href'))!);
  expect(mail.protocol).toBe('mailto:');
  expect(await sideScroll(page)).toBe(0);
  await page.getByRole('button', { name: '지난 라운드에 보관' }).click();
  await expect(summary).toBeHidden();
  await expect(page.locator('#hist-view')).toBeVisible();
  await expect(page.locator('#history-list .past-item')).toHaveCount(1);
  await expect(page.locator('#now-title')).toHaveText('다음 라운드');
  // Nothing is saved as a round until the next course is chosen; 기록 opens the picker, and 닫기 stays here.
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  await tab(page, '기록').click();
  await expect(page.locator('#picker')).toBeVisible();
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(page.locator('#hist-view')).toBeVisible();
  await page.getByRole('button', { name: '코스 고르고 시작' }).click();
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await expect(page.locator('#entry')).toBeVisible();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  await expect(page.locator('#history-list .past-item')).toHaveCount(1);
});

test('calls the first column 티샷 on a par 3', async ({ page }) => {
  await open(page);
  await expect(page.locator('.club-driver .club-name')).toHaveText('드라이버');
  for (let i = 0; i < 3; i++) await page.locator('#next-hole').click();
  await expect(page.locator('#hole-par')).toHaveText('Par 3');
  await expect(page.locator('.club-driver .club-name')).toHaveText('티샷');
  await page.getByRole('button', { name: '티샷 하나 더하기' }).click();
  await expect(page.locator('#announce')).toHaveText('4번 홀 티샷 1, 1타');
  await expect(page.locator('#toast-msg')).toHaveText('티샷 +1');
  expect((await stored(page)).holes[3].driver).toBe(1);
  await page.locator('#next-hole').click();
  await expect(page.locator('.club-driver .club-name')).toHaveText('드라이버');
});

test('swipes sideways to the next or previous hole without pressing the button it started on', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await open(page);
  const sheet = (await page.locator('#sheet').boundingBox())!;
  const mid = sheet.y + sheet.height / 2;
  /** A drag from (x, y) by dx, dy; a slow one rests before letting go, so it is not a flick. */
  const drag = async (x: number, y: number, dx: number, dy = 6, slow = false) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    if (slow) await page.waitForTimeout(300);
    await page.mouse.up();
    await expect(page.locator('.ghost')).toHaveCount(0);
  };
  const title = page.locator('#hole-title');
  const offset = () => page.locator('#sheet-wrap').evaluate((el) => el.style.transform);
  // Starting on the approach +, a left swipe goes to hole 2 and adds nothing.
  const plus = (await page.locator('.club-approach .plus').boundingBox())!;
  await drag(plus.x + plus.width / 2, plus.y + plus.height / 2, -160);
  await expect(title).toHaveText('2번 홀');
  await expect(page.locator('#announce')).toHaveText('2번 홀, Par 4');
  expect((await stored(page)).holes[0].approach).toBe(0);
  await drag(60, mid, 260);
  await expect(title).toHaveText('1번 홀');
  // Past the first hole the sheet springs back.
  await drag(60, mid, 260);
  await expect(title).toHaveText('1번 홀');
  await expect.poll(offset).toBe('');
  // A short slow drag, or a mostly vertical one, changes nothing.
  await drag(240, mid, -40, 4, true);
  await expect(title).toHaveText('1번 홀');
  await drag(200, mid, -20, 90);
  await expect(title).toHaveText('1번 홀');
  await expect.poll(offset).toBe('');
  // A plain tap still counts.
  await tap(page, 'driver');
  await expect(count(page, 'driver')).toHaveText('1');
});

test('takes the last tap back from the toast for four seconds, over no button', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 375, height: 667 });
  await open(page);
  const toast = page.locator('#toast');
  await tap(page, 'driver');
  await tap(page, 'ob');
  await expect(toast).toBeVisible();
  await expect(page.locator('#toast-msg')).toHaveText('OB +1');
  // It covers the club names, not a button: every control of the sheet is clear of it.
  const box = (await toast.boundingBox())!;
  for (const control of await page.locator('#sheet button').all()) {
    const b = await control.boundingBox();
    if (!b) continue;
    const apart = b.x + b.width <= box.x || box.x + box.width <= b.x || b.y + b.height <= box.y || box.y + box.height <= b.y;
    expect(apart, await control.getAttribute('aria-label') ?? (await control.textContent()) ?? '').toBe(true);
  }
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(toast).toBeHidden();
  await expect(page.locator('#stake-ob .pen-count')).toHaveClass(/zero/);
  await expect(page.locator('#announce')).toHaveText('되돌렸어요');
  expect((await stored(page)).holes[0]).toMatchObject({ driver: 1, ob: 0 });
  // A minus can be taken back too, and the toast leaves on its own after four seconds or on a hole change.
  await page.getByRole('button', { name: '드라이버 하나 빼기' }).click();
  await expect(page.locator('#toast-msg')).toHaveText('드라이버 −1');
  await page.clock.fastForward(4100);
  await expect(toast).toBeHidden();
  await tap(page, 'putts');
  await expect(toast).toBeVisible();
  await page.locator('#next-hole').click();
  await expect(toast).toBeHidden();
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
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

test('라운드 마치기 counts a chip-in on the last hole the way 다음 홀 does, in the summary and among past rounds', async ({ page }) => {
  await open(page);
  // Holes 1–17 in 4 with two putts each; on 18 a drive and a chip-in, no putt.
  await seed(page, Object.fromEntries(Array.from({ length: 17 }, (_, i) => [i, { driver: 1, approach: 1, putts: 2 }])), 17);
  await tap(page, 'driver');
  await tap(page, 'approach');
  await expect(page.locator('#hole-name')).toHaveText('진행 중');
  await expect(next(page)).toHaveText('라운드 마치기');
  await next(page).click();
  await expect(page.locator('#check-list li')).toHaveText(['퍼트가 없는 홀 1개18번 홀. 칩인으로 끝났다면 그대로 두세요.']);
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#sum-total')).toHaveText('70');
  await expect(page.locator('#sum-count')).toHaveText('18홀을 모두 기록했어요');
  // Finished: back on 기록 the hole shows its result, until it is recorded on again.
  await page.getByRole('button', { name: '요약 닫기' }).click();
  await expect(page.locator('#hole-name')).not.toHaveText('진행 중');
  await tap(page, 'approach');
  await expect(page.locator('#hole-name')).toHaveText('진행 중');
  await next(page).click();
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await expect(page.locator('#sum-total')).toHaveText('71');
  await page.getByRole('button', { name: '지난 라운드에 보관' }).click();
  await expect(page.locator('#history-list .past-meta')).toHaveText(['18홀, 퍼트 34']);
  // Read back from storage, the kept round still counts hole 18.
  await page.reload();
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await expect(page.locator('#picker')).toBeHidden();
  await tab(page, '지난 라운드').click();
  await expect(page.locator('#history-list .past-meta')).toHaveText(['18홀, 퍼트 34']);
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
  await page.evaluate(([key, v]) => localStorage.setItem(key, v), [STORAGE_KEY, oldRound({ 0: { driver: 1, approach: 1, putts: 2 } })]);
  await page.reload();
  await expect(page.locator('#picker')).toBeVisible();
  const back = page.locator('#picker-cancel');
  await expect(back).toHaveText('지난 라운드 이어서');

  // Starting a new round from here still asks before the earlier round is replaced.
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

test('offers to continue or replace a round from an earlier day, and asks before replacing it', async ({ page }) => {
  await open(page);
  await page.evaluate(([key, v]) => localStorage.setItem(key, v), [STORAGE_KEY, oldRound({ 0: { driver: 1, approach: 1, putts: 2 } })]);
  await page.reload();
  // The course picker opens first for an earlier-day round; Esc closes it and the banner stays.
  await page.keyboard.press('Escape');
  await expect(page.locator('#picker')).toBeHidden();
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
  // The course picker opens first for an earlier-day round; Esc closes it and the banner stays.
  await page.keyboard.press('Escape');
  await expect(page.locator('#picker')).toBeHidden();
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
        // Measure at rest: a tapped count grows for a moment and a new hole's sheet slides in.
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
        expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0);
        expect(await page.locator('#sheet').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
        expect(await sideScroll(page)).toBe(0);
        const tabs = (await page.locator('#views').boundingBox())!;
        expect(tabs.y + tabs.height).toBeCloseTo(height, 0);
        expect(tabs.height).toBeGreaterThanOrEqual(56);
        const go = (await next(page).boundingBox())!;
        expect(go.y + go.height).toBeLessThanOrEqual(tabs.y);
        for (const selector of ['#prev-hole', '#next-hole', '#stake-ob', '#stake-hazard', ...['driver', 'approach', 'putts'].flatMap((k) => [`.club-${k} .plus`, `.club-${k} .minus`])]) {
          const box = (await page.locator(selector).first().boundingBox())!;
          expect(box.y + box.height, selector).toBeLessThanOrEqual(go.y);
          expect(box.height, selector).toBeGreaterThanOrEqual(48);
          expect(box.width, selector).toBeGreaterThanOrEqual(48);
        }
        // The way back to the site sits in the tab bar, left of the tabs.
        const home = (await page.locator('.home-link').boundingBox())!;
        const first = (await tab(page, '스코어카드').boundingBox())!;
        expect(Math.min(home.width, home.height)).toBeGreaterThanOrEqual(48);
        expect(home.y).toBeGreaterThanOrEqual(tabs.y);
        expect(home.x + home.width).toBeLessThanOrEqual(first.x);
        // The count keeps at least 8px clear of the round + and −.
        for (const key of ['driver', 'approach', 'putts']) {
          const [plus, n, minus] = await Promise.all([`.club-${key} .plus span`, `#count-${key}`, `.club-${key} .minus span`].map(async (s) => (await page.locator(s).boundingBox())!));
          expect(n.y - (plus.y + plus.height), key).toBeGreaterThanOrEqual(8);
          expect(minus.y - (n.y + n.height), key).toBeGreaterThanOrEqual(8);
        }
        // The badge rises into the open corner, clear of the hole switcher and the chips.
        const badge = (await page.locator('#badge').boundingBox())!;
        for (const selector of ['.switcher', '#hole-info', '#hole-notes']) {
          const b = await page.locator(selector).boundingBox();
          if (!b) continue;
          const apart = b.x + b.width <= badge.x || badge.x + badge.width <= b.x || b.y + b.height <= badge.y || badge.y + badge.height <= b.y;
          expect(apart, selector).toBe(true);
        }
      };
      await check();
      await next(page).tap();
      await expect(page.locator('#hole-title')).toHaveText('2번 홀');
      await page.locator('#stake-ob').tap();
      await page.locator('.club-driver .plus').tap();
      await check();
      // 상세 fits as well (on 553px the chips step aside for Par and length under the hole number), with every direction a 48px target.
      await page.getByRole('button', { name: '상세', exact: true }).tap();
      // The length steps aside where it would push the switcher into the badge (WebKit draws digits wider); it stays in 홀 안내.
      if (height < 600) await expect(page.locator('#hole-sub')).toHaveText(/^Par 4(, 376 m)?$/);
      await check();
      for (const button of await page.locator('#pad button').all()) {
        const box = (await button.boundingBox())!;
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(48);
      }
    });

    test('keeps the hole\'s shape in view: a small picture in the header on a short screen, the drawn band on a taller one', async ({ page }) => {
      await open(page);
      await atRest(page);
      const thumb = page.locator('#hole-thumb');
      const sheet = (await page.locator('#sheet').boundingBox())!;
      if (height < 600) {
        await expect(thumb).toBeVisible();
        const t = (await thumb.boundingBox())!;
        expect(t.y + t.height).toBeLessThanOrEqual(sheet.y);
        await expect(thumb.locator('.th-green')).toHaveCount(1);
      } else {
        await expect(thumb).toBeHidden();
        const green = (await page.locator('#course .green').boundingBox())!;
        expect(green.y).toBeLessThan(sheet.y);
      }
    });

    test('상세 keeps its penalty pills one width on their columns, and the toggle at least 44px tall', async ({ page }) => {
      await open(page);
      await page.getByRole('button', { name: '상세', exact: true }).click();
      await atRest(page);
      const pens = await Promise.all(['ob', 'bunker', 'hazard'].map(async (k) => (await page.locator(`#stake-${k}`).boundingBox())!));
      const cols = await Promise.all(['driver', 'approach', 'putts'].map(async (k) => (await page.locator(`.club-${k} .pill`).boundingBox())!));
      pens.forEach((b, j) => {
        expect(Math.abs(b.width - pens[0].width), `pill ${j} width`).toBeLessThanOrEqual(1);
        expect(Math.abs(b.x + b.width / 2 - (cols[j].x + cols[j].width / 2)), `pill ${j} centre`).toBeLessThanOrEqual(1);
      });
      for (const m of ['basic', 'detail']) expect((await page.locator(`button[data-mode="${m}"]`).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });

    test('scrolls the scorecard inside its view, clear of the tab bar', async ({ page }) => {
      await open(page);
      await tab(page, '스코어카드').tap();
      await page.locator('#card-view').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      const tabs = (await page.locator('#views').boundingBox())!;
      const last = (await page.locator('#save-state').boundingBox())!;
      expect(last.y + last.height).toBeLessThanOrEqual(tabs.y);
      expect(await sideScroll(page)).toBe(0);
      await expect(page.locator('.home-link')).toBeVisible();
    });
  });
}

/** Two edges or centres, in CSS px, that should line up: within 1px. */
function expectAligned(actual: number, expected: number, what: string) {
  expect(Math.abs(actual - expected), `${what}: ${actual.toFixed(1)} vs ${expected.toFixed(1)}`).toBeLessThanOrEqual(1);
}
const rect = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;
const midX = (b: { x: number; width: number }) => b.x + b.width / 2;
const midY = (b: { y: number; height: number }) => b.y + b.height / 2;
const atRest = (page: Page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

for (const [width, height] of [[360, 640], [375, 667], [390, 844]]) {
  test.describe(`lined up on a ${width}×${height} phone`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('기록 sits on one grid: switcher centred, chips and menu on the card edge, badge and penalties on the stepper columns', async ({ page }) => {
      await open(page);
      for (const mode of ['기본', '상세'] as const) {
        if (mode === '상세') await page.getByRole('button', { name: '상세', exact: true }).click();
        await atRest(page);
        const sheet = await rect(page, '#sheet');
        const menuBtn = await rect(page, '#entry .top .menu');
        expectAligned(midX(await rect(page, '#entry .switcher')), width / 2, `${mode}: hole switcher centre`);
        expectAligned(menuBtn.x, sheet.x, `${mode}: menu button left edge`);
        // The badge sits in the top bar's right slot: 60px, on the inset, on the bar's centre line, clear of the card.
        const badge = await rect(page, '#badge');
        expectAligned(badge.width, 60, `${mode}: badge width`);
        expectAligned(badge.height, 60, `${mode}: badge height`);
        expectAligned(badge.x + badge.width, sheet.x + sheet.width, `${mode}: badge right edge on the inset`);
        expectAligned(midY(badge), midY(menuBtn), `${mode}: badge on the top bar's centre line`);
        expect(badge.y + badge.height, `${mode}: badge clear of the card`).toBeLessThan(sheet.y);
        // The version stays on 기록, quietly: just above the card's right end, below the badge.
        const ver = await rect(page, '#app-version');
        expectAligned(ver.x + ver.width, sheet.x + sheet.width, `${mode}: version right edge`);
        expect(ver.y + ver.height, `${mode}: version above the card`).toBeLessThanOrEqual(sheet.y - 2);
        expect(ver.y, `${mode}: version below the badge`).toBeGreaterThanOrEqual(badge.y + badge.height);
        expect((await rect(page, 'button[data-mode="basic"]')).height, `${mode}: toggle height`).toBeGreaterThanOrEqual(44);
        if (mode === '상세') {
          // The direction pad runs from the card's content edge to the other, like the tee line.
          const pad = await page.locator('#pad button').all();
          const [first, last] = [(await pad[0].boundingBox())!, (await pad[pad.length - 1].boundingBox())!];
          const line = await rect(page, '.tee-line');
          expectAligned(first.x, line.x, '상세: pad left edge');
          expectAligned(last.x + last.width, line.x + line.width, '상세: pad right edge');
        }
        const [c1, c2, c3] = await Promise.all(['driver', 'approach', 'putts'].map((k) => rect(page, `.club-${k} .pill`)));
        expectAligned(midX(c2), width / 2, `${mode}: middle stepper`);
        expectAligned(midX(await rect(page, '#stake-ob .pen-icon')), midX(c1), `${mode}: OB under 드라이버`);
        expectAligned(midX(await rect(page, '#stake-hazard .pen-icon')), midX(c3), `${mode}: 해저드 under 퍼터`);
        if (mode === '기본') {
          expectAligned((await rect(page, '#hole-info')).x, sheet.x, '기본: chips left edge');
          const info = await rect(page, '#info-btn');
          expectAligned(info.x + info.width, sheet.x + sheet.width, '기본: 홀 안내 on the right inset');
          await expect(page.locator('#stake-bunker')).toBeHidden();
          await tap(page, 'ob');
          await atRest(page);
          expectAligned(midX(await rect(page, '#pen-undo .u-ico')), midX(c2), '기본: 빼기 under 어프로치');
        } else {
          expectAligned(midX(await rect(page, '#stake-bunker .pen-icon')), midX(c2), '상세: 벙커 under 어프로치');
          // The 0 … 5+ picker spans the card, its first and last choice on the card's content edge.
          await longPressPen(page, 'hazard');
          const pick = await rect(page, '#numpick');
          expectAligned(pick.x, sheet.x, 'picker left edge');
          expectAligned(pick.x + pick.width, sheet.x + sheet.width, 'picker right edge');
          const choices = page.locator('#np-row button');
          expectAligned((await choices.first().boundingBox())!.x, c1.x, 'picker 0 on the content edge');
          const last = (await choices.last().boundingBox())!;
          expectAligned(last.x + last.width, c3.x + c3.width, 'picker 5+ on the content edge');
          await page.keyboard.press('Escape');
        }
      }
    });

    test('the menu button, the right-hand action and the card keep their place on every tab', async ({ page }) => {
      await open(page);
      await atRest(page);
      const menu = await rect(page, '#entry .top .menu');
      const sheet = await rect(page, '#sheet');
      const ver = await rect(page, '#app-version');
      await showCard(page);
      const cardMenu = await rect(page, '#card-view .sc-top .menu');
      for (const k of ['x', 'y', 'width', 'height'] as const) expectAligned(cardMenu[k], menu[k], `스코어카드 menu ${k}`);
      const edit = await rect(page, '#edit-par');
      expectAligned(edit.x + edit.width, ver.x + ver.width, '파 수정 right edge');
      expectAligned(midY(edit), midY(menu), '파 수정 middle');
      expectAligned(midX(await rect(page, '#card-view .sc-title')), width / 2, '스코어카드 title centre');
      const card = await rect(page, '#sc-sheet');
      expectAligned(card.x, sheet.x, 'card left edge');
      expectAligned(card.x + card.width, sheet.x + sheet.width, 'card right edge');
      await tab(page, '지난 라운드').click();
      await expect(page.locator('#hist-view')).toBeVisible();
      const histMenu = await rect(page, '#hist-view .sc-top .menu');
      for (const k of ['x', 'y', 'width', 'height'] as const) expectAligned(histMenu[k], menu[k], `지난 라운드 menu ${k}`);
      expectAligned(midX(await rect(page, '#hist-view .sc-title')), width / 2, '지난 라운드 title centre');
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
  // The tee line fits too, with the 미스샷 chip at its longest.
  await page.locator('#tee-miss').click();
  await page.locator('#tee-miss').click();
  await expect(page.locator('#tee-miss')).toHaveText('뒤땅/토핑');
  expect(await page.locator('#sheet').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  const line = (await page.locator('.tee-line').boundingBox())!;
  const chips = (await page.locator('.tee-chips').boundingBox())!;
  const said = (await page.locator('.tee-t').boundingBox())!;
  expect(chips.x + chips.width).toBeLessThanOrEqual(line.x + line.width + 0.5);
  expect(said.x + said.width).toBeLessThanOrEqual(chips.x);
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
  const checks = await measure(['.club-lbl', '#hole-par', '#prog-n', '#info-btn', '#hole-name', '.pen-lbl', '.mode', '.tab-label', '.ver', '.home-link']);
  await showCard(page);
  checks.push(...await measure(['.sh-stats dt', '.ct .ct-l', '.ct .r-p > span', '.nt-h small', '.nt-go', '.metrics dt']));
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
  expect(manifest).toMatchObject({
    name: 'Fairway Note', short_name: 'Fairway Note', start_url: './', scope: './', display: 'standalone',
    theme_color: '#2f7d3a', background_color: '#f3f7ef',
  });
  // The browser bar takes the same Turf as the installed app's.
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', manifest.theme_color);
  const decoded = (src: string) => page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return `${img.naturalWidth}x${img.naturalHeight}`;
  }, src);
  for (const icon of [...manifest.icons, { src: 'apple-touch-icon.png', sizes: '180x180' }] as { src: string; sizes: string }[]) {
    const response = await request.get(icon.src);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(await decoded(icon.src), icon.src).toBe(icon.sizes);
  }
  // The tab icon is generated by scripts/make-icons.mjs; decoding rejects if the SVG is broken.
  const favicon = (await page.locator('link[rel="icon"]').getAttribute('href'))!;
  await expect(decoded(favicon), favicon).resolves.toMatch(/^\d+x\d+$/);
});

/**
 * Lets the page copy and the test read what it copied. Chromium grants the clipboard permissions; WebKit cannot grant
 * them, so it gets a stand-in clipboard that keeps the copied text. The app's copy path is the same either way.
 */
async function useClipboard(page: Page, context: BrowserContext, browserName: string) {
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    return;
  }
  await page.addInitScript(() => {
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied = text; }, readText: async () => copied } });
  });
}

test('sends the round by email, shares it, or copies it', async ({ page, context, browserName }) => {
  await useClipboard(page, context, browserName);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
  });
  await open(page);
  await menu(page, '결과 보내기');
  await expect(page.locator('#send-actions')).toBeHidden();
  await closeMenu(page);
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await menu(page, '결과 보내기');
  const url = new URL((await page.getByRole('link', { name: '이메일로 보내기' }).getAttribute('href'))!);
  expect(url.protocol).toBe('mailto:');
  expect(url.searchParams.get('subject')).toMatch(/^에버리스 골프리조트 새별·레이크 \d{4}년 \d{1,2}월 \d{1,2}일 라운드 4타 \(E\)$/);
  expect(url.searchParams.get('body')).toContain('1번 Par4: 4타 (E) 드1 어1 퍼2');
  await page.getByRole('button', { name: '결과 복사' }).click();
  await expect(page.locator('#send-status')).toContainText('복사했습니다');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('1번 Par4: 4타 (E)');
});

test('saves the round as a CSV that Excel reads, and copies it as plain text for analysis', async ({ page, context, browserName }, testInfo) => {
  await useClipboard(page, context, browserName);
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'approach');
  await tap(page, 'putts', 2);
  await next(page).click();
  await menu(page, '결과 보내기');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV 저장' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^fairway-note-\d{4}-\d{2}-\d{2}\.csv$/);
  const file = testInfo.outputPath('round.csv');
  await download.saveAs(file);
  const bytes = readFileSync(file);
  // UTF-8 with a byte order mark, so Excel opens the Korean headers.
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const rows = bytes.subarray(3).toString('utf8').split('\r\n');
  expect(rows[0]).toBe('홀,파,드라이버,어프로치,퍼트,OB,해저드,타수,파 대비');
  expect(rows[1]).toBe('1,4,1,1,2,0,0,4,0');
  expect(rows[2]).toBe('2,4,,,,,,,');
  expect(rows[19]).toBe('합계,4,1,1,2,0,0,4,0');
  await expect(page.locator('#send-status')).toContainText('CSV 파일을 저장했어요');
  await page.getByRole('button', { name: '분석용 텍스트 복사' }).click();
  await expect(page.locator('#send-status')).toContainText('분석용 텍스트를 복사했어요');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('골프장: 에버리스 골프리조트');
  expect(text).toContain('코스: 전반 새별 · 후반 레이크');
  expect(text).toContain('1 | 4 | 1 | 1 | 2 | 0 | 0 | 4 | E');
  expect(text).toContain('[잃은 타수]');
  expect(text).not.toMatch(/https?:/);
  expect(await sideScroll(page)).toBe(0);
});

test('shares the round with the phone share sheet', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    navigator.share = async (data) => { (window as unknown as { shared: unknown[] }).shared.push(data); };
  });
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts', 2);
  await menu(page, '결과 보내기');
  await page.getByRole('button', { name: '공유하기' }).click();
  const shared = await page.evaluate(() => (window as unknown as { shared: { title: string; text: string }[] }).shared);
  expect(shared[0].title).toContain('3타 (-1)');
});

/* ---------- the summary's 공유: the round as an image (v16) ---------- */

type SharedData = { title?: string; text?: string; files: { name: string; type: string; size: number; head: number[] }[] };
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Stands in for the Web Share API: 'files' shares files too (as iPhone Safari does), 'text' shares only text, 'none'
 * has no share at all. Each share is kept in `window.shared`, with each file's name, type, size and first bytes.
 */
async function useShare(page: Page, mode: 'files' | 'text' | 'none') {
  await page.addInitScript((m) => {
    const w = window as unknown as { shared: unknown[] };
    w.shared = [];
    if (m === 'none') {
      Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: undefined });
      Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: undefined });
      return;
    }
    Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: (data?: ShareData) => (data?.files?.length ? m === 'files' : true) });
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: async (data: ShareData = {}) => {
        const files = [];
        for (const f of data.files ?? []) files.push({ name: f.name, type: f.type, size: f.size, head: [...new Uint8Array(await f.slice(0, 8).arrayBuffer())] });
        w.shared.push({ title: data.title, text: data.text, files });
      },
    });
  }, mode);
}

const sharedData = (page: Page) => page.evaluate(() => (window as unknown as { shared: SharedData[] }).shared);

/** Collects every request that leaves the page or sends something, as the first test in this file does. */
function outgoing(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || request.method() !== 'GET' || request.postData()) requests.push(request.url());
  });
  return requests;
}

/** The summary test's round (holes 1–3: a par, a birdie and a double with an OB, 14 strokes, +1), finished from 스코어카드. */
async function finishRound(page: Page) {
  await open(page);
  await seed(page, { 0: { driver: 1, approach: 1, putts: 2 }, 1: { driver: 1, approach: 1, putts: 1 }, 2: { driver: 1, ob: 1, approach: 3, putts: 2 } }, 3);
  await showCard(page);
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await expect(page.locator('#summary')).toBeVisible();
}

/** The preview: a tap on it does what the buttons do with the image, so it is kept out of the accessibility tree. */
const preview = (page: Page) => page.locator('#sum-card');
const previewImage = (page: Page) => preview(page).locator('img');

test('공유 in the summary shares the round as one PNG where the browser can share files', async ({ page }) => {
  await useShare(page, 'files');
  await finishRound(page);
  const summary = page.locator('#summary');
  // The image is drawn as the sheet opens, so 공유 can hand it over at once. Nothing to save where it can be shared.
  await expect(previewImage(page)).toBeVisible();
  await expect(page.locator('#sum-save')).toBeHidden();
  await expect(preview(page)).toHaveAttribute('aria-hidden', 'true');
  const date = (await stored(page)).date;
  await summary.getByRole('button', { name: '공유', exact: true }).click();
  await expect.poll(async () => (await sharedData(page)).length).toBe(1);
  const [data] = await sharedData(page);
  expect(data.files).toHaveLength(1);
  expect(data.files[0]).toMatchObject({ name: `fairway-note-${date}.png`, type: 'image/png', head: PNG_HEAD });
  expect(data.files[0].size).toBeGreaterThan(0);
  // The same title and text as the text share.
  expect(data.title).toMatch(/^에버리스 골프리조트 새별·레이크 \d{4}년 \d{1,2}월 \d{1,2}일 라운드 14타 \(\+1\)$/);
  expect(data.text).toContain('3번 Par5: 7타 (+2) 드1 어3 퍼2 OB 1');
  await expect(page.locator('#sum-status')).toHaveText('');
  // A tap on the preview, which carries a share badge, shares the same image.
  await expect(preview(page).locator('.b-share')).toBeVisible();
  await expect(preview(page).locator('.b-save')).toBeHidden();
  await preview(page).click();
  await expect.poll(async () => (await sharedData(page)).length).toBe(2);
  expect((await sharedData(page))[1].files).toEqual(data.files);
});

test('공유 in the summary shares the report text as before where the browser cannot share files, and the image can be saved', async ({ page }) => {
  await useShare(page, 'text');
  await finishRound(page);
  const summary = page.locator('#summary');
  await expect(previewImage(page)).toBeVisible();
  await summary.getByRole('button', { name: '공유', exact: true }).click();
  await expect.poll(async () => (await sharedData(page)).length).toBe(1);
  const [data] = await sharedData(page);
  expect(data.files).toEqual([]);
  expect(data.title).toMatch(/라운드 14타 \(\+1\)$/);
  expect(data.text).toContain('1번 Par4: 4타 (E) 드1 어1 퍼2');
  // The image the preview shows is still within reach: 이미지 저장 sits next to 공유.
  await expect(summary.getByRole('button', { name: '이미지 저장' })).toBeVisible();
});

test('without a share sheet the summary saves the image next to 결과 복사, which still copies the report', async ({ page, context, browserName }, testInfo) => {
  await useClipboard(page, context, browserName);
  await useShare(page, 'none');
  const requests = outgoing(page);
  await finishRound(page);
  const summary = page.locator('#summary');
  const date = (await stored(page)).date;
  const [download] = await Promise.all([page.waitForEvent('download'), summary.getByRole('button', { name: '이미지 저장' }).click()]);
  expect(download.suggestedFilename()).toBe(`fairway-note-${date}.png`);
  const file = testInfo.outputPath('card.png');
  await download.saveAs(file);
  const bytes = readFileSync(file);
  expect([...bytes.subarray(0, 8)]).toEqual(PNG_HEAD);
  // The IHDR chunk: 1080 wide, 1350 tall.
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1080, 1350]);
  await expect(page.locator('#sum-status')).toHaveText(`이미지를 저장했어요 (fairway-note-${date}.png).`);
  await summary.getByRole('button', { name: '결과 복사' }).click();
  await expect(page.locator('#sum-status')).toContainText('복사했습니다');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('1번 Par4: 4타 (E) 드1 어1 퍼2');
  // The preview carries a save badge, and a tap on it saves the same file.
  await expect(preview(page).locator('.b-save')).toBeVisible();
  await expect(preview(page).locator('.b-share')).toBeHidden();
  const [again] = await Promise.all([page.waitForEvent('download'), preview(page).click()]);
  expect(again.suggestedFilename()).toBe(`fairway-note-${date}.png`);
  expect(requests).toEqual([]);
});

test('the summary opens at once with a calm placeholder, then shows a small preview of the image', async ({ page }) => {
  // Holds the PNG encoding until the test lets it go.
  await page.addInitScript(() => {
    const w = window as unknown as { encode?: () => void };
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, ...args: Parameters<HTMLCanvasElement['toBlob']>) {
      w.encode = () => toBlob.apply(this, args);
    };
  });
  await useShare(page, 'files');
  await finishRound(page);
  // A plain deep-turf block, the image's own ground, with no badge until the image is there.
  await expect(preview(page)).toBeVisible();
  await expect(preview(page)).toHaveAttribute('data-state', 'drawing');
  await expect(previewImage(page)).toBeHidden();
  await expect(preview(page).locator('.sum-badge')).toBeHidden();
  expect(await preview(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(22, 48, 29)');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { encode?: () => void }).encode)).toBe('function');
  await page.evaluate(() => (window as unknown as { encode: () => void }).encode());
  await expect(previewImage(page)).toBeVisible();
  await expect(preview(page)).toHaveAttribute('data-state', 'ready');
  await expect(preview(page).locator('.sum-badge')).toBeVisible();
  await expect(previewImage(page)).toHaveAttribute('src', /^data:image\/png;base64,/);
  expect(await previewImage(page).evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([1080, 1350]);
});

test('a summary with no finished hole has no image to preview or save', async ({ page }) => {
  await useShare(page, 'none');
  await open(page);
  await showCard(page);
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#sum-vs')).toHaveText('기록한 홀이 없어요');
  await expect(preview(page)).toBeHidden();
  await expect(page.locator('#sum-save')).toBeHidden();
});

test('draws, previews and shares the image without any request or new storage', async ({ page }) => {
  const requests = outgoing(page);
  await useShare(page, 'files');
  await finishRound(page);
  await expect(previewImage(page)).toBeVisible();
  await page.locator('#summary').getByRole('button', { name: '공유', exact: true }).click();
  await expect.poll(async () => (await sharedData(page)).length).toBe(1);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => ({ keys: Object.keys(localStorage).sort(), sessionStorage: sessionStorage.length, cookies: document.cookie })))
    .toEqual({ keys: [PREFS_KEY, STORAGE_KEY].sort(), sessionStorage: 0, cookies: '' });
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
});

for (const [width, height] of [[360, 640], [390, 844]]) {
  test.describe(`the summary's image on a ${width}×${height} phone`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('lines the preview and the share and save buttons up with the sheet, without sideways scrolling', async ({ page, context, browserName }) => {
      // No share sheet: the action row is at its fullest, 결과 복사 and 이미지 저장 before email and 보관.
      await useClipboard(page, context, browserName);
      await useShare(page, 'none');
      await finishRound(page);
      await expect(previewImage(page)).toBeVisible();
      const summary = page.locator('#summary');
      // Measured at rest: once the sheet has slid up and the image has faded in.
      await summary.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
      // The sheet's inner edges: its box less its padding.
      const inner = await summary.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight), outerLeft: r.left, outerRight: r.right };
      });
      const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
      const ring = await box('#sum-ring');
      const card = await box('#sum-card');
      // The hero row runs from the inner left edge (the score ring) to the inner right edge (the preview), so it is
      // centred in the sheet. The preview is 4:5 like the image, smaller than the ring and centred on its line.
      expect(Math.abs(ring.x - inner.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(card.x + card.width - inner.right)).toBeLessThanOrEqual(1);
      expect(Math.abs((ring.x - inner.outerLeft) - (inner.outerRight - (card.x + card.width)))).toBeLessThanOrEqual(1);
      expect(Math.abs(card.y + card.height / 2 - (ring.y + ring.height / 2))).toBeLessThanOrEqual(1);
      expect(card.height).toBeLessThan(ring.height);
      expect(card.width / card.height).toBeCloseTo(0.8, 2);
      // It keeps clear of the close button above it.
      const close = await box('#sum-close');
      expect(card.y - (close.y + close.height)).toBeGreaterThanOrEqual(12);
      // The image fills the preview exactly, and the badge sits inside its corner.
      const image = (await previewImage(page).boundingBox())!;
      for (const [v, k] of [[image.x, card.x], [image.y, card.y], [image.width, card.width], [image.height, card.height]]) expect(Math.abs(v - k)).toBeLessThanOrEqual(0.5);
      const badge = await box('#sum-card .sum-badge');
      expect(badge.x).toBeGreaterThanOrEqual(card.x);
      expect(badge.y).toBeGreaterThanOrEqual(card.y);
      expect(Math.abs(card.x + card.width - (badge.x + badge.width) - (card.y + card.height - (badge.y + badge.height)))).toBeLessThanOrEqual(0.5);
      // One row of buttons from edge to edge: the same height, on one line, with equal gaps, each glyph centred.
      const row = [await box('#sum-share'), await box('#sum-save'), await box('#sum-mail'), await box('#sum-archive')];
      expect(Math.abs(row[0].x - inner.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(row[3].x + row[3].width - inner.right)).toBeLessThanOrEqual(1);
      const gaps = row.slice(1).map((b, k) => b.x - (row[k].x + row[k].width));
      for (const gap of gaps) expect(Math.abs(gap - gaps[0])).toBeLessThanOrEqual(1);
      for (const b of row) {
        expect(Math.abs(b.y - row[0].y)).toBeLessThanOrEqual(1);
        expect(Math.abs(b.height - row[0].height)).toBeLessThanOrEqual(1);
        expect(b.height).toBeGreaterThanOrEqual(48);
      }
      expect(Math.abs(row[0].width - row[1].width)).toBeLessThanOrEqual(1);
      for (const id of ['#sum-share', '#sum-save', '#sum-mail']) {
        const button = await box(id);
        const glyph = (await page.locator(`${id} svg`).boundingBox())!;
        expect(Math.abs(glyph.x + glyph.width / 2 - (button.x + button.width / 2)), id).toBeLessThanOrEqual(1);
        expect(Math.abs(glyph.y + glyph.height / 2 - (button.y + button.height / 2)), id).toBeLessThanOrEqual(1);
      }
      // 지난 라운드에 보관 stays on one line beside three round buttons.
      expect(await page.locator('#sum-archive').evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      })).toBe(1);
      expect(await sideScroll(page)).toBe(0);
      expect(await summary.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    });
  });
}

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
    const prompt = page.getByRole('button', { name: '새 버전이 있어요. 다시 열기' });
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
    // The dialog itself has focus: not the search box (no keyboard) and not 이 코스로 시작 (no ring nobody asked for).
    await expect(page.locator('#picker')).toBeFocused();
    await expect(page.locator('#picker-search')).not.toBeFocused();
    const start = (await page.getByRole('button', { name: '이 코스로 시작' }).boundingBox())!;
    expect(start.y + start.height).toBeLessThanOrEqual(553);
    expect(await sideScroll(page)).toBe(0);
    await page.locator('#picker-chosen').getByRole('radio', { name: '파인' }).nth(1).tap();
    await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트 새별·파인');
    await page.getByRole('button', { name: '이 코스로 시작' }).tap();
    await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·파인');
    const pars = await page.locator('#scorecard .r-p [data-col]').allTextContents();
    expect(pars.slice(9, 18)).toEqual(['4', '4', '4', '5', '3', '4', '4', '3', '5']);
    await expect(page.locator('#par-source a')).toHaveText('공식 스코어카드');
    await page.reload();
    await expect(page.locator('#picker')).toBeHidden();
    await page.getByRole('button', { name: '메뉴' }).tap();
    await page.locator('#menu .mi', { hasText: '새 라운드' }).tap();
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
    expect(new Set(await page.locator('#scorecard .r-p [data-col]').allTextContents())).toEqual(new Set(['4']));
    await expect(page.locator('#par-source')).toContainText('Par 4로 시작');
  });
});

test('keeps the pars of a round saved before courses could be chosen', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(([key, v]) => localStorage.setItem(key, v), [STORAGE_KEY, oldRound({ 0: { par: 3, driver: 1, putts: 2 } }, { date: '2026-11-19', lastEdited: Date.now() })]);
  await page.reload();
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·레이크');
  expect((await page.locator('#scorecard .r-p [data-col]').allTextContents()).slice(0, 3)).toEqual(['3', '4', '4']);
  await expect(page.locator('#sum-strokes')).toHaveText('3');
});

/* ---------- alignment (v17): one grid on 스코어카드, 지난 라운드 and 코스 선택 ---------- */

// Helper names are this block's own (spanOf, within1px …): other versions' tests define rect and atRest at the top level.
type Span = { x: number; y: number; width: number; height: number };
/** The box of every element matching `selector`, in document order. */
const spansOf = (page: Page, selector: string): Promise<Span[]> => page.locator(selector).evaluateAll((list) => list.map((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}));
async function spanOf(page: Page, selector: string): Promise<Span> {
  const [first] = await spansOf(page, selector);
  if (!first) throw new Error(`nothing matches ${selector}`);
  return first;
}
const endOf = (r: Span) => r.x + r.width;
const midOf = (r: Span) => r.x + r.width / 2;
/** Measure at rest: dialogs rise and sheets slide in for a moment when they open. */
const settled = (page: Page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
/** Within 1px: where the eye still reads one edge. */
function within1px(actual: number, expected: number, what: string) {
  expect(Math.abs(actual - expected), `${what}: ${actual.toFixed(1)} against ${expected.toFixed(1)}`).toBeLessThanOrEqual(1);
}
/** The alphabetic baseline of the first line of text in `selector`. */
const baselineOf = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent!.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  const text = walker.nextNode()!;
  const range = document.createRange();
  range.selectNodeContents(text);
  const style = getComputedStyle(text.parentElement!);
  const pen = document.createElement('canvas').getContext('2d')!;
  pen.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  // A line of text is drawn from the baseline less the font's ascent.
  return range.getClientRects()[0].top + pen.measureText(text.textContent!.trim()).fontBoundingBoxAscent;
});
/** Seven holes: par, birdie, double with an OB, bogey and worse on the front; two on the back. On hole 6. */
const SEVEN_HOLES = {
  0: { driver: 1, approach: 1, putts: 2 }, 1: { driver: 1, putts: 2 }, 2: { driver: 1, ob: 1, approach: 3, putts: 2 }, 3: { driver: 1, approach: 2, putts: 2 },
  4: { driver: 2, approach: 3, putts: 3 }, 9: { driver: 1, approach: 1, putts: 1 }, 10: { driver: 1, approach: 2, putts: 2 },
};

for (const [width, height] of [[360, 640], [375, 667], [390, 844]]) {
  test.describe(`lined up on a ${width}×${height} phone`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('스코어카드: the hero and headings on the table edges, marks in their columns, the total in the 전반/후반 column, the legend on the hero columns', async ({ page }) => {
      await open(page);
      // Before any hole the total column is as blank as the subtotals above it: a dash, no to-par.
      await tab(page, '스코어카드').tap();
      await expect(page.locator('#tot-strokes')).toHaveText('–');
      await expect(page.locator('#tot-topar')).toHaveText('');
      await seed(page, SEVEN_HOLES, 5);
      await tab(page, '스코어카드').tap();
      await settled(page);
      const table = await spanOf(page, '#scorecard .ct');
      // The ring, the 퍼트·OB·해저드 tiles and each nine's heading start and end on the table's edges.
      within1px((await spanOf(page, '#sh-ring')).x, table.x, 'ring');
      const tiles = await spansOf(page, '#sc-hero .sh-stats > div');
      within1px(tiles[0].x, table.x, 'tiles, left');
      within1px(endOf(tiles[2]), endOf(table), 'tiles, right');
      within1px((await spanOf(page, '#scorecard .nt-h b')).x, table.x, 'nine name');
      within1px(endOf(await spanOf(page, '#scorecard .nt-go')), endOf(table), '홀 고르기');
      // A score mark sits in the middle of its hole's column, under the hole number.
      const heads = await page.locator('#scorecard .r-h > [data-col]').evaluateAll((list) => Object.fromEntries(list.map((el) => {
        const r = el.getBoundingClientRect();
        return [(el as HTMLElement).dataset.col, r.x + r.width / 2];
      })));
      const marks = await page.locator('#scorecard .r-s > [data-col] .m').evaluateAll((list) => list.map((el) => {
        const r = el.getBoundingClientRect();
        return { col: (el.parentElement as HTMLElement).dataset.col!, x: r.x + r.width / 2 };
      }));
      expect(marks).toHaveLength(7);
      for (const m of marks) within1px(m.x, heads[m.col], `hole ${Number(m.col) + 1} mark`);
      // The round's total sits in the 전반/후반 column under the nines' subtotals; 합계 starts on the table's edge.
      within1px(midOf(await spanOf(page, '#tot-strokes')), midOf(await spanOf(page, '#scorecard .r-s > .ct-s')), '합계 in the 전반/후반 column');
      within1px((await spanOf(page, '#sc-sheet .tot h3')).x, table.x, '합계');
      // The legend's six marks sit on the hero tiles' three columns, under the 파 4 기준 line.
      const items = await spansOf(page, '#legend li:not(.lg-cap)');
      expect(items).toHaveLength(6);
      items.forEach((item, i) => within1px(item.x, tiles[i % 3].x, `legend item ${i + 1}`));
      // Both bar charts start and end their bars at the same x; text in a tile sits 12px in, in the hero and in 라운드 분석.
      const lost = await spanOf(page, '#lost-bars .bar');
      const spread = await spanOf(page, '#analysis .bar-track');
      within1px(lost.x, spread.x, 'bars, start');
      within1px(endOf(lost), endOf(spread), 'bars, end');
      within1px((await spanOf(page, '#sc-hero .sh-stats dt')).x - tiles[0].x, 12, 'hero tile text');
      const metric = await spanOf(page, '#analysis .metrics > div');
      within1px((await spanOf(page, '#analysis .metrics dt')).x - metric.x, 12, '분석 tile text');
      // 파 수정 brings the five-and-four tables: the heading and the hint keep their edges, the total its 전반 column.
      await page.locator('#edit-par').tap();
      await expect(page.locator('#edit-hint')).toBeVisible();
      await settled(page);
      const five = await spanOf(page, '#scorecard .tbl');
      within1px((await spanOf(page, '#scorecard .nine-h')).x, five.x, '파 수정 heading');
      const hint = await spanOf(page, '#edit-hint');
      within1px(hint.x, five.x, 'hint, left');
      within1px(endOf(hint), endOf(five), 'hint, right');
      within1px(midOf(await spanOf(page, '#tot-strokes')), midOf(await spanOf(page, '#scorecard .col.sub')), '합계 in 파 수정');
      expect(await sideScroll(page)).toBe(0);
    });

    test('지난 라운드: rows on the card edges, scores on their title baselines, an opened round’s total in its 전반/후반 column', async ({ page }) => {
      await open(page);
      await seed(page, SEVEN_HOLES, 5);
      await seedHistory(page, [10, 12, 8]);
      await tab(page, '지난 라운드').tap();
      await expect(pastItems(page)).toHaveCount(3);
      await settled(page);
      const card = await spanOf(page, '#history');
      const tiles = await spansOf(page, '#history-trends .metrics > div');
      // A row's text starts and ends where the trend tiles do; the card's first line sits as far from its top as from its side.
      within1px((await spanOf(page, '#history-list .past-when')).x, tiles[0].x, 'date');
      within1px((await spanOf(page, '#history-list .past-where')).x, tiles[0].x, 'course');
      within1px(endOf(await spanOf(page, '#history-list .past-score')), endOf(tiles[1]), 'score');
      within1px(endOf(await spanOf(page, '#history-list .past-meta')), endOf(tiles[1]), 'holes and putts');
      within1px(tiles[0].y - card.y, tiles[0].x - card.x, 'top inset');
      // 지금 라운드 puts its score on the title's baseline, as each row below does.
      within1px(await baselineOf(page, '#now-score'), await baselineOf(page, '#now-title'), '지금 라운드 score');
      within1px(await baselineOf(page, '#history-list .past-score'), await baselineOf(page, '#history-list .past-when'), 'row score');
      // An opened round: headings on the tables' edge, the total in the 전반/후반 column.
      await pastItems(page).first().tap();
      await expect(page.locator('#past')).toBeVisible();
      await settled(page);
      const five = await spanOf(page, '#past-scorecard .tbl');
      within1px((await spanOf(page, '#past-scorecard .nine-h')).x, five.x, 'nine heading');
      within1px(midOf(await spanOf(page, '#past-scorecard .tot-n')), midOf(await spanOf(page, '#past-scorecard .col.sub')), '합계 in the 전반/후반 column');
      // The round sits on paper: its analysis tiles must still show as tiles, or their 12px inset reads as a stray indent.
      const [tile, paper] = await page.evaluate(() => [document.querySelector('#past-analysis .metrics > div')!, document.querySelector('#past')!].map((el) => getComputedStyle(el).backgroundColor));
      expect(tile).not.toBe(paper);
      expect(await page.locator('#past').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    });

    test('코스 선택: search and rows share their edges, and the chosen course’s sheet lines up with them', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('#picker')).toBeVisible();
      await settled(page);
      const search = await spanOf(page, '.pk-search');
      const list = await spanOf(page, '#picker-list');
      within1px(search.x, list.x, 'search and list, left');
      within1px(endOf(search), endOf(list), 'search and list, right');
      // The search icon starts on the rows' text edge.
      within1px((await spanOf(page, '.pk-search svg')).x, (await spanOf(page, '#picker-list .course b')).x, 'search icon');
      // The chosen course's sheet: name, 18홀/9홀 and the start button on the list's edges.
      within1px((await spanOf(page, '#picker-label')).x, list.x, 'course name');
      within1px(endOf(await spanOf(page, '#picker-len')), endOf(list), '18홀/9홀');
      const start = await spanOf(page, '#picker-start');
      within1px(start.x, list.x, 'start, left');
      within1px(endOf(start), endOf(list), 'start, right');
      // 전반 and 후반 (새별, 레이크, 파인) as one grid: three equal columns, the 후반 row under the 전반 row, ending on the edge.
      const nines = await spansOf(page, '#picker-chosen .nine-pick button');
      expect(nines).toHaveLength(6);
      for (const [i, b] of nines.entries()) {
        within1px(b.width, nines[0].width, `nine ${i + 1} width`);
        within1px(b.x, nines[i % 3].x, `nine ${i + 1} column`);
      }
      within1px(endOf(nines[2]), endOf(list), 'nines, right');
    });
  });
}

for (const [width, height] of [[360, 640], [375, 553]]) {
  test.describe(`the first course picker on a ${width}×${height} phone`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('links back to the site, the only way out of the full-screen picker, on the title’s line', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('#picker')).toBeVisible();
      // The modal picker covers the tab bar and its 홈, so it carries its own link back (AGENTS.md: at every width).
      const home = page.locator('#picker a[href="../../"]');
      await expect(home).toHaveCount(1);
      await expect(home).toBeVisible();
      await expect(home).toHaveText('carpenta.github.io');
      await settled(page);
      const box = (await home.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(Math.min(box.x, box.y)).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(await sideScroll(page)).toBe(0);
      // It sits on the title's baseline, its right edge on the header's inner edge, where 취소 goes in the other modes.
      within1px(await baselineOf(page, '#picker a[href="../../"]'), await baselineOf(page, '#picker-title'), 'baseline');
      within1px(endOf(box), endOf(await spanOf(page, '.pk-search')), 'right edge');
      const size = await home.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(13);
      // From the menu's 새 라운드 the picker has 취소 back to the app (and its tab bar's 홈) in that place instead.
      await page.getByRole('button', { name: '이 코스로 시작' }).tap();
      await page.getByRole('button', { name: '메뉴' }).first().tap();
      await page.locator('#menu .mi', { hasText: '새 라운드' }).tap();
      await page.locator('#new-round').tap();
      await expect(page.locator('#picker')).toBeVisible();
      await expect(home).toBeHidden();
      await settled(page);
      within1px(endOf(await spanOf(page, '#picker-cancel')), endOf(await spanOf(page, '.pk-search')), '취소 right edge');
    });
  });
}

/* ---------- past rounds and backup ---------- */

const HISTORY_KEY = 'fairway-note:history:v1';
const pastItems = (page: Page) => page.locator('#history-list .past-item');

/** Opens the page with nothing saved and starts the course the picker offers. */
async function openRound(page: Page) {
  await open(page);
}

/** Shows the 지난 라운드 tab. */
async function showPast(page: Page) {
  await tab(page, '지난 라운드').click();
  await expect(page.locator('#history')).toBeVisible();
}

/** Opens the menu's 백업과 복원. */
async function showBackup(page: Page) {
  await menu(page, '백업과 복원');
  await expect(page.locator('#backup')).toBeVisible();
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

/** Starts a new round from the menu with the course the picker offers, and gives back what the menu said would happen. */
async function startNewRound(page: Page): Promise<string> {
  await menu(page, '새 라운드');
  const question = (await page.locator('#new-question').textContent())!;
  await page.locator('#new-round').click();
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

test.describe('saved records gone or unreadable', () => {
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  test('the first screen says when the saved round cannot be read, and restores it from a backup file', async ({ page }) => {
    await page.goto('/');
    // An ordinary first visit says nothing.
    await expect(page.locator('#picker')).toBeVisible();
    await expect(page.locator('#picker-missing')).toBeHidden();
    await page.evaluate((key) => localStorage.setItem(key, '{broken'), STORAGE_KEY);
    await page.reload();
    const card = page.locator('#picker-missing');
    await expect(card).toBeVisible();
    await expect(page.locator('#pm-title')).toHaveText('저장된 기록을 읽지 못했어요');
    expect(await sideScroll(page)).toBe(0);
    const file = pickable('restore.json', { app: 'fairway-note', format: 1, exportedAt: new Date().toISOString(), current: savedRound(today(), { driver: 1, approach: 1, putts: 2 }), history: [] });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '백업 파일에서 복원' }).click();
    const asked = accept(page);
    await (await chooser).setFiles(file);
    expect(await asked).toContain('진행 중이던 라운드');
    // The round is back: the picker closes on it.
    await expect(page.locator('#picker')).toBeHidden();
    await expect(page.locator('#hole-title')).toHaveText('2번 홀');
    await expect(page.locator('#prog-n')).toHaveText('1홀까지');
  });

  test('a home-screen app that opens with nothing stored says records may have been cleared, and takes back past rounds', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
    await page.goto('/');
    const card = page.locator('#picker-missing');
    await expect(card).toBeVisible();
    await expect(page.locator('#pm-title')).toHaveText('저장된 기록을 찾지 못했어요');
    // A backup with past rounds only: the card says what came back, and the course is still to choose.
    const file = pickable('past.json', { app: 'fairway-note', format: 1, exportedAt: new Date().toISOString(), current: null, history: [{ id: 'r1', endedAt: Date.now(), round: savedRound('2026-11-01', { driver: 1, approach: 1, putts: 2 }) }] });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '백업 파일에서 복원' }).click();
    await (await chooser).setFiles(file);
    await expect(page.locator('#pm-status')).toContainText('지난 라운드 1개를 가져왔습니다');
    await expect(page.locator('#picker')).toBeVisible();
    await page.locator('#pm-close').click();
    await expect(card).toBeHidden();
    await expect(page.getByRole('button', { name: '이 코스로 시작' })).toBeFocused();
    await page.getByRole('button', { name: '이 코스로 시작' }).click();
    await showPast(page);
    await expect(pastItems(page)).toHaveCount(1);
  });
});

test('keeps a finished round among past rounds when a new one starts', async ({ page }) => {
  await openRound(page);
  await showPast(page);
  await expect(page.getByRole('heading', { name: '지난 라운드' })).toBeVisible();
  await expect(page.locator('#history-empty')).toBeVisible();
  await showEntry(page);
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
  await expect(item.locator('.past-meta')).toHaveText('2홀, 퍼트 4, OB 1');
  await expect(page.locator('#history-empty')).toBeHidden();
  await expect(page.locator('#history-status')).toContainText('라운드를 지난 라운드에 보관했습니다');
  // Kept under its own key next to the new round, and still there after a reload.
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual([HISTORY_KEY, PREFS_KEY, STORAGE_KEY].sort());
  await page.reload();
  await expect(pastItems(page)).toHaveCount(1);

  // A round with nothing finished is not kept, and the question says so.
  await tap(page, 'driver');
  expect(await startNewRound(page)).toBe('끝낸 홀이 없어 지난 라운드에 보관하지 않습니다. 지금 라운드를 지우고 새로 시작할까요?');
  await expect(page.locator('#badge')).toHaveAttribute('data-tone', 'none');
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

  await showPast(page);
  await pastItems(page).first().click();
  const dialog = page.locator('#past');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#past-title')).toHaveText(/^\d{4}년 \d{1,2}월 \d{1,2}일 라운드$/);
  await expect(page.locator('#past-course')).toHaveText('에버리스 골프리조트 새별·레이크');
  await expect(dialog.locator('.scorecard')).toHaveCount(2);
  // Read-only: no links to holes, no par buttons and nothing to tap a stroke into.
  await expect(dialog.locator('.scorecard button, .step, .pen')).toHaveCount(0);
  await expect(dialog.locator('.col.sub .sub-v').first()).toHaveText('7');
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
  await showBackup(page);
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
  expect(backup.history[0].round.holes[0]).toMatchObject({ driver: 1, approach: 1, putts: 2, hazard: 0 });
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
  await showBackup(other);
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
  await showPast(page);
  await pastItems(page).first().click();
  await expect(page.locator('#past .scorecard')).toHaveCount(2);
  await page.getByRole('button', { name: '닫기' }).click();
  await showBackup(page);
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
  await menu(page, '이 홀 멀리건');
  await page.getByRole('button', { name: '멀리건 하나 더하기' }).click();
  await closeMenu(page);
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
  await showBackup(page);
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
  await showBackup(page);
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
      await tab(page, '지난 라운드').tap();
      await expect(page.locator('#history')).toBeVisible();
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
      // The end of the list stays clear of the tab bar.
      await page.locator('#hist-view').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      const bar = (await page.locator('#views').boundingBox())!;
      const lastItem = (await pastItems(page).last().boundingBox())!;
      expect(lastItem.y + lastItem.height).toBeLessThanOrEqual(bar.y);

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
      // The backup buttons sit in the menu, inside the screen.
      await page.getByRole('button', { name: '메뉴' }).tap();
      await page.locator('#menu .mi', { hasText: '백업과 복원' }).tap();
      for (const name of ['백업 파일 저장', '백업 파일 가져오기']) {
        const button = (await page.getByRole('button', { name }).boundingBox())!;
        expect(button.y + button.height, name).toBeLessThanOrEqual(height);
        expect(button.height, name).toBeGreaterThanOrEqual(44);
      }
      expect(await page.locator('#menu').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    });
  });
}

/* ---------- 클럽 상세 패널 (v17): a tap on a club's number opens that club's shot details for this hole ---------- */

const panel = (page: Page) => page.locator('#shot-panel');
const numberOf = (page: Page, key: string) => page.locator(`.club-${key} .shot-num`);
const panelChip = (page: Page, name: string) => panel(page).locator('#sp-chips').getByRole('button', { name, exact: true });
const panelShot = (page: Page, index: number) => panel(page).locator(`#sp-shots [data-shot="${index}"]`);
/** What the panel calls one of the club's shots: 1번째 티샷, 2번째 샷, 2번째 퍼트. */
const NOUN: Record<string, string> = { driver: '티샷', approach: '샷', putts: '퍼트' };
/** Each club's chips row by row: left, the target and right, then long and short, then the rest. */
const PANEL_CHIPS: Record<string, string[]> = {
  driver: ['좌', '페어웨이', '우', '김', '짧음', '많이 좌', '헛스윙', '많이 우', '좌 OB', '뒤땅/토핑', '우 OB'],
  approach: ['좌', '온그린', '우', '김', '짧음', '해저드', '헛스윙'],
  putts: ['좌', '들어감', '우', '김', '짧음'],
};

test('a tap on a club’s number opens its detail panel; a chip records the shot, sends and stores nothing new, and survives a reload', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || request.method() !== 'GET' || request.postData()) requests.push(request.url());
  });
  await open(page);
  await expect(panel(page)).toBeHidden();
  const picks: [string, string][] = [['approach', '해저드'], ['driver', '우'], ['putts', '들어감']];
  for (const [key, chip] of picks) {
    await tap(page, key);
    const num = numberOf(page, key);
    await expect(num).toHaveAccessibleName(`${LABEL[key]} 1, 샷 세부`);
    await num.click();
    await expect(page.getByRole('dialog', { name: `${LABEL[key]} 1번째 ${NOUN[key]}` })).toBeVisible();
    await expect(num).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page).locator('#sp-chips button:visible')).toHaveText(PANEL_CHIPS[key]);
    // One shot: nothing to choose between.
    await expect(panel(page).locator('#sp-shots')).toBeHidden();
    await panelChip(page, chip).click();
    await expect(panelChip(page, chip)).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page).locator('#sp-chips [aria-pressed="true"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    // A quiet dot on the number says the club has details on this hole.
    await expect(num).toHaveClass(/tagged/);
    await expect(num).toHaveAccessibleName(`${LABEL[key]} 1, 샷 세부 1개`);
  }
  await expect(page.locator('#hole-strokes')).toHaveText('3');
  expect((await stored(page)).holes[0].tags).toEqual({ driver: ['right'], approach: ['hazard'], putts: ['in'] });

  await page.reload();
  for (const [key, chip] of picks) {
    await expect(numberOf(page, key)).toHaveClass(/tagged/);
    await numberOf(page, key).click();
    await expect(panelChip(page, chip)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
  }
  // The analysis and the report carry them, as on the live site.
  await showCard(page);
  await expect(page.locator('#analysis .details')).toContainText('어프로치: 해저드 1');

  expect(requests).toEqual([]);
  expect(await page.evaluate(() => ({ keys: Object.keys(localStorage).sort(), sessionStorage: sessionStorage.length, cookies: document.cookie })))
    .toEqual({ keys: [PREFS_KEY, STORAGE_KEY].sort(), sessionStorage: 0, cookies: '' });
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
});

test('+ and − change a club’s count in one tap and never open its panel', async ({ page }) => {
  await open(page);
  for (const key of ['driver', 'approach', 'putts']) {
    await tap(page, key);
    await expect(count(page, key)).toHaveText('1');
    await tap(page, key);
    await expect(count(page, key)).toHaveText('2');
    await page.getByRole('button', { name: `${LABEL[key]} 하나 빼기` }).click();
    await expect(count(page, key)).toHaveText('1');
    await expect(panel(page)).toBeHidden();
  }
  await expect(page.locator('#hole-strokes')).toHaveText('3');
  await expect(page.locator('#toast-msg')).toHaveText('퍼터 −1');
});

test('a long press on a club’s number still opens the 0 … 5+ picker, never the panel', async ({ page }) => {
  await open(page);
  await longPress(page, 'approach');
  await expect(page.locator('#np-title')).toHaveText('어프로치 몇 번 쳤나요?');
  await expect(panel(page)).toBeHidden();
  await page.getByRole('button', { name: '2번', exact: true }).click();
  await expect(page.locator('#numpick')).toBeHidden();
  await expect(count(page, 'approach')).toHaveText('2');
  await expect(page.locator('#toast-msg')).toHaveText('어프로치 2로');
  await expect(panel(page)).toBeHidden();
  // Once more with details on the club: the picker, not the panel.
  await numberOf(page, 'approach').click();
  await panelChip(page, '짧음').click();
  await page.keyboard.press('Escape');
  await longPress(page, 'approach');
  await expect(panel(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#numpick')).toBeHidden();
  await expect(count(page, 'approach')).toHaveText('2');
});

test('Escape, the close button and a tap outside close the panel, and focus goes back to the number', async ({ page }) => {
  await open(page);
  await tap(page, 'putts');
  const num = numberOf(page, 'putts');
  await expect(num).toHaveAttribute('aria-haspopup', 'dialog');
  await num.click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(num).toBeFocused();
  await expect(num).toHaveAttribute('aria-expanded', 'false');
  await num.click();
  await panel(page).getByRole('button', { name: '닫기' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(num).toBeFocused();
  const menuButton = (await page.locator('#entry [data-menu]').boundingBox())!;
  await num.click();
  // A tap on the dim backdrop, outside the panel, closes it without pressing what is under it (the menu button).
  await page.mouse.click(menuButton.x + menuButton.width / 2, menuButton.y + menuButton.height / 2);
  await expect(panel(page)).toBeHidden();
  await expect(num).toBeFocused();
  await expect(page.locator('#menu')).toBeHidden();
  // From the keyboard: Enter opens it, Tab stays inside, Escape gives focus back.
  await num.press('Enter');
  await expect(panel(page)).toBeVisible();
  await focusStaysIn(page, 'shot-panel');
  await page.keyboard.press('Escape');
  await expect(num).toBeFocused();
  await expect(count(page, 'putts')).toHaveText('1');
});

test('picks which shot to detail: the last first, the detailed ones marked, the same chip clears it, and from 0 a chip counts the first', async ({ page }) => {
  await open(page);
  const num = numberOf(page, 'putts');
  await num.click();
  await expect(page.locator('#sp-shot')).toHaveText('고르면 1타가 더해져요');
  await panelChip(page, '짧음').click();
  await expect(count(page, 'putts')).toHaveText('1');
  await expect(page.locator('#sp-shot')).toHaveText('1번째 퍼트');
  await expect(panelChip(page, '짧음')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  await tap(page, 'putts');
  await num.click();
  await expect(page.locator('#sp-shot')).toHaveText('2번째 퍼트');
  await expect(panel(page).locator('#sp-shots button')).toHaveText(['1', '2']);
  await expect(panelShot(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(panelShot(page, 0)).toHaveClass(/tagged/);
  await expect(panelShot(page, 0)).toHaveAccessibleName('1번째 퍼트, 짧음');
  await expect(panelShot(page, 1)).not.toHaveClass(/tagged/);
  await panelChip(page, '들어감').click();
  await expect(panelShot(page, 1)).toHaveClass(/tagged/);
  await panelShot(page, 0).click();
  await expect(page.locator('#sp-shot')).toHaveText('1번째 퍼트');
  await expect(panelChip(page, '짧음')).toHaveAttribute('aria-pressed', 'true');
  await expect(panelChip(page, '들어감')).toHaveAttribute('aria-pressed', 'false');
  // The same chip again clears it; the count stays.
  await panelChip(page, '짧음').click();
  await expect(panelChip(page, '짧음')).toHaveAttribute('aria-pressed', 'false');
  await expect(count(page, 'putts')).toHaveText('2');
  expect((await stored(page)).holes[0].tags).toEqual({ putts: [null, 'in'] });
  await page.keyboard.press('Escape');
  await expect(num).toHaveAccessibleName('퍼터 2, 샷 세부 1개');
  // Minus takes the last shot away with its detail.
  await page.getByRole('button', { name: '퍼터 하나 빼기' }).click();
  await expect(num).not.toHaveClass(/tagged/);
  expect((await stored(page)).holes[0].tags).toBeUndefined();
});

test('an OB chip for a drive adds the OB penalty once, and clearing it takes it back', async ({ page }) => {
  await open(page);
  await tap(page, 'driver');
  await numberOf(page, 'driver').click();
  await panelChip(page, '좌 OB').click();
  await expect(page.locator('#stake-ob .pen-count')).toHaveText('1');
  await expect(page.locator('#hole-strokes')).toHaveText('2');
  await panelChip(page, '우 OB').click();
  await expect(page.locator('#stake-ob .pen-count')).toHaveText('1');
  await expect(panelChip(page, '좌 OB')).toHaveAttribute('aria-pressed', 'false');
  await panelChip(page, '우 OB').click();
  await expect(page.locator('#stake-ob .pen-count')).toHaveClass(/zero/);
  await expect(page.locator('#hole-strokes')).toHaveText('1');
  // On a par 3 the tee shot's target reads 온그린, as on the 상세 pad.
  await page.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) await page.locator('#next-hole').click();
  await expect(page.locator('#hole-par')).toHaveText('Par 3');
  await numberOf(page, 'driver').click();
  await expect(page.getByRole('dialog', { name: '티샷 고르면 1타가 더해져요' })).toBeVisible();
  await expect(panel(page).locator('#sp-chips button').nth(1)).toHaveText('온그린');
});

test('shows the details of a round saved by the live site in each club’s panel, and keeps them', async ({ page }) => {
  // As the live site saves it: no hazard field, details on drives, approaches and putts, and an OB added by a tag.
  const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 })) as Record<string, unknown>[];
  holes[0] = { par: 4, driver: 1, approach: 2, putts: 2, ob: 0, mulligan: 0, tags: { driver: ['fairway'], approach: ['short', 'green'], putts: ['long', 'in'] } };
  holes[1] = { par: 4, driver: 2, approach: 1, putts: 1, ob: 1, mulligan: 0, tags: { driver: ['ob-right', 'left'], approach: ['bunker'], putts: ['in'] }, obByTag: 1 };
  const value = JSON.stringify({ version: 1, date: '2026-11-19', current: 0, holes, lastEdited: Date.now(), course: { id: 'everis', name: '에버리스 골프리조트', front: '새별', back: '레이크' } });
  await page.goto('/');
  await page.evaluate(([key, v]) => localStorage.setItem(key, v), [STORAGE_KEY, value]);
  await page.reload();
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#notice')).toBeHidden();
  for (const key of ['driver', 'approach', 'putts']) await expect(numberOf(page, key)).toHaveClass(/tagged/);
  await numberOf(page, 'putts').click();
  await expect(page.locator('#sp-shot')).toHaveText('2번째 퍼트');
  await expect(panelChip(page, '들어감')).toHaveAttribute('aria-pressed', 'true');
  await panelShot(page, 0).click();
  await expect(panelChip(page, '김')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await numberOf(page, 'approach').click();
  await expect(panelChip(page, '온그린')).toHaveAttribute('aria-pressed', 'true');
  await panelShot(page, 0).click();
  await expect(panelChip(page, '짧음')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  // The next tap saves the round again with every detail kept, and nothing is set aside.
  await tap(page, 'putts');
  await expect(count(page, 'putts')).toHaveText('3');
  const saved = (await stored(page)).holes;
  expect(saved[0].tags).toEqual({ driver: ['fairway'], approach: ['short', 'green'], putts: ['long', 'in'] });
  expect(saved[1]).toMatchObject({ ob: 1, obByTag: 1, tags: { driver: ['ob-right', 'left'], approach: ['bunker'], putts: ['in'] } });
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('fairway-note:corrupt:')))).toEqual([]);
  // The live site's approach 벙커 has no chip now (상세's 벙커 counts it), but a shot that has it shows it, to clear.
  await next(page).click();
  await numberOf(page, 'approach').click();
  await expect(panelChip(page, '벙커')).toHaveAttribute('aria-pressed', 'true');
  await panelChip(page, '벙커').click();
  await expect(panelChip(page, '벙커')).toBeHidden();
  await expect(panel(page).locator('#sp-chips button:visible')).toHaveText(PANEL_CHIPS.approach);
  await page.keyboard.press('Escape');
  expect((await stored(page)).holes[1].tags).toEqual({ driver: ['ob-right', 'left'], putts: ['in'] });
});

test('큰 글씨 keeps every chip of the panel whole and inside it at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await open(page);
  await menu(page);
  await page.getByRole('switch', { name: /큰 글씨/ }).click();
  await closeMenu(page);
  for (const key of ['driver', 'approach', 'putts']) {
    await tap(page, key, 2);
    await numberOf(page, key).click();
    await expect(panel(page)).toBeVisible();
    // Each label's text box stays inside its button (the buttons' touch areas reach past them, so scroll sizes say nothing).
    const cut = await panel(page).locator('#sp-shots button, #sp-chips button, .sp-title span').evaluateAll((list) => list.filter((b) => {
      const range = document.createRange();
      range.selectNodeContents(b);
      const text = range.getBoundingClientRect();
      const box = b.getBoundingClientRect();
      return text.width === 0 || text.left < box.left - 0.5 || text.right > box.right + 0.5 || text.top < box.top - 0.5 || text.bottom > box.bottom + 0.5;
    }).map((b) => b.textContent));
    expect(cut, key).toEqual([]);
    expect(await panel(page).evaluate((el) => el.scrollWidth - el.clientWidth), key).toBe(0);
    expect(await sideScroll(page), key).toBe(0);
    await page.keyboard.press('Escape');
  }
});

for (const [width, height] of [[360, 640], [375, 667], [390, 844]]) {
  test.describe(`club detail panel on a ${width}×${height} phone`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('lines its edges up with the card’s inner edges, sets its chips on a grid of 48px targets, and never scrolls sideways', async ({ page }) => {
      await open(page);
      // The card's inner edges: the sheet's content box, measured at rest.
      const inner = await page.locator('#sheet').evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return { left: r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight) };
      });
      for (const key of ['driver', 'approach', 'putts']) {
        for (const shots of [1, 2]) {
          await page.locator(`.club-${key} .plus`).tap();
          await expect(count(page, key)).toHaveText(String(shots));
          await numberOf(page, key).tap();
          await expect(panel(page)).toBeVisible();
          await expect(panel(page).locator('#sp-shots')).toBeVisible({ visible: shots > 1 });
          await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
          const geo = await panel(page).evaluate((el) => {
            const box = (e: Element) => {
              const r = e.getBoundingClientRect();
              // A target grows by an invisible ::after touch area where it has one.
              const a = getComputedStyle(e, '::after');
              const grow = (v: string) => (a.content !== 'none' && a.position === 'absolute' ? Math.max(0, -parseFloat(v) || 0) : 0);
              return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width + grow(a.left) + grow(a.right), h: r.height + grow(a.top) + grow(a.bottom) };
            };
            return {
              panel: box(el),
              overflow: el.scrollWidth - el.clientWidth,
              chips: [...el.querySelectorAll('#sp-chips button')].filter((b) => b.getClientRects().length).map(box),
              targets: [...el.querySelectorAll('button')].filter((b) => b.getClientRects().length).map(box),
            };
          });
          const where = `${key} with ${shots} at ${width}×${height}`;
          expect(Math.abs(geo.panel.l - inner.left), where).toBeLessThanOrEqual(1);
          expect(Math.abs(geo.panel.r - inner.right), where).toBeLessThanOrEqual(1);
          expect(geo.panel.t, where).toBeGreaterThanOrEqual(0);
          // It ends above the tab bar, never cutting through the tab names.
          const bar = (await page.locator('#views').boundingBox())!;
          expect(geo.panel.b, where).toBeLessThanOrEqual(bar.y - 7.5);
          expect(geo.overflow, where).toBe(0);
          expect(await sideScroll(page), where).toBe(0);
          // The chips sit on one grid: rows share their top and height, every row runs from the same left edge to
          // the same right edge, three-across columns line up from row to row, and the grid is centred in the panel.
          const rows: (typeof geo.chips)[] = [];
          for (const chip of geo.chips) {
            const row = rows.find((r) => Math.abs(r[0].t - chip.t) < 0.5);
            if (row) row.push(chip);
            else rows.push([chip]);
          }
          const left = rows[0][0].l;
          const right = rows[0][rows[0].length - 1].r;
          const thirds = rows.filter((r) => r.length === 3);
          for (const row of rows) {
            expect([2, 3], where).toContain(row.length);
            expect(Math.abs(row[0].l - left), where).toBeLessThanOrEqual(0.5);
            expect(Math.abs(row[row.length - 1].r - right), where).toBeLessThanOrEqual(0.5);
            for (const chip of row) expect(Math.abs(chip.b - chip.t - (row[0].b - row[0].t)), where).toBeLessThanOrEqual(0.5);
          }
          for (const row of thirds) row.forEach((chip, k) => expect(Math.abs(chip.l - thirds[0][k].l), where).toBeLessThanOrEqual(0.5));
          const gap = rows[1][0].t - rows[0][0].b;
          expect(Math.abs(rows[0][1].l - rows[0][0].r - gap), where).toBeLessThanOrEqual(0.5);
          expect(Math.abs(left - geo.panel.l - (geo.panel.r - right)), where).toBeLessThanOrEqual(0.5);
          for (const target of geo.targets) expect(Math.min(target.w, target.h), where).toBeGreaterThanOrEqual(48);
          await panel(page).getByRole('button', { name: '닫기' }).tap();
          await expect(panel(page)).toBeHidden();
        }
      }
      // A plus is still one tap with the details on.
      await page.locator('.club-putts .plus').tap();
      await expect(count(page, 'putts')).toHaveText('3');
      await expect(panel(page)).toBeHidden();
    });
  });
}
