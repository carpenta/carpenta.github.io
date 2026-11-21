import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const STORAGE_KEY = 'fairway-note:round:v1';
const PREFS_KEY = 'fairway-note:prefs:v1';
const LABEL: Record<string, string> = { driver: '드라이버', approach: '그린까지', second: '세컨', short: '어프로치', putts: '퍼터', ob: 'OB', hazard: '해저드' };
/** The capsules each mode shows, left to right (v28): 기본's three, 상세's four with the middle count split. */
const KEYS = { 기본: ['driver', 'approach', 'putts'], 상세: ['driver', 'second', 'short', 'putts'] } as const;

/** Opens the tool with nothing saved and accepts the course the picker offers (Everis 새별·레이크 by default). */
async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await expect(page.locator('#picker')).toBeHidden();
}

/**
 * Starts a round on another course from the picker's search. Since v27 Everis is drawn from OpenStreetMap, so the
 * schematic's own tests run on courses it does not draw (에코랜드, 라온).
 */
async function openCourse(page: Page, query: string, name: string) {
  await page.goto('/');
  await page.getByRole('searchbox', { name: '골프장 검색' }).fill(query);
  await page.locator('#picker-list button', { hasText: name }).click();
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
/** A palette token (style.css) as the browser computes it, to compare with an element's computed colour (v19). */
const token = (page: Page, name: string) => page.evaluate((n) => {
  const probe = document.createElement('i');
  probe.style.color = `var(${n})`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, name);

async function showCard(page: Page) {
  await tab(page, '스코어카드').click();
  await expect(page.locator('#card-view')).toBeVisible();
}

/** Opens hole `index` from 스코어카드: the hole's column opens it in 기록 in one tap (v23). */
async function pickHole(page: Page, index: number) {
  await showCard(page);
  await page.locator(`#scorecard button[data-hole="${index}"]`).click();
  await expect(page.locator('#entry')).toBeVisible();
  // The hole by its number and the button's name: the words beside the number may shorten to 번 on a narrow screen
  // (v25, tested on their own).
  await expect(page.locator('#hole-n')).toHaveText(String(index + 1));
  await expect(page.locator('#hole-btn')).toHaveAttribute('aria-label', new RegExp(`^${index + 1}번 홀, `));
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
  // The 60px badge says 더블, as the scorecard's marks do; its spoken name keeps the whole word.
  await expect(page.locator('#hole-name')).toHaveText('더블');
  await expect(page.locator('#badge')).toHaveAttribute('aria-label', '이 홀 6타 더블 보기');
  const [word, ring] = [(await page.locator('#hole-name').boundingBox())!, (await page.locator('#badge').boundingBox())!];
  expect(word.width).toBeLessThanOrEqual(ring.width - 12);

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
  await expect(page.locator('#scorecard [data-hole="1"] .c-score .m')).toHaveAttribute('data-mark', 'double');

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
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '그린까지 하나 빼기' }).click();
  await expect(page.locator('#hole-strokes')).toHaveText('3');
  await expect(mark).toHaveAttribute('data-mark', 'birdie');
  await expect(shape.locator('circle')).toHaveCount(1);
  await expect(badge).toHaveClass(/celebrate/);
  expect(await badge.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--red'));
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
  // The page speaks 해요체 (v29); the outgoing report keeps its formal sentence.
  await expect(page.locator('#analysis')).toContainText('해저드 1회로 벌타 1타가 더해졌어요.');
});

test('records the tee shot on the 상세 pad as the first drive’s detail', async ({ page }) => {
  await open(page);
  await expect(page.locator('#detail')).toBeHidden();
  // 상세, its one-time tip on 세컨 and 어프로치 put away (v28): it covers the capsules' middle until then.
  await detailMode(page);
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
  await page.getByRole('button', { name: '길게', exact: true }).click();
  await expect(page.locator('#tee-val')).toHaveText('길게');
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
  // 상세 splits the middle count (v28): the second shot is a 세컨.
  await tap(page, 'second');
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
  expect(body).toContain('1번 Par4: 5타 (+1) 드1 그1(세1 어0) 퍼2 OB 1 · 드 페어웨이');
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
  // 스코어카드 opens on its tables (v26: the analysis is behind 분석, beside them).
  await expect(page.locator('#scorecard')).toBeVisible();
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
  // 기록 carries no version since v29: it lives under 앱 정보.
  await expect(page.locator('#app-version')).toHaveCount(0);
});

test('opens a hole from the scorecard in 기록, and shows the current one', async ({ page }) => {
  await open(page);
  await showCard(page);
  // Nothing recorded: a first-run line with a way to the hole, and blank cells, not dashes.
  await expect(page.locator('#sh-empty')).toBeVisible();
  await expect(page.locator('#sc-hero')).toBeHidden();
  await expect(page.locator('#scorecard [data-hole="0"] .c-score')).toHaveText('');
  await expect(page.locator('#scorecard [data-hole="0"]')).toHaveClass(/cur/);
  // Each hole's column is its own button (v23): one tap opens that hole in 기록, no hole strip on the way.
  const twelve = page.getByRole('button', { name: /^12번 홀로 가기, Par \d, 기록 없음$/ });
  await twelve.click();
  await expect(page.locator('#entry')).toBeVisible();
  await expect(page.locator('#strip')).toBeHidden();
  await expect(page.locator('#hole-title')).toHaveText('12번 홀');
  await showCard(page);
  await expect(page.locator('#scorecard [data-hole="11"]')).toHaveClass(/cur/);
  await expect(page.locator('#scorecard [data-hole="11"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#scorecard [data-hole="0"]')).not.toHaveClass(/cur/);
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
  await expect(page.locator('#menu-version')).toHaveText('v33');
  await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·레이크');
  // Every item is a 48px button that opens its own panel and closes the one open before.
  for (const item of await page.locator('#menu .mi').all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await page.locator('#menu .mi', { hasText: '앱 정보' }).click();
  await expect(page.locator('#mp-about')).toContainText('Fairway Note v33');
  // 앱 정보 says which holes are drawn from OpenStreetMap, with its credit (v27).
  await expect(page.locator('#mp-about a')).toHaveAttribute('href', OSM_COPYRIGHT);
  await expect(page.locator('#mp-about a')).toHaveText('© OpenStreetMap 기여자, ODbL');
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
  // While editing, a hole's column steps its par instead of opening the hole (v23): the same columns as before, so
  // nothing moves; each is as tall as the table and at least 24px wide (WCAG 2.5.8), its par cell marked as a key.
  const first = page.locator('#scorecard [data-hole="0"]');
  const par = first.locator('.c-par');
  await expect(page.locator('#scorecard button[data-hole]')).toHaveCount(18);
  await expect(first).toHaveAccessibleName('1번 홀 Par 4, 누르면 바뀜');
  const box = (await first.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(100);
  expect(box.width).toBeGreaterThanOrEqual(24);
  await first.click();
  await expect(page.locator('#card-view')).toBeVisible();
  await expect(par).toHaveText('5');
  await expect(par).toHaveClass(/changed/);
  await expect(first).toBeFocused();
  await expect(page.locator('#announce')).toHaveText('1번 홀 Par 5');
  // 3 strokes on a par 5 is an eagle now.
  await expect(first.locator('.m')).toHaveAttribute('data-mark', 'eagle');
  await first.click();
  await expect(par).toHaveText('3');
  await first.click();
  await expect(par).toHaveText('4');
  await expect(par).not.toHaveClass(/changed/);
  await first.click();
  await first.click();
  await expect(par).toHaveText('3');
  await page.getByRole('button', { name: '완료' }).click();
  await expect(page.locator('#edit-hint')).toBeHidden();
  await expect(page.locator('#scorecard [data-hole="0"] .c-par')).toHaveText('3');
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
  // The schematic, on a course OpenStreetMap does not draw (v27): 에코랜드 와일드·비치힐스.
  await openCourse(page, '에코랜드', '에코랜드 골프클럽');
  const course = page.locator('#course');
  await expect(course).toHaveAttribute('data-art', 'schematic');
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
  // 에코랜드 publishes this par 3's length. Its "넓은 연못" names no place, so no pond is drawn.
  await expect(page.locator('#hole-distance')).toHaveText('화이트 145 m');
  await expect(course.locator('.water')).toHaveCount(0);
  // 비치힐스 8 is an island green by the course's own guide: water round the green.
  await showCard(page);
  await pickHole(page, 16);
  await expect(page.locator('#hole-notes li')).toContainText(['아일랜드 홀']);
  await expect(course.locator('.water')).toHaveCount(1);
  // The tee box sits in the band between the chips and the sheet, in sight (v33: v14 put it behind 다음 홀, where the
  // card hid it).
  for (const index of [0, 1, 3]) {
    await pickHole(page, index);
    const tee = (await course.locator('.tee').boundingBox())!;
    const chips = await rect(page, '#hole-info');
    const sheet = await rect(page, '#sheet');
    expect(tee.y, `hole ${index + 1}`).toBeGreaterThanOrEqual(chips.y + chips.height);
    expect(tee.y + tee.height, `hole ${index + 1}`).toBeLessThanOrEqual(sheet.y);
    expect(tee.x, `hole ${index + 1}`).toBeGreaterThanOrEqual(sheet.x);
  }
});

/** Points of each drawn bunker or pond outline that fall on the green with its fringe, or on the flag (v22): none should. */
function offGreen(): string[] {
  const svg = document.querySelector<SVGSVGElement>('#course')!;
  const fringe = svg.querySelector<SVGPathElement>('.a-fringe')!;
  const box = svg.querySelector<SVGGraphicsElement>('.flag')?.getBBox();
  const pt = svg.createSVGPoint();
  const found: string[] = [];
  // v31: a bunker is its sand alone (the lip went with the drawing's light).
  for (const edge of svg.querySelectorAll<SVGPathElement>('.bunker .a-sand, .pond .water')) {
    const what = edge.closest('g')!.getAttribute('class');
    const len = edge.getTotalLength();
    for (let i = 0; i < 64; i++) {
      const p = edge.getPointAtLength((len * i) / 64);
      pt.x = p.x;
      pt.y = p.y;
      if (fringe.isPointInFill(pt)) found.push(`${what} on the green at ${Math.round(p.x)},${Math.round(p.y)}`);
      if (box && p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height) found.push(`${what} on the flag`);
    }
  }
  return found;
}

for (const [width, height] of [[390, 844], [375, 667]]) {
  test(`draws only the bunkers and water a hole note names, off the green and its flag, and says so in 홀 안내 at ${width}×${height} (v22)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // The schematic, on a course OpenStreetMap does not draw (v27): 라온 스톤·레이크.
    await openCourse(page, '라온', '라온 골프클럽');
    const course = page.locator('#course');
    await expect(course).toHaveAttribute('data-art', 'schematic');
    // 스톤 2 ("약한 오르막, 짧은 파4, 좌우 숲") names neither: nothing drawn, and 홀 안내 says only that the drawing is
    // approximate (v31: a schematic hole always says so).
    await pickHole(page, 1);
    await expect(course.locator('.bunker')).toHaveCount(0);
    await expect(course.locator('.water')).toHaveCount(0);
    await page.locator('#info-btn').click();
    await expect(page.locator('#hole-pop')).toBeVisible();
    await expect(page.locator('#hi-art')).toHaveText('그림은 Par와 거리로 그린 대략적인 모양이에요.');
    await page.keyboard.press('Escape');
    // 스톤 4 ("내리막, 그린 주변 벙커 3개"): three bunkers round the par 3 green.
    await pickHole(page, 3);
    await expect(course.locator('.bunker')).toHaveCount(3);
    await expect(course.locator('.water')).toHaveCount(0);
    expect(await page.evaluate(offGreen)).toEqual([]);
    await page.locator('#info-btn').click();
    await expect(page.locator('#hi-art')).toBeVisible();
    await expect(page.locator('#hi-art')).toHaveText('그림은 Par와 거리로 그린 대략적인 모양이에요. 벙커·물은 공식 홀 안내 문구로 그린 대략 위치예요.');
    await page.keyboard.press('Escape');
    // 스톤 7 ("내리막, 그린 앞 우측 벙커, 좌측 해저드"): the bunker only. A plain 해저드 can be dry, so it is not drawn as water.
    await pickHole(page, 6);
    await expect(course.locator('.bunker')).toHaveCount(1);
    await expect(course.locator('.water')).toHaveCount(0);
    expect(await page.evaluate(offGreen)).toEqual([]);
    expect(await sideScroll(page)).toBe(0);
  });
}

/** What the drawn hole is made of (v31): its effect elements and the distinct paints its shapes are filled and stroked with. */
const drawingMakeup = (page: Page) => page.evaluate(() => {
  const svg = document.getElementById('course')!;
  const paints = new Set<string>();
  for (const el of svg.querySelectorAll('path, rect, ellipse, circle, use, polygon, line')) {
    const s = getComputedStyle(el);
    if (s.fill && s.fill !== 'none') paints.add(s.fill);
    if (s.stroke && s.stroke !== 'none') paints.add(s.stroke);
  }
  return {
    effects: svg.querySelectorAll('linearGradient, radialGradient, pattern, mask, clipPath, filter').length,
    url: [...svg.querySelectorAll('*')].filter((el) => /url\(/.test(`${el.getAttribute('fill') ?? ''}${el.getAttribute('stroke') ?? ''}${el.getAttribute('mask') ?? ''}${el.getAttribute('clip-path') ?? ''}`)).length,
    paints: [...paints],
  };
});

test('draws each hole as a yardage book does, a flat plan view: no gradient, pattern, mask, clip or filter, at most 10 paints, no grain (v31)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const check = async (where: string) => {
    await settled(page);
    const m = await drawingMakeup(page);
    expect(m.effects, `${where}: effects`).toBe(0);
    expect(m.url, `${where}: painted by url()`).toBe(0);
    expect(m.paints.length, `${where}: ${m.paints.join(' | ')}`).toBeLessThanOrEqual(10);
  };
  // OpenStreetMap: 새별 1, and 새별 7's island green.
  await open(page);
  await expect(page.locator('#course')).toHaveAttribute('data-art', 'osm');
  await check('새별 1');
  await pickHole(page, 6);
  await check('새별 7');
  // The schematic: 라온 스톤 4, its par 3 green ringed by three bunkers (a fresh start, so the picker comes first).
  await page.evaluate(() => localStorage.clear());
  await openCourse(page, '라온', '라온 골프클럽');
  await pickHole(page, 3);
  await expect(page.locator('#course')).toHaveAttribute('data-art', 'schematic');
  await check('라온 스톤 4');
  // The grain went with the texture: no tile, no pattern on the page.
  await expect(page.locator('pattern, .grain-defs, #grain-turf')).toHaveCount(0);
});

/** In the page: WCAG contrast between two CSS colours, any syntax (palette mixes too), normalised by a one-pixel canvas. */
function ratioIn([a, b]: [string, string]): number {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const rgb = (css: string) => {
    cv.clearRect(0, 0, 1, 1);
    cv.fillStyle = '#000';
    cv.fillStyle = css;
    cv.fillRect(0, 0, 1, 1);
    return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const lum = (c: number[]) => {
    const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
type Paint = 'fill' | 'stroke' | 'backgroundColor' | 'opacity';
const paintOf = (page: Page, sel: string, prop: Paint) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p as Paint], prop);
const edgeOf = async (page: Page, [a, pa]: [string, Paint], [b, pb]: [string, Paint]) => page.evaluate(ratioIn, [await paintOf(page, a, pa), await paintOf(page, b, pb)] as [string, string]);
/** Whether the drawn course is what the eye meets at a point of the screen (a clip takes it out of hit testing too). */
const drawnAt = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => document.elementsFromPoint(px, py).some((el) => el.closest('#course') !== null), [x, y]);

test('keeps the drawing to the open band, steps it back where the thumb shows the hole, and edges its pond and pin (v31 critique)', async ({ page }) => {
  // Below the sheet's top edge the card covers the hole; what showed beside it and above 다음 홀 (a tee, a pond's edge,
  // a strip of water) read as a glitch once the drawing lost v22's darkened edges.
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await settled(page);
  const sheet = await rect(page, '#sheet');
  const go = await rect(page, '#go-next');
  expect(await drawnAt(page, 195, sheet.y - 24), 'the open band').toBe(true);
  expect(await drawnAt(page, 195, (sheet.y + sheet.height + go.y) / 2), 'between the sheet and 다음 홀').toBe(false);
  expect(await drawnAt(page, (sheet.x + sheet.width + 390) / 2, sheet.y + 80), 'beside the sheet').toBe(false);
  expect(Number(await paintOf(page, '#course', 'opacity'))).toBe(1);
  // 새별 7: water round an island green, and a fairway. The shore reads on the fairway (water on it was 1.26:1), the
  // pole on the green (white on it was 2.1:1).
  await pickHole(page, 6);
  await settled(page);
  expect(await edgeOf(page, ['#course .water', 'stroke'], ['#course .fairway', 'fill']), 'shore on fairway').toBeGreaterThanOrEqual(3);
  expect(await edgeOf(page, ['#course .a-pole-edge', 'stroke'], ['#course .green', 'fill']), 'pole on green').toBeGreaterThanOrEqual(3);
  // 375×553: the band is a sliver under the header and the thumb shows the hole, so the drawing steps back behind the
  // chips (at full strength the green and water there were louder than the controls on them).
  await page.setViewportSize({ width: 375, height: 553 });
  await settled(page);
  // The window's resize event redraws and re-clips the hole; under load it can land after the line above (v32).
  await page.waitForFunction(() => document.getElementById('course')!.style.getPropertyValue('--art-bottom') === `${Math.round(document.getElementById('sheet')!.getBoundingClientRect().top)}px`);
  await expect(page.locator('.thumb')).toBeVisible();
  expect(Number(await paintOf(page, '#course', 'opacity'))).toBeLessThanOrEqual(0.45);
  const low = await rect(page, '#sheet');
  expect(await drawnAt(page, (low.x + low.width + 375) / 2, low.y + 60), 'beside the sheet, short').toBe(false);
});

test('draws the penalties as golf objects in the icon family: a white post on grass, a red post at water, sand from above (v31)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const [white, red, sand] = [await token(page, '--white'), await token(page, '--red'), await token(page, '--sand')];
  for (const big of [false, true]) {
    if (big) {
      await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), big: true })), PREFS_KEY);
      await page.reload();
      await expect(page.locator('body')).toHaveClass(/big/);
    }
    await page.getByRole('button', { name: '상세', exact: true }).click();
    if (await page.locator('#split-tip').isVisible()) await page.locator('#split-tip').click();
    await settled(page);
    for (const [id, part, paint] of [['stake-ob', '.stake-ob', white], ['stake-hazard', '.stake-hazard', red], ['stake-bunker', '.ic-sand', sand]] as const) {
      const svg = page.locator(`#${id} .pen-icon svg`);
      await expect(svg, id).toHaveAttribute('viewBox', '0 0 24 24');
      await expect(svg, id).toHaveAttribute('stroke-width', '1.75');
      const box = (await svg.boundingBox())!;
      // The glyphs grow with the text (v31 critique: 큰 글씨 grew the labels and left the glyphs).
      expect(Math.min(box.width, box.height), `${id}${big ? ' 큰 글씨' : ''}`).toBeGreaterThanOrEqual(big ? 28 : 24);
      expect(await svg.locator(part).evaluate((el) => getComputedStyle(el).fill), id).toBe(paint);
    }
    // The white post reads as a solid, not an empty outline: its shaded side stands off the button (it was 1.1:1).
    expect(await edgeOf(page, ['#stake-ob .stake-ob-side', 'fill'], ['#stake-ob .pen-icon', 'backgroundColor']), 'OB side').toBeGreaterThanOrEqual(3);
    // On a short screen 상세's tiles keep the glyphs at 20px at least, 24px in 큰 글씨.
    await page.setViewportSize({ width: 375, height: 553 });
    await settled(page);
    for (const id of ['stake-ob', 'stake-hazard', 'stake-bunker']) {
      const box = (await page.locator(`#${id} .pen-icon svg`).boundingBox())!;
      expect(Math.min(box.width, box.height), `${id} short${big ? ' 큰 글씨' : ''}`).toBeGreaterThanOrEqual(big ? 24 : 20);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '기본', exact: true }).click();
  }
});

/** Each drawn distance pill's label (SVG text in the page font) and the room the pill gives it. */
const markerFits = (page: Page) => page.evaluate(() => [...document.querySelectorAll('#course .marker')].map((g) => ({
  label: g.querySelector('text')!.textContent,
  text: (g.querySelector('text') as SVGTextElement).getComputedTextLength(),
  pill: Number(g.querySelector('rect')!.getAttribute('width')),
})));

test('fits the drawn distance pills to their labels in the page font, with room on each side (v24)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // The schematic on 에코랜드 와일드 1 (342 m) shows 100 m and 150 m in a tall band (v27: Everis is drawn from OpenStreetMap).
  await openCourse(page, '에코랜드', '에코랜드 골프클럽');
  await page.evaluate(() => document.fonts.ready);
  const fit = await markerFits(page);
  expect(fit.map((f) => f.label)).toEqual(['100 m', '150 m']);
  for (const f of fit) expect((f.pill - f.text) / 2, `${f.label}: room each side`).toBeGreaterThanOrEqual(6);
});

test('draws a pond in front of a par 3 green and a bunker on its left, as the hole note says (v22)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('searchbox', { name: '골프장 검색' }).fill('한양');
  await page.locator('#picker-list button', { hasText: '한양컨트리클럽' }).click();
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  // Hole 10 is 신코스 IN 1: "그린 앞 연못, 그린 좌측 깊은 벙커".
  await pickHole(page, 9);
  await expect(page.locator('#hole-notes li')).toHaveText(['그린 앞 연못', '그린 좌측 깊은 벙커']);
  const course = page.locator('#course');
  await expect(course.locator('.pond')).toHaveCount(1);
  await expect(course.locator('.bunker')).toHaveCount(1);
  expect(await page.evaluate(offGreen)).toEqual([]);
  const green = (await course.locator('.green').boundingBox())!;
  const pond = (await course.locator('.pond').boundingBox())!;
  const bunker = (await course.locator('.bunker').boundingBox())!;
  // In front (toward the tee) and on the left as the player faces the green. Since v33 the hole lies across the band,
  // tee at the left and the player's left up, as the header's small picture shows it.
  expect(pond.x + pond.width / 2).toBeLessThan(green.x);
  expect(bunker.y + bunker.height / 2).toBeLessThan(green.y);
});

// ---------- Everis drawn from OpenStreetMap (v27) ----------

const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';
/** What main.ts writes on the drawing for an OpenStreetMap hole (v33: and the schematic's in the band): the back tee, the
 * greens' middle, px per metre, the line. */
const osmAxis = (page: Page) => page.locator('#course').evaluate((el) => ({
  tee: el.dataset.tee!.split(',').map(Number),
  green: el.dataset.green!.split(',').map(Number),
  scale: Number(el.dataset.scale),
  line: el.dataset.line!.split(' ').map((p) => p.split(',').map(Number)),
}));

test('draws an Everis hole from OpenStreetMap, with a © OpenStreetMap link beside it and in 홀 안내, with no request or new storage (v27)', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || request.method() !== 'GET' || request.postData()) requests.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const course = page.locator('#course');
  await expect(course).toHaveAttribute('data-art', 'osm');
  // 새별 1 as OpenStreetMap maps it: one fairway, two greens (the flag on one), five tees and seven bunkers.
  await expect(course.locator('.fairway')).toHaveCount(1);
  await expect(course.locator('.green')).toHaveCount(1);
  await expect(course.locator('.green2')).toHaveCount(1);
  await expect(course.locator('.tee')).toHaveCount(1);
  await expect(course.locator('.tee2')).toHaveCount(4);
  await expect(course.locator('.bunker')).toHaveCount(7);
  await expect(course.locator('.flag')).toHaveCount(1);
  // The back tee (the line's start, with its markers) in the putting green's colour, the other tees quieter in the
  // fairway's (v33 critique: a row of bright tees read as a ball's flight).
  expect(await course.locator('.tee').evaluate((el) => getComputedStyle(el).fill)).toBe(await token(page, '--putting'));
  expect(await course.locator('.tee2').first().evaluate((el) => getComputedStyle(el).fill)).toBe(await token(page, '--fairway'));
  // The credit beside the drawing: a link to OpenStreetMap's copyright page, in a new tab, legible on what is drawn behind it.
  const credit = page.locator('#osm-credit');
  await expect(credit).toBeVisible();
  await expect(credit).toHaveText('© OpenStreetMap');
  await expect(credit).toHaveAttribute('href', OSM_COPYRIGHT);
  await expect(credit).toHaveAttribute('target', '_blank');
  await expect(credit).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(credit).toHaveAccessibleName(/^© OpenStreetMap/);
  // Quiet gray text since v33, not a badge: no fill, edge, rounding or shadow; 13px at the help weight.
  expect(await credit.evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, border: s.borderTopWidth, radius: s.borderTopLeftRadius, shadow: s.boxShadow, padding: s.paddingLeft, size: s.fontSize, weight: s.fontWeight, colour: s.color };
  })).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', radius: '0px', shadow: 'none', padding: '0px', size: '13px', weight: '400', colour: await token(page, '--on-dark-quiet') });
  await expectCreditLegible(page, '새별 1');
  // Its touch area is at least 24px each way (WCAG 2.2 target size), without reaching into the card.
  const area = await credit.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const after = getComputedStyle(el, '::after');
    const grow = (v: string) => Math.max(0, -parseFloat(v) || 0);
    return { w: r.width + grow(after.left) + grow(after.right), h: r.height + grow(after.top) + grow(after.bottom), bottom: r.bottom + grow(after.bottom) };
  });
  expect(Math.min(area.w, area.h)).toBeGreaterThanOrEqual(24);
  expect(area.bottom).toBeLessThanOrEqual((await page.locator('#sheet').boundingBox())!.y + 0.5);
  // 홀 안내 says where the shape comes from, with the same link; v22's line about approximate hazards is the schematic's.
  await page.locator('#info-btn').click();
  await expect(page.locator('#hi-osm')).toBeVisible();
  await expect(page.locator('#hi-osm a')).toHaveAttribute('href', OSM_COPYRIGHT);
  await expect(page.locator('#hi-osm a')).toHaveAttribute('target', '_blank');
  await expect(page.locator('#hi-art')).toBeHidden();
  await page.keyboard.press('Escape');
  // The next hole is its own shape, still from OpenStreetMap.
  const green = await course.locator('.green').getAttribute('d');
  await page.getByRole('button', { name: '다음 홀로 이동' }).click();
  await expect(page.locator('#hole-n')).toHaveText('2');
  await expect(course).toHaveAttribute('data-art', 'osm');
  expect(await course.locator('.green').getAttribute('d')).not.toBe(green);
  await expect(credit).toBeVisible();
  // The whole of a long hole in the band (v33): 새별 3 (par 5) shows its 100 m and 150 m pills, which fit their labels
  // as the schematic's do.
  await page.getByRole('button', { name: '다음 홀로 이동' }).click();
  await expect(page.locator('#hole-n')).toHaveText('3');
  await page.evaluate(() => document.fonts.ready);
  const fit = await markerFits(page);
  expect(fit.map((f) => f.label)).toEqual(['100 m', '150 m']);
  for (const f of fit) expect((f.pill - f.text) / 2, `${f.label}: room each side`).toBeGreaterThanOrEqual(6);
  // Bundled: no request left the page, and nothing new was stored.
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => ({ keys: Object.keys(localStorage).sort(), sessionStorage: sessionStorage.length, cookies: document.cookie })))
    .toEqual({ keys: [PREFS_KEY, STORAGE_KEY].sort(), sessionStorage: 0, cookies: '' });
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
});

test('keeps the schematic, with no OpenStreetMap credit, on a course it does not draw (v27)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCourse(page, '에코랜드', '에코랜드 골프클럽');
  await expect(page.locator('#course')).toHaveAttribute('data-art', 'schematic');
  await expect(page.locator('#osm-credit')).toBeHidden();
  await page.locator('#info-btn').click();
  await expect(page.locator('#hole-pop')).toBeVisible();
  await expect(page.locator('#hi-osm')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '다음 홀로 이동' }).click();
  await expect(page.locator('#course')).toHaveAttribute('data-art', 'schematic');
  await expect(page.locator('#osm-credit')).toBeHidden();
  expect(await sideScroll(page)).toBe(0);
});

test('keeps the schematic, with no credit, on the Everis holes OpenStreetMap does not match and on a screen with no open band (v27)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const course = page.locator('#course');
  const credit = page.locator('#osm-credit');
  // 레이크 4 and 5 (holes 13 and 14 of 새별·레이크) stay on the schematic; 레이크 6 is drawn from OpenStreetMap.
  for (const [index, art] of [[12, 'schematic'], [13, 'schematic'], [14, 'osm']] as const) {
    await pickHole(page, index);
    await expect(course, `hole ${index + 1}`).toHaveAttribute('data-art', art);
    if (art === 'osm') await expect(credit).toBeVisible();
    else await expect(credit).toBeHidden();
  }
  // A short screen (375×553) has no open band for the drawing and its credit: the schematic, as before.
  await page.setViewportSize({ width: 375, height: 553 });
  await pickHole(page, 0);
  await expect(course).toHaveAttribute('data-art', 'schematic');
  await expect(credit).toBeHidden();
  await expect(page.locator('#hole-thumb')).toBeVisible();
  expect(await sideScroll(page)).toBe(0);
});

