import { describe, expect, it } from 'vitest';
import { AREAS, COURSES, DEFAULT_CHOICE, choseong, courseSource, defaultNines, findCourse, resolveChoice, roundSetup, searchCourses } from '../src/courses';
import { COURSE_PARS, DEFAULT_COURSE, HOLE_COUNT } from '../src/round';

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
