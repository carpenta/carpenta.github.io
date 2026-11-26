// 내 코스 (v45): a course typed in by hand, kept so the next round there starts with its pars. Its name, the nines'
// names, every hole's par and, if given, its handicap index. Stored in this browser only, and in the backup file.
import { PARS, type Par, type Round, type RoundCourse } from './round';
import { keepAside, store } from './storage';

export const MY_COURSES_KEY = 'fairway-note:courses:v1';
export const MAX_MY_COURSES = 50;
export const MAX_COURSE_NAME = 40;
export const MAX_NINE_NAME = 20;
const MAX_ID = 64;
const FRONT = '전반';
const BACK = '후반';

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export interface MyCourse {
  /** `my-…`, never a bundled course's id; kept through backup and import. */
  id: string;
  name: string;
  front: string;
  /** Empty for a nine-hole course. */
  back: string;
  /** 18 pars, or 9 for a nine-hole course. */
  par: Par[];
  /** Handicap index per hole, same length as `par`: 1–9 once in each nine, or 1–18 once. */
  hcp?: number[];
}

const isName = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;

/** 1–9 once in each nine, or (eighteen holes) 1–18 once over the course. */
export function validHcp(hcp: readonly number[], holes: number): boolean {
  if (hcp.length !== holes || (holes !== 9 && holes !== 18)) return false;
  if (!hcp.every((n) => Number.isInteger(n))) return false;
  const once = (list: readonly number[], max: number) => list.length === max && new Set(list).size === max && list.every((n) => n >= 1 && n <= max);
  if (holes === 9) return once(hcp, 9);
  return (once(hcp.slice(0, 9), 9) && once(hcp.slice(9), 9)) || once(hcp, 18);
}

function readCourse(v: unknown): { course: MyCourse; lossy: boolean } | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '' || o.id.length > MAX_ID) return null;
  if (!isName(o.name, MAX_COURSE_NAME) || !isName(o.front, MAX_NINE_NAME)) return null;
  if (!Array.isArray(o.par) || (o.par.length !== 9 && o.par.length !== 18) || !o.par.every((p) => (PARS as readonly unknown[]).includes(p))) return null;
  const nine = o.par.length === 9;
  if (nine ? o.back !== '' : !isName(o.back, MAX_NINE_NAME)) return null;
  const course: MyCourse = { id: o.id, name: o.name, front: o.front, back: o.back as string, par: [...(o.par as Par[])] };
  let lossy = Object.keys(o).some((k) => !['id', 'name', 'front', 'back', 'par', 'hcp'].includes(k));
  if (o.hcp !== undefined) {
    if (Array.isArray(o.hcp) && validHcp(o.hcp as number[], course.par.length)) course.hcp = [...(o.hcp as number[])];
    else lossy = true;
  }
  return { course, lossy };
}

/** The readable courses of a stored list; `lossy` when anything in it could not be read as it is. */
export function readMyCourses(text: string | null): { courses: MyCourse[]; lossy: boolean } {
  if (text === null) return { courses: [], lossy: false };
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    return { courses: [], lossy: true };
  }
  if (!Array.isArray(list)) return { courses: [], lossy: true };
  const courses: MyCourse[] = [];
  const ids = new Set<string>();
  let lossy = false;
  for (const item of list) {
    const read = readCourse(item);
    if (!read || ids.has(read.course.id) || courses.length >= MAX_MY_COURSES) {
      lossy = true;
      continue;
    }
    ids.add(read.course.id);
    courses.push(read.course);
    if (read.lossy) lossy = true;
  }
  return { courses, lossy };
}

export function loadMyCourses(kv: KV | null = store()): MyCourse[] {
  try {
    return readMyCourses(kv?.getItem(MY_COURSES_KEY) ?? null).courses;
  } catch {
    return [];
  }
}

