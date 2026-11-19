import { describe, expect, it } from 'vitest';
import { newRound, type Hole, type Round } from '../src/round';
import { BACKUP_APP, BACKUP_FORMAT, backupName, backupOf, backupText, parseBackup, planImport, settleImport } from '../src/backup';
import { type Entry } from '../src/history';

const hole = (par: 3 | 4 | 5, driver: number, approach: number, putts: number, ob = 0, mulligan = 0): Hole => ({ par, driver, approach, putts, ob, mulligan });

function roundOn(date: string, list: Hole[], current = list.length): Round {
  const [y, m, d] = date.split('-').map(Number);
  const r = newRound(new Date(y, m - 1, d));
  list.forEach((h, i) => (r.holes[i] = h));
  r.current = Math.min(current, r.holes.length - 1);
  return r;
}

const one = (date: string) => roundOn(date, [hole(4, 1, 1, 2)]);
const entry = (id: string, round: Round, endedAt = 1_790_000_000_000): Entry => ({ id, endedAt, round });

describe('backup file', () => {
  it('is named after the local date', () => {
    expect(backupName(new Date(2026, 10, 9, 23, 59))).toBe('fairway-note-backup-2026-11-09.json');
  });

  it('holds the round being recorded and every past round, and reads back the same', () => {
    const current = roundOn('2026-11-19', [hole(4, 1, 0, 0)], 0);
    const past = [entry('a', one('2026-11-01')), entry('b', { ...roundOn('2026-11-02', [{ ...hole(4, 1, 0, 2), tags: { putts: ['short', 'in'] } }]), lastEdited: 1_790_000_000_500 })];
    const backup = backupOf(current, past, new Date(Date.UTC(2026, 10, 19, 3, 4, 5)));
    expect(backup).toEqual({ app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: '2026-11-19T03:04:05.000Z', current, history: past });
    expect(BACKUP_APP).toBe('fairway-note');
    expect(BACKUP_FORMAT).toBe(1);
    expect(parseBackup(backupText(backup))).toEqual({ ok: true, history: past, invalid: 0, current });
    // A round with nothing entered is not worth restoring.
    expect(backupOf(newRound(), past).current).toBeNull();
    expect(JSON.parse(backupText(backupOf(newRound(), [])))).toMatchObject({ app: 'fairway-note', format: 1, current: null, history: [] });
  });

  it('rejects files that are not a Fairway Note backup, and says when a newer app made one', () => {
    const texts = [
      '', 'not json', '[]', 'null', '"x"', '{}',
      JSON.stringify({ app: 'other', format: 1, history: [] }),
      JSON.stringify({ app: 'fairway-note', format: 1 }),
      JSON.stringify({ app: 'fairway-note', format: '1', history: [] }),
      JSON.stringify({ app: 'fairway-note', format: 1, history: {} }),
      JSON.stringify(newRound()),
    ];
    for (const text of texts) expect(parseBackup(text), text).toEqual({ ok: false, error: 'not-backup' });
    expect(parseBackup(JSON.stringify({ app: 'fairway-note', format: 2, history: [] }))).toEqual({ ok: false, error: 'newer' });
  });

  it('counts the rounds it cannot read and keeps the rest', () => {
    const good = entry('a', one('2026-11-01'));
    const text = JSON.stringify({
      app: 'fairway-note', format: 1, exportedAt: 'whenever', current: { version: 9 },
      history: [good, { id: 'b' }, 'junk', { ...good, id: 'c', round: newRound() }],
    });
    expect(parseBackup(text)).toEqual({ ok: true, history: [good], invalid: 4, current: null });
    expect(parseBackup(JSON.stringify({ app: 'fairway-note', format: 1, history: [good] }))).toEqual({ ok: true, history: [good], invalid: 0, current: null });
  });
});

describe('import', () => {
  const a = entry('a', one('2026-11-01'));
  const b = entry('b', one('2026-11-02'));
  const here = one('2026-11-19');
  const theirs = roundOn('2026-11-18', [hole(4, 2, 1, 2)]);

  it('adds new past rounds and skips ones already kept, by id or as the same round', () => {
    const plan = planImport([a], here, { history: [a, b, entry('b-again', b.round)], invalid: 2, current: null });
    expect(plan).toEqual({ entries: [a, b], imported: 1, skipped: 2, invalid: 2, pending: null });
  });

  it('leaves the backup’s round in progress for the player to decide on, unless it is already here', () => {
    expect(planImport([a], here, { history: [], invalid: 0, current: theirs })).toEqual({ entries: [a], imported: 0, skipped: 0, invalid: 0, pending: theirs });
    expect(planImport([a], here, { history: [], invalid: 0, current: { ...here, current: 4 } })).toMatchObject({ pending: null, skipped: 1 });
    expect(planImport([a], here, { history: [], invalid: 0, current: a.round })).toMatchObject({ pending: null, skipped: 1 });
    expect(planImport([a], here, { history: [b], invalid: 0, current: b.round })).toMatchObject({ entries: [a, b], imported: 1, skipped: 1, pending: null });
    expect(planImport([a], here, { history: [], invalid: 0, current: newRound() })).toEqual({ entries: [a], imported: 0, skipped: 0, invalid: 0, pending: null });
  });

  it('replacing the round being recorded keeps it among past rounds first', () => {
    const plan = planImport([a], here, { history: [], invalid: 0, current: theirs });
    const replaced = settleImport(plan, here, true, 5000);
    expect(replaced.round).toBe(theirs);
    expect(replaced.imported).toBe(0);
    expect(replaced.entries.map((e) => e.round)).toEqual([a.round, here]);
    expect(replaced.entries[1].endedAt).toBe(5000);
    // A round being recorded with nothing finished has nothing to keep.
    expect(settleImport(plan, newRound(), true, 5000)).toEqual({ entries: [a], imported: 0, round: theirs });
  });

  it('declining files the backup’s round among past rounds when it has a finished hole', () => {
    const plan = planImport([a], here, { history: [], invalid: 0, current: theirs });
    const kept = settleImport(plan, here, false, 6000);
    expect(kept.round).toBeNull();
    expect(kept.imported).toBe(1);
    expect(kept.entries.map((e) => e.round)).toEqual([a.round, theirs]);
    const unfinished = planImport([a], here, { history: [], invalid: 0, current: roundOn('2026-11-18', [hole(4, 1, 0, 0)], 0) });
    expect(settleImport(unfinished, here, false, 6000)).toEqual({ entries: [a], imported: 0, round: null });
    expect(settleImport(planImport([a], here, { history: [b], invalid: 0, current: null }), here, true)).toEqual({ entries: [a, b], imported: 1, round: null });
  });
});
