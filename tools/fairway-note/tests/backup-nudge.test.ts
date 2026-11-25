import { describe, expect, it } from 'vitest';
import { NUDGE_DAYS, NUDGE_ROUNDS, backupStatus, daysBetween, shouldAskBackup } from '../src/backup-nudge';

// v43 (the user's call): after a round is kept, the backup card asks only when there is no backup yet, five or more
// rounds were kept since the last one, or the last one is thirty or more days old.
describe('the backup reminder (v43)', () => {
  it('counts whole days between two local dates, across a month and a year', () => {
    expect(daysBetween('2026-11-25', '2026-11-25')).toBe(0);
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-30')).toBe(30);
  });

  it('asks after the first kept round when nothing was ever backed up', () => {
    expect(shouldAskBackup(1, null, '2026-11-25')).toBe('never');
    expect(shouldAskBackup(0, null, '2026-11-25')).toBe(null);
  });

  it('asks again from the fifth round kept since the last backup', () => {
    expect(NUDGE_ROUNDS).toBe(5);
    const mark = { at: '2026-11-20', rounds: 3 };
    expect(shouldAskBackup(7, mark, '2026-11-25')).toBe(null);
    expect(shouldAskBackup(8, mark, '2026-11-25')).toBe('rounds');
  });

  it('asks again from the thirtieth day after the last backup', () => {
    expect(NUDGE_DAYS).toBe(30);
    const mark = { at: '2026-10-27', rounds: 3 };
    expect(shouldAskBackup(4, mark, '2026-11-25')).toBe(null);
    expect(shouldAskBackup(4, mark, '2026-11-26')).toBe('days');
  });

  it('says how many rounds are kept and when the last backup was, stale past thirty days or with none', () => {
    expect(backupStatus(0, null, '2026-11-25')).toEqual({ text: '기록을 파일로 옮겨요', stale: false });
    expect(backupStatus(3, null, '2026-11-25')).toEqual({ text: '보관한 라운드 3개 · 아직 백업하지 않았어요', stale: true });
    expect(backupStatus(3, { at: '2026-11-25', rounds: 3 }, '2026-11-25')).toEqual({ text: '보관한 라운드 3개 · 마지막 백업 오늘', stale: false });
    expect(backupStatus(12, { at: '2026-11-02', rounds: 9 }, '2026-11-25')).toEqual({ text: '보관한 라운드 12개 · 마지막 백업 23일 전', stale: false });
    expect(backupStatus(12, { at: '2026-10-26', rounds: 9 }, '2026-11-25')).toEqual({ text: '보관한 라운드 12개 · 마지막 백업 30일 전', stale: true });
  });
});
