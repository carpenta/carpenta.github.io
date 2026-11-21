import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import data from '../src/data/osm/everis.json';
import mapping from '../src/data/osm/everis-holes.json';
import { COURSES } from '../src/courses';
import { osmShape, osmSvg, orientedHole, type ArtBand, type Box, type CourseFrame, type OsmHole } from '../src/course-art';
import { inRing, lineLength, orienter, playLine, pointFromEnd, projector, ringCentroid, segmentDistance, simplifyLine, simplifyRing, type Pt } from '../src/osm-geo';
import { osmHoleAt, osmLoading } from '../src/osm-holes';
import type { RoundCourse } from '../src/round';

const pairs = (flat: number[]): Pt[] => Array.from({ length: flat.length / 2 }, (_, i) => [flat[2 * i], flat[2 * i + 1]]);
const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const holes = data.holes as Record<string, (OsmHole | null)[]>;
const everis = COURSES.find((c) => c.id === 'everis')!;

describe('projection (v27)', () => {
  // Everis lies at about 33.37° N; the metres per degree are the WGS 84 ellipsoid's there.
  const p = projector(33.3744, 126.3615);

  it('gives metres east and north on the WGS 84 ellipsoid', () => {
    const [x0, y0] = p(33.3744, 126.3615);
    expect([x0, y0]).toEqual([0, 0]);
    const north = p(33.3754, 126.3615);
    near(north[0], 0, 1e-9);
    near(north[1], 110.91, 0.02);
    const east = p(33.3744, 126.3625);
    near(east[0], 93.05, 0.02);
    near(east[1], 0, 1e-9);
  });

  it('agrees with a great-circle distance across the course within 0.5%', () => {
    const [x, y] = p(33.3804, 126.3545);
    const rad = Math.PI / 180;
    const dLat = (33.3804 - 33.3744) * rad;
    const dLon = (126.3545 - 126.3615) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(33.3744 * rad) * Math.cos(33.3804 * rad) * Math.sin(dLon / 2) ** 2;
    const great = 2 * 6371008.8 * Math.asin(Math.sqrt(h));
    expect(Math.abs(Math.hypot(x, y) - great) / great).toBeLessThan(0.005);
  });
});

describe('simplification (v27)', () => {
  it('drops points that add nothing to a line and keeps its corners and ends', () => {
    expect(simplifyLine([[0, 0], [1, 0.05], [2, 0], [3, 5]], 0.1)).toEqual([[0, 0], [2, 0], [3, 5]]);
    expect(simplifyLine([[0, 0], [5, 5]], 1)).toEqual([[0, 0], [5, 5]]);
  });

  it('keeps a ring within the tolerance, open-ended and never thinner than a triangle', () => {
    const circle: Pt[] = Array.from({ length: 72 }, (_, i) => [10 * Math.cos((i / 72) * 2 * Math.PI), 10 * Math.sin((i / 72) * 2 * Math.PI)]);
    const out = simplifyRing(circle, 0.5);
    expect(out.length).toBeLessThan(20);
    expect(out.length).toBeGreaterThanOrEqual(3);
    // Every point of the original lies within the tolerance of the simplified outline.
    const edge = (q: Pt) => Math.min(...out.map((a, i) => segmentDistance(q, a, out[(i + 1) % out.length])));
    for (const q of circle) expect(edge(q)).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(out[0]).not.toEqual(out[out.length - 1]);
    // A ring given with its first point repeated at the end drops the repeat; a sliver stays a triangle.
    expect(simplifyRing([[0, 0], [4, 0], [4, 3], [0, 0]], 0.1)).toEqual([[0, 0], [4, 0], [4, 3]]);
    expect(simplifyRing([[0, 0], [10, 0.1], [20, 0], [10, -0.1]], 5)).toHaveLength(3);
  });
});

