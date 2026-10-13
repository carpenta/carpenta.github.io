import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const fixtures = join(process.cwd(), 'tests/fixtures/generated');

test.beforeAll(() => {
  execFileSync(process.execPath, ['tests/generate-fixtures.mjs'], { stdio: 'inherit' });
});

test('opens every supported format without uploading document bytes', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || request.method() !== 'GET' || request.postData()) requests.push(request.url());
  });

  await openFixture(page, 'folio-pptx.pptx', 'Folio PPTX Slide 1');
  await close(page);
  await openFixture(page, 'folio-docx.docx', 'Folio DOCX Fixture');
  await close(page);
  await openFixture(page, 'folio-xlsx.xlsx', 'Folio XLSX Fixture');
  await close(page);
  await openFixture(page, 'folio-hwpx.hwpx', 'Folio HWPX Fixture');
  await close(page);
  await openFixture(page, 'folio-hwp.hwp', 'Folio HWP Fixture');

  expect(requests).toEqual([]);
  expect(await page.evaluate(() => ({
    localStorage: localStorage.length,
    sessionStorage: sessionStorage.length,
    cookies: document.cookie,
  }))).toEqual({ localStorage: 0, sessionStorage: 0, cookies: '' });
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
});

test('navigates multi-page documents and resets cleanly on close and reopen', async ({ page }) => {
  await openFixture(page, 'folio-pptx.pptx', 'Folio PPTX Slide 1');
  await expect(page.locator('#page-select option')).toHaveCount(2);
  await page.locator('#next-page').click();
  await expectFrameText(page, 'Folio PPTX Slide 2');

  await close(page);
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#viewer')).toBeHidden();

  await openFixture(page, 'folio-xlsx.xlsx', 'Folio XLSX Fixture');
  await page.locator('#page-select').selectOption({ label: 'Second' });
  await expectFrameText(page, 'Folio XLSX Sheet 2');
});

test('reports unsupported and malformed files as recoverable errors', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(join(fixtures, 'unsupported.txt'));
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText(/지원|PPTX|DOCX/);

  await page.locator('#file-input').setInputFiles(join(fixtures, 'malformed.pptx'));
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(page.locator('#status')).toContainText(/열 수|손상|찾을 수|valid|zip/i);
});

test('does not follow external document relationships', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('example.com')) external.push(request.url());
  });

  await openFixture(page, 'folio-external.pptx', 'Folio External Relation');
  await page.waitForTimeout(500);
  expect(external).toEqual([]);
});

test('renders the viewer on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page, 'folio-docx.docx', 'Folio DOCX Fixture');
  await expect(page.locator('#viewer')).toBeVisible();
  await expect(page.locator('#document-frame')).toBeVisible();
  const box = await page.locator('#document-frame').boundingBox();
  expect(box?.width).toBeGreaterThan(250);
});

async function openFixture(page: Page, fileName: string, expectedText: string) {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(join(fixtures, fileName));
  await expect(page.locator('#viewer')).toBeVisible();
  await expect(page.locator('#document-frame')).toBeVisible();
  await expectFrameText(page, expectedText);
}

async function expectFrameText(page: Page, expectedText: string) {
  const frame = page.frameLocator('iframe#document-frame[title="문서 미리보기"]');
  await expect.poll(async () => (await frame.locator('body').textContent())?.replace(/\s/g, '')).toContain(expectedText.replace(/\s/g, ''));
}

async function close(page: Page) {
  await page.locator('#close-file').click();
  await expect(page.locator('#welcome')).toBeVisible();
}


test('sample, zoom, close and reload keep no document history', async ({ page }) => {
  await page.goto('/');
  await page.locator('#try-sample').click();
  await expectFrameText(page, '로컬에서 문서 열기');
  const before = await page.locator('#zoom-level').textContent();
  await page.locator('#zoom-in').click();
  await expect(page.locator('#zoom-level')).not.toHaveText(before!);
  await page.reload();
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#viewer')).toBeHidden();
  await expect(page.locator('#file-name')).toBeEmpty();
});

