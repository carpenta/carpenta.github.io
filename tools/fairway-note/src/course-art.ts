import { inRing, orienter, pointFromEnd, ringCentroid, type Pt } from './osm-geo';
import type { Par } from './round';

/** -1 bends the drawn hole left, 1 right. */
export type Bend = -1 | 0 | 1;

/** A dogleg named in a hole's layout note: "우 도그렉", "왼쪽 도그랙", "오른쪽으로 휘는 도그레그". */
export function layoutBend(layout: string | undefined): Bend {
  if (!layout) return 0;
  const m = /(좌|왼|우|오른)[^,.·]{0,8}도그(?:렉|랙|레그)/.exec(layout);
  if (!m) return 0;
  return m[1] === '좌' || m[1] === '왼' ? -1 : 1;
}

/**
 * An island green named in a hole's layout note ("아일랜드 홀", "호수 속 아일랜드 그린", "그린 둘러싼 연못"): water all round the
 * green. An island tee ("연못 속 아일랜드 티") is not one (v22).
 */
export function layoutIsland(layout: string | undefined): boolean {
  return /아일랜드(?!\s*티)|그린 (?:둘러싼|둘레) (?:연못|워터\s?해저드|호수)/.test(layout ?? '');
}

// ---------- Bunkers and water from the hole note (v22) ----------

export type HazardKind = 'bunker' | 'water';
export type Side = 'left' | 'right';
/** Round the green as the player facing it sees it: the front faces the tee. */
export type GreenSpot = 'front' | 'back' | 'left' | 'right' | 'front-left' | 'front-right' | 'back-left' | 'back-right' | 'around';
/** What a note's words say. A bare side ("좌측 벙커") or "ahead" ("앞 벙커") waits for the par (`holeHazards`). */
export type NamedHazard =
  | { kind: HazardKind; at: 'green'; spot: GreenSpot; count: number }
  | { kind: HazardKind; at: 'fairway' | 'side'; side: Side; count: number }
  | { kind: HazardKind; at: 'ahead'; side: Side | null; count: number }
  | { kind: 'water'; at: 'tee'; count: number };
/** A named hazard on a hole of known par: round the green, on a side of the fairway, or water in front of the tee. */
export type HoleHazard =
  | { kind: HazardKind; at: 'green'; spot: GreenSpot; count: number }
  | { kind: HazardKind; at: 'fairway'; side: Side; count: number }
  | { kind: 'water'; at: 'tee'; count: number };

type Place = 'front' | 'back' | 'left' | 'right';
/** The place words said together before a hazard ("그린 앞 좌측"), up to a "·". */
interface Group { places: Set<Place>; both: boolean; frontBack: boolean; around: '' | 'near' | 'round'; centre: boolean; unclear: boolean }

const PLACES = new Map<string, Place[]>([
  ['앞', ['front']], ['전방', ['front']], ['입구', ['front']], ['뒤', ['back']], ['후방', ['back']],
  ['좌측', ['left']], ['좌', ['left']], ['왼쪽', ['left']], ['좌중간', ['left']],
  ['우측', ['right']], ['우', ['right']], ['오른쪽', ['right']], ['우중간', ['right']],
  ['좌전방', ['front', 'left']], ['우전방', ['front', 'right']],
]);
const BOTH_SIDES = new Set(['좌우', '양쪽', '양옆']);
/** Round the green: bunkers there are drawn round it. Water that surrounds it is an island green (`layoutIsland`). */
const NEAR = new Set(['주변', '주위']);
const ROUND = new Set(['둘러싼', '둘레', '둘러싸인']);
/** The middle: in front of the green it is the front; on its own it names no place. */
const CENTRE = new Set(['중앙', '가운데']);
/** Places the drawing has no rule for: beside, near, between, across, straight ahead. */
const UNCLEAR = new Set(['옆', '근처', '사이드', '정면', '중간', '사이', '가로지르는', '크로스']);
const FAIRWAY_WORDS = new Set(['페어웨이', 'IP', 'IP2', '낙하지점', '랜딩존', '착지', '세컨', '써드', '서드']);
const TEE_WORDS = new Set(['티', '티잉', '티샷']);
const MANY = new Set(['다수', '많음', '군락', '연속']);
/** 연못, 워터해저드, 호수, 개울 and 물. A plain 해저드 can be a dry penalty area, so it is not water. */
const isWater = (word: string) => /연못|워터해저드|호수|개울/.test(word) || word === '물' || word === '물길';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** How many to draw: the note's count (2개, 다수, 더블) within a schematic few, three round a green by default; one pond. */
function howMany(kind: HazardKind, said: number, around: boolean): number {
  if (kind === 'water') return 1;
  if (around) return said < 0 ? 4 : said ? clamp(said, 2, 4) : 3;
  return said < 0 ? 2 : said ? clamp(said, 1, 3) : 1;
}

function hazardsOf(kind: HazardKind, context: 'green' | 'fairway' | 'tee' | null, groups: Group[], said: number): NamedHazard[] {
  const out: NamedHazard[] = [];
  for (const g of groups) {
    if (g.unclear || (g.centre && !g.places.has('front'))) continue;
    const sides: (Side | null)[] = g.both || (g.places.has('left') && g.places.has('right')) ? ['left', 'right'] : g.places.has('left') ? ['left'] : g.places.has('right') ? ['right'] : [null];
    const ends: ('front' | 'back' | null)[] = g.frontBack ? ['front', 'back'] : g.places.has('front') ? ['front'] : g.places.has('back') ? ['back'] : [null];
    if (g.around) {
      if (context === 'green' && kind === 'bunker' && sides[0] === null && ends[0] === null) out.push({ kind, at: 'green', spot: 'around', count: howMany(kind, said, true) });
      continue;
    }
    for (const end of ends) {
      for (const side of sides) {
        const count = howMany(kind, said, false);
        if (context === 'green') {
          const spot = end && side ? (`${end}-${side}` as GreenSpot) : (end ?? side);
          if (spot) out.push({ kind, at: 'green', spot, count });
        } else if (context === 'fairway') {
          if (!end && side) out.push({ kind, at: 'fairway', side, count });
        } else if (context === 'tee') {
          if (kind === 'water' && end === 'front' && !side) out.push({ kind, at: 'tee', count: 1 });
        } else if (end === 'front') out.push({ kind, at: 'ahead', side, count });
        else if (!end && side) out.push({ kind, at: 'side', side, count });
      }
    }
  }
  return out;
}

