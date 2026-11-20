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
const GREENS = [[1, 0.92, 1.06, 0.95, 1.02, 0.9, 1.04, 0.97], [0.95, 1.05, 0.92, 1.04, 0.97, 1.06, 0.9, 1.02], [1.04, 0.9, 1.02, 0.96, 1.07, 0.93, 0.98, 1.03]];
// A bunker is a kidney or a bean, one side pulled in; a pond is rounder.
const BUNKER_RIMS = [[1, 0.9, 1.04, 0.8, 1, 0.94, 1.06, 0.88], [0.96, 1.05, 0.86, 1, 1.04, 0.82, 0.98, 1.02], [1.05, 0.84, 0.97, 1.03, 0.9, 1.02, 0.85, 1]];
const POND_RIMS = [[1, 0.94, 1.04, 0.9, 1.02, 0.96, 1.05, 0.92], [0.96, 1.04, 0.92, 1.03, 0.95, 1.05, 0.93, 1]];

/** The open band from which the approach shows: the green near its top, then the fairway with distance markers. */
export const ROOMY_BAND = 110;

/** The flag's width for a pole (the drawing and the room kept round it). */
const flagWidth = (pole: number) => Math.max(13, pole * 0.46);
/** A distance marker's label width: "100 m" or "150 m" in the bundled Pretendard (v24; 13px, 600) is 39px, so 7px each side. */
const markerWidth = (_d: number) => 54;

interface Box { x0: number; y0: number; x1: number; y1: number }
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

/** A hazard's outline, `scale` times its size, moved by (dx, dy). */
function blob(h: HazardShape, scale = 1, dx = 0, dy = 0): string {
  const a = (h.angle * Math.PI) / 180;
  return smooth(h.outline.map((r, j): [number, number] => {
    const t = (j / h.outline.length) * Math.PI * 2;
    const x = Math.cos(t) * h.rx * r * scale;
    const y = Math.sin(t) * h.ry * r * scale;
    return [h.cx + dx + x * Math.cos(a) - y * Math.sin(a), h.cy + dy + x * Math.sin(a) + y * Math.cos(a)];
  }));
}

/** A short bright arc through three points, toward the top left where the light comes from. */
function arc(at: (deg: number) => [number, number], from: number, to: number): string {
  const [p0, p1, p2] = [at(from), at((from + to) / 2), at(to)];
  return `M${f(p0[0])} ${f(p0[1])}Q${f(2 * p1[0] - (p0[0] + p2[0]) / 2)} ${f(2 * p1[1] - (p0[1] + p2[1]) / 2)} ${f(p2[0])} ${f(p2[1])}`;
}

/** A bunker: the shaded face under its lip at the top left, the sand set a little down and right inside it, and its grain. */
function bunkerSvg(h: HazardShape): string {
  const inner = blob(h, 0.9, h.ry * 0.05, h.ry * 0.07);
  return `<g class="bunker"><path class="a-sand-lip" d="${blob(h)}"/><path class="a-sand" d="${inner}" fill="url(#course-sand)"/><path d="${inner}" fill="url(#course-sandgrain)"/></g>`;
}

