import { describe, expect, it } from 'vitest';
import { newRound } from '../src/round';
import { STORAGE_KEY, clearRound, loadRound, parseRound, saveRound } from '../src/storage';

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

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
    const kv = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
    expect(saveRound(newRound(), kv)).toBe(false);
    expect(loadRound(kv)).toBeNull();
    expect(() => clearRound(kv)).not.toThrow();
    expect(saveRound(newRound(), null)).toBe(false);
  });
});