test('XLSX drag selects a cell rectangle and copies tab-separated values', async ({ page }) => {
  await openFixture(page, 'folio-xlsx.xlsx', 'Folio XLSX Fixture');
  const sheet = page.frameLocator('#document-frame');
  const start = sheet.locator('td[data-row="0"][data-col="0"]');
  const end = sheet.locator('td[data-row="1"][data-col="1"]');
  const a = (await start.boundingBox())!, b = (await end.boundingBox())!;
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);
  await page.mouse.down();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});
  await page.mouse.up();
  await expect(sheet.locator('.cell-selected')).toHaveCount(4);
  await expect(sheet.locator('.selection-info')).toContainText('A1:B2');
  const copied = await sheet.locator('table').evaluate(table => {
    const clipboard = new DataTransfer();
    table.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:clipboard}));
    return clipboard.getData('text/plain');
  });
  expect(copied).toBe('Title\tStatus\nFolio XLSX Fixture\tready');
  await sheet.locator('table').press('Shift+ArrowRight');
  await expect(sheet.locator('.selection-info')).toContainText('A1:C2');
  await expect(sheet.locator('.cell-selected')).toHaveCount(6);
  await expect(page.locator('#document-frame')).toHaveAttribute('sandbox','allow-same-origin');
});

test('XLSX preserves colors, fonts, borders, alignment, dimensions and number formatting', async ({page}) => {
  await openFixture(page,'folio-styled.xlsx','Styled header');
  const sheet=page.frameLocator('#document-frame');
  const cell=sheet.locator('td[data-row="0"][data-col="0"]');
  await expect(cell).toHaveCSS('background-color','rgb(36, 87, 70)');
  await expect(cell).toHaveCSS('color','rgb(255, 255, 255)');
  await expect(cell).toHaveCSS('font-weight','700');
  await expect(cell).toHaveCSS('font-style','italic');
  await expect(cell).toHaveCSS('text-align','center');
  await expect(cell).toHaveCSS('border-bottom-style','double');
  await expect(sheet.locator('td[data-row="1"][data-col="0"]')).toHaveText('13%');
  await expect(sheet.locator('td[data-row="1"][data-col="1"]')).toHaveCSS('white-space','pre-wrap');
  const themeColor=await sheet.locator('td[data-row="0"][data-col="1"]').evaluate(el=>getComputedStyle(el).backgroundColor);
  expect(themeColor).not.toBe('rgba(0, 0, 0, 0)');
  await expect(sheet.locator('td[data-row="0"][data-col="1"]')).toHaveCSS('color','rgb(0, 0, 0)');
  const height=await cell.evaluate(el=>getComputedStyle(el.parentElement!).height);
  expect(parseFloat(height)).toBeGreaterThanOrEqual(48);
  const width=await cell.evaluate(el=>el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(150);
});

test('XLSX recalculates formulas locally and warns for unsupported cached results', async ({page}) => {
  const outbound:string[]=[];
  page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4173'))outbound.push(r.url());});
  await openFixture(page,'folio-formulas.xlsx','수식 계산 테스트');
  const sheet=page.frameLocator('#document-frame');
  await expect(sheet.locator('td[data-row="1"][data-col="1"]')).toHaveText('6');
  await expect(sheet.locator('td[data-row="2"][data-col="1"]')).toHaveText('10');
  await expect(sheet.locator('td[data-row="3"][data-col="1"]')).toHaveText('25.0%');
  await expect(sheet.locator('td[data-row="4"][data-col="1"]')).toHaveText('123');
  await expect(page.locator('#compatibility')).toContainText('재계산하지 못했습니다');
  expect(outbound).toEqual([]);
});

for (const [format, text, count] of [
  ['pptx','Folio PPTX Slide 1',2],['docx','Folio DOCX Fixture',1],['hwp','Folio HWP Fixture',1],['hwpx','Folio HWPX Fixture',1],['xlsx','Folio XLSX Fixture',2],
] as const) {
  test(`${format} downloads every preview page as a local PDF`, async ({page}, testInfo) => {
    await openFixture(page,`folio-${format}.${format}`,text);
    const outbound:string[]=[];
    page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4173') && !r.url().startsWith('blob:') && !r.url().startsWith('data:'))outbound.push(r.url());});
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#download-pdf').click();
    const download=await downloadPromise;
    expect(download.suggestedFilename()).toBe(`folio-${format}.pdf`);
    const path=testInfo.outputPath(`folio-${format}.pdf`);
    await download.saveAs(path);
    const { readFile }=await import('node:fs/promises');
    const bytes=await readFile(path); const raw=bytes.toString('latin1');
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw.match(/\/Type\s*\/Page\b/g)?.length).toBe(count);
    expect(bytes.length).toBeGreaterThan(2000);
    expect(raw).toContain('/Subtype /Image');
    if (format === 'docx') {
      const media = raw.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
      expect(media).not.toBeNull();
      expect(Number(media![2]) / Number(media![1])).toBeCloseTo(Math.SQRT2, 1);
    }
    await expect(page.locator('#export-status')).toContainText('다운로드 완료');
    await expectFrameText(page,text);
    expect(outbound).toEqual([]);
  });
}

