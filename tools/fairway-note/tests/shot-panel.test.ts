import { describe, expect, it } from 'vitest';
import { SHOT_TAGS, TAGGED, analyze, emptyHole, strokes, type Hole } from '../src/round';
import { STORAGE_KEY, loadRound, preserveUnreadable, readRound, saveRound } from '../src/storage';
import { LEGACY_TAGS, PANEL_ROWS, chooseTag, firstShot } from '../src/shot-panel';

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

const shots = (h: Hole, driver: number, approach = 0, putts = 0): Hole => ({ ...h, driver, approach, putts });

describe('club detail panel layout', () => {
  it('lays out every chip of each club exactly once, in rows of three or two; an old-only detail is kept to read', () => {
    // The middle count's one list has three panels since v28: 그린까지 (기본), and 세컨 and 어프로치 (상세).
    const views = { driver: ['driver'], approach: ['approach', 'second', 'short'], putts: ['putts'] } as const;
    for (const key of TAGGED) {
      const placed = new Set(views[key].flatMap((view) => PANEL_ROWS[view].flat()));
      expect([...placed, ...(LEGACY_TAGS[key] ?? [])].sort(), key).toEqual([...SHOT_TAGS[key]].sort());
      for (const view of views[key]) {
        const chips = PANEL_ROWS[view].flat();
        expect(new Set(chips).size, view).toBe(chips.length);
        for (const row of PANEL_ROWS[view]) expect([2, 3], `${view} ${row.join(' ')}`).toContain(row.length);
      }
    }
  });

  it('starts every club with left, the target and right, then long and short as on the 상세 tee line', () => {
    expect(PANEL_ROWS.driver.slice(0, 2)).toEqual([['left', 'fairway', 'right'], ['long', 'short']]);
    expect(PANEL_ROWS.approach.slice(0, 2)).toEqual([['left', 'green', 'right'], ['long', 'short']]);
    expect(PANEL_ROWS.putts).toEqual([['left', 'in', 'right'], ['long', 'short']]);
    // The rest keeps each side on its own column: left things on the left, right things on the right.
    expect(PANEL_ROWS.driver.slice(2)).toEqual([['far-left', 'whiff', 'far-right'], ['ob-left', 'mishit', 'ob-right']]);
  });

  it('offers no 벙커 chip for an approach: 상세\'s 벙커 counts it, so a bunker is never recorded twice', () => {
    expect(PANEL_ROWS.approach.flat()).not.toContain('bunker');
    expect(PANEL_ROWS.approach.slice(2)).toEqual([['hazard', 'whiff']]);
    // Rounds saved before (the live site) may carry it: it is still read, and shown only on a shot that has it.
    expect(LEGACY_TAGS.approach).toEqual(['bunker']);
  });
});

describe('choosing a chip', () => {
  it('opens on the last shot, or the first when none is counted', () => {
    expect(firstShot(emptyHole(), 'putts')).toBe(0);
    expect(firstShot(shots(emptyHole(), 1, 0, 3), 'putts')).toBe(2);
    expect(firstShot(shots(emptyHole(), 1, 0, 3), 'driver')).toBe(0);
  });

  it('tags the chosen shot, replaces its tag with another chip and clears it with the same chip', () => {
    const h = shots(emptyHole(), 1, 0, 3);
    const short = chooseTag(h, 'putts', 1, 'short');
    expect(short).toEqual({ ...h, tags: { putts: [null, 'short'] } });
    expect(chooseTag(short, 'putts', 1, 'long').tags).toEqual({ putts: [null, 'long'] });
    // The same chip again clears it; the count stays.
    expect(chooseTag(short, 'putts', 1, 'short')).toEqual(h);
    expect(chooseTag(chooseTag(short, 'putts', 2, 'in'), 'putts', 0, 'long').tags).toEqual({ putts: ['long', 'short', 'in'] });
  });

  it('counts the first shot when a chip is chosen with none counted', () => {
    const bunker = chooseTag(emptyHole(), 'approach', 0, 'bunker');
    expect(bunker).toEqual({ ...emptyHole(), approach: 1, tags: { approach: ['bunker'] } });
    expect(strokes(bunker)).toBe(1);
    // Choosing it again clears the detail and keeps the stroke, as the 상세 tee pad does.
    expect(chooseTag(bunker, 'approach', 0, 'bunker')).toEqual({ ...emptyHole(), approach: 1 });
  });

  it('adds one OB with an OB chip, never twice, and takes it back when the chip is cleared', () => {
    const drive = shots(emptyHole(), 1);
    const left = chooseTag(drive, 'driver', 0, 'ob-left');
    expect(left.ob).toBe(1);
    expect(strokes(left)).toBe(2);
    expect(chooseTag(left, 'driver', 0, 'ob-right').ob).toBe(1);
    expect(chooseTag(left, 'driver', 0, 'ob-left')).toEqual(drive);
    // With no drive counted, an OB chip counts the drive and the OB.
    const fresh = chooseTag(emptyHole(), 'driver', 0, 'ob-right');
    expect(fresh).toMatchObject({ driver: 1, ob: 1, obByTag: 1, tags: { driver: ['ob-right'] } });
  });

  it('leaves the hole alone for a shot that was not played', () => {
    const h = shots(emptyHole(), 1, 0, 2);
    expect(chooseTag(h, 'putts', 2, 'in')).toBe(h);
    expect(chooseTag(h, 'putts', -1, 'in')).toBe(h);
  });
});

