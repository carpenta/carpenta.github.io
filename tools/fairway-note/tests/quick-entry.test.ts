import { describe, expect, it } from 'vitest';
import { holeList, nextHole } from '../src/quick-entry';

const holes = (n: number, done: (i: number) => boolean) => Array.from({ length: n }, (_, i) => done(i));

describe('where the next chip goes in 넣기 (v49)', () => {
  it('goes on hole by hole from hole 1', () => {
    expect(nextHole(holes(18, (i) => i === 0), 0)).toBe(1);
    expect(nextHole(holes(18, (i) => i < 9), 8)).toBe(9);
  });

  it('after an earlier hole is fixed, goes back to the first hole not entered after it', () => {
    // Holes 1–7 are in; hole 3 fixed again leads on to hole 8, not to hole 4.
    expect(nextHole(holes(18, (i) => i < 7), 2)).toBe(7);
  });

  it('comes round to a hole left out before the last one', () => {
    expect(nextHole(holes(18, (i) => i !== 3), 17)).toBe(3);
  });

  it('stays on the hole once every hole is in', () => {
    expect(nextHole(holes(18, () => true), 17)).toBe(17);
    expect(nextHole(holes(18, () => true), 4)).toBe(4);
  });

  it('counts a nine as nine holes', () => {
    expect(nextHole(holes(9, (i) => i < 3), 2)).toBe(3);
    expect(nextHole(holes(9, () => true), 8)).toBe(8);
  });
});

describe('the holes the question before saving names (v49)', () => {
  it('names one hole, two side by side, and a run of three or more as a range', () => {
    expect(holeList([4])).toBe('5번 홀');
    expect(holeList([4, 5])).toBe('5·6번 홀');
    expect(holeList([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])).toBe('7~18번 홀');
  });

  it('joins the runs in hole order', () => {
    expect(holeList([2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])).toBe('3·7~18번 홀');
    expect(holeList([0, 1, 2, 8, 17])).toBe('1~3·9·18번 홀');
  });
});