test('wide and long XLSX is split into multiple readable PDF pages', async ({page},testInfo)=>{
  await openFixture(page,'folio-long.xlsx','R90C15');
  const pending=page.waitForEvent('download'); await page.locator('#download-pdf').click();
  const download=await pending; const path=testInfo.outputPath('long-sheet.pdf'); await download.saveAs(path);
  const {readFile}=await import('node:fs/promises'); const raw=(await readFile(path)).toString('latin1');
  expect(raw.match(/\/Type\s*\/Page\b/g)!.length).toBeGreaterThanOrEqual(4);
});

test('PDF preparation can be cancelled without closing the document', async ({page})=>{
  await openFixture(page,'folio-long.xlsx','R90C15');
  await page.route('**/pdf-export-*.js',async route=>{ await new Promise(resolve=>setTimeout(resolve,500)); await route.continue(); });
  await page.locator('#download-pdf').click(); await page.locator('#cancel-export').click();
  await expect(page.locator('#export-status')).toContainText('취소했습니다');
  await expect(page.locator('#download-pdf')).toBeEnabled();
  await expectFrameText(page,'R90C15');
  await expect(page.locator('iframe[aria-hidden="true"]')).toHaveCount(0);
});

test('header links back to the profile site two levels up', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: 'carpenta.github.io' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '../../');
  const header = await page.locator('.site-header').boundingBox();
  const badge = await page.locator('.local-badge').boundingBox();
  const linkBox = await link.boundingBox();
  expect(header && badge && Math.abs(header.x + header.width - (badge.x + badge.width))).toBeLessThanOrEqual(1);
  expect(linkBox && badge && linkBox.x + linkBox.width).toBeLessThan(badge!.x);
});

test('on a phone the header keeps the link back to the site without overlap or overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  const link = page.getByRole('link', { name: 'carpenta.github.io' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '../../');
  const header = await page.locator('.site-header').boundingBox();
  const badge = await page.locator('.local-badge').boundingBox();
  const brand = await page.locator('.brand').boundingBox();
  const home = await link.boundingBox();
  if (!header || !badge || !brand || !home) throw new Error('missing bounding box');
  expect(Math.abs(header.x + header.width - (badge.x + badge.width))).toBeLessThanOrEqual(1);
  expect(home.x).toBeGreaterThanOrEqual(brand.x + brand.width);
  expect(home.x + home.width).toBeLessThanOrEqual(badge.x);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
