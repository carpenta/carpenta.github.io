// When to ask for a backup file, and the menu's line about it (v43). The browser may clear a site's storage, so the
// lasting copy of the rounds is the backup file; the app reminds without nagging.
import type { BackupMark } from './storage';

/** Ask again once this many rounds were kept since the last backup… */
export const NUDGE_ROUNDS = 5;
/** …or once the last backup is this many days old. */
export const NUDGE_DAYS = 30;

/** Whole days from one local date (YYYY-MM-DD) to another. */
export function daysBetween(from: string, to: string): number {
  const day = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((day(to) - day(from)) / 86_400_000);
}

/** Why to ask after a round is kept, or null to stay quiet. `kept`: past rounds kept now. */
export function shouldAskBackup(kept: number, mark: BackupMark | null, today: string): 'never' | 'rounds' | 'days' | null {
  if (kept === 0) return null;
  if (!mark) return 'never';
  if (kept - mark.rounds >= NUDGE_ROUNDS) return 'rounds';
  if (daysBetween(mark.at, today) >= NUDGE_DAYS) return 'days';
  return null;
}

/** The menu line under 백업과 복원; `stale` when there is no backup yet or it is 30 days or more old. */
export function backupStatus(kept: number, mark: BackupMark | null, today: string): { text: string; stale: boolean } {
  if (kept === 0) return { text: '기록을 파일로 옮겨요', stale: false };
  if (!mark) return { text: `보관한 라운드 ${kept}개 · 아직 백업하지 않았어요`, stale: true };
  const days = daysBetween(mark.at, today);
  const when = days <= 0 ? '오늘' : `${days}일 전`;
  return { text: `보관한 라운드 ${kept}개 · 마지막 백업 ${when}`, stale: days >= NUDGE_DAYS };
}