/** Writes the list (removing the key when empty), first copying aside a stored value this version cannot fully read. */
export function saveMyCourses(courses: MyCourse[], kv: KV | null = store()): boolean {
  if (!kv) return false;
  try {
    const raw = kv.getItem(MY_COURSES_KEY);
    if (raw !== null && readMyCourses(raw).lossy) keepAside(kv, raw);
    if (courses.length) kv.setItem(MY_COURSES_KEY, JSON.stringify(courses));
    else kv.removeItem(MY_COURSES_KEY);
    return true;
  } catch {
    return false;
  }
}

function newId(): string {
  const r = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `my-${r}`;
}

const samePars = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((p, i) => p === b[i]);

/** The par of hole `index` (0-17) on a course: a nine-hole course repeats its nine. */
export function myPar(c: MyCourse, index: number): Par {
  return c.par[c.par.length === 9 ? index % 9 : index];
}

export function myHcp(c: MyCourse, index: number): number | undefined {
  return c.hcp?.[c.par.length === 9 ? index % 9 : index];
}

/**
 * The 내 코스 a round was played on: a course typed in by hand of that name whose nines the round names (a round of
 * its front nine only names that one; a nine-hole course played twice names it twice).
 */
export function findMine(course: RoundCourse, list: readonly MyCourse[]): MyCourse | undefined {
  if (course.id !== null || course.front === '') return undefined;
  return list.find((c) => c.name === course.name && c.front === course.front
    && (course.back === '' || course.back === c.back || (c.back === '' && course.back === c.front)));
}

/**
 * After a round on a course typed in by hand (v45): 'save' when no 내 코스 has its name, 'update' when one does with
 * other pars for the same holes, null otherwise (a bundled course, or nothing new).
 */
export function saveOffer(round: Round, list: readonly MyCourse[]): 'save' | 'update' | null {
  const course = round.course;
  if (!course || course.id !== null) return null;
  const known = list.find((c) => c.name === course.name);
  if (!known) return 'save';
  const pars = round.holes.map((h) => h.par);
  if (pars.length !== known.par.length) return null;
  return samePars(pars, known.par) ? null : 'update';
}

/** The course a round makes: its name and pars, the nines named (전반·후반 when left blank), an optional handicap. */
export function myCourseOf(round: Round, front: string, back: string, hcp?: readonly number[], id = newId()): MyCourse {
  const par = round.holes.map((h) => h.par);
  const nine = par.length === 9;
  const named = (s: string, fallback: string) => s.trim().slice(0, MAX_NINE_NAME) || fallback;
  const course: MyCourse = {
    id,
    name: (round.course?.name ?? '').trim().slice(0, MAX_COURSE_NAME),
    front: named(front, nine ? '코스' : FRONT),
    back: nine ? '' : named(back, BACK),
    par,
  };
  if (hcp && validHcp(hcp, par.length)) course.hcp = [...hcp];
  return course;
}

/** The list with this course added, or replacing the one of the same name (keeping its id); the same list when full. */
export function withMyCourse(list: MyCourse[], course: MyCourse): MyCourse[] {
  const at = list.findIndex((c) => c.name === course.name);
  if (at >= 0) return list.map((c, i) => (i === at ? { ...course, id: c.id } : c));
  if (list.length >= MAX_MY_COURSES) return list;
  return [...list, course];
}

export function withoutMyCourse(list: MyCourse[], id: string): MyCourse[] {
  return list.filter((c) => c.id !== id);
}

/** Adds imported courses: the same id, or the same name and pars, is skipped; the same name with other pars gets "(2)". */
export function mergeMyCourses(list: MyCourse[], incoming: MyCourse[]): { courses: MyCourse[]; imported: number; skipped: number } {
  const out = [...list];
  let imported = 0;
  let skipped = 0;
  for (const c of incoming) {
    if (out.length >= MAX_MY_COURSES || out.some((o) => o.id === c.id || (o.name === c.name && samePars(o.par, c.par)))) {
      skipped += 1;
      continue;
    }
    let name = c.name;
    for (let n = 2; out.some((o) => o.name === name); n++) {
      const suffix = ` (${n})`;
      name = `${c.name.slice(0, MAX_COURSE_NAME - suffix.length)}${suffix}`;
    }
    out.push({ ...c, name });
    imported += 1;
  }
  return { courses: out, imported, skipped };
}
