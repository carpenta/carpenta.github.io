// Renders the home-screen icons (PNG) once with Playwright Chromium. Run: node scripts/make-icons.mjs
// The output is committed in public/; rerun only when the icon design changes.
import { chromium } from '@playwright/test';

// Full-bleed square so the icon also works when the OS masks it to a circle or squircle.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" fill="#1F5A3A"/>
  <g transform="translate(2.4 2.4) scale(.8)">
    <path d="M8 19V5l9 3.5L8 12" fill="#F2C94C" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
    <ellipse cx="12" cy="19.5" rx="6" ry="1.5" fill="#7FBF7F"/>
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
