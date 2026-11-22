import { lineLength, ringArea, ringCentroid, simplifyRing, type Pt } from './osm-geo';

/**
 * Tracing a hole from a course's official hole map (the 핀크스 pilot): pure geometry on a classified pixel grid, used by
 * scripts/trace-holes.mjs, which reads the pixels in a browser. Everything here works in image pixels (x right, y down)
 * until `toMetres` turns a traced hole into the metres east and north of its green that src/data/osm/ uses.
 */

/** A binary mask over a W×H grid. */
export interface Grid {
  w: number;
  h: number;
  on: Uint8Array;
}

/** Each cell kept where more than half of the (2r+1)² square around it is on: speckles and thin text go. */
export function majority(g: Grid, r: number): Grid {
  const { w, h, on } = g;
  const W = w + 1;
  const sum = new Int32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += on[y * w + x];
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const n = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      out[y * w + x] = n * 2 > (x1 - x0) * (y1 - y0) ? 1 : 0;
    }
  }
  return { w, h, on: out };
}

/** A 4-connected patch of on cells. */
export interface Blob {
  area: number;
  /** min x, min y, max x, max y (inclusive). */
  box: [number, number, number, number];
  /** The cells' mean position. */
  centre: Pt;
  /** Its outer edge through cell centres, simplified; holes inside it are ignored. */
  ring: Pt[];
}

/** The patches of at least `minArea` cells, largest first, each with its outer edge simplified to `tol` px. */
export function blobs(g: Grid, minArea: number, tol = 1.5): Blob[] {
  const { w, h, on } = g;
  const seen = new Uint8Array(w * h);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!on[start] || seen[start]) continue;
    let area = 0;
    let sx = 0;
    let sy = 0;
    const box: [number, number, number, number] = [w, h, -1, -1];
    const cells: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const x = i % w;
      const y = (i - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < box[0]) box[0] = x;
      if (y < box[1]) box[1] = y;
      if (x > box[2]) box[2] = x;
      if (y > box[3]) box[3] = y;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && on[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (area < minArea) continue;
    // Walk the edge of this patch alone, so a neighbour touching it only at a corner does not join the walk.
    const only = new Uint8Array(w * h);
    for (const i of cells) only[i] = 1;
    // `start` is the patch's first cell in reading order, its top-left: where the walk begins.
    out.push({ area, box, centre: [sx / area, sy / area], ring: simplifyRing(outerEdge({ w, h, on: only }, start), tol) });
  }
  return out.sort((a, b) => b.area - a.area);
}

/** The 8 neighbours clockwise on screen (y down), from west. */
const AROUND: readonly Pt[] = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
const dirOf = (dx: number, dy: number) => AROUND.findIndex(([a, b]) => a === dx && b === dy);

/** Moore-neighbour walk round the patch whose top-left cell is `start`, as cell centres, clockwise on screen. */
export function outerEdge(g: Grid, start: number): Pt[] {
  const { w, h, on } = g;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && on[y * w + x] === 1;
  const sx = start % w;
  const sy = (start - sx) / w;
  const ring: Pt[] = [[sx, sy]];
  let cx = sx;
  let cy = sy;
  // The cell we came round from, as a direction from the current one: west of a top-left cell is off.
  let back = 0;
  for (let guard = 0; guard < 4 * w * h; guard++) {
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nx = cx + AROUND[d][0];
      const ny = cy + AROUND[d][1];
      if (!at(nx, ny)) continue;
      // The neighbour looked at just before this one is off, and touches the new cell: the next walk starts after it.
      const px = cx + AROUND[(d + 7) % 8][0];
      const py = cy + AROUND[(d + 7) % 8][1];
      back = dirOf(px - nx, py - ny);
      cx = nx;
      cy = ny;
      moved = true;
      break;
    }
    if (!moved || (cx === sx && cy === sy)) return ring;
    ring.push([cx, cy]);
  }
  return ring;
}

/**
 * How full a patch is of its bounding box (1 a rectangle), the same for its outer edge alone (so a label box with text
 * cut out of it is still a rectangle), and how long it is against its width.
 */