/** One comma-separated phrase of a note, read word by word: a place (그린, 페어웨이, 티), its sides and ends, then the hazard. */
function readPhrase(raw: string): NamedHazard[] {
  let p = raw.trim().replace(/워터\s+해저드/g, '워터해저드').replace(/(?:그라스|그래스)\s*벙커/g, '잔디');
  // Not drawn: a note saying there is none, a stretch from tee to green, and a bunker of one of two greens.
  if (!p || /없음|없는|없이|~|좌그린|우그린|두 그린|그린 사이|\([^)]*그린\)/.test(p)) return [];
  // A side in brackets after the hazard: "숨은 워터해저드(우측)".
  p = p.replace(/^(.*)\((좌측|우측)\)$/, '$2 $1');
  if (/벙커로 둘러싸인 그린/.test(p)) return [{ kind: 'bunker', at: 'green', spot: 'around', count: 3 }];
  const words = p.replace(/[()]/g, ' ').replace(/·/g, ' · ').split(/\s+/).filter(Boolean);
  // Water the tee shot carries lies in front of the tee.
  if (words.some(isWater) && words.includes('티샷') && /넘기|넘김|건너/.test(p)) return [{ kind: 'water', at: 'tee', count: 1 }];
  let context: 'green' | 'fairway' | 'tee' | null = null;
  let groups: Group[] = [];
  let group: Group | null = null;
  let afterHazard = false;
  let said = 0;
  let last: NamedHazard[] = [];
  const out: NamedHazard[] = [];
  const open = (): Group => {
    // Place words after a hazard belong to the next one ("우측 벙커 좌측 해저드").
    if (afterHazard) {
      groups = [];
      afterHazard = false;
    }
    return (group ??= { places: new Set(), both: false, frontBack: false, around: '', centre: false, unclear: false });
  };
  for (const w of words) {
    const place = PLACES.get(w);
    if (w === '·') {
      if (group) groups.push(group);
      group = null;
    } else if (w === '그린') context = 'green';
    else if (FAIRWAY_WORDS.has(w)) context = 'fairway';
    else if (TEE_WORDS.has(w)) context = 'tee';
    else if (place) for (const x of place) open().places.add(x);
    else if (BOTH_SIDES.has(w)) open().both = true;
    else if (w === '앞뒤') open().frontBack = true;
    else if (NEAR.has(w)) open().around = 'near';
    else if (ROUND.has(w)) open().around = 'round';
    else if (CENTRE.has(w)) open().centre = true;
    else if (UNCLEAR.has(w)) open().unclear = true;
    else {
      const kind: HazardKind | null = w.includes('벙커') ? 'bunker' : isWater(w) ? 'water' : null;
      const n = /^(\d+)개$/.exec(w);
      const count = n ? Number(n[1]) : MANY.has(w) ? -1 : w === '더블' ? 2 : 0;
      if (kind) {
        if (group) groups.push(group);
        group = null;
        last = hazardsOf(kind, context, groups, said);
        out.push(...last);
        afterHazard = true;
        said = 0;
      } else if (count) {
        if (afterHazard) for (const h of last) h.count = howMany(h.kind, count, h.at === 'green' && h.spot === 'around');
        else said = count;
      }
    }
  }
  return out;
}

/** One of each hazard (by kind and place), keeping the larger count, in the order first said. */
function merged<T extends NamedHazard>(list: T[]): T[] {
  const seen = new Map<string, T>();
  for (const h of list) {
    const key = `${h.kind} ${h.at} ${'spot' in h ? h.spot : 'side' in h ? h.side : ''}`;
    const had = seen.get(key);
    if (had) had.count = Math.max(had.count, h.count);
    else seen.set(key, { ...h });
  }
  return [...seen.values()];
}

/**
 * The bunkers and water a hole's note names, phrase by phrase (v22): only 벙커 (not a grass bunker) and 연못, 워터해저드, 호수,
 * 개울 or 물, each where its words put it. A hazard named without a place the drawing can show is left out, not guessed.
 */
export function layoutHazards(layout: string | undefined): NamedHazard[] {
  return merged((layout ?? '').split(/\s*[,，]\s*/).flatMap(readPhrase));
}

/**
 * The named hazards for a hole of this par: a bare side is the fairway's on a par 4 or 5 and the green's on a par 3, and
 * "ahead" is in front of a par 3's green. Left out: "ahead" on a longer hole, and the fairway of a par 3, which has none.
 */
export function holeHazards(par: Par, layout: string | undefined): HoleHazard[] {
  const out: HoleHazard[] = [];
  for (const h of layoutHazards(layout)) {
    if (h.at === 'green' || h.at === 'tee') out.push(h);
    else if (h.at === 'fairway' || h.at === 'side') {
      if (par !== 3) out.push({ kind: h.kind, at: 'fairway', side: h.side, count: h.count });
      else if (h.at === 'side') out.push({ kind: h.kind, at: 'green', spot: h.side, count: h.count });
    } else if (par === 3) out.push({ kind: h.kind, at: 'green', spot: h.side === 'left' ? 'front-left' : h.side === 'right' ? 'front-right' : 'front', count: h.count });
  }
  return merged(out);
}

// ---------- The drawn hole ----------

/** The screen the course is drawn behind, in CSS pixels. */
export interface CourseFrame {
  width: number;
  height: number;
  /** The open band between the top bar's info line and the sheet, where the green and its flag can be seen. */
  bandTop: number;
  bandBottom: number;
  /** The green keeps left of this (the score badge). */
  right: number;
  /** Where the tee box is drawn: behind 다음 홀, so none of it peeks out between the button and the tab bar (v14). */
  teeY?: number;
  /** What a drawing of OpenStreetMap's must keep its flag and distance pills off: its credit and the version (v27). */
  keep?: Box[];
}

/** A bunker or pond as drawn: an outline round its middle, its long axis turned `angle` degrees (v22). */
export interface HazardShape {
  kind: HazardKind;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
  /** Scales the radius at eight points round it, so no two look stamped from one shape. */
  outline: number[];
}

/**
 * Our own plan of a hole, tee at the bottom of the screen and green at the top. Bunkers and water only where the hole's note
 * names them (v22), at rough places: they never move the hole, cover the green or flag, or cross a distance marker.
 */
export interface CourseShape {
  /** `outline` scales the green's radius at eight points round it, so each hole's green looks its own. */
  green: { cx: number; cy: number; rx: number; ry: number; outline: number[] };
  /** Null when the open band is too short to show the flag whole. */
  pin: { x: number; y: number; pole: number } | null;
  tee: { x: number; y: number; width: number };
  /** The fairway's outline, from in front of the tee to in front of the green; null on a par 3. */
  fairway: [number, number][] | null;
  /** Water round the green, for an island green. */
  water: boolean;
  /** The angle of the line of play, for the mowing stripes across it. */
  angle: number;
  /** 100 m and 150 m to the green, where a tall band shows the approach and the hole is long enough for them. */
  markers: { x: number; y: number; d: number }[];
  /** The bunkers and ponds the note names. */
  hazards: HazardShape[];
}

