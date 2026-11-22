import type { OsmHole } from './course-art';
import { COURSES, type Course } from './courses';
import type { RoundCourse } from './round';

/**
 * The holes drawn from OpenStreetMap (v27): bundled outlines derived from OSM (src/data/osm/, ODbL 1.0, © OpenStreetMap
 * contributors), kept apart from the official course data. Each course's file is its own chunk of the build, from the
 * app's own folder and precached like the rest, loaded the first time a round on that course is drawn: courses without
 * one never fetch it. Per nine id, nine entries (null where a hole is not matched and keeps the schematic).
 */
type ByNine = Record<string, (OsmHole | null)[]>;
type Load = () => Promise<{ default: { holes: unknown } }>;
const SOURCES: Record<string, Load> = {
  everis: () => import('./data/osm/everis.json'),
  // v40: holes traced roughly from the course's official hole maps (src/data/traced/, scripts/trace-holes.mjs), in the
  // same shape; drawn the same way, without OpenStreetMap's credit.
  pinx: () => import('./data/traced/pinx.json'),
};
const TRACED = new Set(['pinx']);

/** Where a course's outlines come from: OpenStreetMap, traced from its hole maps, or none (the schematic). */
export function holeArt(courseId: string | null): 'osm' | 'traced' | null {
  if (courseId === null || !SOURCES[courseId]) return null;
  return TRACED.has(courseId) ? 'traced' : 'osm';
}
const loaded = new Map<string, ByNine>();
const loading = new Map<string, Promise<void>>();

/**
 * Starts loading the outlines of a course that has them (once), and gives the promise while they load; null when they are
 * already here or the course has none.
 */
export function osmLoading(courseId: string | null): Promise<void> | null {
  const source = courseId === null ? undefined : SOURCES[courseId];
  if (!source || loaded.has(courseId!)) return null;
  let wait = loading.get(courseId!);
  if (!wait) {
    // Should the chunk not load (a tab left open across a deploy, say), the course keeps the schematic.
    wait = source().then(
      (m) => void loaded.set(courseId!, m.default.holes as ByNine),
      () => void loaded.set(courseId!, {}),
    );
    loading.set(courseId!, wait);
  }
  return wait;
}

/**
 * The OpenStreetMap outline of hole `index` (0-17) of a round's course, found by the nine names the round keeps (as
 * holeInfo does); null on a course or hole OSM does not draw, or while its outlines are still loading (osmLoading).
 */
export function osmHoleAt(course: RoundCourse, index: number, courses: readonly Course[] = COURSES): OsmHole | null {
  const byNine = course.id === null ? undefined : loaded.get(course.id);
  if (!byNine) return null;
  const nine = courses.find((c) => c.id === course.id)?.nines.find((n) => n.name.ko === (index < 9 ? course.front : course.back));
  return (nine && byNine[nine.id]?.[index % 9]) ?? null;
}
