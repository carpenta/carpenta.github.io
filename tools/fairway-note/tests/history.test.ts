import { describe, expect, it } from 'vitest';
import { newRound, type Hole, type Round } from '../src/round';
import { CORRUPT_PREFIX } from '../src/storage';
import {
  HISTORY_KEY,
  RECENT,
  SERIES,
  archiveRound,
  courseName,
  fingerprint,
  hasFinishedHole,
  hasRecord,
  loadHistory,
  mergeEntries,
  newestFirst,
  preserveHistory,
  readEntry,
  readHistory,
  saveHistory,
  trends,
  withRound,
  withoutEntry,
  type Entry,
} from '../src/history';

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const corruptKeys = (kv: ReturnType<typeof memory>) => [...kv.map.keys()].filter((k) => k.startsWith(CORRUPT_PREFIX)).sort();

const hole = (par: 3 | 4 | 5, driver: number, approach: number, putts: number, ob = 0, mulligan = 0): Hole => ({ par, driver, approach, putts, ob, hazard: 0, mulligan });

/** A round on `date` with these holes filled in, currently on the hole after them (so they are finished). */
function roundOn(date: string, list: Hole[], current = list.length): Round {
  const [y, m, d] = date.split('-').map(Number);
  const r = newRound(new Date(y, m - 1, d));
  list.forEach((h, i) => (r.holes[i] = h));
  r.current = Math.min(current, r.holes.length - 1);
  return r;
}

const one = (date: string) => roundOn(date, [hole(4, 1, 1, 2)]);
const entry = (id: string, round: Round, endedAt = 1_790_000_000_000): Entry => ({ id, endedAt, round });

/** 18 par-4 holes with two putts each: the first `bogeys` in 5 strokes (no GIR), the rest in 4 (GIR); `ob` on hole 1. */
function full(date: string, bogeys: number, ob = 0): Round {
  const holes = Array.from({ length: 18 }, (_, i) => (i < bogeys ? hole(4, 1, 2, 2) : hole(4, 1, 1, 2)));
  holes[0] = { ...holes[0], ob };
  return roundOn(date, holes, 17);
}

describe('keeping a round', () => {
  it('keeps a round with a finished hole, and nothing else', () => {
    const done = one('2026-11-19');
    expect(hasFinishedHole(done)).toBe(true);
    expect(withRound([], done, 1000, 'id-1')).toEqual([{ id: 'id-1', endedAt: 1000, round: done }]);

    const none: Entry[] = [];
    // Nothing entered, a mulligan alone, or only the hole being played without a putt yet.
    const inProgress = roundOn('2026-11-19', [hole(4, 1, 0, 0)], 0);
    for (const r of [newRound(), roundOn('2026-11-19', [hole(4, 0, 0, 0, 0, 1)]), inProgress]) {
      expect(hasFinishedHole(r)).toBe(false);
      expect(withRound(none, r, 1, 'x')).toBe(none);
    }
    expect(hasRecord(newRound())).toBe(false);
    expect(hasRecord(inProgress)).toBe(true);
    expect(hasRecord(roundOn('2026-11-19', [hole(4, 0, 0, 0, 0, 1)]))).toBe(true);
  });

  it('makes an id when none is given', () => {
    const [made] = withRound([], one('2026-11-19'), 1000);
    expect(made.id).toMatch(/^[\w-]{8,64}$/);
    expect(withRound([], one('2026-11-19'), 1000)[0].id).not.toBe(made.id);
  });

  it('never keeps the same round twice, whatever the hole being shown or the key order', () => {
    const tagged = roundOn('2026-11-19', [{ ...hole(4, 1, 0, 2), tags: { putts: [null, 'in'], driver: ['left'] } }]);
    const list = withRound([], tagged, 1000, 'a');
    const reordered = roundOn('2026-11-19', [{ tags: { driver: ['left'], putts: [null, 'in'] }, mulligan: 0, hazard: 0, ob: 0, putts: 2, approach: 0, driver: 1, par: 4 }]);
    expect(fingerprint(reordered)).toBe(fingerprint(tagged));
    expect(withRound(list, { ...reordered, current: 7, lastEdited: 5 }, 2000, 'b')).toBe(list);
    // Another day, another count or another tag is another round.
    expect(fingerprint(roundOn('2026-11-20', [tagged.holes[0]]))).not.toBe(fingerprint(tagged));
    expect(fingerprint(roundOn('2026-11-19', [{ ...tagged.holes[0], putts: 3 }]))).not.toBe(fingerprint(tagged));
    expect(fingerprint(roundOn('2026-11-19', [{ ...tagged.holes[0], tags: { driver: ['right'], putts: [null, 'in'] } }]))).not.toBe(fingerprint(tagged));
  });

  it('archives into storage once, leaving nothing behind for an empty round', () => {
    const kv = memory();
    expect(archiveRound(newRound(), kv)).toBe('empty');
    expect(kv.map.has(HISTORY_KEY)).toBe(false);
    const r = one('2026-11-19');
    expect(archiveRound(r, kv, 1000)).toBe('kept');
    expect(archiveRound(r, kv, 2000)).toBe('kept');
    const stored = JSON.parse(kv.map.get(HISTORY_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ endedAt: 1000, round: { date: '2026-11-19' } });
    expect(loadHistory(kv)).toEqual([{ id: stored[0].id, endedAt: 1000, round: r }]);
  });

  it('removes a round by id, and the key with the last one', () => {
    const kv = memory();
    const a = entry('a', one('2026-11-01'));
    const b = entry('b', one('2026-11-02'));
    expect(saveHistory([a, b], kv)).toBe(true);
    expect(loadHistory(kv)).toEqual([a, b]);
    expect(withoutEntry([a, b], 'a')).toEqual([b]);
    expect(saveHistory(withoutEntry([a], 'a'), kv)).toBe(true);
    expect(kv.map.has(HISTORY_KEY)).toBe(false);
  });

  it('lists newest first by round date, then by when it was kept, without changing the list', () => {
    const list = [
      entry('old', one('2026-10-01'), 300),
      entry('early', one('2026-11-01'), 100),
      entry('late', roundOn('2026-11-01', [hole(4, 1, 2, 2)]), 200),
      entry('new', one('2026-11-05'), 50),
    ];
    expect(newestFirst(list).map((e) => e.id)).toEqual(['new', 'late', 'early', 'old']);
    expect(list.map((e) => e.id)).toEqual(['old', 'early', 'late', 'new']);
  });
});

