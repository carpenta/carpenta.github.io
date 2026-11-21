import { inRing, lineLength, orienter, pointFromEnd, ringCentroid, segmentDistance, type Pt } from './osm-geo';
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

/** How large a hazard is drawn, in px: v31's from the screen's width, v33's from the drawing's scale. */
interface Sizes {
  /** A bunker by the green: its half length as a share of the green's, at least and at most. */
  bunker: [number, number, number];
  /** A pond by the green: its half length beside it (across) and in front of or behind it, likewise. */
  pondAcross: [number, number, number];
  pondAlong: [number, number, number];
  /** A pond by the green: its half width, at least and at most. */
  pondDepth: [number, number];
  /** Along a fairway: a bunker's and a pond's half length. */
  fairwayBunker: number;
  fairwayPond: number;
  /** Water the tee shot carries: its half length across the line of play and its half width along it. */
  carry: [number, number];
}

/** What a hazard must keep off, and where it may go. */
interface Room {
  /** Where hazards may lie: v31 keeps their middles inside it (`middles`), v33 the whole of each. */
  inside: Box;
  middles: boolean;
  green: CourseShape['green'];
  /** The way of play into the green, a unit vector from the tee side toward it. */
  ahead: [number, number];
  /** Water the tee shot carries lies on the line of play: the tee's middle, the way of play from it, how far the tee
   * box's front edge is, and how far at least the pond's middle lies (v33: out where the carry is). */
  tee: { x: number; y: number; dir: [number, number]; front: number; least: number };
  /** Along a fairway (null on a par 3): its middle and its way toward the green at t (0 the green, 1 the tee), its half
   * width in px there, where the tee shot lands, and how many px t runs. */
  line: { at: (t: number) => [number, number]; toward: (t: number) => [number, number]; half: (t: number) => number; land: number; span: number } | null;
  /** The header, the tee box, the flag and the distance markers. */
  blocked: Box[];
  index: number;
  sizes: Sizes;
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
  const { green: g, inside: box, sizes } = room;
  const placed: { order: number; f: Fitted }[] = [];
  // The fringe, at its widest, is the green's keep-out.
  const A = g.rx * 1.17 * Math.max(...g.outline);
  const B = g.ry * 1.17 * Math.max(...g.outline);
  const fits = (c: Fitted): boolean => {
    const { h, rim, reach } = c;
    // Its middle (v31), or all of it out to its widest: the extent of the turned ellipse round its outline (v33).
    const ex = room.middles ? 0 : Math.hypot(c.ax * c.cos, c.ay * c.sin);
    const ey = room.middles ? 0 : Math.hypot(c.ax * c.sin, c.ay * c.cos);
    if (h.cx - ex < box.x0 || h.cx + ex > box.x1 || h.cy - ey < box.y0 || h.cy + ey > box.y1) return false;
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
            const [share, least, most] = item.kind === 'bunker' ? sizes.bunker : across ? sizes.pondAcross : sizes.pondAlong;
            const rx = size * clamp(g.rx * share, least, most) * (item.kind === 'bunker' ? shrink : 1);
            const ry = item.kind === 'bunker' ? rx * 0.56 : size * clamp((rx / size) * (across ? 0.36 : 0.5), ...sizes.pondDepth);
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
      const rx0 = item.kind === 'bunker' ? sizes.fairwayBunker : sizes.fairwayPond;
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
      // In front of the tee box, between it and the green: across the line of play, `rot` px to one side of it.
      const outline = POND_RIMS[room.index % 2];
      const m = Math.max(...outline) * REACH;
      const { x, y, dir: [dx, dy], front, least } = room.tee;
      jobs.push({
        order: order++,
        kind: 'water',
        spots: [null],
        make: (rot, push, _spot, size) => {
          const rx = size * sizes.carry[0];
          const ry = size * sizes.carry[1];
          const out = Math.max(front + GAP + ry * m, least) + push * (2 * ry * m + GAP);
          return { kind: 'water', cx: x + dx * out - dy * rot, cy: y + dy * out + dx * rot, rx, ry, angle: deg(Math.atan2(dx, -dy)), outline };
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
    const carry = clamp(tee.width * 0.62, 26, 64);
    hazards = placeHazards(named, {
      inside: { x0: 8, y0: 6, x1: W - 8, y1: H - 6 },
      middles: true,
      green,
      ahead: k === 0 ? unit([cx - tee.x, cy - tee.y]) : unit([at(0)[0] - at(0.15)[0], at(0)[1] - at(0.15)[1]]),
      tee: { x: tee.x, y: tee.y, dir: [0, -1], front: 12, least: 0 },
      line: k === 0 ? null : { at, toward, half: halfAt, land, span: y1 - y0 },
      blocked,
      index: i,
      sizes: {
        bunker: [0.36, 11, 26], pondAcross: [0.78, 20, 52], pondAlong: [0.6, 18, 44], pondDepth: [9, 20],
        fairwayBunker: clamp(W * 0.05, 12, 22), fairwayPond: clamp(W * 0.11, 26, 50), carry: [carry, clamp(carry * 0.34, 11, 18)],
      },
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
 * the green) and a red pennant, flat. In the green's window (v35) the pennant is the window's own (`in-flag`).
 */
function pinSvg(pin: { x: number; y: number; pole: number }, flag = 'flag'): string {
  const fw = flagWidth(pin.pole);
  const fh = Math.max(10, pin.pole * 0.34);
  const top = pin.y - pin.pole;
  const x = pin.x;
  const pole = `M${f(x)} ${f(pin.y)}V${f(top)}`;
  return `<ellipse class="a-cup" cx="${f(x)}" cy="${f(pin.y)}" rx="3.6" ry="1.9"/>`
    + `<path class="a-pole-edge" d="${pole}" stroke-width="3.8" stroke-linecap="round"/>`
    + `<path class="a-pole" d="${pole}" stroke-width="2.2" stroke-linecap="round"/>`
    + `<path class="${flag}" d="M${f(x + 1)} ${f(top)}l${f(fw)} ${f(fh * 0.42)}l${f(-fw)} ${f(fh * 0.42)}z"/>`;
}

/**
 * A 100 m or 150 m marker: a white dot on the line of play and its distance in a dark pill, beside it (v31) or where
 * the band drawing put it, above or below the dot (v33). Since v35, where the screen already gives the unit, the bare
 * number in the middle of its room, white in a deep halo (style.css), as a yardage book writes it.
 */
function markerSvg(m: { x: number; y: number; d: number; label?: Box; text?: string }): string {
  const dot = `<circle cx="${f(m.x)}" cy="${f(m.y)}" r="5.5" class="a-marker" stroke-width="1.5"/>`;
  if (m.label && m.text === String(m.d)) {
    // The baseline half the figures' height (13px Pretendard's 9.4px) under the room's middle.
    return `<g class="marker">${dot}<text class="a-marker-num" x="${f((m.label.x0 + m.label.x1) / 2)}" y="${f((m.label.y0 + m.label.y1) / 2 + 4.7)}" text-anchor="middle">${m.text}</text></g>`;
  }
  const w = markerWidth(m.d);
  const at = m.label ?? { x0: m.x + 10, y0: m.y - 11, x1: m.x + 10 + w, y1: m.y + 11 };
  return `<g class="marker">${dot}`
    + `<rect x="${f(at.x0)}" y="${f(at.y0)}" width="${w}" height="22" rx="11" class="a-marker-label"/>`
    + `<text x="${f(at.x0 + w / 2)}" y="${f(at.y0 + 15.5)}" text-anchor="middle">${m.d} m</text></g>`;
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
  out.push(greenSvg(g, shape.water ? 1.78 : 0));
  if (pin) out.push(pinSvg(pin));
  for (const m of shape.markers) out.push(markerSvg(m));
  // The tee box and its two markers.
  out.push(`<rect class="tee" x="${f(tee.x - tee.width / 2)}" y="${f(tee.y - 12)}" width="${f(tee.width)}" height="24" rx="10"/>`);
  for (const dx of [-0.3, 0.3]) out.push(`<circle cx="${f(tee.x + tee.width * dx)}" cy="${f(tee.y - 3)}" r="4.2" class="a-pole-fill"/>`);
  return out.join('');
}

// ---------- The hole in the band 기록 shows (v33) ----------

/** The © OpenStreetMap credit under the band (v33): its text, and its touch area round it. */
export interface Credit { text: Box; touch: Box }
/** Which end of the band's bottom edge the credit stands at: the card's left content edge, or its right. */
export type CreditSide = 'start' | 'end';
/**
 * The credit's ends, in the order tried (v33): at the left, else at the right where water would lie behind it at the
 * left. Over Everis's 25 holes at the four measured bands it stands in (50px and up), after moving the hole within its
 * room, the left alone kept water from behind the credit in 97 cases of 100 and the right alone in 94; either end as
 * needed, in 99 (새별 7 in 상세 at 390×844 keeps a sliver, 0.1% of its line box, at either end).
 */
export const CREDIT_SIDES: CreditSide[] = ['start', 'end'];

/**
 * The part of 기록's screen the drawing is seen in (v33), in CSS px: from under the chip row to the entry sheet's top
 * edge, across the sheet's width. `keep` is anything else over it that the hole keeps clear of; `credit` the © OpenStreetMap
 * link at the band's bottom left while it shows, whose touch area the hole keeps out of, and whose text it keeps water
 * from behind where it can.
 */
export interface ArtBand extends Box { keep: Box[]; credit?: Credit }

/**
 * The shortest band a hole is fitted into (v33): 50px. Below it the room under the chips is under 42px tall, half of
 * Everis's OpenStreetMap greens come out under about 15px across and almost no distance marker fits (1 hole of 25 at a
 * 47px band, 7 at 56px, 12 at 59px), as the design critique found at 360×640's 32px band. A shorter band (360×640,
 * 375×667's 상세, 375×553) shows the header's small picture instead, with v31's drawing stepped back behind the header.
 */
export const FIT_BAND = 50;

/**
 * A 100 m or 150 m marker on the line of play, with its distance pill above or below the dot (v33); `text` is what the
 * label says, "150 m" in its pill or (v35) the bare "150".
 */
export interface Marker { x: number; y: number; d: number; label: Box; text: string }

/** How a hole is drawn in the band (v35). */
export interface DrawOptions {
  /** The markers as bare numbers: the screen already gives the unit in metres (the chip says "381 m"; 홀 안내 says what
   * the marks measure). */
  bare?: boolean;
  /** The green up close in a window, where a tall band has room beside the hole (OpenStreetMap's holes). */
  inset?: boolean;
}

/** A marker's label and the room it takes: the bare number (v35: "150" at 13px, 800, is about 24px, its halo 1.5px each
 * side) or "150 m" in its 54 by 22px pill, 3px off the dot. */
const labelOf = (d: number, bare: boolean) => (bare ? { text: String(d), w: 30, h: 18, gap: 2 } : { text: `${d} m`, w: markerWidth(d), h: 22, gap: 3 });

/** Kept between the hole and the band's top and bottom: 2px on a short band, up to 8px on a tall one. */
const padFor = (h: number) => clamp(Math.round(h * 0.04), 2, 8);
/** Kept under the chip row whatever the band (the v33 critique: 2–3px read as crowding the chips, a pill as a fourth chip). */
const CHIPS = 6;
/** Where the hole may lie in the band: its padding at the bottom, at least `CHIPS` at the top. */
const padded = (band: Box): Box => {
  const pad = padFor(band.y1 - band.y0);
  return { x0: band.x0, y0: band.y0 + Math.max(CHIPS, pad), x1: band.x1, y1: band.y1 - pad };
};
/** The flag's pole for a band this tall: 12px up to about a 70px band, 30px from about 165px up. */
const poleFor = (h: number) => clamp(Math.round(h * 0.18), 12, 30);
/** Kept between the hole and what lies over the band, and between a distance pill and the flag. */
const CLEAR = 4;
/** A marker's dot out to the edge of its ring (r 5.5, a 1.5px ring). */
const DOT = 6.25;

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const contains = (outer: Box, b: Box) => b.x0 >= outer.x0 && b.y0 >= outer.y0 && b.x1 <= outer.x1 && b.y1 <= outer.y1;
const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
const union = (boxes: Box[]): Box => boxes.reduce((u, b) => ({ x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) }));

/** The box round some points. */
function bounds(pts: Pt[]): Box {
  let b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) b = { x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) };
  return b;
}

/** An outline `k` times its size about its middle: a green's fringe, as osmSvg draws it (`about`). */
const grown = (ring: Pt[], k: number): Pt[] => {
  const [cx, cy] = ringCentroid(ring);
  return ring.map(([x, y]): Pt => [cx + (x - cx) * k, cy + (y - cy) * k]);
};

/** A box at the band's other end: the credit stands the card's padding in from either edge, so it mirrors across. */
const across = (b: Box, band: Box): Box => ({ x0: band.x0 + band.x1 - b.x1, y0: b.y0, x1: band.x0 + band.x1 - b.x0, y1: b.y1 });

/** Whether a straight piece of shore meets a box (Liang–Barsky: what of it lies inside the box's four sides). */
function meets([ax, ay]: Pt, [bx, by]: Pt, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const [pq, qq] of [[ax - bx, ax - b.x0], [bx - ax, b.x1 - ax], [ay - by, ay - b.y0], [by - ay, b.y1 - ay]]) {
    if (pq === 0) {
      if (qq < 0) return false;
    } else if (pq < 0) {
      t0 = Math.max(t0, qq / pq);
    } else {
      t1 = Math.min(t1, qq / pq);
    }
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * How much water lies behind a box, 0 to 1: none when no shore meets it and it lies in no pond (or on an island); else
 * the share of points every 1px across it in water, and never less than a sliver.
 */
function wetShare(water: Pt[][][], box: Box): number {
  const ponds = water.filter((w) => overlaps(bounds(w[0]), box));
  const inWater = (p: Pt) => ponds.some((w) => inRing(p, w[0]) && !w.slice(1).some((r) => inRing(p, r)));
  const shore = ponds.some((w) => w.some((r) => r.some((a, j) => meets(a, r[(j + 1) % r.length], box))));
  if (!shore && !inWater([(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2])) return 0;
  let wet = 0;
  let all = 0;
  for (let x = box.x0 + 0.5; x < box.x1; x += 1) {
    for (let y = box.y0 + 0.5; y < box.y1; y += 1) {
      all++;
      if (inWater([x, y])) wet++;
    }
  }
  return Math.max(wet / all, 0.001);
}

/** What the pin's flag takes round the pin (pinSvg): the cup, the pole in its 3.8px edge and the pennant to its right. */
const flagBox = (pin: { x: number; y: number; pole: number }): Box => ({ x0: pin.x - 3.6, y0: pin.y - pin.pole - 1.9, x1: pin.x + 1 + flagWidth(pin.pole), y1: pin.y + 1.9 });

/** The rooms the hole may take: the band within its padding, then beside, above or below each box it keeps clear. */
function roomsIn(band: ArtBand): Box[] {
  let rooms: Box[] = [padded(band)];
  for (const keep of band.keep) {
    const k = grow(keep, CLEAR);
    rooms = rooms.flatMap((r) => (overlaps(r, k)
      ? [{ ...r, x0: Math.max(r.x0, k.x1) }, { ...r, x1: Math.min(r.x1, k.x0) }, { ...r, y0: Math.max(r.y0, k.y1) }, { ...r, y1: Math.min(r.y1, k.y0) }]
        .filter((b) => b.x1 - b.x0 >= 40 && b.y1 - b.y0 >= 16)
      : [r]));
  }
  return rooms;
}

/**
 * The largest scale (px per metre) at which the drawing's box fits the room, found by halving: what grows with the
 * scale (the outlines) and what does not (the flag, a cut's stroke, a least size) together. 0 when it never fits.
 */
function largestScale(boxAt: (s: number) => Box, room: Box): number {
  const fits = (s: number) => {
    const b = boxAt(s);
    return b.x1 - b.x0 <= room.x1 - room.x0 && b.y1 - b.y0 <= room.y1 - room.y0;
  };
  if (!fits(0)) return 0;
  let lo = 0;
  let hi = 1;
  while (fits(hi) && hi < 1e3) [lo, hi] = [hi, hi * 2];
  for (let j = 0; j < 40; j++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The drawing as large as one of the band's rooms allows (the one that lets it be largest), and how far to move it so
 * it sits in that room's middle.
 */
function fitIn(band: ArtBand, boxAt: (s: number) => Box): { s: number; room: Box; dx: number; dy: number } {
  let best = { s: 0, room: roomsIn({ ...band, keep: [] })[0] };
  for (const room of roomsIn(band)) {
    const s = largestScale(boxAt, room);
    if (s > best.s) best = { s, room };
  }
  const b = boxAt(best.s);
  return { ...best, dx: (best.room.x0 + best.room.x1) / 2 - (b.x0 + b.x1) / 2, dy: (best.room.y0 + best.room.y1) / 2 - (b.y0 + b.y1) / 2 };
}

/**
 * The 100 m and 150 m markers (v33) at their distance from the green's middle along the line of play (`at`), each
 * where its dot and its pill lie in the band, `CHIPS` under its top, clear of `hard` and of each other, the pill off
 * `soft` too where it can be (the hazards). Both pills go on one side of the line, both over their dots or both leaning
 * apart (150 m's toward the tee, 100 m's toward the green): of the four, the one that shows most, then the one off the
 * hazards, then above and over the dots. `length` is the official length: a marker only where the hole is at least 60 m
 * longer than it. `bare` labels them with their bare numbers (v35).
 */
function placeMarkers(length: number | null, at: (d: number) => Pt | null, band: Box, hard: Box[], soft: Box[], bare = false): Marker[] {
  const room: Box = { ...band, y0: band.y0 + CHIPS };
  const lay = (side: -1 | 1, apart: boolean) => {
    const markers: Marker[] = [];
    const taken = [...hard];
    let missed = 0;
    for (const d of [100, 150]) {
      if (length !== null && length < d + 60) continue;
      const p = at(d);
      if (!p) continue;
      const [x, y] = p;
      const { text, w, h, gap } = labelOf(d, bare);
      const dot: Box = { x0: x - DOT, y0: y - DOT, x1: x + DOT, y1: y + DOT };
      if (!contains(room, dot) || taken.some((b) => overlaps(dot, b))) continue;
      const top = side < 0 ? y - DOT - gap - h : y + DOT + gap;
      const x0 = !apart ? x - w / 2 : d === 150 ? x + DOT - w : x - DOT;
      const label: Box = { x0, y0: top, x1: x0 + w, y1: top + h };
      if (!contains(room, label) || taken.some((t) => overlaps(label, t))) continue;
      if (soft.some((t) => overlaps(label, t))) missed++;
      markers.push({ x, y, d, label, text });
      taken.push(dot, label);
    }
    return { markers, missed };
  };
  return [lay(-1, false), lay(-1, true), lay(1, false), lay(1, true)]
    .reduce((best, o) => (o.markers.length > best.markers.length || (o.markers.length === best.markers.length && o.missed < best.missed) ? o : best)).markers;
}

/** The schematic's fairway (v33): its half width in metres at stations from its start to the green, a par 4's widest
 * where the tee shot lands and a par 5's narrowing between its two landing areas. */
const STATIONS = [0, 0.12, 0.3, 0.5, 0.7, 0.88, 1];
const WIDTHS = [[], [12, 16, 19, 20, 18, 15, 12], [12, 17, 19, 15, 18, 15, 12]];
/** Each hole's fairway its own: at each station one edge swells by this share as the other draws in, so none is a capsule. */
const SWAYS = [[0, 0.12, -0.08, 0.14, -0.06, 0.1, 0], [0, -0.1, 0.12, -0.12, 0.08, -0.08, 0], [0, 0.08, 0.14, -0.1, 0.12, 0.04, 0]];

/**
 * The schematic's line of play in metres from the tee (v33), `length` long: straight, or for a dogleg leaving the tee
 * straight and turning about 24° toward the green (up for the player's left, down for the right).
 */
function playLine(length: number, turnTo: Bend): Pt[] {
  if (!turnTo) return [[0, 0], [length, 0]];
  const th = (24 * Math.PI) / 180;
  const end: Pt = [0.6 + 0.4 * Math.cos(th), turnTo * 0.4 * Math.sin(th)];
  // A quadratic curve from the tee through the elbow's corner (0.6, 0) to the green.
  const pts = Array.from({ length: 25 }, (_, j): Pt => {
    const t = j / 24;
    return [2 * (1 - t) * t * 0.6 + t * t * end[0], t * t * end[1]];
  });
  const k = length / lineLength(pts);
  return pts.map(([x, y]): Pt => [x * k, y * k]);
}

/** The point `back` metres from the line's end (at most its start), and the way of play there toward the green. */
function alongLine(line: Pt[], back: number): { p: Pt; dir: Pt } {
  let left = Math.max(0, back);
  for (let j = line.length - 1; j > 0; j--) {
    const [a, b] = [line[j - 1], line[j]];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: Pt = seg ? [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg] : [1, 0];
    if (seg >= left || j === 1) {
      const t = Math.min(left, seg);
      return { p: [b[0] - dir[0] * t, b[1] - dir[1] * t], dir };
    }
    left -= seg;
  }
  return { p: line[0], dir: [1, 0] };
}

/** The schematic fitted into the band (v33): our own plan of the hole at one scale, tee at the left and green at the right. */
export interface BandShape {
  /** px per metre. */
  scale: number;
  /** The line of play from the tee's middle to the green's, where the distance markers stand (not drawn). */
  line: Pt[];
  /** The tee box: its middle, its length along the line of play and its width across it. */
  tee: { x: number; y: number; along: number; across: number };
  /** About its real size: 32 m by 26 m, at least 18 by 14px. */
  green: CourseShape['green'];
  pin: { x: number; y: number; pole: number };
  /** The fairway's outline from in front of the tee to the green; null on a par 3. */
  fairway: Pt[] | null;
  /** Water round an island green: its outline's size as a multiple of the green's (1.78, down to 1.4 on the shortest
   * band), or 0. */
  water: number;
  markers: Marker[];
  hazards: HazardShape[];
  /** Where it was fitted: the band within its padding (beside what it keeps clear). */
  room: Box;
}

/**
 * The schematic in the band 기록 shows (v33): drawn from the par, the length and the note as v31's is, but laid across
 * the band at one scale, tee at the left and green at the right, the player's left up, as large as the band allows and
 * in its middle. The green is about its real size, so the 100 m and 150 m markers, measured to its middle as course
 * markers are, agree with it. The bunkers and water the note names lie wholly in the band; where they find no room the
 * hole is drawn a little smaller, up to four times. `length` is the official length, when the course publishes one;
 * `opts.bare` labels the markers with their bare numbers (v35).
 */
export function bandShape(par: Par, index: number, band: ArtBand, bend: Bend, island = false, length: number | null = null, named: HoleHazard[] = [], opts: DrawOptions = {}): BandShape {
  const i = ((index % PIN.length) + PIN.length) % PIN.length;
  const k = par === 3 ? 0 : par === 4 ? 1 : 2;
  const L = length ?? [150, 360, 480][k];
  const line = playLine(L, k === 0 ? 0 : bend);
  const pole = poleFor(band.y1 - band.y0);
  const roomH = padded(band).y1 - padded(band).y0;
  const outline = GREENS[i % GREENS.length];
  // The smooth curve through a green's outline points reaches 2% past them.
  const m = Math.max(...outline) * 1.02;
  // The fairway from about 50 to 110 m out (rough in front of the tee) to the green's front edge.
  const start = clamp(L * 0.22, 50, 110);
  const end = L - 14;
  const halfAt = (d: number, s: number) => {
    const u = clamp((d - start) / (end - start), 0, 1);
    const j = clamp(STATIONS.findIndex((v) => v >= u), 1, STATIONS.length - 1);
    const w = WIDTHS[k][j - 1] + ((WIDTHS[k][j] - WIDTHS[k][j - 1]) * (u - STATIONS[j - 1])) / (STATIONS[j] - STATIONS[j - 1]);
    return Math.max(w * s, 3.5);
  };
  /** The hole at scale s, in px from the tee's middle, and the box it takes. */
  const core = (s: number) => {
    const P = ([x, y]: Pt): Pt => [x * s, y * s];
    // A tee box the eye finds at any scale (the v33 critique: 12×9px on a par 5 read as a speck), as the flag is.
    const tee = { x: 0, y: 0, along: Math.max(14 * s, 16), across: Math.max(10 * s, 10) };
    const [gx, gy] = P(line[line.length - 1]);
    const green = { cx: gx, cy: gy, rx: Math.max(16 * s, 9), ry: Math.max(13 * s, 7), outline };
    // A little off the green's middle, varied per hole; level with it or below, so the flag over it fits a short band.
    const pinY = gy + green.ry * Math.abs(PIN[i][1]) * 1.2;
    // On the shortest band the pole gives way (to 10px at least) to the green, or an island's water, below the pin.
    // An island's water round it, narrower on the shortest band (to 1.4 times the green) so all of it shows.
    const water = island ? clamp((roomH / 2 - 1) / (green.ry * m), 1.4, 1.78) : 0;
    const below = gy + green.ry * m * (island ? water : 1.1) + (island ? 1 : 0) - pinY;
    const pin = { x: gx + green.rx * PIN[i][0] * 0.8, y: pinY, pole: clamp(Math.floor(roomH - below - 3.8), 10, pole) };
    let fairway: Pt[] | null = null;
    if (k > 0) {
      const side = (sign: number) => STATIONS.map((t, j): Pt => {
        const d = start + (end - start) * t;
        const { p, dir } = alongLine(line, L - d);
        const w = halfAt(d, s) * (1 + sign * SWAYS[i % SWAYS.length][j]) * sign;
        return [p[0] * s - dir[1] * w, p[1] * s + dir[0] * w];
      });
      fairway = [P(alongLine(line, L - start + 10).p), ...side(-1), P(alongLine(line, L - end - 6).p), ...side(1).reverse()];
    }
    const ring = (r: number, edge: number): Box => ({ x0: gx - green.rx * r * m - edge, y0: gy - green.ry * r * m - edge, x1: gx + green.rx * r * m + edge, y1: gy + green.ry * r * m + edge });
    const teeBox: Box = { x0: -tee.along / 2, y0: -tee.across / 2, x1: tee.along / 2, y1: tee.across / 2 };
    const box = union([teeBox, ring(1.1, 0), ...(island ? [ring(water, 1)] : []), ...(fairway ? [grow(bounds(fairway), 4)] : []), flagBox(pin)]);
    return { tee, green, pin, fairway, water, teeBox, box };
  };
  const fit = fitIn(band, (s) => core(s).box);
  const want = named.reduce((n, h) => n + (h.at === 'tee' ? 1 : h.count), 0);
  const keep = band.keep.map((b) => grow(b, CLEAR));
  const drawAt = (s: number): BandShape => {
    const c = core(s);
    const dx = (fit.room.x0 + fit.room.x1) / 2 - (c.box.x0 + c.box.x1) / 2;
    const dy = (fit.room.y0 + fit.room.y1) / 2 - (c.box.y0 + c.box.y1) / 2;
    const P = ([x, y]: Pt): Pt => [dx + x * s, dy + y * s];
    const move = ([x, y]: Pt): Pt => [dx + x, dy + y];
    const tee = { ...c.tee, x: dx, y: dy };
    const green = { ...c.green, cx: c.green.cx + dx, cy: c.green.cy + dy };
    const pin = { ...c.pin, x: c.pin.x + dx, y: c.pin.y + dy };
    const teeBox: Box = { x0: c.teeBox.x0 + dx, y0: c.teeBox.y0 + dy, x1: c.teeBox.x1 + dx, y1: c.teeBox.y1 + dy };
    const carry = clamp(26 * s, 10, 36);
    const land = k === 1 ? (length ? clamp((length - 230) / length, 0.3, 0.6) : 0.42) : length ? clamp((length - 240) / length, 0.4, 0.65) : 0.55;
    const hazards = named.length ? placeHazards(named, {
      inside: { ...grow(band, -1), y0: band.y0 + CHIPS + 1 },
      middles: false,
      green,
      ahead: alongLine(line, 0).dir,
      // Water the tee shot carries lies out where the carry is, past the tee box and short of the fairway.
      tee: { x: tee.x, y: tee.y, dir: alongLine(line, L).dir, front: tee.along / 2, least: start * s * 0.55 },
      line: k === 0 ? null : { at: (t) => P(alongLine(line, t * L).p), toward: (t) => alongLine(line, t * L).dir, half: (t) => halfAt(L * (1 - t), s), land, span: L * s },
      blocked: [...keep, grow(teeBox, 2), { x0: pin.x - 3, y0: pin.y - pin.pole - 4, x1: pin.x + flagWidth(pin.pole) + 2, y1: pin.y + 3 }],
      index: i,
      sizes: {
        bunker: [0.55, 6, 20], pondAcross: [1, 10, 40], pondAlong: [0.8, 9, 34], pondDepth: [5, 18],
        fairwayBunker: clamp(11 * s, 6, 20), fairwayPond: clamp(28 * s, 10, 40), carry: [carry, clamp(carry * 0.42, 5, 15)],
      },
    }) : [];
    const shape: BandShape = {
      scale: s, line: line.map(P), tee, green, pin, fairway: c.fairway ? c.fairway.map(move) : null, water: c.water, markers: [], hazards, room: fit.room,
    };
    // The markers on a par 4 or 5 of known length (a par 3 has no fairway to measure along), clear of the flag, the tee
    // and the green.
    if (k > 0 && length !== null) {
      const fringe: Box = { x0: green.cx - green.rx * 1.1 * m, y0: green.cy - green.ry * 1.1 * m, x1: green.cx + green.rx * 1.1 * m, y1: green.cy + green.ry * 1.1 * m };
      const soft = hazards.map((h) => bounds(fitted(h).rim));
      shape.markers = placeMarkers(length, (d) => P(alongLine(line, d).p), band, [...keep, grow(flagBox(pin), CLEAR), grow(teeBox, 2), fringe], soft, opts.bare);
    }
    return shape;
  };
  // Drawn a little smaller, up to four times, while a named hazard finds no room; the drawing that placed most is kept.
  let best = drawAt(fit.s);
  for (let t = 1, s = fit.s * 0.9; t < 5 && best.hazards.length < want; t++, s *= 0.9) {
    const next = drawAt(s);
    if (next.hazards.length > best.hazards.length) best = next;
  }
  return best;
}

/** A green in its fringe, in its water when it is an island (v31's drawing and v33's): `water` is its size, or 0. */
function greenSvg(g: CourseShape['green'], water: number): string {
  const ring = (s: number) => g.outline.map((r, j): [number, number] => {
    const a = (j / g.outline.length) * Math.PI * 2;
    return [g.cx + Math.cos(a) * g.rx * r * s, g.cy + Math.sin(a) * g.ry * r * s];
  });
  // An island green stands in its water, `water` times its size.
  return `${water ? `<g class="pond"><path class="water" d="${smooth(ring(water))}" stroke-width="2"/></g>` : ''}<path class="a-fringe" d="${smooth(ring(1.1))}"/><path class="green" d="${smooth(ring(1))}"/>`;
}

/**
 * The SVG content for the schematic in the band (v33), in v31's flat plan view: the rough, the fairway in its cut, the
 * named hazards, the green in its fringe, the pin, the markers and the tee box with its two markers side by side across
 * the line of play. Decorative and built from numbers only.
 */
export function bandSvg(shape: BandShape, frame: CourseFrame): string {
  const { tee, fairway } = shape;
  const out: string[] = [`<rect class="a-rough-fill" width="${frame.width}" height="${frame.height}"/>`];
  if (fairway) {
    const d = smooth(fairway);
    out.push(`<path class="a-cut" d="${d}" fill="none" stroke-width="8" stroke-linejoin="round"/>`, `<path class="fairway" d="${d}"/>`);
  }
  for (const h of shape.hazards) if (h.kind === 'bunker') out.push(bunkerSvg(h));
  for (const h of shape.hazards) if (h.kind === 'water') out.push(pondSvg(h));
  out.push(greenSvg(shape.green, shape.water), pinSvg(shape.pin));
  for (const mk of shape.markers) out.push(markerSvg(mk));
  out.push(`<rect class="tee" x="${f(tee.x - tee.along / 2)}" y="${f(tee.y - tee.across / 2)}" width="${f(tee.along)}" height="${f(tee.across)}" rx="${f(Math.min(tee.across * 0.4, 10))}"/>`);
  const r = clamp(tee.across * 0.16, 1.6, 4.2);
  for (const dy of [-0.27, 0.27]) out.push(`<circle cx="${f(tee.x + tee.along * 0.18)}" cy="${f(tee.y + tee.across * dy)}" r="${f(r)}" class="a-pole-fill"/>`);
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
  pin: { x: number; y: number; pole: number };
  markers: Marker[];
  /** Where it was fitted (v33): the band within its padding, beside the credit. */
  room: Box;
  /** The credit where this drawing stands it, and the share of its text with water behind it (v33), or null without one. */
  credit: (Credit & { side: CreditSide; wet: number }) | null;
  /** Where the hole is played (v35): round its line of play, tees, fairways and greens' fringes, with room for a shot's
   * carry and a ball's run beside them. Convex. */
  play: Pt[];
  /** The water in the play area, the water the hole plays over, each pond's outer ring then its islands; the rest of the
   * water fades (v35). */
  near: Pt[][][];
  /** The green up close (v35), where asked and the band has room. */
  inset: Inset | null;
}

/**
 * The green up close (v35, the v33 critique: a tall band drew a long hole's green 20px across): a window in the band's
 * free room, clear of the hole, its markers, the flag and the credit, showing the flagged green's surroundings at twice
 * the drawing's scale or more. What it shows is cut to the window in px (no clip path), each pond's outer ring then its
 * islands.
 */
export interface Inset {
  box: Box;
  /** px per metre inside it. */
  scale: number;
  greens: Pt[][];
  flagged: number;
  fairways: Pt[][];
  bunkers: Pt[][];
  water: Pt[][][];
  pin: { x: number; y: number; pole: number };
}

/** A point inside a ring: its middle, or else the middle of the widest stretch across it at its middle's height. */
function insidePoint(ring: Pt[]): Pt {
  const [cx, cy] = ringCentroid(ring);
  if (inRing([cx, cy], ring)) return [cx, cy];
  const xs: number[] = [];
  ring.forEach(([x1, y1], j) => {
    const [x2, y2] = ring[(j + 1) % ring.length];
    if (y1 > cy !== y2 > cy) xs.push(x1 + ((cy - y1) * (x2 - x1)) / (y2 - y1));
  });
  xs.sort((a, b) => a - b);
  let best: Pt = [cx, cy];
  for (let j = 0, wide = -1; j + 1 < xs.length; j += 2) {
    if (xs[j + 1] - xs[j] > wide) [wide, best] = [xs[j + 1] - xs[j], [(xs[j] + xs[j + 1]) / 2, cy]];
  }
  return best;
}

/**
 * A hole from OpenStreetMap in the band 기록 shows (v33), at one scale: turned so its line of play runs left to right,
 * the back tee at the left and the player's left up (as the header's small picture), as large as the room beside the
 * credit allows and in its middle. The tees, the greens in their fringes, the fairways in their cut, the bunkers and the
 * flag fit that room; water is the setting, and the band's edges cut it. The credit is gray text, which nothing reads on
 * water (#3d86a3: white is 4.1:1): where water would lie behind it, the hole moves within its room's slack the least way
 * that clears it, or leaves least behind it. `sides` are the credit's ends to try, in order: the first whose text stays
 * clear of water, else the one with least behind it. `length` (the official length in metres) decides which distance
 * markers there may be, as on the schematic: each at its distance from the greens' middle along the line of play, where
 * the band shows its dot and pill clear of the flag, the greens, the tees, the credit and `band.keep`. Since v35 the
 * water beyond the play area fades (`play`, `near`); `opts` labels the markers with bare numbers and asks for the green's
 * window.
 */
export function osmShape(hole: OsmHole, index: number, band: ArtBand, length: number | null, sides: CreditSide[] = CREDIT_SIDES, opts: DrawOptions = {}): OsmShape {
  let best: OsmShape | null = null;
  for (const side of band.credit ? sides : ['start' as const]) {
    const shape = osmAt(hole, index, band, length, side, opts);
    if (!best || (shape.credit?.wet ?? 0) < (best.credit?.wet ?? 0)) best = shape;
    if (!shape.credit || shape.credit.wet === 0) break;
  }
  return best!;
}

/** `osmShape` with the credit at one end. */
function osmAt(hole: OsmHole, index: number, band: ArtBand, length: number | null, side: CreditSide, opts: DrawOptions): OsmShape {
  const o = orientedHole(hole);
  const i = ((index % PIN.length) + PIN.length) % PIN.length;
  // A quarter turn: what ran up the screen (v, down from the greens) runs right, and the player's left (u < 0) is up.
  const q = ([u, v]: Pt): Pt => [-v, u];
  const tees = o.tees.map((t) => t.map(q));
  const greens = o.greens.map((g) => g.map(q));
  const fairways = o.fairways.map((fw) => fw.map(q));
  const bunkers = o.bunkers.map((b) => b.map(q));
  // The flag on the green nearest the line of play: the upper one, on the player's left, on a tie.
  const centres = greens.map(ringCentroid);
  const flagged = centres.map((_, j) => j).sort((a, b) => Math.abs(centres[a][1]) - Math.abs(centres[b][1]) || centres[a][1] - centres[b][1])[0];
  const g = greens[flagged];
  const c = centres[flagged];
  // A little off the green's middle, varied per hole like the schematic's pin, and always on the green.
  const half = (axis: 0 | 1) => (Math.max(...g.map((p) => p[axis])) - Math.min(...g.map((p) => p[axis]))) / 2;
  const off: Pt = [c[0] - PIN[i][1] * half(0) * 0.8, c[1] + PIN[i][0] * half(1) * 0.8];
  const pinAt = inRing(off, g) ? off : insidePoint(g);
  const pole = poleFor(band.y1 - band.y0);
  // What the scale fits, in metres: the tees, the greens' fringes and the bunkers; the fairways with their 4px cut;
  // the flag, its own size in px, on the pin.
  const solid = bounds([...tees.flat(), ...greens.flatMap((gr) => grown(gr, 1.1)), ...bunkers.flat()]);
  const cut = fairways.length ? bounds(fairways.flat()) : null;
  const boxAt = (s: number): Box => union([
    { x0: s * solid.x0, y0: s * solid.y0, x1: s * solid.x1, y1: s * solid.y1 },
    ...(cut ? [grow({ x0: s * cut.x0, y0: s * cut.y0, x1: s * cut.x1, y1: s * cut.y1 }, 4)] : []),
    flagBox({ x: s * pinAt[0], y: s * pinAt[1], pole }),
  ]);
  const credit = band.credit && (side === 'end' ? { text: across(band.credit.text, band), touch: across(band.credit.touch, band) } : band.credit);
  const keep = [...band.keep, ...(credit ? [credit.touch] : [])];
  const { s, room, dx: cx, dy: cy } = fitIn({ ...band, keep }, boxAt);
  // Water behind the credit's text: the hole moves within its room's slack (2px steps, nearest first) to clear it.
  const ponds = o.water.map((w) => w.map((r) => r.map((p): Pt => [cx + s * q(p)[0], cy + s * q(p)[1]])));
  let wet = credit ? wetShare(ponds, credit.text) : 0;
  let shift: Pt = [0, 0];
  if (credit && wet > 0) {
    const b = boxAt(s);
    const steps = (lo: number, hi: number) => {
      const out = [0];
      for (let d = 2; d <= Math.max(-lo, hi); d += 2) out.push(...(d <= hi ? [d] : []), ...(-d >= lo ? [-d] : []));
      return out;
    };
    const tries = steps(room.x0 - cx - b.x0, room.x1 - cx - b.x1)
      .flatMap((ex) => steps(room.y0 - cy - b.y0, room.y1 - cy - b.y1).map((ey): Pt => [ex, ey]))
      .sort((a, z) => Math.hypot(...a) - Math.hypot(...z));
    for (const [ex, ey] of tries) {
      const w = wetShare(ponds, { x0: credit.text.x0 - ex, y0: credit.text.y0 - ey, x1: credit.text.x1 - ex, y1: credit.text.y1 - ey });
      if (w < wet) [wet, shift] = [w, [ex, ey]];
      if (wet === 0) break;
    }
  }
  const [dx, dy] = [cx + shift[0], cy + shift[1]];
  const P = ([x, y]: Pt): Pt => [dx + s * x, dy + s * y];
  const line = o.line.map((p) => P(q(p)));
  const [px, py] = P(pinAt);
  const shape: OsmShape = {
    scale: s, tee: line[0], green: line[line.length - 1], line,
    greens: greens.map((gr) => gr.map(P)), flagged, tees: tees.map((t) => t.map(P)), back: o.back,
    fairways: fairways.map((fw) => fw.map(P)), bunkers: bunkers.map((b) => b.map(P)), water: o.water.map((w) => w.map((r) => r.map((p) => P(q(p))))),
    pin: { x: px, y: py, pole }, markers: [], room, credit: credit ? { ...credit, side, wet } : null, play: [], near: [], inset: null,
  };
  const hard = [...keep.map((b) => grow(b, CLEAR)), grow(flagBox(shape.pin), CLEAR), ...shape.greens.map((gr) => bounds(grown(gr, 1.1))), ...shape.tees.map(bounds)];
  shape.markers = placeMarkers(length, (d) => {
    const at = pointFromEnd(o.line, d);
    return at && P(q(at));
  }, band, hard, shape.bunkers.map(bounds), opts.bare);
  // The water the hole plays over (v35): what lies in the play area keeps the water's colour, the rest of a lake fades, so
  // a big one (새별 7's) no longer outweighs the hole. The play area is round the hole with room for a carry or a run
  // beside it: 24 m at the drawing's scale, 12 to 32px.
  shape.play = grownHull([...line, ...shape.tees.flat(), ...shape.fairways.flat(), ...shape.greens.flatMap((gr) => grown(gr, 1.1))], clamp(Math.round(24 * s), 12, 32));
  shape.near = shape.water.flatMap((rings) => {
    const outer = clipToConvex(rings[0], shape.play);
    return outer.length < 3 ? [] : [[outer, ...rings.slice(1).map((r) => clipToConvex(r, shape.play)).filter((r) => r.length >= 3)]];
  });
  if (opts.inset) {
    shape.inset = greenWindow(shape, band, keep, {
      greens, flagged, fairways, bunkers, water: o.water.map((w) => w.map((r) => r.map(q))), pin: pinAt,
    });
  }
  return shape;
}

// ---------- v35: the water the hole plays over, and the green up close ----------

/** 16 points round a unit circle, for growing a hull by a margin. */
const AROUND = Array.from({ length: 16 }, (_, j): Pt => [Math.cos((j / 16) * Math.PI * 2), Math.sin((j / 16) * Math.PI * 2)]);

/** The convex hull of some points (Andrew's monotone chain), every turn of it the same way. */
function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const turn = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Pt[]) => {
    const out: Pt[] = [];
    for (const pt of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], pt) <= 0) out.pop();
      out.push(pt);
    }
    return out.slice(0, -1);
  };
  return [...half(p), ...half([...p].reverse())];
}

/** The hull of some points, grown `by` px all round. */
const grownHull = (pts: Pt[], by: number): Pt[] => hull(hull(pts).flatMap(([x, y]) => AROUND.map(([c, s]): Pt => [x + c * by, y + s * by])));

/**
 * What of a ring lies inside a convex ring that turns as `hull` does (Sutherland–Hodgman), its cut edges along the
 * convex ring's: the water the hole plays over, and what a window shows, cut in px instead of by a clip path.
 */
function clipToConvex(ring: Pt[], clip: Pt[]): Pt[] {
  let out = ring;
  for (let i = 0; i < clip.length && out.length; i++) {
    const [a, b] = [clip[i], clip[(i + 1) % clip.length]];
    const side = (p: Pt) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = out;
    out = [];
    input.forEach((p, j) => {
      const n = input[(j + 1) % input.length];
      const [sp, sn] = [side(p), side(n)];
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sn >= 0) {
        const t = sp / (sp - sn);
        out.push([p[0] + (n[0] - p[0]) * t, p[1] + (n[1] - p[1]) * t]);
      }
    });
  }
  return out;
}

/** A window's outline as a convex ring: its box with its corners rounded `r` px, turning as `hull`'s rings do. */
function roundedBox(b: Box, r: number): Pt[] {
  const corners: [number, number, number][] = [[b.x1 - r, b.y1 - r, 0], [b.x0 + r, b.y1 - r, 90], [b.x0 + r, b.y0 + r, 180], [b.x1 - r, b.y0 + r, 270]];
  return corners.flatMap(([cx, cy, from]) => Array.from({ length: 5 }, (_, k): Pt => {
    const a = ((from + k * 22.5) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  }));
}

/**
 * The band's free room as a 2px grid (v35): the cells nothing drawn reaches, boxes as given and rings with their `reach`,
 * and the free box of a size nearest a point (a summed-area table makes each box one look-up), or null.
 */
function freeRoom(band: Box, boxes: Box[], rings: [Pt[], number][]) {
  const C = 2;
  const nx = Math.max(0, Math.floor((band.x1 - band.x0) / C));
  const ny = Math.max(0, Math.floor((band.y1 - band.y0) / C));
  const used = new Uint8Array(nx * ny);
  const span = (b: Box) => ({
    i0: Math.max(0, Math.floor((b.x0 - band.x0) / C)), i1: Math.min(nx, Math.ceil((b.x1 - band.x0) / C)),
    j0: Math.max(0, Math.floor((b.y0 - band.y0) / C)), j1: Math.min(ny, Math.ceil((b.y1 - band.y0) / C)),
  });
  for (const b of boxes) {
    const { i0, i1, j0, j1 } = span(b);
    for (let j = j0; j < j1; j++) used.fill(1, j * nx + i0, j * nx + Math.max(i0, i1));
  }
  for (const [ring, reach] of rings) {
    const { i0, i1, j0, j1 } = span(grow(bounds(ring), reach));
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        if (used[j * nx + i]) continue;
        const p: Pt = [band.x0 + (i + 0.5) * C, band.y0 + (j + 0.5) * C];
        if (inRing(p, ring) || ring.some((a, k) => segmentDistance(p, a, ring[(k + 1) % ring.length]) <= reach + C)) used[j * nx + i] = 1;
      }
    }
  }
  const sat = new Int32Array((nx + 1) * (ny + 1));
  for (let j = 0; j < ny; j++) {
    let row = 0;
    for (let i = 0; i < nx; i++) {
      row += used[j * nx + i];
      sat[(j + 1) * (nx + 1) + i + 1] = sat[j * (nx + 1) + i + 1] + row;
    }
  }
  const busy = (i0: number, j0: number, i1: number, j1: number) => sat[j1 * (nx + 1) + i1] - sat[j0 * (nx + 1) + i1] - sat[j1 * (nx + 1) + i0] + sat[j0 * (nx + 1) + i0];
  return (w: number, h: number, near: Pt, within: Box): Box | null => {
    const [cw, ch] = [Math.ceil(w / C), Math.ceil(h / C)];
    let best: Box | null = null;
    let gap = Infinity;
    for (let j = Math.max(0, Math.ceil((within.y0 - band.y0) / C)); j + ch <= Math.min(ny, Math.floor((within.y1 - band.y0) / C)); j++) {
      for (let i = Math.max(0, Math.ceil((within.x0 - band.x0) / C)); i + cw <= Math.min(nx, Math.floor((within.x1 - band.x0) / C)); i++) {
        if (busy(i, j, i + cw, j + ch)) continue;
        const b: Box = { x0: band.x0 + i * C, y0: band.y0 + j * C, x1: band.x0 + i * C + w, y1: band.y0 + j * C + h };
        const d = Math.hypot((b.x0 + b.x1) / 2 - near[0], (b.y0 + b.y1) / 2 - near[1]);
        if (d < gap) [best, gap] = [b, d];
      }
    }
    return best;
  };
}