// 360×640 has no band to fit since v33 (under 50px): the header's small drawing shows instead (tested below).
for (const [width, height] of [[375, 667], [390, 844]]) {
  test(`lines up an OpenStreetMap hole and its credit within 1px at ${width}×${height} (v27)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    await atRest(page);
    const course = page.locator('#course');
    await expect(course).toHaveAttribute('data-art', 'osm');
    const sheet = await rect(page, '#sheet');
    const credit = await rect(page, '#osm-credit');
    // The credit 6px above the card (alone on that line since v29 took the version off 기록). As text (v33) its left edge
    // is the card's content edge, where the first capsule starts (the pill stood on the card's outer edge, its text 8px in).
    expectAligned(credit.x, (await rect(page, '.club-driver .pill')).x, 'credit left = the first capsule\'s left');
    expectAligned(credit.y + credit.height, sheet.y - 6, 'credit bottom 6px above the card');
    expect(credit.y).toBeGreaterThanOrEqual((await rect(page, '#hole-info')).y + (await rect(page, '#hole-info')).height + 4);
    // The axis (v33): across the band between the chips and the card, the back tee at the left and the greens' middle
    // level with it at the right.
    const axis = await osmAxis(page);
    const chips = await rect(page, '#hole-info');
    expect(axis.tee[0]).toBeLessThan(axis.green[0]);
    expectAligned(axis.green[1], axis.tee[1], 'greens level with the back tee');
    for (const [x, y] of [axis.tee, axis.green]) {
      expect(x).toBeGreaterThanOrEqual(sheet.x);
      expect(x).toBeLessThanOrEqual(sheet.x + sheet.width);
      expect(y).toBeGreaterThan(chips.y + chips.height);
      expect(y).toBeLessThan(sheet.y);
    }
    expectAligned(axis.line[0][0], axis.tee[0], 'line starts at the tee (x)');
    expectAligned(axis.line[0][1], axis.tee[1], 'line starts at the tee (y)');
    expectAligned(axis.line[axis.line.length - 1][0], axis.green[0], 'line ends at the greens (x)');
    expectAligned(axis.line[axis.line.length - 1][1], axis.green[1], 'line ends at the greens (y)');
    // The drawn back tee holds that point, and the cup stands on the flagged green.
    const inside = await course.evaluate((el, at) => {
      const svg = el as unknown as SVGSVGElement;
      const p = svg.createSVGPoint();
      [p.x, p.y] = at;
      const cup = el.querySelector('.a-cup')!;
      const q = svg.createSVGPoint();
      q.x = Number(cup.getAttribute('cx'));
      q.y = Number(cup.getAttribute('cy'));
      return { tee: el.querySelector<SVGGeometryElement>('.tee')!.isPointInFill(p), cup: el.querySelector<SVGGeometryElement>('.green')!.isPointInFill(q) };
    }, axis.tee);
    expect(inside).toEqual({ tee: true, cup: true });
    // Nothing drawn to be read sits under the credit: not the flag, not a distance pill.
    const clearOfCredit = () => page.evaluate((c) => [...document.querySelectorAll('#course .flag, #course .marker')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > c.x && r.left < c.x + c.width && r.bottom > c.y && r.top < c.y + c.height;
    }).length, credit);
    expect(await clearOfCredit()).toBe(0);
    expect(await sideScroll(page)).toBe(0);
    // In 상세 too (four capsules on one grid from the same content edge), on the tall screen where the credit still shows.
    if (height >= 800) {
      await page.getByRole('button', { name: '상세', exact: true }).click();
      if (await page.locator('#split-tip').isVisible()) await page.locator('#split-tip').click();
      await atRest(page);
      await expect(page.locator('#osm-credit')).toBeVisible();
      expectAligned((await rect(page, '#osm-credit')).x, (await rect(page, '.club-driver .pill')).x, '상세: credit left = the first capsule\'s left');
      await page.getByRole('button', { name: '기본', exact: true }).click();
      await atRest(page);
    }
    // A tall band shows the whole of a long hole (v33): 새별 3 (par 5) shows its 100 m and 150 m markers, each its distance
    // along the line of play from the greens' middle at the drawing's scale.
    if (height < 800) return;
    await page.getByRole('button', { name: '다음 홀로 이동' }).click();
    await page.getByRole('button', { name: '다음 홀로 이동' }).click();
    await expect(page.locator('#hole-n')).toHaveText('3');
    const long = await osmAxis(page);
    const markers = await course.locator('.marker circle').evaluateAll((list) => list.map((c) => ({ x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')), d: Number(c.closest('g')!.querySelector('text')!.textContent!.replace(' m', '')) })));
    expect(markers.map((m) => m.d)).toEqual([100, 150]);
    for (const m of markers) {
      let along = 0;
      let found = NaN;
      for (let i = long.line.length - 1; i > 0; i--) {
        const [a, b] = [long.line[i], long.line[i - 1]];
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const t = ((m.x - a[0]) * (b[0] - a[0]) + (m.y - a[1]) * (b[1] - a[1])) / (seg * seg);
        if (t >= -0.01 && t <= 1.01 && Math.abs((m.x - a[0]) * (b[1] - a[1]) - (m.y - a[1]) * (b[0] - a[0])) / seg < 0.6) {
          found = along + t * seg;
          break;
        }
        along += seg;
      }
      expectAligned(found, m.d * long.scale, `${m.d} m marker along the line`);
      expect(m.y, `${m.d} m marker in the band`).toBeLessThan(sheet.y);
    }
    expect(await clearOfCredit()).toBe(0);
  });
}

test.describe('with hole notes in the course data', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('shows the length, handicap, layout note and official guide link', async ({ page }) => {
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
    // Measured at rest: while the popover rises, WebKit reads the moving 48px link as 47.99998 (v21).
    await atRest(page);
    expect((await guide.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await expect(guide).toHaveAttribute('href', /^https:\/\/[^/]+\//);
    await expect(guide).toHaveAttribute('target', '_blank');
    await expect(guide).toHaveAttribute('rel', 'noopener noreferrer');
    expect(await sideScroll(page)).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#hole-pop')).toBeHidden();
    await expect(infoBtn).toBeFocused();
    await showCard(page);
    await pickHole(page, 9);
    await expect(page.locator('#hole-notes li')).toHaveText(['우 도그렉', '그린 뒤 내리막']);
    await expect(page.locator('#hole-hdcp')).toHaveText('HDCP 5');
  });

  test('bends a dogleg on the schematic: a right-hand dogleg’s green sits to the player’s right of the tee', async ({ page }) => {
    // 에코랜드 와일드 5 ("우 도그렉, …") bends right. Across the band (v33) the player's right is down, as the header's
    // small picture shows it, so its green sits below the tee's level.
    await openCourse(page, '에코랜드', '에코랜드 골프클럽');
    await pickHole(page, 4);
    await expect(page.locator('#hole-notes li').first()).toHaveText('우 도그렉');
    await expect(page.locator('#course')).toHaveAttribute('data-art', 'schematic');
    await expect.poll(async () => {
      const axis = await osmAxis(page);
      return axis.green[1] - axis.tee[1];
    }).toBeGreaterThan(8);
  });
});

test('shows Everis 레이크 1’s right-hand dogleg from OpenStreetMap: the line of play bends left of the tee–green line, then into the green (v27)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await open(page);
  await pickHole(page, 9);
  const course = page.locator('#course');
  await expect(course).toHaveAttribute('data-art', 'osm');
  const line = await course.evaluate((el) => el.dataset.line!.split(' ').map((p) => p.split(',').map(Number)));
  const level = line[0][1];
  // A right-hand dogleg: straight out to the elbow, which lies left of the straight tee–green line, then right to the
  // green. Across the band (v33) the player's left is up and the tee and the greens' middle are level.
  expect(Math.min(...line.map(([, y]) => y))).toBeLessThan(level - 8);
  expect(line[line.length - 1][1]).toBeCloseTo(level, 0);
});

// ---------- The hole in the band 기록 shows (v33) ----------

type Band = { x0: number; y0: number; x1: number; y1: number };
/** The band as the page lays it out: from the bottom of the chips under the hole switcher to the sheet's top edge, across the sheet. */
const visibleBand = (page: Page) => page.evaluate((): Band => {
  const chips = document.getElementById('hole-info')!.getBoundingClientRect();
  const sheet = document.getElementById('sheet')!.getBoundingClientRect();
  return { x0: sheet.left, y0: chips.bottom, x1: sheet.right, y1: sheet.top };
});

/**
 * Points inside each drawn part the selectors name (a grid over its box, kept where the shape fills), each with whether
 * it lies in the band and whether the drawing is what the eye meets there: nothing painted over it (a chip, the card,
 * the credit: anything with a fill, a picture or an icon), only the screen's clear containers.
 */
const seenParts = (page: Page, band: Band, selectors: string[], probes: [number, number][] = []) => page.evaluate(([b, list, spots]) => {
  const svg = document.getElementById('course') as unknown as SVGSVGElement;
  const out: { part: string; at: string; inBand: boolean; onTop: boolean }[] = [];
  const unpainted = (s: CSSStyleDeclaration) => /^(transparent|rgba\(.*,\s*0\))$/.test(s.backgroundColor) && s.backgroundImage === 'none';
  // Over the point: a clear container, or a control hit only through a clear pseudo-element reaching past its box (the
  // chips' 48px touch areas reach into the band; nothing there is drawn, and the drawing takes no taps).
  const texted = (el: Element) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== '');
  const clear = (el: Element, x: number, y: number) => {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return unpainted(getComputedStyle(el)) && !texted(el) && !(el instanceof SVGElement) && !(el instanceof HTMLImageElement);
    return ['::before', '::after'].every((p) => unpainted(getComputedStyle(el, p)));
  };
  const seen = (x: number, y: number) => {
    const stack = document.elementsFromPoint(x, y);
    const at = stack.findIndex((el) => el.closest('#course') !== null);
    return at >= 0 && stack.slice(0, at).every((el) => clear(el, x, y));
  };
  for (const sel of list) {
    document.querySelectorAll<SVGGeometryElement>(`#course ${sel}`).forEach((el, n) => {
      const box = el.getBBox();
      const pts: [number, number][] = [];
      for (let i = 1; i < 8; i++) {
        for (let j = 1; j < 8; j++) {
          const p = svg.createSVGPoint();
          p.x = box.x + (box.width * i) / 8;
          p.y = box.y + (box.height * j) / 8;
          if (el.isPointInFill(p)) pts.push([p.x, p.y]);
        }
      }
      if (!pts.length) pts.push([box.x + box.width / 2, box.y + box.height / 2]);
      for (const [x, y] of pts) {
        out.push({
          part: `${sel} ${n + 1}`,
          at: `${Math.round(x)},${Math.round(y)}`,
          inBand: x >= b.x0 - 0.5 && x <= b.x1 + 0.5 && y >= b.y0 - 0.5 && y <= b.y1 + 0.5,
          onTop: seen(x, y),
        });
      }
    });
  }
  return { parts: out, probes: spots.map(([x, y]) => seen(x, y)) };
}, [band, selectors, probes] as const);

/**
 * Each part the selectors name in sight: in the band and on top there, with the count of each as given. `covered` are
 * points where something painted lies over the drawing (the Par chip, the credit): the check must see them as covered.
 */
async function expectInSight(page: Page, where: string, counts: Record<string, number>, covered: [number, number][] = []) {
  await settled(page);
  const band = await visibleBand(page);
  for (const [sel, n] of Object.entries(counts)) await expect(page.locator(`#course ${sel}`), `${where}: ${sel}`).toHaveCount(n);
  const { parts: seen, probes } = await seenParts(page, band, Object.keys(counts), covered);
  expect(seen.length, `${where}: points checked`).toBeGreaterThan(Object.keys(counts).length);
  expect(seen.filter((p) => !p.inBand || !p.onTop).map((p) => `${p.part} at ${p.at}: ${p.inBand ? 'covered' : 'outside the band'}`), where).toEqual([]);
  expect(probes, `${where}: what lies over the drawing is seen as covering it`).toEqual(covered.map(() => false));
  // main.ts measured the same band when it drew the hole.
  const drawn = (await page.locator('#course').getAttribute('data-band'))!.split(',').map(Number);
  [band.x0, band.y0, band.x1, band.y1].forEach((v, i) => expectAligned(drawn[i], v, `${where}: band edge ${i}`));
}

for (const [width, height] of [[390, 844], [375, 667]]) {
  test(`fits each hole into the band between the chips and the sheet: its tee, green, flag and named hazards in sight at ${width}×${height} (v33)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // Everis from OpenStreetMap: 새별 1 (v31 drew a bunker behind its greens under the Par chip) and 7 (an island green).
    await open(page);
    await expect(page.locator('#course')).toHaveAttribute('data-art', 'osm');
    await settled(page);
    const middle = (r: { x: number; y: number; width: number; height: number }): [number, number] => [r.x + r.width / 2, r.y + r.height / 2];
    await expectInSight(page, '새별 1', { '.tee': 1, '.tee2': 4, '.green': 1, '.green2': 1, '.flag': 1, '.bunker path': 7 },
      [middle(await rect(page, '#osm-credit')), middle(await rect(page, '#hole-par'))]);
    await expectCreditLegible(page, '새별 1');
    // Nothing of the drawing shows between the chips: it starts under them.
    const chips = await rect(page, '#hole-info');
    const info = await rect(page, '#info-btn');
    expect(await drawnAt(page, info.x - 12, chips.y + chips.height / 2), 'between the chips').toBe(false);
    await pickHole(page, 6);
    await expect(page.locator('#course')).toHaveAttribute('data-art', 'osm');
    await expectInSight(page, '새별 7', { '.tee': 1, '.green': 1, '.flag': 1 });
    await expectCreditLegible(page, '새별 7');
    // 그린필드's schematic: 4's tee shot carries a pond (v31 drew it behind the card), 6 is a par 3 with waste bunkers round
    // its green, 7 a par 5 with a pond in front of its green.
    await page.evaluate(() => localStorage.clear());
    await openCourse(page, '그린필드', '그린필드 CC');
    for (const [index, counts] of [
      [3, { '.tee': 1, '.green': 1, '.flag': 1, '.pond .water': 1 }],
      [5, { '.tee': 1, '.green': 1, '.flag': 1, '.bunker path': 3 }],
      [6, { '.tee': 1, '.green': 1, '.flag': 1, '.pond .water': 1 }],
    ] as const) {
      await pickHole(page, index);
      await expect(page.locator('#course')).toHaveAttribute('data-art', 'schematic');
      await expectInSight(page, `그린필드 ${index + 1}`, counts);
    }
    expect(await sideScroll(page)).toBe(0);
  });
}

/** The sheet at rest after a hole change: its slide (a transition begun on the next frame) over and the copy that left gone. */
const sheetAtRest = (page: Page) => page.waitForFunction(() => getComputedStyle(document.getElementById('sheet')!).transform === 'none'
  && document.querySelector('.sheet.ghost') === null && document.getAnimations().every((a) => a.playState !== 'running'));

/** The credit's end and alignment (v33): its left edge on the first capsule's, or at the right end its right edge on the last's. */
async function expectCreditAligned(page: Page, where: string) {
  await sheetAtRest(page);
  const credit = await rect(page, '#osm-credit');
  if (await page.locator('#osm-credit').evaluate((el) => el.classList.contains('end'))) {
    const last = await rect(page, '.club-putts .pill');
    expectAligned(credit.x + credit.width, last.x + last.width, `${where}: credit right = the last capsule's right`);
  } else {
    expectAligned(credit.x, (await rect(page, '.club-driver .pill')).x, `${where}: credit left = the first capsule's left`);
  }
}

test('stands the © OpenStreetMap credit at the card’s right end where water would lie behind it at the left: 레이크 1 at 375×667 (v33)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await open(page);
  // 레이크 1 (hole 10): its lake reaches the band's bottom left whatever room the hole is moved to.
  await pickHole(page, 9);
  await expect(page.locator('#course')).toHaveAttribute('data-art', 'osm');
  await expect(page.locator('#osm-credit')).toHaveClass(/\bend\b/);
  await settled(page);
  await expectCreditAligned(page, '레이크 1');
  await expectCreditLegible(page, '레이크 1');
  const middle = (r: { x: number; y: number; width: number; height: number }): [number, number] => [r.x + r.width / 2, r.y + r.height / 2];
  await expectInSight(page, '레이크 1', { '.tee': 1, '.green': 1, '.flag': 1 }, [middle(await rect(page, '#osm-credit'))]);
  // The next hole has no water there: the credit is back at the left.
  await page.getByRole('button', { name: '다음 홀로 이동' }).click();
  await expect(page.locator('#hole-n')).toHaveText('11');
  await expect(page.locator('#osm-credit')).not.toHaveClass(/\bend\b/);
  await settled(page);
  await expectCreditAligned(page, '레이크 2');
  await expectCreditLegible(page, '레이크 2');
});

for (const [width, height] of [[390, 844], [375, 667]]) {
  test(`keeps the © OpenStreetMap credit legible on every hole drawn from OpenStreetMap at ${width}×${height} (v33)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    // The round's 18 holes: 새별 and 레이크, 레이크 4 and 5 on the schematic (no credit).
    for (let n = 1; n <= 18; n++) {
      if (n > 1) {
        await page.getByRole('button', { name: '다음 홀로 이동' }).click();
        await expect(page.locator('#hole-n')).toHaveText(String(n));
      }
      if ((await page.locator('#course').getAttribute('data-art')) !== 'osm') continue;
      await settled(page);
      await expectCreditAligned(page, `hole ${n}`);
      await expectCreditLegible(page, `hole ${n}`);
    }
  });
}

/**
 * A band too short to fit the hole (v33: under 50px, measured where the hole is drawn): the header's small drawing leads
 * the chip row instead, as at 375×553, and the drawing behind steps back; no hole is fitted, so none is drawn from
 * OpenStreetMap and no credit shows. The row still holds Par, length and HDCP whole, its ends on the card's edges.
 */
async function expectThumbInstead(page: Page, where: string) {
  await atRest(page);
  await expect(page.locator('#hole-thumb'), where).toBeVisible();
  await expect(page.locator('#course'), where).toHaveAttribute('data-art', 'schematic');
  expect(await page.locator('#course').getAttribute('data-band'), where).toBeNull();
  await expect(page.locator('#osm-credit'), where).toBeHidden();
  expect(Number(await paintOf(page, '#course', 'opacity')), where).toBeLessThanOrEqual(0.45);
  const meta = await page.locator('#meta').evaluate((el) => ({ clipped: el.scrollWidth > el.clientWidth + 0.5, tight: el.classList.contains('tight') || el.classList.contains('tighter') }));
  expect(meta, `${where}: Par, length and HDCP whole beside the small drawing`).toEqual({ clipped: false, tight: false });
  await expect(page.locator('#hole-distance'), where).toBeVisible();
  await expect(page.locator('#hole-hdcp'), where).toBeVisible();
  const sheet = await rect(page, '#sheet');
  expectAligned((await rect(page, '#hole-thumb')).x, sheet.x, `${where}: small drawing left = card left`);
  const info = await rect(page, '#info-btn');
  expectAligned(info.x + info.width, sheet.x + sheet.width, `${where}: 홀 안내 right = card right`);
  expect(await sideScroll(page), where).toBe(0);
}

test('shows the header’s small drawing instead of fitting a band under 50px: 360×640 in 기본 and 상세, 375×667 in 상세 (v33)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await open(page);
  await expectThumbInstead(page, '360×640 기본');
  await page.getByRole('button', { name: '상세', exact: true }).click();
  if (await page.locator('#split-tip').isVisible()) await page.locator('#split-tip').click();
  await expectThumbInstead(page, '360×640 상세');
  // 375×667: 상세's band (47px) is under 50px, 기본's (59px) is fitted.
  await page.setViewportSize({ width: 375, height: 667 });
  await expectThumbInstead(page, '375×667 상세');
  await page.getByRole('button', { name: '기본', exact: true }).click();
  await atRest(page);
  await expect(page.locator('#course')).toHaveAttribute('data-art', 'osm');
  await expect(page.locator('#hole-thumb')).toBeHidden();
  await expect(page.locator('#osm-credit')).toBeVisible();
});

// The row beside the small drawing once the round's progress shows (v33): HDCP steps into 홀 안내 by fitMeta's rule, and
// nothing in the row runs past fitMeta's 1px allowance (on holes 10–18 the length pill's text takes 1px of its right
// padding; a stricter rule would flip with 1px text-width differences between platforms), clips with an ellipsis or
// overlaps.
test('keeps 360×640’s chip row whole beside the header’s small drawing once the progress pill shows: HDCP in 홀 안내, nothing clipped past 1px or overlapping (v33)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await open(page);
  const row = async (where: string) => {
    await atRest(page);
    await expect(page.locator('#hole-thumb'), where).toBeVisible();
    const parts = await page.evaluate(() => ['hole-thumb', 'meta', 'progress', 'info-btn']
      .map((id) => document.getElementById(id)!)
      .filter((el) => !el.hidden && getComputedStyle(el).display !== 'none')
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.id, x0: r.left, x1: r.right, over: el.scrollWidth - el.clientWidth };
      }));
    for (const part of parts) expect(part.over, `${where}: ${part.id} past fitMeta's 1px`).toBeLessThanOrEqual(1);
    for (let k = 1; k < parts.length; k++) expect(parts[k].x0, `${where}: ${parts[k].id} clear of ${parts[k - 1].id}`).toBeGreaterThanOrEqual(parts[k - 1].x1);
    const sheet = await rect(page, '#sheet');
    expect(parts[0].x0, `${where}: the row's left`).toBeGreaterThanOrEqual(sheet.x - 1);
    expect(parts[parts.length - 1].x1, `${where}: the row's right`).toBeLessThanOrEqual(sheet.x + sheet.width + 1);
    const ellipsis = await page.evaluate(() => [...document.querySelectorAll('#hole-info *')].filter((el) => getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1).length);
    expect(ellipsis, `${where}: an ellipsis in the row`).toBe(0);
    return parts.map((part) => part.id);
  };
  expect(await row('hole 1')).toEqual(['hole-thumb', 'meta', 'info-btn']);
  await expect(page.locator('#hole-hdcp')).toBeVisible();
  // A score on each hole, then on to the next, where the progress pill shows: one digit, then two on hole 11. (The first
  // capsule is 티샷 on a par 3, so it is tapped by its place; moving on puts away the undo toast, which stands in the
  // chip row's place for a few seconds after a tap.)
  for (let n = 1; n <= 10; n++) {
    await page.locator('.club-driver .plus').click();
    await page.locator('.club-putts .plus').click();
    await page.getByRole('button', { name: '다음 홀로 이동' }).click();
    await expect(page.locator('#hole-n')).toHaveText(String(n + 1));
    await expect(page.locator('#toast')).toBeHidden();
    const where = `hole ${n + 1} after ${n} played`;
    expect(await row(where), where).toEqual(['hole-thumb', 'meta', 'progress', 'info-btn']);
    await expect(page.locator('#hole-hdcp'), `${where}: HDCP out of the row`).toBeHidden();
    await expect(page.locator('#hi-facts'), `${where}: HDCP in 홀 안내`).toContainText(/HDCP \d+/);
    await expect(page.locator('#hole-par'), where).toBeVisible();
  }
});

test('lays the hole across the band at one scale, tee at the left, and measures 100 m and 150 m to the green’s middle, as 홀 안내 says (v33)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCourse(page, '에코랜드', '에코랜드 골프클럽');
  const course = page.locator('#course');
  await expect(course).toHaveAttribute('data-art', 'schematic');
  await settled(page);
  const axis = await osmAxis(page);
  const band = await visibleBand(page);
  // The tee at the left of the band, the green's middle at its right; 와일드 1 is "약한 좌 도그렉", so it bends up, to the
  // player's left (as the header's small picture does).
  expect(axis.tee[0]).toBeLessThan(band.x0 + (band.x1 - band.x0) / 4);
  expect(axis.green[0]).toBeGreaterThan(band.x0 + ((band.x1 - band.x0) * 3) / 4);
  expect(axis.green[1]).toBeLessThan(axis.tee[1] - 8);
  // The green near its real size: about 32 m along the line at the drawing's scale.
  const green = (await course.locator('.green').boundingBox())!;
  expect(Math.abs(green.width - 32 * axis.scale)).toBeLessThanOrEqual(32 * axis.scale * 0.1);
  // Both markers, each its distance from the green's middle along the line of play.
  const markers = await course.locator('.marker circle').evaluateAll((list) => list.map((c) => ({ x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')), d: Number(c.closest('g')!.querySelector('text')!.textContent!.replace(' m', '')) })));
  expect(markers.map((m) => m.d)).toEqual([100, 150]);
  for (const m of markers) {
    let along = 0;
    let found = NaN;
    for (let i = axis.line.length - 1; i > 0; i--) {
      const [a, b] = [axis.line[i], axis.line[i - 1]];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = ((m.x - a[0]) * (b[0] - a[0]) + (m.y - a[1]) * (b[1] - a[1])) / (seg * seg);
      if (t >= -0.01 && t <= 1.01 && Math.abs((m.x - a[0]) * (b[1] - a[1]) - (m.y - a[1]) * (b[0] - a[0])) / seg < 0.6) {
        found = along + t * seg;
        break;
      }
      along += seg;
    }
    expectAligned(found, m.d * axis.scale, `${m.d} m from the green's middle along the line`);
  }
  await page.locator('#info-btn').click();
  await expect(page.locator('#hi-marks')).toBeVisible();
  await expect(page.locator('#hi-marks')).toHaveText('그림의 100 m·150 m 표시는 그린 중앙까지의 거리예요.');
  await page.keyboard.press('Escape');
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
  // Past 더블 the badge reads the score against par (v29), and the full name is read aloud.
  await tap(page, 'putts', 2);
  await page.getByRole('button', { name: '그린까지 하나 빼기' }).click();
  await page.getByRole('button', { name: '그린까지 하나 빼기' }).click();
  await page.getByRole('button', { name: '그린까지 하나 빼기' }).click();
  await page.getByRole('button', { name: 'OB 하나 빼기' }).click();
  await page.getByRole('button', { name: '퍼터 하나 빼기' }).click();
  // Now 1 + 2 + 4 = 7 strokes: 트리플 보기 on this par 4 (Everis 새별 2).
  expect(par).toBe(4);
  await expect(page.locator('#hole-name')).toHaveText('+3');
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
  await expect(page.locator('#toast-msg')).toHaveText('1번 홀은 비워 두고 넘어가요');
  await expect(page.locator('#announce')).toContainText('1번 홀은 비워 두고 넘어가요');
  // The long notice covers no button either (v20): the chip row's 홀 안내 steps aside under it. Every visible button
  // (a box and not visibility: hidden, as Playwright counts it) is read in one go while the notice shows: four round
  // trips a button outlasted the notice's 4 seconds on a busy WebKit (v29).
  const covered = await page.evaluate(() => {
    const bar = document.getElementById('toast')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('#entry button:not(#toast-undo)')]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height || getComputedStyle(el).visibility === 'hidden') return false;
        return !(b.right <= bar.left || bar.right <= b.left || b.bottom <= bar.top || bar.bottom <= b.top);
      })
      .map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '');
  });
  expect(covered, 'buttons under the notice').toEqual([]);
  await expect(page.locator('#toast')).toBeVisible();
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  await expect(page.locator('#info-btn')).toBeVisible();
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
  const muted = await token(page, '--muted');
  expect(await style('.club-lbl .club-name')).toEqual(['600', muted]);
  expect(await style('#stake-ob .pen-lbl')).toEqual(['600', muted]);
  expect((await style('#hole-par'))[0]).toBe('600');
  expect((await style('.mode'))[0]).toBe('600');
  expect((await style('.tab-label'))[0]).toBe('600');
  expect((await style('#tab-entry .tab-label'))[0]).toBe('600');
  await page.getByRole('button', { name: '상세', exact: true }).click();
  expect(await style('.tee-t')).toEqual(['600', muted]);
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

test('a long press is not a swipe: moving the mouse across 기록 afterwards does not slide the sheet or swallow 되돌리기', async ({ page }) => {
  await open(page);
  const start = (await page.locator('#count-driver').boundingBox())!;
  await longPress(page, 'driver');
  await page.getByRole('button', { name: '3번', exact: true }).click();
  await expect(count(page, 'driver')).toHaveText('3');
  // The long press's release landed on the picker, outside 기록. A mouse then moving sideways from where the press
  // began, with no button held (as on the way to 되돌리기 when wider type puts it further right), is not a swipe: it
  // neither slides the sheet nor eats the next click.
  await page.mouse.move(start.x + start.width / 2 + 120, start.y + start.height / 2);
  await page.mouse.move(start.x + start.width / 2 + 160, start.y + start.height / 2);
  expect(await page.locator('#sheet').evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(count(page, 'driver')).toHaveText('0');
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
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
  // Chrome's ⋮ menu (v25): Tabler's dots-vertical, since the bundled font has no ⋮, centred on the words beside it.
  const android = page.locator('#hc-more .steps li').nth(1);
  await expect(android).not.toContainText('⋮');
  const kebab = await android.evaluate((li) => {
    const svg = li.querySelector('svg[data-icon="dots-vertical"]')!;
    const text = [...li.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.includes('메뉴'))!;
    const range = document.createRange();
    const at = text.textContent!.indexOf('메뉴');
    range.setStart(text, at);
    range.setEnd(text, at + 2);
    const icon = svg.getBoundingClientRect();
    const words = range.getBoundingClientRect();
    return { shapes: svg.children.length, off: (icon.top + icon.bottom) / 2 - (words.top + words.bottom) / 2, height: icon.height, line: words.height };
  });
  expect(kebab.shapes).toBe(3);
  expect(Math.abs(kebab.off)).toBeLessThanOrEqual(1);
  expect(kebab.height).toBeLessThanOrEqual(kebab.line);
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
  // The sheet's title is the course alone (v23); the nine to play is the row under it.
  await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트');
  // No 후반: one row, named 코스.
  await expect(page.locator('#picker-front-label')).toHaveText('코스');
  await expect(page.locator('#picker-back-label')).toHaveCount(0);
  await expect(page.locator('#picker-chosen [data-nine="saebyul"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#picker-chosen')).toContainText('Par 36');
  await page.locator('#picker-chosen [data-nine="lake"]').click();
  await expect(page.locator('#picker-chosen [data-nine="lake"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트');
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
  // In the toggle's place, the round's fixed nine holes.
  await expect(page.locator('#picker-holes')).toHaveText('9홀');
  await page.locator('#picker-cancel').click();
  await showCard(page);
  await expect(page.locator('#scorecard .nine-tbl')).toHaveCount(1);
  await expect(page.locator('#scorecard .nt-h b')).toHaveText('레이크');
  await expect(page.locator('#scorecard .ct-sum .c-hole')).toHaveText(['9홀']);
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
  for (const club of ['드라이버', '그린까지', '퍼터']) {
    const group = page.getByRole('group', { name: club, exact: true });
    await expect(group.getByRole('button', { name: `${club} 하나 더하기` })).toBeVisible();
    await expect(group.getByRole('button', { name: `${club} 하나 빼기` })).toBeVisible();
    await expect(group.getByText(`${club} 0`, { exact: true })).toBeAttached();
  }
  await tap(page, 'driver');
  await tap(page, 'approach', 2);
  await tap(page, 'putts', 2);
  await expect(page.getByRole('group', { name: '그린까지', exact: true }).getByText('그린까지 2', { exact: true })).toBeAttached();
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
  await detailMode(page);
  await page.getByRole('button', { name: '페어웨이' }).click();
  // In 상세 the second shot is a 세컨 (v28).
  await tap(page, 'second');
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
  // A rate from fewer than three says the count alone (v29): 1/1, not 100%.
  await expect(page.locator('#sum-stats div', { hasText: '페어웨이 안착' }).locator('dd')).toHaveText('1/1');
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
  // It sits on the chip row, over no button (v20: the club names became buttons): every control of 기록 is clear of it.
  // Every visible button (a box and not visibility: hidden, as Playwright counts it) is read in one go while the toast
  // shows: four round trips a button outlasted its 4 seconds on a busy WebKit (v29).
  const covered = await page.evaluate(() => {
    const bar = document.getElementById('toast')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('#entry button:not(#toast-undo)')]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height || getComputedStyle(el).visibility === 'hidden') return false;
        return !(b.right <= bar.left || bar.right <= b.left || b.bottom <= bar.top || bar.bottom <= b.top);
      })
      .map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '');
  });
  expect(covered, 'buttons under the toast').toEqual([]);
  await expect(toast).toBeVisible();
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
  await expect(page.locator('#hole-name')).toHaveText('진행');
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
  await expect(page.locator('#hole-name')).toHaveText('진행');
  await expect(next(page)).toHaveText('라운드 마치기');
  await next(page).click();
  await expect(page.locator('#check-list li')).toHaveText(['퍼트가 없는 홀 1개18번 홀. 칩인으로 끝났다면 그대로 두세요.']);
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#sum-total')).toHaveText('70');
  await expect(page.locator('#sum-count')).toHaveText('18홀을 모두 기록했어요');
  // Finished: back on 기록 the hole shows its result, until it is recorded on again.
  await page.getByRole('button', { name: '요약 닫기' }).click();
  await expect(page.locator('#hole-name')).not.toHaveText('진행');
  await tap(page, 'approach');
  await expect(page.locator('#hole-name')).toHaveText('진행');
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
  await expect(page.getByRole('button', { name: '그린까지 하나 더하기' })).toBeDisabled();
  await next(page).click();
  await expect(page.locator('#announce')).toHaveText('2번 홀, Par 4');
});

