import data from './data/courses.json';
import { HOLE_COUNT, type Par, type RoundCourse } from './round';
import type { CourseChoice } from './storage';

export interface Nine {
  id: string;
  name: { ko: string; en: string | null };
  par: Par[];
}

/** A course whose pars come from its own published scorecard (see scripts/build-courses.mjs). */
export interface Course {
  id: string;
  name: { ko: string; en: string | null };
  /** Picker chip: 제주, 수도권, 강원, 충청, 전라 or 경상. */
  area: string;
  /** 시·도 and 시·군, e.g. "제주 제주시". */
  region: string;
  /** The official scorecard page the pars come from. */
  source: string;
  /** When that page was checked, YYYY-MM-DD. */
  checked: string;
  nines: Nine[];
}

export const COURSES: readonly Course[] = (data as { courses: Course[] }).courses;
export const AREAS: readonly string[] = ['제주', '수도권', '강원', '충청', '전라', '경상'].filter((a) => COURSES.some((c) => c.area === a));
export const DEFAULT_CHOICE: CourseChoice = { course: 'everis', front: 'saebyul', back: 'lake' };
export const CUSTOM_NAME = '직접 입력';
export const MAX_CUSTOM_NAME = 40;

export function findCourse(id: string | null): Course | undefined {
  return id === null ? undefined : COURSES.find((c) => c.id === id);
}

/** First two nines for the front and back; a nine-hole course is played twice. */
export function defaultNines(course: Course): [string, string] {
  const [a, b = a] = course.nines;
  return [a.id, b.id];
}

/** The remembered choice if it still matches the bundle, otherwise the closest valid one. */
export function resolveChoice(choice: CourseChoice | null): CourseChoice {
  if (choice && choice.course === null) return { course: null, front: '', back: '', name: choice.name ?? '' };
  const course = findCourse(choice?.course ?? null);
  if (!course || !choice) return { ...DEFAULT_CHOICE };
  const [front, back] = defaultNines(course);
  const has = (id: string) => course.nines.some((n) => n.id === id);
  return { course: course.id, front: has(choice.front) ? choice.front : front, back: has(choice.back) ? choice.back : back };
}

/** The course and pars a new round starts with. A course typed in by hand starts at par 4 everywhere. */
export function roundSetup(choice: CourseChoice): { course: RoundCourse; pars: Par[] } {
  const resolved = resolveChoice(choice);
  const course = findCourse(resolved.course);
  if (!course) {
    const name = (resolved.name ?? '').trim().slice(0, MAX_CUSTOM_NAME) || CUSTOM_NAME;
    return { course: { id: null, name, front: '', back: '' }, pars: Array<Par>(HOLE_COUNT).fill(4) };
  }
  const nine = (id: string) => course.nines.find((n) => n.id === id)!;
  const front = nine(resolved.front);
  const back = nine(resolved.back);
  return { course: { id: course.id, name: course.name.ko, front: front.name.ko, back: back.name.ko }, pars: [...front.par, ...back.par] };
}

/** The bundled course a round was started on, for its par source link. */
export function courseSource(course: RoundCourse): Course | null {
  return findCourse(course.id) ?? null;
}

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** Initial consonants of Hangul syllables; other characters are kept. */
export function choseong(text: string): string {
  return [...text].map((ch) => {
    const code = ch.charCodeAt(0) - 0xac00;
    return code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : ch;
  }).join('');
}

const fold = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** Courses matching a name, initial consonants (ㅇㅂㄹㅅ) or region, within an area when one is given. */
export function searchCourses(query: string, area: string | null): Course[] {
  const q = fold(query);
  const initials = q !== '' && [...q].every((ch) => CHO.includes(ch));
  return COURSES.filter((c) => {
    if (area && c.area !== area) return false;
    if (!q) return true;
    const name = fold(c.name.ko);
    if (initials) return choseong(name).includes(q);
    return name.includes(q) || fold(c.region).includes(q) || c.nines.some((n) => fold(n.name.ko) === q);
  });
}
