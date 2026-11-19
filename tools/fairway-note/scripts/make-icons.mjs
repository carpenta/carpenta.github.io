// Draws the app icons from one iron-head drawing and renders the PNGs with Playwright Chromium.
// Run from tools/fairway-note: node scripts/make-icons.mjs [outDir]   (outDir defaults to public)
// Writes favicon.svg, apple-touch-icon.png (180), icon-192.png and icon-512.png. The output is committed in public/;
// rerun only when the drawing changes, and render into a scratch folder first to compare.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'public';

// Grass palette: Turf is the brand green (also the manifest theme_color), Turf ink the darkest tone.
const TURF = '#2F7D3A';
const INK = '#17301A';

// An iron head seen from the face, on a 512 grid: toe on the left, the hosel rising up-right into the shaft.
const HEAD = 'M171.8 240.9C124.2 225.8 87.5 246.3 88.6 294.9C89.7 327.3 100.5 353.2 126.4 362.9C195.5 377 303.5 378 357.5 369.4C376.7 366.4 385.2 348.3 389.9 327.3L422.8 182.3L396 174.1L366.6 269C362.2 283.4 337.3 296.2 323 291.6Z';
const FERRULE = 'M422.3 182.2L396.5 174.2L405.3 156.6L424.9 162.7Z';
const SHAFT = 'M422.1 166.4L405.6 161.2L507.2 -175.8L528.9 -169.1Z';
const GROOVES = 'M128.6 277.6H230.1M124.2 299.2H293.8M126.4 320.8H323M135 342.4H327.3';

// Home-screen icon. Full bleed, so it also works when the OS masks it (manifest purpose "any maskable"): the head,
// hosel and ferrule stay inside the maskable safe zone, a centred circle with a radius of 40%. Light comes from the
// top left; the lit rim and the shaded sole are the head minus a copy of itself shifted toward or away from the light.
const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="turf" x1="0" y1="0" x2="0" y2="512" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#368A43"/><stop offset="1" stop-color="#28702F"/></linearGradient>
    <pattern id="mown" width="96" height="96" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="48" height="96" fill="#fff" fill-opacity=".035"/></pattern>
    <linearGradient id="steel" x1="0" y1="228" x2="0" y2="379" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#EEF4EC"/><stop offset="1" stop-color="#D2DECC"/></linearGradient>
    <linearGradient id="shaft" x1="399" y1="175" x2="419.7" y2="181.4" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F7FAF5"/><stop offset="1" stop-color="#B7C5B1"/></linearGradient>
    <filter id="drop" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="4" dy="11" stdDeviation="10" flood-color="#0B1F10" flood-opacity=".3"/></filter>
    <path id="head" d="${HEAD}"/>
    <clipPath id="inside"><use href="#head"/></clipPath>
    <mask id="lit"><rect width="512" height="512" fill="#fff"/><use href="#head" x="3" y="5"/></mask>
    <mask id="shade"><rect width="512" height="512" fill="#fff"/><use href="#head" x="-5" y="-8"/></mask>
  </defs>
  <rect width="512" height="512" fill="url(#turf)"/>
  <rect width="512" height="512" fill="url(#mown)"/>
  <g filter="url(#drop)">
    <path d="${SHAFT}" fill="url(#shaft)"/>
    <path d="${FERRULE}" fill="${INK}"/>
    <use href="#head" fill="url(#steel)"/>
  </g>
  <g clip-path="url(#inside)">
    <rect width="512" height="512" fill="#C3D0BD" mask="url(#shade)"/>
    <rect width="512" height="512" fill="#fff" mask="url(#lit)"/>
  </g>
  <path d="${GROOVES}" fill="none" stroke="#9FB49A" stroke-width="7.5" stroke-linecap="round"/>
</svg>`;

// Tab icon: the same head, a little larger, in flat colours on a rounded tile, with two bold grooves that hold up at 16px.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <clipPath id="tile"><rect width="32" height="32" rx="7"/></clipPath>
  <rect width="32" height="32" rx="7" fill="${TURF}"/>
  <g clip-path="url(#tile)"><g transform="matrix(.0648 0 0 .0648 -2.57 -.27)">
    <path d="M421.6 193.3L390.7 183.8L500.5 -177.9L535.6 -167Z" fill="#DCE5D8"/>
    <path d="${HEAD}" fill="#fff"/>
    <path d="M141.5 303.5H303.5M137.2 338.1H327.3" fill="none" stroke="${TURF}" stroke-width="24" stroke-linecap="round"/>
  </g></g>
</svg>
`;

await mkdir(out, { recursive: true });
await writeFile(join(out, 'favicon.svg'), favicon);
console.log(`wrote ${join(out, 'favicon.svg')}`);

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${appIcon}`);
  await page.screenshot({ path: join(out, name) });
  console.log(`wrote ${join(out, name)}`);
}
await browser.close();
