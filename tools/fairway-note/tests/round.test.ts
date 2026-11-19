import { describe, expect, it } from 'vitest';
import { COURSE_PARS, DEFAULT_COURSE, courseLabel, roundCourse, STALE_MS, analyze, bump, emptyHole, finished, formatToPar, gir, isStale, localDate, newRound, played, scoreName, strokes, totals, type Hole, type Round } from '../src/round';

const hole = (par: 3 | 4 | 5, driver: number, approach: number, putts: number, ob = 0, mulligan = 0, hazard = 0): Hole => ({ par, driver, approach, putts, ob, hazard, mulligan });

/** A round with these holes filled in, currently on the last hole (so earlier holes are finished). */
function roundOf(list: Hole[], current = HOLE_LAST): Round {
  const r = newRound(new Date(2026, 10, 19));
  list.forEach((h, i) => (r.holes[i] = h));
  r.current = current;
  return r;
}
const HOLE_LAST = 17;

describe('course', () => {
  it('is Everis 새별 front and 레이크 back with the official pars by default', () => {
    expect(DEFAULT_COURSE).toEqual({ id: 'everis', name: '에버리스 골프리조트', front: '새별', back: '레이크' });
    expect(COURSE_PARS).toEqual([4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 3, 4, 4, 5, 5, 3, 4, 4]);
    expect(COURSE_PARS.reduce((a, b) => a + b, 0)).toBe(72);
    expect(newRound().holes.map((h) => h.par)).toEqual(COURSE_PARS);
    expect(newRound().course).toEqual(DEFAULT_COURSE);
  });

  it('starts a round on a chosen course and pars', () => {
    const course = { id: 'pinx', name: '핀크스 골프클럽', front: '이스트', back: '웨스트' };
    const pars = [...COURSE_PARS].reverse();
    const r = newRound(new Date(2026, 10, 19), { course, pars });
    expect(r.course).toEqual(course);
    expect(r.holes.map((h) => h.par)).toEqual(pars);
    expect(roundCourse(r)).toEqual(course);
  });

  it('treats a round saved before courses were added as Everis 새별·레이크', () => {
    const { course: _, ...old } = newRound();
    expect(roundCourse(old)).toEqual(DEFAULT_COURSE);
  });

  it('labels a course with its two nines, one nine played twice, or a name alone', () => {
    expect(courseLabel(DEFAULT_COURSE)).toBe('에버리스 골프리조트 새별·레이크');
    expect(courseLabel({ id: 'shinan', name: '신안컨트리클럽', front: 'Tomato', back: 'Tomato' })).toBe('신안컨트리클럽 Tomato');
    expect(courseLabel({ id: null, name: '동네 골프장', front: '', back: '' })).toBe('동네 골프장');
  });
});

