import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fixtures = join(process.cwd(), 'tests/fixtures/generated');

test.beforeAll(() => {
  execFileSync(process.execPath, ['tests/generate-fixtures.mjs'], { stdio: 'inherit' });
});

async function open(page: Page, name: string) {
  if (page.url() === 'about:blank') await page.goto('/');
  await page.locator('#file-input').setInputFiles(join(fixtures, name));
  await expect(page.locator('#viewer')).toBeVisible();
  await expect(page.locator('#grid tbody tr').first()).toBeVisible();
}

const firstCell = (page: Page) => page.locator('#grid tbody tr').first().locator('td').first();

test('opens each format without network or storage', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || request.method() !== 'GET' || request.postData()) requests.push(request.url());
  });

  for (const [name, first] of [
    ['parquet-SNAPPY.parquet', '0'],
    ['arrow-file.arrow', '0'],
    ['arrow-stream.arrows', '0'],
    ['avro-all-types-snappy.avro', '0'],
  ]) {
    await open(page, name);
    await expect(page.locator('#grid tbody tr')).toHaveCount(100);
    await expect(firstCell(page)).toHaveText(first);
    await expect(page.locator('#file-name')).toHaveText(name);
  }

  expect(requests).toEqual([]);
  expect(await page.evaluate(() => ({
    localStorage: localStorage.length,
    sessionStorage: sessionStorage.length,
    cookies: document.cookie,
  }))).toEqual({ localStorage: 0, sessionStorage: 0, cookies: '' });
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
});

test('pages forward, back and to a row', async ({ page }) => {
  await open(page, 'parquet-SNAPPY.parquet');
  await expect(page.locator('#page-range')).toContainText('1–100 / 1,000');
  await expect(page.locator('#prev')).toBeDisabled();
  await page.locator('#next').click();
  await expect(page.locator('#page-range')).toContainText('101–200');
  await expect(firstCell(page)).toHaveText('100');
  await page.locator('#prev').click();
  await expect(firstCell(page)).toHaveText('0');
  await page.locator('#goto').fill('500');
  await page.locator('#goto').press('Enter');
  await expect(firstCell(page)).toHaveText('499');
  await page.locator('#goto').fill('951');
  await page.locator('#goto').press('Enter');
  await expect(page.locator('#grid tbody tr')).toHaveCount(50);
  await expect(page.locator('#next')).toBeDisabled();
});

test('unchecking a column removes it from the grid', async ({ page }) => {
  await open(page, 'parquet-SNAPPY.parquet');
  await expect(page.locator('#grid th[data-column="big"]')).toBeVisible();
  await page.locator('#schema input[data-column="big"]').uncheck();
  await expect(page.locator('#grid th[data-column="big"]')).toHaveCount(0);
  await expect(page.locator('#grid th[data-column="id"]')).toBeVisible();
  await page.locator('#select-none').click();
  await expect(page.locator('#grid th')).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('컬럼');
  await page.locator('#select-all').click();
  await expect(page.locator('#grid th[data-column="big"]')).toBeVisible();
});

test('schema search filters the column list', async ({ page }) => {
  await open(page, 'parquet-SNAPPY.parquet');
  await page.locator('#schema-search').fill('ts');
  await expect(page.locator('#schema input[data-column="ts"]')).toBeVisible();
  await expect(page.locator('#schema input[data-column="ts_ms"]')).toBeVisible();
  await expect(page.locator('#schema input[data-column="big"]')).toBeHidden();
});

test('nested and NULL cells look distinct and open a popover with full JSON', async ({ page }) => {
  await open(page, 'parquet-SNAPPY.parquet');
  const row1 = page.locator('#grid tbody tr').nth(1);
  await expect(row1.locator('td[data-kind="null"]').first()).toHaveText('NULL');
  await row1.locator('td[data-kind="nested"]').first().click();
  await expect(page.locator('#cell-popover')).toBeVisible();
  await expect(page.locator('#cell-popover pre')).toContainText('"a": 1');
  await page.keyboard.press('Escape');
  await expect(page.locator('#cell-popover')).toBeHidden();
});

test('metadata drawer shows row groups for parquet', async ({ page }) => {
  await open(page, 'parquet-GZIP.parquet');
  await page.locator('#open-meta').click();
  await expect(page.locator('#meta-panel')).toBeVisible();
  await expect(page.locator('#meta-panel')).toContainText('row group');
  await expect(page.locator('#meta-panel')).toContainText('tabula fixtures');
  await expect(page.locator('#meta-panel')).toContainText('GZIP');
});

