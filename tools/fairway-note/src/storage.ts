import { COUNTERS, HOLE_COUNT, MAX_COUNT, PARS, type Hole, type Par, type Round } from './round';

export const STORAGE_KEY = 'fairway-note:round:v1';

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isCount(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_COUNT;
}

function parseHole(v: unknown): Hole | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!PARS.includes(o.par as Par)) return null;
  const hole = { par: o.par as Par } as Hole;
  for (const key of COUNTERS) {
    if (!isCount(o[key])) return null;
    hole[key] = o[key] as number;
  }
  return hole;
}

/** Returns the saved round, or null when nothing valid is stored. */
export function parseRound(text: string | null): Round | null {
  if (!text) return null;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const r = o as Record<string, unknown>;
  if (r.version !== 1 || typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return null;
  if (!Array.isArray(r.holes) || r.holes.length !== HOLE_COUNT) return null;
  const holes = r.holes.map(parseHole);
  if (holes.some((h) => h === null)) return null;
  const current = Number.isInteger(r.current) && (r.current as number) >= 0 && (r.current as number) < HOLE_COUNT ? (r.current as number) : 0;
  return { version: 1, date: r.date, current, holes: holes as Hole[] };
}

function store(): KV | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadRound(kv: KV | null = store()): Round | null {
  try {
    return parseRound(kv?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Saves the round. Returns false when storage is unavailable (private mode, quota). */
export function saveRound(round: Round, kv: KV | null = store()): boolean {
  if (!kv) return false;
  try {
    kv.setItem(STORAGE_KEY, JSON.stringify(round));
    return true;
  } catch {
    return false;
  }
}

export function clearRound(kv: KV | null = store()): void {
  try {
    kv?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing stored to clear */
  }
}