describe('hole', () => {
  it('counts every shot plus one penalty stroke per OB and per hazard, never mulligans', () => {
    expect(strokes(hole(4, 2, 1, 2, 1, 2))).toBe(6);
    expect(strokes(hole(4, 1, 2, 2, 1, 0, 1))).toBe(7);
    expect(emptyHole()).toEqual({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, hazard: 0, mulligan: 0 });
  });

  it('is played once a stroke or penalty is entered, not for a mulligan alone', () => {
    expect(played(emptyHole())).toBe(false);
    expect(played({ ...emptyHole(), mulligan: 1 })).toBe(false);
    expect(played({ ...emptyHole(), ob: 1 })).toBe(true);
    expect(played({ ...emptyHole(), hazard: 1 })).toBe(true);
  });

  it('bumps hazard like any counter', () => {
    const h = bump(emptyHole(), 'hazard', 1);
    expect(h.hazard).toBe(1);
    expect(strokes(h)).toBe(1);
    expect(bump(h, 'hazard', -1)).toEqual(emptyHole());
    const full = { ...h, hazard: 15 };
    expect(bump(full, 'hazard', 1)).toBe(full);
  });

  it('bumps within 0..15 and keeps the same object when nothing changes', () => {
    const h = emptyHole();
    expect(bump(h, 'putts', -1)).toBe(h);
    expect(bump(h, 'putts', 1).putts).toBe(1);
    expect(h.putts).toBe(0);
    const full = { ...h, driver: 15 };
    expect(bump(full, 'driver', 1)).toBe(full);
  });

  it('counts a green in regulation only when putting after par minus two shots', () => {
    expect(gir(hole(4, 1, 1, 2))).toBe(true);
    expect(gir(hole(4, 1, 2, 1))).toBe(false);
    expect(gir(hole(3, 1, 0, 3))).toBe(true);
    expect(gir(hole(5, 1, 2, 2))).toBe(true);
    expect(gir(hole(4, 1, 1, 0))).toBe(false);
    expect(gir(hole(5, 1, 1, 2, 1))).toBe(true);
    expect(gir(hole(4, 1, 1, 2, 1))).toBe(false);
    // A hazard drop is a penalty stroke on the way to the green, like an OB.
    expect(gir(hole(5, 1, 1, 2, 0, 0, 1))).toBe(true);
    expect(gir(hole(4, 1, 1, 2, 0, 0, 1))).toBe(false);
  });

  it('names scores against par', () => {
    expect([-3, -2, -1, 0, 1, 2, 3, 6].map(scoreName)).toEqual(['eagle', 'eagle', 'birdie', 'par', 'bogey', 'double', 'triple', 'triple']);
    expect([0, 3, -2].map(formatToPar)).toEqual(['E', '+3', '-2']);
  });
});

describe('round', () => {
  it('starts with 18 empty holes at the course pars on the local date', () => {
    const r = newRound(new Date(2026, 0, 5));
    expect(r.date).toBe('2026-01-05');
    expect(localDate(new Date(2026, 11, 31))).toBe('2026-12-31');
    expect(r.holes).toHaveLength(18);
    expect(r.holes.map((h) => h.par)).toEqual(COURSE_PARS);
    expect(r.holes.every((h) => strokes(h) === 0)).toBe(true);
  });

  it('totals only finished holes, but counts every mulligan', () => {
    const t = totals(roundOf([hole(4, 1, 1, 2), hole(5, 1, 2, 3, 1, 0, 1), { ...emptyHole(), mulligan: 1 }, emptyHole()]));
    expect(t).toEqual({ holes: 2, par: 9, strokes: 12, putts: 5, driver: 2, approach: 3, ob: 1, hazard: 1, mulligan: 1 });
  });

  it('counts hazard drops under penalties', () => {
    const a = analyze(roundOf([hole(4, 1, 1, 2, 0, 0, 2), hole(5, 1, 1, 2, 1)]));
    expect(a.totals).toMatchObject({ strokes: 11, ob: 1, hazard: 2 });
    expect(a.lost).toEqual({ driver: 0, approach: 0, putts: 0, penalty: 3 });
    expect(a.worstAreas).toEqual(['penalty']);
    expect(a.girHoles).toBe(1);
  });

  it('analyzes a round', () => {
    const r = roundOf([
      hole(4, 1, 1, 2), // par, GIR
      hole(4, 2, 1, 2, 1, 1), // OB re-tee: 6, double
      hole(3, 1, 0, 1), // birdie
      hole(5, 1, 2, 3), // bogey, GIR, 3-putt
    ]);
    r.holes[9] = hole(4, 1, 2, 2); // back nine bogey
    const a = analyze(r);
    expect(a.totals).toMatchObject({ holes: 5, par: 20, strokes: 23, putts: 10, ob: 1, mulligan: 1 });
    expect(a.front).toMatchObject({ holes: 4, strokes: 18 });
    expect(a.back).toMatchObject({ holes: 1, strokes: 5 });
    expect(a.toPar).toBe(3);
    expect(a.puttsPerHole).toBe(2);
    expect(a.onePutts).toBe(1);
    expect(a.threePutts).toBe(1);
    expect(a.girHoles).toBe(3);
    expect(a.distribution).toEqual({ eagle: 0, birdie: 1, par: 1, bogey: 2, double: 1, triple: 0 });
    expect(a.byPar).toEqual([
      { par: 3, holes: 1, average: 2 },
      { par: 4, holes: 3, average: 5 },
      { par: 5, holes: 1, average: 6 },
    ]);
    expect(a.lost).toEqual({ driver: 1, approach: 1, putts: 1, penalty: 1 });
    expect(a.worstAreas).toEqual(['driver', 'approach', 'putts', 'penalty']);
    expect(a.best).toEqual({ hole: 3, toPar: -1 });
    expect(a.worst).toEqual({ hole: 2, toPar: 2 });
  });

  it('has no best, worst or weak area for an empty or even round', () => {
    const empty = analyze(newRound());
    expect(empty.totals.holes).toBe(0);
    expect(empty.puttsPerHole).toBe(0);
    expect(empty.worstAreas).toEqual([]);
    expect(empty.best).toBeNull();
    const even = analyze(roundOf([hole(4, 1, 1, 2), hole(4, 1, 1, 2)]));
    expect(even.best).toBeNull();
    expect(even.worst).toBeNull();
    expect(even.worstAreas).toEqual([]);
  });

  it('keeps the hole being played out of scores until it has a putt', () => {
    const r = roundOf([hole(4, 1, 1, 2), hole(4, 1, 0, 0, 0, 1)], 1);
    expect(finished(r, 0)).toBe(true);
    expect(finished(r, 1)).toBe(false);
    const a = analyze(r);
    expect(a.totals).toMatchObject({ holes: 1, strokes: 4, par: 4, mulligan: 1 });
    expect(a.toPar).toBe(0);
    expect(a.distribution.eagle).toBe(0);
    expect(a.byPar[1]).toEqual({ par: 4, holes: 1, average: 4 });

    r.holes[1] = hole(4, 1, 1, 1);
    expect(finished(r, 1)).toBe(true);
    expect(analyze(r).totals.strokes).toBe(7);
  });

  it('counts a chip-in (no putt) once the player moves on', () => {
    const r = roundOf([hole(4, 1, 2, 0)], 0);
    expect(finished(r, 0)).toBe(false);
    r.current = 1;
    expect(finished(r, 0)).toBe(true);
    expect(analyze(r).toPar).toBe(-1);
  });

  it('does not let a better hole hide losses on another', () => {
    const a = analyze(roundOf([hole(4, 3, 1, 1, 2), hole(4, 0, 2, 1), hole(5, 1, 1, 3)]));
    expect(a.lost).toEqual({ driver: 2, approach: 1, putts: 1, penalty: 2 });
    expect(a.worstAreas).toEqual(['driver', 'penalty']);
  });
});

