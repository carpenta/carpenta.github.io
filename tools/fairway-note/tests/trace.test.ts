import { describe, expect, it } from 'vitest';
import { lineLength, ringArea, ringCentroid, type Pt } from '../src/osm-geo';
import { blobs, implausible, majority, outerEdge, shapeOf, toMetres, type Grid } from '../src/trace-geo';

/** A grid from rows of '#' (on) and '.' (off). */
const grid = (rows: string[]): Grid => {
  const h = rows.length;
  const w = rows[0].length;
  const on = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => (on[y * w + x] = c === '#' ? 1 : 0)));
  return { w, h, on };
};
const disc = (w: number, h: number, cx: number, cy: number, r: number): Grid => {
  const on = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) on[y * w + x] = (x - cx) ** 2 + (y - cy) ** 2 <= r * r ? 1 : 0;
  return { w, h, on };
};

describe('majority', () => {
  it('drops a lone speck and keeps a solid block', () => {
    const g = grid(['.......', '.#.....', '.......', '...###.', '...###.', '...###.', '.......']);
    const out = majority(g, 1);
    expect(out.on[1 * 7 + 1]).toBe(0);
    expect(out.on[4 * 7 + 4]).toBe(1);
  });
});

describe('outerEdge', () => {
  it('walks a rectangle round its corners and back', () => {
    const g = grid(['.....', '.###.', '.###.', '.....']);
    const ring = outerEdge(g, 1 * 5 + 1);
    expect(ring).toEqual([[1, 1], [2, 1], [3, 1], [3, 2], [2, 2], [1, 2]]);
  });
  it('follows a notch in an L', () => {
    const g = grid(['#..', '#..', '###']);
    const ring = outerEdge(g, 0);
    expect(new Set(ring.map((p) => p.join()))).toEqual(new Set(['0,0', '0,1', '0,2', '1,2', '2,2']));
  });
});

describe('blobs', () => {
  it('finds separate patches, largest first, and leaves out the small ones', () => {
    const g = grid(['##....', '##..#.', '......', '.####.', '.####.', '.####.']);
    const found = blobs(g, 2, 0.1);
    expect(found.map((b) => b.area)).toEqual([12, 4]);
    expect(found[0].box).toEqual([1, 3, 4, 5]);
    expect(found[0].centre).toEqual([2.5, 4]);
  });
  it('outlines a disc close to its true area', () => {
    const [b] = blobs(disc(60, 60, 30, 30, 20), 10, 1);
    // The edge runs through the edge cells' centres, so a little inside the disc.
    expect(Math.abs(ringArea(b.ring))).toBeGreaterThan(Math.PI * 19 * 19 * 0.95);
    expect(Math.abs(ringArea(b.ring))).toBeLessThan(Math.PI * 20 * 20);
    expect(b.ring.length).toBeLessThan(40);
  });
  it('tells a rectangle (a label) from a round patch (a bunker), and a strip (a path) by its stretch', () => {
    const [box] = blobs(grid(['......', '.####.', '.####.', '......']), 1);
    expect(shapeOf(box).fill).toBe(1);
    // A label: a box with its text cut out is still a rectangle by its edge.
    const [label] = blobs(grid(['.......', '.#####.', '.#.#.#.', '.#####.', '.......']), 1, 0.1);
    expect(shapeOf(label).fill).toBeLessThan(1);
    expect(shapeOf(label).outline).toBe(1);
    const [round] = blobs(disc(30, 30, 15, 15, 10), 1);
    expect(shapeOf(round).fill).toBeLessThan(0.85);
    const [strip] = blobs(grid(['.#########################.']), 1);
    expect(shapeOf(strip).stretch).toBe(25);
  });
});

describe('toMetres', () => {
  const near = (p: Pt, q: Pt) => {
    expect(p[0]).toBeCloseTo(q[0], 6);
    expect(p[1]).toBeCloseTo(q[1], 6);
  };
  /** A square of side 2s round (x, y). */
  const sq = (x: number, y: number, s: number): Pt[] => [[x - s, y - s], [x + s, y - s], [x + s, y + s], [x - s, y + s]];
  it('puts the green at the origin, the tee south of it as in the image, at the official length', () => {
    const m = toMetres({ greens: [sq(100, 50, 10)], tees: [sq(100, 450, 5)], fairways: [], bunkers: [sq(130, 60, 6)], water: [] }, 400);
    expect(m.scale).toBeCloseTo(1, 6);
    near(ringCentroid(m.greens[0]), [0, 0]);
    near(ringCentroid(m.tees[0]), [0, -400]);
    expect(lineLength(m.line)).toBeCloseTo(400, 0);
    // East of the green and a little south: right and down in the image.
    near(ringCentroid(m.bunkers[0]), [30, -10]);
    expect(m.water).toEqual([]);
  });
  it('bends the line through a fairway off the straight, and scales by the bent length', () => {
    const fairway: Pt[] = [[160, 380], [220, 380], [220, 140], [160, 140]];
    const m = toMetres({ greens: [sq(100, 50, 10)], tees: [sq(100, 450, 5)], fairways: [fairway], bunkers: [], water: [] }, 450);
    expect(lineLength(m.line)).toBeCloseTo(450, 0);
    expect(Math.max(...m.line.map((p) => p[0]))).toBeGreaterThan(40);
  });
  it('refuses a hole with no green', () => {
    expect(() => toMetres({ greens: [], tees: [[[0, 0], [1, 0], [1, 1]]], fairways: [], bunkers: [], water: [] }, 300)).toThrow();
  });
});

describe('implausible', () => {
  it('passes a hole of usual sizes and names a green far too big', () => {
    const ring = (s: number): Pt[] => [[-s, -s], [s, -s], [s, s], [-s, s]];
    const base = { scale: 1, line: [[0, -300], [0, 0]] as Pt[], tees: [ring(5)], fairways: [ring(20)], bunkers: [ring(8)], water: [] };
    expect(implausible({ ...base, greens: [ring(14)] })).toEqual([]);
    expect(implausible({ ...base, greens: [ring(40)] })).toEqual(['green 6400 m²']);
  });
});