/** A pond: deep in the middle, a bank round it and a glint toward the light. */
function pondSvg(h: HazardShape): string {
  const a = (h.angle * Math.PI) / 180;
  const at = (d: number): [number, number] => {
    const t = ((d - h.angle) * Math.PI) / 180;
    const x = Math.cos(t) * h.rx * 0.66;
    const y = Math.sin(t) * h.ry * 0.66;
    return [h.cx + x * Math.cos(a) - y * Math.sin(a), h.cy + x * Math.sin(a) + y * Math.cos(a)];
  };
  return `<g class="pond"><path class="water" d="${blob(h)}" fill="url(#course-depth)" stroke-width="2.5"/><path class="a-water-glint" d="${arc(at, 200, 250)}" fill="none" stroke-width="1.6" stroke-linecap="round"/></g>`;
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
 * The SVG content for the course behind the screen. Decorative and built from numbers only. Lit from the top left: highlights
 * up and left, shades down and right (v22). The textures are felt more than seen, so the card and chips stay in front.
 */
export function courseSvg(shape: CourseShape, frame: CourseFrame): string {
  const { width: W, height: H } = frame;
  const { green: g, pin, tee, fairway } = shape;
  const bunkers = shape.hazards.filter((h) => h.kind === 'bunker');
  const ponds = shape.hazards.filter((h) => h.kind === 'water');
  const out: string[] = [
    '<defs>',
    // Two-tone rough, a vignette and a shade under the header.
    '<radialGradient id="course-rough" cx="50%" cy="46%" r="78%"><stop class="a-rough-hi" offset="0"/><stop class="a-rough" offset="0.62"/><stop class="a-rough-lo" offset="1"/></radialGradient>',
    // Mowing stripes across the line of play, light to dark over 4px instead of at one edge, and a fainter pass along it:
    // both in one tile, so the fairway takes one fill for them.
    '<linearGradient id="course-mowfade"><stop class="a-mow-light" offset="0"/><stop class="a-mow-light" offset=".4"/><stop class="a-mow-dark" offset=".5"/><stop class="a-mow-dark" offset=".9"/><stop class="a-mow-light" offset="1"/></linearGradient>',
    '<linearGradient id="course-mowfade2" x1="0" y1="0" x2="0" y2="1"><stop class="a-mow2-light" offset="0"/><stop class="a-mow2-light" offset=".42"/><stop class="a-mow2-dark" offset=".5"/><stop class="a-mow2-dark" offset=".92"/><stop class="a-mow2-light" offset="1"/></linearGradient>',
    `<pattern id="course-mow" width="44" height="72" patternUnits="userSpaceOnUse" patternTransform="rotate(${f(shape.angle)})"><rect width="44" height="72" fill="url(#course-mowfade)"/><rect width="44" height="72" fill="url(#course-mowfade2)"/></pattern>`,
    // The fairway itself lit toward the top left and shaded toward the bottom right.
    `<linearGradient id="course-fwfill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="${H}"><stop class="a-fw-lit" offset="0"/><stop class="a-fw" offset=".5"/><stop class="a-fw-shade" offset="1"/></linearGradient>`,
    '<radialGradient id="course-dome" cx="40%" cy="34%" r="72%"><stop class="a-green-hi" offset="0"/><stop class="a-green" offset="0.7"/><stop class="a-green-lo" offset="1"/></radialGradient>',
    // The raised green's soft shade, falling down and right of it.
    '<radialGradient id="course-gshadow" cx="50%" cy="50%" r="50%"><stop class="a-gshadow" offset=".78"/><stop class="a-dark-0" offset="1"/></radialGradient>',
    '<radialGradient id="course-vignette" cx="50%" cy="50%" r="75%"><stop class="a-dark-0" offset="0.62"/><stop class="a-vignette" offset="1"/></radialGradient>',
    '<linearGradient id="course-shade" x1="0" y1="0" x2="0" y2="1"><stop class="a-shade" offset="0"/><stop class="a-dark-0" offset=".22"/></linearGradient>',
    '<linearGradient id="course-teebox" x1="0" y1="0" x2="0" y2="1"><stop class="a-tee-hi" offset="0"/><stop class="a-tee-lo" offset="1"/></linearGradient>',
    // Faint mowing bands on the green, across the line of play (rings read as contours).
    `<pattern id="course-gmow" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(${f(shape.angle + 90)})"><rect class="a-green-stripe" width="7" height="14"/></pattern>`,
  ];
  if (shape.water || ponds.length) {
    // Water: deep in the middle, shallow at the bank.
    out.push('<radialGradient id="course-depth" cx="46%" cy="44%" r="60%"><stop class="a-water-deep" offset="0"/><stop class="a-water" offset=".6"/><stop class="a-water-shallow" offset="1"/></radialGradient>');
  }
  if (shape.water) {
    // An island green's water fades in over 30px below the top of the open band, under the chips.
    out.push(`<linearGradient id="course-wfade" gradientUnits="userSpaceOnUse" x1="0" y1="${frame.bandTop}" x2="0" y2="${frame.bandTop + 30}"><stop offset="0" stop-color="white" stop-opacity="0"/><stop offset="1" stop-color="white"/></linearGradient>`);
    out.push(`<mask id="course-wmask"><rect width="${W}" height="${H}" fill="url(#course-wfade)"/></mask>`);
  }
  if (bunkers.length) {
    // Sand: shaded under the lip at the top left, lit toward the bottom right. Its finer grain is the page's sand tile.
    out.push('<linearGradient id="course-sand" x1="0" y1="0" x2="1" y2="1"><stop class="a-sand-lo" offset="0"/><stop class="a-sand-mid" offset=".45"/><stop class="a-sand-hi" offset="1"/></linearGradient>');
  }
  out.push('</defs>', `<rect width="${W}" height="${H}" fill="url(#course-rough)"/>`);
  if (fairway) {
    const d = smooth(fairway);
    // A soft shade where the taller rough meets it, the rough's darker edge, the first cut, the fairway in its light, then
    // its stripes.
    out.push(`<path class="a-edge-soft" d="${d}" fill="none" stroke-width="34" stroke-linejoin="round"/>`);
    out.push(`<path class="a-edge" d="${d}" fill="none" stroke-width="20" stroke-linejoin="round"/>`);
    out.push(`<path class="a-cut" d="${d}" fill="none" stroke-width="10" stroke-linejoin="round"/>`);
    out.push(`<path class="fairway" d="${d}" fill="url(#course-fwfill)"/><path d="${d}" fill="url(#course-mow)"/>`);
  }
  // A fine grain over the rough and the fairway: the page's noise tile (src/grain.ts), made once, no SVG filter. Under the
  // vignette and the header's shade, it also keeps their dark gradients from banding.
  out.push(`<rect width="${W}" height="${H}" fill="url(#course-grain)"/>`);
  for (const h of bunkers) out.push(bunkerSvg(h));
  for (const h of ponds) out.push(pondSvg(h));
  const ring = (s: number, dx = 0, dy = 0) => g.outline.map((r, j): [number, number] => {
    const a = (j / g.outline.length) * Math.PI * 2;
    return [g.cx + dx + Math.cos(a) * g.rx * r * s, g.cy + dy + Math.sin(a) * g.ry * r * s];
  });
  if (shape.water) {
    const along = (d: number): [number, number] => [g.cx + Math.cos((d * Math.PI) / 180) * g.rx * 1.58, g.cy + Math.sin((d * Math.PI) / 180) * g.ry * 1.58];
    out.push(`<g mask="url(#course-wmask)"><path class="water" d="${smooth(ring(1.78))}" fill="url(#course-depth)" stroke-width="2.5"/>`);
    out.push(`<path class="a-water-glint" d="${arc(along, 200, 250)}" fill="none" stroke-width="2" stroke-linecap="round"/></g>`);
  }
  // The green: its soft shade, the fringe, the collar, a softly domed surface and faint mowing bands.
  out.push(`<path class="a-green-shadow" d="${smooth(ring(1.3, 3, 5))}" fill="url(#course-gshadow)"/>`);
  out.push(`<path class="a-fringe" d="${smooth(ring(1.17))}" stroke-width="1.5"/>`);
  out.push(`<path class="a-collar" d="${smooth(ring(1.08))}"/>`);
  out.push(`<path class="green" d="${smooth(ring(1))}" fill="url(#course-dome)"/>`);
  out.push(`<path d="${smooth(ring(1))}" fill="url(#course-gmow)"/>`);
  if (pin) {
    // The pole's shadow, the cup, the pole and a flag that waves.
    const fw = flagWidth(pin.pole);
    const fh = Math.max(10, pin.pole * 0.34);
    const top = pin.y - pin.pole;
    const x = pin.x;
    out.push(`<path d="M${f(x)} ${f(pin.y)}l${f(pin.pole * 0.6)} ${f(pin.pole * 0.22)}" class="a-shadow-line" stroke-width="3" stroke-linecap="round"/>`);
    out.push(`<ellipse class="a-cup" cx="${f(x)}" cy="${f(pin.y)}" rx="3.6" ry="1.9"/>`);
    out.push(`<path class="a-pole" d="M${f(x)} ${f(pin.y)}V${f(top)}" stroke-width="2.2" stroke-linecap="round"/>`);
    out.push(`<path class="flag" d="M${f(x + 1)} ${f(top)}C${f(x + fw * 0.4)} ${f(top - 2.5)} ${f(x + fw * 0.7)} ${f(top + fh * 0.2)} ${f(x + fw)} ${f(top + fh * 0.42)}C${f(x + fw * 0.66)} ${f(top + fh * 0.62)} ${f(x + fw * 0.34)} ${f(top + fh * 0.66)} ${f(x + 1)} ${f(top + fh * 0.84)}Z"/>`);
    out.push(`<path d="M${f(x + 1)} ${f(top)}C${f(x + fw * 0.4)} ${f(top - 2.5)} ${f(x + fw * 0.55)} ${f(top + fh * 0.1)} ${f(x + fw * 0.62)} ${f(top + fh * 0.3)}L${f(x + 1)} ${f(top + fh * 0.5)}Z" class="a-flag-shade"/>`);
  }
  for (const m of shape.markers) {
    const w = markerWidth(m.d);
    out.push(`<g class="marker"><circle cx="${f(m.x)}" cy="${f(m.y)}" r="5.5" class="a-marker" stroke-width="1.5"/>`);
    out.push(`<rect x="${f(m.x + 10)}" y="${f(m.y - 11)}" width="${w}" height="22" rx="11" class="a-marker-label"/>`);
    out.push(`<text x="${f(m.x + 10 + w / 2)}" y="${f(m.y + 4.5)}" text-anchor="middle">${m.d} m</text></g>`);
  }
  // A bevelled tee box with two markers.
  out.push(`<rect x="${f(tee.x - tee.width / 2)}" y="${f(tee.y - 9)}" width="${f(tee.width)}" height="24" rx="10" class="a-tee-edge"/>`);
  out.push(`<rect class="tee" x="${f(tee.x - tee.width / 2)}" y="${f(tee.y - 12)}" width="${f(tee.width)}" height="24" rx="10" fill="url(#course-teebox)"/>`);
  for (const dx of [-0.3, 0.3]) {
    out.push(`<ellipse cx="${f(tee.x + tee.width * dx)}" cy="${f(tee.y + 1.5)}" rx="4.5" ry="1.8" class="a-shadow"/><circle cx="${f(tee.x + tee.width * dx)}" cy="${f(tee.y - 3)}" r="4.2" class="a-pole-fill"/>`);
  }
  out.push(`<rect width="${W}" height="${H}" fill="url(#course-vignette)"/><rect width="${W}" height="${H}" fill="url(#course-shade)"/>`);
  return out.join('');
}