describe('stale round', () => {
  const started = (date: Date, lastEdited?: number): Round => {
    const r = newRound(date);
    r.holes[0] = hole(4, 1, 1, 2);
    if (lastEdited !== undefined) r.lastEdited = lastEdited;
    return r;
  };

  it('is not stale when a round crosses midnight but was edited recently', () => {
    const lastEdit = new Date(2026, 10, 19, 23, 50).getTime();
    expect(isStale(started(new Date(2026, 10, 19, 22, 0), lastEdit), new Date(2026, 10, 20, 0, 30))).toBe(false);
  });

  it('is stale once the last edit is 12 hours old', () => {
    const lastEdit = new Date(2026, 10, 19, 10, 0).getTime();
    const r = started(new Date(2026, 10, 19, 10, 0), lastEdit);
    expect(isStale(r, new Date(lastEdit + STALE_MS - 1))).toBe(false);
    expect(isStale(r, new Date(lastEdit + STALE_MS))).toBe(true);
  });

  it('falls back to the date for rounds saved without lastEdited', () => {
    const r = started(new Date(2026, 10, 19, 10, 0));
    expect(isStale(r, new Date(2026, 10, 19, 23, 0))).toBe(false);
    expect(isStale(r, new Date(2026, 10, 20, 0, 30))).toBe(true);
  });

  it('is never stale with nothing recorded', () => {
    expect(isStale(newRound(new Date(2026, 0, 1)), new Date(2026, 10, 20))).toBe(false);
  });
});
