import { COUNTERS, HOLE_COUNT, TAGGED, analyze, courseLabel, finished, played, roundCourse, type Analysis, type Round } from './round';
import { keepAside, readRound, store } from './storage';

/** Past rounds, in the order they were kept. The round being recorded stays in its own key. */
export const HISTORY_KEY = 'fairway-note:history:v1';
/** Full rounds in the recent average. */
export const RECENT = 5;
/** Full rounds drawn in the score line. */
export const SERIES = 10;
const MAX_ID = 64;
const ENTRY_KEYS = ['id', 'endedAt', 'round'];

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** A round moved out of the way when the next one started. */
export interface Entry {
  /** Kept through export and import, so the same round is never added twice. */
  id: string;
  /** When it was kept, ms since the epoch. */
  endedAt: number;
  round: Round;
}

/** At least one hole counts toward the score. Only such rounds are kept. */
export function hasFinishedHole(round: Round): boolean {
  return round.holes.some((_, i) => finished(round, i));
}

/** Anything entered at all: a stroke, a penalty or a mulligan. */
export function hasRecord(round: Round): boolean {
  return round.holes.some((h) => played(h) || h.mulligan > 0);
}

/** The same round however it was saved: its date and every hole's par, counts and tags, in a fixed order. */
export function fingerprint(round: Round): string {
  const holes = round.holes.map((h) =>
    [h.par, ...COUNTERS.map((k) => h[k]), ...TAGGED.map((k) => (h.tags?.[k] ?? []).map((t) => t ?? '-').join(',')), h.obByTag ?? 0].join(':'));
  return `${round.date}|${holes.join(';')}`;
}

function newId(now: number): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  // randomUUID needs a secure context; GitHub Pages and localhost are, a plain-http preview is not.
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
}

/** A stored or imported entry, and whether reading it dropped something (unknown fields, shot details); null when it is not a past round. */
export function readEntry(v: unknown): { entry: Entry; lossy: boolean } | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '' || o.id.length > MAX_ID) return null;
  if (typeof o.endedAt !== 'number' || !Number.isFinite(o.endedAt) || o.endedAt <= 0) return null;
  const read = o.round === undefined ? null : readRound(JSON.stringify(o.round));
  if (!read || !hasFinishedHole(read.round)) return null;
  const extra = Object.keys(o).some((k) => !ENTRY_KEYS.includes(k));
  return { entry: { id: o.id, endedAt: o.endedAt, round: read.round }, lossy: read.lossy || extra };
}

/** The readable entries of a stored history; `lossy` when anything in it could not be read as it is. */
export function readHistory(text: string | null): { entries: Entry[]; lossy: boolean } {
  if (text === null) return { entries: [], lossy: false };
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    return { entries: [], lossy: true };
  }
  if (!Array.isArray(list)) return { entries: [], lossy: true };
  const entries: Entry[] = [];
  const ids = new Set<string>();
  let lossy = false;
  for (const item of list) {
    const read = readEntry(item);
    if (!read || ids.has(read.entry.id)) {
      lossy = true;
      continue;
    }
    ids.add(read.entry.id);
    entries.push(read.entry);
    if (read.lossy) lossy = true;
  }
  return { entries, lossy };
}

export function loadHistory(kv: KV | null = store()): Entry[] {
  try {
    return readHistory(kv?.getItem(HISTORY_KEY) ?? null).entries;
  } catch {
    return [];
  }
}

/**
 * Copies a stored history this version cannot fully read (broken, or with entries or details it does not know) aside,
 * like the round key. 'failed': it could not be copied, so the history must not be written.
 */
export function preserveHistory(kv: KV | null = store(), now = Date.now()): 'none' | 'kept' | 'failed' {
  if (!kv) return 'none';
  try {
    const raw = kv.getItem(HISTORY_KEY);
    if (raw === null || !readHistory(raw).lossy) return 'none';
    keepAside(kv, raw, now);
    return 'kept';
  } catch {
    return 'failed';
  }
}