test('says so on 기록 when the round cannot be saved', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('denied', 'SecurityError'); };
  });
  await open(page);
  await tap(page, 'driver');
  await expect(page.locator('#notice')).toContainText('저장할 수 없어요');
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
      const check = async (keys: readonly string[] = KEYS.기본) => {
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
        for (const selector of ['#prev-hole', '#next-hole', '#stake-ob', '#stake-hazard', ...keys.flatMap((k) => [`.club-${k} .plus`, `.club-${k} .minus`])]) {
          const box = (await page.locator(selector).first().boundingBox())!;
          expect(box.y + box.height, selector).toBeLessThanOrEqual(go.y);
          expect(box.height, selector).toBeGreaterThanOrEqual(48);
          expect(box.width, selector).toBeGreaterThanOrEqual(48);
        }
        // The way back to the site sits at the top left since v32, left of the hole switcher, out of the bar.
        const home = (await page.locator('.home-link').boundingBox())!;
        const switcher = (await page.locator('#entry .switcher').boundingBox())!;
        expect(Math.min(home.width, home.height)).toBeGreaterThanOrEqual(48);
        expect(home.y + home.height).toBeLessThanOrEqual(tabs.y);
        expect(home.x + home.width).toBeLessThanOrEqual(switcher.x);
        // The count keeps at least 8px clear of the round + and −.
        for (const key of keys) {
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
      // Four capsules since v28, with the one-time tip over their middle and then without it.
      await check(KEYS.상세);
      await page.locator('#split-tip').tap();
      await expect(page.locator('#split-tip')).toBeHidden();
      await check(KEYS.상세);
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
      // An OB, so 빼기 shows too (v28: under 세컨, as it sits under the middle in 기본).
      await tap(page, 'ob');
      await atRest(page);
      // OB under 드라이버, 빼기 under 세컨, 벙커 under 어프로치, 해저드 under 퍼터: four columns since v28.
      const pens = await Promise.all(['#stake-ob', '#pen-undo', '#stake-bunker', '#stake-hazard'].map(async (s) => (await page.locator(s).boundingBox())!));
      const cols = await Promise.all(KEYS.상세.map(async (k) => (await page.locator(`.club-${k} .pill`).boundingBox())!));
      pens.forEach((b, j) => {
        expect(Math.abs(b.width - pens[0].width), `pill ${j} width`).toBeLessThanOrEqual(1);
        expect(Math.abs(b.x + b.width / 2 - (cols[j].x + cols[j].width / 2)), `pill ${j} centre`).toBeLessThanOrEqual(1);
        expect(Math.min(b.width, b.height), `pill ${j} target`).toBeGreaterThanOrEqual(48);
      });
      for (const m of ['basic', 'detail']) expect((await page.locator(`button[data-mode="${m}"]`).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      // Each capsule splits in half (v20): two buttons of at least 48px that meet at its midline, in both modes.
      for (const mode of ['상세', '기본'] as const) {
        if (mode === '기본') await page.getByRole('button', { name: '기본', exact: true }).click();
        await atRest(page);
        for (const key of KEYS[mode]) {
          const plus = (await page.locator(`.club-${key} .plus`).boundingBox())!;
          const minus = (await page.locator(`.club-${key} .minus`).boundingBox())!;
          expect(Math.min(plus.height, minus.height), `${mode} ${key} halves`).toBeGreaterThanOrEqual(48);
          expect(Math.abs(minus.y - (plus.y + plus.height)), `${mode} ${key} halves meet`).toBeLessThanOrEqual(1);
        }
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

    test('기록 sits on one grid: switcher centred, chips on the card edge, badge and penalties on the stepper columns', async ({ page }) => {
      await open(page);
      for (const mode of ['기본', '상세'] as const) {
        if (mode === '상세') await page.getByRole('button', { name: '상세', exact: true }).click();
        await atRest(page);
        const sheet = await rect(page, '#sheet');
        const switcher = await rect(page, '#entry .switcher');
        expectAligned(midX(switcher), width / 2, `${mode}: hole switcher centre`);
        // No menu button at the top left since v32: 메뉴 is in the bar.
        await expect(page.locator('#entry .top [data-menu]')).toHaveCount(0);
        // The badge sits in the top bar's right slot: 60px, on the inset, on the bar's centre line, clear of the card.
        const badge = await rect(page, '#badge');
        expectAligned(badge.width, 60, `${mode}: badge width`);
        expectAligned(badge.height, 60, `${mode}: badge height`);
        expectAligned(badge.x + badge.width, sheet.x + sheet.width, `${mode}: badge right edge on the inset`);
        expectAligned(midY(badge), midY(switcher), `${mode}: badge on the top bar's centre line`);
        expect(badge.y + badge.height, `${mode}: badge clear of the card`).toBeLessThan(sheet.y);
        // 기록 carries no version since v29: it lives under 앱 정보.
        await expect(page.locator('#app-version')).toHaveCount(0);
        expect((await rect(page, 'button[data-mode="basic"]')).height, `${mode}: toggle height`).toBeGreaterThanOrEqual(44);
        if (mode === '상세') {
          // The direction pad runs from the card's content edge to the other, like the tee line.
          const pad = await page.locator('#pad button').all();
          const [first, last] = [(await pad[0].boundingBox())!, (await pad[pad.length - 1].boundingBox())!];
          const line = await rect(page, '.tee-line');
          expectAligned(first.x, line.x, '상세: pad left edge');
          expectAligned(last.x + last.width, line.x + line.width, '상세: pad right edge');
        }
        const cols = await Promise.all(KEYS[mode].map((k) => rect(page, `.club-${k} .pill`)));
        const [c1, c2] = cols;
        const cLast = cols[cols.length - 1];
        // The capsules run from the card's content edge to the other (16px in from the card), one width, one gap.
        expectAligned(c1.x, sheet.x + 16, `${mode}: first capsule on the content edge`);
        expectAligned(cLast.x + cLast.width, sheet.x + sheet.width - 16, `${mode}: last capsule on the content edge`);
        for (const [j, c] of cols.entries()) {
          expectAligned(c.width, c1.width, `${mode}: capsule ${j + 1} width`);
          if (j) expectAligned(c.x - (cols[j - 1].x + cols[j - 1].width), cols[1].x - (c1.x + c1.width), `${mode}: gap before capsule ${j + 1}`);
          // Each name sits over its capsule: in 상세 a chip as wide as it (v28), in 기본 centred on it.
          const chip = await rect(page, `#lbl-${KEYS[mode][j]} .lbl-in`);
          expectAligned(midX(chip), midX(c), `${mode}: ${KEYS[mode][j]} name over its capsule`);
          if (mode === '상세') expectAligned(chip.width, c.width, `상세: ${KEYS[mode][j]} name as wide as its capsule`);
        }
        expectAligned(midX(await rect(page, '#stake-ob .pen-icon')), midX(c1), `${mode}: OB under 드라이버`);
        expectAligned(midX(await rect(page, '#stake-hazard .pen-icon')), midX(cLast), `${mode}: 해저드 under 퍼터`);
        if (mode === '기본') {
          expectAligned(midX(c2), width / 2, '기본: middle stepper');
          expectAligned((await rect(page, '#hole-info')).x, sheet.x, '기본: chips left edge');
          const info = await rect(page, '#info-btn');
          expectAligned(info.x + info.width, sheet.x + sheet.width, '기본: 홀 안내 on the right inset');
          await expect(page.locator('#stake-bunker')).toBeHidden();
          await tap(page, 'ob');
          await atRest(page);
          expectAligned(midX(await rect(page, '#pen-undo .u-ico')), midX(c2), '기본: 빼기 under 그린까지');
        } else {
          // Four capsules (v28): the gap between 세컨 and 어프로치 on the screen's centre line; 빼기 under 세컨 (an OB
          // was added in 기본), 벙커 under 어프로치.
          expectAligned((c2.x + c2.width + cols[2].x) / 2, width / 2, '상세: middle gap on the centre line');
          expectAligned(midX(await rect(page, '#pen-undo .u-ico')), midX(c2), '상세: 빼기 under 세컨');
          expectAligned(midX(await rect(page, '#stake-bunker .pen-icon')), midX(cols[2]), '상세: 벙커 under 어프로치');
          // The 0 … 5+ picker spans the card, its first and last choice on the card's content edge.
          await longPressPen(page, 'hazard');
          const pick = await rect(page, '#numpick');
          expectAligned(pick.x, sheet.x, 'picker left edge');
          expectAligned(pick.x + pick.width, sheet.x + sheet.width, 'picker right edge');
          const choices = page.locator('#np-row button');
          expectAligned((await choices.first().boundingBox())!.x, c1.x, 'picker 0 on the content edge');
          const last = (await choices.last().boundingBox())!;
          expectAligned(last.x + last.width, cLast.x + cLast.width, 'picker 5+ on the content edge');
          await page.keyboard.press('Escape');
        }
      }
    });

    test('the title row, the right-hand action and the card keep their place on every tab', async ({ page }) => {
      await open(page);
      await atRest(page);
      // The row's line is the hole switcher's (v32: the menu button that set it moved into the bar).
      const line = midY(await rect(page, '#entry .switcher'));
      const sheet = await rect(page, '#sheet');
      await showCard(page);
      const edit = await rect(page, '#edit-par');
      expectAligned(edit.x + edit.width, sheet.x + sheet.width, '파 수정 right edge');
      expectAligned(midY(edit), line, '파 수정 middle');
      expectAligned(midX(await rect(page, '#card-view .sc-title')), width / 2, '스코어카드 title centre');
      expectAligned(midY(await rect(page, '#card-view .sc-title')), line, '스코어카드 title middle');
      const card = await rect(page, '#sc-sheet');
      expectAligned(card.x, sheet.x, 'card left edge');
      expectAligned(card.x + card.width, sheet.x + sheet.width, 'card right edge');
      await tab(page, '지난 라운드').click();
      await expect(page.locator('#hist-view')).toBeVisible();
      expectAligned(midX(await rect(page, '#hist-view .sc-title')), width / 2, '지난 라운드 title centre');
      expectAligned(midY(await rect(page, '#hist-view .sc-title')), line, '지난 라운드 title middle');
    });
  });
}

// Linux and Android draw Hangul and digits with other fonts (DejaVu Sans, Noto Sans CJK) than the Mac (SF, Apple SD
// Gothic Neo): wider, with another ascent, descent and cap height. Stand-ins prove the same rules on every machine.
// Wider letters for the widths.
const WIDER = '* { letter-spacing: .1em !important; }';
// For the heights: Verdana and Arial Unicode MS (taller digits, a deeper ascent and descent; Linux, which has neither,
// falls back to its own fonts), spaced wider, with lines a tenth taller wherever a line takes the body's height.
const OTHER_TYPE = "* { font-family: Verdana, 'Arial Unicode MS', sans-serif !important; letter-spacing: .1em !important; } body { line-height: 1.6 !important; }";
for (const [width, height] of [[360, 640], [375, 553]]) {
  test.describe(`with wider type, as on Linux and Android, on a ${width}×${height} phone`, () => {
    // Only to add the widening style: the page's own CSP blocks injected styles.
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, bypassCSP: true });

    test('the hole switcher stays centred and clear of the badge, and 기록 still fits', async ({ page }) => {
      await open(page);
      await page.addStyleTag({ content: WIDER });
      for (const hole of [0, 9]) {
        if (hole === 9) await pickHole(page, 9);
        for (const mode of ['기본', '상세'] as const) {
          await page.getByRole('button', { name: mode, exact: true }).click();
          await atRest(page);
          const where = `hole ${hole + 1} ${mode}`;
          const sw = await rect(page, '#entry .switcher');
          const badge = await rect(page, '#badge');
          expectAligned(midX(sw), width / 2, `${where}: switcher centre`);
          expect(sw.x + sw.width, `${where}: switcher clear of the badge`).toBeLessThanOrEqual(badge.x - 4);
          // The hole number stays whole; only the words beside it may shorten.
          const n = await rect(page, '#hole-n');
          expect(n.x, where).toBeGreaterThanOrEqual(sw.x);
          expect(n.x + n.width, where).toBeLessThanOrEqual(sw.x + sw.width);
          const info = page.locator('#hole-info');
          if (await info.isVisible()) {
            const row = await rect(page, '#hole-info');
            expect(row.x + row.width, `${where}: chip row inside the inset`).toBeLessThanOrEqual(width - 16 + 0.5);
          }
          expect(await sideScroll(page), where).toBe(0);
          expect(await page.locator('#sheet').evaluate((el) => el.scrollHeight - el.clientHeight), where).toBeLessThanOrEqual(1);
        }
      }
    });

    test('with wider and other fonts, each club’s name stays whole in its column and the capsule’s halves stay 48px, meeting at the midline (v20)', async ({ page }) => {
      await open(page);
      for (const style of [WIDER, OTHER_TYPE]) {
        const added = await page.addStyleTag({ content: style });
        for (const mode of ['기본', '상세'] as const) {
          await page.getByRole('button', { name: mode, exact: true }).click();
          await atRest(page);
          for (const key of KEYS[mode]) {
            const where = `${style === WIDER ? 'wider' : 'other fonts'} ${mode} ${key}`;
            const name = await rect(page, `#lbl-${key} .lbl-in`);
            const col = await rect(page, `.club-${key}`);
            expect(name.x, where).toBeGreaterThanOrEqual(col.x - 0.5);
            expect(name.x + name.width, where).toBeLessThanOrEqual(col.x + col.width + 0.5);
            expect(await page.locator(`#name-${key}`).evaluate((el) => el.scrollWidth - el.clientWidth), `${where}: name whole`).toBeLessThanOrEqual(0);
            const plus = await rect(page, `.club-${key} .plus`);
            const minus = await rect(page, `.club-${key} .minus`);
            expect(Math.min(plus.height, minus.height), `${where}: halves`).toBeGreaterThanOrEqual(48);
            expect(Math.abs(minus.y - (plus.y + plus.height)), `${where}: halves meet`).toBeLessThanOrEqual(1);
          }
          expect(await sideScroll(page)).toBe(0);
        }
        await added.evaluate((el) => el.remove());
      }
    });

    test('with other fonts, each count keeps 8px clear of + and −, in 큰 글씨 too', async ({ page }) => {
      await open(page);
      for (const big of [false, true]) {
        if (big) {
          await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), big: true })), PREFS_KEY);
          await page.reload();
          await expect(page.locator('body')).toHaveClass(/big/);
        }
        await page.addStyleTag({ content: OTHER_TYPE });
        for (const mode of ['기본', '상세'] as const) {
          await page.getByRole('button', { name: mode, exact: true }).click();
          await atRest(page);
          for (const key of KEYS[mode]) {
            const [plus, n, minus] = await Promise.all([`.club-${key} .plus span`, `#count-${key}`, `.club-${key} .minus span`].map((s) => rect(page, s)));
            const where = `${big ? '큰 글씨 ' : ''}${mode} ${key}`;
            expect(n.y - (plus.y + plus.height), where).toBeGreaterThanOrEqual(8);
            expect(minus.y - (n.y + n.height), where).toBeGreaterThanOrEqual(8);
          }
        }
      }
    });

    test('with other fonts, the first course picker keeps the link home and 이 코스로 시작 on screen, the list between them', async ({ page }) => {
      await page.goto('/');
      await page.addStyleTag({ content: OTHER_TYPE });
      await expect(page.locator('#picker')).toBeVisible();
      await settled(page);
      const home = await rect(page, '#picker a[href="../../"]');
      expect(home.y, 'link home').toBeGreaterThanOrEqual(0);
      // The list still shows a row and a half, under the header and above the button.
      const list = await rect(page, '#picker-list');
      expect(list.y).toBeGreaterThanOrEqual(home.y + home.height);
      expect(list.height).toBeGreaterThanOrEqual(96);
      const start = await rect(page, '#picker-start');
      expect(list.y + list.height).toBeLessThanOrEqual(start.y);
      expect(start.y + start.height, '이 코스로 시작').toBeLessThanOrEqual(height);
      // The chosen course's last line still comes into view above the button, which stays where it is.
      await page.locator('#picker-chosen .small').scrollIntoViewIfNeeded();
      const line = await rect(page, '#picker-chosen .small');
      expect(line.y + line.height).toBeLessThanOrEqual(start.y);
      expect(await rect(page, '#picker-start')).toEqual(start);
      expect(await sideScroll(page)).toBe(0);
    });

    test('with other fonts, 지난 라운드 keeps each score on its title’s baseline', async ({ page }) => {
      await open(page);
      await seed(page, SEVEN_HOLES, 5);
      await seedHistory(page, [10, 12, 8]);
      await page.addStyleTag({ content: OTHER_TYPE });
      await tab(page, '지난 라운드').tap();
      await expect(pastItems(page)).toHaveCount(3);
      await settled(page);
      within1px(await baselineOf(page, '#now-score'), await baselineOf(page, '#now-title'), '지금 라운드 score');
      for (const n of [1, 2, 3]) {
        const row = `#history-list li:nth-child(${n})`;
        within1px(await baselineOf(page, `${row} .past-score`), await baselineOf(page, `${row} .past-when`), `row ${n} score`);
      }
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

/**
 * A check of one text against what is under it: `min` 4.5, or 3 for big numbers; `unders` when it sits on the drawn course;
 * `also`, layers that are not its ancestors but lie under it (a capsule's half under its count, v21), painted above them.
 */
type Contrast = { sel: string; min: number; unders?: string[]; also?: string[] };
/**
 * In the page: WCAG contrast of each text on what is really under it (v19). Colours are normalised by a one-pixel
 * canvas (any CSS colour, palette mixes too) and translucent layers are painted from the outside in. With `unders`
 * (colours or palette tokens) the text sits on the drawn course: the page's own ground is left out and the worst of
 * those colours counts.
 */
function contrastIn(checks: Contrast[]) {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const rgba = (css: string) => {
    cv.clearRect(0, 0, 1, 1);
    cv.fillStyle = 'rgba(0,0,0,0)';
    cv.fillStyle = css;
    cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const tokenColour = (name: string) => {
    const probe = document.createElement('i');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  };
  const over = (top: number[], under: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const lum = (c: number[]) => {
    const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  return checks.map(({ sel, min, unders, also }) => {
    const el = document.querySelector(sel);
    if (!el) return { sel, min, size: 0, ratio: null as number | null };
    const layers: number[][] = [];
    for (let e: Element | null = el; e && !(unders && (e === document.body || e === document.documentElement)); e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) layers.push(c);
    }
    const bases = unders ? unders.map((u) => rgba(u.startsWith('--') ? tokenColour(u) : u)) : [[255, 255, 255, 1]];
    let worst = Infinity;
    for (const base of bases) {
      let bg = base;
      for (const layer of layers.slice().reverse()) bg = over(layer, bg);
      for (const layer of also ?? []) bg = over(rgba(getComputedStyle(document.querySelector(layer)!).backgroundColor), bg);
      worst = Math.min(worst, ratio(over(rgba(getComputedStyle(el).color), bg), bg));
    }
    return { sel, min, size: parseFloat(getComputedStyle(el).fontSize), ratio: worst };
  });
}
const contrastOf = (page: Page, checks: Contrast[]) => page.evaluate(contrastIn, checks);
/**
 * The paints drawn behind an element (v33): at points over its box, the first shape of the drawing under it, by its fill
 * (its stroke where it has none). A shore's dark line counts as the water it edges, the worse of the two.
 */
const drawnUnder = (page: Page, sel: string) => page.evaluate((s) => {
  const r = document.querySelector(s)!.getBoundingClientRect();
  const paints = new Set<string>();
  for (let i = 0; i <= 12; i++) {
    for (let j = 0; j <= 4; j++) {
      const shape = document.elementsFromPoint(r.left + 0.5 + ((r.width - 1) * i) / 12, r.top + 0.5 + ((r.height - 1) * j) / 4)
        .find((el) => el.closest('#course') !== null && el.id !== 'course');
      if (!shape) continue;
      const st = getComputedStyle(shape);
      paints.add(st.fill !== 'none' ? st.fill : st.stroke);
    }
  }
  return [...paints];
}, sel);
/** The © OpenStreetMap credit (v33: gray text on the drawing) at least 4.5:1 and 13px against everything drawn behind it. */
async function expectCreditLegible(page: Page, where: string) {
  const unders = await drawnUnder(page, '#osm-credit');
  expect(unders.length, `${where}: something drawn behind the credit`).toBeGreaterThan(0);
  const [legible] = await contrastOf(page, [{ sel: '#osm-credit', min: 4.5, unders }]);
  expect(legible.size, `${where}: credit size`).toBeGreaterThanOrEqual(13);
  expect(legible.ratio!, `${where}: credit on ${unders.join(' | ')}`).toBeGreaterThanOrEqual(4.5);
}
/**
 * What a chip, a label or the glass card (v20) can sit on over the drawn course: its darkest edge to the sunlit fairway, and
 * the sand and water a hole note names, up to sunlit sand (v22). Palette tokens.
 */
const OVER_ART = ['--deep', '--rough', '--art-cut', '--fairway', '--putting', '--water', '--sand'];

test('labels are large and dark enough to read in sunlight, and a disabled minus is not just faded', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page);
  await tap(page, 'driver');
  await tap(page, 'putts');
  const checks = await contrastOf(page, [
    ...['#hole-name', '.tab-label', '.home-link'].map((sel) => ({ sel, min: 4.5 })),
    ...['.club-lbl', '.pen-lbl', '.mode', '#hole-par', '#prog-n', '#info-btn'].map((sel) => ({ sel, min: 4.5, unders: OVER_ART })),
  ]);
  await showCard(page);
  checks.push(...await contrastOf(page, ['.sh-stats dt', '.ct-lbl .c-par', '.ct-col .c-par', '.nt-h small', '#par-source', '.metrics dt'].map((sel) => ({ sel, min: 4.5 }))));
  for (const { sel, size, ratio } of checks) {
    expect(size, sel).toBeGreaterThanOrEqual(13);
    expect(ratio, sel).toBeGreaterThanOrEqual(4.5);
  }
  await showEntry(page);
  const look = (selector: string) => page.locator(selector).evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, opacity: getComputedStyle(el).opacity }));
  const on = await look('.club-driver .minus span');
  const off = await look('.club-approach .minus span');
  expect(on.background).not.toBe(off.background);
  expect(on.color).not.toBe(off.color);
  expect(off.opacity).toBe('1');
});

for (const [width, height] of [[390, 844], [375, 553]]) {
  test.describe(`in sunlight on a ${width}×${height} phone (v19 palette)`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('every key text stands out from what is under it: 4.5:1, and 3:1 for the big numbers', async ({ page }) => {
      const found: { where: string; sel: string; min: number; ratio: number | null }[] = [];
      const check = async (where: string, checks: Contrast[]) => { for (const r of await contrastOf(page, checks)) found.push({ where, ...r }); };
      const PICKER = ['--rough'];
      await page.goto('/');
      await expect(page.locator('#picker')).toBeVisible();
      await settled(page);
      await check('코스 선택', [
        { sel: '#picker-title', min: 3, unders: PICKER }, { sel: '.picker-home', min: 4.5, unders: PICKER },
        { sel: ".picker .chip[aria-pressed='false']", min: 4.5, unders: PICKER }, { sel: ".picker .chip[aria-pressed='true']", min: 4.5, unders: PICKER },
        { sel: '.picker-list .course b', min: 4.5 }, { sel: '.picker-list .course span', min: 4.5 }, { sel: '#picker-label', min: 4.5 },
        { sel: '.nine-label', min: 4.5 }, { sel: ".nine-pick button[aria-checked='false']", min: 4.5 }, { sel: ".nine-pick button[aria-checked='true']", min: 4.5 },
        { sel: '#picker-start', min: 4.5 },
      ]);
      await page.getByRole('button', { name: '이 코스로 시작' }).tap();
      await check('기록, 0타', [{ sel: '#count-driver', min: 3, unders: OVER_ART, also: ['.club-driver .minus'] }]);
      // Four holes played (a birdie, a double and two pars) and hole 5 at par: the par badge, counts and chips over the course.
      await seed(page, { 0: { driver: 1, approach: 1, putts: 2 }, 1: { driver: 1, approach: 3, putts: 2 }, 2: { driver: 1, approach: 2, putts: 2 }, 3: { driver: 1, putts: 1 }, 4: { driver: 1, approach: 2, putts: 1 } }, 4);
      await atRest(page);
      await check('기록 기본', [
        { sel: '#count-driver', min: 3, unders: OVER_ART, also: ['.club-driver .minus'] }, { sel: '.club-lbl', min: 4.5, unders: OVER_ART }, { sel: '.pen-lbl', min: 4.5, unders: OVER_ART },
        { sel: ".mode[aria-pressed='false']", min: 4.5, unders: OVER_ART }, { sel: ".mode[aria-pressed='true']", min: 4.5, unders: OVER_ART }, { sel: '#go-next', min: 4.5 },
        { sel: '#tab-card .tab-label', min: 4.5 }, { sel: '#tab-entry .tab-label', min: 4.5 }, { sel: '.home-link', min: 4.5 },
        { sel: '#hole-par', min: 4.5, unders: OVER_ART }, { sel: '#info-btn', min: 4.5, unders: OVER_ART }, { sel: '#prog-n', min: 4.5, unders: OVER_ART },
        { sel: '#hole-n', min: 3, unders: OVER_ART }, { sel: '#hole-name', min: 4.5 }, { sel: '#hole-strokes', min: 3 },
      ]);
      await page.getByRole('button', { name: '상세', exact: true }).tap();
      await page.getByRole('button', { name: '페어웨이' }).tap();
      await atRest(page);
      await check('기록 상세', ['.tee-t', '.tee-t .val', '.tchip', ".dir[aria-pressed='true']", '.pen-lbl', '.club-lbl'].map((sel) => ({ sel, min: 4.5, unders: OVER_ART })));
      await page.getByRole('button', { name: '기본', exact: true }).tap();
      await tab(page, '스코어카드').tap();
      await settled(page);
      await check('스코어카드', [
        { sel: '.sh-stats dt', min: 4.5 }, { sel: '.ct-lbl .c-par', min: 4.5 }, { sel: '.ct-col .c-par', min: 4.5 }, { sel: '.nt-h small', min: 4.5 },
        { sel: '#par-source', min: 4.5 }, { sel: ".m[data-tone='under'] b", min: 3 }, { sel: ".m[data-tone='par'] b", min: 3 }, { sel: '#sh-ring b', min: 3 },
        { sel: '#scorecard .ct-col.cur .c-hole', min: 4.5 },
        // 스코어카드 | 분석 (v26): the chosen half on its white pill, the other in --muted on the tint.
        { sel: "#sc-switch [aria-checked='true']", min: 4.5 }, { sel: "#sc-switch [aria-checked='false']", min: 4.5 },
      ]);
      await page.locator('#finish-round').tap();
      await page.getByRole('button', { name: '그대로 마치기' }).tap();
      await expect(page.locator('#sum-card')).toHaveAttribute('data-state', 'ready');
      await check('요약', [{ sel: '.sum-actions .primary', min: 4.5 }, { sel: '.sum-ring b', min: 3 }, { sel: '.sum-stats dt', min: 4.5 }]);
      for (const r of found) {
        expect(r.ratio, `${r.where} ${r.sel}: not found`).not.toBeNull();
        expect(r.ratio!, `${r.where} ${r.sel}`).toBeGreaterThanOrEqual(r.min);
      }
    });
  });
}

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
  // The browser bar and the installed app's splash take the page's own ground, the palette's rough (v19), so the
  // first paint does not flash another colour; the manifest and the meta tag cannot read CSS, so they hold it as hex.
  const ground = await page.evaluate(() => {
    const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    cv.fillStyle = getComputedStyle(document.body).backgroundColor;
    cv.fillRect(0, 0, 1, 1);
    return `#${[...cv.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  });
  expect(manifest).toMatchObject({
    name: 'Fairway Note', short_name: 'Fairway Note', start_url: './', scope: './', display: 'standalone',
    theme_color: ground, background_color: ground,
  });
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
  expect(url.searchParams.get('body')).toContain('1번 Par4: 4타 (E) 드1 그1 퍼2');
  await page.getByRole('button', { name: '결과 복사' }).click();
  await expect(page.locator('#send-status')).toContainText('복사했어요');
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
  expect(rows[0]).toBe('홀,파,드라이버,그린까지,퍼트,OB,해저드,타수,파 대비,세컨,어프로치');
  // 세컨 and 어프로치 are the last two columns (v28), empty on a hole recorded in 기본.
  expect(rows[1]).toBe('1,4,1,1,2,0,0,4,0,,');
  expect(rows[2]).toBe('2,4,,,,,,,,,');
  expect(rows[19]).toBe('합계,4,1,1,2,0,0,4,0,,');
  await expect(page.locator('#send-status')).toContainText('CSV 파일을 저장했어요');
  await page.getByRole('button', { name: '분석용 텍스트 복사' }).click();
  await expect(page.locator('#send-status')).toContainText('분석용 텍스트를 복사했어요');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('골프장: 에버리스 골프리조트');
  expect(text).toContain('코스: 전반 새별 · 후반 레이크');
  expect(text).toContain('1 | 4 | 1 | 1 | - | - | 2 | 0 | 0 | 4 | E');
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
  expect(data.text).toContain('3번 Par5: 7타 (+2) 드1 그3 퍼2 OB 1');
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
  expect(data.text).toContain('1번 Par4: 4타 (E) 드1 그1 퍼2');
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
  await expect(page.locator('#sum-status')).toContainText('복사했어요');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('1번 Par4: 4타 (E) 드1 그1 퍼2');
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
  expect(await preview(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--deep'));
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
      // It keeps well clear of the close button above it (v23: the close sits on the title's line).
      const close = await box('#sum-close');
      expect(card.y - (close.y + close.height)).toBeGreaterThanOrEqual(24);
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

/* ---------- the bundled font (v24): Pretendard, so every phone lays text out with the same metrics ---------- */

/** The bundled font's faces as the page sees them, once it is laid out and every font it asked for has settled. */
const pretendardFaces = (page: Page) => page.evaluate(async () => {
  document.body.getBoundingClientRect();
  await document.fonts.ready;
  return [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Pretendard')
    .map((f) => ({ weight: f.weight === 'normal' ? '400' : f.weight, status: f.status }));
});
/** AGENTS.md's check that a font is really used: after `document.fonts.ready`, a face of the family has loaded. */
const loadedWeights = async (page: Page) => (await pretendardFaces(page)).filter((f) => f.status === 'loaded').map((f) => f.weight).sort();

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
  // So did the font (v24): its faces load, none fails.
  expect((await pretendardFaces(page)).filter((f) => f.status === 'error')).toEqual([]);
  expect((await loadedWeights(page)).length).toBeGreaterThan(0);
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
  // The bundled font's three faces and its licence (v24).
  for (const face of ['Regular', 'SemiBold', 'ExtraBold']) expect(source).toMatch(new RegExp(`"assets/Pretendard-${face}\\.subset-[^"/]+\\.woff2"`));
  expect(source).toContain('"assets/Pretendard-LICENSE.txt"');
  // And the icons' notice (v25).
  expect(source).toContain('"assets/Tabler-LICENSE.txt"');
  expect(source).not.toMatch(/"\//);
  expect(source).not.toContain('design/');
});

/** Pretendard's own advances for 0 and 1 in the bundled subsets, in units of 2048 per em, read from the woff2s' hmtx
 * and GSUB tnum (v26): the tabular pair shares one advance at each weight. */
const FONT_ADVANCES = { 400: { tabular: 1258, zero: 1220, one: 898 }, 600: { tabular: 1314, zero: 1308, one: 940 }, 800: { tabular: 1368, zero: 1396, one: 980 } } as const;
const px = (units: number) => `${((units / 2048) * 40).toFixed(3)}px`;