describe('orientation and the line of play (v27)', () => {
  it('turns a hole so its tee is below its green, and left stays left', () => {
    // Tee 100 m east of the green: facing west from the tee, north is on the right.
    const o = orienter([[100, 0], [0, 0]]);
    const [tu, tv] = o([100, 0]);
    near(tu, 0, 1e-9);
    near(tv, 100, 1e-9);
    near(Math.hypot(...o([0, 0])), 0, 1e-9);
    near(o([0, 10])[0], 10, 1e-9);
    near(o([0, -10])[0], -10, 1e-9);
    // Beyond the green is up the screen (negative v).
    expect(o([-20, 0])[1]).toBeLessThan(0);
  });

  it('measures the 100 m and 150 m points along the line, not straight across', () => {
    const dogleg: Pt[] = [[0, 0], [0, 100], [60, 180]];
    expect(lineLength(dogleg)).toBeCloseTo(200, 9);
    expect(pointFromEnd(dogleg, 100)).toEqual([0, 100]);
    expect(pointFromEnd(dogleg, 150)).toEqual([0, 50]);
    expect(pointFromEnd(dogleg, 250)).toBeNull();
  });

  it('follows the middle of a fairway that bends, and a hole with none is the straight line', () => {
    // A fairway that runs north and then bends east toward a green at (120, 200).
    const fairway: Pt[] = [[-12, 30], [12, 30], [12, 150], [110, 170], [110, 190], [-12, 175]];
    const line = playLine([0, 0], [120, 200], [fairway]);
    expect(line[0]).toEqual([0, 0]);
    expect(line[line.length - 1]).toEqual([120, 200]);
    // It passes down the fairway's middle (x = 0 in its northward stretch) where the straight line would cut across the rough.
    const off = (q: Pt) => Math.min(...line.slice(1).map((p, i) => segmentDistance(q, line[i], p)));
    expect(off([0, 90])).toBeLessThan(3);
    expect(off([0, 120])).toBeLessThan(3);
    expect(lineLength(line)).toBeGreaterThan(Math.hypot(120, 200));
    expect(playLine([0, 0], [0, 150], [])).toEqual([[0, 0], [0, 150]]);
  });
});