/**
 * A round exactly as the live site (v4 entry with chips, before the redesign) saves it: no hazard field, tags on
 * drives, approaches and putts, an OB added by a tag, and the course.
 */
const LIVE_ROUND = JSON.stringify({
  version: 1,
  date: '2026-11-19',
  current: 2,
  holes: [
    { par: 4, driver: 1, approach: 2, putts: 2, ob: 0, mulligan: 0, tags: { driver: ['fairway'], approach: ['short', 'green'], putts: ['long', 'in'] } },
    { par: 5, driver: 2, approach: 2, putts: 1, ob: 1, mulligan: 1, tags: { driver: ['ob-right', 'left'], approach: [null, 'bunker'], putts: ['in'] }, obByTag: 1 },
    { par: 3, driver: 1, approach: 1, putts: 3, ob: 0, mulligan: 0, tags: { approach: ['whiff'], putts: ['short', 'left', 'in'] } },
    ...Array.from({ length: 15 }, (_, i) => ({ par: [4, 3, 5][i % 3], driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 })),
  ],
  lastEdited: 1763540000000,
  course: { id: 'everis', name: '에버리스 골프리조트', front: '새별', back: '레이크' },
});

describe('a round saved by the live site', () => {
  it('loads with its approach and putter details, reading as whole (nothing copied aside)', () => {
    const read = readRound(LIVE_ROUND)!;
    expect(read).not.toBeNull();
    expect(read.lossy).toBe(false);
    const [first, second, third] = read.round.holes;
    expect(first).toMatchObject({ approach: 2, putts: 2, hazard: 0, tags: { driver: ['fairway'], approach: ['short', 'green'], putts: ['long', 'in'] } });
    expect(second).toMatchObject({ ob: 1, obByTag: 1, tags: { driver: ['ob-right', 'left'], approach: [null, 'bunker'], putts: ['in'] } });
    expect(third.tags).toEqual({ approach: ['whiff'], putts: ['short', 'left', 'in'] });
    expect(read.round.holes.map(strokes).slice(0, 3)).toEqual([5, 6, 5]);
    const kv = memory();
    kv.map.set(STORAGE_KEY, LIVE_ROUND);
    expect(preserveUnreadable(kv)).toBe('none');
  });

  it('keeps those details when this version saves the round again', () => {
    const kv = memory();
    const round = readRound(LIVE_ROUND)!.round;
    expect(saveRound({ ...round, holes: round.holes.map((h, i) => (i === 2 ? chooseTag(h, 'approach', 0, 'bunker') : h)) }, kv)).toBe(true);
    const again = loadRound(kv)!;
    expect(again.holes[0].tags).toEqual({ driver: ['fairway'], approach: ['short', 'green'], putts: ['long', 'in'] });
    expect(again.holes[1].tags).toEqual({ driver: ['ob-right', 'left'], approach: [null, 'bunker'], putts: ['in'] });
    expect(again.holes[1].obByTag).toBe(1);
    expect(again.holes[2].tags).toEqual({ approach: ['bunker'], putts: ['short', 'left', 'in'] });
  });

  it('counts them in the analysis of finished holes', () => {
    const { details } = analyze(readRound(LIVE_ROUND)!.round);
    expect(details?.approach).toEqual({ short: 1, green: 1, bunker: 1, whiff: 1 });
    expect(details?.putts).toEqual({ long: 1, in: 3, short: 1, left: 1 });
  });
});
