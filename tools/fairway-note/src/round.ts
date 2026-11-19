export const COURSE_NAME = '에버리스 새별·레이크';
export const HOLE_COUNT = 18;
export const DEFAULT_PAR = 4;
export const PARS = [3, 4, 5] as const;
export type Par = (typeof PARS)[number];

/**
 * Pars for Everis Golf Resort, 새별 (front, holes 1-9) then 레이크 (back, holes 10-18), from the
 * operator's scorecard (shinangolf.com/club/course/everis, checked 2026-11-19). Editable per hole.
 */
export const COURSE_PARS: readonly Par[] = [4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 3, 4, 4, 5, 5, 3, 4, 4];

/** Counted items on a hole. OB adds one penalty stroke each; mulligans are noted but never counted. */
export const COUNTERS = ['driver', 'approach', 'putts', 'ob', 'mulligan'] as const;
export type Counter = (typeof COUNTERS)[number];
export const MAX_COUNT = 15;

/** Counters whose shots can carry an optional detail tag. */
export const TAGGED = ['driver', 'approach', 'putts'] as const;
export type Tagged = (typeof TAGGED)[number];

/** Detail chips per counter, in display order. Stored values; labels are in TAG_LABELS. */
export const SHOT_TAGS = {
  driver: ['fairway', 'left', 'right', 'ob-left', 'ob-right', 'whiff', 'mishit'],
  approach: ['green', 'short', 'long', 'left', 'right', 'bunker', 'hazard', 'whiff'],
  putts: ['in', 'short', 'long', 'left', 'right'],
} as const satisfies Record<Tagged, readonly string[]>;
export type ShotTag<K extends Tagged = Tagged> = (typeof SHOT_TAGS)[K][number];

export const TAG_LABELS: { [K in Tagged]: Record<ShotTag<K>, string> } = {
  driver: { fairway: '페어웨이', left: '좌', right: '우', 'ob-left': '좌 OB', 'ob-right': '우 OB', whiff: '헛스윙', mishit: '뒤땅/토핑' },
  approach: { green: '온그린', short: '짧음', long: '김', left: '좌', right: '우', bunker: '벙커', hazard: '해저드', whiff: '헛스윙' },
  putts: { in: '들어감', short: '짧음', long: '김', left: '좌', right: '우' },
};

const OB_TAGS: readonly string[] = ['ob-left', 'ob-right'];

/** Per-shot tags: entry i belongs to shot i of that counter. Never longer than the count; no trailing nulls. */
export type ShotTags = { [K in Tagged]?: (ShotTag<K> | null)[] };

export interface Hole {
  par: Par;
  driver: number;
  approach: number;
  putts: number;
  ob: number;
  mulligan: number;
  /** Optional shot details. Missing when nothing is tagged, and in rounds saved before tags existed. */
  tags?: ShotTags;
  /** How many of the OB penalties were added by choosing an OB tag, so clearing the tag can take them back. */
  obByTag?: number;
}

export interface Round {
  version: 1;
  /** Local date the round started, YYYY-MM-DD. */
  date: string;
  current: number;
  holes: Hole[];
  /** When the round was last changed, ms since the epoch. Missing in rounds saved before it was added. */
  lastEdited?: number;
}

export function emptyHole(par: Par = DEFAULT_PAR): Hole {
  return { par, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 };
}

export function localDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function newRound(now = new Date()): Round {
  return { version: 1, date: localDate(now), current: 0, holes: COURSE_PARS.map((par) => emptyHole(par)) };
}

export function isTagged(key: Counter): key is Tagged {
  return (TAGGED as readonly string[]).includes(key);
}

export function isShotTag<K extends Tagged>(key: K, tag: unknown): tag is ShotTag<K> {
  return (SHOT_TAGS[key] as readonly unknown[]).includes(tag);
}

export function tagAt<K extends Tagged>(hole: Hole, key: K, index: number): ShotTag<K> | null {
  return (hole.tags?.[key]?.[index] as ShotTag<K> | undefined) ?? null;
}

/** Writes one counter's tag list, keeping the hole free of empty lists, trailing nulls and a zero OB link. */
function withTags<K extends Tagged>(hole: Hole, key: K, list: (ShotTag<K> | null)[], ob = hole.ob, obByTag = hole.obByTag ?? 0): Hole {
  const trimmed = list.slice(0, hole[key]);
  while (trimmed.length && trimmed[trimmed.length - 1] === null) trimmed.pop();
  const tags: ShotTags = { ...hole.tags };
  if (trimmed.length) (tags as Record<K, (ShotTag<K> | null)[]>)[key] = trimmed;
  else delete tags[key];
  const out: Hole = { ...hole, ob };
  delete out.tags;
  delete out.obByTag;
  if (Object.keys(tags).length) out.tags = tags;
  const link = Math.min(obByTag, ob);
  if (link > 0) out.obByTag = link;
  return out;
}