test('big parquet opens reading a small fraction of the file', async ({ page }) => {
  await open(page, 'parquet-big.parquet');
  await expect(page.locator('#page-range')).toContainText('/ 1,000,000');
  const size = statSync(join(fixtures, 'parquet-big.parquet')).size;
  const read = Number(await page.locator('#bytes-read').getAttribute('data-bytes'));
  expect(read).toBeGreaterThan(0);
  expect(read).toBeLessThan(size / 10);
});

test('count rows for avro, and closing while counting does not leak into the next file', async ({ page }) => {
  await open(page, 'avro-all-types-null.avro');
  await expect(page.locator('#page-range')).toContainText('/ ?');
  await page.locator('#count-rows').click();
  await expect(page.locator('#page-range')).toContainText('/ 1,000');
  await expect(page.locator('#count-rows')).toBeHidden();

  await open(page, 'avro-big.avro');
  await page.locator('#count-rows').click();
  await page.locator('#close-file').click();
  await expect(page.locator('#welcome')).toBeVisible();
  await open(page, 'parquet-SNAPPY.parquet');
  await page.waitForTimeout(500);
  await expect(page.locator('#page-range')).toContainText('/ 1,000');
  await expect(page.locator('#file-name')).toHaveText('parquet-SNAPPY.parquet');
});

test('going to a row past the end of an avro file shows the last page and the real total', async ({ page }) => {
  await open(page, 'avro-all-types-null.avro');
  await page.locator('#goto').fill('5000');
  await page.locator('#goto').press('Enter');
  await expect(page.locator('#page-range')).toHaveText('901–1,000 / 1,000');
  await expect(page.locator('#grid tbody tr')).toHaveCount(100);
});

test('closing a file while it is still opening keeps the start screen', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(join(fixtures, 'parquet-big.parquet'));
  await page.evaluate(() => document.getElementById('close-file')!.click());
  await page.waitForTimeout(1500);
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#viewer')).toBeHidden();
});

test('choosing another file while one is opening shows the one chosen last', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(join(fixtures, 'parquet-big.parquet'));
  await page.locator('#file-input').setInputFiles(join(fixtures, 'arrow-file.arrow'));
  await page.waitForTimeout(1500);
  await expect(page.locator('#file-name')).toHaveText('arrow-file.arrow');
  await expect(page.locator('#page-range')).toContainText('/ ?');
});

test('malformed and unsupported files show recoverable errors', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(join(fixtures, 'unsupported.txt'));
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText('Parquet');

  await open(page, 'truncated.avro');
  await page.locator('#goto').fill('190000');
  await page.locator('#goto').press('Enter');
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText('손상');

  await open(page, 'arrow-file.arrow');
  await expect(page.locator('#error-message')).toBeHidden();
});

test('sample opens', async ({ page }) => {
  await page.goto('/');
  await page.locator('#try-sample').click();
  await expect(page.locator('#viewer')).toBeVisible();
  await expect(page.locator('#page-range')).toContainText('/ 5,000');
  await expect(page.locator('#grid th[data-column="event_id"]')).toBeVisible();
});

test('export json writes full values with int64 as strings', async ({ page }) => {
  await open(page, 'parquet-SNAPPY.parquet');
  const download = page.waitForEvent('download');
  await page.locator('#export-json').click();
  const file = await (await download).path();
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  expect(rows).toHaveLength(100);
  expect(rows[0].big).toBe('9007199254740993');
  expect(rows[0].name).toBe('');
  expect(rows[1].name).toBeNull();
  expect(rows[1].st).toEqual({ a: 1, b: null });
  expect((await download).suggestedFilename()).toBe('parquet-SNAPPY-rows-1-100.json');
});

test('export csv quotes values', async ({ page }) => {
  await open(page, 'parquet-SNAPPY.parquet');
  const download = page.waitForEvent('download');
  await page.locator('#export-csv').click();
  const text = readFileSync(await (await download).path(), 'utf8');
  const lines = text.trim().split('\n');
  expect(lines[0]).toBe('id,big,f64,flag,name,amount,day,ts,ts_ms,tags,st');
  expect(lines).toHaveLength(101);
  expect(lines[3]).toContain('"[""a"",""bbb""]"');
});

for (const width of [360, 1280]) {
  test(`home link visible and no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await expect(page.locator('a[href="../../"]')).toBeVisible();
    expect(await noScroll()).toBe(true);
    await open(page, 'parquet-SNAPPY.parquet');
    await expect(page.locator('a[href="../../"]')).toBeVisible();
    expect(await noScroll()).toBe(true);
  });
}
