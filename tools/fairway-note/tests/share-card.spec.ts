import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { newRound, type Hole, type Round } from '../src/round';

// Draws share cards in a real browser. tests/share-card.html is a test-only page that the Vite dev server serves
// (the build's only page is index.html, so it never ships) with the app's CSP. It runs on its own server:
//   npx playwright test -c playwright.port4184.config.ts

const hole = (par: 3 | 4 | 5, driver: number, approach: number, putts: number, ob = 0, hazard = 0): Hole => ({ par, driver, approach, putts, ob, hazard, mulligan: 0 });

/** Everis 새별·레이크, all 18 holes: an eagle, two birdies, a triple, an OB and a hazard; 81 (+9). */
function fullRound(): Round {
  const r = newRound(new Date(2026, 10, 19));
  r.holes = [
    hole(4, 1, 2, 2), hole(4, 1, 1, 2), hole(5, 1, 1, 2), hole(3, 1, 0, 2), hole(4, 1, 2, 3), hole(4, 2, 1, 1, 1),
    hole(3, 1, 1, 2), hole(5, 1, 1, 1), hole(4, 1, 3, 3), hole(4, 1, 1, 2), hole(3, 1, 0, 1), hole(4, 1, 2, 2),
    hole(4, 1, 1, 2, 0, 1), hole(5, 1, 2, 2), hole(5, 1, 3, 2), hole(3, 1, 0, 2), hole(4, 1, 2, 3), hole(4, 1, 1, 2),
  ].map((x, i) => (i < 2 ? { ...x, tags: { driver: ['fairway' as const] } } : x));
  r.current = 17;
  return r;
}

/** 새별 only, under par, with 레이크 left blank: a 9-hole round. */
function nineRound(): Round {
  const r = newRound(new Date(2026, 10, 19));
  for (let i = 0; i < 9; i++) r.holes[i] = hole(r.holes[i].par, 1, r.holes[i].par - 3, i === 2 ? 1 : 2);
  r.current = 8;
  return r;
}

interface Drawn {
  type: string;
  width: number;
  height: number;
  png: string;
  pixels: Record<string, number[]>;
}

/** Draws the card in the page and reads back the PNG, its decoded size and a few pixels found from the layout. */
async function draw(page: Page, round: Round): Promise<Drawn> {
  return page.evaluate(async (r) => {
    type Op = { kind: string; id?: string; ops?: Op[]; x?: number; y?: number; w?: number; cx?: number; cy?: number; r?: number; lineWidth?: number };
    const api = (window as unknown as { shareCard: { drawShareCard(r: unknown): Promise<Blob>; shareCardLayout(r: unknown): { ops: Op[] } } }).shareCard;
    const blob = await api.drawShareCard(r);
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const flat = (ops: Op[]): Op[] => ops.flatMap((op) => (op.ops ? [op, ...flat(op.ops)] : [op]));
    const ops = flat(api.shareCardLayout(r).ops);
    const card = ops.find((op) => op.id === 'card')!;
    const ring = ops.find((op) => op.id === 'hole-3-mark')!.ops![0];
    const at = (x: number, y: number) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return {
      type: blob.type,
      width: bitmap.width,
      height: bitmap.height,
      png: btoa(binary),
      pixels: {
        corner: at(6, 6),
        card: at(card.x! + card.w! / 2, card.y! + 10),
        // On the stroke of hole 3's birdie circle.
        birdie: at(ring.cx! + ring.r!, ring.cy!),
      },
    };
  }, round);
}

/** Width and height from the PNG's IHDR chunk. */
function pngSize(png: Buffer): [number, number] {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

const near = (pixel: number[], hex: string, tolerance = 24) => {
  const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return want.every((v, i) => Math.abs(v - pixel[i]) <= tolerance);
};
/** The deep turf background, lightened a little by the mowing stripes and the glow: dark, and green above all. */
const turf = ([r, g, b, a]: number[]) => a === 255 && g < 100 && g > r && g > b;

let violations: string[] = [];
let requests: string[] = [];

test.beforeEach(async ({ page }) => {
  violations = [];
  requests = [];
  page.on('console', (message) => {
    // The dev server's own reload client cannot open its socket under connect-src 'none'; that is not the card.
    if (message.type() === 'error' && !/ws:\/\/|\[vite\]/.test(message.text())) violations.push(message.text());
  });
  page.on('pageerror', (error) => violations.push(error.message));
  await page.goto('/tests/share-card.html');
  await page.waitForFunction(() => 'shareCard' in window);
  page.on('request', (request) => requests.push(request.url()));
  await page.evaluate(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      if (!event.blockedURI.startsWith('ws')) console.error(`CSP: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
});

test.afterEach(() => {
  expect(violations).toEqual([]);
  // Drawing makes no request at all: no images, fonts or anything else from the network.
  expect(requests).toEqual([]);
});

test('draws an 18-hole round as a 1080×1350 PNG under the app CSP', async ({ page }, testInfo) => {
  const drawn = await draw(page, fullRound());
  expect(drawn.type).toBe('image/png');
  expect([drawn.width, drawn.height]).toEqual([1080, 1350]);
  const png = Buffer.from(drawn.png, 'base64');
  expect(pngSize(png)).toEqual([1080, 1350]);
  expect(turf(drawn.pixels.corner), `corner ${drawn.pixels.corner}`).toBe(true);
  expect(near(drawn.pixels.card, '#F3F7EF', 6), `card ${drawn.pixels.card}`).toBe(true);
  expect(near(drawn.pixels.birdie, '#C0392B', 60), `birdie ${drawn.pixels.birdie}`).toBe(true);
  writeFileSync(testInfo.outputPath('share-card-18.png'), png);
});

test('draws a 9-hole round at the same size', async ({ page }, testInfo) => {
  const drawn = await draw(page, nineRound());
  const png = Buffer.from(drawn.png, 'base64');
  expect(pngSize(png)).toEqual([1080, 1350]);
  expect(near(drawn.pixels.birdie, '#C0392B', 60), `birdie ${drawn.pixels.birdie}`).toBe(true);
  writeFileSync(testInfo.outputPath('share-card-9.png'), png);
});

test('shares the PNG as a file named after the round', async ({ page }) => {
  const file = await page.evaluate(async (r) => {
    const api = (window as unknown as { shareCard: { drawShareCard(r: unknown): Promise<Blob>; shareCardFileName(r: unknown): string } }).shareCard;
    const f = new File([await api.drawShareCard(r)], api.shareCardFileName(r), { type: 'image/png' });
    return { name: f.name, type: f.type, size: f.size };
  }, fullRound());
  expect(file).toMatchObject({ name: 'fairway-note-2026-11-19.png', type: 'image/png' });
  expect(file.size).toBeGreaterThan(20_000);
});
