// Traces a course's holes from its official hole maps into src/data/traced/<course>.json (the 핀크스 pilot). Run by hand,
// never in the build or CI:
//
//   bun run trace:holes <course id> <folder of hole maps>
//
// The folder (kept out of git) holds <nine>-<hole>.(png|jpg|jpeg|webp), one plan per hole; optionally lengths.json
// ({ <nine>: [{ hole, tees: [{ colour, m, yd }] }] }) with each hole's tee lengths as the map prints them (else the
// longest tee in courses.json, else a length typical of the par); and optionally trace.json, how this course's maps are
// drawn: { crop: [x0, y0, x1, y1] (fractions, to leave out insets and legends), cropHoles: { "<nine>-<n>": [...] },
// rotate: 0|90|180|270, rotateHoles: { "<nine>-<n>": deg }, skip: ["<nine>-<n>", …] (holes that keep the schematic), palette: { fairway|green|rough|dark|bunker|water|
// background: ["#rrggbb", …] }, maxDistance: 60 }. Each map is turned clockwise by rotate so its tee is at the bottom and
// its green at the top, and, when its long side is outside 450–700px, scaled to 580px (the rules below were tuned at that size). Without a
// palette, the 핀크스 rules sort the pixels; with one, each pixel takes the class of its nearest sample colour. The pixels are read in Playwright's Chromium; each is sorted by colour (src/trace-geo.ts does the
// geometry): light green patches are the fairways, the putting green (the topmost small one) and the tees (the small ones
// low down); compact white patches inside the course are bunkers; blue ones water. Each hole is scaled to its longest
// tee's length along the line of play. The output has, per nine id, nine entries in src/data/osm/'s hole shape without
// the `osm` ids (null where a hole keeps the schematic). The folder gets overlay/<nine>-<hole>.png, the trace over the
// map, and sheet.png, all of them, to check by eye.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ringArea } from '../src/osm-geo.ts';
import { blobs, implausible, majority, shapeOf, toMetres } from '../src/trace-geo.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// bun run trace:holes --colours <map file>: the map's 24 commonest colours (in steps of 16), each with where one pixel of
// it is, to choose a course's palette from.
if (process.argv[2] === '--colours') {
  const file = process.argv[3];
  const ext = file.split('.').pop().toLowerCase();
  const b = await chromium.launch();
  const p = await b.newPage();
  const top = await p.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    const bins = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      const bin = bins.get(key) ?? { n: 0, at: (i / 4) | 0 };
      bin.n++;
      bins.set(key, bin);
    }
    const hex = (v) => ((v << 4) | 8).toString(16).padStart(2, '0');
    return [...bins].sort((a, b) => b[1].n - a[1].n).slice(0, 24).map(([k, v]) => `#${hex(k >> 8)}${hex((k >> 4) & 15)}${hex(k & 15)} ${v.n} at ${v.at % img.width},${(v.at / img.width) | 0}`);
  }, `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${readFileSync(file).toString('base64')}`);
  console.log(`${file}\n${top.join('\n')}`);
  await b.close();
  process.exit(0);
}

const [course, folder] = process.argv.slice(2);
if (!course || !folder) {
  console.error('usage: bun run trace:holes <course id> <folder of hole maps>\n       bun run trace:holes --colours <map file>');
  process.exit(1);
}
const courses = JSON.parse(readFileSync(join(root, 'src/data/courses.json'), 'utf8')).courses;
const entry = courses.find((c) => c.id === course);
if (!entry) throw new Error(`no course ${course} in courses.json`);
const optional = (name) => {
  try {
    return JSON.parse(readFileSync(join(folder, name), 'utf8'));
  } catch {
    return {};
  }
};
const lengths = optional('lengths.json');
const config = optional('trace.json');
const files = readdirSync(folder);
/** A length typical of the par, where neither the map nor the course data gives one. */
const TYPICAL = { 3: 150, 4: 350, 5: 480, 6: 560 };
mkdirSync(join(folder, 'overlay'), { recursive: true });

/** Classes the browser sorts each pixel into. */
const K = { other: 0, white: 1, fairway: 2, light: 3, rough: 4, dark: 5, water: 6, background: 7 };

const browser = await chromium.launch();
const page = await browser.newPage();

