import { describe, expect, it } from 'vitest';
import { newRound } from '../src/round';
import { CORRUPT_PREFIX, MAX_CORRUPT, PREFS_KEY, STORAGE_KEY, loadBackupMark, loadDisplay, loadPrefs, persistenceState, saveBackupMark, saveDisplay, savePrefs, clearRound, loadRound, parseRound, preserveUnreadable, requestPersistence, saveRound } from '../src/storage';

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

describe('storage', () => {
  it('round-trips a round', () => {
    const kv = memory();
    const r = newRound(new Date(2026, 10, 19));
    r.current = 4;
    r.holes[4] = { par: 3, driver: 1, approach: 0, putts: 2, ob: 0, hazard: 1, mulligan: 1, bunker: 0 };
    expect(saveRound(r, kv)).toBe(true);
    expect(loadRound(kv)).toEqual(r);
    expect(JSON.parse(kv.getItem(STORAGE_KEY)!).holes[4].hazard).toBe(1);
    clearRound(kv);
    expect(kv.map.has(STORAGE_KEY)).toBe(false);
    expect(loadRound(kv)).toBeNull();
  });

  it('ignores broken or foreign values', () => {
    const good = newRound(new Date(2026, 10, 19));
    const variants: unknown[] = [
      null,
      'not json',
      '[]',
      { ...good, version: 2 },
      { ...good, date: 'yesterday' },
      { ...good, date: '2026-99-99' },
      { ...good, date: '2026-02-30' },
      { ...good, holes: good.holes.slice(0, 9) },
      { ...good, holes: good.holes.map((h, i) => (i === 3 ? { ...h, par: 6 } : h)) },
      { ...good, holes: good.holes.map((h, i) => (i === 3 ? { ...h, putts: -1 } : h)) },
      { ...good, holes: good.holes.map((h, i) => (i === 3 ? { ...h, ob: 1.5 } : h)) },
      { ...good, holes: good.holes.map((h, i) => (i === 3 ? { ...h, driver: 16 } : h)) },
      // A hazard count is part of the score, so a broken one makes the round unreadable rather than being dropped.
      ...[-1, 1.5, 16, '1', null].map((hazard) => ({ ...good, holes: good.holes.map((h, i) => (i === 3 ? { ...h, hazard } : h)) })),
    ];
    for (const v of variants) {
      expect(parseRound(typeof v === 'string' || v === null ? (v as string | null) : JSON.stringify(v))).toBeNull();
    }
  });

  it('reads rounds saved before the hazard counter as no hazard, with nothing to keep aside', () => {
    const kv = memory();
    const r = newRound(new Date(2026, 10, 19));
    r.holes[0] = { ...r.holes[0], driver: 1, approach: 1, putts: 2, ob: 1 };
    const old = JSON.stringify({ ...r, holes: r.holes.map(({ hazard: _, ...rest }) => rest) });
    expect(old).not.toContain('hazard');
    kv.setItem(STORAGE_KEY, old);
    const read = loadRound(kv)!;
    expect(read.holes.every((h) => h.hazard === 0)).toBe(true);
    expect(read).toEqual(r);
    expect(preserveUnreadable(kv)).toBe('none');
  });

  it('keeps the round course and reads rounds saved without one', () => {
    const r = newRound(new Date(2026, 10, 19), { course: { id: null, name: '동네 골프장', front: '', back: '' }, pars: Array(18).fill(4) });
    expect(parseRound(JSON.stringify(r))).toEqual(r);
    const { course: _, ...old } = newRound(new Date(2026, 10, 19));
    old.holes[0] = { ...old.holes[0], par: 3 };
    const read = parseRound(JSON.stringify(old))!;
    expect(read.course).toBeUndefined();
    expect(read.holes[0].par).toBe(3);
  });

  it('keeps both the round course and its shot details', () => {
    const r = newRound(new Date(2026, 10, 19), { course: { id: 'everis', name: '에버리스 골프리조트', front: '파인', back: '새별' }, pars: Array(18).fill(4) });
    r.holes[0] = { ...r.holes[0], driver: 1, putts: 2, tags: { driver: ['left'], putts: [null, 'in'] } };
    expect(parseRound(JSON.stringify(r))).toEqual(r);
  });

  it('treats a round with a broken course as unreadable, so it is kept aside', () => {
    const good = newRound(new Date(2026, 10, 19));
    for (const course of [null, 'everis', { ...good.course, id: 3 }, { ...good.course, name: '' }, { ...good.course, front: 1 }, { ...good.course, name: 'x'.repeat(81) }]) {
      expect(parseRound(JSON.stringify({ ...good, course })), JSON.stringify(course)).toBeNull();
    }
    const kv = memory();
    const raw = JSON.stringify({ ...good, course: { id: 'everis' } });
    kv.setItem(STORAGE_KEY, raw);
    expect(saveRound(good, kv)).toBe(true);
    expect(corruptKeys(kv).map((k) => kv.getItem(k))).toEqual([raw]);
  });

  it('remembers the last course choice under its own key', () => {
    const kv = memory();
    expect(loadPrefs(kv)).toBeNull();
    expect(savePrefs({ course: 'everis', front: 'pine', back: 'lake' }, kv)).toBe(true);
    expect(PREFS_KEY).toBe('fairway-note:prefs:v1');
    expect(loadPrefs(kv)).toEqual({ course: 'everis', front: 'pine', back: 'lake' });
    savePrefs({ course: null, front: '', back: '', name: '동네 골프장' }, kv);
    expect(loadPrefs(kv)).toEqual({ course: null, front: '', back: '', name: '동네 골프장' });
    for (const bad of ['x', '{}', '{"course":1,"front":"a","back":"b"}', '{"course":"a","front":2,"back":"b"}']) {
      kv.setItem(PREFS_KEY, bad);
      expect(loadPrefs(kv), bad).toBeNull();
    }
    expect(loadPrefs(null)).toBeNull();
    expect(savePrefs({ course: 'everis', front: 'a', back: 'b' }, null)).toBe(false);
  });

  it('keeps 큰 글씨 beside the course choice in the same key, each saved without losing the other', () => {
    const kv = memory();
    expect(loadDisplay(kv)).toEqual({ big: false, coach: false, home: false, voice: false, split: false, kakao: false });
    expect(saveDisplay({ big: true }, kv)).toBe(true);
    expect(loadDisplay(kv)).toEqual({ big: true, coach: false, home: false, voice: false, split: false, kakao: false });
    expect(loadPrefs(kv)).toBeNull();
    savePrefs({ course: 'everis', front: 'pine', back: 'lake' }, kv);
    expect(loadDisplay(kv)).toEqual({ big: true, coach: false, home: false, voice: false, split: false, kakao: false });
    expect(loadPrefs(kv)).toEqual({ course: 'everis', front: 'pine', back: 'lake' });
    // The coach mark, once seen, is kept the same way: changing one setting keeps the other.
    saveDisplay({ coach: true }, kv);
    saveDisplay({ home: true }, kv);
    expect(loadDisplay(kv)).toEqual({ big: true, coach: true, home: true, voice: false, split: false, kakao: false });
    saveDisplay({ big: false }, kv);
    expect(JSON.parse(kv.getItem(PREFS_KEY)!)).toEqual({ course: 'everis', front: 'pine', back: 'lake', coach: true, home: true });
    savePrefs({ course: 'everis', front: 'lake', back: 'pine' }, kv);
    expect(loadDisplay(kv)).toEqual({ big: false, coach: true, home: true, voice: false, split: false, kakao: false });
    // v47: the KakaoTalk notice, once put away, is remembered the same way and keeps the rest.
    saveDisplay({ kakao: true }, kv);
    expect(loadDisplay(kv)).toEqual({ big: false, coach: true, home: true, voice: false, split: false, kakao: true });
    expect(JSON.parse(kv.getItem(PREFS_KEY)!)).toEqual({ course: 'everis', front: 'lake', back: 'pine', coach: true, home: true, kakao: true });
    kv.setItem(PREFS_KEY, '[1]');
    expect(loadDisplay(kv)).toEqual({ big: false, coach: false, home: false, voice: false, split: false, kakao: false });
    expect(saveDisplay({ big: true }, null)).toBe(false);
  });

  it('keeps 말로 입력 off until it is turned on, then beside the course choice until it is turned off (v21)', () => {
    const kv = memory();
    savePrefs({ course: 'everis', front: 'pine', back: 'lake' }, kv);
    expect(loadDisplay(kv).voice).toBe(false);
    expect(saveDisplay({ voice: true }, kv)).toBe(true);
    expect(JSON.parse(kv.getItem(PREFS_KEY)!)).toEqual({ course: 'everis', front: 'pine', back: 'lake', voice: true });
    // A new course choice keeps it, and so does another setting.
    savePrefs({ course: 'everis', front: 'lake', back: 'pine' }, kv);
    saveDisplay({ big: true }, kv);
    expect(loadDisplay(kv)).toEqual({ big: true, coach: false, home: false, voice: true, split: false, kakao: false });
    // Off leaves no trace of it in the key, as with the other settings.
    saveDisplay({ voice: false }, kv);
    expect(JSON.parse(kv.getItem(PREFS_KEY)!)).toEqual({ course: 'everis', front: 'lake', back: 'pine', big: true });
    // Only a real true turns it on.
    kv.setItem(PREFS_KEY, JSON.stringify({ voice: 'yes' }));
    expect(loadDisplay(kv).voice).toBe(false);
  });

  it('remembers that 상세\'s tip on 세컨 and 어프로치 was put away, beside the rest (v28)', () => {
    const kv = memory();
    savePrefs({ course: 'everis', front: 'pine', back: 'lake' }, kv);
    expect(loadDisplay(kv).split).toBe(false);
    expect(saveDisplay({ split: true }, kv)).toBe(true);
    expect(JSON.parse(kv.getItem(PREFS_KEY)!)).toEqual({ course: 'everis', front: 'pine', back: 'lake', split: true });
    saveDisplay({ voice: true }, kv);
    savePrefs({ course: 'everis', front: 'lake', back: 'pine' }, kv);
    expect(loadDisplay(kv)).toEqual({ big: false, coach: false, home: false, voice: true, split: true, kakao: false });
    kv.setItem(PREFS_KEY, JSON.stringify({ split: 1 }));
    expect(loadDisplay(kv).split).toBe(false);
  });

  it('reads a 9-hole round and keeps 18 or 9 holes only', () => {
    const nine = { ...newRound(new Date(2026, 10, 20), { course: { id: 'everis', name: '에버리스 골프리조트', front: '새별', back: '' }, pars: [4, 4, 5, 3, 4, 4, 3, 5, 4] }), current: 8 };
    const read = parseRound(JSON.stringify(nine));
    expect(read?.holes).toHaveLength(9);
    expect(read?.current).toBe(8);
    expect(read?.course).toEqual({ id: 'everis', name: '에버리스 골프리조트', front: '새별', back: '' });
    // A current hole past the ninth falls back to the first.
    expect(parseRound(JSON.stringify({ ...nine, current: 12 }))?.current).toBe(0);
    for (const n of [0, 8, 10, 17, 19]) expect(parseRound(JSON.stringify({ ...nine, holes: Array.from({ length: n }, () => nine.holes[0]) })), String(n)).toBeNull();
    // Nine holes with a back nine named, or with no course at all (the old default is two nines), are broken.
    expect(parseRound(JSON.stringify({ ...nine, course: { ...nine.course, back: '레이크' } }))).toBeNull();
    const { course: _course, ...noCourse } = nine;
    expect(parseRound(JSON.stringify(noCourse))).toBeNull();
  });

  it('remembers a 9-hole choice in the prefs key', () => {
    const kv = memory();
    savePrefs({ course: 'everis', front: 'lake', back: 'saebyul', holes: 9 }, kv);
    expect(loadPrefs(kv)).toEqual({ course: 'everis', front: 'lake', back: 'saebyul', holes: 9 });
    kv.setItem(PREFS_KEY, JSON.stringify({ course: 'everis', front: 'lake', back: 'saebyul', holes: 12 }));
    expect(loadPrefs(kv)).toEqual({ course: 'everis', front: 'lake', back: 'saebyul' });
  });

  it('falls back to the first hole for a bad current hole', () => {
    expect(parseRound(JSON.stringify({ ...newRound(), current: 99 }))?.current).toBe(0);
  });

  it('reports failure when storage throws', () => {
    const kv = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); }, key: () => null, length: 0 };
    expect(saveRound(newRound(), kv)).toBe(false);
    expect(loadRound(kv)).toBeNull();
    expect(() => clearRound(kv)).not.toThrow();
    expect(saveRound(newRound(), null)).toBe(false);
  });

  it('keeps lastEdited and still reads v1 rounds saved without it', () => {
    const r = { ...newRound(new Date(2026, 10, 19)), lastEdited: 1_790_000_000_000 };
    expect(parseRound(JSON.stringify(r))?.lastEdited).toBe(1_790_000_000_000);
    const old = parseRound(JSON.stringify(newRound(new Date(2026, 10, 19))));
    expect(old).not.toBeNull();
    expect(old?.lastEdited).toBeUndefined();
    expect(parseRound(JSON.stringify({ ...r, lastEdited: 'soon' }))?.lastEdited).toBeUndefined();
  });

  it('keeps a round finished with 라운드 마치기 finished, and reads anything else as not finished', () => {
    const r = newRound(new Date(2026, 10, 19));
    expect(parseRound(JSON.stringify({ ...r, closed: true }))?.closed).toBe(true);
    expect(parseRound(JSON.stringify(r))?.closed).toBeUndefined();
    expect(parseRound(JSON.stringify({ ...r, closed: 'yes' }))?.closed).toBeUndefined();
  });

  it('copies an unreadable value aside before saving over it', () => {
    const kv = memory();
    const future = JSON.stringify({ version: 2, data: 'from a newer app' });
    kv.map.set(STORAGE_KEY, future);
    expect(preserveUnreadable(kv, 1000)).toBe('kept');
    expect(kv.map.get(`${CORRUPT_PREFIX}1000`)).toBe(future);
    // The same value is not copied twice (reloads without an edit).
    expect(preserveUnreadable(kv, 2000)).toBe('kept');
    expect(corruptKeys(kv)).toEqual([`${CORRUPT_PREFIX}1000`]);
    expect(kv.map.get(STORAGE_KEY)).toBe(future);

    const r = newRound(new Date(2026, 10, 19));
    expect(saveRound(r, kv)).toBe(true);
    expect(loadRound(kv)).toEqual(r);
    expect(kv.map.get(`${CORRUPT_PREFIX}1000`)).toBe(future);
  });

  it('copies an unreadable value aside before clearing it', () => {
    const kv = memory();
    kv.map.set(STORAGE_KEY, 'not json');
    clearRound(kv);
    expect(kv.map.has(STORAGE_KEY)).toBe(false);
    expect(corruptKeys(kv).map((k) => kv.map.get(k))).toEqual(['not json']);
  });

  it('has nothing to preserve for a readable or missing value', () => {
    const kv = memory();
    expect(preserveUnreadable(kv)).toBe('none');
    saveRound(newRound(), kv);
    expect(preserveUnreadable(kv)).toBe('none');
    expect(corruptKeys(kv)).toEqual([]);
  });

  it(`keeps only the newest ${MAX_CORRUPT} copies`, () => {
    const kv = memory();
    for (let i = 1; i <= MAX_CORRUPT + 2; i++) {
      kv.map.set(STORAGE_KEY, `broken ${i}`);
      expect(preserveUnreadable(kv, i * 1000)).toBe('kept');
    }
    expect(corruptKeys(kv).map((k) => kv.map.get(k))).toEqual(
      Array.from({ length: MAX_CORRUPT }, (_, i) => `broken ${i + 3}`),
    );
  });

  it('refuses to overwrite an unreadable value it cannot copy', () => {
    const kv = memory();
    kv.map.set(STORAGE_KEY, 'not json');
    const full = { ...kv, key: kv.key, get length() { return kv.length; }, setItem: (k: string, v: string) => {
      if (k.startsWith(CORRUPT_PREFIX)) throw new Error('quota');
      kv.setItem(k, v);
    } };
    expect(preserveUnreadable(full, 1)).toBe('failed');
    expect(saveRound(newRound(), full)).toBe(false);
    clearRound(full);
    expect(kv.map.get(STORAGE_KEY)).toBe('not json');
  });

  it('asks once-callers for persistent storage and ignores failures', async () => {
    let asked = 0;
    requestPersistence({ storage: { persist: async () => { asked++; return true; } } });
    expect(asked).toBe(1);
    expect(() => requestPersistence({})).not.toThrow();
    expect(() => requestPersistence({ storage: { persist: () => { throw new Error('no'); } } })).not.toThrow();
    requestPersistence({ storage: { persist: () => Promise.reject(new Error('denied')) } });
    await new Promise((r) => setTimeout(r, 0));
  });
});