test.describe('the bundled font (v24)', () => {
  test.use({ viewport: { width: 375, height: 553 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('draws the app in Pretendard: one same-origin woff2 face per weight token, shown with swap, all three loaded by the first screens', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#picker')).toBeVisible();
    expect(await loadedWeights(page)).not.toEqual([]);
    // The @font-face rules: 400, 600 and 800 (--w-help, --w-label, --w-value), each a woff2 of the app's own build,
    // with no local() copy, which could be another version measuring differently.
    const faces = await page.evaluate(() => [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]
      .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
      .map((rule) => {
        const src = rule.style.getPropertyValue('src');
        const urls = [...src.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => new URL(m[1], sheet.href ?? location.href));
        const weight = rule.style.getPropertyValue('font-weight');
        return {
          family: rule.style.getPropertyValue('font-family').replace(/["']/g, ''),
          weight: weight === 'normal' ? '400' : weight,
          display: rule.style.getPropertyValue('font-display'),
          local: src.includes('local('),
          files: urls.map((url) => (url.origin === location.origin ? url.pathname.split('/').slice(-2).join('/') : url.href)),
        };
      })));
    expect(faces).toEqual([
      { family: 'Pretendard', weight: '400', display: 'swap', local: false, files: [expect.stringMatching(/^assets\/Pretendard-Regular\.subset-[^/]+\.woff2$/)] },
      { family: 'Pretendard', weight: '600', display: 'swap', local: false, files: [expect.stringMatching(/^assets\/Pretendard-SemiBold\.subset-[^/]+\.woff2$/)] },
      { family: 'Pretendard', weight: '800', display: 'swap', local: false, files: [expect.stringMatching(/^assets\/Pretendard-ExtraBold\.subset-[^/]+\.woff2$/)] },
    ]);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--w-help').trim())).toBe('400');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--w-label').trim())).toBe('600');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--w-value').trim())).toBe('800');
    await page.getByRole('button', { name: '이 코스로 시작' }).click();
    await expect(page.locator('#picker')).toBeHidden();
    // A finished hole, so 스코어카드 has its table.
    await tap(page, 'driver');
    await tap(page, 'putts');
    await showCard(page);
    // The picker, 기록 and 스코어카드 use all three; none failed to load.
    expect(await loadedWeights(page)).toEqual(['400', '600', '800']);
    expect((await pretendardFaces(page)).filter((f) => f.status === 'error')).toEqual([]);
    // Pretendard comes first, the system fonts after it for anything it lacks.
    for (const selector of ['body', '#hole-n', '#count-driver', '#hole-strokes', '#scorecard .ct']) {
      expect(await page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily), selector)
        .toMatch(/^["']?Pretendard["']?, -apple-system, ["']?Apple SD Gothic Neo["']?, ["']?Noto Sans KR["']?, system-ui, sans-serif$/);
    }
  });

  test('keeps digits tabular in Pretendard wherever numbers line up, at each of the three weights', async ({ page }) => {
    await open(page);
    await tap(page, 'driver');
    await tap(page, 'putts');
    for (const selector of ['#hole-n', '#count-driver', '#hole-strokes', '#prog-p']) {
      expect(await page.locator(selector).evaluate((el) => getComputedStyle(el).fontVariantNumeric), selector).toContain('tabular-nums');
    }
    await showCard(page);
    expect(await page.locator('#scorecard .ct').first().evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
    // Unhinted advances everywhere (v26): Linux CI's FreeType hinted each glyph on its own, so Pretendard's tabular 1
    // came out 25px and its 0 24px at 40px although the font gives both 1258 units; phones never hint advances.
    for (const selector of ['body', '#scorecard .ct', '#hole-n', '#count-driver']) {
      expect(await page.locator(selector).first().evaluate((el) => getComputedStyle(el).textRendering), selector).toMatch(/^geometricprecision$/i);
    }
    // Ten ones and ten zeros in the page's own font: as wide as each other with tabular-nums, and far apart without
    // it, so the subset still carries tnum and the font is what draws them.
    // Each face is loaded for these very characters before anything is measured, and the page gets two frames to take
    // it up (v26): on Linux CI a face that load() had just returned still left the 400 digits in a system font once
    // (ones and zeros 10px apart with tabular-nums; Pretendard's tabular ones and zeros are one advance, 1258 units).
    const faces = await page.evaluate(async () => {
      const out: Record<string, number> = {};
      for (const weight of ['400', '600', '800']) out[weight] = (await document.fonts.load(`${weight} 40px Pretendard`, '0123456789')).length;
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return out;
    });
    // The digits at one weight, with what the fonts behind Pretendard make of them, so a failure says which font drew.
    const digits = (weight: string) => page.evaluate((weight) => {
      const probe = document.createElement('span');
      probe.style.cssText = 'position: absolute; white-space: nowrap; font-size: 40px';
      probe.style.fontWeight = weight;
      const behind = probe.cloneNode() as HTMLElement;
      behind.style.fontFamily = getComputedStyle(document.body).fontFamily.replace(/^["']?Pretendard["']?,\s*/, '');
      document.body.append(probe, behind);
      const measure = (el: HTMLElement, numeric: string) => ['1111111111', '0000000000'].map((text) => {
        el.style.fontVariantNumeric = numeric;
        el.textContent = text;
        return Math.round(el.getBoundingClientRect().width * 1000) / 1000;
      });
      const tabular = measure(probe, 'tabular-nums');
      const proportional = measure(probe, 'proportional-nums');
      // One glyph's advance as drawn, to set beside the font's own (FONT_ADVANCES) when this ever fails.
      const glyph = (numeric: string, text: string) => {
        probe.style.fontVariantNumeric = numeric;
        probe.textContent = text;
        return Math.round(probe.getBoundingClientRect().width * 1000) / 1000;
      };
      const out = {
        tabular, proportional, behind: measure(behind, 'tabular-nums'),
        advances: { tabular: { 0: glyph('tabular-nums', '0'), 1: glyph('tabular-nums', '1') }, proportional: { 0: glyph('proportional-nums', '0'), 1: glyph('proportional-nums', '1') } },
        textRendering: getComputedStyle(probe).textRendering,
        tabularEqual: Math.abs(tabular[0] - tabular[1]) <= 0.5, proportionalApart: Math.abs(proportional[0] - proportional[1]) > 20,
      };
      probe.remove();
      behind.remove();
      return out;
    }, weight);
    for (const weight of ['400', '600', '800'] as const) {
      expect(faces[weight], `${weight}: a Pretendard face`).toBe(1);
      // Measured again for up to two seconds while the face takes over from the system font; the bounds stay ≤ 0.5px and
      // > 20px, and the widths, each glyph's advance as drawn and the font's own come with any failure.
      const font = FONT_ADVANCES[weight];
      const own = `the font's own at 40px: tabular 0 and 1 ${px(font.tabular)}, proportional 0 ${px(font.zero)} and 1 ${px(font.one)}`;
      await expect.poll(() => digits(weight), { message: `${weight}: tabular ones and zeros as wide as each other, proportional ones far apart (${own})`, timeout: 2000 })
        .toEqual(expect.objectContaining({ tabularEqual: true, proportionalApart: true }));
    }
  });

  test('keeps the hole number’s line box and baseline whatever system font sits behind Pretendard', async ({ page }) => {
    await open(page);
    // The hole number's box, its baseline (an empty inline-block sits on it) and the line it shares with "번 홀".
    const measure = () => page.evaluate(async () => {
      document.body.getBoundingClientRect();
      await document.fonts.ready;
      const n = document.querySelector('#hole-n')!;
      const probe = document.createElement('span');
      probe.style.display = 'inline-block';
      n.append(probe);
      const box = n.getBoundingClientRect();
      const line = document.querySelector('#hole-title')!.getBoundingClientRect();
      const baseline = probe.getBoundingClientRect().bottom;
      probe.remove();
      return { top: box.top, height: box.height, width: box.width, baseline: baseline - box.top, lineTop: line.top, lineHeight: line.height };
    });
    // The CSSOM may set a custom property under the page's CSP; nothing else changes.
    const stack = (value: string | null) => page.evaluate((v) => {
      if (v === null) document.documentElement.style.removeProperty('--font');
      else document.documentElement.style.setProperty('--font', v);
    }, value);
    for (const hole of [0, 9]) {
      if (hole === 9) await pickHole(page, 9);
      await atRest(page);
      const own = await measure();
      for (const fallback of ['serif', 'monospace', "Verdana, 'Arial Unicode MS', sans-serif"]) {
        await stack(`'Pretendard', ${fallback}`);
        const other = await measure();
        for (const key of Object.keys(own) as (keyof typeof own)[]) {
          expect(Math.abs(other[key] - own[key]), `hole ${hole + 1}, then ${fallback}: ${key} ${other[key]} vs ${own[key]}`).toBeLessThanOrEqual(0.1);
        }
      }
      await stack(null);
    }
  });
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
    // The sheet names the course; its nines are the rows right under the name (v23).
    await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트');
    await expect(page.locator('#picker-chosen').getByRole('radio', { name: '새별' }).first()).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#picker-chosen').getByRole('radio', { name: '레이크' }).nth(1)).toHaveAttribute('aria-checked', 'true');
    // The dialog itself has focus: not the search box (no keyboard) and not 이 코스로 시작 (no ring nobody asked for).
    await expect(page.locator('#picker')).toBeFocused();
    await expect(page.locator('#picker-search')).not.toBeFocused();
    const start = (await page.getByRole('button', { name: '이 코스로 시작' }).boundingBox())!;
    expect(start.y + start.height).toBeLessThanOrEqual(553);
    expect(await sideScroll(page)).toBe(0);
    const backPine = page.locator('#picker-chosen').getByRole('radio', { name: '파인' }).nth(1);
    await backPine.tap();
    await expect(backPine).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: '이 코스로 시작' }).tap();
    await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·파인');
    const pars = await page.locator('#scorecard .ct-col .c-par').allTextContents();
    expect(pars.slice(9, 18)).toEqual(['4', '4', '4', '5', '3', '4', '4', '3', '5']);
    await expect(page.locator('#par-source a')).toHaveText('공식 스코어카드');
    await page.reload();
    await expect(page.locator('#picker')).toBeHidden();
    await page.getByRole('button', { name: '메뉴' }).tap();
    await page.locator('#menu .mi', { hasText: '새 라운드' }).tap();
    await page.locator('#new-round').tap();
    await expect(page.locator('#picker-label')).toHaveText('에버리스 골프리조트');
    await expect(backPine).toHaveAttribute('aria-checked', 'true');
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
    expect(new Set(await page.locator('#scorecard .ct-col .c-par').allTextContents())).toEqual(new Set(['4']));
    await expect(page.locator('#par-source')).toContainText('Par 4로 시작');
  });
});

test('keeps the pars of a round saved before courses could be chosen', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(([key, v]) => localStorage.setItem(key, v), [STORAGE_KEY, oldRound({ 0: { par: 3, driver: 1, putts: 2 } }, { date: '2026-11-19', lastEdited: Date.now() })]);
  await page.reload();
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#course-name')).toHaveText('에버리스 골프리조트 새별·레이크');
  expect((await page.locator('#scorecard .ct-col .c-par').allTextContents()).slice(0, 3)).toEqual(['3', '4', '4']);
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
      // A score mark sits in the middle of its hole's column, under the hole number.
      const heads = await page.locator('#scorecard [data-hole] .c-hole').evaluateAll((list) => Object.fromEntries(list.map((el) => {
        const r = el.getBoundingClientRect();
        return [(el.parentElement as HTMLElement).dataset.hole, r.x + r.width / 2];
      })));
      const marks = await page.locator('#scorecard [data-hole] .c-score .m').evaluateAll((list) => list.map((el) => {
        const r = el.getBoundingClientRect();
        return { col: (el.closest('[data-hole]') as HTMLElement).dataset.hole!, x: r.x + r.width / 2 };
      }));
      expect(marks).toHaveLength(7);
      for (const m of marks) within1px(m.x, heads[m.col], `hole ${Number(m.col) + 1} mark`);
      // The round's total sits in the 전반/후반 column under the nines' subtotals; 합계 starts on the table's edge.
      within1px(midOf(await spanOf(page, '#tot-strokes')), midOf(await spanOf(page, '#scorecard .ct-sum .c-score')), '합계 in the 전반/후반 column');
      within1px((await spanOf(page, '#sc-sheet .tot h3')).x, table.x, '합계');
      // The legend's six marks sit on the hero tiles' three columns, under the 파 4 기준 line.
      const items = await spansOf(page, '#legend li:not(.lg-cap)');
      expect(items).toHaveLength(6);
      items.forEach((item, i) => within1px(item.x, tiles[i % 3].x, `legend item ${i + 1}`));
      // Both bar charts start and end their bars at the same x; text in a tile sits 12px in, in the hero and in 라운드 분석
      // (v26: behind 분석, then back to the tables).
      within1px((await spanOf(page, '#sc-hero .sh-stats dt')).x - tiles[0].x, 12, 'hero tile text');
      await page.getByRole('radio', { name: '분석', exact: true }).tap();
      await settled(page);
      const lost = await spanOf(page, '#lost-bars .bar');
      const spread = await spanOf(page, '#analysis .bar-track');
      within1px(lost.x, spread.x, 'bars, start');
      within1px(endOf(lost), endOf(spread), 'bars, end');
      const metric = await spanOf(page, '#analysis .metrics > div');
      within1px((await spanOf(page, '#analysis .metrics dt')).x - metric.x, 12, '분석 tile text');
      await page.getByRole('radio', { name: '스코어카드', exact: true }).tap();
      await settled(page);
      // 파 수정 keeps the same nine-column tables (v23): the heading and the hint keep their edges, the total its 전반 column.
      await page.locator('#edit-par').tap();
      await expect(page.locator('#edit-hint')).toBeVisible();
      await settled(page);
      const editing = await spanOf(page, '#scorecard .ct');
      within1px((await spanOf(page, '#scorecard .nt-h')).x, editing.x, '파 수정 heading');
      const hint = await spanOf(page, '#edit-hint');
      within1px(hint.x, editing.x, 'hint, left');
      within1px(endOf(hint), endOf(editing), 'hint, right');
      within1px(midOf(await spanOf(page, '#tot-strokes')), midOf(await spanOf(page, '#scorecard .ct-sum')), '합계 in 파 수정');
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
      const nine = await spanOf(page, '#past-scorecard .ct');
      within1px((await spanOf(page, '#past-scorecard .nt-h')).x, nine.x, 'nine heading');
      within1px(midOf(await spanOf(page, '#past-scorecard .tot-n')), midOf(await spanOf(page, '#past-scorecard .ct-sum')), '합계 in the 전반/후반 column');
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
      // A quiet 홈 chip since v29, named in full for screen readers.
      await expect(home).toHaveText('홈');
      await expect(home).toHaveAttribute('aria-label', /carpenta\.github\.io/);
      await settled(page);
      const box = (await home.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(Math.min(box.x, box.y)).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(await sideScroll(page)).toBe(0);
      // A glass chip like 취소 (v29), its middle on the title's middle and its right edge on the header's inner edge,
      // where 취소 goes in the other modes. A filled chip lines up by its middle, not by its small text's baseline.
      within1px(midY(box), midY(await rect(page, '#picker-title')), 'middle on the title’s');
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
      // 취소 takes 홈's box, so the title keeps its place whichever of the two the picker shows.
      const cancel = await rect(page, '#picker-cancel');
      within1px(cancel.y, box.y, '취소 top where 홈’s was');
      within1px(cancel.height, box.height, '취소 as tall as 홈');
      within1px(midY(cancel), midY(await rect(page, '#picker-title')), '취소 middle on the title’s');
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
    await expect(page.locator('#pm-status')).toContainText('지난 라운드 1개를 가져왔어요');
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
  await expect(page.locator('#history-status')).toContainText('라운드를 지난 라운드에 보관했어요');
  // Kept under its own key next to the new round, and still there after a reload.
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual([HISTORY_KEY, PREFS_KEY, STORAGE_KEY].sort());
  await page.reload();
  await expect(pastItems(page)).toHaveCount(1);

  // A round with nothing finished is not kept, and the question says so.
  await tap(page, 'driver');
  expect(await startNewRound(page)).toBe('끝낸 홀이 없어 지난 라운드에 보관하지 않아요. 지금 라운드를 지우고 새로 시작할까요?');
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
  await expect(dialog.locator('.nine-tbl')).toHaveCount(2);
  // Read-only: no links to holes, no par buttons and nothing to tap a stroke into.
  await expect(dialog.locator('#past-scorecard button, .step, .pen')).toHaveCount(0);
  await expect(dialog.locator('.ct-sum .c-score').first()).toHaveText('7');
  await expect(dialog.locator('.headline')).toContainText('2홀 7타');
  const body = new URL((await dialog.getByRole('link', { name: '이메일로 보내기' }).getAttribute('href'))!).searchParams.get('body')!;
  expect(body).toContain('1번 Par4: 4타 (E) 드1 그1 퍼2');
  expect(body).toContain('2번 Par4: 3타 (-1) 드1 그0 퍼2');
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
  expect(question).toContain('되돌릴 수 없어요');
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
  await expect(page.locator('#backup-status')).toContainText('백업 파일을 만들었어요');
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
  await expect(other.locator('#backup-status')).toHaveText('지난 라운드 1개를 가져왔어요. 진행 중이던 라운드를 지금 라운드로 불러왔어요.');
  await expect(pastItems(other)).toHaveCount(1);
  await expect(other.locator('#hole-strokes')).toHaveText('3');
  // The same file again adds nothing.
  await other.locator('#backup-file').setInputFiles(file);
  await expect(other.locator('#backup-status')).toHaveText('가져온 지난 라운드는 없어요. 이미 있는 2개는 건너뛰었어요.');
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
  await expect(page.locator('#backup-status')).toHaveText('지난 라운드 1개를 가져왔어요. 진행 중이던 라운드는 지난 라운드에 넣었어요. 읽을 수 없는 1개는 넣지 않았어요.');
  expect(question).toContain('2026년 11월 1일');
  expect(question).toContain('지금 라운드는 지난 라운드에 보관해요');
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
  await expect(page.locator('#backup-status')).toHaveText('가져온 지난 라운드는 없어요. 진행 중이던 라운드를 지금 라운드로 불러왔어요.');
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
    await expect(status, name).toHaveText('Fairway Note 백업 파일이 아니에요. "백업 파일 저장"으로 만든 .json 파일을 골라 주세요.');
  }
  await page.locator('#backup-file').setInputFiles(pickable('newer.json', { app: 'fairway-note', format: 2, history: [] }));
  await expect(status).toContainText('더 새 버전의 Fairway Note가 만든 백업 파일이에요');
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
  await expect(page.locator('#past .nine-tbl')).toHaveCount(2);
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
  await expect(page.locator('#backup-status')).toHaveText('백업 파일을 공유했어요.');
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
      // One value per tile, its qualifier small beside it (v23).
      await expect(trendsBox).toContainText('평균 타수82.1+10.1');
      await expect(trendsBox).toContainText('최근 5라운드81.8+9.8');
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

/* ---------- v20: each club's capsule splits in half, the top adds a stroke and the bottom takes one off ---------- */

/** A club's capsule, its two halves and its count. */
const capsule = async (page: Page, key: string) => ({
  pill: await rect(page, `.club-${key} .pill`),
  plus: await rect(page, `.club-${key} .plus`),
  minus: await rect(page, `.club-${key} .minus`),
  count: await rect(page, `#count-${key}`),
});

test.describe('the split capsule on a 375×667 touch phone (v20)', () => {
  test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('a tap on the top half adds one and on the bottom half takes one off, right up to the midline, with a brief cue; at 0 the bottom half rests', async ({ page }) => {
    await open(page);
    const { pill } = await capsule(page, 'driver');
    const x = pill.x + pill.width / 2;
    const mid = pill.y + pill.height / 2;
    await page.touchscreen.tap(x, pill.y + 12);
    await expect(count(page, 'driver')).toHaveText('1');
    await expect(page.locator('.club-driver .plus .cue')).toBeVisible();
    await expect(page.locator('.club-driver .plus .cue')).toHaveText('+1');
    // Over the count, just above and just below the midline: the count is not a button of its own.
    await page.touchscreen.tap(x, mid - 6);
    await expect(count(page, 'driver')).toHaveText('2');
    await page.touchscreen.tap(x, mid + 6);
    await expect(count(page, 'driver')).toHaveText('1');
    await expect(page.locator('.club-driver .minus .cue')).toBeVisible();
    await expect(page.locator('.club-driver .minus .cue')).toHaveText('−1');
    await page.touchscreen.tap(x, pill.y + pill.height - 12);
    await expect(count(page, 'driver')).toHaveText('0');
    // At 0 the bottom half takes nothing off and looks it.
    const minus = page.getByRole('button', { name: '드라이버 하나 빼기' });
    await expect(minus).toBeDisabled();
    await page.touchscreen.tap(x, pill.y + pill.height - 12);
    await expect(count(page, 'driver')).toHaveText('0');
    // The cues go again on their own.
    await expect(page.locator('.club-driver .cue')).toHaveCount(2);
    await expect(page.locator('.club-driver .cue:visible')).toHaveCount(0);
    // Each half is the button with the club's name: the top half from the capsule's top to its midline, the bottom from there.
    const top = (await page.getByRole('button', { name: '드라이버 하나 더하기' }).boundingBox())!;
    expectAligned(top.y, pill.y, 'top half from the top');
    expectAligned(top.y + top.height, mid, 'top half to the midline');
    const bottom = (await minus.boundingBox())!;
    expectAligned(bottom.y, mid, 'bottom half from the midline');
    expectAligned(bottom.y + bottom.height, pill.y + pill.height, 'bottom half to the bottom');
  });

  test('a long press on either half opens the 0 … 5+ picker, and letting go counts nothing', async ({ page }) => {
    await open(page);
    for (const [where, before] of [['top', '0'], ['bottom', '2']] as const) {
      const { pill } = await capsule(page, 'putts');
      await page.mouse.move(pill.x + pill.width / 2, where === 'top' ? pill.y + 16 : pill.y + pill.height - 16);
      await page.mouse.down();
      await expect(page.locator('#numpick')).toBeVisible();
      await page.mouse.up();
      await expect(count(page, 'putts')).toHaveText(before);
      await page.getByRole('button', { name: '2번', exact: true }).click();
      await expect(page.locator('#numpick')).toBeHidden();
      await expect(count(page, 'putts')).toHaveText('2');
    }
  });
});

for (const [width, height] of [[360, 640], [375, 553], [375, 667], [390, 844]]) {
  test.describe(`the split capsules on a ${width}×${height} phone (v20)`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('each half is a 48px button from the capsule’s edge to its midline, the count sits on the midline, and the name button stands above', async ({ page }) => {
      await open(page);
      for (const mode of ['기본', '상세'] as const) {
        await page.getByRole('button', { name: mode, exact: true }).click();
        await atRest(page);
        for (const key of KEYS[mode]) {
          const { pill, plus, minus, count: n } = await capsule(page, key);
          const where = `${mode} ${key}`;
          const mid = pill.y + pill.height / 2;
          expectAligned(plus.y, pill.y, `${where}: top half from the top`);
          expectAligned(plus.y + plus.height, mid, `${where}: top half to the midline`);
          expectAligned(minus.y, mid, `${where}: bottom half from the midline`);
          expectAligned(minus.y + minus.height, pill.y + pill.height, `${where}: bottom half to the bottom`);
          for (const half of [plus, minus]) {
            expect(half.height, `${where}: half height`).toBeGreaterThanOrEqual(48);
            expectAligned(half.x, pill.x, `${where}: half left`);
            expectAligned(half.x + half.width, pill.x + pill.width, `${where}: half right`);
          }
          expectAligned(n.y + n.height / 2, mid, `${where}: count on the midline`);
          expectAligned(n.x + n.width / 2, midX(pill), `${where}: count centred`);
          // The way to the club's shot details: its name, a button of at least 44px over its own column, above the capsule.
          const name = await rect(page, `#lbl-${key}`);
          const col = await rect(page, `.club-${key}`);
          expect(name.height, `${where}: name button height`).toBeGreaterThanOrEqual(44);
          expect(name.y + name.height, `${where}: name above the capsule`).toBeLessThanOrEqual(pill.y + 0.5);
          expect(name.x, `${where}: name in its column`).toBeGreaterThanOrEqual(col.x - 0.5);
          expect(name.x + name.width, `${where}: name in its column`).toBeLessThanOrEqual(col.x + col.width + 0.5);
          // 기본's names carry a chevron; 상세's four columns (v28) are too narrow for it beside 어프로치, so each name is
          // a chip as wide as its capsule instead.
          if (mode === '기본') await expect(page.locator(`#lbl-${key} .lbl-chev`)).toBeVisible();
          else {
            await expect(page.locator(`#lbl-${key} .lbl-chev`)).toBeHidden();
            expectAligned((await rect(page, `#lbl-${key} .lbl-in`)).width, pill.width, `${where}: name chip as wide as its capsule`);
          }
        }
        expect(await sideScroll(page)).toBe(0);
        expect(await page.locator('#sheet').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
      }
    });
  });
}

test('an old saved round shows its approach shots under 그린까지, keeping the count, the key and the details (v20, v28)', async ({ page }) => {
  await page.goto('/');
  // Saved before the rename: the stored key stays `approach`, its tags too.
  await page.evaluate((key) => {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 }));
    holes[0] = { ...holes[0], driver: 1, approach: 2, putts: 1, tags: { approach: ['hazard', 'short'] } } as typeof holes[0];
    localStorage.setItem(key, JSON.stringify({ version: 1, date, current: 0, holes, lastEdited: Date.now() }));
  }, STORAGE_KEY);
  await page.reload();
  await expect(page.locator('#entry')).toBeVisible();
  await expect(page.locator('#lbl-approach .club-name')).toHaveText('그린까지');
  await expect(count(page, 'approach')).toHaveText('2');
  await expect(page.getByRole('group', { name: '그린까지', exact: true }).getByText('그린까지 2', { exact: true })).toBeAttached();
  await expect(page.locator('#lbl-approach')).toHaveClass(/tagged/);
  await page.getByRole('button', { name: '그린까지 하나 더하기' }).click();
  expect((await stored(page)).holes[0]).toMatchObject({ approach: 3, tags: { approach: ['hazard', 'short'] } });
  await showCard(page);
  await expect(page.locator('#analysis .details')).toContainText('그린까지: 짧게 1 · 해저드 1');
  // Nothing on it is split (v28): no 세컨 or 어프로치 anywhere on 스코어카드, and the old names are gone.
  await expect(page.locator('#card-view')).not.toContainText('어프로치');
  await expect(page.locator('#card-view')).not.toContainText('아이언');
});

test('the hole switcher and the entry card are opaque white over the course, nothing blurred behind them (v30; glass since v20)', async ({ page }) => {
  await open(page);
  const white = await token(page, '--white');
  for (const selector of ['#entry .switcher', '#sheet']) {
    const [background, filter] = await page.locator(selector).evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.backgroundColor, s.backdropFilter || s.getPropertyValue('-webkit-backdrop-filter') || 'none'];
    });
    expect(background, selector).toBe(white);
    expect(filter, selector).toBe('none');
  }
});

/* ---------- 클럽 상세 패널 (v18): a tap on a club's name above its capsule (v20) opens that club's shot details for this hole ---------- */

const panel = (page: Page) => page.locator('#shot-panel');
/** What opens a club's panel (v20): the button with its name and icon above the capsule. */
const numberOf = (page: Page, key: string) => page.locator(`#lbl-${key}`);
const panelChip = (page: Page, name: string) => panel(page).locator('#sp-chips').getByRole('button', { name, exact: true });
const panelShot = (page: Page, index: number) => panel(page).locator(`#sp-shots [data-shot="${index}"]`);
/** What the panel calls one of the club's shots: 1번째 티샷, 2번째 샷, 2번째 퍼트. */
const NOUN: Record<string, string> = { driver: '티샷', approach: '샷', putts: '퍼트' };
/** Each club's chips row by row: left, the target and right, then long and short, then the rest. */
const PANEL_CHIPS: Record<string, string[]> = {
  driver: ['좌', '페어웨이', '우', '길게', '짧게', '많이 좌', '헛스윙', '많이 우', '좌 OB', '뒤땅/토핑', '우 OB'],
  approach: ['좌', '온그린', '우', '길게', '짧게', '해저드', '헛스윙'],
  putts: ['좌', '들어감', '우', '길게', '짧게'],
};