/**
 * The map cut to `crop` (fractions of its width and height: x0, y0, x1, y1), turned clockwise by `deg`, and scaled to
 * a long side of 580px when it is far from that, as a PNG data URL.
 */
const normalise = (url, deg, crop = [0, 0, 1, 1]) =>
  page.evaluate(async ({ url, deg, crop, PNG_OUT }) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const sx = Math.round(crop[0] * img.width);
    const sy = Math.round(crop[1] * img.height);
    const sw = Math.round((crop[2] - crop[0]) * img.width);
    const sh = Math.round((crop[3] - crop[1]) * img.height);
    const long = Math.max(sw, sh);
    // Maps already near the size the rules were tuned at are left as they are (resampling moves a few edge pixels).
    const k = long < 450 || long > 700 ? 580 / long : 1;
    const w = Math.round(sw * k);
    const h = Math.round(sh * k);
    const side = deg % 180 !== 0;
    const c = new OffscreenCanvas(side ? h : w, side ? w : h);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.translate(c.width / 2, c.height / 2);
    g.rotate((deg * Math.PI) / 180);
    g.drawImage(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    return `data:image/png;base64,${await (0, eval)(PNG_OUT)(c)}`;
  }, { url, deg, crop, PNG_OUT });

/** The map's pixels, sorted into K, with the white page around the course as background. */
const classify = (url, palette, maxDistance) =>
  page.evaluate(async ({ url, K, palette, maxDistance }) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const W = img.width;
    const H = img.height;
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const cls = new Uint8Array(W * H);
    // A course's own sample colours: each pixel the class of the nearest, or none past maxDistance.
    const CLASS = { fairway: K.fairway, green: K.light, rough: K.rough, dark: K.dark, bunker: K.white, water: K.water, background: K.background };
    const samples = palette ? Object.entries(palette).flatMap(([name, hexes]) => hexes.map((hex) => [CLASS[name], parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)])) : null;
    for (let i = 0; i < W * H; i++) {
      if (samples) {
        let best = K.other;
        let near = maxDistance * maxDistance;
        for (const [k, r, gg, b] of samples) {
          const dd = (d[i * 4] - r) ** 2 + (d[i * 4 + 1] - gg) ** 2 + (d[i * 4 + 2] - b) ** 2;
          if (dd < near) {
            near = dd;
            best = k;
          }
        }
        cls[i] = best;
        continue;
      }
      const r = d[i * 4];
      const gg = d[i * 4 + 1];
      const b = d[i * 4 + 2];
      const mx = Math.max(r, gg, b);
      const s = mx ? (mx - Math.min(r, gg, b)) / mx : 0;
      if (mx > 215 && s < 0.12) cls[i] = K.white;
      else if (b > gg + 10 && b > r + 20) cls[i] = K.water;
      else if (gg >= r && gg >= b && gg > 200 && r > 140) cls[i] = K.light;
      else if (gg >= r && gg >= b && gg > 165) cls[i] = K.fairway;
      else if (gg >= r && gg >= b && gg > 85 && s > 0.45) cls[i] = K.rough;
      else if (mx < 140) cls[i] = K.dark;
    }
    // The page: white reached from the image's edge.
    const stack = [];
    for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
    while (stack.length) {
      const i = stack.pop();
      if (cls[i] !== K.white) continue;
      cls[i] = K.background;
      const x = i % W;
      if (x > 0) stack.push(i - 1);
      if (x < W - 1) stack.push(i + 1);
      if (i >= W) stack.push(i - W);
      if (i < (H - 1) * W) stack.push(i + W);
    }
    return { w: W, h: H, cls: Array.from(cls) };
  }, { url, K, palette, maxDistance });

/** Base64 of a canvas's PNG, inside the page. */
const PNG_OUT = `async (c) => { const b = new Uint8Array(await (await c.convertToBlob()).arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); }`;

