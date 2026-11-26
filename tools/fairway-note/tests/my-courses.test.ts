import { describe, expect, it } from 'vitest';
import { COURSE_PARS, newRound, type Par, type Round } from '../src/round';
import { CORRUPT_PREFIX, loadPrefs, savePrefs } from '../src/storage';
import { holeInfo, publishedPar, resolveChoice, roundSetup } from '../src/courses';
import {
  MAX_MY_COURSES, MY_COURSES_KEY, findMine, loadMyCourses, mergeMyCourses, myCourseOf, readMyCourses, saveMyCourses, saveOffer, validHcp, withMyCourse,
  type MyCourse,
} from '../src/my-courses';
import { backupOf, backupText, parseBackup } from '../src/backup';
import { enteredRound } from '../src/round';

// v45 (the user's calls): a course typed in by hand is kept as 내 코스 — its name, the nines' names (asked once,
// 전반·후반 by default), every hole's par and, if given, its handicap index — offered under the summary.
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

const PARS: Par[] = [4, 4, 3, 5, 4, 4, 3, 5, 4, 5, 4, 3, 4, 4, 5, 3, 4, 4];
const HCP_NINES = [5, 1, 9, 3, 7, 2, 8, 4, 6, 6, 2, 8, 4, 1, 3, 9, 5, 7];
const mine = (over: Partial<MyCourse> = {}): MyCourse => ({ id: 'my-a', name: '동네 골프장', front: '전반', back: '후반', par: [...PARS], ...over });

function customRound(name: string, pars: readonly Par[], front = '', back = ''): Round {
  const r = newRound(new Date(2026, 10, 26), { course: { id: null, name, front, back }, pars: [...pars] });
  r.holes = r.holes.map((h) => ({ ...h, driver: 1, approach: h.par - 3, putts: 2 }));
  r.current = r.holes.length - 1;
  r.closed = true;
  return r;
}

describe('내 코스 storage (v45)', () => {
  it('round-trips through its own key', () => {
    const kv = memory();
    expect(saveMyCourses([mine(), mine({ id: 'my-b', name: '9홀 연습장', front: '코스', back: '', par: PARS.slice(0, 9), hcp: [3, 1, 9, 5, 7, 2, 8, 4, 6] })], kv)).toBe(true);
    expect(JSON.parse(kv.getItem(MY_COURSES_KEY)!)).toHaveLength(2);
    expect(loadMyCourses(kv)).toEqual([mine(), mine({ id: 'my-b', name: '9홀 연습장', front: '코스', back: '', par: PARS.slice(0, 9), hcp: [3, 1, 9, 5, 7, 2, 8, 4, 6] })]);
    expect(saveMyCourses([], kv)).toBe(true);
    expect(kv.getItem(MY_COURSES_KEY)).toBeNull();
  });

  it('drops entries it cannot read and says so; a broken value is copied aside before it is written over', () => {
    const bad = [mine(), { ...mine({ id: 'my-x' }), par: [4, 4] }, { ...mine({ id: 'my-y' }), par: PARS.map(() => 6) }, { ...mine({ id: '' }) }, mine({ id: 'my-a', name: '겹친 id' }), 'x'];
    const read = readMyCourses(JSON.stringify(bad));
    expect(read.courses).toEqual([mine()]);
    expect(read.lossy).toBe(true);
    expect(readMyCourses('{').lossy).toBe(true);
    expect(readMyCourses(null)).toEqual({ courses: [], lossy: false });
    const kv = memory();
    kv.setItem(MY_COURSES_KEY, '{broken');
    expect(saveMyCourses([mine()], kv)).toBe(true);
    expect([...kv.map.entries()].filter(([k]) => k.startsWith(CORRUPT_PREFIX)).map(([, v]) => v)).toEqual(['{broken']);
  });

  it('a handicap list that does not fit is left out, the course kept', () => {
    expect(readMyCourses(JSON.stringify([mine({ hcp: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] })])).courses).toEqual([mine()]);
  });

  it('keeps names short: the course name to 40 characters, a nine to 20', () => {
    const long = readMyCourses(JSON.stringify([mine({ name: 'ㄱ'.repeat(41) }), mine({ id: 'my-c', front: 'ㄴ'.repeat(21) })]));
    expect(long.courses).toEqual([]);
  });
});

