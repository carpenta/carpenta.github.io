/**
 * The painted ground under 기록's drawing (v39): the hole's own outlines (course-art.ts `Terrain`) painted as an aerial
 * view would show them, grass with grain and mowing stripes, the green in its fringe, sand with a lip, water with depth,
 * and woodland round the hole. The drawing above keeps the markers and the flag.
 *
 * Trees are never drawn as rounds (a field of small circles read as holes, the user said): seed circles are blurred and
 * thresholded into merged masses (metaballs), each shaded from its own outline, with finer merged crowns inside.
 *
 * Loaded on demand (main.ts imports it when 기록 first draws a hole), so the main bundle stays as it was. Numbers only:
 * nothing is fetched, nothing is stored.
 */
import type { Terrain } from './course-art';
import type { Pt } from './osm-geo';

type Ctx = CanvasRenderingContext2D;

/** Whether this browser's canvas blurs through `filter` (Safari's did not for long): otherwise a scaled copy stands in. */
let filterWorks: boolean | null = null;
function canFilter(): boolean {
  if (filterWorks === null) {
    const c = document.createElement('canvas').getContext('2d');
    filterWorks = !!c && 'filter' in c && ((c.filter = 'blur(2px)'), c.filter === 'blur(2px)');
  }
  return filterWorks;
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** A copy of `src` blurred by about `r` device pixels. */
function blurred(src: HTMLCanvasElement, r: number): HTMLCanvasElement {
  const [out, o] = canvasOf(src.width, src.height);
  if (r <= 0) {
    o.drawImage(src, 0, 0);
    return out;
  }
  if (canFilter()) {
    o.filter = `blur(${r}px)`;
    o.drawImage(src, 0, 0);
    o.filter = 'none';
    return out;
  }
  // Down by about the radius and back up, twice: smooth enough for shadows and the canopy's merging.
  const k = Math.max(2, Math.round(r));
  const [small, s] = canvasOf(Math.max(1, Math.round(src.width / k)), Math.max(1, Math.round(src.height / k)));
  s.imageSmoothingQuality = 'high';
  s.drawImage(src, 0, 0, small.width, small.height);
  const [mid, m] = canvasOf(src.width, src.height);
  m.imageSmoothingQuality = 'high';
  m.drawImage(small, 0, 0, src.width, src.height);
  s.clearRect(0, 0, small.width, small.height);
  s.drawImage(mid, 0, 0, small.width, small.height);
  o.imageSmoothingQuality = 'high';
  o.drawImage(small, 0, 0, src.width, src.height);
  return out;
}

/** Paints `t` on `canvas`, `width` by `height` CSS pixels at `dpr` device pixels each. */
export function paintTerrain(canvas: HTMLCanvasElement, t: Terrain, width: number, height: number, dpr: number): void {
  const W = width;
  const H = height;
  const D = dpr;
  canvas.width = Math.round(W * D);
  canvas.height = Math.round(H * D);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(D, 0, 0, D, 0, 0);

  let seed = t.seed >>> 0 || 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  /** A layer the size of the canvas, drawn in CSS pixels. */
  const layer = (): [HTMLCanvasElement, Ctx] => {
    const [c, x] = canvasOf(canvas.width, canvas.height);
    x.setTransform(D, 0, 0, D, 0, 0);
    return [c, x];
  };
  /** Puts a layer down as it is (device pixels to device pixels), moved by (dx, dy) CSS pixels. */
  const put = (dst: Ctx, src: HTMLCanvasElement, dx = 0, dy = 0) => {
    dst.save();
    dst.setTransform(1, 0, 0, 1, 0, 0);
    dst.drawImage(src, dx * D, dy * D);
    dst.restore();
  };
  const path = (pts: Pt[]) => {
    const p = new Path2D();
    pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    return p;
  };
  const greens = t.greens.map(path);
  const tees = t.tees.map(path);
  const fairways = t.fairways.map(path);
  const bunkers = t.bunkers.map(path);
  const water = t.water.map((rings) => {
    const p = new Path2D();
    for (const r of rings) p.addPath(path(r));
    return p;
  });
  const play = [...fairways, ...greens, ...tees];
  const linePath = new Path2D();
  t.line.forEach(([x, y], i) => (i ? linePath.lineTo(x, y) : linePath.moveTo(x, y)));
  // Across the line of play, for the mowing stripes.
  const [ax, ay] = t.line[0] ?? [0, 0];
  const [bx, by] = t.line.at(-1) ?? [W, 0];
  const across = Math.atan2(by - ay, bx - ax);

  // Grain: fine noise, laid soft-light.
  const [noise, nx] = canvasOf(160, 160);
  const img = nx.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + rnd() * 140;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nx.putImageData(img, 0, 0);
  const grain = (x: Ctx, a: number) => {
    x.save();
    x.globalAlpha = a;
    x.globalCompositeOperation = 'soft-light';
    x.fillStyle = x.createPattern(noise, 'repeat')!;
    x.fillRect(0, 0, W, H);
    x.restore();
  };

  // 1. The rough: soft light from the top left.
  const rough = ctx.createLinearGradient(0, 0, W, H);
  rough.addColorStop(0, '#34573a');
  rough.addColorStop(0.55, '#2a4a30');
  rough.addColorStop(1, '#213d28');
  ctx.fillStyle = rough;
  ctx.fillRect(0, 0, W, H);
  grain(ctx, 0.5);

  // 2. The semi-rough round the play: a lighter band with soft edges.
  {
    const [c, x] = layer();
    x.fillStyle = x.strokeStyle = '#3a6a40';
    x.lineJoin = x.lineCap = 'round';
    x.lineWidth = 34;
    for (const p of play) {
      x.stroke(p);
      x.fill(p);
    }
    x.lineWidth = 26;
    x.stroke(linePath);
    ctx.save();
    ctx.globalAlpha = 0.75;
    put(ctx, blurred(c, 10 * D));
    ctx.restore();
  }

  // 3. Woodland: where the play, the water and the sand are not, a line along the hole and clumps elsewhere.
  const [maskC, m] = layer();
  m.fillStyle = m.strokeStyle = '#000';
  m.lineJoin = m.lineCap = 'round';
  m.lineWidth = 58;
  for (const p of play) {
    m.stroke(p);
    m.fill(p);
  }
  m.lineWidth = 50;
  m.stroke(linePath);
  m.lineWidth = 14;
  for (const p of water) {
    m.stroke(p);
    m.fill(p);
  }
  m.lineWidth = 16;
  for (const p of bunkers) {
    m.stroke(p);
    m.fill(p);
  }
  const taken = m.getImageData(0, 0, maskC.width, maskC.height).data;
  const free = (x: number, y: number) => {
    const px = Math.floor(x * D);
    const py = Math.floor(y * D);
    return px < 0 || py < 0 || px >= maskC.width || py >= maskC.height || taken[(py * maskC.width + px) * 4 + 3] === 0;
  };
  const G = 48;
  const cols = Math.ceil(W / G) + 2;
  const rows = Math.ceil(H / G) + 2;
  const lattice = Array.from({ length: cols * rows }, () => rnd());
  const smooth = (v: number) => v * v * (3 - 2 * v);
  const clump = (x: number, y: number) => {
    const gx = (x + G) / G;
    const gy = (y + G) / G;
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = smooth(gx - i);
    const fy = smooth(gy - j);
    const v = (a: number, b: number) => lattice[Math.min(rows - 1, Math.max(0, b)) * cols + Math.min(cols - 1, Math.max(0, a))];
    return (v(i, j) * (1 - fx) + v(i + 1, j) * fx) * (1 - fy) + (v(i, j + 1) * (1 - fx) + v(i + 1, j + 1) * fx) * fy;
  };
  const [seedC, sx] = layer();
  sx.fillStyle = '#000';
  for (let y = -6; y < H + 6; y += 8) {
    for (let x = -6; x < W + 6; x += 8) {
      const jx = x + (rnd() - 0.5) * 8;
      const jy = y + (rnd() - 0.5) * 8;
      if (!free(jx, jy)) continue;
      let near = 99;
      for (let d = 6; d <= 48; d += 6) {
        if (!free(jx + d, jy) || !free(jx - d, jy) || !free(jx, jy + d) || !free(jx, jy - d)) {
          near = d;
          break;
        }
      }
      const keep = near <= 18 ? 0.78 : near <= 36 ? 0.45 : clump(jx, jy) > 0.62 ? 0.7 : 0.03;
      const r = 4 + rnd() * 4.5;
      const ry = r * (1 + rnd() * 0.5);
      const turn = rnd() * Math.PI;
      if (rnd() < keep) {
        sx.beginPath();
        sx.ellipse(jx, jy, r * 1.35, ry, turn, 0, Math.PI * 2);
        sx.fill();
      }
    }
  }
  // Merge the seeds: blur, then a soft threshold.
  const canopy = blurred(seedC, 5 * D);
  {
    const cx = canopy.getContext('2d', { willReadFrequently: true })!;
    const px = cx.getImageData(0, 0, canopy.width, canopy.height);
    for (let i = 3; i < px.data.length; i += 4) {
      const a = px.data[i];
      px.data[i] = a < 96 ? 0 : a > 150 ? 255 : ((a - 96) * 255) / 54;
    }
    cx.putImageData(px, 0, 0);
  }
  /** A shape layer filled with one colour, moved by (dx, dy) CSS pixels and blurred by `blur` CSS pixels. */
  const tinted = (shape: HTMLCanvasElement, colour: string, dx = 0, dy = 0, blur = 0) => {
    const [c, x] = canvasOf(canvas.width, canvas.height);
    x.drawImage(blur ? blurred(shape, blur * D) : shape, dx * D, dy * D);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = colour;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  };
  put(ctx, tinted(canopy, 'rgb(3 12 6 / .6)', 5, 6, 5));
  {
    const [mass, mx] = layer();
    put(mx, tinted(canopy, '#1b3823'));
    mx.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < Math.round((W * H) / 6000); i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const r = 30 + rnd() * 60;
      const g = mx.createRadialGradient(x, y, 0, x, y, r);
      const c = rnd() < 0.5 ? '74 115 66' : '14 34 20';
      g.addColorStop(0, `rgb(${c} / .45)`);
      g.addColorStop(1, `rgb(${c} / 0)`);
      mx.fillStyle = g;
      mx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Light on each mass's upper-left edge, shade on its lower right: the shape less itself moved.
    const rim = (colour: string, dx: number, dy: number, blur: number) => {
      const c = tinted(canopy, colour, 0, 0, blur);
      const x = c.getContext('2d')!;
      x.globalCompositeOperation = 'destination-out';
      x.drawImage(canopy, dx * D, dy * D);
      return c;
    };
    put(mx, rim('rgb(110 155 92 / .32)', 5, 5, 4));
    put(mx, rim('rgb(4 14 8 / .45)', -5, -5, 4));
    // Crowns: finer merged blobs inside the masses, a little lighter, each with a soft shade below.
    const [crownSeed, cs] = layer();
    cs.fillStyle = '#000';
    for (let i = 0; i < Math.round((W * H) / 70); i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const r = 1.6 + rnd() * 2.6;
      cs.beginPath();
      cs.ellipse(x, y, r * 1.4, r, rnd() * Math.PI, 0, Math.PI * 2);
      cs.fill();
    }
    const crowns = blurred(crownSeed, 2 * D);
    {
      const cx = crowns.getContext('2d', { willReadFrequently: true })!;
      const px = cx.getImageData(0, 0, crowns.width, crowns.height);
      for (let i = 3; i < px.data.length; i += 4) {
        const a = px.data[i];
        px.data[i] = a < 110 ? 0 : a > 150 ? 255 : ((a - 110) * 255) / 40;
      }
      cx.putImageData(px, 0, 0);
    }
    put(mx, tinted(crowns, 'rgb(2 10 5 / .35)', 1.5, 2, 1.5));
    put(mx, tinted(crowns, 'rgb(58 96 56 / .55)', 0, 0, 0.6));
    // Leaf grain, on the canopy only.
    grain(mx, 0.55);
    mx.globalCompositeOperation = 'destination-in';
    put(mx, canopy);
    put(ctx, mass);
  }
  grain(ctx, 0.2);

  // 4. Water: deep in the middle, lighter at the shore, a thin bright edge.
  for (const p of water) {
    ctx.save();
    ctx.clip(p, 'evenodd');
    const wg = ctx.createLinearGradient(0, 0, 0, H);
    wg.addColorStop(0, '#174b56');
    wg.addColorStop(1, '#0d2f39');
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, W, H);
    const [c, x] = layer();
    x.lineWidth = 12;
    x.strokeStyle = 'rgb(70 130 120 / .55)';
    x.stroke(p);
    put(ctx, blurred(c, 6 * D));
    ctx.restore();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgb(190 225 210 / .35)';
    ctx.stroke(p);
  }

  // 5. A thin white line round the play, a few metres out.
  {
    const [c, x] = layer();
    x.lineJoin = 'round';
    x.fillStyle = x.strokeStyle = '#fff';
    x.lineWidth = 15.5;
    for (const p of [...fairways, ...greens]) {
      x.stroke(p);
      x.fill(p);
    }
    x.globalCompositeOperation = 'destination-out';
    x.lineWidth = 13;
    for (const p of [...fairways, ...greens]) {
      x.stroke(p);
      x.fill(p);
    }
    ctx.save();
    ctx.globalAlpha = 0.75;
    put(ctx, c);
    ctx.restore();
  }

  /** Bands across the line of play, `step` apart and `width` wide. */
  const stripes = (step: number, width: number, colour: string) => {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(across);
    ctx.fillStyle = colour;
    const reach = Math.hypot(W, H);
    for (let u = -reach; u < reach; u += step) ctx.fillRect(u, -reach, width, reach * 2);
    ctx.restore();
  };
  // 6. Fairways: first cut with a soft gradient along the hole, broad mowing stripes, a darker inner edge.
  for (const p of fairways) {
    ctx.save();
    ctx.clip(p);
    const fg = ctx.createLinearGradient(ax, ay, bx, by);
    fg.addColorStop(0, '#4a8139');
    fg.addColorStop(1, '#5e9a49');
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, W, H);
    stripes(22, 11, 'rgb(255 255 255 / .06)');
    const [c, x] = layer();
    x.lineWidth = 6;
    x.strokeStyle = 'rgb(10 30 15 / .35)';
    x.stroke(p);
    put(ctx, blurred(c, 3 * D));
    ctx.restore();
  }
  // 7. Tees.
  for (const p of tees) {
    ctx.fillStyle = '#5c9847';
    ctx.fill(p);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgb(255 255 255 / .25)';
    ctx.stroke(p);
  }
  // 8. Greens: a fringe, then the putting surface with fine stripes.
  for (const p of greens) {
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#3f7a37';
    ctx.stroke(p);
    ctx.save();
    ctx.clip(p);
    ctx.fillStyle = '#76b75d';
    ctx.fillRect(0, 0, W, H);
    stripes(6, 3, 'rgb(255 255 255 / .05)');
    ctx.restore();
  }
  // 9. Bunkers: pale sand, a lip shadow on the near side, a thin dark edge.
  for (const p of bunkers) {
    ctx.fillStyle = '#e4d9bd';
    ctx.fill(p);
    ctx.save();
    ctx.clip(p);
    const [c, x] = layer();
    x.lineWidth = 5;
    x.strokeStyle = 'rgb(95 75 40 / .55)';
    x.stroke(p);
    put(ctx, blurred(c, 2.5 * D), 1.6, 1.8);
    ctx.restore();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgb(40 50 30 / .45)';
    ctx.stroke(p);
  }
  grain(ctx, 0.18);

  // 10. The line of play, dotted (the drawing above has its markers and flag).
  ctx.save();
  ctx.setLineDash([1.5, 5]);
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgb(255 255 255 / .9)';
  ctx.stroke(linePath);
  ctx.restore();

  // 11. The screen's own shading, so the glass above and below reads: a little darker at the top and the bottom.
  const top = ctx.createLinearGradient(0, 0, 0, 150);
  top.addColorStop(0, 'rgb(15 33 24 / .45)');
  top.addColorStop(1, 'rgb(15 33 24 / 0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 150);
  const foot = ctx.createLinearGradient(0, H * 0.45, 0, H);
  foot.addColorStop(0, 'rgb(15 33 24 / 0)');
  foot.addColorStop(1, 'rgb(15 33 24 / .45)');
  ctx.fillStyle = foot;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);
}
