import { COUNTERS, HOLE_COUNT, MAX_COUNT, PARS, TAGGED, isShotTag, type Hole, type Par, type Round, type ShotTags } from './round';

export const STORAGE_KEY = 'fairway-note:round:v1';
/** Unreadable saved values are copied to `<prefix><timestamp>` before the round key is written. */
export const CORRUPT_PREFIX = 'fairway-note:corrupt:';
export const MAX_CORRUPT = 3;

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function isCount(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_COUNT;
}

/** A real calendar date written as YYYY-MM-DD. */
function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * Reads a hole's optional shot details into `hole`. The score depends only on the counts, so a bad tag never
 * rejects the hole: unknown values become no tag, entries past the count and unknown counters are dropped.
 * Returns true when anything was dropped.
 */
function readTags(hole: Hole, o: Record<string, unknown>): boolean {
  let lossy = false;
  if (o.tags !== undefined) {
    const raw = o.tags;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      lossy = true;
    } else {
      const r = raw as Record<string, unknown>;
      if (Object.keys(r).some((k) => !(TAGGED as readonly string[]).includes(k))) lossy = true;
      const tags: Record<string, (string | null)[]> = {};
      for (const key of TAGGED) {
        const list = r[key];
        if (list === undefined) continue;
        if (!Array.isArray(list)) {
          lossy = true;
          continue;
        }
        if (list.length > hole[key]) lossy = true;
        const kept = list.slice(0, hole[key]).map((tag) => {
          if (tag === null || isShotTag(key, tag)) return tag as string | null;
          lossy = true;
          return null;
        });
        while (kept.length && kept[kept.length - 1] === null) kept.pop();
        if (kept.length) tags[key] = kept;
      }
      if (Object.keys(tags).length) hole.tags = tags as ShotTags;
    }
  }
  if (o.obByTag !== undefined) {
    if (isCount(o.obByTag) && (o.obByTag as number) <= hole.ob) {
      if ((o.obByTag as number) > 0) hole.obByTag = o.obByTag as number;
    } else {
      lossy = true;
    }
  }
  return lossy;
}

function parseHole(v: unknown): { hole: Hole; lossy: boolean } | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!PARS.includes(o.par as Par)) return null;
  const hole = { par: o.par as Par } as Hole;
  for (const key of COUNTERS) {
    if (!isCount(o[key])) return null;
    hole[key] = o[key] as number;
  }
  const lossy = readTags(hole, o);
  return { hole, lossy };
}

/** Returns the saved round, or null when nothing valid is stored. Shot details it cannot read are left out. */
export function parseRound(text: string | null): Round | null {
  return readRound(text)?.round ?? null;
}

/** The saved round, and whether reading it dropped shot details (then the original is copied aside before saving). */
function readRound(text: string | null): { round: Round; lossy: boolean } | null {
  if (!text) return null;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const r = o as Record<string, unknown>;
  if (r.version !== 1 || !isDate(r.date)) return null;
  if (!Array.isArray(r.holes) || r.holes.length !== HOLE_COUNT) return null;
  const read = r.holes.map(parseHole);
  if (read.some((h) => h === null)) return null;
  const holes = (read as { hole: Hole; lossy: boolean }[]).map((x) => x.hole);
  const current = Number.isInteger(r.current) && (r.current as number) >= 0 && (r.current as number) < HOLE_COUNT ? (r.current as number) : 0;
  const round: Round = { version: 1, date: r.date, current, holes };
  if (typeof r.lastEdited === 'number' && Number.isFinite(r.lastEdited) && r.lastEdited > 0) round.lastEdited = r.lastEdited;
  return { round, lossy: read.some((x) => x!.lossy) };
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

function corruptKeys(kv: KV): string[] {
  const keys: string[] = [];
  for (let i = 0; i < kv.length; i++) {
    const k = kv.key(i);
    if (k?.startsWith(CORRUPT_PREFIX)) keys.push(k);
  }
  return keys.sort((a, b) => Number(a.slice(CORRUPT_PREFIX.length)) - Number(b.slice(CORRUPT_PREFIX.length)));
}

/**
 * Copies a stored value this version cannot read (broken, or from a newer version) aside so it is never lost.
 * A round that reads only by dropping shot details it does not know is copied aside too, before it is saved over.
 * 'none': nothing unreadable is stored. 'kept': a copy exists. 'failed': it could not be copied, so the key must not be written.
 */
export function preserveUnreadable(kv: KV | null = store(), now = Date.now()): 'none' | 'kept' | 'failed' {
  if (!kv) return 'none';
  try {
    const raw = kv.getItem(STORAGE_KEY);
    const read = raw === null ? null : readRound(raw);
    if (raw === null || (read !== null && !read.lossy)) return 'none';
    const keys = corruptKeys(kv);
    if (keys.some((k) => kv.getItem(k) === raw)) return 'kept';
    let key = `${CORRUPT_PREFIX}${now}`;
    while (kv.getItem(key) !== null) key = `${CORRUPT_PREFIX}${++now}`;
    kv.setItem(key, raw);
    keys.push(key);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_CORRUPT))) kv.removeItem(old);
    return 'kept';
  } catch {
    return 'failed';
  }
}

/** Asks the browser not to evict the saved round under storage pressure. Missing support and refusals are ignored. */
export function requestPersistence(nav: { storage?: { persist?: () => Promise<boolean> } } = navigator): void {
  try {
    nav.storage?.persist?.()?.catch(() => undefined);
  } catch {
    /* not supported */
  }
}

/** Saves the round. Returns false when storage is unavailable (private mode, quota) or an unreadable value could not be kept. */
export function saveRound(round: Round, kv: KV | null = store()): boolean {
  if (!kv) return false;
  if (preserveUnreadable(kv) === 'failed') return false;
  try {
    kv.setItem(STORAGE_KEY, JSON.stringify(round));
    return true;
  } catch {
    return false;
  }
}

export function clearRound(kv: KV | null = store()): void {
  if (preserveUnreadable(kv) === 'failed') return;
  try {
    kv?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing stored to clear */
  }
}
