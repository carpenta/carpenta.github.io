import { describe, expect, it } from 'vitest';
import { AREAS, COURSES, DEFAULT_CHOICE, choseong, courseSource, defaultNines, findCourse, resolveChoice, roundSetup, searchCourses } from '../src/courses';
import { layoutBend } from '../src/course-art';
import { COURSE_PARS, DEFAULT_COURSE, HOLE_COUNT } from '../src/round';

const DENIED = /golfpass|hole19|18birdies|golfingrecord|golfzon|smartscore|kakao|openstreetmap|data\.go\.kr/;
const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '');
/** Lengths in metres a hole of each par can have, the range scripts/build-courses.mjs keeps. */
const PAR_RANGE_M = { 3: [60, 280], 4: [180, 560], 5: [300, 650] } as const;

describe('bundled courses', () => {
  it('has unique ids and nine pars of 3, 4 or 5', () => {
    expect(COURSES.length).toBeGreaterThan(10);
    expect(new Set(COURSES.map((c) => c.id)).size).toBe(COURSES.length);
    for (const c of COURSES) {
      expect(c.nines.length, c.id).toBeGreaterThan(0);
      expect(new Set(c.nines.map((n) => n.id)).size, c.id).toBe(c.nines.length);
      for (const n of c.nines) {
        expect(n.par, `${c.id}/${n.id}`).toHaveLength(9);
        expect(n.par.every((p) => p === 3 || p === 4 || p === 5), `${c.id}/${n.id}`).toBe(true);
      }
    }
  });

  it('carries an official source and checked date, and no map coordinates', () => {
    for (const c of COURSES) {
      expect(c.source, c.id).toMatch(/^https?:\/\/[^/]+\//);
      expect(c.source, c.id).not.toMatch(/golfpass|hole19|18birdies|golfingrecord|golfzon|smartscore|kakao|openstreetmap|data\.go\.kr/);
      expect(c.checked, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Object.keys(c).sort()).toEqual(['area', 'checked', 'id', 'name', 'nines', 'region', 'source']);
    }
  });

  it('lists 제주 first and only areas that have courses', () => {
    expect(AREAS[0]).toBe('제주');
    expect(COURSES[0].area).toBe('제주');
    for (const a of AREAS) expect(COURSES.some((c) => c.area === a)).toBe(true);
  });

  it('has Everis with 새별, 레이크 and 파인', () => {
    const everis = findCourse('everis')!;
    expect(everis.nines.map((n) => n.name.ko)).toEqual(['새별', '레이크', '파인']);
    expect(everis.source).toContain('shinangolf.com');
  });

  it('leaves out the Gyeongsang nines whose official tables did not hold up (research confidence medium)', () => {
    expect(findCourse('seorabeol-gc')!.nines.map((n) => n.id)).not.toContain('lake');
    expect(findCourse('seven-valley-cc')!.nines.map((n) => n.id)).toEqual(['valley']);
    expect(findCourse('seogyeong-tani-cc')!.nines.map((n) => n.id)).not.toContain('baekho');
  });
});

describe('bundled hole notes', () => {
  const noted = COURSES.flatMap((c) => c.nines.filter((n) => n.holes).map((n) => ({ c, n, holes: n.holes! })));

  const nine = (course: string, id: string) => findCourse(course)!.nines.find((n) => n.id === id)!;
  const holesWithLengths = (course: string) => findCourse(course)!.nines.flatMap((n) => n.holes ?? []).filter((h) => h?.distances).length;

  it('come nine to a nine with only the HoleInfo fields, in every area, and nines without notes have no holes field', () => {
    expect(noted.length).toBeGreaterThan(100);
    for (const a of AREAS) expect(noted.some(({ c }) => c.area === a), a).toBe(true);
    for (const { c, n, holes } of noted) {
      const where = `${c.id}/${n.id}`;
      expect(Object.keys(n).sort(), where).toEqual(['holes', 'id', 'name', 'par']);
      expect(holes, where).toHaveLength(9);
      expect(holes.some(Boolean), where).toBe(true);
      for (const h of holes) {
        if (h === null) continue;
        expect(Object.keys(h).length, where).toBeGreaterThan(0);
        for (const key of Object.keys(h)) expect(['distances', 'guideUrl', 'layout', 'si'], where).toContain(key);
      }
    }
    for (const c of COURSES) {
      for (const n of c.nines) if (!n.holes) expect(Object.keys(n).sort(), `${c.id}/${n.id}`).toEqual(['id', 'name', 'par']);
    }
  });

  it('link only to https pages on the site the course’s pars come from', () => {
    let links = 0;
    for (const { c, holes } of noted) {
      for (const h of holes) {
        if (h?.guideUrl === undefined) continue;
        links += 1;
        expect(h.guideUrl, c.id).toMatch(/^https:\/\/[^/]+\//);
        expect(hostOf(h.guideUrl), c.id).toBe(hostOf(c.source));
        expect(h.guideUrl, c.id).not.toMatch(DENIED);
      }
    }
    expect(links).toBeGreaterThan(500);
  });

  it('give one length per named tee, or a single length with no tee name, in m or yd that fits the hole’s par', () => {
    for (const { c, n, holes } of noted) {
      holes.forEach((h, i) => {
        if (h?.distances === undefined) return;
        const where = `${c.id}/${n.id}#${i + 1}`;
        const tees = h.distances.map((d) => d.tee);
        expect(h.distances.length, where).toBeGreaterThan(0);
        if (tees.includes(undefined)) expect(h.distances, where).toHaveLength(1);
        else expect(new Set(tees).size, where).toBe(tees.length);
        const [low, high] = PAR_RANGE_M[n.par[i]];
        for (const d of h.distances) {
          if (d.tee !== undefined) expect(d.tee.trim(), where).not.toBe('');
          expect(['m', 'yd'], where).toContain(d.unit);
          const metres = d.unit === 'yd' ? d.length * 0.9144 : d.length;
          expect(metres, where).toBeGreaterThanOrEqual(low);
          expect(metres, where).toBeLessThanOrEqual(high);
        }
        // Every tee showing the same length is a placeholder, which is left out.
        if (h.distances.length > 1) expect(new Set(h.distances.map((d) => `${d.length}${d.unit}`)).size, where).toBeGreaterThan(1);
      });
    }
  });

  it('list the tee most players start from first, with both its greens, and keep each tee’s greens together', () => {
    const starts = ['화이트', '화이트1', '레귤러', '블루', '프런트'];
    const base = (tee: string) => tee.replace(/ (?:A|B|좌|우)그린$/, '');
    for (const { holes } of noted) {
      for (const h of holes) {
        const tees = (h?.distances ?? []).flatMap((d) => (d.tee === undefined ? [] : [base(d.tee)]));
        const start = starts.find((t) => tees.includes(t));
        if (start) expect(tees.slice(0, tees.filter((t) => t === start).length).every((t) => t === start), tees.join(' ')).toBe(true);
        for (const t of new Set(tees)) expect(tees.lastIndexOf(t) - tees.indexOf(t) + 1, tees.join(' ')).toBe(tees.filter((x) => x === t).length);
      }
    }
  });

  it('name tees a course only numbers by that number, highest first', () => {
    const numbered = noted.flatMap(({ holes }) => holes).filter((h) => h?.distances?.every((d) => /^\d+티$/.test(d.tee ?? '')));
    expect(numbered.length).toBeGreaterThan(0);
    for (const h of numbered) {
      const numbers = h!.distances!.map((d) => Number.parseInt(d.tee!, 10));
      expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    }
  });

  it('give stroke indexes 1–9 once each in a nine, or 1–18 once each with another nine of the course', () => {
    const run = (values: number[], k: number) => values.length === k && new Set(values).size === k && values.every((v) => v >= 1 && v <= k);
    let nines = 0;
    for (const c of COURSES) {
      const rated = c.nines.filter((n) => n.holes?.some((h) => h?.si !== undefined));
      for (const n of rated) {
        nines += 1;
        const si = n.holes!.map((h) => h?.si);
        expect(si.every((v) => Number.isInteger(v)), `${c.id}/${n.id}`).toBe(true);
        const values = si as number[];
        const ok = run(values, 9) || rated.some((o) => o !== n && run([...values, ...o.holes!.map((h) => h!.si!)], 18));
        expect(ok, `${c.id}/${n.id} ${values.join(',')}`).toBe(true);
      }
    }
    expect(nines).toBeGreaterThan(50);
  });

  it('keep layout notes to three short phrases within 40 characters', () => {
    for (const { c, holes } of noted) {
      for (const h of holes) {
        if (h?.layout === undefined) continue;
        expect(h.layout.length, c.id).toBeLessThanOrEqual(40);
        const phrases = h.layout.split(', ');
        expect(phrases.length, h.layout).toBeLessThanOrEqual(3);
        for (const p of phrases) expect(p.trim(), h.layout).not.toBe('');
        expect(h.layout, c.id).not.toMatch(/[.!?]$|니다$/);
      }
    }
  });

  it('leave out lengths whose unit the course’s own pages do not state clearly', () => {
    // Cypress gives the same numbers in m and in yd; Ansung's card prints no unit; Haeundae's research has none.
    for (const course of ['cypress', 'ansung', 'haeundae-cc']) expect(holesWithLengths(course), course).toBe(0);
    // Their other notes stay: Cypress's handicaps do not depend on the unit.
    expect(nine('cypress', 'west').holes!.every((h) => h?.si !== undefined)).toBe(true);
  });

  it('leave out every length of a Gyeongsang nine whose own pages disagree about them', () => {
    for (const [course, id] of [['daegu-cc', 'west'], ['a-one-cc', 'west'], ['gaya-cc', 'sineo'], ['yangsan-cc', 'nuri']]) {
      expect(nine(course, id).holes?.some((h) => h?.distances) ?? false, `${course}/${id}`).toBe(false);
    }
    expect(nine('daegu-cc', 'east').holes!.some((h) => h?.distances)).toBe(true);
  });

  it('give every Everis hole its official guide link and its one published length, and the handicaps that add up', () => {
    for (const n of findCourse('everis')!.nines) {
      expect(n.holes, n.id).toHaveLength(9);
      for (const h of n.holes!) {
        expect(h?.guideUrl, n.id).toMatch(/^https:\/\/www\.shinangolf\.com\//);
        expect(h?.distances, n.id).toEqual([{ length: expect.any(Number), unit: 'm' }]);
      }
    }
    expect(nine('everis', 'saebyul').holes!.map((h) => h!.si!).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // 파인's page lists handicap 7 twice, so it carries none.
    expect(nine('everis', 'pine').holes!.some((h) => h?.si !== undefined)).toBe(false);
  });

  it('name doglegs both ways, so drawn holes bend', () => {
    const bends = noted.flatMap(({ holes }) => holes.map((h) => layoutBend(h?.layout)));
    expect(bends).toContain(1);
    expect(bends).toContain(-1);
  });
});

describe('choosing a course', () => {
  it('defaults to Everis 새별 then 레이크 with the official pars', () => {
    expect(DEFAULT_CHOICE).toEqual({ course: 'everis', front: 'saebyul', back: 'lake' });
    const setup = roundSetup(DEFAULT_CHOICE);
    expect(setup.course).toEqual(DEFAULT_COURSE);
    expect(setup.pars).toEqual(COURSE_PARS);
  });

  it('joins the front and back nines in order', () => {
    const everis = findCourse('everis')!;
    const setup = roundSetup({ course: 'everis', front: 'pine', back: 'saebyul' });
    expect(setup.course).toEqual({ id: 'everis', name: everis.name.ko, front: '파인', back: '새별' });
    expect(setup.pars).toEqual([...everis.nines[2].par, ...everis.nines[0].par]);
  });

  it('picks the first two nines, or one nine twice', () => {
    const everis = findCourse('everis')!;
    expect(defaultNines(everis)).toEqual(['saebyul', 'lake']);
    const single = COURSES.find((c) => c.nines.length === 1);
    if (single) expect(defaultNines(single)).toEqual([single.nines[0].id, single.nines[0].id]);
  });

  it('starts an unlisted course with the typed name and all par 4', () => {
    const setup = roundSetup({ course: null, front: '', back: '', name: '  동네 골프장 ' });
    expect(setup.course).toEqual({ id: null, name: '동네 골프장', front: '', back: '' });
    expect(setup.pars).toEqual(Array(HOLE_COUNT).fill(4));
    expect(roundSetup({ course: null, front: '', back: '' }).course.name).toBe('직접 입력');
  });

  it('falls back when a remembered course or nine is no longer bundled', () => {
    expect(resolveChoice(null)).toEqual(DEFAULT_CHOICE);
    expect(resolveChoice({ course: 'gone', front: 'a', back: 'b' })).toEqual(DEFAULT_CHOICE);
    expect(resolveChoice({ course: 'everis', front: 'pine', back: 'gone' })).toEqual({ course: 'everis', front: 'pine', back: 'lake' });
    expect(resolveChoice({ course: null, front: '', back: '', name: 'X' })).toEqual({ course: null, front: '', back: '', name: 'X' });
  });

  it('finds the source of a round course', () => {
    expect(courseSource(DEFAULT_COURSE)?.id).toBe('everis');
    expect(courseSource({ id: null, name: 'X', front: '', back: '' })).toBeNull();
  });
});

describe('searching', () => {
  it('reads initial consonants', () => {
    expect(choseong('에버리스 골프')).toBe('ㅇㅂㄹㅅ ㄱㅍ');
  });

  it('matches names, initial consonants and regions, ignoring spaces', () => {
    expect(searchCourses('에버', null).map((c) => c.id)).toContain('everis');
    expect(searchCourses('에버 리스', null).map((c) => c.id)).toContain('everis');
    expect(searchCourses('ㅇㅂㄹㅅ', null).map((c) => c.id)).toContain('everis');
    expect(searchCourses('서귀포', null).every((c) => c.region.includes('서귀포'))).toBe(true);
    expect(searchCourses('없는골프장이름', null)).toEqual([]);
  });

  it('filters by area', () => {
    expect(searchCourses('', null)).toHaveLength(COURSES.length);
    const jeju = searchCourses('', '제주');
    expect(jeju.length).toBeGreaterThan(0);
    expect(jeju.every((c) => c.area === '제주')).toBe(true);
  });
});
