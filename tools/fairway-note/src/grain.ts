/**
 * The drawn course's grain (v22): seeded noise made once on a canvas and kept in the page as a `data:` PNG pattern
 * (index.html) that every hole's drawing points at. An SVG filter (feTurbulence) would draw the same, but WebKit runs
 * filters on the CPU, so on an iPhone they cost frames. The PNG holds the palette's grain tints, read from the page
 * when it is made, as the share image does.
 */

/** A colour as red, green and blue (0–255) and alpha (0–1). */
export type Rgba = [number, number, number, number];

/** A tile: its size and the size of its grain in CSS px, its seed, and how the noise turns into specks. */
export interface GrainSpec {
  css: number;
  feature: number;
  seed: number;
  /** A speck's alpha is `gain × noise − cut` (so specks only where the noise is above the middle), times its tint's. */
  gain: number;
  cut: number;
}

/** The rough and the fairway: a 64px tile of grain about a pixel across (value noise in cells of 0.6px). */
export const TURF_GRAIN: GrainSpec = { css: 64, feature: 0.6, seed: 7, gain: 2.4, cut: 1.29 };
/** A bunker's sand: finer, in a 48px tile. */
export const SAND_GRAIN: GrainSpec = { css: 48, feature: 0.5, seed: 11, gain: 2.4, cut: 1.25 };

/** mulberry32: a small seeded source of numbers in [0, 1), so the grain is the same on every visit. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Along one side of the tile: each pixel's two grid cells (wrapping, so the tile has no seam) and its smoothstep weight. */
function axis(n: number, cells: number): { i0: Int32Array; i1: Int32Array; s: Float32Array } {
  const i0 = new Int32Array(n);
  const i1 = new Int32Array(n);
  const s = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const g = (x / n) * cells;
    const k = Math.floor(g);
    const t = g - k;
    i0[x] = k % cells;
    i1[x] = (k + 1) % cells;
    s[x] = t * t * (3 - 2 * t);
  }
  return { i0, i1, s };
}

/**
 * Two fields of smooth noise at n × n pixels (one for the dark specks, one for the light), each two octaves of random
 * values on a grid that wraps at the edges: the grain, and grain half its size at half its weight. Both fields share one
 * set of weights per octave, worked out per row and column rather than per pixel.
 */
function fields(n: number, cells: number, next: () => number): [Float32Array, Float32Array] {
  const fd = new Float32Array(n * n);
  const fl = new Float32Array(n * n);
  for (const [c, w] of [[cells, 0.67], [cells * 2, 0.33]]) {
    const { i0, i1, s } = axis(n, c);
    const gd = Float32Array.from({ length: c * c }, next);
    const gl = Float32Array.from({ length: c * c }, next);
    for (let y = 0; y < n; y++) {
      const r0 = i0[y] * c;
      const r1 = i1[y] * c;
      const sy = s[y];
      for (let x = 0; x < n; x++) {
        const k00 = r0 + i0[x];
        const k01 = r0 + i1[x];
        const k10 = r1 + i0[x];
        const k11 = r1 + i1[x];
        const sx = s[x];
        const sxy = sx * sy;
        const i = y * n + x;
        fd[i] += w * (gd[k00] + (gd[k01] - gd[k00]) * sx + (gd[k10] - gd[k00]) * sy + (gd[k00] - gd[k01] - gd[k10] + gd[k11]) * sxy);
        fl[i] += w * (gl[k00] + (gl[k01] - gl[k00]) * sx + (gl[k10] - gl[k00]) * sy + (gl[k00] - gl[k01] - gl[k10] + gl[k11]) * sxy);
      }
    }
  }
  return [fd, fl];
}

/**
 * The tile's RGBA pixels at `scale` device pixels per CSS px: dark specks where one field of the noise is high and light
 * specks where another is, each at most its tint's alpha, the light laid over the dark. Seeded, so always the same.
 */
export function grainPixels(spec: GrainSpec, scale: number, dark: Rgba, light: Rgba): Uint8ClampedArray {
  const n = Math.round(spec.css * scale);
  const cells = Math.max(2, Math.round(spec.css / spec.feature));
  const [fd, fl] = fields(n, cells, seeded(spec.seed));
  const px = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const ad = Math.min(1, Math.max(0, spec.gain * fd[i] - spec.cut)) * dark[3];
    const al = Math.min(1, Math.max(0, spec.gain * fl[i] - spec.cut - 0.06)) * light[3];
    const a = al + ad * (1 - al);
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) px[i * 4 + c] = (light[c] * al + dark[c] * ad * (1 - al)) / a;
    px[i * 4 + 3] = a * 255;
  }
  return px;
}

/** The page's two tiles: each pattern's `<image>` in index.html and the palette tokens it is tinted with. */
const TILES = [
  { id: 'grain-turf', spec: TURF_GRAIN, dark: '--art-grain-dark', light: '--art-grain-light' },
  { id: 'grain-sand', spec: SAND_GRAIN, dark: '--art-sandgrain-dark', light: '--art-sandgrain-light' },
];

/** A palette token as the browser resolves it (mixes too), back as RGBA through one canvas pixel. */
function readTint(token: string, probe: HTMLElement, px: CanvasRenderingContext2D): Rgba {
  probe.style.color = `var(${token})`;
  px.clearRect(0, 0, 1, 1);
  px.fillStyle = getComputedStyle(probe).color;
  px.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = px.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

/**
 * Makes the page's grain tiles for this screen's scale (1–3), pixel for pixel. Once: again only when the scale or the
 * palette changes, so every hole reuses the same images.
 */
export function paintGrain(doc: Document = document): void {
  const scale = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  const px = doc.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!px) return;
  const probe = doc.createElement('i');
  probe.hidden = true;
  doc.body.append(probe);
  try {
    for (const t of TILES) {
      const img = doc.getElementById(t.id);
      if (!(img instanceof SVGElement)) continue;
      const dark = readTint(t.dark, probe, px);
      const light = readTint(t.light, probe, px);
      const key = [scale, ...dark, ...light].join(',');
      if (img.dataset.key === key) continue;
      const n = Math.round(t.spec.css * scale);
      const canvas = doc.createElement('canvas');
      canvas.width = n;
      canvas.height = n;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const data = ctx.createImageData(n, n);
      data.data.set(grainPixels(t.spec, scale, dark, light));
      ctx.putImageData(data, 0, 0);
      img.setAttribute('href', canvas.toDataURL('image/png'));
      img.dataset.key = key;
    }
  } finally {
    probe.remove();
  }
}