// v43: the last backup, remembered beside the course and the display settings in the prefs key.
describe('the last backup mark (v43)', () => {
  it('round-trips, and survives saving the course or a display setting', () => {
    const kv = memory();
    expect(loadBackupMark(kv)).toBe(null);
    expect(saveBackupMark({ at: '2026-11-25', rounds: 4 }, kv)).toBe(true);
    expect(loadBackupMark(kv)).toEqual({ at: '2026-11-25', rounds: 4 });
    savePrefs({ course: 'everis', front: 'saebyul', back: 'lake' }, kv);
    saveDisplay({ big: true }, kv);
    expect(loadBackupMark(kv)).toEqual({ at: '2026-11-25', rounds: 4 });
    expect(loadDisplay(kv).big).toBe(true);
    expect(loadPrefs(kv)).toMatchObject({ course: 'everis', front: 'saebyul', back: 'lake' });
  });

  it('keeps the course and the display settings when it is written', () => {
    const kv = memory();
    savePrefs({ course: 'everis', front: 'saebyul', back: 'lake' }, kv);
    saveDisplay({ voice: true }, kv);
    saveBackupMark({ at: '2026-11-25', rounds: 1 }, kv);
    expect(loadDisplay(kv).voice).toBe(true);
    expect(loadPrefs(kv)).toMatchObject({ course: 'everis' });
  });

  it('reads a value that is not a date or not a count as no backup', () => {
    const kv = memory();
    for (const bad of [{ backedUpAt: 'yesterday', backedUpRounds: 2 }, { backedUpAt: '2026-11-25', backedUpRounds: -1 }, { backedUpAt: '2026-11-25', backedUpRounds: 1.5 }, { backedUpAt: '2026-11-25' }]) {
      kv.setItem(PREFS_KEY, JSON.stringify(bad));
      expect(loadBackupMark(kv)).toBe(null);
    }
    expect(saveBackupMark({ at: '2026-11-25', rounds: 1 }, null)).toBe(false);
  });

  it('reports whether the browser keeps this site\'s storage, or null where it cannot say', async () => {
    expect(await persistenceState({ storage: { persisted: async () => true } })).toBe(true);
    expect(await persistenceState({ storage: { persisted: async () => false } })).toBe(false);
    expect(await persistenceState({})).toBe(null);
    expect(await persistenceState({ storage: { persisted: () => Promise.reject(new Error('no')) } })).toBe(null);
  });
});