test('a tap on a club’s name opens its detail panel; a chip records the shot, sends and stores nothing new, and survives a reload', async ({ page }) => {
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
    await expect(num).toHaveAccessibleName(`${LABEL[key]} 샷 세부`);
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
    // A quiet dot on the name says the club has details on this hole.
    await expect(num).toHaveClass(/tagged/);
    await expect(num).toHaveAccessibleName(`${LABEL[key]} 샷 세부 1개`);
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
  await expect(page.locator('#analysis .details')).toContainText('그린까지: 해저드 1');

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

test('a long press on a club’s capsule still opens the 0 … 5+ picker, never the panel', async ({ page }) => {
  await open(page);
  await longPress(page, 'approach');
  await expect(page.locator('#np-title')).toHaveText('그린까지 몇 번 쳤나요?');
  await expect(panel(page)).toBeHidden();
  await page.getByRole('button', { name: '2번', exact: true }).click();
  await expect(page.locator('#numpick')).toBeHidden();
  await expect(count(page, 'approach')).toHaveText('2');
  await expect(page.locator('#toast-msg')).toHaveText('그린까지 2로');
  await expect(panel(page)).toBeHidden();
  // Once more with details on the club: the picker, not the panel.
  await numberOf(page, 'approach').click();
  await panelChip(page, '짧게').click();
  await page.keyboard.press('Escape');
  await longPress(page, 'approach');
  await expect(panel(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#numpick')).toBeHidden();
  await expect(count(page, 'approach')).toHaveText('2');
});

test('Escape, the close button and a tap outside close the panel, and focus goes back to the club’s name', async ({ page }) => {
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
  const menuButton = (await page.locator('#bar-menu').boundingBox())!;
  await num.click();
  // A tap on the dim backdrop, outside the panel, closes it without pressing what is under it (메뉴 in the bar, v32).
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
  await panelChip(page, '짧게').click();
  await expect(count(page, 'putts')).toHaveText('1');
  await expect(page.locator('#sp-shot')).toHaveText('1번째 퍼트');
  await expect(panelChip(page, '짧게')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  await tap(page, 'putts');
  await num.click();
  await expect(page.locator('#sp-shot')).toHaveText('2번째 퍼트');
  await expect(panel(page).locator('#sp-shots button')).toHaveText(['1', '2']);
  await expect(panelShot(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(panelShot(page, 0)).toHaveClass(/tagged/);
  await expect(panelShot(page, 0)).toHaveAccessibleName('1번째 퍼트, 짧게');
  await expect(panelShot(page, 1)).not.toHaveClass(/tagged/);
  await panelChip(page, '들어감').click();
  await expect(panelShot(page, 1)).toHaveClass(/tagged/);
  await panelShot(page, 0).click();
  await expect(page.locator('#sp-shot')).toHaveText('1번째 퍼트');
  await expect(panelChip(page, '짧게')).toHaveAttribute('aria-pressed', 'true');
  await expect(panelChip(page, '들어감')).toHaveAttribute('aria-pressed', 'false');
  // The same chip again clears it; the count stays.
  await panelChip(page, '짧게').click();
  await expect(panelChip(page, '짧게')).toHaveAttribute('aria-pressed', 'false');
  await expect(count(page, 'putts')).toHaveText('2');
  expect((await stored(page)).holes[0].tags).toEqual({ putts: [null, 'in'] });
  await page.keyboard.press('Escape');
  await expect(num).toHaveAccessibleName('퍼터 샷 세부 1개');
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
  await expect(panelChip(page, '길게')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await numberOf(page, 'approach').click();
  await expect(panelChip(page, '온그린')).toHaveAttribute('aria-pressed', 'true');
  await panelShot(page, 0).click();
  await expect(panelChip(page, '짧게')).toHaveAttribute('aria-pressed', 'true');
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
    // The title's help line (v28) shows only on 세컨's and 어프로치's panels.
    const cut = await panel(page).locator('#sp-shots button, #sp-chips button:not([hidden]), .sp-title span:not([hidden])').evaluateAll((list) => list.filter((b) => {
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

/* ---------- 말로 입력 (v21): one line for the keyboard's dictation, off until turned on in the menu ---------- */

/** Turns 말로 입력 on with its switch in the menu. */
async function voiceOn(page: Page) {
  await menu(page);
  await page.locator('#mi-voice').click();
  await expect(page.locator('#mi-voice')).toHaveAttribute('aria-checked', 'true');
  await closeMenu(page);
}

/** Opens the sheet from 기록, writes the line as the keyboard's dictation would, and presses its 완료 (Enter). */
async function say(page: Page, line: string) {
  await page.locator('#voice-open').click();
  await expect(page.locator('#voice')).toBeVisible();
  await expect(page.locator('#vc-line')).toBeFocused();
  await page.locator('#vc-line').fill(line);
  await page.locator('#vc-line').press('Enter');
}

const prefsOf = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>, PREFS_KEY);

test('말로 입력 is off by default: no button on 기록, its switch off, nothing about it saved', async ({ page }) => {
  await open(page);
  await expect(page.locator('#voice-open')).toBeHidden();
  await expect(page.locator('#go-next')).toBeVisible();
  await menu(page);
  await expect(page.getByRole('switch', { name: /말로 입력/ })).toHaveAttribute('aria-checked', 'false');
  await closeMenu(page);
  expect((await prefsOf(page)).voice).toBeUndefined();
  await expect(page.locator('#voice')).toBeHidden();
});

test('turning 말로 입력 on shows its button beside 다음 홀, after a reload too; turning it off hides it and forgets it', async ({ page }) => {
  await open(page);
  await voiceOn(page);
  await expect(page.getByRole('button', { name: '말로 입력' })).toBeVisible();
  await expect(page.locator('#announce')).toHaveText('말로 입력을 켰어요. 기록 화면의 다음 홀 옆에 있어요');
  expect((await prefsOf(page)).voice).toBe(true);
  await page.reload();
  await expect(page.locator('#voice-open')).toBeVisible();
  await menu(page);
  await page.locator('#mi-voice').click();
  await expect(page.locator('#mi-voice')).toHaveAttribute('aria-checked', 'false');
  await closeMenu(page);
  await expect(page.locator('#voice-open')).toBeHidden();
  expect((await prefsOf(page)).voice).toBeUndefined();
});

test('a spoken line sets the counts as taps do, its toast says what was set, and 되돌리기 takes the whole line back', async ({ page }) => {
  await open(page);
  await voiceOn(page);
  await say(page, '드라이버 하나 아이언 둘 퍼터 두 번');
  await expect(page.locator('#voice')).toBeHidden();
  await expect(count(page, 'driver')).toHaveText('1');
  await expect(count(page, 'approach')).toHaveText('2');
  await expect(count(page, 'putts')).toHaveText('2');
  await expect(page.locator('#hole-strokes')).toHaveText('5');
  await expect(page.locator('#hole-name')).toHaveText('보기');
  await expect(page.locator('#toast-msg')).toHaveText(`${LABEL.driver} 1 · ${LABEL.approach} 2 · ${LABEL.putts} 2`);
  await expect(page.locator('#announce')).toHaveText(`1번 홀 ${LABEL.driver} 1, ${LABEL.approach} 2, ${LABEL.putts} 2, 5타`);
  await expect(page.locator('#voice-open')).toBeFocused();
  expect((await stored(page)).holes[0]).toMatchObject({ driver: 1, approach: 2, putts: 2 });
  await page.locator('#toast-undo').click();
  await expect(count(page, 'driver')).toHaveText('0');
  await expect(count(page, 'approach')).toHaveText('0');
  await expect(count(page, 'putts')).toHaveText('0');
  expect((await stored(page)).holes[0]).toMatchObject({ driver: 0, approach: 0, putts: 0 });
  // Said again, the scorecard reads it as it reads taps.
  await say(page, '드라이버 하나 아이언 둘 퍼터 둘');
  await showCard(page);
  await expect(page.locator('#sum-strokes')).toHaveText('5');
  await expect(page.locator('#sum-putts')).toHaveText('2');
});

test('a line that ends with 다음 홀 records the hole and moves on, and one 되돌리기 brings back both', async ({ page }) => {
  await open(page);
  await voiceOn(page);
  await say(page, '드라이버 하나 아이언 하나 퍼터 둘 다음 홀');
  await expect(page.locator('#hole-title')).toHaveText('2번 홀');
  await expect(page.locator('#toast-msg')).toHaveText(`1번 홀 ${LABEL.driver} 1 · ${LABEL.approach} 1 · ${LABEL.putts} 2`);
  await expect(count(page, 'putts')).toHaveText('0');
  expect((await stored(page)).holes[0]).toMatchObject({ driver: 1, approach: 1, putts: 2 });
  await page.locator('#toast-undo').click();
  await expect(page.locator('#hole-title')).toHaveText('1번 홀');
  await expect(count(page, 'putts')).toHaveText('0');
  const back = await stored(page);
  expect(back.current).toBe(0);
  expect(back.holes[0]).toMatchObject({ driver: 0, approach: 0, putts: 0 });
});

test('빼기 names the penalty it takes off: after an OB and then a 해저드 it reads 해저드, by taps and by a spoken line (v21)', async ({ page }) => {
  await open(page);
  const undo = page.locator('#pen-undo');
  // Two taps: OB, then 해저드.
  await tap(page, 'ob');
  await expect(undo).toHaveAccessibleName('OB 하나 빼기');
  await tap(page, 'hazard');
  await expect(undo).toHaveAccessibleName('해저드 하나 빼기');
  await expect(undo).toContainText('해저드 빼기');
  await undo.click();
  await expect(page.locator('#stake-hazard .pen-count')).toHaveClass(/zero/);
  await expect(page.locator('#stake-ob .pen-count')).toHaveText('1');
  await expect(undo).toHaveAccessibleName('OB 하나 빼기');
  // The toast still takes back only the last tap's penalty, and 빼기 follows it.
  await tap(page, 'hazard');
  await expect(undo).toHaveAccessibleName('해저드 하나 빼기');
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.locator('#stake-hazard .pen-count')).toHaveClass(/zero/);
  await expect(undo).toHaveAccessibleName('OB 하나 빼기');
  // One spoken line on the next hole: OB, then 해저드, in the order said.
  await next(page).click();
  await voiceOn(page);
  await say(page, 'OB 해저드');
  await expect(page.locator('#stake-hazard .pen-count')).toHaveText('1');
  await expect(undo).toHaveAccessibleName('해저드 하나 빼기');
  await expect(undo).toContainText('해저드 빼기');
});

test('OB, 해저드 and 벙커 add one each as their buttons do, a club said alone adds one, and 7번 홀 jumps there', async ({ page }) => {
  await open(page);
  await voiceOn(page);
  await say(page, '드라이버');
  await expect(count(page, 'driver')).toHaveText('1');
  await expect(page.locator('#toast-msg')).toHaveText(`${LABEL.driver} +1`);
  await say(page, 'OB 해저드');
  await expect(page.locator('#stake-ob .pen-count')).toHaveText('1');
  await expect(page.locator('#stake-hazard .pen-count')).toHaveText('1');
  await expect(page.locator('#toast-msg')).toHaveText('OB +1 · 해저드 +1');
  // They were added in the order said, as by two taps: the penalty row's 빼기 takes off the 해저드, then the OB.
  await page.locator('#pen-undo').click();
  await expect(page.locator('#stake-hazard .pen-count')).toHaveClass(/zero/);
  await expect(page.locator('#stake-ob .pen-count')).toHaveText('1');
  await say(page, '해저드');
  await say(page, '벙커에 빠졌어요');
  await page.getByRole('button', { name: '상세', exact: true }).click();
  await expect(page.locator('#stake-bunker .pen-count')).toHaveText('1');
  // A bunker is noted only: one drive and two penalty strokes.
  await expect(page.locator('#hole-strokes')).toHaveText('3');
  await say(page, '7번 홀');
  await expect(page.locator('#voice')).toBeHidden();
  await expect(page.locator('#hole-title')).toHaveText('7번 홀');
});

test('a line it cannot read says why, changes nothing, and stays to be said again', async ({ page }) => {
  await open(page);
  await voiceOn(page);
  await tap(page, 'putts');
  const before = await stored(page);
  await say(page, '버디');
  const error = page.locator('#vc-error');
  await expect(error).toHaveText('‘버디’는 알아듣지 못했어요. 바꾼 것은 없어요.');
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(page.locator('#voice')).toBeVisible();
  await expect(page.locator('#vc-line')).toHaveValue('버디');
  await expect(page.locator('#vc-line')).toHaveAttribute('aria-invalid', 'true');
  expect(await stored(page)).toEqual(before);
  // A new line clears the message; one that says something did not happen changes nothing either.
  await page.locator('#vc-line').fill('OB 안 났어');
  await expect(error).toBeHidden();
  await page.locator('#vc-line').press('Enter');
  await expect(error).toHaveText('‘안’처럼 아니라는 말이 있어 바꾸지 않았어요.');
  expect(await stored(page)).toEqual(before);
  // 닫기 drops the line: the sheet opens empty next time. Escape closes it too.
  await page.locator('#vc-close').click();
  await expect(page.locator('#voice')).toBeHidden();
  await page.locator('#voice-open').click();
  await expect(page.locator('#vc-line')).toHaveValue('');
  await expect(error).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#voice')).toBeHidden();
  await expect(count(page, 'putts')).toHaveText('1');
});

test('되돌리기 said in the sheet takes back the change its toast offers, which waits while the sheet is open', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await voiceOn(page);
  const toast = page.locator('#toast');
  await tap(page, 'driver');
  await expect(toast).toBeVisible();
  // Open for longer than the toast's four seconds: its 되돌리기 is still there to be said.
  await page.locator('#voice-open').click();
  await expect(page.locator('#vc-line')).toBeFocused();
  await page.clock.fastForward(6000);
  await page.locator('#vc-line').fill('되돌리기');
  await page.locator('#vc-line').press('Enter');
  await expect(page.locator('#voice')).toBeHidden();
  await expect(count(page, 'driver')).toHaveText('0');
  await expect(toast).toBeHidden();
  await say(page, '되돌리기');
  await expect(page.locator('#vc-error')).toHaveText('되돌릴 것이 없어요.');
  await page.locator('#vc-close').click();
  // Closed with nothing applied, the toast's four seconds start again.
  await tap(page, 'putts');
  await page.locator('#voice-open').click();
  await page.clock.fastForward(6000);
  await page.locator('#vc-close').click();
  await expect(toast).toBeVisible();
  await page.clock.fastForward(4100);
  await expect(toast).toBeHidden();
});

test('말로 입력 sends nothing, asks for no microphone or speech service, and keeps no line it read', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || request.method() !== 'GET' || request.postData()) requests.push(request.url());
  });
  // Any use of the microphone, the browser's speech recognition or a permission prompt is counted here.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__voiceCalls = 0;
    const counted = () => { w.__voiceCalls = (w.__voiceCalls as number) + 1; };
    class Listening { constructor() { counted(); } start() {} stop() {} abort() {} addEventListener() {} }
    w.SpeechRecognition = Listening;
    w.webkitSpeechRecognition = Listening;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { counted(); throw new Error('no microphone here'); };
    if (navigator.permissions) {
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (d) => { counted(); return query(d); };
    }
  });
  await open(page);
  await voiceOn(page);
  await say(page, '드라이버 하나 아이언 둘 퍼터 둘');
  await expect(count(page, 'putts')).toHaveText('2');
  await say(page, '버디 했어요');
  await expect(page.locator('#vc-error')).toBeVisible();
  await page.keyboard.press('Escape');
  // A plain text field the keyboard can dictate into, not a search field, and not one the browser remembers.
  const field = page.locator('#vc-line');
  await expect(field).toHaveAttribute('type', 'text');
  await expect(field).toHaveAttribute('enterkeyhint', 'done');
  await expect(field).toHaveAttribute('autocomplete', 'off');
  expect(await page.evaluate(() => (window as unknown as { __voiceCalls: number }).__voiceCalls)).toBe(0);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => ({ keys: Object.keys(localStorage).sort(), sessionStorage: sessionStorage.length, cookies: document.cookie })))
    .toEqual({ keys: [PREFS_KEY, STORAGE_KEY].sort(), sessionStorage: 0, cookies: '' });
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
  // Only the counts the line set are kept, never its words; the prefs key holds the switch.
  const kept = await page.evaluate(() => Object.values(localStorage).join('\n'));
  for (const word of ['하나', '버디', '아이언']) expect(kept).not.toContain(word);
  expect(await prefsOf(page)).toMatchObject({ voice: true });
});

for (const [width, height] of [[360, 640], [375, 667], [390, 844]]) {
  test.describe(`말로 입력 lined up on a ${width}×${height} phone`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('its button on 다음 홀’s row at the card’s inset, its sheet on the card’s edges above the keyboard, its toast over no button', async ({ page }) => {
      await open(page);
      await voiceOn(page);
      // The top bar's highest edge (v32: the switcher's, the menu button it was measured from having moved into the bar).
      const switcher = await spanOf(page, '#entry .switcher');
      const badge = await spanOf(page, '#badge');
      for (const mode of ['기본', '상세'] as const) {
        if (mode === '상세') await page.getByRole('button', { name: '상세', exact: true }).click();
        await settled(page);
        const card = await spanOf(page, '#sheet');
        const mic = await spanOf(page, '#voice-open');
        const go = await spanOf(page, '#go-next');
        // As tall as 다음 홀 and round, on the card's left edge, on 다음 홀's centre line, 8px before it.
        within1px(card.x, 16, `${mode}: the 16px inset`);
        within1px(mic.height, go.height, `${mode}: button height`);
        within1px(mic.width, mic.height, `${mode}: button round`);
        within1px(mic.x, card.x, `${mode}: button on the card's left edge`);
        within1px(mic.y + mic.height / 2, go.y + go.height / 2, `${mode}: button on 다음 홀's centre line`);
        within1px(go.x - endOf(mic), 8, `${mode}: gap before 다음 홀`);
        within1px(endOf(go), endOf(card), `${mode}: 다음 홀 keeps the card's right edge`);
        expect(mic.y, `${mode}: button below the card`).toBeGreaterThanOrEqual(card.y + card.height);
      }
      expect(await sideScroll(page)).toBe(0);

      // The sheet: from the top bar's first row, on the card's edges; inside, everything on the card's 16px padding.
      await page.locator('#voice-open').click();
      await expect(page.locator('#voice')).toBeVisible();
      await settled(page);
      const card = await spanOf(page, '#sheet');
      const sheet = await spanOf(page, '#voice');
      within1px(sheet.x, card.x, 'sheet left edge');
      within1px(endOf(sheet), endOf(card), 'sheet right edge');
      // From the top bar's highest edge, the badge's, so nothing of the bar peeks out above the sheet.
      within1px(sheet.y, badge.y, 'sheet top on the badge top');
      expect(sheet.y, 'sheet top no higher than the bar').toBeGreaterThanOrEqual(Math.min(switcher.y, badge.y) - 8);
      const field = await spanOf(page, '.vc-field');
      within1px(field.x - sheet.x, 16, 'field, left padding');
      within1px(endOf(sheet) - endOf(field), 16, 'field, right padding');
      within1px(field.height, 52, 'field height');
      within1px((await spanOf(page, '#vc-title')).x, field.x, 'title on the field edge');
      const close = await spanOf(page, '#vc-close');
      within1px(endOf(close), endOf(field), 'close on the field edge');
      within1px(close.y - sheet.y, 16, 'close on the top padding');
      // 입력 sits 4px inside the field all round, so the two curves share a centre.
      const enter = await spanOf(page, '#vc-go');
      within1px(enter.height, 44, '입력 height');
      within1px(endOf(field) - endOf(enter), 4, '입력, right inset');
      within1px(enter.y - field.y, 4, '입력, top inset');
      for (const id of ['#vc-help', '#vc-example', '#vc-privacy']) within1px((await spanOf(page, id)).x, field.x, `${id} on the field edge`);
      within1px(endOf(sheet) - endOf(await spanOf(page, '#vc-privacy')), 16, 'privacy note, right padding');
      // A keyboard takes the lower part of the screen: the field and the message under it stay in the top half.
      await page.locator('#vc-line').fill('버디');
      await page.locator('#vc-line').press('Enter');
      const error = await spanOf(page, '#vc-error');
      within1px(error.x, field.x, 'message on the field edge');
      expect(error.y + error.height, 'message above a keyboard').toBeLessThanOrEqual(height / 2);
      expect(await sideScroll(page)).toBe(0);
      await page.locator('#vc-close').click();
      await expect(page.locator('#voice')).toBeHidden();

      // A long line's toast: at most two lines inside a tap's toast height, within the card, clear of every control on it.
      await page.getByRole('button', { name: '기본', exact: true }).click();
      await tap(page, 'putts');
      await settled(page);
      const tapToast = await spanOf(page, '#toast');
      await say(page, '드라이버 둘 아이언 셋 퍼터 둘 OB 하나 해저드 하나 다음 홀');
      await expect(page.locator('#hole-title')).toHaveText('2번 홀');
      await expect(page.locator('#toast-msg')).toHaveText(`1번 홀 ${LABEL.driver} 2 · ${LABEL.approach} 3 · ${LABEL.putts} 2 · OB 1 · 해저드 1`);
      await settled(page);
      const toast = await spanOf(page, '#toast');
      const sheetNow = await spanOf(page, '#sheet');
      within1px(toast.height, tapToast.height, 'toast as tall as a tap’s');
      within1px(toast.y, tapToast.y, 'toast where a tap’s shows');
      expect(toast.x, 'toast within the card, left').toBeGreaterThanOrEqual(sheetNow.x - 0.5);
      expect(endOf(toast), 'toast within the card, right').toBeLessThanOrEqual(endOf(sheetNow) + 0.5);
      const text = await page.locator('#toast-msg').evaluate((el) => ({ lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)), clipped: el.scrollHeight > el.clientHeight + 1 }));
      expect(text.lines, 'toast lines').toBeLessThanOrEqual(2);
      expect(text.clipped, 'toast text clipped').toBe(false);
      for (const control of await page.locator('#sheet button').all()) {
        const b = await control.boundingBox();
        if (!b) continue;
        const apart = b.x + b.width <= toast.x || endOf(toast) <= b.x || b.y + b.height <= toast.y || toast.y + toast.height <= b.y;
        expect(apart, await control.getAttribute('aria-label') ?? (await control.textContent()) ?? '').toBe(true);
      }
      expect(await sideScroll(page)).toBe(0);
    });
  });
}

/* ---------- v23: 스코어카드, 라운드 요약, 지난 라운드 and 코스 선택 polished (기록 itself is left to its own round) ---------- */

/** A box's edges, its content edges (less border and padding) and its bottom padding. */
const edgesOf = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return {
    left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    inLeft: r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft),
    inRight: r.right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight),
    padBottom: parseFloat(s.paddingBottom),
  };
});
/** How many lines the text of `selector` (one font size) takes: the distinct tops of its line boxes. */
const linesOf = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => {
  const range = document.createRange();
  range.selectNodeContents(el);
  return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
});
/** Whether each matching element is one line tall: less than one and a half times its line height. */
const oneLine = (page: Page, selector: string) => page.locator(selector).evaluateAll((list) => list.map((el) => {
  const s = getComputedStyle(el);
  const line = s.lineHeight === 'normal' ? parseFloat(s.fontSize) * 1.2 : parseFloat(s.lineHeight);
  return el.getBoundingClientRect().height < line * 1.5;
}));
/** Every visible element with text of its own whose computed weight is not one of the three: 400, 600 or 800. */
const offWeights = (page: Page) => page.evaluate(() => [...document.body.querySelectorAll('*')].filter((el) => {
  if (!(el instanceof HTMLElement) || !el.getClientRects().length) return false;
  if (![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && !['400', '600', '800'].includes(s.fontWeight);
}).map((el) => `${el.tagName.toLowerCase()}.${el.className} "${el.textContent!.trim().slice(0, 24)}" ${getComputedStyle(el).fontWeight}`));
const weightOf = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontWeight);
/** WCAG contrast between two opaque CSS colours as the page computes them, normalised through a one-pixel canvas. */
const contrastBetween = (page: Page, a: string, b: string) => page.evaluate(([x, y]) => {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const rgb = (css: string) => {
    cv.clearRect(0, 0, 1, 1);
    cv.fillStyle = css;
    cv.fillRect(0, 0, 1, 1);
    return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const lum = (c: number[]) => {
    const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const [p, q] = [lum(rgb(x)), lum(rgb(y))].sort((m, n) => n - m);
  return (p + 0.05) / (q + 0.05);
}, [a, b] as const);
/** The summary test's three holes, with a tee result on each par 4 when `tee` is set. */
const SUMMARY_HOLES = (tee: boolean) => ({
  0: { driver: 1, approach: 1, putts: 2, ...(tee ? { tags: { driver: ['fairway'] } } : {}) },
  1: { driver: 1, approach: 1, putts: 1, ...(tee ? { tags: { driver: ['left'] } } : {}) },
  2: { driver: 1, ob: 1, approach: 3, putts: 2 },
});
/** Writes `holes` into the round on screen and finishes it from 스코어카드, at rest once the summary is up. */
async function summarise(page: Page, holes: Record<number, Record<string, unknown>>) {
  await seed(page, holes as Record<number, Record<string, number>>, 3);
  await showCard(page);
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await expect(page.locator('#summary')).toBeVisible();
  await page.locator('#summary').evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
}
/** One kept round, 1 October, with holes 1 to `played` finished in 4 or 5 (all par 4), then a reload. */
async function seedKept(page: Page, played: number) {
  await page.evaluate(([key, n]) => {
    const date = '2026-10-01';
    const blank = { par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 };
    const holes = Array.from({ length: 18 }, (_, h) => (h < n ? { ...blank, driver: 1, approach: 1 + (h % 2), putts: 2 } : blank));
    localStorage.setItem(key, JSON.stringify([{ id: 'seed-kept', endedAt: Date.parse(`${date}T18:00:00`), round: { version: 1, date, current: n, holes } }]));
  }, [HISTORY_KEY, played] as const);
  await page.reload();
}
/** A row of round buttons: each box and its glyph's centre, and the content edge it starts from. */
const roundRow = (page: Page, row: string, container: string) => page.evaluate(([r, c]) => {
  const box = document.querySelector(c)!;
  const s = getComputedStyle(box);
  const left = box.getBoundingClientRect().left + parseFloat(s.paddingLeft);
  const buttons = [...document.querySelector(r)!.children].filter((b) => b.getClientRects().length).map((b) => {
    const k = b.getBoundingClientRect();
    const g = b.querySelector('svg')?.getBoundingClientRect();
    return { x: k.x, y: k.y, width: k.width, height: k.height, glyph: g ? { x: g.x + g.width / 2, y: g.y + g.height / 2 } : null };
  });
  return { left, buttons };
}, [row, container] as const);

for (const [width, height] of [[360, 640], [375, 667], [390, 844]]) {
  test.describe(`v23 on a ${width}×${height} phone`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('스코어카드: each hole’s column is a button as tall as its table, and 파 수정 steps the par in the same columns', async ({ page }) => {
      await open(page);
      await seed(page, SEVEN_HOLES, 5);
      await tab(page, '스코어카드').tap();
      await settled(page);
      const columns = await spansOf(page, '#scorecard button[data-hole]');
      expect(columns).toHaveLength(18);
      const heads = await spansOf(page, '#scorecard button[data-hole] .c-hole');
      const tables = await spansOf(page, '#scorecard .ct');
      columns.forEach((c, k) => {
        const t = tables[k < 9 ? 0 : 1];
        within1px(c.x, heads[k].x, `hole ${k + 1} left`);
        within1px(c.width, heads[k].width, `hole ${k + 1} width`);
        within1px(c.y, t.y, `hole ${k + 1} top`);
        within1px(c.y + c.height, t.y + t.height, `hole ${k + 1} bottom`);
        expect(c.width, `hole ${k + 1} width`).toBeGreaterThanOrEqual(24);
      });
      // No whole-table button and no "홀 고르기" any more.
      await expect(page.locator('#scorecard button[data-nine], #scorecard .nt-go')).toHaveCount(0);
      // The ring's halo is drawn inside its 80px box, so the box is the edge the eye sees (v30: an inset outline, no shadow).
      const halo = await page.locator('#sh-ring').evaluate((el) => {
        const s = getComputedStyle(el);
        return { shadow: s.boxShadow, width: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset) };
      });
      expect(halo.shadow, 'no shadow').toBe('none');
      expect(halo.width, 'a halo').toBeGreaterThan(0);
      expect(halo.offset, 'drawn inside the box').toBeLessThanOrEqual(-halo.width);
      within1px((await spanOf(page, '#sh-ring')).x, tables[0].x, 'ring on the table edge');
      // 파 수정 moves nothing: the same columns, now stepping the par.
      await page.locator('#edit-par').tap();
      await expect(page.locator('#edit-hint')).toBeVisible();
      await settled(page);
      const editing = await spansOf(page, '#scorecard [data-hole]');
      expect(editing).toHaveLength(18);
      editing.forEach((c, k) => {
        for (const key of ['x', 'y', 'width', 'height'] as const) within1px(c[key], columns[k][key], `파 수정 hole ${k + 1} ${key}`);
      });
      const third = page.locator('#scorecard [data-hole="2"]');
      for (const par of ['3', '4', '5']) {
        await third.tap();
        await expect(third.locator('.c-par')).toHaveText(par);
      }
      await expect(page.locator('#card-view')).toBeVisible();
      expect(await sideScroll(page)).toBe(0);
    });

    test('홀 목록 opens with the holes before this one in view, every cell whole, the first on the heading’s edge', async ({ page }) => {
      await open(page);
      for (const k of [0, 4, 8, 13, 17]) {
        await seed(page, {}, k);
        await page.locator('#hole-btn').tap();
        await expect(page.locator('#strip')).toBeVisible();
        await settled(page);
        const where = `hole ${k + 1}`;
        const row = await edgesOf(page, '#strip-row');
        const cur = await spanOf(page, `#strip [data-jump="${k}"]`);
        expect(cur.x, `${where}: this hole whole`).toBeGreaterThanOrEqual(row.left - 0.5);
        expect(endOf(cur), `${where}: this hole whole`).toBeLessThanOrEqual(row.right + 0.5);
        const cells = await spansOf(page, '#strip-row > li > *');
        const atEnd = await page.locator('#strip-row').evaluate((el) => el.scrollLeft >= el.scrollWidth - el.clientWidth - 1);
        // The row's content box starts on the heading's edge; what scrolls under its 16px padding fades out there.
        if (atEnd) within1px(endOf(cells[cells.length - 1]), row.inRight, `${where}: the last cell on the row's content edge`);
        else within1px(cells.find((c) => endOf(c) > row.inLeft + 0.5)!.x, (await spanOf(page, '.strip-head h2')).x, `${where}: the first cell on the heading's edge`);
        expect(await page.locator('#strip-row').evaluate((el) => getComputedStyle(el).maskImage), `${where}: edges fade`).toContain('linear-gradient');
        await page.keyboard.press('Escape');
        await expect(page.locator('#strip')).toBeHidden();
      }
      // Scrolled to its end, the row's last cell ends on its content edge.
      await page.locator('#hole-btn').tap();
      await page.locator('#strip-row').evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
      await settled(page);
      const row = await edgesOf(page, '#strip-row');
      const cells = await spansOf(page, '#strip-row > li > *');
      within1px(endOf(cells[cells.length - 1]), row.inRight, 'the last cell at the end');
    });

    test('라운드 요약 fits whole with its buttons on the bottom edge, one value per tile', async ({ page }) => {
      await open(page);
      for (const tee of [false, true]) {
        await summarise(page, SUMMARY_HOLES(tee));
        const where = tee ? 'with tee results' : 'without tee results';
        const body = page.locator('#summary .sum-body');
        expect(await body.evaluate((el) => el.scrollHeight - el.clientHeight), `${where}: nothing to scroll`).toBeLessThanOrEqual(0);
        // No line over the buttons while nothing scrolls under them.
        expect(await page.locator('#summary .sum-actions').evaluate((el) => getComputedStyle(el, '::before').opacity), where).toBe('0');
        const sheet = await edgesOf(page, '#summary');
        const archive = await spanOf(page, '#sum-archive');
        expect(archive.y + archive.height, `${where}: 보관 on the bottom edge`).toBeLessThanOrEqual(height - sheet.padBottom + 0.5);
        // Tiles in one row share a height, and each value is one line.
        const tiles = await spansOf(page, '#sum-stats > div');
        for (const t of tiles) for (const u of tiles) if (Math.abs(t.y - u.y) < 1) within1px(t.height, u.height, `${where}: tiles in a row`);
        expect(await oneLine(page, '#sum-stats dd'), where).not.toContain(false);
        // 페어웨이 안착 shows once a tee result says something; until then its hint sits once under the tiles.
        if (tee) {
          await expect(page.locator('#sum-stats div', { hasText: '페어웨이 안착' }).locator('dd')).toHaveText('1/2');
          await expect(page.locator('#sum-hint')).toBeHidden();
        } else {
          await expect(page.locator('#sum-stats')).not.toContainText('페어웨이 안착');
          await expect(page.locator('#sum-hint')).toHaveText('상세에서 티샷 방향을 고르면 페어웨이 안착이 보여요.');
        }
        await page.getByRole('button', { name: '요약 닫기' }).click();
        await expect(page.locator('#summary')).toBeHidden();
      }
    });

    test('지난 라운드 열기 reads in the same nine-column tables as 스코어카드, on the page’s edges, with its total in the sum column', async ({ page }) => {
      await open(page);
      await seedKept(page, 5);
      await tab(page, '지난 라운드').tap();
      await pastItems(page).first().tap();
      await expect(page.locator('#past')).toBeVisible();
      await settled(page);
      const tables = await spansOf(page, '#past-scorecard .ct');
      expect(tables).toHaveLength(2);
      const body = await edgesOf(page, '#past .past-body');
      tables.forEach((t, n) => {
        within1px(t.x, body.inLeft, `nine ${n + 1} left`);
        within1px(endOf(t), body.inRight, `nine ${n + 1} right`);
      });
      const columns = await spansOf(page, '#past-scorecard .ct-col');
      expect(columns).toHaveLength(18);
      for (const nine of [columns.slice(0, 9), columns.slice(9)]) for (const c of nine) expect(Math.abs(c.width - nine[0].width)).toBeLessThanOrEqual(0.5);
      const sums = await spansOf(page, '#past-scorecard .ct-sum');
      for (const s of sums) expect(Math.abs(s.width - 40)).toBeLessThanOrEqual(0.5);
      const heads = await spansOf(page, '#past-scorecard .nt-h');
      expect(heads[1].y).toBeGreaterThanOrEqual(tables[0].y + tables[0].height + 15);
      within1px(midOf(await spanOf(page, '#past-scorecard .tot-n')), midOf(sums[1]), '합계 in the sum column');
      await expect(page.locator('#past-scorecard button')).toHaveCount(0);
      // Its analysis tiles keep one line per value at 360 too, and Par별 평균's three tiles one height.
      expect(await oneLine(page, '#past-analysis .metrics dd')).not.toContain(false);
      const three = await spansOf(page, '#past-analysis .metrics.three > div');
      for (const t of three) within1px(t.height, three[0].height, 'Par별 평균 tiles');
      expect(await page.locator('#past').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    });

    test('분석: both charts draw the same 12px bars at one pitch, and each tile holds one value on one line', async ({ page }) => {
      await open(page);
      await seed(page, SEVEN_HOLES, 5);
      await tab(page, '스코어카드').tap();
      await page.getByRole('radio', { name: '분석', exact: true }).tap();
      await settled(page);
      const bars = await page.locator('#lost-bars .bar, #lost-bars .bar i, #analysis .bar-track, #analysis .bar-fill').evaluateAll((list) => list.map((el) => ({
        h: el.getBoundingClientRect().height, r: getComputedStyle(el).borderTopLeftRadius,
      })));
      // One rounding for both (v30: the full radius, so a 12px bar is a pill end to end).
      for (const b of bars) {
        expect(Math.abs(b.h - 12)).toBeLessThanOrEqual(0.5);
        expect(b.r).toBe('999px');
      }
      const pitch = async (selector: string) => {
        const rows = await spansOf(page, selector);
        return rows.slice(1).map((r, k) => r.y - rows[k].y);
      };
      const pitches = [...await pitch('#lost-bars li'), ...await pitch('#analysis .bar-row')];
      for (const p of pitches) within1px(p, pitches[0], 'row pitch');
      expect(await oneLine(page, '#analysis .metrics dd')).not.toContain(false);
      const three = await spansOf(page, '#analysis .metrics.three > div');
      for (const t of three) within1px(t.height, three[0].height, 'Par별 평균 tiles');
      await expect(page.locator('#analysis .metrics.three dt').first()).toHaveText(/^Par \d(\d홀)?$/);
    });

    test('지난 라운드: 지금 라운드 reads on two whole lines under its title, and a lone trends tile spans the card', async ({ page }) => {
      await open(page);
      await seed(page, Object.fromEntries(Object.entries(SEVEN_HOLES).slice(0, 5)), 5);
      await seedKept(page, 5);
      await tab(page, '지난 라운드').tap();
      await settled(page);
      const card = await edgesOf(page, '#hist-view .now');
      for (const line of ['#now-sub .now-course', '#now-sub .now-meta']) {
        expect(await linesOf(page, line), line).toBe(1);
        const box = await spanOf(page, line);
        within1px(box.x, card.inLeft, `${line} left`);
        within1px(endOf(box), card.inRight, `${line} right`);
      }
      await expect(page.locator('#now-sub .now-meta')).toHaveText(/^\d{1,2}월 \d{1,2}일, 5홀 기록$/);
      // The date never breaks inside itself.
      const dateTops = await page.locator('#now-sub .now-meta').evaluate((el) => {
        const text = el.firstChild!;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, text.textContent!.indexOf(','));
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      });
      expect(dateTops).toBe(1);
      within1px(await baselineOf(page, '#now-score'), await baselineOf(page, '#now-title'), 'score on the title’s baseline');
      // One kept round, not a full 18: its 라운드 tile alone spans the trends.
      const box = await edgesOf(page, '#history');
      const tile = await spanOf(page, '#history-trends .metrics > div');
      within1px(tile.x, box.inLeft, 'trends tile left');
      within1px(endOf(tile), box.inRight, 'trends tile right');
      await expect(page.locator('#history-trends .metrics dd').first()).toHaveText('1회18홀 0회');
    });
  });
}

test.describe('v23 on a 375×553 phone', () => {
  test.use({ viewport: { width: 375, height: 553 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('라운드 요약 keeps its buttons in view while the rest scrolls under them, in 큰 글씨 too', async ({ page }) => {
    await open(page);
    for (const big of [false, true]) {
      if (big) await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), big: true })), PREFS_KEY);
      await summarise(page, SUMMARY_HOLES(true));
      if (big) await expect(page.locator('body')).toHaveClass(/big/);
      const where = big ? '큰 글씨' : '기본 글씨';
      const archive = await spanOf(page, '#sum-archive');
      expect(archive.y, `${where}: 보관 in view`).toBeGreaterThanOrEqual(0);
      expect(archive.y + archive.height, `${where}: 보관 in view`).toBeLessThanOrEqual(553);
      const body = page.locator('#summary .sum-body');
      const over = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(over, `${where}: the rest scrolls`).toBeGreaterThan(0);
      // A line over the buttons while the rest scrolls under them.
      expect(await page.locator('#summary .sum-actions').evaluate((el) => getComputedStyle(el, '::before').opacity), where).toBe('1');
      await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await settled(page);
      within1px((await spanOf(page, '#sum-archive')).y, archive.y, `${where}: 보관 stays put`);
      expect(await sideScroll(page)).toBe(0);
      await page.getByRole('button', { name: '요약 닫기' }).click();
      await expect(page.locator('#summary')).toBeHidden();
    }
  });
});

