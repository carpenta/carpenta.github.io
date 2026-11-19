import { describe, expect, it } from 'vitest';
import { AREAS, COURSES, DEFAULT_CHOICE, choseong, courseSource, defaultNines, findCourse, resolveChoice, roundSetup, searchCourses } from '../src/courses';
import { layoutBend } from '../src/hole-art';
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
});

describe('bundled hole notes', () => {
  const noted = COURSES.flatMap((c) => c.nines.filter((n) => n.holes).map((n) => ({ c, n, holes: n.holes! })));

  it('come nine to a nine with only the HoleInfo fields, and nines without notes have no holes field', () => {
    expect(noted.length).toBeGreaterThan(30);
    for (const { c, n, holes } of noted) {
      const where = `${c.id}/${n.id}`;
      expect(Object.keys(n).sort(), where).toEqual(['holes', 'id', 'name', 'par']);
      expect(holes, where).toHaveLength(9);
      expect(holes.some(Boolean), where).toBe(true);
      for (const h of holes) {
        if (h === null) continue;
        expect(Object.keys(h).length, where).toBeGreaterThan(0);
        for (const key of Object.keys(h)) expect(['distances', 'guideUrl', 'layout'], where).toContain(key);
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
    expect(links).toBeGreaterThan(100);
  });

  it('give one length per named tee, in m or yd, that fits the hole’s par', () => {
    for (const { c, n, holes } of noted) {
      holes.forEach((h, i) => {
        if (h?.distances === undefined) return;
        const where = `${c.id}/${n.id}#${i + 1}`;
        expect(h.distances.length, where).toBeGreaterThan(0);
        expect(new Set(h.distances.map((d) => d.tee)).size, where).toBe(h.distances.length);
        const [low, high] = PAR_RANGE_M[n.par[i]];
        for (const d of h.distances) {
          expect(d.tee.trim(), where).not.toBe('');
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

  it('list the white or regular tee first when a hole has one, so the card shows it', () => {
    for (const { holes } of noted) {
      for (const h of holes) {
        const tees = h?.distances?.map((d) => d.tee) ?? [];
        const start = tees.find((t) => t === '화이트') ?? tees.find((t) => t.startsWith('레귤러'));
        if (start) expect(tees[0], tees.join(' ')).toBe(start);
      }
    }
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

  it('leave out lengths from a course whose pages give them in two units', () => {
    const cypress = findCourse('cypress')!;
    expect(cypress.nines.some((n) => n.holes)).toBe(true);
    expect(cypress.nines.flatMap((n) => n.holes ?? []).some((h) => h?.distances)).toBe(false);
  });

  it('give every Everis hole a link to its official guide', () => {
    for (const n of findCourse('everis')!.nines) {
      expect(n.holes, n.id).toHaveLength(9);
      for (const h of n.holes!) expect(h?.guideUrl, n.id).toMatch(/^https:\/\/www\.shinangolf\.com\//);
    }
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