describe('the Everis holes from OpenStreetMap (v27)', () => {
  // The tolerance stated in docs/DESIGN.md: the measured line of play within 8% of the official length (the widest gap,
  // 새별 8, is −6.9%: no tee in OSM sits farther back).
  const TOLERANCE = 0.08;

  it('maps 25 of the 27 holes, each with the official par and its length within 8%', () => {
    const mapped = mapping.holes.filter((h) => 'tees' in h);
    expect(mapped).toHaveLength(25);
    for (const h of mapping.holes) {
      const nine = everis.nines.find((n) => n.id === h.nine)!;
      const entry = holes[h.nine][h.hole - 1];
      const where = `${nine.name.ko} ${h.hole}`;
      expect(h.par, where).toBe(nine.par[h.hole - 1]);
      if (!('tees' in h)) {
        expect(entry, where).toBeNull();
        expect((h as { unmatched?: string }).unmatched, where).toMatch(/schematic/);
        continue;
      }
      expect(entry, where).not.toBeNull();
      const official = nine.holes![h.hole - 1]!.distances![0];
      expect(official.unit).toBe('m');
      const measured = lineLength(pairs(entry!.line));
      expect(Math.abs(measured - official.length) / official.length, `${where}: ${measured.toFixed(0)} m vs ${official.length} m`).toBeLessThanOrEqual(TOLERANCE);
      // A par 3 has no fairway of its own on the way, and is shorter than any par 4 here.
      if (h.par === 3) expect(measured, where).toBeLessThan(200);
      expect((h as { evidence?: string }).evidence, where).toMatch(/^Par \d, \d+ m; /);
    }
    expect(Object.values(holes).flat().filter(Boolean)).toHaveLength(25);
  });

  it('runs each line of play from a back tee to the middle of the greens', () => {
    for (const [nine, list] of Object.entries(holes)) {
      list.forEach((h, i) => {
        if (!h) return;
        const line = pairs(h.line);
        const end = line[line.length - 1];
        near(end[0], 0, 0.05);
        near(end[1], 0, 0.05);
        // The first point is the back tee's middle: the farthest tee from the greens.
        const tees = h.tees.map((t) => ringCentroid(pairs(t)));
        const back = tees.reduce((far, c) => (Math.hypot(...c) > Math.hypot(...far) ? c : far));
        expect(Math.hypot(line[0][0] - back[0], line[0][1] - back[1]), `${nine} ${i + 1}`).toBeLessThan(1);
        expect(h.greens.length, `${nine} ${i + 1}`).toBe(2);
      });
    }
  });

  it('keeps the OSM ids it used, the mapping’s tees, greens and fairways among them', () => {
    for (const h of mapping.holes) {
      if (!('tees' in h)) continue;
      const entry = holes[h.nine][h.hole - 1]!;
      expect(entry.osm.tees).toEqual(h.tees!.map((id) => `w${id}`));
      expect(entry.osm.greens).toEqual(h.greens!.map((id) => `w${id}`));
      expect(entry.osm.fairways).toEqual((h.fairways ?? []).map((id) => `w${id}`));
      for (const id of Object.values(entry.osm).flat()) expect(id).toMatch(/^[wr]\d+$/);
      expect(entry.bunkers).toHaveLength(entry.osm.bunkers.length);
      expect(entry.water).toHaveLength(entry.osm.water.length);
    }
  });

  it('says where the data comes from, under which licence and when, beside the data', () => {
    expect(data.licence).toBe('ODbL-1.0');
    expect(data.attribution).toBe('© OpenStreetMap contributors');
    const readme = readFileSync(new URL('../src/data/osm/README.md', import.meta.url), 'utf8');
    for (const words of ['ODbL 1.0', '© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright', 'way(593260890)', 'out geom;', data.osmBase]) expect(readme).toContain(words);
  });

  it('stays small and whole: every outline at least a triangle, every number finite', () => {
    expect(statSync(new URL('../src/data/osm/everis.json', import.meta.url)).size).toBeLessThan(100_000);
    for (const h of Object.values(holes).flat()) {
      if (!h) continue;
      for (const ring of [...h.greens, ...h.tees, ...h.fairways, ...h.bunkers, ...h.water.flat()]) {
        expect(ring.length % 2).toBe(0);
        expect(ring.length).toBeGreaterThanOrEqual(6);
        for (const n of ring) expect(Number.isFinite(n)).toBe(true);
      }
    }
  });

  it('loads a course’s outlines once, on first use, and only for a course that has them', async () => {
    expect(osmLoading('ecoland')).toBeNull();
    expect(osmLoading(null)).toBeNull();
    const round: RoundCourse = { id: 'everis', name: '에버리스 골프리조트', front: '새별', back: '레이크' };
    const wait = osmLoading('everis');
    expect(wait).toBeInstanceOf(Promise);
    expect(osmLoading('everis')).toBe(wait);
    await wait;
    expect(osmLoading('everis')).toBeNull();
    // The same entries the data file holds.
    expect(osmHoleAt(round, 0)).toEqual(holes.saebyul[0]);
  });

  it('finds a round’s hole by its nine, and nothing for a hole, course or name OSM does not draw', async () => {
    await osmLoading('everis');
    const round: RoundCourse = { id: 'everis', name: '에버리스 골프리조트', front: '새별', back: '레이크' };
    expect(osmHoleAt(round, 0)).toEqual(holes.saebyul[0]);
    expect(osmHoleAt(round, 9)).toEqual(holes.lake[0]);
    // 레이크 4 and 5 stay on the schematic; 레이크 6 is drawn.
    expect(osmHoleAt(round, 12)).toBeNull();
    expect(osmHoleAt(round, 13)).toBeNull();
    expect(osmHoleAt(round, 14)).toEqual(holes.lake[5]);
    expect(osmHoleAt({ ...round, front: '파인' }, 4)).toEqual(holes.pine[4]);
    expect(osmHoleAt({ id: 'ecoland', name: '에코랜드 골프클럽', front: '와일드', back: '비치힐스' }, 0)).toBeNull();
    expect(osmHoleAt({ id: null, name: '동네 골프장', front: '', back: '' }, 0)).toBeNull();
    expect(osmHoleAt({ ...round, front: '없는 코스' }, 0)).toBeNull();
  });
});