for (const [width, height] of [[360, 640], [375, 553], [375, 667], [390, 844]]) {
  test.describe(`v23 코스 선택 on a ${width}×${height} phone`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('names the chosen course whole on at most two lines, and the list opens and rests on whole rows', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('#picker')).toBeVisible();
      await settled(page);
      const label = page.locator('#picker-label');
      const whole = () => label.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight);
      await expect(label).toHaveText('에버리스 골프리조트');
      expect(await whole(), 'name not cut').toBe(true);
      expect(await linesOf(page, '#picker-label')).toBeLessThanOrEqual(2);
      // The chosen course's row opens at the list's top, unless the list is scrolled to its end.
      const list = page.locator('#picker-list');
      const atEnd = await list.evaluate((el) => el.scrollTop >= el.scrollHeight - el.clientHeight - 1);
      if (!atEnd) within1px((await spanOf(page, "#picker-list .course[aria-pressed='true']")).y, (await spanOf(page, '#picker-list')).y, 'chosen row at the top');
      // Scrolled part of a row, the list comes to rest on a row's top.
      await list.evaluate((el) => new Promise<void>((resolve) => {
        el.addEventListener('scrollend', () => resolve(), { once: true });
        setTimeout(resolve, 1500);
        el.scrollTo({ top: 30 });
      }));
      await settled(page);
      const top = (await spanOf(page, '#picker-list')).y;
      const rows = await spansOf(page, '#picker-list > li');
      expect(rows.some((r) => Math.abs(r.y - top) <= 1), `rows at ${rows.map((r) => (r.y - top).toFixed(1)).join(', ')}`).toBe(true);
      // A long name still fits two lines, nothing cut, and 이 코스로 시작 stays on screen.
      await page.getByRole('searchbox', { name: '골프장 검색' }).fill('아난티');
      await page.locator('#picker-list button', { hasText: '아난티 클럽 제주' }).tap();
      await expect(label).toHaveText('아난티 클럽 제주 (구 세인트포)');
      expect(await whole(), 'long name not cut').toBe(true);
      expect(await linesOf(page, '#picker-label')).toBeLessThanOrEqual(2);
      const start = await spanOf(page, '#picker-start');
      expect(start.y + start.height).toBeLessThanOrEqual(height);
      expect(await sideScroll(page)).toBe(0);
    });
  });
}

for (const [width, height] of [[360, 640], [390, 844]]) {
  test.describe(`v23 round buttons on a ${width}×${height} phone`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('라운드 요약 puts a 44px close on the title’s line, its ring’s halo inside, and its zero counts quiet', async ({ page, context, browserName }) => {
      await useClipboard(page, context, browserName);
      await useShare(page, 'none');
      await finishRound(page);
      await expect(previewImage(page)).toBeVisible();
      await page.locator('#summary').evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
      const inner = await edgesOf(page, '#summary');
      const close = await spanOf(page, '#sum-close');
      expect(Math.abs(close.width - 44)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(close.height - 44)).toBeLessThanOrEqual(0.5);
      const line = await page.locator('#sum-title').evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const first = range.getClientRects()[0];
        return first.top + first.height / 2;
      });
      within1px(close.y + close.height / 2, line, 'close on the title’s line');
      within1px(endOf(close), inner.inRight, 'close on the inner right edge');
      const card = await spanOf(page, '#sum-card');
      expect(card.y - (close.y + close.height)).toBeGreaterThanOrEqual(24);
      // The ring's halo inside its box (v30: an inset outline, no shadow).
      const halo = await page.locator('#sum-ring').evaluate((el) => {
        const s = getComputedStyle(el);
        return { shadow: s.boxShadow, width: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset) };
      });
      expect(halo.shadow, 'no shadow').toBe('none');
      expect(halo.width, 'a halo').toBeGreaterThan(0);
      expect(halo.offset, 'drawn inside the box').toBeLessThanOrEqual(-halo.width);
      within1px((await spanOf(page, '#sum-ring')).x, inner.inLeft, 'ring on the inner left edge');
      // A count of 0 steps back (its tone "none"), still 3:1; the others keep their tone.
      const marks = await page.locator('#sum-marks .m').evaluateAll((list) => list.map((el) => ({ n: el.textContent, tone: el.getAttribute('data-tone'), mark: el.getAttribute('data-mark') })));
      expect(marks.map((m) => m.n)).toEqual(['0', '1', '1', '0', '1', '0']);
      marks.forEach((m, k) => (m.n === '0' ? expect(m.tone, `mark ${k + 1}`).toBe('none') : expect(m.tone, `mark ${k + 1}`).not.toBe('none')));
      // Each digit against what is under it: the tile, or for 트리플+ the square it fills in its mark's colour.
      const tile = marks.flatMap((m, k) => (m.mark === 'triple' ? [] : [{ sel: `#sum-marks li:nth-child(${k + 1}) .m b`, min: 3 }]));
      for (const r of await contrastOf(page, tile)) expect(r.ratio!, r.sel).toBeGreaterThanOrEqual(3);
      const [fill, digit] = await page.locator("#sum-marks .m[data-mark='triple']").evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el.querySelector('b')!).color]);
      expect(await contrastBetween(page, digit, fill), '트리플+ digit on its square').toBeGreaterThanOrEqual(3);
      // The marks themselves, quiet or not, stand 3:1 off the tile.
      for (const r of await contrastOf(page, marks.map((_, k) => ({ sel: `#sum-marks li:nth-child(${k + 1}) .m`, min: 3 })))) expect(r.ratio!, `${r.sel} drawn`).toBeGreaterThanOrEqual(3);
    });

    test('지난 라운드 열기 lines its round buttons up like the summary’s: 52px, 8px apart, glyphs centred', async ({ page, context, browserName }) => {
      await useClipboard(page, context, browserName);
      await useShare(page, 'none');
      await finishRound(page);
      await expect(previewImage(page)).toBeVisible();
      await page.locator('#summary').evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
      const summary = await roundRow(page, '#summary .sum-actions', '#summary');
      await page.getByRole('button', { name: '지난 라운드에 보관' }).click();
      await pastItems(page).first().tap();
      await expect(page.locator('#past')).toBeVisible();
      await settled(page);
      const past = await roundRow(page, '#past .round-actions', '#past .past-body');
      expect(past.buttons).toHaveLength(3);
      for (const [name, row] of [['summary', summary], ['past', past]] as const) {
        within1px(row.buttons[0].x, row.left, `${name}: first button on the content edge`);
        const gaps = row.buttons.slice(1).map((b, k) => b.x - (row.buttons[k].x + row.buttons[k].width));
        for (const gap of gaps) within1px(gap, 8, `${name}: gap`);
        for (const b of row.buttons) {
          within1px(b.height, 52, `${name}: height`);
          within1px(b.y, row.buttons[0].y, `${name}: one line`);
          if (b.glyph) {
            within1px(b.glyph.x, b.x + b.width / 2, `${name}: glyph centred across`);
            within1px(b.glyph.y, b.y + b.height / 2, `${name}: glyph centred down`);
          }
        }
      }
      for (const k of [0, 1, 2]) within1px(past.buttons[k].width, summary.buttons[k].width, `button ${k + 1} as wide as the summary's`);
      expect(await page.locator('#past').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    });
  });
}

test('공유 in the summary wears the copy icon where it can only copy, the share icon where it shares, both from one icon family (v23)', async ({ page, context, browserName }) => {
  await useClipboard(page, context, browserName);
  await useShare(page, 'none');
  await finishRound(page);
  const share = page.locator('#sum-share');
  await expect(share).toHaveAttribute('data-icon', 'copy');
  await expect(share).toHaveAccessibleName('결과 복사');
  await share.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('1번 Par4: 4타 (E) 드1 그1 퍼2');
  for (const svg of await page.locator('#summary .sum-actions svg').all()) {
    await expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    await expect(svg).toHaveAttribute('stroke-width', '1.75');
  }
});

test('공유 in the summary wears the share icon where the browser has a share sheet (v23)', async ({ page }) => {
  await useShare(page, 'files');
  await finishRound(page);
  await expect(page.locator('#sum-share')).toHaveAttribute('data-icon', 'share');
  await expect(page.locator('#sum-share')).toHaveAccessibleName('공유');
});

for (const mode of ['files', 'text', 'none'] as const) {
  test(`지난 라운드 열기 shares the round as the summary does, without a request or new storage: ${mode} (v23)`, async ({ page, context, browserName }) => {
    if (mode === 'none') await useClipboard(page, context, browserName);
    await useShare(page, mode);
    const requests = outgoing(page);
    await open(page);
    await seedKept(page, 5);
    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    await tab(page, '지난 라운드').click();
    await pastItems(page).first().click();
    const dialog = page.locator('#past');
    await expect(dialog).toBeVisible();
    const share = dialog.locator('#past-share');
    // The image is drawn once the round shows, so a tap shares it at once.
    await expect(dialog.locator('.round-actions')).toHaveAttribute('data-state', 'ready');
    await expect(dialog.getByRole('link', { name: '이메일로 보내기' })).toBeVisible();
    if (mode === 'files') {
      await expect(share).toHaveAttribute('data-icon', 'share');
      await expect(dialog.locator('#past-save')).toBeHidden();
      await share.click();
      await expect.poll(async () => (await sharedData(page)).length).toBe(1);
      const [data] = await sharedData(page);
      expect(data.files).toHaveLength(1);
      expect(data.files[0]).toMatchObject({ name: 'fairway-note-2026-10-01.png', type: 'image/png', head: PNG_HEAD });
      expect(data.text).toContain('1번 Par4: 4타 (E) 드1 그1 퍼2');
    } else if (mode === 'text') {
      await expect(share).toHaveAttribute('data-icon', 'share');
      await expect(dialog.locator('#past-save')).toBeVisible();
      await share.click();
      await expect.poll(async () => (await sharedData(page)).length).toBe(1);
      const [data] = await sharedData(page);
      expect(data.files).toEqual([]);
      expect(data.text).toContain('1번 Par4: 4타 (E) 드1 그1 퍼2');
    } else {
      await expect(share).toHaveAttribute('data-icon', 'copy');
      await expect(share).toHaveAccessibleName('결과 복사');
      await expect(dialog.locator('#past-save')).toBeVisible();
      await share.click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('1번 Par4: 4타 (E) 드1 그1 퍼2');
      await expect(dialog.locator('#past-status')).toContainText('복사했어요');
    }
    for (const svg of await dialog.locator('.round-actions svg').all()) {
      await expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
      await expect(svg).toHaveAttribute('stroke-width', '1.75');
    }
    await expect(dialog.getByRole('button', { name: '이 라운드 지우기' })).toBeVisible();
    expect(requests).toEqual([]);
    expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(keys);
    expect(await page.evaluate(() => ({ session: sessionStorage.length, cookies: document.cookie }))).toEqual({ session: 0, cookies: '' });
  });
}

test('outside 기록 every text takes one of three weights: values 800, labels 600, helper text 400 (v23)', async ({ page }) => {
  test.setTimeout(90_000);
  const offs: string[] = [];
  const check = async (where: string) => {
    await settled(page);
    for (const off of await offWeights(page)) offs.push(`${where}: ${off}`);
  };
  await page.goto('/');
  await expect(page.locator('#picker')).toBeVisible();
  await check('코스 선택');
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await showCard(page);
  await check('스코어카드, empty');
  await tab(page, '지난 라운드').click();
  await check('지난 라운드, empty');
  await seed(page, SEVEN_HOLES, 5);
  await showCard(page);
  await check('스코어카드');
  // A label steps back from its value by weight alone where they share a size.
  for (const [selector, weight] of [['#scorecard .c-hole', '600'], ['#scorecard .ct .m b', '800'], ['#sc-hero .sh-stats dt', '600'], ['#sc-hero .sh-stats dd', '800'], ['#finish-round', '600']]) {
    expect(await weightOf(page, selector), selector).toBe(weight);
  }
  await page.locator('#edit-par').click();
  await check('파 수정');
  await page.locator('#edit-par').click();
  await menu(page);
  await check('메뉴');
  await closeMenu(page);
  await showEntry(page);
  await page.locator('#hole-btn').click();
  await expect(page.locator('#strip')).toBeVisible();
  await check('홀 목록');
  await page.keyboard.press('Escape');
  // The club panel opens from the club's number (v18) or its name above the capsule (v20).
  await page.locator('.club-approach :is(button.club-lbl, button.shot-num)').click();
  await expect(page.locator('#shot-panel')).toBeVisible();
  await check('클럽 상세');
  await page.keyboard.press('Escape');
  await showCard(page);
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await expect(page.locator('#summary')).toBeVisible();
  await check('요약');
  for (const [selector, weight] of [['.sum-stats dt', '600'], ['.sum-stats dd', '800'], ['.sum-stats dd small', '400'], ['#sum-insight span', '600'], ['#sum-insight b', '800'], ['#sum-vs span', '600'], ['#sum-vs b', '800']]) {
    expect(await weightOf(page, selector), selector).toBe(weight);
  }
  await page.getByRole('button', { name: '지난 라운드에 보관' }).click();
  await expect(page.locator('#hist-view')).toBeVisible();
  await check('지난 라운드, kept');
  expect(await weightOf(page, '#bk-later')).toBe('600');
  expect(await weightOf(page, '.past-when')).toBe('600');
  await pastItems(page).first().click();
  await expect(page.locator('#past')).toBeVisible();
  await check('지난 라운드 열기');
  expect(offs).toEqual([]);
});

/**
 * Holds the mouse on `selector`, checks its colour changed and its `text` still reads 4.5:1, then lets go on `away`, a
 * neighbour on screen, so nothing is clicked; afterwards the colour is back (v23).
 */
async function press(page: Page, selector: string, text: string | null, away: string, unders?: string[]) {
  const bg = () => page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await settled(page);
  const rest = await bg();
  const box = (await page.locator(selector).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await settled(page);
  expect(await bg(), `${selector} pressed`).not.toBe(rest);
  if (text) {
    const [c] = await contrastOf(page, [{ sel: text, min: 4.5, unders }]);
    expect(c.ratio!, `${text} while pressed`).toBeGreaterThanOrEqual(4.5);
  }
  const quiet = (await page.locator(away).first().boundingBox())!;
  await page.mouse.move(quiet.x + quiet.width / 2, quiet.y + quiet.height / 2, { steps: 4 });
  await page.mouse.up();
  await settled(page);
  expect(await bg(), `${selector} let go`).toBe(rest);
}
const ROUGH = ['--rough'];   // the picker's rough, flat since v31

test('코스 선택, 스코어카드 and the menu answer a press with their colour, keep their text readable, and let go (v23)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(page.locator('#picker')).toBeVisible();
  await settled(page);
  await press(page, ".picker .chip[aria-pressed='false']", ".picker .chip[aria-pressed='false']", '#picker-title', ROUGH);
  await press(page, ".pk-len button[aria-pressed='false']", ".pk-len button[aria-pressed='false']", '#picker-label');
  await press(page, ".nine-pick button[aria-checked='false']", ".nine-pick button[aria-checked='false']", '#picker-label');
  await press(page, '#picker-start', '#picker-start', '#picker-label');
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await showCard(page);
  await press(page, '#sh-go', '#sh-go', '#sh-empty .sh-e1');
  await seed(page, SEVEN_HOLES, 5);
  await showCard(page);
  await press(page, '#edit-par', '#edit-par', '#card-view .sc-title h2');
  await press(page, '#scorecard [data-hole="0"]', '#scorecard [data-hole="0"] .c-par', '#scorecard .nt-h b');
  await press(page, '#finish-round', '#finish-round', '#save-state');
  await page.locator('#edit-par').click();
  await press(page, '#edit-par', '#edit-par', '#card-view .sc-title h2');
  await page.locator('#edit-par').click();
  await menu(page, '새 라운드');
  // Let go on a neighbour still on screen inside the sheet: outside it, the release would be a tap on the backdrop.
  await press(page, '#menu-close', '#menu-close', '#mi-about .mi-t');
  // 새 라운드 시작 and 취소 share a row, so each lets go on the other: still on screen when the sheet scrolls. The menu is
  // taller than an iPhone's sheet since 말로 입력 (v21), and the question above the row can scroll out of it (merged v23).
  await press(page, '#mp-new [data-collapse]', '#mp-new [data-collapse]', '#new-round');
  await press(page, '#new-round', '#new-round', '#mp-new [data-collapse]');
  await page.locator('#new-round').click();
  await expect(page.locator('#picker-cancel')).toBeVisible();
  await settled(page);
  await press(page, '#picker-cancel', '#picker-cancel', '#picker-title', ROUGH);
});

test('라운드 마치기, the summary and 지난 라운드 answer a press with their colour, keep their text readable, and let go (v23)', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await seed(page, SEVEN_HOLES, 5);
  await showCard(page);
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  await expect(page.locator('#check')).toBeVisible();
  await settled(page);
  await press(page, '#check-go', '#check-go', '#check-title');
  await press(page, '#check-finish', '#check-finish', '#check-title');
  await press(page, '#check-close', null, '#check-title');
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await expect(page.locator('#summary')).toBeVisible();
  await page.locator('#summary').evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  await press(page, '#sum-close', null, '#sum-title');
  await press(page, '#sum-share', null, '#sum-title');
  await press(page, '#sum-archive', '#sum-archive', '#sum-title');
  await page.getByRole('button', { name: '지난 라운드에 보관' }).click();
  await expect(page.locator('#backup-card')).toBeVisible();
  await press(page, '#bk-later', '#bk-later', '#bk-h');
  await press(page, '#bk-save', '#bk-save', '#bk-h');
  await pastItems(page).first().click();
  await expect(page.locator('#past')).toBeVisible();
  await settled(page);
  await press(page, '#past-close', '#past-close', '#past-title');
  await press(page, '#past-share', null, '#past-title');
  await press(page, '#past-delete', '#past-delete', '#past-title');
  // With reduced motion the colour changes at once.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('#past-close').evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
});

test('지난 라운드 says each thing once: the header counts, the backup card tells, the list keeps quiet (v23)', async ({ page }) => {
  await open(page);
  await tab(page, '지난 라운드').click();
  await expect(page.locator('#hist-sub')).toHaveText('보관한 라운드 0개');
  expect(await page.locator('#hist-sub').textContent()).not.toBe(await page.locator('#history-empty .he-1').textContent());
  await seed(page, { 0: { driver: 1, approach: 1, putts: 2 } }, 1);
  await showCard(page);
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await page.getByRole('button', { name: '지난 라운드에 보관' }).click();
  await expect(page.locator('#backup-card')).toBeVisible();
  // The list's status line still tells a screen reader, but the card says it on screen.
  const status = page.locator('#history-status');
  await expect(status).toHaveText(/라운드를 지난 라운드에 보관했어요\.$/);
  await expect(status).toHaveAttribute('role', 'status');
  const box = (await status.boundingBox())!;
  expect(box.width <= 1 && box.height <= 1, `status ${box.width}×${box.height}`).toBe(true);
  await expect(page.locator('#hist-sub')).toHaveText('보관한 라운드 1개');
  // Put away, the card takes the line with it: nothing says it twice.
  await page.getByRole('button', { name: '나중에' }).click();
  await expect(page.locator('#backup-card')).toBeHidden();
  await expect(status).toBeEmpty();
  await expect(status).toBeHidden();
});

for (const [width, height] of [[360, 640], [375, 553]]) {
  test.describe(`v23 with wider type, as on Linux and Android, on a ${width}×${height} phone`, () => {
    // Only to add the stand-in fonts: the page's own CSP blocks injected styles.
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, bypassCSP: true });

    test('with other fonts, the hole columns keep their places and 라운드 요약 keeps 보관 on screen, every value inside its tile', async ({ page }) => {
      await open(page);
      await seed(page, { ...SEVEN_HOLES, 0: { ...SEVEN_HOLES[0], tags: { driver: ['fairway'] } } } as Record<number, Record<string, number>>, 5);
      await page.addStyleTag({ content: OTHER_TYPE });
      await showCard(page);
      await settled(page);
      const columns = await spansOf(page, '#scorecard button[data-hole]');
      const heads = await spansOf(page, '#scorecard button[data-hole] .c-hole');
      expect(columns).toHaveLength(18);
      columns.forEach((c, k) => {
        within1px(c.width, heads[k].width, `hole ${k + 1} width`);
        expect(c.width, `hole ${k + 1} width`).toBeGreaterThanOrEqual(24);
      });
      // Each hole number stays inside its column.
      const spill = await page.locator('#scorecard button[data-hole] .c-hole').evaluateAll((list) => list.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
      expect(spill).toEqual([]);
      expect(await sideScroll(page)).toBe(0);
      await page.getByRole('button', { name: '라운드 마치기' }).click();
      await page.getByRole('button', { name: '그대로 마치기' }).click();
      await expect(page.locator('#summary')).toBeVisible();
      await page.locator('#summary').evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
      const archive = await spanOf(page, '#sum-archive');
      expect(archive.y, '보관 on screen').toBeGreaterThanOrEqual(0);
      expect(archive.y + archive.height, '보관 on screen').toBeLessThanOrEqual(height);
      // Whatever does not fit scrolls under the buttons, which stay put.
      await page.locator('#summary .sum-body').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await settled(page);
      within1px((await spanOf(page, '#sum-archive')).y, archive.y, '보관 stays put');
      const out = await page.locator('#sum-stats dd').evaluateAll((list) => list.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
      expect(out, 'values inside their tiles').toEqual([]);
      expect(await page.locator('#summary').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      expect(await sideScroll(page)).toBe(0);
    });

    test('with other fonts, the course name stays whole and 지금 라운드 keeps its date on one line', async ({ page }) => {
      await page.goto('/');
      await page.addStyleTag({ content: OTHER_TYPE });
      await expect(page.locator('#picker')).toBeVisible();
      await settled(page);
      const label = page.locator('#picker-label');
      const whole = () => label.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight);
      expect(await whole(), 'name not cut').toBe(true);
      await page.getByRole('searchbox', { name: '골프장 검색' }).fill('아난티');
      await page.locator('#picker-list button', { hasText: '아난티 클럽 제주' }).tap();
      await expect(label).toHaveText('아난티 클럽 제주 (구 세인트포)');
      expect(await whole(), 'long name not cut').toBe(true);
      const start = await spanOf(page, '#picker-start');
      expect(start.y + start.height, '이 코스로 시작 on screen').toBeLessThanOrEqual(height);
      expect(await sideScroll(page)).toBe(0);
      await page.getByRole('button', { name: '이 코스로 시작' }).tap();
      await seed(page, Object.fromEntries(Object.entries(SEVEN_HOLES).slice(0, 5)), 5);
      await page.addStyleTag({ content: OTHER_TYPE });
      await tab(page, '지난 라운드').tap();
      await settled(page);
      expect(await linesOf(page, '#now-sub .now-meta'), 'date line').toBe(1);
      expect(await linesOf(page, '#now-sub .now-course'), 'course line').toBe(1);
      within1px(await baselineOf(page, '#now-score'), await baselineOf(page, '#now-title'), 'score on the title’s baseline');
      expect(await sideScroll(page)).toBe(0);
    });
  });
}

/* ---------- v25: Tabler icons, the share image in Pretendard, the hole number whole at 360 ---------- */

/** A Tabler file's shapes without its invisible bounding box, as src/icons.ts and the build take them. */
const tablerShapes = (name: string) => readFileSync(fileURLToPath(new URL(`../vendor/tabler/${name}.svg`, import.meta.url)), 'utf8')
  .replace(/<path stroke="none"[^>]*\/>/, '')
  .match(/<(?:path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*\/>/g)!
  .map((el) => el.replace(/\s+/g, ' ').replace(/ \/>$/, '/>'));

test('draws its UI icons from the vendored Tabler set at the 1.75 line, and ships Tabler’s MIT notice (v25)', async ({ page }) => {
  await open(page);
  // What an icon draws, shape by shape (the browser's own serialization, so attribute order and spacing do not matter).
  const shapes = (selector: string) => page.locator(selector).first().evaluate((svg) => [...svg.children].map((el) => el.outerHTML.replace(/\s+/g, ' ')));
  const same = async (selector: string, name: string) => {
    const want = await page.evaluate((markup) => markup.map((m) => { const t = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); t.innerHTML = m; return t.firstElementChild!.outerHTML.replace(/\s+/g, ' '); }), tablerShapes(name));
    expect(await shapes(selector), `${selector} draws ${name}`).toEqual(want);
  };
  await same('#bar-menu svg', 'menu-2');
  await same('#prev-hole svg', 'chevron-left');
  await same('#next-hole svg', 'chevron-right');
  for (const [tab, name] of [['.home-link', 'home'], ['#tab-card', 'table'], ['#tab-entry', 'pencil'], ['#tab-hist', 'history']]) await same(`${tab} svg`, name);
  await same('.club-driver .plus svg', 'plus');
  await same('.club-driver .minus svg', 'minus');
  // Our own golf glyphs stay: the clubs and the bunker are not Tabler's.
  expect((await shapes('.club-driver .club-lbl svg')).join('')).not.toBe('');
  // Every icon on the page has its shapes (no placeholder left empty), each at our line.
  const empty = await page.evaluate(() => [...document.querySelectorAll('svg[data-icon]')].filter((svg) => !svg.children.length).map((svg) => svg.getAttribute('data-icon')));
  expect(empty).toEqual([]);
  const lines = await page.evaluate(() => [...new Set([...document.querySelectorAll('svg[data-icon]')].map((svg) => getComputedStyle(svg).strokeWidth))]);
  expect(lines.every((w) => ['1.75px', '2.6px', '2.4px'].includes(w)), lines.join(', ')).toBe(true);
  // Each sits centred in its round button, tab or menu tile: its drawn shapes within 1px of the box's centre (measured:
  // flag-3 0.92px low, its pole hanging under the flag; every other within 0.5px).
  const offCentre = (selector: string) => page.evaluate((selector) => [...document.querySelectorAll<SVGSVGElement>(selector)]
    .filter((svg) => svg.getClientRects().length)
    .map((svg) => {
      const r = svg.getBoundingClientRect();
      const shapes = svg.getBBox();
      const scale = r.width / 24;
      const box = svg.parentElement!.getBoundingClientRect();
      const dx = r.left + (shapes.x + shapes.width / 2) * scale - (box.left + box.width / 2);
      const dy = r.top + (shapes.y + shapes.height / 2) * scale - (box.top + box.height / 2);
      return { icon: svg.dataset.icon, dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100 };
    }), selector);
  const onBars = await offCentre('#entry .round svg[data-icon], .tabbar .ti svg');
  // 메뉴 at the bar's right end since v32, after the three views; 홈 left the bar for the top left.
  expect(onBars.map(({ icon }) => icon)).toEqual(['chevron-left', 'chevron-right', 'table', 'pencil', 'history', 'menu-2']);
  expect(onBars.filter(({ dx, dy }) => Math.abs(dx) > 1 || Math.abs(dy) > 1)).toEqual([]);
  await menu(page);
  const tiles = await offCentre('.mi .ic svg');
  expect(tiles.length).toBe(8);
  expect(tiles.filter(({ dx, dy }) => Math.abs(dx) > 1 || Math.abs(dy) > 1)).toEqual([]);
  await closeMenu(page);
  // The MIT notice ships beside the built files (read from outside the page: its CSP allows no fetch).
  const notice = await (await page.request.get('assets/Tabler-LICENSE.txt')).text();
  expect(notice).toContain('MIT License');
  expect(notice).toContain('Paweł Kuna');
});

for (const [width, height] of [[360, 640], [375, 667]]) {
  test(`keeps the hole number whole and its word uncut at ${width}×${height}, in 큰 글씨 too: 번 홀, or 번 where 번 홀 cannot fit, never an ellipsis (v25)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    await page.evaluate(() => document.fonts.ready);
    const word = () => page.locator('#hole-title .hole-u').evaluate((el) => ({ text: el.textContent, cut: el.scrollWidth > el.clientWidth + 0.5 }));
    const whole = () => page.locator('#hole-n').evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5);
    for (let i = 0; i < 4; i++) await next(page).click();
    await expect(page.locator('#hole-n')).toHaveText('5');
    // A one-digit hole reads whole: "5번 홀".
    expect(await word()).toEqual({ text: '번 홀', cut: false });
    for (let i = 0; i < 5; i++) await next(page).click();
    await expect(page.locator('#hole-n')).toHaveText('10');
    const ten = await word();
    expect(ten.cut).toBe(false);
    expect(['번 홀', '번']).toContain(ten.text);
    expect(await whole()).toBe(true);
    // The button still names the hole in full.
    await expect(page.locator('#hole-btn')).toHaveAttribute('aria-label', /^10번 홀, Par \d/);
    // A hole opened from 스코어카드 changes while 기록 is hidden: the words are fitted again when it shows.
    for (const [column, hole] of [[10, '11'], [4, '5']] as const) {
      await tab(page, '스코어카드').click();
      await page.locator(`#scorecard button[data-hole="${column}"]`).click();
      await expect(page.locator('#hole-n')).toHaveText(hole);
      const opened = await word();
      expect(opened.cut, `hole ${hole} from 스코어카드`).toBe(false);
      expect(hole === '5' ? ['번 홀'] : ['번 홀', '번'], `hole ${hole} from 스코어카드`).toContain(opened.text);
    }
    for (let i = 0; i < 5; i++) await next(page).click();
    await expect(page.locator('#hole-n')).toHaveText('10');
    // 큰 글씨: the word may shorten to 번, never further and never cut, and the number stays whole.
    await menu(page);
    await page.getByRole('switch', { name: /큰 글씨/ }).click();
    await closeMenu(page);
    for (const [hole, back] of [['10', 0], ['5', 5]] as const) {
      for (let i = 0; i < back; i++) await page.locator('#prev-hole').click();
      await expect(page.locator('#hole-n')).toHaveText(hole);
      const big = await word();
      expect(big.cut, `큰 글씨 ${hole}`).toBe(false);
      expect(['번 홀', '번'], `큰 글씨 ${hole}`).toContain(big.text);
      expect(await whole(), `큰 글씨 ${hole}`).toBe(true);
    }
  });
}

test('draws the share image in the bundled Pretendard, its weights loaded before the first word (v25)', async ({ page }) => {
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { fontLog: string[] }).fontLog = log;
    const load = FontFaceSet.prototype.load;
    FontFaceSet.prototype.load = function (this: FontFaceSet, font: string, text?: string) {
      log.push(`load ${font}`);
      return load.call(this, font, text);
    };
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, ...args: Parameters<CanvasRenderingContext2D['fillText']>) {
      log.push(`text ${this.font}`);
      return fill.apply(this, args);
    };
  });
  await open(page);
  await seed(page, SEVEN_HOLES, 5);
  await showCard(page);
  await page.getByRole('button', { name: '라운드 마치기' }).click();
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await page.locator('#sum-card[data-state="ready"]').waitFor();
  const log = await page.evaluate(() => (window as unknown as { fontLog: string[] }).fontLog);
  const texts = log.filter((line) => line.startsWith('text '));
  expect(texts.length).toBeGreaterThan(10);
  // Every word on the image in Pretendard, as on the page (a weight of 400 serializes as no weight).
  for (const line of texts) expect(line).toMatch(/^text (?:\d{3} )?[\d.]+px ["']?Pretendard/);
  // Each weight it draws in was asked for before the first word.
  const before = log.slice(0, log.findIndex((line) => line.startsWith('text '))).filter((line) => line.startsWith('load ')).join(' | ');
  for (const weight of new Set(texts.map((line) => /^text (\d{3}) /.exec(line)?.[1] ?? '400'))) expect(before, `weight ${weight}`).toMatch(new RegExp(`load ${weight} [\\d.]+px ["']?Pretendard`));
});

/* ---------- v26: 스코어카드 | 분석, and a cue wherever 스코어카드 and 지난 라운드 scroll ---------- */

/** The 스코어카드 | 분석 switch's two choices (a radio group, so the tab bar keeps the only tab named 스코어카드). */
const pane = (page: Page, name: '스코어카드' | '분석') => page.getByRole('radiogroup', { name: '스코어카드 보기' }).getByRole('radio', { name, exact: true });
/** The fade at the bottom of a scrolling view, as drawn. */
const cueOf = (page: Page, view: string) => page.locator(view).evaluate((el) => getComputedStyle(el, '::after').opacity);
/** Whether a view can scroll further down from where it is. */
const moreBelow = (page: Page, view: string) => page.locator(view).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop > 4);