const obTagCount = (hole: Hole) => (hole.tags?.driver ?? []).filter((t) => t !== null && OB_TAGS.includes(t)).length;

/**
 * Tags shot `index` of a counter (null clears it). An OB tag adds one OB penalty unless the OB counter already
 * covers every OB-tagged tee shot; clearing it takes back only a penalty a tag added.
 */
export function setTag<K extends Tagged>(hole: Hole, key: K, index: number, tag: ShotTag<K> | null): Hole {
  if (!Number.isInteger(index) || index < 0 || index >= hole[key]) return hole;
  if (tag !== null && !isShotTag(key, tag)) return hole;
  const before = tagAt(hole, key, index);
  if (before === tag) return hole;
  const list = Array.from({ length: Math.max(index + 1, hole.tags?.[key]?.length ?? 0) }, (_, i) => tagAt(hole, key, i));
  list[index] = tag;
  let ob = hole.ob;
  let link = hole.obByTag ?? 0;
  const wasOb = before !== null && OB_TAGS.includes(before);
  const isOb = tag !== null && OB_TAGS.includes(tag);
  if (isOb && !wasOb && ob < obTagCount(hole) + 1 && ob < MAX_COUNT) {
    ob += 1;
    link += 1;
  } else if (wasOb && !isOb && link > 0) {
    ob -= 1;
    link -= 1;
  }
  return withTags(hole, key, list, ob, link);
}

export function bump(hole: Hole, key: Counter, delta: number): Hole {
  const next = Math.min(MAX_COUNT, Math.max(0, hole[key] + delta));
  if (next === hole[key]) return hole;
  let out: Hole = { ...hole, [key]: next };
  if (next < hole[key] && isTagged(key) && (hole.tags?.[key]?.length ?? 0) > next) {
    // The last shot goes with its tag, and with any OB penalty that tag added.
    for (let i = hole[key] - 1; i >= next; i--) out = setTag({ ...out, [key]: i + 1 }, key, i, null);
    out = withTags({ ...out, [key]: next }, key, out.tags?.[key] ?? []);
  } else if (key === 'ob' && (out.obByTag ?? 0) > next) {
    out = withTags(out, 'driver', out.tags?.driver ?? []);
  }
  return out;
}

/** Strokes on the card: every shot plus one penalty stroke per OB. */
export function strokes(h: Hole): number {
  return h.driver + h.approach + h.putts + h.ob;
}

/** A hole counts as played once a shot or penalty is entered. Mulligans alone do not. */
export function played(h: Hole): boolean {
  return strokes(h) > 0;
}

/**
 * A hole counts toward totals and analysis once it is finished: holed with a putt, or left for
 * another hole (a chip-in has no putt). The hole being played without a putt yet is in progress,
 * so a tee shot alone never shows as an eagle.
 */
/** A round left untouched this long is offered to continue or replace on load. */
export const STALE_MS = 12 * 60 * 60 * 1000;

/** A recorded round whose last edit is 12 hours old, or, without lastEdited, one started on an earlier day. */
export function isStale(round: Round, now = new Date()): boolean {
  if (!round.holes.some((x) => played(x) || x.mulligan > 0)) return false;
  if (round.lastEdited !== undefined) return now.getTime() - round.lastEdited >= STALE_MS;
  return round.date !== localDate(now);
}

export function finished(round: Round, index: number): boolean {
  const h = round.holes[index];
  return played(h) && (h.putts > 0 || index !== round.current);
}

/** Green in regulation: on the green (at least one putt) in par minus two shots. */
export function gir(h: Hole): boolean {
  return h.putts > 0 && h.driver + h.approach + h.ob <= h.par - 2;
}

export interface Totals {
  holes: number;
  par: number;
  strokes: number;
  putts: number;
  driver: number;
  approach: number;
  ob: number;
  mulligan: number;
}

/** Totals of the finished holes in [start, end). Mulligans count on every hole. */
export function totals(round: Round, start = 0, end = round.holes.length): Totals {
  const t: Totals = { holes: 0, par: 0, strokes: 0, putts: 0, driver: 0, approach: 0, ob: 0, mulligan: 0 };
  for (let i = start; i < end; i++) {
    const h = round.holes[i];
    t.mulligan += h.mulligan;
    if (!finished(round, i)) continue;
    t.holes += 1;
    t.par += h.par;
    t.strokes += strokes(h);
    t.putts += h.putts;
    t.driver += h.driver;
    t.approach += h.approach;
    t.ob += h.ob;
  }
  return t;
}