/** The window's corner radius, in px: the tile radius (--r-tile). */
const WINDOW_R = 12;

/**
 * The green up close (v35): the largest window the band's free room holds (from 120 by 92px down to 73 by 56), nearest
 * the green, clear of the hole by `CLEAR` (its tees, greens in their fringes, fairways in their cut, bunkers, the water it
 * plays over), of the flag, the markers and what the band keeps clear; in it, the flagged green in its fringe and its flag
 * as large as the window allows less 6px all round, with whatever else lies there cut to the window. None where that is
 * under twice the drawing's scale or the green comes out under 40px across. `m` is the hole in metres, turned as drawn.
 */
function greenWindow(shape: OsmShape, band: ArtBand, keep: Box[], m: { greens: Pt[][]; flagged: number; fairways: Pt[][]; bunkers: Pt[][]; water: Pt[][][]; pin: Pt }): Inset | null {
  const boxes = [
    ...keep, grow(flagBox(shape.pin), 0), ...shape.markers.flatMap((mk) => [{ x0: mk.x - DOT, y0: mk.y - DOT, x1: mk.x + DOT, y1: mk.y + DOT }, mk.label]),
    ...shape.tees.map(bounds), ...shape.greens.map((g) => bounds(grown(g, 1.1))), ...shape.bunkers.map(bounds),
  ].map((b) => grow(b, CLEAR));
  const rings: [Pt[], number][] = [...shape.fairways.map((fw): [Pt[], number] => [fw, 4 + CLEAR]), ...shape.near.map((w): [Pt[], number] => [w[0], CLEAR])];
  const find = freeRoom(band, boxes, rings);
  const within = padded(band);
  const g = m.greens[m.flagged];
  const fringe = bounds(grown(g, 1.1));
  for (let h = 92; h >= 56; h -= 4) {
    const w = Math.round(h * 1.3);
    const box = find(w, h, [shape.pin.x, shape.pin.y], within);
    if (!box) continue;
    const pole = clamp(Math.round(h * 0.26), 12, 20);
    const inner: Box = grow(box, -6);
    const boxAt = (k: number): Box => union([{ x0: k * fringe.x0, y0: k * fringe.y0, x1: k * fringe.x1, y1: k * fringe.y1 }, flagBox({ x: k * m.pin[0], y: k * m.pin[1], pole })]);
    const k = largestScale(boxAt, inner);
    const at = boxAt(k);
    const [dx, dy] = [(inner.x0 + inner.x1) / 2 - (at.x0 + at.x1) / 2, (inner.y0 + inner.y1) / 2 - (at.y0 + at.y1) / 2];
    const W = ([x, y]: Pt): Pt => [dx + k * x, dy + k * y];
    const across = (fringe.x1 - fringe.x0) / 1.1 * k;
    if (k < 2 * shape.scale || across < 40) return null;
    const cut = roundedBox(box, WINDOW_R);
    const clipped = (r: Pt[]) => clipToConvex(r.map(W), cut);
    const kept = (list: Pt[][]) => list.map(clipped).filter((r) => r.length >= 3);
    const greens = m.greens.map(clipped);
    return {
      box, scale: k,
      greens: greens.filter((r) => r.length >= 3), flagged: greens.slice(0, m.flagged).filter((r) => r.length >= 3).length,
      fairways: kept(m.fairways), bunkers: kept(m.bunkers),
      water: m.water.flatMap((rs) => {
        const outer = clipped(rs[0]);
        return outer.length < 3 ? [] : [[outer, ...kept(rs.slice(1))]];
      }),
      pin: { x: W(m.pin)[0], y: W(m.pin)[1], pole },
    };
  }
  return null;
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
  // v33: side by side across the line of play (up the screen), a little toward the box's front, where it is wide enough.
  const [tx, ty, tw, th] = boxOf(shape.tees[shape.back]);
  if (th >= 10) {
    const r = Math.min(4.2, th * 0.2, tw * 0.2);
    for (const dy of [-0.3, 0.3]) out.push(`<circle cx="${f(tx + tw / 2 + r * 0.7)}" cy="${f(ty + th / 2 + th * dy)}" r="${f(r)}" class="a-pole-fill"/>`);
  }
  return out.join('');
}
