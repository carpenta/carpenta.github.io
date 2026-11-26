import { localDate, type Round } from './round';
import { parseRound } from './storage';
import { readMyCourses, type MyCourse } from './my-courses';
import { fingerprint, hasRecord, mergeEntries, readEntry, withRound, type Entry } from './history';

export const BACKUP_APP = 'fairway-note';
export const BACKUP_FORMAT = 1;
/** Larger files are refused before reading; localStorage could not hold them anyway. */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

/** The backup file. It is written to wherever the player saves or shares it; the app never sends it anywhere. */
export interface Backup {
  app: typeof BACKUP_APP;
  format: typeof BACKUP_FORMAT;
  /** When the file was made, ISO 8601. Informational. */
  exportedAt: string;
  /** The round being recorded, or null when nothing is entered on it. */
  current: Round | null;
  history: Entry[];
  /** 내 코스 (v45), only when there are some. An older version's import ignores the field. */
  courses?: MyCourse[];
}

export function backupOf(current: Round, history: Entry[], now = new Date(), courses: MyCourse[] = []): Backup {
  return { app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: now.toISOString(), current: hasRecord(current) ? current : null, history, ...(courses.length ? { courses } : {}) };
}

export function backupName(now = new Date()): string {
  return `fairway-note-backup-${localDate(now)}.json`;
}

export function backupText(backup: Backup): string {
  return JSON.stringify(backup);
}

export type ReadBackup =
  | { ok: true; history: Entry[]; invalid: number; current: Round | null; courses?: MyCourse[] }
  | { ok: false; error: 'not-backup' | 'newer' };

/** Reads a backup file. Every round is checked as a saved round would be; those that fail are counted in `invalid`. */
export function parseBackup(text: string): ReadBackup {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-backup' };
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return { ok: false, error: 'not-backup' };
  const b = o as Record<string, unknown>;
  if (b.app !== BACKUP_APP) return { ok: false, error: 'not-backup' };
  if (typeof b.format === 'number' && b.format > BACKUP_FORMAT) return { ok: false, error: 'newer' };
  if (b.format !== BACKUP_FORMAT || !Array.isArray(b.history)) return { ok: false, error: 'not-backup' };
  const history: Entry[] = [];
  let invalid = 0;
  for (const item of b.history) {
    const read = readEntry(item);
    if (read) history.push(read.entry);
    else invalid += 1;
  }
  let current: Round | null = null;
  if (b.current !== undefined && b.current !== null) {
    current = parseRound(JSON.stringify(b.current));
    if (!current) invalid += 1;
  }
  // 내 코스 (v45): read with the stored list's checks; a file without them reads as before.
  const courses = Array.isArray(b.courses) ? readMyCourses(JSON.stringify(b.courses)).courses : [];
  return { ok: true, history, invalid, current, ...(courses.length ? { courses } : {}) };
}

export interface ImportPlan {
  /** The history with the backup's past rounds added. */
  entries: Entry[];
  imported: number;
  /** Rounds already here, by id or as the same round. */
  skipped: number;
  invalid: number;
  /** The backup's round in progress when it is new here. It never replaces the round being recorded without the player's say. */
  pending: Round | null;
}

export function planImport(history: Entry[], current: Round, backup: { history: Entry[]; invalid: number; current: Round | null }): ImportPlan {
  const merged = mergeEntries(history, backup.history);
  let skipped = merged.skipped;
  let pending: Round | null = null;
  const incoming = backup.current;
  if (incoming && hasRecord(incoming)) {
    const print = fingerprint(incoming);
    if (print === fingerprint(current) || merged.entries.some((e) => fingerprint(e.round) === print)) skipped += 1;
    else pending = incoming;
  }
  return { entries: merged.entries, imported: merged.imported, skipped, invalid: backup.invalid, pending };
}

/**
 * The import once the player chose. `replace`: the backup's round becomes the round being recorded, and the current
 * round is kept among past rounds first (when it has a finished hole). Otherwise the backup's round is filed among
 * past rounds, when it has a finished hole.
 */
export function settleImport(plan: ImportPlan, current: Round, replace: boolean, now = Date.now()): { entries: Entry[]; imported: number; round: Round | null } {
  if (!plan.pending) return { entries: plan.entries, imported: plan.imported, round: null };
  if (replace) return { entries: withRound(plan.entries, current, now), imported: plan.imported, round: plan.pending };
  const entries = withRound(plan.entries, plan.pending, now);
  return { entries, imported: plan.imported + (entries === plan.entries ? 0 : 1), round: null };
}
