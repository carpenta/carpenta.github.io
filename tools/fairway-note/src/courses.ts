import data from './data/courses.json';
import { HOLE_COUNT, type Par, type RoundCourse } from './round';
import type { CourseChoice } from './storage';
import { findMine, loadMyCourses, myHcp, myPar, type MyCourse } from './my-courses';

/** A hole's length from one tee, as the course publishes it. */
export interface TeeLength {
  /** The tee as the course names it, e.g. "화이트". Missing when the course publishes a single length with no tee name. */
  tee?: string;
  length: number;
  unit: 'm' | 'yd';
}

/** Notes on one hole from the course's own hole guide. Every field is optional. */
export interface HoleInfo {
  /** Lengths by tee, the tee most players use first: the card shows the first. */
  distances?: TeeLength[];
  /** A short note on the hole's shape, e.g. "우 도그렉". A dogleg named here bends the drawn hole. */
  layout?: string;
  /** The hole's page in the course's official hole guide (https). */
  guideUrl?: string;
  /**
   * The hole's stroke index (handicap) as published: 1–9 within its nine, or 1–18 when the course pairs nines
   * into 1–18. Missing when the course's values are duplicated or unclear.
   */
  si?: number;
}

export interface Nine {
  id: string;
  name: { ko: string; en: string | null };
  par: Par[];
  /** Hole notes in hole order, nine entries (null for a hole without notes). Missing when the course has none. */
  holes?: (HoleInfo | null)[];
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
  // A round of one nine is kept as a choice too (v11); 18 holes is the default and is not written.
  const nine = choice?.holes === 9 ? { holes: 9 as const } : {};
  if (choice && choice.course === null) return { course: null, front: '', back: '', name: choice.name ?? '', ...nine, ...(choice.mine ? { mine: choice.mine } : {}) };
  const course = findCourse(choice?.course ?? null);
  if (!course || !choice) return { ...DEFAULT_CHOICE };
  const [front, back] = defaultNines(course);
  const has = (id: string) => course.nines.some((n) => n.id === id);
  return { course: course.id, front: has(choice.front) ? choice.front : front, back: has(choice.back) ? choice.back : back, ...nine };
}

/**
 * The course and pars a new round starts with: two nines, or one for a 9-hole round (its back nine name is empty).
 * A course typed in by hand starts at par 4 everywhere.
 */
export function roundSetup(choice: CourseChoice, mine?: readonly MyCourse[]): { course: RoundCourse; pars: Par[] } {
  const resolved = resolveChoice(choice);
  const count = resolved.holes === 9 ? 9 : HOLE_COUNT;
  const course = findCourse(resolved.course);
  // 내 코스 (v45): its name, nines and pars; a nine-hole one is played twice. Deleted, it is a typed-in name again.
  const m = !course && resolved.mine ? (mine ?? loadMyCourses()).find((c) => c.id === resolved.mine) : undefined;
  if (m) {
    const pars = Array.from({ length: count }, (_, i) => myPar(m, i));
    const back = count === 9 ? '' : m.back || m.front;
    return { course: { id: null, name: m.name, front: m.front, back }, pars };
  }
  if (!course) {
    const name = (resolved.name ?? '').trim().slice(0, MAX_CUSTOM_NAME) || CUSTOM_NAME;
    return { course: { id: null, name, front: '', back: '' }, pars: Array<Par>(count).fill(4) };
  }
  const nine = (id: string) => course.nines.find((n) => n.id === id)!;
  const front = nine(resolved.front);
  if (count === 9) return { course: { id: course.id, name: course.name.ko, front: front.name.ko, back: '' }, pars: [...front.par] };
  const back = nine(resolved.back);
  return { course: { id: course.id, name: course.name.ko, front: front.name.ko, back: back.name.ko }, pars: [...front.par, ...back.par] };
}

/** The bundled course a round was started on, for its par source link. */
export function courseSource(course: RoundCourse): Course | null {
  return findCourse(course.id) ?? null;
}

/**
 * The par a round's course publishes for hole `index` (0-17), found by the nine names the round keeps: par 4 on a
 * course typed in by hand, null when the bundle no longer has those nines. 파 수정 marks the holes changed from it.
 */
export function publishedPar(course: RoundCourse, index: number, courses: readonly Course[] = COURSES, mine?: readonly MyCourse[]): Par | null {
  if (course.id === null) {
    // 내 코스 (v45): its own pars; any other course typed in by hand starts at par 4.
    const m = findMine(course, mine ?? loadMyCourses());
    return m ? myPar(m, index) : 4;
  }
  const nine = courses.find((x) => x.id === course.id)?.nines.find((n) => n.name.ko === (index < 9 ? course.front : course.back));
  return nine?.par[index % 9] ?? null;
}

const MAX_LAYOUT = 40;

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Notes for hole `index` (0-17) of a round's course: from its front nine for holes 1-9 and its back nine for
 * 10-18, found by the nine names the round keeps. Null when the bundle has none. A link that is not https, an empty
 * note and a length that is not positive are left out, so nothing odd reaches the page.
 */
export function holeInfo(course: RoundCourse, index: number, courses: readonly Course[] = COURSES, mine?: readonly MyCourse[]): HoleInfo | null {
  if (course.id === null) {
    // 내 코스 (v45): only the handicap index the player gave, shown as the bundled courses' "HDCP n".
    const m = findMine(course, mine ?? loadMyCourses());
    const si = m ? myHcp(m, index) : undefined;
    return si ? { si } : null;
  }
  const c = courses.find((x) => x.id === course.id);
  const nine = c?.nines.find((n) => n.name.ko === (index < 9 ? course.front : course.back));
  const raw = nine?.holes?.[index % 9];
  if (!raw) return null;
  const info: HoleInfo = {};
  // A course may publish one length with no tee name; read loosely so either shape of the data passes.
  const teeOf = (d: TeeLength) => (d as { tee?: unknown }).tee;
  const distances = (raw.distances ?? []).filter((d) => (teeOf(d) === undefined || typeof teeOf(d) === 'string') && Number.isFinite(d.length) && d.length > 0 && (d.unit === 'm' || d.unit === 'yd'));
  if (distances.length) info.distances = distances.map((d) => ({ ...(typeof teeOf(d) === 'string' ? { tee: d.tee } : {}), length: d.length, unit: d.unit }) as TeeLength);
  const layout = typeof raw.layout === 'string' ? raw.layout.trim().slice(0, MAX_LAYOUT) : '';
  if (layout) info.layout = layout;
  if (typeof raw.guideUrl === 'string' && isHttps(raw.guideUrl)) info.guideUrl = raw.guideUrl;
  // The published handicap index (1-9 per nine or 1-18), shown as "HDCP n".
  const si = (raw as { si?: unknown }).si;
  if (Number.isInteger(si) && (si as number) >= 1 && (si as number) <= 18) (info as { si?: number }).si = si as number;
  return Object.keys(info).length ? info : null;
}

/** "화이트 352 m" from the first tee listed, "385 m" when the course names no tee, or null without lengths. */
export function distanceLabel(info: HoleInfo | null): string | null {
  const d = info?.distances?.[0];
  if (!d) return null;
  const tee = (d as { tee?: unknown }).tee;
  return typeof tee === 'string' && tee ? `${tee} ${d.length} ${d.unit}` : `${d.length} ${d.unit}`;
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