/** The trace drawn over the map, as a PNG (base64). */
const overlay = (url, hole, label) =>
  page.evaluate(async ({ url, hole, label, PNG_OUT }) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.fillStyle = 'rgb(255 255 255 / .45)';
    g.fillRect(0, 0, img.width, img.height);
    const ring = (r, stroke, fill) => {
      g.beginPath();
      r.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      g.strokeStyle = stroke;
      g.lineWidth = 2;
      g.stroke();
    };
    hole.fairways.forEach((r) => ring(r, '#0a7d2c', 'rgb(40 200 90 / .45)'));
    hole.water.forEach((r) => ring(r, '#0047ff', 'rgb(0 90 255 / .5)'));
    hole.bunkers.forEach((r) => ring(r, '#c27c00', 'rgb(255 190 60 / .7)'));
    hole.greens.forEach((r) => ring(r, '#d4007a', 'rgb(255 90 180 / .6)'));
    hole.tees.forEach((r, i) => ring(r, i ? '#444' : '#000', i ? 'rgb(120 120 120 / .6)' : 'rgb(0 0 0 / .6)'));
    if (hole.line.length) {
      g.beginPath();
      hole.line.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = '#e00';
      g.lineWidth = 2.5;
      g.stroke();
    }
    g.fillStyle = '#000';
    g.font = 'bold 22px sans-serif';
    g.fillText(label, 8, 26);
    return (0, eval)(PNG_OUT)(c);
  }, { url, hole, label, PNG_OUT });

const mask = (w, h, cls, keep) => {
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = keep.includes(cls[i]) ? 1 : 0;
  return { w, h, on };
};

/** The parts of one hole map, in pixels, or why it could not be traced. */
function trace(w, h, cls) {
  const light = blobs(majority(mask(w, h, cls, [K.fairway, K.light]), 2), 25, 1.5);
  // The putting green: a round light patch of a green's size in the top 40%, the topmost of them (specks such as the
  // flag's number are too small, the fairway too long).
  const isGreen = (b) => b.area >= 150 && b.area <= 3000 && shapeOf(b).outline > 0.5 && shapeOf(b).stretch < 2.5 && b.centre[1] < h * 0.4;
  let greens = light.filter(isGreen);
  // Where the green runs into the fairway's lighter stripes, the green alone: the lightest pixels only.
  if (!greens.length) greens = blobs(majority(mask(w, h, cls, [K.light]), 2), 25, 1.5).filter(isGreen);
  if (!greens.length) return { why: 'no green found' };
  const green = greens.reduce((top, b) => (b.centre[1] < top.centre[1] ? b : top));
  // Tees: small compact light patches in the lowest 40%: the lowest is the back tee, the others within 160px of it.
  const low = light.filter((b) => b !== green && b.area <= 800 && shapeOf(b).stretch < 3.5 && b.centre[1] > h * 0.6).sort((a, b) => b.centre[1] - a.centre[1]);
  if (!low.length) return { why: 'no tee found low on the map' };
  const tees = low.filter((b) => Math.hypot(b.centre[0] - low[0].centre[0], b.centre[1] - low[0].centre[1]) <= 160);
  const fairways = light.filter((b) => b !== green && !tees.includes(b) && b.area >= 600);
  const white = blobs(majority(mask(w, h, cls, [K.white]), 1), 35, 1);
  // Bunkers: compact white patches; label boxes are rectangles by their edge, cart paths long or thin.
  const bunkers = white.filter((b) => {
    const s = shapeOf(b);
    return b.area <= 4000 && s.outline < 0.8 && s.fill > 0.3 && s.stretch < 6;
  });
  // Water: blue patches bigger than the legend's blue tee dot.
  const water = blobs(majority(mask(w, h, cls, [K.water]), 2), 150, 1.5);
  return { hole: { tees: tees.map((b) => b.ring), greens: [green.ring], fairways: fairways.map((b) => b.ring), bunkers: bunkers.map((b) => b.ring), water: water.map((b) => b.ring) } };
}