describe('reading kept rounds', () => {
  const r = one('2026-11-01');
  const ok = { id: 'x', endedAt: 5, round: r };

  it('reads an entry and rejects anything that is not a past round', () => {
    expect(readEntry(ok)).toEqual({ entry: ok, lossy: false });
    const bad: unknown[] = [
      null, [], 'x', { id: 'x', endedAt: 5 },
      { ...ok, id: '' }, { ...ok, id: 5 }, { ...ok, id: 'x'.repeat(65) },
      { ...ok, endedAt: 0 }, { ...ok, endedAt: -1 }, { ...ok, endedAt: '5' },
      { ...ok, round: null }, { ...ok, round: { ...r, version: 2 } }, { ...ok, round: { ...r, holes: r.holes.slice(0, 9) } },
      { ...ok, round: newRound() },
    ];
    for (const v of bad) expect(readEntry(v), JSON.stringify(v)).toBeNull();
  });

  it('flags what it would drop: unknown fields and unreadable shot details', () => {
    expect(readEntry({ ...ok, note: 'from a newer app' })).toEqual({ entry: ok, lossy: true });
    const tags = { ...ok, round: { ...r, holes: r.holes.map((h, i) => (i === 0 ? { ...h, tags: { driver: ['slice'] } } : h)) } };
    expect(readEntry(tags)).toEqual({ entry: ok, lossy: true });
  });

  it('reads a stored list, dropping repeated ids and unreadable values', () => {
    expect(readHistory(null)).toEqual({ entries: [], lossy: false });
    expect(readHistory('[]')).toEqual({ entries: [], lossy: false });
    for (const text of ['not json', '{}', '"x"']) expect(readHistory(text)).toEqual({ entries: [], lossy: true });
    const b = entry('b', one('2026-11-02'));
    expect(readHistory(JSON.stringify([ok, b, { ...b, round: one('2026-11-03') }, 'junk']))).toEqual({ entries: [ok, b], lossy: true });
  });

  it('copies a history it cannot fully read aside before writing over it', () => {
    const kv = memory();
    const raw = JSON.stringify([
      ok,
      { id: 'b', endedAt: 1, round: { ...r, date: '2026-11-02', holes: r.holes.map((h, i) => (i === 0 ? { ...h, tags: { driver: ['slice'] } } : h)) } },
      { id: 'c', endedAt: 1, round: { version: 2 } },
    ]);
    kv.map.set(HISTORY_KEY, raw);
    expect(loadHistory(kv).map((e) => [e.id, e.round.holes[0].tags])).toEqual([['x', undefined], ['b', undefined]]);
    expect(preserveHistory(kv, 1000)).toBe('kept');
    expect(kv.map.get(`${CORRUPT_PREFIX}1000`)).toBe(raw);
    // The same value is not copied twice.
    expect(preserveHistory(kv, 2000)).toBe('kept');
    expect(corruptKeys(kv)).toEqual([`${CORRUPT_PREFIX}1000`]);
    expect(kv.map.get(HISTORY_KEY)).toBe(raw);

    expect(archiveRound(one('2026-11-03'), kv, 3000)).toBe('kept');
    expect(loadHistory(kv).map((e) => e.id).slice(0, 2)).toEqual(['x', 'b']);
    expect(kv.map.get(`${CORRUPT_PREFIX}1000`)).toBe(raw);
    expect(preserveHistory(kv)).toBe('none');
  });

  it('keeps an unreadable value aside and starts a new history over it', () => {
    const kv = memory();
    kv.map.set(HISTORY_KEY, 'not json');
    expect(loadHistory(kv)).toEqual([]);
    expect(archiveRound(one('2026-11-03'), kv, 3000)).toBe('kept');
    expect(loadHistory(kv)).toHaveLength(1);
    expect(corruptKeys(kv).map((k) => kv.map.get(k))).toEqual(['not json']);
  });

  it('refuses to write over a history it cannot copy aside', () => {
    const kv = memory();
    kv.map.set(HISTORY_KEY, 'not json');
    const full = { ...kv, key: kv.key, get length() { return kv.length; }, setItem: (k: string, v: string) => {
      if (k.startsWith(CORRUPT_PREFIX)) throw new Error('quota');
      kv.setItem(k, v);
    } };
    expect(preserveHistory(full, 1)).toBe('failed');
    expect(saveHistory([], full)).toBe(false);
    expect(archiveRound(one('2026-11-03'), full)).toBe('failed');
    expect(kv.map.get(HISTORY_KEY)).toBe('not json');
  });

  it('reports failure when storage throws or is missing', () => {
    const kv = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); }, key: () => null, length: 0 };
    expect(loadHistory(kv)).toEqual([]);
    expect(saveHistory([], kv)).toBe(false);
    expect(archiveRound(one('2026-11-03'), kv)).toBe('failed');
    expect(archiveRound(one('2026-11-03'), null)).toBe('failed');
    expect(loadHistory(null)).toEqual([]);
    expect(preserveHistory(null)).toBe('none');
  });
});