/**
 * The band 기록 shows the drawing in (v33), as main.ts measures it at each size (`artBand`): under the chip row, above the
 * entry sheet, across its width, with the © OpenStreetMap credit at its bottom left: its text 6px above the sheet on the
 * card's content edge (x 32 to 138.6, 20px tall), and its touch area 4px either side of it, 6px under it and up to 14px
 * over it (--credit-reach, 4px on the 32px band).
 */
const credit = (y1: number, reach: number) => ({
  text: { x0: 32, y0: y1 - 26, x1: 138.59, y1: y1 - 6 },
  touch: { x0: 28, y0: y1 - 26 - reach, x1: 142.59, y1 },
});
const BANDS: [string, ArtBand][] = [
  ['390×844 기본', { x0: 16, y0: 106, x1: 374, y1: 316, keep: [], credit: credit(316, 14) }],
  ['390×844 상세', { x0: 16, y0: 106, x1: 374, y1: 278, keep: [], credit: credit(278, 14) }],
  ['390×664 기본', { x0: 16, y0: 106, x1: 374, y1: 162, keep: [], credit: credit(162, 14) }],
  ['375×667 기본', { x0: 16, y0: 106, x1: 359, y1: 165, keep: [], credit: credit(165, 14) }],
  ['375×667 상세', { x0: 16, y0: 106, x1: 359, y1: 153, keep: [], credit: credit(153, 14) }],
  ['360×640 기본', { x0: 16, y0: 106, x1: 344, y1: 138, keep: [], credit: credit(138, 4) }],
];
const frameOf = (b: ArtBand): CourseFrame => ({ width: b.x1 + 16, height: 844, bandTop: b.y0, bandBottom: b.y1, right: b.x1 });
const inside = ([x, y]: Pt, b: Box, tol = 0.5) => x >= b.x0 - tol && x <= b.x1 + tol && y >= b.y0 - tol && y <= b.y1 + tol;
const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const inBox = ([x, y]: Pt, b: Box) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;
/** Points every `step` px round a ring, so a box between two of its corners is not missed. */
const dense = (ring: Pt[], step = 2): Pt[] => ring.flatMap((a, i) => {
  const b = ring[(i + 1) % ring.length];
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  return Array.from({ length: n }, (_, k): Pt => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
});
const grow = (ring: Pt[], k: number): Pt[] => {
  const [cx, cy] = ringCentroid(ring);
  return ring.map(([x, y]): Pt => [cx + (x - cx) * k, cy + (y - cy) * k]);
};
const shrink = (b: Box, d: number): Box => ({ ...b, x0: b.x0 + d, y0: b.y0 + d, x1: b.x1 - d, y1: b.y1 - d });
const mirror = (b: Box, band: Box): Box => ({ x0: band.x0 + band.x1 - b.x1, y0: b.y0, x1: band.x0 + band.x1 - b.x0, y1: b.y1 });
/** What the flag takes (pinSvg): the pole in its 3.8px edge, the cup and the pennant to its right. */
const flagBox = (p: { x: number; y: number; pole: number }): Box => ({ x0: p.x - 3.6, y0: p.y - p.pole - 1.9, x1: p.x + 1 + Math.max(13, p.pole * 0.46), y1: p.y + 1.9 });
const officialLength = (nine: string, i: number) => everis.nines.find((n) => n.id === nine)!.holes![i]!.distances![0].length;
/** The share of a box with water behind it, sampled every 0.5px: in a pond and off its islands. */
const wetIn = (water: Pt[][][], b: Box) => {
  let wet = 0;
  let all = 0;
  for (let x = b.x0; x <= b.x1; x += 0.5) {
    for (let y = b.y0; y <= b.y1; y += 0.5) {
      all++;
      if (water.some((rings) => inRing([x, y], rings[0]) && !rings.slice(1).some((r) => inRing([x, y], r)))) wet++;
    }
  }
  return wet / all;
};

describe('drawing a hole from OpenStreetMap in the band 기록 shows (v33)', () => {
  const tall = BANDS[0][1];
  const first = holes.saebyul[0]!;

  it('lays the hole across the band: the back tee at the left, the greens’ middle at the right on one line, one scale', () => {
    const s = osmShape(first, 0, tall, 381);
    expect(s.tee[0]).toBeLessThan(s.green[0]);
    near(s.tee[1], s.green[1], 0.5);
    expect(s.line[0]).toEqual(s.tee);
    expect(s.line[s.line.length - 1]).toEqual(s.green);
    const L = Math.hypot(...pairs(first.line)[0]);
    near(s.scale, (s.green[0] - s.tee[0]) / L, 1e-6);
  });

  // The whole hole in sight (v33): v31 drew the tee behind 다음 홀, where the card covers it, and
  // let a bunker behind 새별 1's greens run up under the Par chip. One expect over every hole and size, so it runs fast.
  it('fits every tee, green with its fringe, fairway with its cut, bunker, flag and marker of every hole in the band, off the credit', () => {
    const problems: string[] = [];
    for (const [size, band] of BANDS) {
      for (const [nine, list] of Object.entries(holes)) {
        list.forEach((h, i) => {
          if (!h) return;
          const where = `${nine} ${i + 1} at ${size}`;
          const s = osmShape(h, i, band, officialLength(nine, i));
          const kept = [...band.keep, s.credit!.touch];
          const parts: [string, Pt[], number][] = [
            ...s.tees.map((t, j): [string, Pt[], number] => [`tee ${j}`, dense(t), 0]),
            ...s.greens.map((g, j): [string, Pt[], number] => [`green ${j}`, dense(grow(g, 1.1)), 0]),
            ...s.fairways.map((fw, j): [string, Pt[], number] => [`fairway ${j}`, dense(fw), 4]),
            ...s.bunkers.map((b, j): [string, Pt[], number] => [`bunker ${j}`, dense(b), 0]),
          ];
          for (const [what, pts, edge] of parts) {
            if (pts.some((p) => !inside(p, shrink(band, edge)))) problems.push(`${where}: ${what} leaves the band`);
            if (kept.some((k) => pts.some((p) => inBox(p, shrink(k, -edge))))) problems.push(`${where}: ${what} under the credit`);
          }
          if (!s.pin) problems.push(`${where}: no flag`);
          else {
            const flag = flagBox(s.pin);
            if (![[flag.x0, flag.y0], [flag.x1, flag.y1]].every((p) => inside(p as Pt, band))) problems.push(`${where}: flag leaves the band`);
            if (kept.some((k) => hits(flag, k))) problems.push(`${where}: flag under the credit`);
            if (!inRing([s.pin.x, s.pin.y], s.greens[s.flagged])) problems.push(`${where}: pin off its green`);
          }
          // At least 6px under the chip row (the v33 critique: 2–3px read as crowding the chips, a pill as a fourth chip).
          const top = Math.min(...parts.map(([, pts, edge]) => Math.min(...pts.map((p) => p[1])) - edge), ...(s.pin ? [flagBox(s.pin).y0] : []), ...s.markers.map((m) => m.label.y0));
          if (top < band.y0 + 6 - 0.5) problems.push(`${where}: ${(top - band.y0).toFixed(1)}px under the chips`);
          // Both pills on one side of the line (the critique: one above and one below read as unrelated).
          if (s.markers.length === 2 && (s.markers[0].label.y1 <= s.markers[0].y) !== (s.markers[1].label.y1 <= s.markers[1].y)) problems.push(`${where}: pills on both sides`);
          const labels: Box[] = [];
          for (const m of s.markers) {
            const dot: Box = { x0: m.x - 6.25, y0: m.y - 6.25, x1: m.x + 6.25, y1: m.y + 6.25 };
            for (const [what, b] of [['dot', dot], ['label', m.label]] as const) {
              if (!inside([b.x0, b.y0], band) || !inside([b.x1, b.y1], band)) problems.push(`${where}: ${m.d} m ${what} leaves the band`);
              if (kept.some((k) => hits(b, k))) problems.push(`${where}: ${m.d} m ${what} under the credit`);
              if (s.pin && hits(b, flagBox(s.pin))) problems.push(`${where}: ${m.d} m ${what} on the flag`);
            }
            if (labels.some((l) => hits(l, m.label))) problems.push(`${where}: ${m.d} m label on another`);
            labels.push(m.label);
          }
        });
      }
    }
    expect(problems).toEqual([]);
  });

  // Centred in the room unless water would lie behind the credit's gray text there: then moved within the room (v33).
  it('draws it as large as the room left beside the credit allows, centred there unless that puts water behind the credit', () => {
    for (const [size, band] of BANDS) {
      for (const [nine, list] of Object.entries(holes)) {
        list.forEach((h, i) => {
          if (!h) return;
          const where = `${nine} ${i + 1} at ${size}`;
          const s = osmShape(h, i, band, null);
          const room = s.room;
          expect(inside([room.x0, room.y0], band) && inside([room.x1, room.y1], band), where).toBe(true);
          expect([...band.keep, s.credit!.touch].some((k) => hits(room, k)), where).toBe(false);
          // What the scale fits: the tees, the greens' fringes, the fairways with their cut, the bunkers and the flag.
          const pts = [...s.tees.flat(), ...s.greens.flatMap((g) => grow(g, 1.1)), ...s.bunkers.flat()];
          const cut = s.fairways.flat();
          const flag = flagBox(s.pin!);
          const x0 = Math.min(...pts.map((p) => p[0]), ...cut.map((p) => p[0] - 4), flag.x0);
          const x1 = Math.max(...pts.map((p) => p[0]), ...cut.map((p) => p[0] + 4), flag.x1);
          const y0 = Math.min(...pts.map((p) => p[1]), ...cut.map((p) => p[1] - 4), flag.y0);
          const y1 = Math.max(...pts.map((p) => p[1]), ...cut.map((p) => p[1] + 4), flag.y1);
          expect(x0 >= room.x0 - 0.5 && x1 <= room.x1 + 0.5 && y0 >= room.y0 - 0.5 && y1 <= room.y1 + 0.5, `${where} within its room`).toBe(true);
          // As large as it can be: it fills the room one way, within 1px, and is centred the other way, unless centred it
          // had water behind the credit's text.
          const fillsX = Math.abs(x1 - x0 - (room.x1 - room.x0)) <= 1;
          const fillsY = Math.abs(y1 - y0 - (room.y1 - room.y0)) <= 1;
          expect(fillsX || fillsY, `${where} fills its room`).toBe(true);
          const off: Pt = [(room.x0 + room.x1) / 2 - (x0 + x1) / 2, (room.y0 + room.y1) / 2 - (y0 + y1) / 2];
          if (Math.abs(off[0]) > 1 || Math.abs(off[1]) > 1) {
            const centred = s.water.map((w) => w.map((r) => r.map(([x, y]): Pt => [x + off[0], y + off[1]])));
            expect(wetIn(centred, s.credit!.text), `${where}: moved ${off.map((v) => v.toFixed(1))} though water was not behind the credit`).toBeGreaterThan(0);
          }
        });
      }
    }
  });

  // Course markers measure to the middle of the green (the critique of v31 measured from the pin; v31 measured from the
  // green's front edge). 100 m and 150 m stand that far from the greens' middle along the line of play, at the drawing's scale.
  it('places 100 m and 150 m at their distance from the greens’ middle along the line of play, at the drawing’s scale', () => {
    let seen = 0;
    for (const [, band] of BANDS) {
      for (const [nine, list] of Object.entries(holes)) {
        list.forEach((h, i) => {
          if (!h) return;
          const s = osmShape(h, i, band, officialLength(nine, i));
          for (const m of s.markers) {
            seen++;
            let along = 0;
            let found = Infinity;
            for (let k = s.line.length - 1; k > 0; k--) {
              const [a, b] = [s.line[k], s.line[k - 1]];
              if (segmentDistance([m.x, m.y], a, b) < 0.01) {
                found = along + Math.hypot(m.x - a[0], m.y - a[1]);
                break;
              }
              along += Math.hypot(b[0] - a[0], b[1] - a[1]);
            }
            near(found, m.d * s.scale, 0.5);
          }
        });
      }
    }
    // On a tall band a par 4 shows both: 새별 1 is 381 m.
    expect(osmShape(first, 0, tall, 381).markers.map((m) => m.d)).toEqual([100, 150]);
    expect(seen).toBeGreaterThan(40);
    // A hole shorter than the marker plus 60 m shows none, as on the schematic. Something kept clear where a marker stood
    // moves the hole off it (v33: the room keeps clear of it), and no marker is drawn under it.
    expect(osmShape(first, 0, tall, 150).markers).toEqual([]);
    const m = osmShape(first, 0, tall, 381).markers[0];
    const box: Box = { x0: m.x - 2, y0: m.y - 2, x1: m.x + 2, y1: m.y + 2 };
    const kept = osmShape(first, 0, { ...tall, keep: [...tall.keep, box] }, 381);
    expect(hits(kept.room, box)).toBe(false);
    for (const k of kept.markers) expect(hits({ x0: k.x - 6.25, y0: k.y - 6.25, x1: k.x + 6.25, y1: k.y + 6.25 }, box) || hits(k.label, box), `${k.d} m`).toBe(false);
  });

  // The credit is gray text (v33), which nothing reads on water (white is 4.1:1 on it): every hole at every band keeps water
  // from behind it, the hole moved within its room or the credit at the band's other end. What neither clears is listed
  // with its share of the credit's line box, pinned so none grows and the list cannot quietly lengthen: 새별 7 in 상세 at
  // 390×844, where the island's lake meets a corner of the box at either end (gray on water is 1.85:1 there).
  it('keeps water from behind the credit’s text on every hole at every band, at the left where it can and else at the right', () => {
    const EXCEPTIONS: Record<string, number> = { 'saebyul 7 at 390×844 상세': 0.0012 };
    const found: Record<string, number> = {};
    const sides: Record<string, number> = { start: 0, end: 0 };
    for (const [size, band] of BANDS) {
      for (const [nine, list] of Object.entries(holes)) {
        list.forEach((h, i) => {
          if (!h) return;
          const s = osmShape(h, i, band, null);
          const c = s.credit!;
          sides[c.side]++;
          // At the right end its text and touch area mirror the left's across the band (the CSS stands it the card's
          // padding in from either edge).
          const want = c.side === 'start' ? band.credit! : { text: mirror(band.credit!.text, band), touch: mirror(band.credit!.touch, band) };
          expect({ text: c.text, touch: c.touch }, `${nine} ${i + 1} at ${size}`).toEqual(want);
          // At the right only where the left would have water behind it.
          if (c.side === 'end') expect(osmShape(h, i, band, null, ['start']).credit!.wet, `${nine} ${i + 1} at ${size}`).toBeGreaterThan(0);
          const wet = wetIn(s.water, c.text);
          if (wet > 0) found[`${nine} ${i + 1} at ${size}`] = wet;
        });
      }
    }
    for (const [what, share] of Object.entries(found)) expect(share, what).toBeLessThanOrEqual(EXCEPTIONS[what] ?? 0);
    expect(Object.keys(found).sort()).toEqual(Object.keys(EXCEPTIONS).sort());
    expect(sides.end).toBeGreaterThan(0);
    expect(sides.start).toBeGreaterThan(sides.end);
  });

  it('keeps the player’s left above the line of play, as the header’s small picture does', () => {
    // Tee 100 m south of the green: a bunker 20 m west of the line is on the player's left.
    const hole: OsmHole = {
      line: [0, -100, 0, 0], greens: [[-5, -5, 5, -5, 5, 5, -5, 5]], tees: [[-3, -103, 3, -103, 3, -97, -3, -97]], fairways: [],
      bunkers: [[-22, -32, -18, -32, -18, -28, -22, -28]], water: [], osm: { tees: ['w1'], greens: ['w2'], fairways: [], bunkers: ['w3'], water: [] },
    };
    const s = osmShape(hole, 0, tall, null);
    expect(ringCentroid(s.bunkers[0])[1]).toBeLessThan(s.tee[1]);
    expect(ringCentroid(s.bunkers[0])[0]).toBeGreaterThan(s.tee[0]);
  });

  it('turns and measures a hole once, however often it is drawn', () => {
    expect(orientedHole(first)).toBe(orientedHole(first));
    expect(orientedHole(holes.saebyul[1]!)).not.toBe(orientedHole(first));
  });

  it('draws in the palette’s classes, with no filter, no colour literal and no stray number', () => {
    const svg = osmSvg(osmShape(first, 0, tall, 381), frameOf(tall));
    expect(svg).toContain('class="fairway"');
    expect(svg.match(/class="green"/g)).toHaveLength(1);
    expect(svg.match(/class="green2"/g)).toHaveLength(1);
    expect(svg.match(/class="tee"/g)).toHaveLength(1);
    expect(svg.match(/class="bunker"/g)).toHaveLength(first.bunkers.length);
    expect(svg).toContain('class="flag"');
    expect(svg).not.toMatch(/<filter|fill="#|stroke="#|rgb\(|NaN|Infinity/);
  });

  it('is flat as the schematic is (v31): no gradient, pattern, mask, clip path or filter, nothing painted by url(), no grain', () => {
    const FLAT = ['a-rough-fill', 'a-cut', 'fairway', 'bunker', 'a-sand', 'pond', 'water', 'a-fringe', 'green', 'green2', 'a-cup', 'a-pole-edge', 'a-pole', 'flag', 'marker', 'a-marker', 'a-marker-label', 'tee', 'tee2', 'a-pole-fill'];
    for (const [i, h] of [[0, first], [2, holes.saebyul[2]!], [6, holes.saebyul[6]!]] as const) {
      const svg = osmSvg(osmShape(h, i, tall, null), frameOf(tall));
      expect(svg).not.toMatch(/<(linearGradient|radialGradient|pattern|mask|clipPath|filter|fe[A-Z])\b/);
      expect(svg).not.toMatch(/url\(#|\smask=|clip-path=|filter=/);
      expect(svg).not.toContain('grain');
      const classes = [...new Set([...svg.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(' ')))];
      expect(classes.filter((c) => !FLAT.includes(c)), `새별 ${i + 1}`).toEqual([]);
    }
  });

  it('keeps an island as a hole in its water', () => {
    // 새별 7: the greens stand on an island, the inner ring of the pond.
    const island = holes.saebyul[6]!;
    const s = osmShape(island, 6, tall, 159);
    const pond = s.water.find((rings) => rings.length > 1)!;
    expect(inRing(s.green, pond[0])).toBe(true);
    expect(pond.slice(1).some((inner) => inRing(s.green, inner))).toBe(true);
    expect(osmSvg(s, frameOf(tall))).toMatch(/class="water"[^>]*fill-rule="evenodd"|fill-rule="evenodd"[^>]*class="water"/);
  });
});