describe('handicap index check (v45)', () => {
  it('takes 1–9 once in each nine, or 1–18 once over eighteen holes', () => {
    expect(validHcp(HCP_NINES, 18)).toBe(true);
    expect(validHcp([1, 3, 5, 7, 9, 11, 13, 15, 17, 2, 4, 6, 8, 10, 12, 14, 16, 18], 18)).toBe(true);
    expect(validHcp([3, 1, 9, 5, 7, 2, 8, 4, 6], 9)).toBe(true);
  });

  it('refuses a repeat, a gap, a value out of range or a list of the wrong length', () => {
    expect(validHcp([1, 1, 9, 3, 7, 2, 8, 4, 6, 6, 2, 8, 4, 1, 3, 9, 5, 7], 18)).toBe(false);
    expect(validHcp([10, 1, 9, 3, 7, 2, 8, 4, 6, 6, 2, 8, 4, 1, 3, 9, 5, 7], 18)).toBe(false);
    expect(validHcp([0, 1, 9, 3, 7, 2, 8, 4, 6], 9)).toBe(false);
    expect(validHcp(HCP_NINES.slice(0, 17), 18)).toBe(false);
    expect(validHcp([3, 1, 9, 5, 7, 2, 8, 4, 6], 18)).toBe(false);
  });
});

describe('saving a course typed in by hand (v45)', () => {
  it('is offered after a round on a course typed in by hand, not on a bundled course', () => {
    expect(saveOffer(customRound('동네 골프장', PARS), [])).toBe('save');
    expect(saveOffer(newRound(new Date(2026, 10, 26)), [])).toBeNull();
  });

  it('is not offered again with the same pars, and offers to update them when they differ', () => {
    expect(saveOffer(customRound('동네 골프장', PARS), [mine()])).toBeNull();
    const changed = [...PARS];
    changed[0] = 5;
    expect(saveOffer(customRound('동네 골프장', changed), [mine()])).toBe('update');
    expect(saveOffer(customRound('동네 골프장', PARS.slice(0, 9)), [mine()])).toBeNull();
  });

  it('becomes a course from the round: its name, the nines named, its pars and an optional handicap', () => {
    const c = myCourseOf(customRound('동네 골프장', PARS), '전반', '후반', HCP_NINES, 'my-n');
    expect(c).toEqual({ id: 'my-n', name: '동네 골프장', front: '전반', back: '후반', par: PARS, hcp: HCP_NINES });
    expect(myCourseOf(customRound('9홀', PARS.slice(0, 9)), '코스', '무시', undefined, 'my-9')).toEqual({ id: 'my-9', name: '9홀', front: '코스', back: '', par: PARS.slice(0, 9) });
    expect(myCourseOf(customRound('동네 골프장', PARS), ' ', '', undefined, 'my-d')).toMatchObject({ front: '전반', back: '후반' });
  });

  it('replaces the course of the same name, and stops at fifty', () => {
    const changed = mine({ id: 'my-new', par: PARS.map((p, i) => (i === 0 ? 5 : p)) as Par[] });
    expect(withMyCourse([mine()], changed)).toEqual([{ ...changed, id: 'my-a' }]);
    const full = Array.from({ length: MAX_MY_COURSES }, (_, i) => mine({ id: `my-${i}`, name: `골프장 ${i}` }));
    expect(withMyCourse(full, mine({ id: 'my-z', name: '하나 더' }))).toBe(full);
  });
});