// Per-hole variety without inventing features: where the pin stands and the outline of the green.
const PIN = [[0.3, -0.1], [-0.32, 0.05], [0.12, -0.2], [0.36, 0.1], [-0.3, -0.12], [0.24, 0.12], [-0.2, -0.1], [0.3, 0.05], [-0.26, -0.15],
  [0.2, 0.1], [-0.34, 0], [0.28, -0.12], [-0.14, 0.12], [0.32, -0.05], [-0.22, 0.1], [0.3, -0.1], [-0.3, 0.06], [0.16, -0.1]];
// Outline factors at eight points round each shape, varying slowly so it stays rounded (v31): v22's tables pulled every
// other point in, which drew ponds and bunkers as pointed leaves and greens as lemons. A green swells a little to one side.
const GREENS = [[1, 1.02, 1.03, 1.01, 0.98, 0.96, 0.97, 0.99], [0.97, 0.96, 0.98, 1.01, 1.03, 1.03, 1.01, 0.99], [1.03, 1.01, 0.97, 0.94, 0.97, 1.01, 1.03, 1.04]];
// A bunker is a kidney or a bean, one side pulled in; a pond is rounder.
const BUNKER_RIMS = [[1.02, 1, 0.86, 1, 1.03, 1.02, 1, 1.01], [0.98, 1.02, 1.03, 1, 0.98, 0.99, 0.84, 0.97], [1, 0.88, 1, 1.03, 1.02, 1, 1, 1.01]];
const POND_RIMS = [[0.98, 1, 1.02, 1.02, 1, 0.97, 0.96, 0.97], [1.01, 0.99, 0.97, 0.98, 1.01, 1.03, 1.03, 1.02]];

/** The open band from which the approach shows: the green near its top, then the fairway with distance markers. */
export const ROOMY_BAND = 110;

/** The flag's width for a pole (the drawing and the room kept round it). */
const flagWidth = (pole: number) => Math.max(13, pole * 0.46);
/** A distance marker's label width: "100 m" or "150 m" in the bundled Pretendard (v24; 13px, 600) is 39px, so 7px each side. */
const markerWidth = (_d: number) => 54;

/** A screen rectangle in px. */
export interface Box { x0: number; y0: number; x1: number; y1: number }
/** Kept clear round each hazard, and its outline's reach beyond its axes (the smooth curve through the outline points). */
const GAP = 5;
const REACH = 1.08;
const deg = (rad: number) => (rad * 180) / Math.PI;

// 24 points round a unit circle, for the outlines checked while placing.
const RIM_COS = Array.from({ length: 24 }, (_, j) => Math.cos((j / 24) * Math.PI * 2));
const RIM_SIN = RIM_COS.map((_, j) => Math.sin((j / 24) * Math.PI * 2));

/** A hazard being placed, with what the checks need worked out once: its turn, its half axes out to its widest, its
 * reach from the middle and points round it. */
interface Fitted { h: HazardShape; cos: number; sin: number; ax: number; ay: number; reach: number; rim: [number, number][] }