export type ScoreName = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | 'triple';
export const SCORE_LABELS: Record<ScoreName, string> = {
  eagle: '이글 이하',
  birdie: '버디',
  par: '파',
  bogey: '보기',
  double: '더블 보기',
  triple: '트리플 이상',
};

export function scoreName(toPar: number): ScoreName {
  if (toPar <= -2) return 'eagle';
  if (toPar === -1) return 'birdie';
  if (toPar === 0) return 'par';
  if (toPar === 1) return 'bogey';
  if (toPar === 2) return 'double';
  return 'triple';
}

export type Area = 'driver' | 'approach' | 'putts' | 'penalty';
export const AREA_LABELS: Record<Area, string> = { driver: '티샷', approach: '어프로치', putts: '퍼트', penalty: 'OB 벌타' };

export interface Analysis {
  totals: Totals;
  front: Totals;
  back: Totals;
  toPar: number;
  puttsPerHole: number;
  onePutts: number;
  threePutts: number;
  girHoles: number;
  distribution: Record<ScoreName, number>;
  byPar: { par: Par; holes: number; average: number }[];
  /** Strokes over a regulation pattern (one tee shot, par−3 approaches, two putts) per area, never offset by a better hole. */
  lost: Record<Area, number>;
  /** Areas with the most lost strokes; several when tied, empty when nothing was lost. */
  worstAreas: Area[];
  best: { hole: number; toPar: number } | null;
  worst: { hole: number; toPar: number } | null;
  /** Tag counts on finished holes; null when no finished hole has a tag. */
  details: Details | null;
}

export type Details = { [K in Tagged]: Partial<Record<ShotTag<K>, number>> };

function details(round: Round): Details | null {
  const out: Details = { driver: {}, approach: {}, putts: {} };
  let any = false;
  for (const [i, h] of round.holes.entries()) {
    if (!finished(round, i)) continue;
    for (const key of TAGGED) {
      const counts = out[key] as Record<string, number>;
      for (const tag of h.tags?.[key] ?? []) {
        if (tag === null) continue;
        counts[tag] = (counts[tag] ?? 0) + 1;
        any = true;
      }
    }
  }
  return any ? out : null;
}

export function analyze(round: Round): Analysis {
  const holes = round.holes;
  const all = totals(round);
  const distribution: Record<ScoreName, number> = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, triple: 0 };
  const lost: Record<Area, number> = { driver: 0, approach: 0, putts: 0, penalty: 0 };
  let onePutts = 0;
  let threePutts = 0;
  let girHoles = 0;
  let best: { hole: number; toPar: number } | null = null;
  let worst: { hole: number; toPar: number } | null = null;

  for (const [i, h] of holes.entries()) {
    if (!finished(round, i)) continue;
    const diff = strokes(h) - h.par;
    distribution[scoreName(diff)] += 1;
    if (h.putts === 1) onePutts += 1;
    if (h.putts >= 3) threePutts += 1;
    if (gir(h)) girHoles += 1;
    lost.driver += Math.max(0, h.driver - 1);
    lost.approach += Math.max(0, h.approach - (h.par - 3));
    lost.putts += Math.max(0, h.putts - 2);
    lost.penalty += h.ob;
    if (!best || diff < best.toPar) best = { hole: i + 1, toPar: diff };
    if (!worst || diff > worst.toPar) worst = { hole: i + 1, toPar: diff };
  }
  // With every hole at the same score there is no best or worst hole to point at.
  const spread = best !== null && worst !== null && best.toPar !== worst.toPar;

  const byPar = PARS.map((par) => {
    const list = holes.filter((h, i) => h.par === par && finished(round, i));
    const sum = list.reduce((s, h) => s + strokes(h), 0);
    return { par, holes: list.length, average: list.length ? sum / list.length : 0 };
  });

  const most = Math.max(...Object.values(lost));
  const worstAreas = most > 0 ? (Object.keys(lost) as Area[]).filter((area) => lost[area] === most) : [];

  return {
    totals: all,
    front: totals(round, 0, 9),
    back: totals(round, 9),
    toPar: all.strokes - all.par,
    puttsPerHole: all.holes ? all.putts / all.holes : 0,
    onePutts,
    threePutts,
    girHoles,
    distribution,
    byPar,
    lost,
    worstAreas,
    best: spread ? best : null,
    worst: spread ? worst : null,
    details: details(round),
  };
}

export function formatToPar(n: number): string {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}