export function shapeOf(b: Blob): { fill: number; outline: number; stretch: number } {
  const bw = b.box[2] - b.box[0] + 1;
  const bh = b.box[3] - b.box[1] + 1;
  // The edge runs through the edge cells' centres, so a full box's edge encloses (bw−1)×(bh−1).
  const inner = Math.max(1, (bw - 1) * (bh - 1));
  return { fill: b.area / (bw * bh), outline: Math.abs(ringArea(b.ring)) / inner, stretch: Math.max(bw, bh) / Math.min(bw, bh) };
}

/** A hole as traced, in image pixels. */
export interface PixelHole {
  /** The back tee first, then any others. */
  tees: Pt[][];
  greens: Pt[][];
  fairways: Pt[][];
  bunkers: Pt[][];
  water: Pt[][];
}

/** A traced hole in metres east and north of its green's middle, in src/data/osm/'s shape (pairs, not yet flat). */
export interface MetreHole {
  /** Metres per image pixel. */
  scale: number;
  line: Pt[];
  greens: Pt[][];
  tees: Pt[][];
  fairways: Pt[][];
  bunkers: Pt[][];
  water: Pt[][][];
}

/**
 * The hole in metres: one scale from the official length of its back tee (tee to green along the line of play), the
 * image's up taken as north. The line runs through the fairways (osm-geo's playLine).
 */
export function toMetres(hole: PixelHole, length: number): MetreHole {
  if (!hole.greens.length || !hole.tees.length) throw new Error('a traced hole needs a green and a tee');
  const g = ringCentroid(hole.greens[0]);
  const t = ringCentroid(hole.tees[0]);
  // y down in the image, north up in the data.
  const flip = (p: Pt): Pt => [p[0] - g[0], g[1] - p[1]];
  const fair = hole.fairways.map((r) => r.map(flip));
  const linePx = aimLine(flip(t), [0, 0], fair);
  const scale = length / lineLength(linePx);
  const m = (p: Pt): Pt => [round1(p[0] * scale), round1(p[1] * scale)];
  const ring = (r: Pt[]) => r.map((p) => m(flip(p)));
  return {
    scale,
    line: linePx.map(m),
    greens: hole.greens.map(ring),
    tees: hole.tees.map(ring),
    fairways: fair.map((r) => r.map(m)),
    bunkers: hole.bunkers.map(ring),
    water: hole.water.map((r) => [ring(r)]),
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10 || 0;

/**
 * The line of play from the tee to the green through the middle of each sizeable fairway, in order along the hole. A
 * hole map's fairway often comes out as strips (its mowing pattern, lighter rough beside it), and osm-geo's playLine,
 * which follows the widest strip slice by slice, zigzags between them; the middles keep a dogleg's bend and no more.
 * Fairways under 30% of the largest (strips of lighter rough), or behind the tee or past the green, are left out.
 */
export function aimLine(tee: Pt, green: Pt, fairways: Pt[][]): Pt[] {
  const L = Math.hypot(green[0] - tee[0], green[1] - tee[1]);
  if (!fairways.length || L === 0) return [tee, green];
  const along = (p: Pt) => ((p[0] - tee[0]) * (green[0] - tee[0]) + (p[1] - tee[1]) * (green[1] - tee[1])) / L;
  const largest = Math.max(...fairways.map((f) => Math.abs(ringArea(f))));
  const mids = fairways
    .filter((f) => Math.abs(ringArea(f)) >= largest * 0.3)
    .map(ringCentroid)
    .filter((c) => along(c) > L * 0.1 && along(c) < L * 0.9)
    .sort((a, b) => along(a) - along(b));
  return [tee, ...mids, green];
}

/** What looks wrong in a traced hole's sizes, as a check on the trace and its scale; empty when it looks like a hole. */
export function implausible(h: MetreHole): string[] {
  const why: string[] = [];
  const area = (r: Pt[]) => Math.abs(ringArea(r));
  const green = area(h.greens[0]);
  if (green < 200 || green > 2000) why.push(`green ${Math.round(green)} m²`);
  for (const f of h.fairways) if (area(f) < 300) why.push(`fairway ${Math.round(area(f))} m²`);
  for (const b of h.bunkers) if (area(b) > 1500) why.push(`bunker ${Math.round(area(b))} m²`);
  return why;
}