for (const [width, height] of [[360, 640], [375, 553], [390, 844]] as const) {
  test.describe(`스코어카드 | 분석 on a ${width}×${height} phone (v26)`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });

    test('shows the switch on the cards’ edges without scrolling, and 분석 opens the analysis at its top', async ({ page }) => {
      await open(page);
      await seed(page, SEVEN_HOLES, 5);
      await tab(page, '스코어카드').tap();
      await settled(page);
      const sw = await spanOf(page, '#sc-switch');
      const sheet = await spanOf(page, '#sc-sheet');
      const bar = await spanOf(page, '#views');
      // On screen before any scrolling, above the tab bar, on the cards' edges (the 16px grid).
      expect(await page.locator('#card-view').evaluate((el) => el.scrollTop)).toBe(0);
      expect(sw.y).toBeGreaterThanOrEqual(0);
      expect(sw.y + sw.height).toBeLessThanOrEqual(bar.y);
      within1px(sw.x, 16, 'switch, left');
      within1px(sw.x, sheet.x, 'switch on the card, left');
      within1px(endOf(sw), endOf(sheet), 'switch on the card, right');
      // Two equal halves with their words in the middle, each a 48px target.
      const halves = await spansOf(page, '#sc-switch [role="radio"]');
      expect(halves).toHaveLength(2);
      within1px(halves[0].width, halves[1].width, 'halves');
      for (const h of await page.locator('#sc-switch [role="radio"]').evaluateAll((list) => list.map((el) => {
        const r = el.getBoundingClientRect();
        const after = getComputedStyle(el, '::after');
        const touch = r.height + (parseFloat(after.top) < 0 ? -parseFloat(after.top) : 0) + (parseFloat(after.bottom) < 0 ? -parseFloat(after.bottom) : 0);
        const range = document.createRange();
        range.selectNodeContents(el);
        const words = range.getBoundingClientRect();
        return { touch, off: words.x + words.width / 2 - (r.x + r.width / 2) };
      }))) {
        expect(h.touch).toBeGreaterThanOrEqual(48);
        expect(Math.abs(h.off)).toBeLessThanOrEqual(1);
      }
      await expect(pane(page, '스코어카드')).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('#sc-sheet')).toBeVisible();
      await expect(page.locator('#sc-analysis')).toBeHidden();
      // From the bottom of the tables, 분석 shows the analysis from its first heading, under the switch.
      await page.locator('#card-view').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await pane(page, '분석').tap();
      await expect(pane(page, '분석')).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('#sc-sheet')).toBeHidden();
      await expect(page.locator('#sc-analysis')).toBeVisible();
      await settled(page);
      const head = await spanOf(page, '#lost-title');
      expect(head.y).toBeGreaterThanOrEqual((await spanOf(page, '#sc-switch')).y + sw.height);
      expect(head.y + head.height).toBeLessThanOrEqual(bar.y);
      await expect(page.locator('#analysis .headline')).toContainText('7홀');
      // 라운드 마치기 is still at the end, on the cards' edges.
      await page.locator('#finish-round').scrollIntoViewIfNeeded();
      const finish = await spanOf(page, '#finish-round');
      expect(finish.y + finish.height).toBeLessThanOrEqual(bar.y);
      within1px(finish.x, sw.x, '라운드 마치기, left');
      expect(await page.locator('#card-view').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    });
  });
}

test('the 스코어카드 | 분석 switch is a radio group: arrows choose, the choice stays across tabs, and 파 수정 steps aside on 분석 (v26)', async ({ page }) => {
  await open(page);
  await seed(page, SEVEN_HOLES, 5);
  await showCard(page);
  const card = pane(page, '스코어카드');
  const analysis = pane(page, '분석');
  await expect(card).toHaveAttribute('tabindex', '0');
  await expect(analysis).toHaveAttribute('tabindex', '-1');
  await card.focus();
  await page.keyboard.press('ArrowRight');
  await expect(analysis).toBeFocused();
  await expect(analysis).toHaveAttribute('aria-checked', 'true');
  await expect(card).toHaveAttribute('aria-checked', 'false');
  await expect(analysis).toHaveAttribute('tabindex', '0');
  await expect(page.locator('#sc-analysis')).toBeVisible();
  await expect(page.locator('#sc-sheet')).toBeHidden();
  // 파 수정 belongs to the tables: it steps aside on 분석.
  await expect(page.locator('#edit-par')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(card).toBeFocused();
  await expect(card).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#edit-par')).toBeVisible();
  // 파 수정 on, then 분석: it ends there, and the tables come back as they were.
  await page.locator('#edit-par').click();
  await expect(page.locator('#edit-par')).toHaveText('완료');
  await analysis.click();
  await card.click();
  await expect(page.locator('#edit-par')).toHaveText('파 수정');
  await expect(page.locator('#edit-hint')).toBeHidden();
  // The choice stays while the other tabs are used, as the view does.
  await analysis.click();
  await tab(page, '기록').click();
  await tab(page, '스코어카드').click();
  await expect(analysis).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#sc-analysis')).toBeVisible();
  // A hole opened from the analysis' tables is still a tap away: 스코어카드 shows them again.
  await card.click();
  await expect(page.locator('#scorecard button[data-hole="4"]')).toBeVisible();
});

test('a soft fade at the bottom says 스코어카드 and 지난 라운드 have more below, only while they do (v26)', async ({ page }) => {
  const seen = new Set<boolean>();
  const check = async (view: string, what: string) => {
    const more = await moreBelow(page, view);
    seen.add(more);
    await expect.poll(() => cueOf(page, view), what).toBe(more ? '1' : '0');
  };
  // A short phone: the tables run under the tab bar, then end.
  await page.setViewportSize({ width: 375, height: 553 });
  await open(page);
  await seed(page, SEVEN_HOLES, 5);
  await showCard(page);
  await check('#card-view', '스코어카드 at its top');
  expect(await moreBelow(page, '#card-view')).toBe(true);
  await page.locator('#card-view').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await check('#card-view', '스코어카드 at its end');
  expect(await moreBelow(page, '#card-view')).toBe(false);
  await pane(page, '분석').click();
  await check('#card-view', '분석 at its top');
  await page.locator('#card-view').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await check('#card-view', '분석 at its end');
  // A tall phone and a new round: 분석 and 지난 라운드 fit, so no fade.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.clear());
  await open(page);
  await showCard(page);
  await pane(page, '분석').click();
  await check('#card-view', 'an empty 분석');
  expect(await moreBelow(page, '#card-view')).toBe(false);
  await tab(page, '지난 라운드').click();
  await check('#hist-view', 'an empty 지난 라운드');
  expect(seen).toEqual(new Set([true, false]));
});

/* ---------- v28: 그린까지 in 기본, split into 세컨 and 어프로치 in 상세 ---------- */

/** 상세, with its one-time tip put away by a tap on it. */
async function detailMode(page: Page) {
  await page.getByRole('button', { name: '상세', exact: true }).click();
  const tip = page.locator('#split-tip');
  if (await tip.isVisible()) await tip.click();
  await expect(tip).toBeHidden();
}

/** Writes the round's holes as given (split fields and details too) and reloads on hole `current`. */
async function seedHoles(page: Page, holes: Record<number, Record<string, unknown>>, current: number) {
  await page.evaluate(([key, list, at]) => {
    const r = JSON.parse(localStorage.getItem(key as string)!);
    for (const [i, v] of Object.entries(list as Record<string, Record<string, unknown>>)) Object.assign(r.holes[Number(i)], v);
    r.current = at;
    r.lastEdited = Date.now();
    localStorage.setItem(key as string, JSON.stringify(r));
  }, [STORAGE_KEY, holes, current] as const);
  await page.reload();
  await expect(page.locator('#entry')).toBeVisible();
}

const visibleNames = (page: Page) => page.locator('#clubs .club:visible .club-name');

test('기본 counts the shots to the green as 그린까지, and 상세 shows them as 세컨 and 어프로치, 티샷 first on a par 3 (v28)', async ({ page }) => {
  await open(page);
  await expect(visibleNames(page)).toHaveText(['드라이버', '그린까지', '퍼터']);
  await tap(page, 'approach');
  await expect(page.locator('#toast-msg')).toHaveText('그린까지 +1');
  await expect(page.locator('#announce')).toHaveText('1번 홀 그린까지 1, 1타');
  await expect(page.locator('#count-label-approach')).toHaveText('그린까지 1');
  await longPress(page, 'approach');
  await expect(page.locator('#np-title')).toHaveText('그린까지 몇 번 쳤나요?');
  await page.keyboard.press('Escape');
  await detailMode(page);
  await expect(visibleNames(page)).toHaveText(['드라이버', '세컨', '어프로치', '퍼터']);
  for (const key of KEYS.상세) {
    await expect(page.locator(`.club-${key} .plus`)).toHaveAttribute('aria-label', `${LABEL[key]} 하나 더하기`);
    await expect(page.locator(`.club-${key} .minus`)).toHaveAttribute('aria-label', `${LABEL[key]} 하나 빼기`);
  }
  await expect(page.locator('.club-approach')).toBeHidden();
  // Hole 4 of Everis 새별 is a par 3: the tee shot is rarely a driver there.
  await pickHole(page, 3);
  await expect(visibleNames(page)).toHaveText(['티샷', '세컨', '어프로치', '퍼터']);
  await page.getByRole('button', { name: '기본', exact: true }).click();
  await expect(visibleNames(page)).toHaveText(['티샷', '그린까지', '퍼터']);
});

test('세컨 ± changes 그린까지 alone, 어프로치 ± changes both, and a hole from 기본 says so quietly until 세컨 or 어프로치 first changes (v28)', async ({ page }) => {
  await open(page);
  await tap(page, 'approach', 2);
  expect((await stored(page)).holes[0]).not.toHaveProperty('short');
  await detailMode(page);
  // Recorded in 기본: all of it shows as 세컨, and 어프로치 says where it came from instead of a 0.
  await expect(count(page, 'second')).toHaveText('2');
  await expect(page.locator('.club-short .from-basic')).toBeVisible();
  await expect(count(page, 'short')).toBeHidden();
  await expect(page.locator('#count-label-short')).toHaveText('어프로치 0, 기본에서 기록');
  await expect(page.locator('#count-label-second')).toHaveText('세컨 2, 기본에서 기록');
  // A tap on 드라이버 is no word on the split.
  await tap(page, 'driver');
  await expect(page.locator('.club-short .from-basic')).toBeVisible();
  // The first change to 어프로치 records the split: 2 were 세컨, this one an 어프로치.
  await page.getByRole('button', { name: '어프로치 하나 더하기' }).click();
  await expect(page.locator('.club-short .from-basic')).toBeHidden();
  await expect(count(page, 'short')).toHaveText('1');
  await expect(count(page, 'second')).toHaveText('2');
  await expect(page.locator('#toast-msg')).toHaveText('어프로치 +1');
  expect((await stored(page)).holes[0]).toMatchObject({ driver: 1, approach: 3, short: 1 });
  await expect(page.locator('#hole-strokes')).toHaveText('4');
  // 세컨 − takes a 세컨, and 되돌리기 brings it back.
  await page.getByRole('button', { name: '세컨 하나 빼기' }).click();
  expect((await stored(page)).holes[0]).toMatchObject({ approach: 2, short: 1 });
  await expect(page.locator('#toast-msg')).toHaveText('세컨 −1');
  await page.locator('#toast-undo').click();
  expect((await stored(page)).holes[0]).toMatchObject({ approach: 3, short: 1 });
  // A long press sets a part straight away.
  await longPress(page, 'short');
  await expect(page.locator('#np-title')).toHaveText('어프로치 몇 번 쳤나요?');
  await page.getByRole('button', { name: '2번', exact: true }).click();
  expect((await stored(page)).holes[0]).toMatchObject({ approach: 4, short: 2 });
  await expect(page.locator('#toast-msg')).toHaveText('어프로치 2로');
  // 기본's 그린까지 on the split hole: its − takes 세컨 first, then 어프로치, so it never drops below 어프로치.
  await page.getByRole('button', { name: '기본', exact: true }).click();
  await expect(count(page, 'approach')).toHaveText('4');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '그린까지 하나 빼기' }).click();
  expect((await stored(page)).holes[0]).toMatchObject({ approach: 1, short: 1 });
  await detailMode(page);
  await expect(count(page, 'second')).toHaveText('0');
  await expect(count(page, 'short')).toHaveText('1');
  await expect(page.locator('.club-second .minus')).toBeDisabled();
});

test('the middle count stops at 15 with 세컨 and 어프로치 together (v28)', async ({ page }) => {
  await open(page);
  await seedHoles(page, { 0: { driver: 1, approach: 15, short: 5 } }, 0);
  await detailMode(page);
  await expect(page.locator('.club-second .plus')).toBeDisabled();
  await expect(page.locator('.club-short .plus')).toBeDisabled();
  await expect(page.locator('.club-second .minus')).toBeEnabled();
});

test('상세 says once what 세컨 and 어프로치 are: a tap on the tip puts it away for good, records nothing and never moves the card (v28)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await open(page);
  const tip = page.locator('#split-tip');
  await expect(tip).toBeHidden();
  await page.getByRole('button', { name: '상세', exact: true }).click();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveAttribute('role', 'note');
  await expect(tip.locator('dt')).toHaveText(['세컨', '어프로치']);
  await expect(tip.locator('dd')).toHaveText(['그린을 향한 샷, 레이업 포함', '그린 주변 짧은 샷, 벙커샷 포함']);
  await atRest(page);
  // Over the four capsules' middle, inside the card's content edges.
  const box = await rect(page, '#split-tip');
  const first = await rect(page, '.club-driver .pill');
  const last = await rect(page, '.club-putts .pill');
  expectAligned(midY(box), midY(first), 'tip on the capsules’ midline');
  expectAligned(box.x, first.x, 'tip from the content edge');
  expectAligned(box.x + box.width, last.x + last.width, 'tip to the content edge');
  const sheet = await rect(page, '#sheet');
  const close = await rect(page, '#split-tip-close');
  expect(Math.min(close.width, close.height), '× target').toBeGreaterThanOrEqual(44);
  // A tap on its words puts it away and presses nothing under it.
  await tip.click({ position: { x: 24, y: box.height / 2 } });
  await expect(tip).toBeHidden();
  await expect(page.locator('#announce')).toHaveText('세컨과 어프로치 설명을 닫았어요');
  expect((await stored(page)).holes[0]).toMatchObject({ driver: 0, approach: 0, putts: 0 });
  expect((await prefsOf(page)).split).toBe(true);
  expect(await rect(page, '#sheet')).toEqual(sheet);
  // Gone for good: not on the next visit to 상세, nor after a reload.
  await page.getByRole('button', { name: '기본', exact: true }).click();
  await page.getByRole('button', { name: '상세', exact: true }).click();
  await expect(tip).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: '상세', exact: true }).click();
  await expect(tip).toBeHidden();
});

test('the tip also goes with its × (focus moves on to 세컨) or with a first stroke on 세컨 or 어프로치, which counts (v28)', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '상세', exact: true }).click();
  await page.locator('#split-tip-close').click();
  await expect(page.locator('#split-tip')).toBeHidden();
  await expect(page.locator('#lbl-second')).toBeFocused();
  // A fresh start, and a stroke this time.
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)!), split: undefined })), PREFS_KEY);
  await page.reload();
  await page.getByRole('button', { name: '상세', exact: true }).click();
  await expect(page.locator('#split-tip')).toBeVisible();
  // The + glyph at the top of the half, which the tip leaves in view (on shorter capsules it covers the half's middle).
  const plus = page.getByRole('button', { name: '세컨 하나 더하기' });
  await plus.click({ position: { x: (await plus.boundingBox())!.width / 2, y: 12 } });
  await expect(page.locator('#split-tip')).toBeHidden();
  await expect(count(page, 'second')).toHaveText('1');
  expect((await prefsOf(page)).split).toBe(true);
});

test('세컨’s panel shows the middle count’s first shots and 어프로치’s the rest, one list underneath, with 어프로치’s own chips (v28)', async ({ page }) => {
  await open(page);
  await detailMode(page);
  await page.getByRole('button', { name: '세컨 하나 더하기' }).click();
  await page.getByRole('button', { name: '세컨 하나 더하기' }).click();
  await page.getByRole('button', { name: '어프로치 하나 더하기' }).click();
  await page.locator('#lbl-second').click();
  await expect(page.locator('#shot-panel')).toBeVisible();
  await expect(page.locator('#sp-club')).toHaveText('세컨');
  await expect(page.locator('#sp-help')).toHaveText('그린을 향한 샷, 레이업 포함');
  await expect(page.locator('#sp-shots button')).toHaveText(['1', '2']);
  await expect(page.locator('#sp-shot')).toHaveText('2번째 샷');
  await page.getByRole('button', { name: '온그린', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('#lbl-short').click();
  await expect(page.locator('#sp-club')).toHaveText('어프로치');
  await expect(page.locator('#sp-help')).toHaveText('그린 주변 짧은 샷, 벙커샷 포함');
  await expect(page.locator('#sp-shots')).toBeHidden();
  await expect(page.locator('#sp-chips button:visible .sp-lbl')).toHaveText(['좌', '붙음', '우', '길게', '짧게', '칩인', '뒤땅/토핑']);
  await page.getByRole('button', { name: '붙음', exact: true }).click();
  await expect(page.getByRole('button', { name: '붙음', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  expect((await stored(page)).holes[0]).toMatchObject({ approach: 3, short: 1, tags: { approach: [null, 'green', 'close'] } });
  for (const key of ['second', 'short']) await expect(numberOf(page, key)).toHaveClass(/tagged/);
  // 기본's 그린까지 shows all three: 붙음, not one of its chips, shows on its shot so it can be seen and cleared.
  await page.getByRole('button', { name: '기본', exact: true }).click();
  await numberOf(page, 'approach').click();
  await expect(page.locator('#sp-shots button')).toHaveText(['1', '2', '3']);
  await expect(page.getByRole('button', { name: '붙음', exact: true })).toBeVisible();
  await page.locator('#sp-shots button[data-shot="1"]').click();
  await expect(page.getByRole('button', { name: '붙음', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: '온그린', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
});

test('분석 adds 세컨 and 어프로치 under 그린까지 for the split holes only, with their greens in regulation and up and downs; the summary its 업앤다운 (v28)', async ({ page }) => {
  await open(page);
  // Hole 1 in 기본; holes 2–4 split: on in two with no 어프로치, an 어프로치 and one putt, two 어프로치 and two putts.
  await seedHoles(page, {
    0: { driver: 1, approach: 2, putts: 2 },
    1: { driver: 1, approach: 1, putts: 2, short: 0 },
    2: { driver: 1, approach: 3, putts: 1, short: 1 },
    3: { driver: 1, approach: 2, putts: 2, short: 2 },
  }, 4);
  await showCard(page);
  await page.getByRole('radio', { name: '분석', exact: true }).click();
  await expect(page.locator('#lost-bars li > span:first-child')).toHaveText(['티샷', '그린까지', '세컨', '어프로치', '퍼트', '벌타']);
  await expect(page.locator('#lost-bars li.part .v')).toHaveText(['+0', '+3']);
  await expect(page.locator('#lost-split')).toHaveText('세컨과 어프로치는 상세로 나눈 3홀만, 세컨 Par−3번과 어프로치 0번을 기준으로 셌어요.');
  const split = page.locator('#analysis .metrics.split');
  await expect(split.locator('dt')).toHaveText(['나눈 홀', '그린 적중', '업앤다운']);
  // A percent only from three (v29): 1/3 is 33%, 1/2 stays a count.
  await expect(split.locator('dd')).toHaveText(['3/4', '1/333%', '1/2']);
  // The bars already say what 세컨 and 어프로치 lost, so 정리 does not repeat it on the page (v29); the report still does.
  await expect(page.locator('#analysis')).not.toContainText('상세로 나눈 3홀에서');
  await page.locator('#finish-round').click();
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await expect(page.locator('#sum-stats dt').last()).toHaveText('업앤다운');
  await expect(page.locator('#sum-stats dd').last()).toHaveText('1/2');
  await expect(page.locator('#sum-insight')).toHaveText('타수를 가장 많이 잃은 곳 그린까지 +4');
});

test('말로 입력 sets 세컨 and 어프로치 by their own words and 그린까지 the whole count, never both in one line (v28)', async ({ page }) => {
  await open(page);
  await voiceOn(page);
  await say(page, '드라이버 하나 세컨 하나 어프로치 둘 퍼터 하나');
  await expect(page.locator('#voice')).toBeHidden();
  expect((await stored(page)).holes[0]).toMatchObject({ driver: 1, approach: 3, short: 2, putts: 1 });
  await expect(page.locator('#toast-msg')).toHaveText(`${LABEL.driver} 1 · 세컨 1 · 어프로치 2 · ${LABEL.putts} 1`);
  // 그린까지 sets the whole count; one less is a 세컨.
  await say(page, '그린까지 둘');
  expect((await stored(page)).holes[0]).toMatchObject({ approach: 2, short: 2 });
  await expect(page.locator('#toast-msg')).toHaveText('그린까지 2');
  await say(page, '그린까지 셋 어프로치 하나');
  await expect(page.locator('#vc-error')).toHaveText('그린까지와 세컨·어프로치는 따로 말해 주세요. 바꾼 것은 없어요.');
  expect((await stored(page)).holes[0]).toMatchObject({ approach: 2, short: 2 });
  // In 상세 the sheet's example says the parts.
  await page.locator('#vc-close').click();
  await detailMode(page);
  await page.locator('#voice-open').click();
  await expect(page.locator('#vc-example')).toHaveText('예: 드라이버 하나 세컨 하나 어프로치 하나 퍼터 둘 다음 홀');
});

for (const [width, height] of [[390, 844], [375, 553], [360, 640]]) {
  test.describe(`세컨 and 어프로치 in sunlight and in 큰 글씨 on a ${width}×${height} phone (v28)`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('the tip, 기본에서 기록 and the four names stand out from what is under them', async ({ page }) => {
      await open(page);
      await tap(page, 'approach');
      await page.getByRole('button', { name: '상세', exact: true }).tap();
      await atRest(page);
      const found = await contrastOf(page, [
        { sel: '#split-tip dt', min: 4.5, unders: OVER_ART }, { sel: '#split-tip dd', min: 4.5, unders: OVER_ART },
        ...['#lbl-driver .lbl-in', '#lbl-second .lbl-in', '#lbl-short .lbl-in', '#lbl-putts .lbl-in'].map((sel) => ({ sel, min: 4.5, unders: OVER_ART })),
        { sel: '.club-short .from-basic', min: 4.5, unders: OVER_ART, also: ['.club-short .plus'] },
        { sel: '.club-short .from-basic', min: 4.5, unders: OVER_ART, also: ['.club-short .minus'] },
      ]);
      for (const r of found) {
        expect(r.ratio, `${r.sel}: not found`).not.toBeNull();
        expect(r.size, r.sel).toBeGreaterThanOrEqual(13);
        expect(r.ratio!, r.sel).toBeGreaterThanOrEqual(r.min);
      }
      // 기본에서 기록 keeps clear of the + and − it sits between.
      await page.locator('#split-tip').tap();
      await atRest(page);
      const [plus, note, minus] = await Promise.all(['.club-short .plus span', '.club-short .from-basic', '.club-short .minus span'].map((s) => rect(page, s)));
      expect(note.y - (plus.y + plus.height), 'clear of +').toBeGreaterThanOrEqual(1);
      expect(minus.y - (note.y + note.height), 'clear of −').toBeGreaterThanOrEqual(1);
      expect(note.width).toBeLessThanOrEqual((await rect(page, '.club-short .pill')).width);
    });

    test('큰 글씨 keeps 어프로치’s chips whole inside its panel, and 상세 still fits without scrolling', async ({ page }) => {
      await open(page);
      await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), big: true, split: true })), PREFS_KEY);
      await page.reload();
      await expect(page.locator('body')).toHaveClass(/big/);
      await page.getByRole('button', { name: '상세', exact: true }).tap();
      await atRest(page);
      expect(await page.locator('#sheet').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
      expect(await sideScroll(page)).toBe(0);
      for (const key of KEYS.상세) {
        expect(await page.locator(`#name-${key}`).evaluate((el) => el.scrollWidth - el.clientWidth), `${key} name whole`).toBeLessThanOrEqual(0);
      }
      await numberOf(page, 'short').tap();
      await expect(page.locator('#shot-panel')).toBeVisible();
      const panel = await rect(page, '#shot-panel');
      for (const chip of await page.locator('#sp-chips button:visible').all()) {
        const b = (await chip.boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(panel.x);
        expect(b.x + b.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
        expect(await chip.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      }
    });
  });
}

/* ---------- v29: the first design clean-up (no version or maker link on the product, one voice, findings first) ---------- */

test('shows no version or maker link on the product: the version only in 앱 정보, the picker’s way home a quiet 홈 (v29)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#picker')).toBeVisible();
  await expect(page.locator('#picker .pk-brand')).not.toContainText(/v\d+/);
  const home = page.locator('#picker a[href="../../"]');
  await expect(home).toHaveText('홈');
  await expect(home).toHaveAttribute('aria-label', /carpenta\.github\.io/);
  expect(await home.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');
  // Measured at rest: while the picker opens, its scale leaves the chip a hair under 44px.
  await settled(page);
  const box = (await home.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await expect(page.locator('#app-version')).toHaveCount(0);
  await expect(page.locator('#entry')).not.toContainText(/v\d+/);
  await menu(page, '앱 정보');
  await expect(page.locator('#mp-about')).toContainText('Fairway Note v33');
});

test('분석 says what was lost first, keeps how it counts behind ⓘ, and speaks one voice (v29)', async ({ page }) => {
  await open(page);
  // Holes 1–3 recorded: 그린까지 over twice (+2), a 3-putt, an OB.
  await seedHoles(page, { 0: { driver: 1, approach: 2, putts: 3 }, 1: { driver: 1, approach: 2, putts: 2, ob: 1 }, 2: { driver: 1, approach: 2, putts: 2 } }, 3);
  await showCard(page);
  await page.getByRole('radio', { name: '분석', exact: true }).click();
  await expect(page.locator('#lost-note')).toHaveText('그린까지에서 2타 잃었어요.');
  // Each bar fills its track by its share of the scale, max(most, 3): 그린까지 2 of 3 (v29: the tab bar's 4-column
  // .bar grid had squeezed every fill into a quarter of its track, so +4 of 4 drew 23%).
  const shares = await page.locator('#lost-bars li').evaluateAll((lis) => lis.map((li) => {
    const track = li.querySelector('.bar')!.getBoundingClientRect();
    const fill = li.querySelector('.bar i')!.getBoundingClientRect();
    return `${li.firstElementChild!.textContent} ${Math.round((fill.width / track.width) * 100)}%`;
  }));
  expect(shares).toEqual(['티샷 0%', '그린까지 67%', '퍼트 33%', '벌타 33%']);
  const how = page.locator('#lost-how');
  await expect(how).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#lost-method')).toBeHidden();
  await how.click();
  await expect(how).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#lost-method')).toContainText('티샷 1번, 그린까지 Par−3번, 퍼트 2번');
  // 정리 says only what the tiles and bars do not: the 3-putt and the OB, in 해요체.
  await expect(page.locator('#analysis .insights li')).toHaveText([/^3퍼트 이상이 1홀 있어요\./, /^OB 1회로 벌타 1타가 더해졌어요\./]);
  await expect(page.locator('#card-view')).not.toContainText(/습니다|입니다/);
  // Back under three holes (hole 3 cleared in 기록), the ⓘ goes and the box it opened closes with it.
  await showEntry(page);
  await page.locator('#prev-hole').click();
  await expect(page.locator('#hole-n')).toHaveText('3');
  for (const key of ['driver', 'approach', 'putts']) {
    await atRest(page);
    await longPress(page, key);
    await page.getByRole('button', { name: '0번', exact: true }).click();
    await expect(count(page, key)).toHaveText('0');
  }
  await showCard(page);
  await expect(page.locator('#lost-note')).toHaveText('1홀 더 기록하면 어디서 타수를 잃었는지 보여요.');
  await expect(how).toBeHidden();
  await expect(page.locator('#lost-how-box')).toBeHidden();
});

test('hides tiles of nothing and percents of fewer than three, and leads the summary with where the round lost most (v29)', async ({ page }) => {
  await open(page);
  // Two holes, no mulligan, no penalty, one tee result, nothing on the back nine.
  await seedHoles(page, { 0: { driver: 1, approach: 2, putts: 2 }, 1: { driver: 1, approach: 1, putts: 2 } }, 2);
  await seedTee(page);
  await showCard(page);
  await page.getByRole('radio', { name: '분석', exact: true }).click();
  const dts = page.locator('#analysis .metrics dt');
  await expect(dts.filter({ hasText: '멀리건' })).toHaveCount(0);
  await expect(dts.filter({ hasText: '벌타' })).toHaveCount(0);
  await expect(page.locator('#analysis .metrics div', { hasText: '그린 적중' }).locator('dd')).toHaveText('1/2');
  await page.locator('#finish-round').click();
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  const stats = page.locator('#sum-stats');
  await expect(stats.locator('dt').filter({ hasText: '벌타' })).toHaveCount(0);
  await expect(stats.locator('dt').filter({ hasText: '후반' })).toHaveCount(0);
  await expect(stats.locator('div', { hasText: '페어웨이 안착' }).locator('dd')).toHaveText('1/1');
  const insight = (await page.locator('#sum-insight').boundingBox())!;
  const marks = (await page.locator('#sum-marks').boundingBox())!;
  expect(insight.y + insight.height).toBeLessThanOrEqual(marks.y);
});

/** Gives hole 1 a 페어웨이 tee result, as 상세's pad would. */
async function seedTee(page: Page) {
  await page.evaluate((key) => {
    const r = JSON.parse(localStorage.getItem(key)!);
    r.holes[0].tags = { driver: ['fairway'] };
    localStorage.setItem(key, JSON.stringify(r));
  }, STORAGE_KEY);
  await page.reload();
  await expect(page.locator('#entry')).toBeVisible();
}

test.describe('the badge and the hole line on small phones (v29)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('says two syllables at most, numbers past 더블 and 홀인원 alone, every word clear of the ring, with 큰 글씨 too', async ({ page }) => {
    await open(page);
    // The widest word of each kind: before the first tap, mid-hole, a hole in one, under and over par past the words,
    // two syllables, and a two-digit count.
    const cases: [string, Record<string, number>][] = [
      ['Par', { driver: 0, approach: 0, putts: 0 }],
      ['진행', { driver: 1, approach: 1, putts: 0 }],
      ['홀인원', { driver: 0, approach: 0, putts: 1 }],
      ['−3', { par: 5, driver: 1, approach: 0, putts: 1 }],
      ['더블', { driver: 1, approach: 3, putts: 2 }],
      ['+3', { driver: 1, approach: 4, putts: 2 }],
      ['+6', { driver: 1, approach: 7, putts: 2 }],
    ];
    for (const big of [false, true]) {
      await page.evaluate(([key, on]) => localStorage.setItem(key as string, JSON.stringify({ ...JSON.parse(localStorage.getItem(key as string) ?? '{}'), big: on })), [PREFS_KEY, big] as const);
      for (const [word, hole] of cases) {
        await seedHoles(page, { 0: { par: 4, ...hole } }, 0);
        await expect(page.locator('#hole-name')).toHaveText(word);
        await atRest(page);
        // The word's box, corners included, keeps half a pixel inside the white ring's inner edge.
        const clear = await page.evaluate(() => {
          const badge = document.getElementById('badge')!;
          const b = badge.getBoundingClientRect();
          const w = document.getElementById('hole-name')!.getBoundingClientRect();
          const r = b.width / 2 - parseFloat(getComputedStyle(badge).borderTopWidth);
          const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
          return r - Math.max(...[[w.left, w.top], [w.right, w.top], [w.left, w.bottom], [w.right, w.bottom]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
        });
        expect(clear, `${word}${big ? ' with 큰 글씨' : ''} clear of the ring`).toBeGreaterThanOrEqual(0.5);
        if (word === '홀인원') {
          // The word is the number: it shows alone, on the badge's centre line, and is read in full.
          await expect(page.locator('#bmark')).toBeHidden();
          expect(Math.abs(midY(await rect(page, '#hole-name')) - midY(await rect(page, '#badge')))).toBeLessThanOrEqual(1);
          await expect(page.locator('#badge')).toHaveAttribute('aria-label', '이 홀 1타 홀인원');
        } else {
          await expect(page.locator('#bmark')).toBeVisible();
        }
        if (word === '진행') await expect(page.locator('#badge')).toHaveAttribute('aria-label', '이 홀 2타 진행 중');
      }
    }
  });
});

test('375×553 상세 never cuts the line under the hole number with …: the length steps aside instead (v29)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 553 });
  await open(page);
  await detailMode(page);
  for (let index = 0; index < 18; index += 1) {
    await pickHole(page, index);
    const fits = await page.locator('#hole-sub').evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().width <= el.getBoundingClientRect().width + 0.5;
    });
    expect(fits, `hole ${index + 1}: ${await page.locator('#hole-sub').textContent()}`).toBe(true);
  }
});

/* ---------- v30: one design system (opaque surfaces, one rule for what is chosen, three radii, three shadows, six sizes) ---------- */

/** The audit's mid-round state on Everis (seven holes, hole 7 in progress) and three past rounds, as the v28–v30 screenshots use. */
async function seedAudit(page: Page) {
  await page.evaluate(([roundKey, historyKey, prefsKey]) => {
    const PARS = [4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 3, 4, 4, 5, 5, 3, 4, 4];
    const course = { id: 'everis', name: '에버리스 골프리조트', front: '새별', back: '레이크' };
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const round = (date: string, scores: Record<string, unknown>[], current: number) => {
      const holes: Record<string, unknown>[] = PARS.map((par) => ({ par, driver: 0, approach: 0, putts: 0, ob: 0, hazard: 0, mulligan: 0, bunker: 0 }));
      scores.forEach((h, i) => (holes[i] = { ...holes[i], ...h }));
      return { version: 1, date, current, holes, lastEdited: Date.now(), course } as Record<string, unknown>;
    };
    const today = new Date();
    const mid = round(iso(today), [
      { driver: 1, approach: 2, putts: 2, tags: { driver: ['fairway'] } },
      { driver: 1, approach: 2, putts: 1, short: 1, tags: { approach: ['green', 'close'] } },
      { driver: 1, approach: 3, putts: 2, ob: 1 },
      { driver: 1, approach: 0, putts: 2 },
      { driver: 2, approach: 1, putts: 3, ob: 1, short: 0 },
      { driver: 1, approach: 2, putts: 2 },
      { driver: 1, approach: 1, putts: 0, short: 0 },
    ], 6);
    const past = [0, 1, 2].map((k) => {
      const d = new Date(today.getTime() - (k + 3) * 86400000);
      const r = round(iso(d), PARS.map((par, i) => ({ driver: 1, approach: Math.max(0, par - 3) + ((i + k) % 3 === 0 ? 1 : 0), putts: (i + k) % 4 === 0 ? 3 : 2 })), 17);
      r.closed = true;
      return { id: `past-${k}`, endedAt: d.getTime() + 3600000, round: r };
    });
    localStorage.setItem(roundKey, JSON.stringify(mid));
    localStorage.setItem(historyKey, JSON.stringify(past));
    localStorage.setItem(prefsKey, JSON.stringify({ course: 'everis', front: 'saebyul', back: 'lake', coach: true, split: true, home: true }));
  }, [STORAGE_KEY, HISTORY_KEY, PREFS_KEY] as const);
  await page.reload();
  await expect(page.locator('#entry')).toBeVisible();
}

/**
 * What one screen shows, by the system's measures (the same function measured v29 for the v30 note): background
 * colours as sRGB bytes (one colour written two ways counts once; anything see-through is listed), radii per corner,
 * shadows by shape, type sizes of text, and what wears the accent. An element wholly under an open modal dialog and
 * not in it is covered: the full-screen picker hides 기록 entirely.
 */
function styleInventory() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const bytes = (c: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  };
  const probe = document.createElement('i');
  probe.style.background = 'var(--action)';
  document.body.append(probe);
  const accentKey = bytes(getComputedStyle(probe).backgroundColor).join(' ');
  probe.remove();
  const modal = [...document.querySelectorAll('dialog[open]')].find((d) => d.matches(':modal'));
  const cover = modal?.getBoundingClientRect();
  const seen = { background: new Map<string, string[]>(), radius: new Map<string, string[]>(), shadow: new Map<string, string[]>(), fontSize: new Map<string, string[]>() };
  const add = (m: Map<string, string[]>, k: string, d: string) => m.set(k, [...(m.get(k) ?? []), d]);
  const desc = (el: Element) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : '');
  const translucent: string[] = [];
  const accent: string[] = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    if (el.closest('[hidden], .sr-only, svg, dialog:not([open])')) continue;
    if (modal && cover && !modal.contains(el) && r.left >= cover.left - 0.5 && r.right <= cover.right + 0.5 && r.top >= cover.top - 0.5 && r.bottom <= cover.bottom + 0.5) continue;
    const d = desc(el);
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) add(seen.fontSize, cs.fontSize, d);
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
      const [r8, g8, b8, a8] = bytes(cs.backgroundColor);
      if (a8 > 0) {
        add(seen.background, `rgb(${r8} ${g8} ${b8}${a8 < 255 ? ` / ${(a8 / 255).toFixed(2)}` : ''})`, d);
        if (a8 < 255) translucent.push(d);
        if (`${r8} ${g8} ${b8} ${a8}` === accentKey) accent.push(d);
      }
    }
    for (const corner of [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]) {
      if (corner !== '0px') add(seen.radius, corner, d);
    }
    if (cs.boxShadow !== 'none') add(seen.shadow, cs.boxShadow.replace(/(rgba?|color|oklab|oklch|lab|lch|hsla?)\([^)]*\)/g, 'c'), d);
  }
  const list = (m: Map<string, string[]>) => [...m.entries()].map(([v, l]) => `${v} (${[...new Set(l)].slice(0, 3).join(' ')})`);
  return {
    background: list(seen.background), radius: list(seen.radius), shadow: list(seen.shadow), fontSize: list(seen.fontSize),
    translucent: [...new Set(translucent)], accent: [...new Set(accent)],
  };
}