const flat = (r) => r.flat();
const out = {};
const report = [];
const sheet = [];
for (const nine of entry.nines) {
  out[nine.id] = [];
  for (let n = 1; n <= nine.par.length; n++) {
    const name = `${nine.id}-${n}`;
    if (config.skip?.includes(name)) {
      out[nine.id].push(null);
      report.push(`${name}: kept the schematic (skipped in trace.json)`);
      continue;
    }
    const file = files.find((f) => new RegExp(`^${name}\\.(png|jpe?g|webp)$`, 'i').test(f));
    if (!file) {
      out[nine.id].push(null);
      report.push(`${name}: no map`);
      continue;
    }
    const ext = file.split('.').pop().toLowerCase();
    const raw = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${readFileSync(join(folder, file)).toString('base64')}`;
    const url = await normalise(raw, config.rotateHoles?.[name] ?? config.rotate ?? 0, config.cropHoles?.[name] ?? config.crop);
    const printed = (lengths[nine.id]?.find((e) => e.hole === n)?.tees ?? []).map((t) => t.m ?? 0);
    const listed = (nine.holes?.[n - 1]?.distances ?? []).map((t) => Math.round(t.unit === 'yd' ? t.length * 0.9144 : t.length));
    const length = Math.max(0, ...printed) || Math.max(0, ...listed) || TYPICAL[nine.par[n - 1]];
    const { w, h, cls } = await classify(url, config.palette ?? null, config.maxDistance ?? 60);
    const got = trace(w, h, cls);
    if (!got.hole || !length) {
      out[nine.id].push(null);
      report.push(`${name}: kept the schematic (${got.why ?? 'no length'})`);
      continue;
    }
    const m = toMetres(got.hole, length);
    // Scraps of fairway (a stripe cut off by a label or a path) go; the hole stays.
    m.fairways = m.fairways.filter((f) => Math.abs(ringArea(f)) >= 300);
    const why = implausible(m);
    // The line back in pixels for the overlay: metres over scale, north up again, from the green's middle.
    const g0 = got.hole.greens[0];
    const gc = [g0.reduce((s, p) => s + p[0], 0) / g0.length, g0.reduce((s, p) => s + p[1], 0) / g0.length];
    const linePx = m.line.map(([x, y]) => [gc[0] + x / m.scale, gc[1] - y / m.scale]);
    const shot = await overlay(url, { ...got.hole, line: linePx }, `${name} ${length}m${why.length ? ' !' : ''}`);
    writeFileSync(join(folder, 'overlay', `${name}.png`), Buffer.from(shot, 'base64'));
    sheet.push(`overlay/${name}.png`);
    if (why.length) {
      out[nine.id].push(null);
      report.push(`${name}: kept the schematic (${why.join(', ')})`);
      continue;
    }
    out[nine.id].push({
      line: flat(m.line),
      greens: m.greens.map(flat),
      tees: m.tees.map(flat),
      fairways: m.fairways.map(flat),
      bunkers: m.bunkers.map(flat),
      water: m.water.map((w) => w.map(flat)),
    });
    report.push(`${name}: ${length} m, ${m.fairways.length} fairway(s), ${m.bunkers.length} bunker(s), ${m.water.length} water, ${(1 / m.scale).toFixed(2)} px/m`);
  }
}

// All overlays side by side, nine to a row.
const tiles = sheet.map((f) => `data:image/png;base64,${readFileSync(join(folder, f)).toString('base64')}`);
const sheetPng = await page.evaluate(async ({ tiles, PNG_OUT }) => {
  const imgs = await Promise.all(tiles.map(async (u) => { const i = new Image(); i.src = u; await i.decode(); return i; }));
  const cw = 200;
  const ch = 360;
  const c = new OffscreenCanvas(cw * 9, ch * Math.ceil(imgs.length / 9));
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  imgs.forEach((img, k) => {
    const s = Math.min(cw / img.width, ch / img.height);
    g.drawImage(img, (k % 9) * cw, Math.floor(k / 9) * ch, img.width * s, img.height * s);
  });
  return (0, eval)(PNG_OUT)(c);
}, { tiles, PNG_OUT });
writeFileSync(join(folder, 'sheet.png'), Buffer.from(sheetPng, 'base64'));
await browser.close();

const target = join(root, 'src/data/traced', `${course}.json`);
mkdirSync(dirname(target), { recursive: true });
const source = entry.nines.map((nine) => nine.holes?.[0]?.guideUrl).filter(Boolean);
writeFileSync(
  target,
  `${JSON.stringify({
    course,
    method: "Traced by colour from the course's official hole maps, roughly; scaled to the longest tee's printed length.",
    source,
    checked: new Date().toISOString().slice(0, 10),
    holes: out,
  })}\n`,
);
console.log(report.join('\n'));
console.log(`wrote ${target} and ${join(folder, 'sheet.png')}`);