describe('merging', () => {
  it('adds incoming rounds unless the id or the same round is already kept', () => {
    const a = entry('a', one('2026-11-01'));
    const b = entry('b', one('2026-11-02'));
    const c = entry('c', one('2026-11-03'));
    const sameAsB = entry('b2', { ...b.round, current: 5 });
    const result = mergeEntries([a, b], [a, sameAsB, c, c, entry('c2', c.round)]);
    expect(result.entries.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(4);
  });
});

describe('trends', () => {
  // Oldest first: 81 (with 3 OB), 80, 82, 84, 86, 88, then a 9-hole round that stays out of the averages.
  const rounds = [full('2026-11-01', 6, 3), full('2026-11-02', 8), full('2026-11-03', 10), full('2026-11-04', 12), full('2026-11-05', 14), full('2026-11-06', 16)];
  const nine = roundOn('2026-11-07', Array.from({ length: 9 }, () => hole(4, 1, 1, 2)));
  const entries = [...rounds, nine].map((r, i) => entry(`r${i}`, r, 1000 + i));

  it('averages full 18-hole rounds, recent ones separately', () => {
    const t = trends(entries);
    expect(t.rounds).toBe(7);
    expect(t.full).toBe(6);
    expect(t.all).toMatchObject({ rounds: 6, strokes: 83.5, toPar: 11.5, putts: 36, ob: 0.5 });
    expect(t.all!.gir).toBeCloseTo((42 / 108) * 100, 6);
    expect(t.recent).toMatchObject({ rounds: RECENT, strokes: 84, toPar: 12, putts: 36, ob: 0 });
    expect(t.series).toEqual([81, 80, 82, 84, 86, 88]);
  });

  it('has no recent average until there are more full rounds than it covers, and no averages without one', () => {
    expect(trends(entries.slice(0, RECENT)).recent).toBeNull();
    expect(trends(entries.slice(0, RECENT)).all?.rounds).toBe(RECENT);
    expect(trends([entry('n', nine)])).toEqual({ rounds: 1, full: 0, all: null, recent: null, series: [] });
    expect(trends([])).toEqual({ rounds: 0, full: 0, all: null, recent: null, series: [] });
  });

  it(`draws at most the latest ${SERIES} full rounds`, () => {
    const many = Array.from({ length: SERIES + 2 }, (_, i) => entry(`m${i}`, full(`2026-10-${String(i + 1).padStart(2, '0')}`, i)));
    const t = trends(many);
    expect(t.series).toHaveLength(SERIES);
    expect(t.series.at(-1)).toBe(72 + SERIES + 1);
    expect(t.series[0]).toBe(72 + 2);
  });
});

describe('course name', () => {
  it('names the round’s own course, and Everis 새별·레이크 for rounds saved before courses could be chosen', () => {
    expect(courseName(newRound())).toBe('에버리스 골프리조트 새별·레이크');
    expect(courseName({ ...newRound(), course: undefined })).toBe('에버리스 골프리조트 새별·레이크');
    // A round of one nine says so.
    expect(courseName(newRound(new Date(), { course: { id: 'everis', name: '에버리스 골프리조트', front: '새별', back: '' }, pars: [4, 4, 5, 3, 4, 4, 3, 5, 4] }))).toBe('에버리스 골프리조트 새별 9홀');
    expect(courseName({ ...newRound(), course: { id: null, name: '다른 골프장', front: 'A', back: 'B' } })).toBe('다른 골프장 A·B');
  });

  it('keeps a past round’s course through storage', () => {
    const course = { id: null, name: '다른 골프장', front: 'A', back: 'B' };
    const r = { ...one('2026-11-01'), course };
    expect(readEntry({ id: 'x', endedAt: 5, round: r })?.entry.round.course).toEqual(course);
  });
});
