import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import data from '../src/data/osm/everis.json';
import mapping from '../src/data/osm/everis-holes.json';
import { COURSES } from '../src/courses';
import { osmShape, osmSvg, orientedHole, type CourseFrame, type OsmHole } from '../src/course-art';
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

describe('drawing a hole from OpenStreetMap (v27)', () => {
  // 390×844 as main.ts measures it: the open band between the header and the card, and 다음 홀's middle.
  const frame: CourseFrame = { width: 390, height: 844, bandTop: 112, bandBottom: 316, right: 368, teeY: 752.5 };
  const first = holes.saebyul[0]!;

  it('puts the back tee behind 다음 홀 and the middle of the greens straight above it, at one scale', () => {
    const s = osmShape(first, 0, frame, 381);
    near(s.tee[0], 195, 0.5);
    near(s.tee[1], 752.5, 0.5);
    near(s.green[0], 195, 0.5);
    expect(s.green[1]).toBeGreaterThan(frame.bandTop);
    expect(s.green[1]).toBeLessThan(frame.bandBottom);
    const L = Math.hypot(...pairs(first.line)[0]);
    near(s.scale, (s.tee[1] - s.green[1]) / L, 1e-6);
    // The drawn line of play starts at the tee and ends at the greens' middle.
    expect(s.line[0]).toEqual(s.tee);
    expect(s.line[s.line.length - 1]).toEqual(s.green);
  });

  it('stands the pin inside its green, with the whole flag in the open band', () => {
    for (const [nine, list] of Object.entries(holes)) {
      list.forEach((h, i) => {
        if (!h) return;
        const s = osmShape(h, i, frame, null);
        expect(s.pin, `${nine} ${i + 1}`).not.toBeNull();
        expect(inRing([s.pin!.x, s.pin!.y], s.greens[s.flagged]), `${nine} ${i + 1}`).toBe(true);
        expect(s.pin!.y - s.pin!.pole, `${nine} ${i + 1}`).toBeGreaterThanOrEqual(frame.bandTop);
        // No green reaches more than 6px above the band, under the chip row; the tee never sits below 다음 홀's middle.
        expect(Math.min(...s.greens.flat().map((p) => p[1])), `${nine} ${i + 1}`).toBeGreaterThanOrEqual(frame.bandTop - 6 - 1e-6);
        expect(s.tee[1], `${nine} ${i + 1}`).toBeLessThanOrEqual(frame.teeY! + 1e-6);
      });
    }
  });

  it('places 100 m and 150 m along the real line, in the band and clear of what must stay readable', () => {
    // At its real scale only a long hole's approach reaches into the band: 새별 3 (par 5, 529 m) shows its 100 m marker,
    // 새별 1 (381 m) none, its 100 m point falling under the card.
    expect(osmShape(first, 0, frame, 381).markers).toEqual([]);
    const long = holes.saebyul[2]!;
    const s = osmShape(long, 2, frame, 529);
    expect(s.markers.map((m) => m.d)).toEqual([100]);
    for (const m of s.markers) {
      // Along the drawn line from the greens' middle, in px.
      let along = 0;
      let found = Infinity;
      for (let i = s.line.length - 1; i > 0; i--) {
        const [a, b] = [s.line[i], s.line[i - 1]];
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segmentDistance([m.x, m.y], a, b) < 0.01) {
          found = along + Math.hypot(m.x - a[0], m.y - a[1]);
          break;
        }
        along += seg;
      }
      near(found, m.d * s.scale, 0.5);
      expect(m.y).toBeLessThanOrEqual(frame.bandBottom - 14);
    }
    // A label that would sit under something kept clear (the © OpenStreetMap link, the version) is left out.
    const m = s.markers[0];
    const kept = osmShape(long, 2, { ...frame, keep: [{ x0: m.x, y0: m.y - 2, x1: m.x + 40, y1: m.y + 2 }] }, 529);
    expect(kept.markers.map((k) => k.d)).not.toContain(m.d);
    // So is one that would come within 8px of it: 6px from a pill to the marker's left is too close.
    const close = osmShape(long, 2, { ...frame, keep: [{ x0: m.x - 7.5 - 6 - 40, y0: m.y - 10, x1: m.x - 7.5 - 6, y1: m.y + 10 }] }, 529);
    expect(close.markers.map((k) => k.d)).not.toContain(m.d);
    const apart = osmShape(long, 2, { ...frame, keep: [{ x0: m.x - 7.5 - 9 - 40, y0: m.y - 10, x1: m.x - 7.5 - 9, y1: m.y + 10 }] }, 529);
    expect(apart.markers.map((k) => k.d)).toContain(m.d);
    // A hole shorter than the marker plus 60 m shows none, as on the schematic.
    expect(osmShape(long, 2, frame, 150).markers).toEqual([]);
  });

  it('keeps a short par 3’s greens to half a tall band and 60% of the width, its tee rising behind the card', () => {
    // 새별 4 (151 m): at its real scale from the band to 다음 홀 its two greens would fill the band.
    const s = osmShape(holes.saebyul[3]!, 3, frame, 151);
    const xs = s.greens.flat().map((p) => p[0]);
    const ys = s.greens.flat().map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(390 * 0.6 + 1e-6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual((316 - 112) * 0.5 + 1e-6);
    near(s.tee[0], 195, 1e-6);
    expect(s.tee[1]).toBeLessThan(752.5);
    expect(s.tee[1]).toBeGreaterThan(frame.bandBottom);
    // Its tee having risen, the hole comes down until the greens clear the chip row (6px may stay under its shade).
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(frame.bandTop - 6 - 1e-6);
    expect(s.pin!.y - s.pin!.pole).toBeGreaterThanOrEqual(frame.bandTop);
    // A par 4 at the same size keeps its tee behind 다음 홀.
    near(osmShape(first, 0, frame, 381).tee[1], 752.5, 0.5);
  });

  it('keeps the player’s left on the left of the screen', () => {
    // Tee 100 m south of the green: a bunker 20 m west of the line is on the player's left.
    const hole: OsmHole = {
      line: [0, -100, 0, 0], greens: [[-5, -5, 5, -5, 5, 5, -5, 5]], tees: [[-3, -103, 3, -103, 3, -97, -3, -97]], fairways: [],
      bunkers: [[-22, -32, -18, -32, -18, -28, -22, -28]], water: [], osm: { tees: ['w1'], greens: ['w2'], fairways: [], bunkers: ['w3'], water: [] },
    };
    const s = osmShape(hole, 0, frame, null);
    expect(ringCentroid(s.bunkers[0])[0]).toBeLessThan(s.tee[0]);
  });

  it('turns and measures a hole once, however often it is drawn', () => {
    expect(orientedHole(first)).toBe(orientedHole(first));
    expect(orientedHole(holes.saebyul[1]!)).not.toBe(orientedHole(first));
  });

  it('draws in the palette’s classes, with no filter, no colour literal and no stray number', () => {
    const svg = osmSvg(osmShape(first, 0, frame, 381), frame);
    expect(svg).toContain('class="fairway"');
    expect(svg.match(/class="green"/g)).toHaveLength(1);
    expect(svg.match(/class="green2"/g)).toHaveLength(1);
    expect(svg.match(/class="tee"/g)).toHaveLength(1);
    expect(svg.match(/class="bunker"/g)).toHaveLength(first.bunkers.length);
    expect(svg).toContain('class="flag"');
    expect(svg).not.toMatch(/<filter|fill="#|stroke="#|rgb\(|NaN|Infinity/);
  });

  it('keeps an island as a hole in its water', () => {
    // 새별 7: the greens stand on an island, the inner ring of the pond.
    const island = holes.saebyul[6]!;
    const s = osmShape(island, 6, frame, 159);
    const pond = s.water.find((rings) => rings.length > 1)!;
    expect(inRing(s.green, pond[0])).toBe(true);
    expect(pond.slice(1).some((inner) => inRing(s.green, inner))).toBe(true);
    expect(osmSvg(s, frame)).toMatch(/class="water"[^>]*fill-rule="evenodd"|fill-rule="evenodd"[^>]*class="water"/);
  });
});