function fitted(h: HazardShape): Fitted {
  const m = Math.max(...h.outline) * REACH;
  const a = (h.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const ax = h.rx * m;
  const ay = h.ry * m;
  const rim = RIM_COS.map((c, j): [number, number] => [h.cx + c * ax * cos - RIM_SIN[j] * ay * sin, h.cy + c * ax * sin + RIM_SIN[j] * ay * cos]);
  return { h, cos, sin, ax, ay, reach: Math.max(ax, ay), rim };
}

function covers(f: Fitted, [x, y]: [number, number]): boolean {
  const dx = x - f.h.cx;
  const dy = y - f.h.cy;
  return ((dx * f.cos + dy * f.sin) / f.ax) ** 2 + ((dy * f.cos - dx * f.sin) / f.ay) ** 2 < 1;
}

/** What a hazard must keep off, and where it may go. */
interface Room {
  frame: CourseFrame;
  green: CourseShape['green'];
  /** The way of play into the green, a unit vector from the tee side toward it. */
  ahead: [number, number];
  tee: CourseShape['tee'];
  /** Along a fairway (null on a par 3): its middle and its way toward the green at t (0 the green, 1 the tee), its half
   * width in px there, where the tee shot lands, and how many px t runs. */
  line: { at: (t: number) => [number, number]; toward: (t: number) => [number, number]; half: (t: number) => number; land: number; span: number } | null;
  /** The header, the tee box, the flag and the distance markers. */
  blocked: Box[];
  index: number;
}

const SPOT: Record<Exclude<GreenSpot, 'around'>, [number, number]> = {
  front: [1, 0], back: [-1, 0], left: [0, 1], right: [0, -1],
  'front-left': [1, 1], 'front-right': [1, -1], 'back-left': [-1, 1], 'back-right': [-1, -1],
};
/** Round the green, the places to try in order: the first free ones are taken, so a green high in the band gets its
 * bunkers at the sides instead of behind it, under the chips. */
const AROUND: Exclude<GreenSpot, 'around'>[][] = [
  [], [],
  ['front-left', 'front-right', 'left', 'right', 'back-left', 'back-right', 'back', 'front'],
  ['front-left', 'front-right', 'back', 'left', 'right', 'back-left', 'back-right', 'front'],
  ['front-left', 'front-right', 'back-left', 'back-right', 'left', 'right', 'back', 'front'],
];
/**
 * When the first place is taken: a small turn round the green (or along the fairway), one step outward (past a bunker
 * named at the same place), or a smaller size, cheapest first. Never further out, so nothing named at the green ends up
 * past the distance markers.
 */
const TRIES: [number, number, number][] = [0, 15, -15, 30, -30, 45, -45]
  .flatMap((rot) => [0, 1].flatMap((push) => [1, 0.8, 0.64].map((size): [number, number, number] => [rot, push, size])))
  .map((t, j) => ({ t, j, cost: Math.abs(t[0]) / 15 + t[1] * 1.5 + (t[2] === 1 ? 0 : t[2] === 0.8 ? 1 : 2) }))
  .sort((a, b) => a.cost - b.cost || a.j - b.j)
  .map(({ t }) => t);
const turn = ([x, y]: [number, number], degrees: number): [number, number] => {
  const a = (degrees * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};
const unit = ([x, y]: [number, number]): [number, number] => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

function placeHazards(list: HoleHazard[], room: Room): HazardShape[] {
  const { green: g, frame } = room;
  const placed: { order: number; f: Fitted }[] = [];
  // The fringe, at its widest, is the green's keep-out.
  const A = g.rx * 1.17 * Math.max(...g.outline);
  const B = g.ry * 1.17 * Math.max(...g.outline);
  const fits = (c: Fitted): boolean => {
    const { h, rim, reach } = c;
    if (h.cx < 8 || h.cx > frame.width - 8 || h.cy < 6 || h.cy > frame.height - 6) return false;
    for (const [x, y] of rim) if (((x - g.cx) / (A + 1)) ** 2 + ((y - g.cy) / (B + 1)) ** 2 < 1) return false;
    for (const b of room.blocked) {
      if (h.cx + reach < b.x0 || h.cx - reach > b.x1 || h.cy + reach < b.y0 || h.cy - reach > b.y1) continue;
      for (const [x, y] of rim) if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return false;
    }
    return placed.every(({ f: o }) => Math.hypot(h.cx - o.h.cx, h.cy - o.h.cy) > reach + o.reach || (!rim.some((p) => covers(o, p)) && !o.rim.some((p) => covers(c, p))));
  };
  const [fx, fy] = room.ahead;
  const left: [number, number] = [fy, -fx];
  type Spot = Exclude<GreenSpot, 'around'>;
  /** One hazard to place: the green spots it may take in order (null off the green), and its shape for a turn and a step out. */
  type Job = { order: number; kind: HazardKind; spots: (Spot | null)[]; taken?: Set<Spot>; make: (rot: number, push: number, spot: Spot | null, size: number) => HazardShape };
  const jobs: Job[] = [];
  let order = 0;
  for (const item of list) {
    if (item.at === 'green') {
      // Round the green: as many as the note says, each on the first free spot. Several at one place: side by side there.
      const around = item.spot === 'around';
      const taken = new Set<Spot>();
      const shrink = around ? 1 : [1, 1, 0.8, 0.68][item.count];
      for (let j = 0; j < item.count; j++) {
        const outline = (item.kind === 'bunker' ? BUNKER_RIMS : POND_RIMS)[(room.index + order) % (item.kind === 'bunker' ? 3 : 2)];
        const m = Math.max(...outline) * REACH;
        jobs.push({
          order: order++,
          kind: item.kind,
          spots: around ? AROUND[item.count] : [item.spot as Spot],
          taken: around ? taken : undefined,
          make: (rot, push, spot, size) => {
            const [cf, cl] = SPOT[spot!];
            const across = cl === 0;
            const rx = size * (item.kind === 'bunker' ? clamp(g.rx * 0.36, 11, 26) * shrink : across ? clamp(g.rx * 0.78, 20, 52) : clamp(g.rx * 0.6, 18, 44));
            const ry = item.kind === 'bunker' ? rx * 0.56 : size * clamp((rx / size) * (across ? 0.36 : 0.5), 9, 20);
            const fan = around ? 0 : (j - (item.count - 1) / 2) * deg((2.3 * rx * m) / (Math.hypot(A, B) * 0.75 + ry));
            const u = turn(unit([-fx * cf + left[0] * cl, -fy * cf + left[1] * cl]), fan + rot);
            // The fringe's edge in that direction, and its outward normal there: the hazard hugs the green.
            const d0 = 1 / Math.hypot(u[0] / A, u[1] / B);
            const px = g.cx + u[0] * d0;
            const py = g.cy + u[1] * d0;
            const n = unit([(px - g.cx) / (A * A), (py - g.cy) / (B * B)]);
            const out = GAP + ry * m + push * (2 * ry * m + GAP);
            return { kind: item.kind, cx: px + n[0] * out, cy: py + n[1] * out, rx, ry, angle: deg(Math.atan2(n[1], n[0])) + 90, outline };
          },
        });
      }
    } else if (item.at === 'fairway') {
      const line = room.line;
      if (!line) continue;
      const rx0 = item.kind === 'bunker' ? clamp(frame.width * 0.05, 12, 22) : clamp(frame.width * 0.11, 26, 50);
      const sign = item.side === 'left' ? 1 : -1;
      for (let j = 0; j < item.count; j++) {
        const outline = (item.kind === 'bunker' ? BUNKER_RIMS : POND_RIMS)[(room.index + order) % (item.kind === 'bunker' ? 3 : 2)];
        const m = Math.max(...outline) * REACH;
        const t0 = line.land + ((j - (item.count - 1) / 2) * 2.3 * rx0 * m) / line.span;
        jobs.push({
          order: order++,
          kind: item.kind,
          spots: [null],
          make: (rot, push, _spot, size) => {
            const rx = rx0 * size;
            const ry = rx * (item.kind === 'bunker' ? 0.5 : 0.42);
            // Along the edge instead of turning: a few px toward the green or the tee, and outward into the rough.
            const t = t0 + (rot / 15) * 0.04;
            const [x, y] = line.at(t);
            const dir = line.toward(t);
            const side: [number, number] = [dir[1] * sign, -dir[0] * sign];
            // A bunker cuts into the fairway's edge; water lies just off it in the rough.
            const off = line.half(t) + (item.kind === 'bunker' ? -ry * 0.25 : ry * m + 3) + push * (2 * ry * m + GAP);
            return { kind: item.kind, cx: x + side[0] * off, cy: y + side[1] * off, rx, ry, angle: deg(Math.atan2(dir[1], dir[0])), outline };
          },
        });
      }
    } else {
      // In front of the tee box, between it and the green.
      const outline = POND_RIMS[room.index % 2];
      const m = Math.max(...outline) * REACH;
      jobs.push({
        order: order++,
        kind: 'water',
        spots: [null],
        make: (rot, push, _spot, size) => {
          const rx = size * clamp(room.tee.width * 0.62, 26, 64);
          const ry = size * clamp((rx / size) * 0.34, 11, 18);
          return { kind: 'water', cx: room.tee.x + rot, cy: room.tee.y - 12 - GAP - ry * m - push * (2 * ry * m + GAP), rx, ry, angle: 0, outline };
        },
      });
    }
  }
  // Bunkers first, so water named at the same place lies beyond them. What finds no room is left out.
  for (const job of [...jobs].sort((a, b) => Number(a.kind === 'water') - Number(b.kind === 'water') || a.order - b.order)) {
    search: for (const spot of job.spots) {
      if (spot && job.taken?.has(spot)) continue;
      for (const [rot, push, size] of TRIES) {
        const f = fitted(job.make(rot, push, spot, size));
        if (fits(f)) {
          placed.push({ order: job.order, f });
          if (spot) job.taken?.add(spot);
          break search;
        }
      }
    }
  }
  return placed.sort((a, b) => a.order - b.order).map((p) => p.f.h);
}

/**
 * `length` is the hole's official length in metres when the course publishes one: it decides which distance markers
 * a tall band shows (a marker only where the hole is at least 60 m longer than it). `named` are the bunkers and water the
 * hole's note names (`holeHazards`, v22).
 */
export function courseShape(par: Par, index: number, frame: CourseFrame, bend: Bend, island = false, length: number | null = null, named: HoleHazard[] = []): CourseShape {
  const { width: W, height: H, bandTop, bandBottom, right } = frame;
  const i = ((index % PIN.length) + PIN.length) % PIN.length;
  const k = par === 3 ? 0 : par === 4 ? 1 : 2;
  const band = bandBottom - bandTop;
  const roomy = band >= ROOMY_BAND;
  // A par 3's green is near and large; a par 5's is far and small. Smaller where the approach shows too, and a par 3's
  // no wider than 17% of the screen there, so a tall band does not fill with green (v14).
  const rx0 = W * [0.27, 0.2, 0.165][k] * (roomy ? 0.8 : 1);
  const rx = roomy && k === 0 ? Math.min(rx0, W * 0.17) : rx0;
  const ry = rx * 0.66;
  const turnTo = k === 0 ? 0 : bend;
  const cx = clamp(Math.min(W * 0.47, right - rx * 0.75) + turnTo * W * 0.12, rx, right - rx * 0.75);
  // A shorter pole on a short band, so phones (a 24px band) still show the flag.
  const pole = roomy ? [40, 34, 30][k] : band >= 30 ? Math.max(18, Math.min([40, 34, 30][k], band - 16)) : Math.max(14, band - 8);
  // The pin and flag stand in the open band: near its top when it is tall, else just above the sheet's edge. On a tall
  // band an island green sits low enough that its water starts below the chips.
  const pinY = roomy ? Math.max(bandTop + pole + 6, island ? bandTop + 6 + ry * 1.6 : 0) : band > 40 ? bandBottom - 10 : bandBottom - 4;
  const cy = pinY + ry * 0.18;
  const tee = { x: W / 2, y: frame.teeY ?? H - [64, 56, 52][k], width: W * [0.3, 0.26, 0.24][k] };

  let fairway: [number, number][] | null = null;
  const markers: CourseShape['markers'] = [];
  const y0 = cy + ry * 0.7;
  const y1 = tee.y - 36;
  // Straight from the green to the tee; a dogleg runs straight off the tee and turns toward the green.
  const at = (t: number): [number, number] => [turnTo ? tee.x + (cx - tee.x) * (1 - t) ** 2 : cx + (tee.x - cx) * t, y0 + (y1 - y0) * t];
  // Half-widths along the hole; a par 5 narrows between two landing areas.
  const half = k === 1 ? [0.15, 0.22, 0.33, 0.43, 0.5, 0.52, 0.44] : [0.12, 0.18, 0.27, 0.23, 0.35, 0.48, 0.42];
  const ts = [0, 0.12, 0.3, 0.5, 0.7, 0.88, 1];
  if (k > 0) {
    const rightSide = ts.map((t, j): [number, number] => [at(t)[0] + W * half[j], at(t)[1]]);
    const leftSide = ts.map((t, j): [number, number] => [at(t)[0] - W * half[j], at(t)[1]]).reverse();
    const [topX, topY] = at(0);
    const [botX, botY] = at(1);
    fairway = [[topX, topY - ry * 0.25], ...rightSide, [botX, botY + 14], ...leftSide];
    // Distance markers from the real length, only in a band tall enough to show the approach.
    if (roomy && length !== null) {
      for (const d of [100, 150]) {
        if (length < d + 60) continue;
        const y = y0 + (bandBottom - 6 - y0) * (d / 165);
        if (y > bandBottom - 14) continue;
        markers.push({ x: at((y - y0) / (y1 - y0))[0], y, d });
      }
    }
  }

  const green = { cx, cy, rx, ry, outline: GREENS[i % GREENS.length] };
  const pin = band >= 24 ? { x: cx + rx * PIN[i][0], y: pinY, pole } : null;
  let hazards: HazardShape[] = [];
  if (named.length) {
    // The header above the open band (its chips stay the focus), the tee box, the flag and the distance markers.
    const blocked: Box[] = [{ x0: -Infinity, y0: -Infinity, x1: Infinity, y1: bandTop }, { x0: tee.x - tee.width / 2 - 2, y0: tee.y - 14, x1: tee.x + tee.width / 2 + 2, y1: tee.y + 16 }];
    if (pin) blocked.push({ x0: pin.x - 3, y0: pin.y - pole - 4, x1: pin.x + flagWidth(pole) + 2, y1: pin.y + 3 });
    for (const m of markers) blocked.push({ x0: m.x - 7.5, y0: m.y - 7.5, x1: m.x + 7.5, y1: m.y + 7.5 }, { x0: m.x + 9, y0: m.y - 12, x1: m.x + 11 + markerWidth(m.d), y1: m.y + 12 });
    // Where the tee shot lands: about 230 m out when the length is known.
    const land = k === 1 ? (length ? clamp((length - 230) / length, 0.3, 0.6) : 0.42) : length ? clamp((length - 240) / length, 0.4, 0.65) : 0.55;
    const halfAt = (t: number) => {
      const j = clamp(ts.findIndex((s) => s >= t), 1, ts.length - 1);
      return W * (half[j - 1] + ((half[j] - half[j - 1]) * (clamp(t, 0, 1) - ts[j - 1])) / (ts[j] - ts[j - 1]));
    };
    const toward = (t: number): [number, number] => unit([turnTo ? 2 * (cx - tee.x) * (1 - t) : cx - tee.x, -(y1 - y0)]);
    hazards = placeHazards(named, {
      frame,
      green,
      ahead: k === 0 ? unit([cx - tee.x, cy - tee.y]) : unit([at(0)[0] - at(0.15)[0], at(0)[1] - at(0.15)[1]]),
      tee,
      line: k === 0 ? null : { at, toward, half: halfAt, land, span: y1 - y0 },
      blocked,
      index: i,
    });
  }

  return {
    green,
    pin,
    tee,
    fairway,
    water: island,
    angle: deg(Math.atan2(y0 - y1, cx - tee.x)),
    markers,
    hazards,
  };
}

const f = (n: number) => n.toFixed(1);

/** A closed curve through the points (Catmull-Rom as cubic Béziers). */
function smooth(pts: [number, number][]): string {
  const n = pts.length;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/** A hazard's outline. */
function blob(h: HazardShape): string {
  const a = (h.angle * Math.PI) / 180;
  return smooth(h.outline.map((r, j): [number, number] => {
    const t = (j / h.outline.length) * Math.PI * 2;
    const x = Math.cos(t) * h.rx * r;
    const y = Math.sin(t) * h.ry * r;
    return [h.cx + x * Math.cos(a) - y * Math.sin(a), h.cy + x * Math.sin(a) + y * Math.cos(a)];
  }));
}

/** A bunker (v31): its sand, flat, as a yardage book draws it (v22 gave it a shaded lip, a lit fill and grain). */
function bunkerSvg(h: HazardShape): string {
  return `<g class="bunker"><path class="a-sand" d="${blob(h)}"/></g>`;
}

/** A pond (v31): its water, flat, with its shore drawn as a dark line so it reads on the fairway too (v22 gave it depth and a glint). */
function pondSvg(h: HazardShape): string {
  return `<g class="pond"><path class="water" d="${blob(h)}" stroke-width="2"/></g>`;
}

/**
 * The pin (v31), on the schematic and OpenStreetMap's alike: the cup, a white pole in a dark edge (white alone was 2.1:1 on
 * the green) and a red pennant, flat.
 */
function pinSvg(pin: { x: number; y: number; pole: number }): string {
  const fw = flagWidth(pin.pole);
  const fh = Math.max(10, pin.pole * 0.34);
  const top = pin.y - pin.pole;
  const x = pin.x;
  const pole = `M${f(x)} ${f(pin.y)}V${f(top)}`;
  return `<ellipse class="a-cup" cx="${f(x)}" cy="${f(pin.y)}" rx="3.6" ry="1.9"/>`
    + `<path class="a-pole-edge" d="${pole}" stroke-width="3.8" stroke-linecap="round"/>`
    + `<path class="a-pole" d="${pole}" stroke-width="2.2" stroke-linecap="round"/>`
    + `<path class="flag" d="M${f(x + 1)} ${f(top)}l${f(fw)} ${f(fh * 0.42)}l${f(-fw)} ${f(fh * 0.42)}z"/>`;
}

/** A 100 m or 150 m marker: a white dot on the line of play and its distance in a dark pill beside it. */
function markerSvg(m: { x: number; y: number; d: number }): string {
  const w = markerWidth(m.d);
  return `<g class="marker"><circle cx="${f(m.x)}" cy="${f(m.y)}" r="5.5" class="a-marker" stroke-width="1.5"/>`
    + `<rect x="${f(m.x + 10)}" y="${f(m.y - 11)}" width="${w}" height="22" rx="11" class="a-marker-label"/>`
    + `<text x="${f(m.x + 10 + w / 2)}" y="${f(m.y + 4.5)}" text-anchor="middle">${m.d} m</text></g>`;
}

/**
 * A 40×28 picture of the hole for the header of a short screen, where the drawn band has no room (v15). Facing the
 * green, tee at the left and green at the right: a par 3 is a carry to a green, a par 4 or 5 a fairway, a dogleg turns
 * up (left) or down (right), and an island green has water round it. Decorative and built from numbers only.
 */
export function holeThumb(par: Par, bend: Bend, island: boolean): string {
  const k = par === 3 ? 0 : par === 4 ? 1 : 2;
  const turnTo = k === 0 ? 0 : bend;
  const g = { cx: [26, 31, 33][k], cy: 14 + turnTo * 6, rx: [7.5, 5.5, 4.5][k], ry: [6, 4.5, 4][k] };
  const teeX = [5, 4, 3][k];
  const out = ['<svg viewBox="0 0 40 28" width="40" height="28" aria-hidden="true" focusable="false"><rect class="a-rough-fill" width="40" height="28"/>'];
  if (k > 0) {
    // Straight off the tee, turning toward the green in the last third.
    out.push(`<path class="th-fairway" d="M${teeX + 3} 14Q${f(g.cx - 4)} 14 ${f(g.cx - g.rx * 0.6)} ${f(g.cy)}" fill="none" stroke-width="${k === 1 ? 7 : 6}" stroke-linecap="round"/>`);
  }
  if (island) out.push(`<ellipse class="th-water" cx="${f(g.cx)}" cy="${f(g.cy)}" rx="${f(g.rx * 1.6)}" ry="${f(g.ry * 1.6)}"/>`);
  out.push(`<ellipse class="th-green" cx="${f(g.cx)}" cy="${f(g.cy)}" rx="${f(g.rx)}" ry="${f(g.ry)}" stroke-width="1"/>`);
  out.push(`<rect class="a-tee-fill" x="${teeX - 2}" y="12" width="5" height="4" rx="1.5"/>`);
  // The flag: a white pole and a red pennant, kept inside the picture.
  const top = Math.max(2, g.cy - 9);
  out.push(`<path class="a-pole" d="M${f(g.cx)} ${f(g.cy)}V${f(top)}" stroke-width="1.2" stroke-linecap="round"/><path class="a-flag" d="M${f(g.cx + 0.5)} ${f(top)}l4 1.6-4 1.6z"/>`);
  out.push('</svg>');
  return out.join('');
}

/**
 * The SVG content for the course behind the screen (v31): a yardage book's plan view in flat fills from the palette. The
 * rough, the fairway in its first cut, the hazards a note names, the green in its fringe, the pin, the 100 m and 150 m
 * markers and the tee, from the ground up. No light and no texture (v22's stripes, dome, depth, glints, grain, vignette):
 * since v30 nothing over it is see-through, and a diagram reads as one. Decorative and built from numbers only.
 */
export function courseSvg(shape: CourseShape, frame: CourseFrame): string {
  const { width: W, height: H } = frame;
  const { green: g, pin, tee, fairway } = shape;
  const out: string[] = [`<rect class="a-rough-fill" width="${W}" height="${H}"/>`];
  if (fairway) {
    const d = smooth(fairway);
    out.push(`<path class="a-cut" d="${d}" fill="none" stroke-width="8" stroke-linejoin="round"/>`, `<path class="fairway" d="${d}"/>`);
  }
  for (const h of shape.hazards) if (h.kind === 'bunker') out.push(bunkerSvg(h));
  for (const h of shape.hazards) if (h.kind === 'water') out.push(pondSvg(h));
  const ring = (s: number) => g.outline.map((r, j): [number, number] => {
    const a = (j / g.outline.length) * Math.PI * 2;
    return [g.cx + Math.cos(a) * g.rx * r * s, g.cy + Math.sin(a) * g.ry * r * s];
  });
  // An island green stands in its water.
  if (shape.water) out.push(`<g class="pond"><path class="water" d="${smooth(ring(1.78))}" stroke-width="2"/></g>`);
  out.push(`<path class="a-fringe" d="${smooth(ring(1.1))}"/>`, `<path class="green" d="${smooth(ring(1))}"/>`);
  if (pin) out.push(pinSvg(pin));
  for (const m of shape.markers) out.push(markerSvg(m));
  // The tee box and its two markers.
  out.push(`<rect class="tee" x="${f(tee.x - tee.width / 2)}" y="${f(tee.y - 12)}" width="${f(tee.width)}" height="24" rx="10"/>`);
  for (const dx of [-0.3, 0.3]) out.push(`<circle cx="${f(tee.x + tee.width * dx)}" cy="${f(tee.y - 3)}" r="4.2" class="a-pole-fill"/>`);
  return out.join('');
}

// ---------- A hole from OpenStreetMap (v27) ----------

/**
 * One hole as bundled from OpenStreetMap (src/data/osm/, ODbL 1.0, © OpenStreetMap contributors): flat [x, y, …] outlines
 * in metres east and north of the middle of its greens. `line` is the line of play from the back tee to that middle; each
 * `water` entry is its outer ring, then any islands in it.
 */
export interface OsmHole {
  line: number[];
  greens: number[][];
  tees: number[][];
  fairways: number[][];
  bunkers: number[][];
  water: number[][][];
  /** The OSM element ids each kind came from: "w123" a way, "r123" a relation. */
  osm: { tees: string[]; greens: string[]; fairways: string[]; bunkers: string[]; water: string[] };
}

/** A hole turned so its line of play runs up the screen, in metres: u to the right, v down from the greens' middle. */
export interface OrientedHole {
  line: Pt[];
  greens: Pt[][];
  tees: Pt[][];
  fairways: Pt[][];
  bunkers: Pt[][];
  water: Pt[][][];
  /** The back tee, where the line starts: its index among `tees`. */
  back: number;
}

const pairsOf = (flat: number[]): Pt[] => Array.from({ length: flat.length / 2 }, (_, i): Pt => [flat[2 * i], flat[2 * i + 1]]);
const turnedHoles = new WeakMap<OsmHole, OrientedHole>();

/** The hole turned once and kept: drawing it again (back to it, or on a new frame) only scales and moves it. */
export function orientedHole(hole: OsmHole): OrientedHole {
  const known = turnedHoles.get(hole);
  if (known) return known;
  const line = pairsOf(hole.line);
  const turn = orienter(line);
  const ring = (flat: number[]) => pairsOf(flat).map(turn);
  const tees = hole.tees.map(ring);
  const start = turn(line[0]);
  const gap = (c: Pt) => Math.hypot(c[0] - start[0], c[1] - start[1]);
  const centres = tees.map(ringCentroid);
  const back = centres.reduce((best, c, j) => (gap(c) < gap(centres[best]) ? j : best), 0);
  const turned: OrientedHole = { line: line.map(turn), greens: hole.greens.map(ring), tees, fairways: hole.fairways.map(ring), bunkers: hole.bunkers.map(ring), water: hole.water.map((w) => w.map(ring)), back };
  turnedHoles.set(hole, turned);
  return turned;
}

/** A hole from OpenStreetMap on the screen, in px. */
export interface OsmShape {
  /** px per metre: one scale both ways, so the outlines keep their real proportions. */
  scale: number;
  /** The back tee's middle and the greens' middle: the ends of the line of play. */
  tee: Pt;
  green: Pt;
  /** The line of play from the back tee to the greens' middle, where the distance markers stand (not drawn). */
  line: Pt[];
  greens: Pt[][];
  /** The green the flag is on. */
  flagged: number;
  tees: Pt[][];
  back: number;
  fairways: Pt[][];
  bunkers: Pt[][];
  /** Each pond's outer ring, then any islands in it. */
  water: Pt[][][];
  pin: { x: number; y: number; pole: number } | null;
  markers: { x: number; y: number; d: number }[];
}

/**
 * The greens keep within this share of the screen's width, and in a tall band within this share of its height, so a short
 * par 3 does not fill the band with green (as the schematic's, v14). Where that binds, the tee rises from behind 다음 홀
 * into the card's lower part.
 */
const OSM_GREENS_WIDTH = 0.6;
const OSM_GREENS_HEIGHT = 0.5;
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * A hole from OpenStreetMap on the screen (v27): its tee→green axis up the screen's middle, the back tee behind 다음 홀
 * and the flag in the open band where the schematic's stands, at one scale. `length` (the official length in metres)
 * decides which distance markers there may be, as on the schematic; each stands at its real distance along the line of
 * play, where the band shows it clear of the flag and `frame.keep`.
 */
export function osmShape(hole: OsmHole, index: number, frame: CourseFrame, length: number | null): OsmShape {
  const o = orientedHole(hole);
  const { width: W, height: H, bandTop, bandBottom } = frame;
  const band = bandBottom - bandTop;
  const roomy = band >= ROOMY_BAND;
  const axis = o.line[0][1];
  // The flag as tall as the schematic's for a hole of this kind: a par 3's (no fairway) nearest and tallest.
  const k = o.fairways.length === 0 ? 0 : axis < 470 ? 1 : 2;
  const pole = roomy ? [40, 34, 30][k] : band >= 30 ? Math.max(18, Math.min([40, 34, 30][k], band - 16)) : Math.max(14, band - 8);
  const pinY = roomy ? bandTop + pole + 6 : band > 40 ? bandBottom - 10 : bandBottom - 4;
  const teeY = frame.teeY ?? H - 56;
  const i = ((index % PIN.length) + PIN.length) % PIN.length;
  // The flag and the distance pills keep 8px from the credit and the version (4px above and below), so neither crowds them.
  const keep = (frame.keep ?? []).map((b): Box => ({ x0: b.x0 - 8, y0: b.y0 - 4, x1: b.x1 + 8, y1: b.y1 + 4 }));
  const centres = o.greens.map(ringCentroid);
  const us = o.greens.flat().map((p) => p[0]);
  const vs = o.greens.flat().map((p) => p[1]);
  const spread = Math.max(...us) - Math.min(...us) || 1;
  const minV = Math.min(...vs);
  const depth = Math.max(...vs) - minV || 1;
  const cap = Math.min((W * OSM_GREENS_WIDTH) / spread, roomy ? (band * OSM_GREENS_HEIGHT) / depth : Infinity);
  // The flag on the green nearest the middle (the left one on a tie), or on the other where the credit or version would
  // cover it.
  const order = centres.map((_, j) => j).sort((a, b) => Math.abs(centres[a][0]) - Math.abs(centres[b][0]) || centres[a][0] - centres[b][0]);
  let fit: { flagged: number; s: number; oy: number; pinAt: Pt } | null = null;
  for (const j of order) {
    const g = o.greens[j];
    const c = centres[j];
    // A little off the green's middle, varied per hole like the schematic's pin, and always on the green.
    const hu = (Math.max(...g.map((p) => p[0])) - Math.min(...g.map((p) => p[0]))) / 2;
    const hv = (Math.max(...g.map((p) => p[1])) - Math.min(...g.map((p) => p[1]))) / 2;
    const off: Pt = [c[0] + PIN[i][0] * hu * 0.8, c[1] + PIN[i][1] * hv * 0.8];
    const pinAt = inRing(off, g) ? off : c;
    // One scale from the pin in the band to the back tee behind 다음 홀, capped by the greens' size and so that no green
    // reaches more than 6px above the band, under the chip row (where the cap lifts the tee, it rises behind the card).
    const below = pinAt[1] > minV ? (pinY - (bandTop - 6)) / (pinAt[1] - minV) : Infinity;
    const s = Math.min((teeY - pinY) / (axis - pinAt[1]), cap, below);
    const oy = pinY - s * pinAt[1];
    const x = W / 2 + s * pinAt[0];
    const flag: Box = { x0: x - 3, y0: pinY - pole - 4, x1: x + flagWidth(pole) + 2, y1: pinY + 3 };
    const clear = !keep.some((b) => overlaps(flag, b));
    if (!fit || clear) fit = { flagged: j, s, oy, pinAt };
    if (clear) break;
  }
  const { flagged, s, oy, pinAt } = fit!;
  const P = ([u, v]: Pt): Pt => [W / 2 + s * u, oy + s * v];
  const line = o.line.map(P);
  const pin = band >= 24 ? { x: P(pinAt)[0], y: pinY, pole } : null;
  const blocked = [...keep];
  if (pin) blocked.push({ x0: pin.x - 3, y0: pin.y - pole - 4, x1: pin.x + flagWidth(pole) + 2, y1: pin.y + 3 });
  const markers: OsmShape['markers'] = [];
  for (const d of [100, 150]) {
    if (length !== null && length < d + 60) continue;
    const at = pointFromEnd(o.line, d);
    if (!at) continue;
    const [x, y] = P(at);
    const w = markerWidth(d);
    const boxes: Box[] = [{ x0: x - 7.5, y0: y - 7.5, x1: x + 7.5, y1: y + 7.5 }, { x0: x + 9, y0: y - 12, x1: x + 11 + w, y1: y + 12 }];
    // Readable in the band: below the header, above the card's edge, on the screen, clear of the flag, credit and version.
    if (y < bandTop + 12 || y > bandBottom - 14 || x < 8 || x + 11 + w > W - 4 || boxes.some((b) => blocked.some((q) => overlaps(b, q)))) continue;
    markers.push({ x, y, d });
    blocked.push(...boxes);
  }
  return {
    scale: s, tee: line[0], green: line[line.length - 1], line,
    greens: o.greens.map((g) => g.map(P)), flagged, tees: o.tees.map((t) => t.map(P)), back: o.back,
    fairways: o.fairways.map((fw) => fw.map(P)), bunkers: o.bunkers.map((b) => b.map(P)), water: o.water.map((w) => w.map((r) => r.map(P))),
    pin, markers,
  };
}

/** The transform drawing an outline `scale` times its size about its middle: a green's fringe. */
function about(pts: Pt[], scale: number): string {
  const [cx, cy] = ringCentroid(pts);
  return `matrix(${scale} 0 0 ${scale} ${f(cx * (1 - scale))} ${f(cy * (1 - scale))})`;
}

/** Closed outlines through screen points as one path (rings after the first are islands): already rounded (chaikin), so
 * straight between points, which keeps the markup short. */
function poly(rings: Pt[][]): string {
  return rings.map((r) => `M${r.map(([x, y]) => `${f(x)} ${f(y)}`).join(' ')}Z`).join('');
}

/** An outline's box: its left, top, width and height. */
function boxOf(pts: Pt[]): [number, number, number, number] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

/** Corners cut `times` over (Chaikin): each edge keeps its middle half, so a traced outline rounds off. */
function chaikin(pts: Pt[], times: number): Pt[] {
  let p = pts;
  for (let k = 0; k < times; k++) {
    const next: Pt[] = [];
    p.forEach(([ax, ay], i) => {
      const [bx, by] = p[(i + 1) % p.length];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    });
    p = next;
  }
  return p;
}

/**
 * The SVG content for a hole from OpenStreetMap (v27), in the schematic's flat plan view (v31) on the real outlines.
 * Decorative and built from numbers only.
 */
export function osmSvg(traced: OsmShape, frame: CourseFrame): string {
  const { width: W, height: H } = frame;
  // OSM's outlines are traced with few points: their corners are cut (twice for the small greens and tee boxes, once for
  // the rest), so they read as mown shapes rather than polygons, and are then drawn straight between points.
  const shape: OsmShape = {
    ...traced,
    greens: traced.greens.map((g) => chaikin(g, 2)),
    tees: traced.tees.map((t) => chaikin(t, 2)),
    fairways: traced.fairways.map((fw) => chaikin(fw, 1)),
    bunkers: traced.bunkers.map((b) => chaikin(b, 1)),
    water: traced.water.map((w) => w.map((r) => chaikin(r, 1))),
  };
  // A fairway's and a green's outline is written once, bare, in <defs>: its cut and its fringe are <use> copies of it.
  const out: string[] = ['<defs>'];
  shape.fairways.forEach((fw, j) => out.push(`<path id="osm-f${j}" d="${poly([fw])}"/>`));
  shape.greens.forEach((g, j) => out.push(`<path id="osm-g${j}" d="${poly([g])}"/>`));
  out.push('</defs>', `<rect class="a-rough-fill" width="${W}" height="${H}"/>`);
  shape.fairways.forEach((_, j) => out.push(`<use href="#osm-f${j}" class="a-cut" fill="none" stroke-width="8" stroke-linejoin="round"/>`));
  shape.fairways.forEach((_, j) => out.push(`<use href="#osm-f${j}" class="fairway"/>`));
  shape.bunkers.forEach((b) => out.push(`<g class="bunker"><path class="a-sand" d="${poly([b])}"/></g>`));
  // Each pond with its shore, and any island in it left open.
  shape.water.forEach((rings) => out.push(`<g class="pond"><path class="water" d="${poly(rings)}" fill-rule="evenodd" stroke-width="2"/></g>`));
  // The greens in their fringes; the flag's green is the one called "green".
  shape.greens.forEach((g, j) => out.push(`<use href="#osm-g${j}" class="a-fringe" transform="${about(g, 1.1)}"/>`));
  shape.greens.forEach((g, j) => out.push(`<path class="${j === shape.flagged ? 'green' : 'green2'}" d="${poly([g])}"/>`));
  if (shape.pin) out.push(pinSvg(shape.pin));
  for (const m of shape.markers) out.push(markerSvg(m));
  // The tee boxes; the back tee (the line's start) carries its two markers when wide enough.
  shape.tees.forEach((t, j) => out.push(`<path class="${j === shape.back ? 'tee' : 'tee2'}" d="${poly([t])}"/>`));
  const [tx, ty, tw, th] = boxOf(shape.tees[shape.back]);
  if (tw >= 18) {
    const r = Math.min(4.2, th * 0.2);
    for (const dx of [-0.3, 0.3]) out.push(`<circle cx="${f(tx + tw / 2 + tw * dx)}" cy="${f(ty + th / 2 - r * 0.7)}" r="${f(r)}" class="a-pole-fill"/>`);
  }
  return out.join('');
}