/** The audit's screens in its order, each reached from the one before. */
const SYSTEM_SCREENS: [string, (page: Page) => Promise<unknown>][] = [
  ['코스 선택', async (page) => { await page.goto('/'); await expect(page.locator('#picker')).toBeVisible(); }],
  ['기록 기본', (page) => seedAudit(page)],
  ['기록 상세', (page) => page.getByRole('button', { name: '상세', exact: true }).click()],
  ['어프로치 패널', (page) => page.locator('#lbl-short').click()],
  ['홀 목록', async (page) => {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '기본', exact: true }).click();
    await page.locator('#hole-btn').click();
  }],
  ['메뉴', async (page) => { await page.keyboard.press('Escape'); await page.getByRole('button', { name: '메뉴' }).first().click(); }],
  ['스코어카드', async (page) => { await page.locator('#menu-close').click(); await tab(page, '스코어카드').click(); }],
  ['분석', (page) => page.getByRole('radio', { name: '분석', exact: true }).click()],
  ['분석 끝', (page) => page.locator('#card-view').evaluate((el) => el.scrollTo(0, el.scrollHeight))],
  ['요약', async (page) => {
    await page.locator('#finish-round').click();
    await page.getByRole('button', { name: '그대로 마치기' }).click();
    await expect(page.locator('#summary')).toBeVisible();
  }],
  ['지난 라운드', async (page) => { await page.locator('#sum-close').click(); await tab(page, '지난 라운드').click(); }],
];
/** The primary action, the one thing on a screen that wears the accent. */
const PRIMARY = ['#go-next', '#picker-start', '#sum-archive', '#finish-round', '#now-continue'];

for (const [width, height] of [[390, 844], [375, 553]] as const) {
  test.describe(`one design system on a ${width}×${height} phone (v30)`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('every screen keeps to six opaque backgrounds, three radii, three shadows and five type sizes, and the accent marks only the primary action', async ({ page }) => {
      const over: string[] = [];
      for (const [name, go] of SYSTEM_SCREENS) {
        await go(page);
        await settled(page);
        const found = await page.evaluate(styleInventory);
        const limit = (what: string, values: string[], max: number) => {
          if (values.length > max) over.push(`${name}: ${values.length} ${what} (≤ ${max}): ${values.join(' | ')}`);
        };
        limit('backgrounds', found.background, 6);
        limit('radii', found.radius, 3);
        limit('shadows', found.shadow, 3);
        limit('type sizes', found.fontSize, 5);
        if (found.translucent.length) over.push(`${name}: see-through ${found.translucent.join(' ')}`);
        const stray = found.accent.filter((d) => !PRIMARY.some((id) => d.includes(id)));
        if (stray.length) over.push(`${name}: the accent on ${stray.join(' ')}`);
      }
      expect(over).toEqual([]);
    });
  });
}

test('marks whatever is chosen one way: turf with white letters, no ring; on the dark picker inverted, white with turf letters (v30)', async ({ page }) => {
  const chosen: string[] = [];
  const check = async (selector: string, onDark = false) => {
    const el = page.locator(selector).first();
    await expect(el, selector).toBeVisible();
    // Read at rest: chips and shot tabs ease their colour in.
    await settled(page);
    const look = await el.evaluate((node) => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color, ring: getComputedStyle(node).boxShadow }));
    const [fill, letters] = onDark ? [white, turf] : [turf, white];
    chosen.push(`${selector}: ${look.background === fill && look.color === letters && look.ring === 'none' ? 'ok' : JSON.stringify(look)}`);
  };
  await page.goto('/');
  await expect(page.locator('#picker')).toBeVisible();
  const turf = await token(page, '--turf');
  const white = await token(page, '--on-dark');
  // The region chips sit on the dark rough: the chosen one is the brightest there, its neighbours quiet.
  await check(".picker .chip[aria-pressed='true']", true);
  expect(await page.locator(".picker .chip[aria-pressed='false']").first().evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(white);
  for (const selector of [".pk-len button[aria-pressed='true']", ".nine-pick button[aria-checked='true']", ".picker-list .course[aria-pressed='true']"]) await check(selector);
  await page.getByRole('button', { name: '이 코스로 시작' }).click();
  await check(".mode[aria-pressed='true']");
  await check("#tab-entry .ti");
  await page.getByRole('button', { name: '상세', exact: true }).click();
  await page.locator('#split-tip').click();
  await page.getByRole('button', { name: '페어웨이' }).click();
  await check(".dir[aria-pressed='true']");
  await page.locator(".tchip[data-tee='long']").click();
  await check(".tchip[aria-pressed='true']");
  await longPress(page, 'driver');
  await check(".np-row button[aria-pressed='true']");
  await page.keyboard.press('Escape');
  // A second drive, so the panel shows its shot tabs; the first, the 페어웨이 one, chosen.
  await tap(page, 'driver');
  await page.locator('#lbl-driver').click();
  await page.locator('.sp-shots button').first().click();
  await check(".sp-shots button[aria-pressed='true']");
  await check(".sp-chip[aria-pressed='true']");
  await page.keyboard.press('Escape');
  await showCard(page);
  await check("#sc-pick-card[aria-checked='true']");
  expect(chosen.filter((line) => !line.endsWith(': ok'))).toEqual([]);
  // The tab's own letters turn white with its pill.
  expect(await page.locator('#tab-card').evaluate((el) => getComputedStyle(el).color)).toBe(white);
});

test('paints each count over both halves of its capsule, whole, in 기본 and 상세 (v30: the halves are opaque now)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await tap(page, 'driver');
  // Hit-testing follows paint order: with the row made hittable for a moment, the digit's lower part must be the
  // topmost thing there, not the − half (before v30 the half's tint was see-through and painted over it unnoticed).
  const onTop = (key: string) => page.evaluate((k) => {
    const count = document.getElementById(`count-${k}`)!;
    const row = count.parentElement!;
    row.style.pointerEvents = 'auto';
    const r = count.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2);
    row.style.pointerEvents = '';
    return hit === count || hit === row ? 'count' : `${hit?.tagName.toLowerCase()}.${[...(hit?.classList ?? [])].join('.')}`;
  }, key);
  for (const key of KEYS.기본) expect(await onTop(key), `기본 ${key}`).toBe('count');
  await page.getByRole('button', { name: '상세', exact: true }).click();
  await page.locator('#split-tip').click();
  await settled(page);
  for (const key of KEYS.상세) expect(await onTop(key), `상세 ${key}`).toBe('count');
});

/* ---------- v32: one bar, one frame, one focal point per screen (정리 4단계: 구조) ---------- */

/** The bar, left to right (v32): the three views, then 메뉴. No view carries a menu button of its own, and the way home
 * is at the top left. */
const BAR = ['#tab-card', '#tab-entry', '#tab-hist', '#bar-menu'];
const BAR_LABELS = ['스코어카드', '기록', '지난 라운드', '메뉴'];

/** The first ancestor that clips `selector` (overflow other than visible) and is smaller than it, or null. */
const clippedBy = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const c = a.getBoundingClientRect();
    if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) return `${a.tagName.toLowerCase()}.${[...a.classList].join('.')}`;
  }
  return null;
});

/**
 * Where the ink sits inside a round badge: how far its first and last drawn rows are from the disc's top and bottom edge,
 * in CSS px, read from a screenshot of the disc (its own colour taken left of the middle, its 3px rim left out).
 */
async function inkIn(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!;
  // Callers measure at rest, and the badge holds no caret: nothing for the screenshot to change.
  const png = await page.screenshot({ clip: box, caret: 'initial' });
  return page.evaluate(async ([src, width]) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    const scale = img.width / width;
    const at = (x: number, y: number) => {
      const i = (y * img.width + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const ground = at(Math.round(img.width * 0.2), Math.round(img.height / 2));
    const radius = img.width / 2;
    let top = Infinity;
    let bottom = -Infinity;
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        if (Math.hypot(x + 0.5 - radius, y + 0.5 - radius) > radius - 3 * scale) continue;
        const p = at(x, y);
        if (Math.abs(p[0] - ground[0]) + Math.abs(p[1] - ground[1]) + Math.abs(p[2] - ground[2]) > 120) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    return { above: top / scale, below: (img.height - 1 - bottom) / scale };
  }, [`data:image/png;base64,${png.toString('base64')}`, box.width] as const);
}

async function setBig(page: Page, on: boolean) {
  await page.evaluate(([key, big]) => localStorage.setItem(key as string, JSON.stringify({ ...JSON.parse(localStorage.getItem(key as string) ?? '{}'), big })), [PREFS_KEY, on] as const);
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
}

for (const [width, height] of [[360, 640], [375, 553], [390, 844]] as const) {
  test.describe(`one bar and one frame on a ${width}×${height} phone (v32)`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('one bar is the whole navigation: 스코어카드, 기록, 지난 라운드 and 메뉴 in a row of equal columns', async ({ page }) => {
      await open(page);
      await atRest(page);
      await expect(page.locator('.app [data-menu]')).toHaveCount(0);
      await expect(page.locator('[data-menu]')).toHaveCount(1);
      await expect(page.locator('#bar-menu')).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(page.getByRole('tab')).toHaveCount(3);
      // Only the app's own places: the way back to the site is not in the bar.
      await expect(page.locator('#views a')).toHaveCount(0);
      const bar = await rect(page, '#views');
      const items = await Promise.all(BAR.map((s) => rect(page, s)));
      for (const [i, item] of items.entries()) {
        await expect(page.locator(BAR[i])).toHaveText(BAR_LABELS[i]);
        expect(Math.min(item.width, item.height), `${BAR_LABELS[i]}: a 48px target`).toBeGreaterThanOrEqual(48);
        expectAligned(midY(item), midY(bar), `${BAR_LABELS[i]} on the bar's line`);
        expectAligned(item.width, items[0].width, `${BAR_LABELS[i]} as wide as 스코어카드`);
        if (i) expect(item.x, `${BAR_LABELS[i]} after ${BAR_LABELS[i - 1]}`).toBeGreaterThanOrEqual(items[i - 1].x + items[i - 1].width - 0.5);
      }
      expectAligned(items[0].x - bar.x, bar.x + bar.width - (items[3].x + items[3].width), 'the row centred in the bar');
    });

    test('홈 is at the top left of every view: on the top bar’s line, a 48px target, clear of the title, quiet', async ({ page }) => {
      await open(page);
      await atRest(page);
      const line = midY(await rect(page, '#entry .switcher'));
      const home = page.locator('.home-link');
      await expect(home).toHaveCount(1);
      await expect(home).toHaveAttribute('href', '../../');
      for (const [name, title] of [['기록', '#entry .switcher'], ['스코어카드', '#card-view .sc-title'], ['지난 라운드', '#hist-view .sc-title']] as const) {
        await tab(page, name).tap();
        await settled(page);
        await expect(home, name).toBeVisible();
        const box = await rect(page, '.home-link');
        expectAligned(box.x, 16, `${name}: 홈 on the inset`);
        expectAligned(midY(box), line, `${name}: 홈 on the top bar's line`);
        expect(Math.min(box.width, box.height), `${name}: a 48px target`).toBeGreaterThanOrEqual(48);
        expect(box.x + box.width, `${name}: clear of the title`).toBeLessThanOrEqual((await rect(page, title)).x);
        // No fill of its own: a quiet way out, not a control of the round.
        expect(await home.evaluate((el) => getComputedStyle(el).backgroundColor), name).toBe('rgba(0, 0, 0, 0)');
      }
    });

    test('스코어카드 and 지난 라운드 sit in 기록’s frame: a deep header held at the top, its title on the switcher’s line, the page a paper sheet with round top corners', async ({ page }) => {
      await open(page);
      await seed(page, SEVEN_HOLES, 5);
      await seedHistory(page, [10, 12, 8]);
      await atRest(page);
      const line = midY(await rect(page, '#entry .switcher'));
      const [deep, paper, onDark] = [await token(page, '--deep'), await token(page, '--paper'), await token(page, '--on-dark')];
      for (const [name, view] of [['스코어카드', '#card-view'], ['지난 라운드', '#hist-view']] as const) {
        await tab(page, name).tap();
        await settled(page);
        expect(await page.locator(`${view} .sc-top`).evaluate((el) => getComputedStyle(el).backgroundColor), `${name}: the header`).toBe(deep);
        expect(await page.locator(`${view} .sc-title h2`).evaluate((el) => getComputedStyle(el).color), `${name}: the title`).toBe(onDark);
        // 스코어카드's title says which round, as 기록's says which hole; its view's name is on the tab and the switch.
        if (view === '#card-view') {
          await expect(page.locator('#sc-title-h')).toHaveText(/^\d{1,2}월 \d{1,2}일 라운드$/);
          await expect(page.locator('#sc-sub')).toHaveText('에버리스 골프리조트 새별·레이크');
        }
        const title = await rect(page, `${view} .sc-title`);
        expectAligned(midY(title), line, `${name}: title on the switcher's line`);
        expectAligned(midX(title), width / 2, `${name}: title centred`);
        const look = await page.locator(`${view} > .sc-body`).evaluate((el) => {
          const s = getComputedStyle(el);
          return { background: s.backgroundColor, left: s.borderTopLeftRadius, right: s.borderTopRightRadius };
        });
        expect(look, `${name}: the sheet`).toEqual({ background: paper, left: '24px', right: '24px' });
        const head = await rect(page, `${view} .sc-top`);
        const body = await rect(page, `${view} > .sc-body`);
        expectAligned(body.y, head.y + head.height, `${name}: the sheet right under the header`);
        expectAligned(body.x, 0, `${name}: the sheet from the left edge`);
        expectAligned(body.width, width, `${name}: the sheet across the screen`);
        // Held at the top while the page scrolls under it.
        await page.locator(view).evaluate((el) => el.scrollTo(0, el.scrollHeight));
        await settled(page);
        expectAligned((await rect(page, `${view} .sc-title`)).y, title.y, `${name}: title held while scrolled`);
      }
      await tab(page, '스코어카드').tap();
      await page.locator('#card-view').evaluate((el) => el.scrollTo(0, 0));
      await settled(page);
      const edit = await rect(page, '#edit-par');
      expectAligned(edit.x + edit.width, width - 16, '파 수정 on the right inset');
      expectAligned(midY(edit), line, '파 수정 on the line');
      // A ghost on the deep header, so the round's score stays the loudest thing on the page.
      expect(await page.locator('#edit-par').evaluate((el) => ({ background: getComputedStyle(el).backgroundColor, shadow: getComputedStyle(el).boxShadow }))).toEqual({ background: 'rgba(0, 0, 0, 0)', shadow: 'none' });
    });

    test('the long-press coach mark shows whole over the capsules’ midline, no longer cut by the middle capsule', async ({ page }) => {
      await open(page);
      const coach = page.locator('#coach');
      await expect(coach).toBeVisible();
      await expect(coach).toHaveText('숫자를 길게 누르면 바로 골라요');
      await atRest(page);
      expect(await clippedBy(page, '#coach')).toBeNull();
      const box = await rect(page, '#coach');
      const clubs = await rect(page, '#clubs');
      expect(box.x).toBeGreaterThanOrEqual(clubs.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(clubs.x + clubs.width + 0.5);
      expectAligned(midY(box), midY(await rect(page, '.club-approach .pill')), 'on the capsules’ midline');
      expectAligned(midX(box), width / 2, 'centred');
    });

    test('빼기 holds its column: out of sight until there is a penalty to take off, then an arrow turning back, and nothing moves', async ({ page }) => {
      await open(page);
      /** The box as laid out, seen or not (an element out of sight has no box for Playwright). */
      const box = (selector: string) => page.locator(selector).first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      for (const mode of ['기본', '상세'] as const) {
        await page.getByRole('button', { name: mode, exact: true }).click();
        if (await page.locator('#split-tip').isVisible()) await page.locator('#split-tip').click();
        await atRest(page);
        const undo = page.locator('#pen-undo');
        await expect(undo, mode).toBeDisabled();
        await expect(undo, mode).toBeHidden();
        expect(await undo.evaluate((el) => getComputedStyle(el).visibility), mode).toBe('hidden');
        expectAligned(midX(await box('#pen-undo .u-ico')), midX(await rect(page, `.club-${KEYS[mode][1]} .pill`)), `${mode}: 빼기's place under ${KEYS[mode][1]}`);
        // As tall as a penalty, so holding its column costs the card nothing (상세's 빼기 was 2px taller than its stakes).
        expectAligned((await box('#pen-undo')).height, (await rect(page, '#stake-ob')).height, `${mode}: 빼기 as tall as OB`);
      }
      // The first penalty moves nothing: the card keeps its top and height.
      const before = await rect(page, '#sheet');
      await tap(page, 'ob');
      await expect(page.locator('#pen-undo')).toBeVisible();
      await expect(page.locator('#pen-undo')).toBeEnabled();
      await expect(page.locator('#pen-undo')).toHaveText('OB 빼기');
      await atRest(page);
      const after = await rect(page, '#sheet');
      expectAligned(after.y, before.y, '상세: card top after the first penalty');
      expectAligned(after.height, before.height, '상세: card height after the first penalty');
      // Not the capsule's −: 빼기 draws an arrow turning back, so the two in one column read as two actions.
      const glyph = (selector: string) => page.locator(selector).first().evaluate((svg) => svg.innerHTML.replace(/\s+/g, ' '));
      expect(await glyph('#pen-undo svg')).not.toBe(await glyph('.club-second .minus svg'));
    });
  });
}

test('메뉴 in the bar opens the menu from every view, says only what it is, and gives the focus back (v32)', async ({ page }) => {
  await open(page);
  for (const name of ['기록', '스코어카드', '지난 라운드'] as const) {
    await tab(page, name).click();
    await page.locator('#bar-menu').click();
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#menu .menu-head')).toHaveText('메뉴');
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu')).toBeHidden();
    await expect(page.locator('#bar-menu')).toBeFocused();
  }
});

test.describe('the bar at 360 in 큰 글씨 and with wider type (v32)', () => {
  // bypassCSP only to add the widening style.
  test.use({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, bypassCSP: true });

  test('each label stays whole inside its own column', async ({ page }) => {
    await open(page);
    const whole = async (where: string) => {
      await atRest(page);
      for (const [i, s] of BAR.entries()) {
        const item = await rect(page, s);
        const label = await rect(page, `${s} .tab-label`);
        expect(label.x, `${where}: ${BAR_LABELS[i]} left`).toBeGreaterThanOrEqual(item.x - 0.5);
        expect(label.x + label.width, `${where}: ${BAR_LABELS[i]} right`).toBeLessThanOrEqual(item.x + item.width + 0.5);
      }
    };
    await setBig(page, true);
    await expect(page.locator('body')).toHaveClass(/big/);
    await whole('큰 글씨');
    await setBig(page, false);
    await page.addStyleTag({ content: WIDER });
    await whole('wider type');
  });
});

test('the bar steps back while a panel is open over 기록, and comes back when it closes (v32)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const opacity = () => page.locator('#views .bar').evaluate((el) => Number(getComputedStyle(el).opacity));
  await atRest(page);
  expect(await opacity()).toBe(1);
  const panels: [string, () => Promise<unknown>][] = [
    ['클럽 패널', () => page.locator('#lbl-driver').click()],
    ['홀 목록', () => page.locator('#hole-btn').click()],
    ['숫자 고르기', () => longPress(page, 'driver')],
  ];
  for (const [what, show] of panels) {
    await show();
    await atRest(page);
    expect(await opacity(), what).toBeLessThanOrEqual(0.5);
    await page.keyboard.press('Escape');
    await atRest(page);
    expect(await opacity(), `${what} closed`).toBe(1);
  }
});

test('each capsule’s split is one line across its midline, edge to edge, 3:1 against both halves, broken by the count (v32)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const halves = [await token(page, '--fill'), await token(page, '--fill-2')];
  for (const mode of ['기본', '상세'] as const) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    if (await page.locator('#split-tip').isVisible()) await page.locator('#split-tip').click();
    await atRest(page);
    for (const key of KEYS[mode]) {
      const where = `${mode} ${key}`;
      const row = await rect(page, `.club-${key} .num-row`);
      const pill = await rect(page, `.club-${key} .pill`);
      // From the capsule's edge to the other, so it reads as the line between the halves, not as ticks by the number.
      expectAligned(row.x, pill.x, `${where}: line from the left edge`);
      expectAligned(row.x + row.width, pill.x + pill.width, `${where}: line to the right edge`);
      expectAligned(midY(row), midY(pill), `${where}: on the midline`);
      const line = await page.locator(`.club-${key} .num-row`).evaluate((el) => ({
        content: getComputedStyle(el, '::before').content, colour: getComputedStyle(el, '::before').backgroundColor, gap: parseFloat(getComputedStyle(el).columnGap),
      }));
      expect(line.content, where).not.toBe('none');
      for (const half of halves) expect(await contrastBetween(page, line.colour, half), `${where} on ${half}`).toBeGreaterThanOrEqual(3);
      expect(line.gap, `${where}: the count clear of the line`).toBeGreaterThanOrEqual(4);
    }
  }
});

test('분석 leads with its finding: the line saying where the strokes went is the pane’s largest text (v32)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await seedAudit(page);
  await showCard(page);
  await page.getByRole('radio', { name: '분석', exact: true }).click();
  await settled(page);
  await expect(page.locator('#lost-note')).toHaveText(/잃었어요\.$/);
  const size = (selector: string) => page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const finding = await size('#lost-note');
  const largest = await page.locator('#sc-analysis').evaluate((pane) => Math.max(...[...pane.querySelectorAll('*')]
    .filter((el) => el.id !== 'lost-note' && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && el.getClientRects().length)
    .map((el) => parseFloat(getComputedStyle(el).fontSize))));
  expect(finding).toBeGreaterThan(largest);
  expect(await page.locator('#lost-note').evaluate((el) => getComputedStyle(el).color)).toBe(await token(page, '--ink'));
});

test.describe('the score badge at 4x (v32)', () => {
  // Read from the pixels at 4x: at 1x and 2x a row of pixels is as coarse as the tolerance. bypassCSP only because
  // WebKit's screenshot adds a style of its own, which the page's CSP would refuse and report.
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 4, bypassCSP: true });

  test('the score badge is one disc: no ring round it, its number, mark and word centred on it, in 큰 글씨 too', async ({ page }) => {
    await open(page);
    const states: [string, Record<string, number>][] = [
      ['Par', {}], ['진행', { driver: 1, approach: 2 }], ['보기', { driver: 1, approach: 2, putts: 2 }], ['버디', { driver: 1, approach: 1, putts: 1 }],
    ];
    for (const big of [false, true]) {
      if (big) await setBig(page, true);
      for (const [word, hole] of states) {
        await seed(page, { 0: { driver: 0, approach: 0, putts: 0, ...hole } }, 0);
        await page.evaluate(() => document.fonts.ready);
        await atRest(page);
        await expect(page.locator('#hole-name')).toHaveText(word);
        expect(await page.locator('#badge').evaluate((el) => getComputedStyle(el).borderTopWidth), word).toBe('0px');
        const ink = await inkIn(page, '#badge');
        expect(Math.abs(ink.above - ink.below), `${big ? '큰 글씨 ' : ''}${word}: ${ink.above.toFixed(2)}px above, ${ink.below.toFixed(2)}px below`).toBeLessThanOrEqual(1);
      }
    }
  });
});

test.describe('a club panel on a 375×553 phone (v32)', () => {
  test.use({ viewport: { width: 375, height: 553 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('ends above 다음 홀 instead of covering its top', async ({ page }) => {
    await open(page);
    for (const [mode, key] of [['기본', 'approach'], ['상세', 'short']] as const) {
      await page.getByRole('button', { name: mode, exact: true }).tap();
      if (await page.locator('#split-tip').isVisible()) await page.locator('#split-tip').tap();
      await page.locator(`#lbl-${key}`).tap();
      await expect(page.locator('#shot-panel')).toBeVisible();
      await atRest(page);
      const panel = await rect(page, '#shot-panel');
      const go = await rect(page, '#go-next');
      expect(panel.y + panel.height, `${mode} ${key}`).toBeLessThanOrEqual(go.y - 8 + 0.5);
      expect(panel.y, `${mode} ${key}: on screen`).toBeGreaterThanOrEqual(0);
      await page.keyboard.press('Escape');
      await expect(page.locator('#shot-panel')).toBeHidden();
    }
  });
});

test('분석 and 요약 lead an odd count of tiles with the first across the card and pair the rest: no lone last tile, no gap (v32)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await seedAudit(page);
  await showCard(page);
  await page.getByRole('radio', { name: '분석', exact: true }).click();
  await settled(page);
  const paired = (grid: Span, tiles: Span[], where: string) => {
    expect(tiles.length % 2, `${where}: an odd number of tiles`).toBe(1);
    within1px(tiles[0].x, grid.x, `${where}: first tile from the left edge`);
    within1px(endOf(tiles[0]), endOf(grid), `${where}: first tile to the right edge`);
    for (const [i, t] of tiles.slice(1).entries()) {
      within1px(t.width, tiles[1].width, `${where}: tile ${i + 2} width`);
      // Pairs: each second tile of a pair ends on the right edge, so no row has a gap.
      if (i % 2 === 1) within1px(endOf(t), endOf(grid), `${where}: tile ${i + 2} on the right edge`);
    }
  };
  paired(await spanOf(page, '#analysis .metrics:not(.three)'), await spansOf(page, '#analysis .metrics:not(.three) > div'), '분석');
  await page.locator('#finish-round').click();
  await page.getByRole('button', { name: '그대로 마치기' }).click();
  await expect(page.locator('#summary')).toBeVisible();
  await settled(page);
  paired(await spanOf(page, '#sum-stats'), await spansOf(page, '#sum-stats > div'), '요약');
});

test('지난 라운드’s line marks each round with a dot and names its first and last days under its ends (v32)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await seedHistory(page, [10, 12, 8]);
  await tab(page, '지난 라운드').click();
  await settled(page);
  const dots = await spansOf(page, '#history-trends .spark-dot');
  expect(dots).toHaveLength(3);
  const line = await spanOf(page, '#history-trends .spark-line');
  within1px(midOf(dots[0]), line.x, 'first dot on the left end');
  within1px(midOf(dots[2]), endOf(line), 'last dot on the right end');
  await expect(page.locator('#history-trends .spark-dates span')).toHaveText(['10월 1일', '10월 3일']);
  const dates = await spansOf(page, '#history-trends .spark-dates span');
  within1px(dates[0].x, line.x, 'first day under the left end');
  within1px(endOf(dates[1]), endOf(line), 'last day under the right end');
  // Four strokes between the rounds take under half the line's height: the scale spans ten strokes at least, so a stroke
  // or two no longer reads as a steep climb.
  const ys = dots.map((d) => d.y);
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(line.height / 2);
});

test('labels read at 7:1 in sunlight: the quiet ink on white, paper and the light tint, the bar’s labels on deep (v32)', async ({ page }) => {
  await open(page);
  const muted = await token(page, '--muted');
  for (const ground of ['--white', '--paper', '--fill']) expect(await contrastBetween(page, muted, await token(page, ground)), ground).toBeGreaterThanOrEqual(7);
  expect(await contrastBetween(page, await token(page, '--tab-ink'), await token(page, '--deep')), 'bar labels').toBeGreaterThanOrEqual(7);
});

test('큰 글씨 at 360: the hole button hugs "5번" as it does at the normal size (v32)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await open(page);
  const gap = async () => {
    await seed(page, {}, 4);
    await page.evaluate(() => document.fonts.ready);
    await atRest(page);
    await expect(page.locator('#hole-n')).toHaveText('5');
    return page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('#hole-title')!);
      return document.querySelector('.hole-chev')!.getBoundingClientRect().left - range.getBoundingClientRect().right;
    });
  };
  const normal = await gap();
  await setBig(page, true);
  const big = await gap();
  expect(big - normal, `큰 글씨 ${big.toFixed(1)}px against ${normal.toFixed(1)}px`).toBeLessThanOrEqual(1);
});