/** Writes the history (removing the key when it is empty). False when storage refuses or an unreadable value could not be kept. */
export function saveHistory(entries: Entry[], kv: KV | null = store()): boolean {
  if (!kv) return false;
  if (preserveHistory(kv) === 'failed') return false;
  try {
    if (entries.length) kv.setItem(HISTORY_KEY, JSON.stringify(entries));
    else kv.removeItem(HISTORY_KEY);
    return true;
  } catch {
    return false;
  }
}

/** The history with this round added, or the same list when nothing on it is finished or the same round is already kept. */
export function withRound(entries: Entry[], round: Round, now = Date.now(), id = newId(now)): Entry[] {
  if (!hasFinishedHole(round)) return entries;
  const print = fingerprint(round);
  if (entries.some((e) => fingerprint(e.round) === print)) return entries;
  return [...entries, { id, endedAt: now, round }];
}

/** Keeps a round before it is replaced. 'empty': nothing on it is finished, so there is nothing to keep. */
export function archiveRound(round: Round, kv: KV | null = store(), now = Date.now()): 'kept' | 'empty' | 'failed' {
  if (!hasFinishedHole(round)) return 'empty';
  const entries = loadHistory(kv);
  const next = withRound(entries, round, now);
  if (next === entries) return 'kept';
  return saveHistory(next, kv) ? 'kept' : 'failed';
}

export function withoutEntry(entries: Entry[], id: string): Entry[] {
  return entries.filter((e) => e.id !== id);
}

/** Adds incoming entries unless their id or the same round is already kept. */
export function mergeEntries(entries: Entry[], incoming: Entry[]): { entries: Entry[]; imported: number; skipped: number } {
  const ids = new Set(entries.map((e) => e.id));
  const prints = new Set(entries.map((e) => fingerprint(e.round)));
  const out = [...entries];
  let imported = 0;
  let skipped = 0;
  for (const e of incoming) {
    const print = fingerprint(e.round);
    if (ids.has(e.id) || prints.has(print)) {
      skipped += 1;
      continue;
    }
    ids.add(e.id);
    prints.add(print);
    out.push(e);
    imported += 1;
  }
  return { entries: out, imported, skipped };
}

/** Newest first: by the day the round was played, then by when it was kept. */
export function newestFirst(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => (a.round.date === b.round.date ? b.endedAt - a.endedAt : a.round.date < b.round.date ? 1 : -1));
}

export interface Average {
  rounds: number;
  strokes: number;
  toPar: number;
  /** Putts per round. */
  putts: number;
  /** OB per round. */
  ob: number;
  /** Greens in regulation, percent of holes. */
  gir: number;
}

export interface Trends {
  rounds: number;
  /** Rounds with all 18 holes finished. Only these are averaged, so a short round never lowers the average. */
  full: number;
  all: Average | null;
  /** The latest RECENT full rounds, once there are more full rounds than that. */
  recent: Average | null;
  /** Strokes of the latest SERIES full rounds, oldest first. */
  series: number[];
}

function average(list: Analysis[]): Average | null {
  if (!list.length) return null;
  const sum = (f: (a: Analysis) => number) => list.reduce((s, a) => s + f(a), 0);
  const holes = sum((a) => a.totals.holes);
  return {
    rounds: list.length,
    strokes: sum((a) => a.totals.strokes) / list.length,
    toPar: sum((a) => a.toPar) / list.length,
    putts: sum((a) => a.totals.putts) / list.length,
    ob: sum((a) => a.totals.ob) / list.length,
    gir: holes ? (sum((a) => a.girHoles) / holes) * 100 : 0,
  };
}

export function trends(entries: Entry[]): Trends {
  const full = newestFirst(entries).map((e) => analyze(e.round)).filter((a) => a.totals.holes === HOLE_COUNT);
  return {
    rounds: entries.length,
    full: full.length,
    all: average(full),
    recent: full.length > RECENT ? average(full.slice(0, RECENT)) : null,
    series: full.slice(0, SERIES).map((a) => a.totals.strokes).reverse(),
  };
}

/** The course shown for a past round, as the page shows it: its own course, or Everis 새별·레이크 for rounds saved before courses could be chosen. */
export function courseName(round: Round): string {
  return courseLabel(roundCourse(round));
}
