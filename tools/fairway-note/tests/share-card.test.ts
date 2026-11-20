import { describe, expect, it } from 'vitest';
import { analyze, newRound, type Hole, type Round } from '../src/round';
import { SHARE_CARD_SIZE, markShapes, shareCardContent, shareCardFileName, shareCardLayout, type DrawOp, type TextOp } from '../src/share-card';

const hole = (par: 3 | 4 | 5, driver: number, approach: number, putts: number, ob = 0, mulligan = 0, hazard = 0): Hole => ({ par, driver, approach, putts, ob, hazard, mulligan });
const tee = (h: Hole, tag: 'fairway' | 'left' | 'right' | 'far-right'): Hole => ({ ...h, tags: { driver: [tag] } });

/**
 * Everis 새별·레이크 (pars 4 4 5 3 4 4 3 5 4 | 4 3 4 4 5 5 3 4 4), every hole finished:
 * 41 (+5) out with an eagle on 8, 40 (+4) back, 81 (+9), 36 putts, GIR 9/18, fairways 5/8, one OB and one hazard.
 */
function fullRound(): Round {
  const r = newRound(new Date(2026, 10, 19));
  const holes: Hole[] = [
    tee(hole(4, 1, 2, 2), 'fairway'), tee(hole(4, 1, 1, 2), 'fairway'), tee(hole(5, 1, 1, 2), 'left'),
    tee(hole(3, 1, 0, 2), 'fairway'), tee(hole(4, 1, 2, 3), 'right'), hole(4, 2, 1, 1, 1),
    hole(3, 1, 1, 2), hole(5, 1, 1, 1), hole(4, 1, 3, 3),
    tee(hole(4, 1, 1, 2), 'fairway'), hole(3, 1, 0, 1), tee(hole(4, 1, 2, 2), 'fairway'),
    hole(4, 1, 1, 2, 0, 1, 1), tee(hole(5, 1, 2, 2), 'far-right'), hole(5, 1, 3, 2),
    hole(3, 1, 0, 2), hole(4, 1, 2, 3), tee(hole(4, 1, 1, 2), 'fairway'),
  ];
  holes.forEach((h, i) => (r.holes[i] = h));
  r.current = 17;
  return r;
}

/** Pars everywhere except the given hole scores (index → strokes as driver 1, approaches, 2 putts or a 1-putt). */
function roundWith(scores: Record<number, number>, current = 17): Round {
  const r = newRound(new Date(2026, 10, 19));
  r.holes = r.holes.map((x, i) => {
    const s = scores[i] ?? x.par;
    return s - 2 >= 1 ? hole(x.par, 1, s - 3, 2) : hole(x.par, 1, 0, s - 1);
  });
  r.current = current;
  return r;
}

/** Only holes [from, to) recorded (pars), the rest left blank. */
function partRound(from: number, to: number, current = to - 1): Round {
  const r = newRound(new Date(2026, 10, 19));
  for (let i = from; i < to; i++) r.holes[i] = hole(r.holes[i].par, 1, r.holes[i].par - 3, 2);
  r.current = current;
  return r;
}

function flat(ops: DrawOp[]): DrawOp[] {
  return ops.flatMap((op) => (op.kind === 'group' ? [op, ...flat(op.ops)] : [op]));
}
const find = (ops: DrawOp[], id: string) => flat(ops).find((op) => op.id === id);
const text = (ops: DrawOp[], id: string) => {
  const op = find(ops, id);
  expect(op?.kind, id).toBe('text');
  return op as TextOp;
};
const ids = (ops: DrawOp[]) => flat(ops).map((op) => op.id).filter((id): id is string => !!id);
const shapes = (op: DrawOp | undefined) => (op?.kind === 'group' ? op.ops.map((o) => o.kind) : []);

