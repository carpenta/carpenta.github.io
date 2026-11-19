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
const tab = (page: Page, name: '기록' | '스코어카드' | '지난 라운드') => page.getByRole('tab', { name });
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
  await expect(page.locator('#hole-strokes')).toHaveText('–');
  await expect(page.locator('#hole-name')).toHaveText('기록 전');
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
  await expect(page.locator('#prog-n')).toHaveText('기록한 홀 1홀');
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
  await expect(page.locator('#prog-n')).toHaveText('기록한 홀 3홀');
  await expect(page.locator('#prog-p')).toHaveText('파 대비 +1');
  await expect(page.locator('#prog-p')).not.toHaveClass(/under/);

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
  await expect(badge).toHaveAttribute('aria-label', '이 홀 2타, 이글');
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
  await expect(page.locator('#app-version')).toHaveText('v11');
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

test('keeps mulligans, the course and the version in the menu, one panel open at a time', async ({ page }) => {
  await open(page);
  await menu(page);
  await expect(page.locator('#menu-version')).toHaveText('v11');
  await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·레이크');
  // Every item is a 48px button that opens its own panel and closes the one open before.
  for (const item of await page.locator('#menu .mi').all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await page.locator('#menu .mi', { hasText: '앱 정보' }).click();
  await expect(page.locator('#mp-about')).toContainText('Fairway Note v11');
  await page.locator('#menu .mi', { hasText: '이 홀 멀리건' }).click();
  await expect(page.locator('#mp-about')).toBeHidden();
  await page.getByRole('button', { name: '멀리건 하나 더하기' }).click();
  await expect(page.locator('#mulligan-count')).toHaveText('1');
  await expect(page.locator('#mulligan-sub')).toHaveText('1번 홀 1개 · 타수에 넣지 않아요');
  await closeMenu(page);
  // A mulligan alone does not record the hole.
  await expect(page.locator('#hole-name')).toHaveText('기록 전');
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
  await expect(page.locator('#scorecard .col[data-hole] .pr').first()).toHaveText('3');
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
  await expect(page.locator('#hole-distance')).toHaveText('151m');
  await expect(course.locator('.water')).toHaveCount(0);
  // 새별 7 is an island green by the course's own guide: the only hole drawn with water.
  await showCard(page);
  await page.locator('#scorecard [data-hole="6"]').click();
  await expect(page.locator('#hole-notes li')).toContainText(['아일랜드 홀']);
  await expect(course.locator('.water')).toHaveCount(1);
});

test.describe('with hole notes in the course data', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('shows the length, handicap, layout note and official guide link, and bends a dogleg', async ({ page }) => {
    await open(page);
    // Everis 새별 1 as its own hole guide gives it: one length with no tee name, the handicap and a short note.
    await expect(page.locator('#hole-distance')).toHaveText('381m');
    // One header row: Par, length and HDCP in one pill; the note's phrases and the guide behind one 홀 안내 chip.
    await expect(page.locator('#hole-hdcp')).toHaveText('HDCP 3');
    expect((await page.locator('#hole-info').boundingBox())!.height).toBeLessThanOrEqual(34);
    const infoBtn = page.getByRole('button', { name: '홀 안내, 특징 3개' });
    await expect(page.locator('#info-n')).toHaveText('3');
    await infoBtn.click();
    await expect(page.locator('#hole-pop')).toBeVisible();
    await expect(infoBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#hi-title')).toHaveText('1번 홀 안내');
    await expect(page.locator('#hi-facts')).toHaveText('Par 4 · 381m · HDCP 3');
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
    await page.locator('#scorecard [data-hole="9"]').click();
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
  await page.locator('#scorecard [data-hole="4"]').click();
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
  await expect(page.locator('#prog-n')).toHaveText('기록한 홀 3홀');
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
  await expect(page.locator('#badge')).toHaveAttribute('aria-label', '이 홀 7타, 트리플 보기');
  // Escape closes the strip and keeps the hole.
  await holeBtn.click();
  await page.keyboard.press('Escape');
  await expect(strip).toBeHidden();
  await expect(holeBtn).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
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
  await expect(page.locator('#hole-strokes')).toHaveText('–');
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
  await expect(page.locator('#scorecard .scorecard')).toHaveCount(1);
  await expect(page.locator('#scorecard .nine-h')).toHaveText('레이크9홀');
  await expect(page.locator('#scorecard .col.sub .no')).toHaveText(['합계']);
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
      if (height < 600) await expect(page.locator('#hole-sub')).toHaveText('Par 4 · 376m');
      await check();
      for (const button of await page.locator('#pad button').all()) {
        const box = (await button.boundingBox())!;
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(48);
      }
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

test('sends the round by email, shares it, or copies it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
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

test('saves the round as a CSV that Excel reads, and copies it as plain text for analysis', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
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
    await expect(page.locator('#prog-n')).toHaveText('기록한 홀 1홀');
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
  await expect(page.locator('#hole-strokes')).toHaveText('–');
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