describe('starting on 내 코스 (v45)', () => {
  it('starts with its pars and nine names, and remembers the choice', () => {
    const list = [mine()];
    const choice = { course: null, front: '', back: '', name: '동네 골프장', mine: 'my-a' };
    expect(roundSetup(choice, list)).toEqual({ course: { id: null, name: '동네 골프장', front: '전반', back: '후반' }, pars: PARS });
    expect(roundSetup({ ...choice, holes: 9 as const }, list)).toEqual({ course: { id: null, name: '동네 골프장', front: '전반', back: '' }, pars: PARS.slice(0, 9) });
    expect(resolveChoice(choice)).toMatchObject({ mine: 'my-a' });
    const kv = memory();
    savePrefs(choice, kv);
    expect(loadPrefs(kv)).toEqual(choice);
  });

  it('a nine-hole course is played twice for eighteen', () => {
    const nine = mine({ id: 'my-9', name: '9홀', front: '코스', back: '', par: PARS.slice(0, 9) });
    expect(roundSetup({ course: null, front: '', back: '', name: '9홀', mine: 'my-9' }, [nine])).toEqual({ course: { id: null, name: '9홀', front: '코스', back: '코스' }, pars: [...PARS.slice(0, 9), ...PARS.slice(0, 9)] });
  });

  it('falls back to a course typed in by hand when it was deleted', () => {
    expect(roundSetup({ course: null, front: '', back: '', name: '동네 골프장', mine: 'my-gone' }, [])).toEqual({ course: { id: null, name: '동네 골프장', front: '', back: '' }, pars: Array(18).fill(4) });
  });

  it('gives 파 수정 its pars and the hole its handicap index', () => {
    const list = [mine({ hcp: HCP_NINES })];
    const course = { id: null, name: '동네 골프장', front: '전반', back: '후반' };
    expect(publishedPar(course, 2, undefined, list)).toBe(3);
    expect(publishedPar(course, 9, undefined, list)).toBe(5);
    expect(publishedPar({ ...course, front: '', back: '' }, 2, undefined, list)).toBe(4);
    expect(holeInfo(course, 1, undefined, list)).toEqual({ si: 1 });
    expect(holeInfo(course, 1, undefined, [mine()])).toBeNull();
  });

  it('fills a past round entered on it (v44) with its pars', () => {
    const setup = roundSetup({ course: null, front: '', back: '', name: '동네 골프장', mine: 'my-a' }, [mine()]);
    expect(enteredRound('2026-11-20', setup, PARS).holes.map((h) => h.par)).toEqual(PARS);
  });

  it('finds the course of a round by its name and nines', () => {
    expect(findMine({ id: null, name: '동네 골프장', front: '전반', back: '후반' }, [mine()])?.id).toBe('my-a');
    expect(findMine({ id: null, name: '동네 골프장', front: '전반', back: '' }, [mine()])?.id).toBe('my-a');
    expect(findMine({ id: 'everis', name: '동네 골프장', front: '전반', back: '후반' }, [mine()])).toBeUndefined();
    expect(findMine({ id: null, name: '동네 골프장', front: '', back: '' }, [mine()])).toBeUndefined();
  });
});

describe('내 코스 in the backup file (v45)', () => {
  it('travels with the rounds and reads back the same; a file without it reads as before', () => {
    const current = newRound(new Date(2026, 10, 26));
    const text = backupText(backupOf(current, [], new Date(2026, 10, 26), [mine({ hcp: HCP_NINES })]));
    const read = parseBackup(text);
    expect(read.ok && read.courses).toEqual([mine({ hcp: HCP_NINES })]);
    const old = parseBackup(backupText(backupOf(current, [], new Date(2026, 10, 26))));
    expect(old.ok && 'courses' in old).toBe(false);
    expect(JSON.parse(backupText(backupOf(current, [], new Date(2026, 10, 26)))).courses).toBeUndefined();
  });

  it('adds what is new: the same id or the same name and pars is skipped, a same name with other pars gets a number', () => {
    const other = mine({ id: 'my-o', par: PARS.map((p, i) => (i === 0 ? 5 : p)) as Par[] });
    const got = mergeMyCourses([mine()], [mine(), mine({ id: 'my-copy' }), other, mine({ id: 'my-new', name: '새 골프장' })]);
    expect(got.imported).toBe(2);
    expect(got.skipped).toBe(2);
    expect(got.courses.map((c) => c.name)).toEqual(['동네 골프장', '동네 골프장 (2)', '새 골프장']);
  });
});

describe('a course typed in by hand without 내 코스 still reads as before (v45)', () => {
  it('starts at par 4 with no nines', () => {
    expect(roundSetup({ course: null, front: '', back: '', name: '처음 가는 곳' }, [])).toEqual({ course: { id: null, name: '처음 가는 곳', front: '', back: '' }, pars: Array(18).fill(4) });
    expect(COURSE_PARS).toHaveLength(18);
  });
});
