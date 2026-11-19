// Renders the home-screen icons (PNG) once with Playwright Chromium. Run: node scripts/make-icons.mjs
// The output is committed in public/; rerun only when the icon design changes.
import { chromium } from '@playwright/test';

// Full-bleed square so the icon also works when the OS masks it to a circle or squircle.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" fill="#1F5A3A"/>
  <g transform="translate(2.4 2.4) scale(.8)">
    <path d="M16.4 3 15.2 10.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><path d="M14.4 9.8 16.2 10.4c.6 3.3.4 6.6-.6 8.6-.8 1.6-3.6 2.2-8.4 1.6-2-.2-2.8-1.6-2.1-3l1.1-2.1c.4-.8 1.3-1.2 2.2-1 2.8.5 4.6-.4 6-4.7z" fill="#F2C94C" stroke="#fff" stroke-width="1" stroke-linejoin="round"/><path d="M7.4 16.4h6.6M7 17.9h7.1M7.2 19.3h6.6" stroke="#1F5A3A" stroke-width=".55" stroke-linecap="round" opacity=".5"/>
  </g>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: `public/${name}`, omitBackground: false });
  console.log(`wrote public/${name}`);
}
await browser.close();