describe('share card content', () => {
  it('takes every number from the round analysis, as the round summary shows it', () => {
    const r = fullRound();
    const a = analyze(r);
    const c = shareCardContent(r);
    expect(c.course).toBe('에버리스 골프리조트');
    expect(c.nines).toBe('새별 · 레이크');
    expect(c.date).toBe('2026년 11월 19일');
    expect(c.total).toBe(String(a.totals.strokes));
    expect(c.total).toBe('81');
    expect(c.toPar).toBe('+9');
    expect(c.tone).toBe('over');
    expect(c.count).toBe('18홀');
    expect(c.par).toBe('파 72');
    expect(c.halves).toEqual([
      { label: '전반', strokes: '41', toPar: '+5' },
      { label: '후반', strokes: '40', toPar: '+4' },
    ]);
    expect(c.stats).toEqual([
      { key: 'putts', label: '퍼트', value: '36', sub: '홀당 2.0' },
      { key: 'gir', label: '그린 적중', value: '9/18', sub: '50%' },
      // Par 4 and 5 tee shots with a 상세 result only; the par 3's tag does not count.
      { key: 'fairway', label: '페어웨이', value: '5/8', sub: '63%' },
      { key: 'penalty', label: '벌타', value: 'OB 1', sub: '해저드 1' },
      { key: 'best', label: '베스트 홀', value: '8번 홀', sub: '이글' },
    ]);
  });

  it('lays the scorecard out by nine, each hole with its par, score and mark', () => {
    const c = shareCardContent(fullRound());
    expect(c.nine).toBeNull();
    expect(c.scorecard.map((n) => [n.title, n.label, n.par, n.strokes])).toEqual([['새별', '전반', 36, '41'], ['레이크', '후반', 36, '40']]);
    expect(c.scorecard.map((n) => [n.toPar, n.tone, n.putts])).toEqual([['+5', 'over', '18'], ['+4', 'over', '18']]);
    const marks = c.scorecard.flatMap((n) => n.holes.map((x) => x.mark));
    expect(marks).toEqual(['bogey', 'par', 'birdie', 'par', 'double', 'bogey', 'bogey', 'eagle', 'triple', 'par', 'birdie', 'bogey', 'bogey', 'par', 'bogey', 'par', 'double', 'par']);
    expect(c.scorecard[1].holes[0]).toEqual({ hole: 10, par: 4, score: 4, putts: 2, mark: 'par', tone: 'par' });
    expect(c.scorecard[0].holes[7]).toEqual({ hole: 8, par: 5, score: 3, putts: 1, mark: 'eagle', tone: 'under' });
  });

  it('reads under par, even and a round with nothing recorded', () => {
    expect(shareCardContent(roundWith({ 2: 4, 10: 2 }))).toMatchObject({ total: '70', toPar: '−2', tone: 'under' });
    expect(shareCardContent(roundWith({ 2: 4, 9: 5 }))).toMatchObject({ total: '72', toPar: '이븐', tone: 'par' });
    const empty = shareCardContent(newRound(new Date(2026, 10, 19)));
    expect(empty).toMatchObject({ total: '–', toPar: '', tone: 'none', count: '기록한 홀이 없어요', par: '' });
    expect(empty.scorecard.flatMap((n) => n.holes).every((x) => x.score === null && x.mark === null && x.putts === null)).toBe(true);
    expect(empty.scorecard.map((n) => [n.strokes, n.toPar, n.tone, n.putts])).toEqual([['–', '', null, '–'], ['–', '', null, '–']]);
    expect(empty.halves).toEqual([{ label: '전반', strokes: '–', toPar: '' }, { label: '후반', strokes: '–', toPar: '' }]);
    expect(empty.stats.map((s) => [s.value, s.sub])).toEqual([['0', ''], ['–', ''], ['–', '기록 없음'], ['OB 0', '해저드 0'], ['–', '']]);
  });

  it('counts only finished holes and leaves the rest of the card empty', () => {
    // Holes 1–12 recorded, 13 being played without a putt yet, 14–18 blank.
    const r = partRound(0, 12, 12);
    r.holes[12] = hole(4, 1, 1, 0);
    const c = shareCardContent(r);
    expect(c.count).toBe('12/18홀');
    expect(c.total).toBe(String(analyze(r).totals.strokes));
    // Against the par of the twelve finished holes only, as analyze() counts it.
    expect(c.par).toBe('파 47');
    expect(c.halves).toEqual([{ label: '전반', strokes: '36', toPar: '이븐' }, { label: '후반', strokes: '11', toPar: '이븐' }]);
    expect(c.scorecard.map((n) => [n.strokes, n.toPar, n.tone, n.putts])).toEqual([['36', '이븐', 'par', '18'], ['11', '이븐', 'par', '6']]);
    const back = c.scorecard[1].holes;
    expect(back[2]).toEqual({ hole: 12, par: 4, score: 4, putts: 2, mark: 'par', tone: 'par' });
    expect(back[3]).toEqual({ hole: 13, par: 4, score: null, putts: null, mark: null, tone: null });
    expect(back[8]).toEqual({ hole: 18, par: 4, score: null, putts: null, mark: null, tone: null });
  });

  it('shows a 9-hole round as its own nine, without the 전반/후반 lines', () => {
    const front = shareCardContent(partRound(0, 9));
    expect(front.nine).toBe('front');
    expect(front.nines).toBe('새별 9홀');
    expect(front.count).toBe('9홀');
    expect(front.par).toBe('파 36');
    expect(front.halves).toEqual([]);
    expect(front.scorecard.map((n) => n.title)).toEqual(['새별']);
    expect(front.scorecard[0].holes.map((x) => x.hole)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const back = shareCardContent(partRound(9, 18));
    expect(back.nine).toBe('back');
    expect(back.nines).toBe('레이크 9홀');
    expect(back.scorecard.map((n) => n.title)).toEqual(['레이크']);
    expect(back.scorecard[0].holes.map((x) => x.hole)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(back.total).toBe('36');
    expect(back.toPar).toBe('이븐');
  });

  it('names a typed course without nines, and old rounds as Everis', () => {
    const typed = newRound(new Date(2026, 10, 19), { course: { id: null, name: '동네 골프장', front: '', back: '' }, pars: Array(18).fill(4) });
    const c = shareCardContent(typed);
    expect(c.course).toBe('동네 골프장');
    expect(c.nines).toBe('');
    expect(c.scorecard.map((n) => n.title)).toEqual(['전반 9홀', '후반 9홀']);
    const { course: _, ...old } = fullRound();
    expect(shareCardContent(old as Round).course).toBe('에버리스 골프리조트');
  });

  it('names the file after the round date', () => {
    expect(shareCardFileName(fullRound())).toBe('fairway-note-2026-11-19.png');
  });
});

describe('share card layout', () => {
  it('is a 1080×1350 card whose text stays inside its box', () => {
    for (const r of [fullRound(), partRound(0, 9), newRound(new Date(2026, 10, 19))]) {
      const layout = shareCardLayout(r);
      expect([layout.width, layout.height]).toEqual([1080, 1350]);
      expect(SHARE_CARD_SIZE).toEqual({ width: 1080, height: 1350 });
      for (const op of flat(layout.ops)) {
        if (op.kind !== 'text') continue;
        expect(op.text, op.id).not.toBe('');
        expect(op.width, op.id).toBeLessThanOrEqual(op.maxWidth + 0.01);
        const left = op.align === 'left' ? op.x : op.align === 'center' ? op.x - op.width / 2 : op.x - op.width;
        expect(left, op.id).toBeGreaterThanOrEqual(0);
        expect(left + op.width, op.id).toBeLessThanOrEqual(1080);
        expect(op.y, op.id).toBeGreaterThan(0);
        expect(op.y, op.id).toBeLessThan(1350);
      }
    }
  });

  it('puts the course, date, total and score against par in the hero', () => {
    const { ops } = shareCardLayout(fullRound());
    expect(text(ops, 'course').text).toBe('에버리스 골프리조트');
    expect(text(ops, 'nines').text).toBe('새별 · 레이크');
    expect(text(ops, 'date').text).toBe('2026년 11월 19일');
    expect(text(ops, 'total').text).toBe('81');
    expect(text(ops, 'to-par').text).toBe('+9');
    expect(text(ops, 'wordmark').text).toBe('Fairway Note');
    expect(text(ops, 'total').size).toBeGreaterThan(text(ops, 'course').size * 3);
  });

  it('marks the score against par the way the scorecard marks a hole: a circle under, nothing at even, a square over', () => {
    expect(shapes(find(shareCardLayout(fullRound()).ops, 'to-par-mark'))).toEqual(['rect']);
    const under = shareCardLayout(roundWith({ 2: 4, 10: 2 })).ops;
    expect(shapes(find(under, 'to-par-mark'))).toEqual(['circle']);
    expect(find(under, 'to-par-mark')!.kind === 'group' && (find(under, 'to-par-mark') as { ops: DrawOp[] }).ops[0]).toMatchObject({ fill: '#C0392B' });
    const even = shareCardLayout(roundWith({ 2: 4, 9: 5 })).ops;
    expect(find(even, 'to-par-mark')).toBeUndefined();
    expect(text(even, 'to-par').text).toBe('이븐');
    const empty = shareCardLayout(newRound(new Date(2026, 10, 19))).ops;
    expect(find(empty, 'to-par-mark')).toBeUndefined();
    expect(text(empty, 'total').text).toBe('–');
  });

  it('draws all 18 holes with golf scorecard marks in the app colours', () => {
    const { ops } = shareCardLayout(fullRound());
    for (let n = 1; n <= 18; n++) expect(find(ops, `hole-${n}`), `hole ${n}`).toBeDefined();
    expect(text(ops, 'hole-3-score')).toMatchObject({ text: '4', color: '#C0392B' });
    expect(shapes(find(ops, 'hole-3-mark'))).toEqual(['circle']);
    expect(shapes(find(ops, 'hole-8-mark'))).toEqual(['circle', 'circle']);
    expect(text(ops, 'hole-2-score')).toMatchObject({ text: '4', color: '#2F7D3A' });
    expect(find(ops, 'hole-2-mark')).toBeUndefined();
    expect(text(ops, 'hole-1-score')).toMatchObject({ text: '5', color: '#17301A' });
    expect(shapes(find(ops, 'hole-1-mark'))).toEqual(['rect']);
    expect(shapes(find(ops, 'hole-5-mark'))).toEqual(['rect', 'rect']);
    // Triple bogey or worse: a filled square with the number in white.
    expect(shapes(find(ops, 'hole-9-mark'))).toEqual(['rect']);
    expect(text(ops, 'hole-9-score')).toMatchObject({ text: '7', color: '#FFFFFF' });
    expect(text(ops, 'hole-11-par').text).toBe('3');
    expect(text(ops, 'sub-front').text).toBe('41');
    expect(text(ops, 'sub-back').text).toBe('40');
    expect(text(ops, 'nine-front-title').text).toBe('새별');
    expect(text(ops, 'nine-back-title').text).toBe('레이크');
  });

  it('leaves unfinished holes blank, with no mark', () => {
    const r = partRound(0, 12, 12);
    r.holes[12] = hole(4, 1, 1, 0);
    const { ops } = shareCardLayout(r);
    expect(text(ops, 'hole-13-score').text).toBe('–');
    expect(find(ops, 'hole-13-mark')).toBeUndefined();
    expect(text(ops, 'hole-18-score').text).toBe('–');
    expect(text(ops, 'hole-13-par').text).toBe('4');
    expect(text(ops, 'count').text).toBe('12/18홀');
  });

  it('shows the stats under the scorecard', () => {
    const { ops } = shareCardLayout(fullRound());
    expect(['putts', 'gir', 'fairway', 'penalty', 'best'].map((k) => [text(ops, `stat-${k}-label`).text, text(ops, `stat-${k}-value`).text])).toEqual([
      ['퍼트', '36'], ['그린 적중', '9/18'], ['페어웨이', '5/8'], ['벌타', 'OB 1'], ['베스트 홀', '8번 홀'],
    ]);
    expect(text(ops, 'half-front').text).toBe('41');
    expect(text(ops, 'half-back').text).toBe('40');
  });

  it('draws only the nine a 9-hole round was played on', () => {
    const front = ids(shareCardLayout(partRound(0, 9)).ops);
    expect(front).toContain('hole-9');
    expect(front).not.toContain('hole-10');
    expect(front).not.toContain('nine-back-title');
    expect(front).not.toContain('half-front');
    const back = ids(shareCardLayout(partRound(9, 18)).ops);
    expect(back).toContain('hole-10');
    expect(back).toContain('hole-18');
    expect(back).not.toContain('hole-9');
    expect(back).not.toContain('nine-front-title');
  });

  it('has room for putts per hole on a single nine, and keeps the stats where an 18-hole card has them', () => {
    const nine = shareCardLayout(partRound(0, 9)).ops;
    expect(text(nine, 'hole-3-putts').text).toBe('2');
    expect(text(nine, 'sub-front-putts').text).toBe('18');
    const full = shareCardLayout(fullRound()).ops;
    expect(ids(full).some((id) => id.endsWith('-putts'))).toBe(false);
    expect(text(nine, 'stat-putts-label').y).toBe(text(full, 'stat-putts-label').y);
    expect(text(nine, 'wordmark').y).toBe(text(full, 'wordmark').y);
  });

  it('says what the total counts beside the mark', () => {
    const { ops } = shareCardLayout(fullRound());
    expect(text(ops, 'count').text).toBe('18홀');
    expect(text(ops, 'hero-par').text).toBe('· 파 72');
    expect(text(ops, 'half-front-label').text).toBe('전반');
    expect(text(ops, 'half-front-par').text).toBe('+5');
    // Beside the mark, not under the total.
    expect(text(ops, 'count').x).toBeGreaterThan(text(ops, 'to-par').x);
  });

  it('heads each nine with its name and 전반/후반, once', () => {
    expect(text(shareCardLayout(fullRound()).ops, 'nine-front-label').text).toBe('전반');
    const typed = newRound(new Date(2026, 10, 19), { course: { id: null, name: '동네 골프장', front: '', back: '' }, pars: Array(18).fill(4) });
    const ops = shareCardLayout(typed).ops;
    expect(text(ops, 'nine-front-title').text).toBe('전반 9홀');
    expect(find(ops, 'nine-front-label')).toBeUndefined();
    expect(find(ops, 'nines')).toBeUndefined();
  });

  it('fits a long course name typed by hand', () => {
    const name = '아주 길게 직접 입력한 골프장 이름이 사십 자까지 들어가는 경우를 봅니다';
    const r = newRound(new Date(2026, 10, 19), { course: { id: null, name, front: '', back: '' }, pars: Array(18).fill(4) });
    const course = text(shareCardLayout(r).ops, 'course');
    expect(course.width).toBeLessThanOrEqual(1080 - 2 * 72);
    expect(course.text === name || course.text.endsWith('…')).toBe(true);
    expect(course.size).toBeLessThan(text(shareCardLayout(fullRound()).ops, 'course').size);
  });

  it('measures text with the given function, as the canvas does in the browser', () => {
    const wide = shareCardLayout(fullRound(), (t, size) => t.length * size * 2);
    const course = text(wide.ops, 'course');
    expect(course.width).toBeLessThanOrEqual(course.maxWidth);
    expect(course.width).toBe(course.text.length * course.size * 2);
  });
});

describe('scorecard marks', () => {
  it('uses a double circle for an eagle, a circle for a birdie, nothing for par, squares for bogeys', () => {
    expect(markShapes('eagle', 50, 50, 60, '#C0392B').map((o) => o.kind)).toEqual(['circle', 'circle']);
    expect(markShapes('birdie', 50, 50, 60, '#C0392B').map((o) => o.kind)).toEqual(['circle']);
    expect(markShapes('par', 50, 50, 60, '#2F7D3A')).toEqual([]);
    expect(markShapes('bogey', 50, 50, 60, '#17301A').map((o) => o.kind)).toEqual(['rect']);
    expect(markShapes('double', 50, 50, 60, '#17301A').map((o) => o.kind)).toEqual(['rect', 'rect']);
    const triple = markShapes('triple', 50, 50, 60, '#17301A');
    expect(triple).toHaveLength(1);
    expect(triple[0]).toMatchObject({ kind: 'rect', fill: '#17301A' });
  });

  it('keeps every mark inside its box, centred on the point', () => {
    for (const mark of ['eagle', 'birdie', 'bogey', 'double', 'triple'] as const) {
      for (const op of markShapes(mark, 100, 200, 60, '#17301A')) {
        if (op.kind === 'circle') {
          expect([op.cx, op.cy]).toEqual([100, 200]);
          expect(op.r + (op.lineWidth ?? 0) / 2).toBeLessThanOrEqual(30);
        } else if (op.kind === 'rect') {
          expect(op.x + op.w / 2).toBeCloseTo(100);
          expect(op.y + op.h / 2).toBeCloseTo(200);
          expect(op.w + (op.lineWidth ?? 0)).toBeLessThanOrEqual(60);
        }
      }
    }
  });
});
