import { describe, expect, it } from 'vitest';
import { newRound } from '../src/round';
import { CORRUPT_PREFIX, MAX_CORRUPT, STORAGE_KEY, clearRound, loadRound, parseRound, preserveUnreadable, requestPersistence, saveRound } from '../src/storage';

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
    r.holes[4] = { par: 3, driver: 1, approach: 0, putts: 2, ob: 0, mulligan: 1 };
    expect(saveRound(r, kv)).toBe(true);
    expect(loadRound(kv)).toEqual(r);
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
    ];
    for (const v of variants) {
      expect(parseRound(typeof v === 'string' || v === null ? (v as string | null) : JSON.stringify(v))).toBeNull();
    }
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
