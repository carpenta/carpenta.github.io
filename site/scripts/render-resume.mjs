import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { serve } from './serve-static.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const TARGETS = [
  { page: '/resume/', file: '조일환_이력서.pdf' },
  { page: '/en/resume/', file: 'Cho_Il-hwan_Resume.pdf' },
];

await stat(`${dist}resume/index.html`).catch(() => {
  throw new Error('site/dist/resume/index.html not found. Run "npm run build" first.');
});
await mkdir(`${dist}resume`, { recursive: true });

const server = await serve(dist);
const browser = await chromium.launch();
try {
  for (const target of TARGETS) {
    const page = await browser.newPage();
    await page.goto(server.url + target.page, { waitUntil: 'networkidle' });
    const fontReady = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Pretendard Variable' && f.status === 'loaded');
    });
    if (!fontReady) throw new Error(`Pretendard did not load for ${target.page}`);
    await page.pdf({ path: `${dist}resume/${target.file}`, format: 'A4', printBackground: true, preferCSSPageSize: true });
    await page.close();
    console.log(`wrote dist/resume/${target.file}`);
  }
} finally {
  await browser.close();
  await server.close();
}
