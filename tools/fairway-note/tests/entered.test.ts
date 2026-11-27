import { describe, expect, it } from 'vitest';
import { COURSE_PARS, DEFAULT_COURSE, analyze, enteredRound, finished } from '../src/round';
import { parseRound } from '../src/storage';
import { historyCsv } from '../src/report';
import type { Entry } from '../src/history';

// v44 (the user's calls): a past round entered as strokes per hole only, kept in the saved format (version 1) with
// `entered: true`; its stats count strokes and results only, never putts, greens in regulation or penalties.
const setup = { course: DEFAULT_COURSE, pars: COURSE_PARS };
const bogeyGolf = COURSE_PARS.map((p) => p + 1);

describe('an entered round (v44)', () => {
  it('is a finished round on its date, each hole\'s strokes kept as one count', () => {
    const r = enteredRound('2026-11-20', setup, bogeyGolf);
    expect(r).toMatchObject({ version: 1, date: '2026-11-20', entered: true, closed: true, current: 17 });
    expect(r.holes.map((h) => h.par)).toEqual([...COURSE_PARS]);
    expect(r.holes[0]).toMatchObject({ driver: 0, approach: bogeyGolf[0], putts: 0, ob: 0, hazard: 0 });
    expect(r.holes.every((_, i) => finished(r, i))).toBe(true);
  });

  it('round-trips through the saved form, and a non-true value is not an entered round', () => {
    const r = enteredRound('2026-11-20', setup, bogeyGolf);
    expect(parseRound(JSON.stringify(r))).toEqual(r);
    const odd = parseRound(JSON.stringify({ ...r, entered: 'yes' }));
    expect(odd?.entered).toBeUndefined();
  });

  it('counts strokes and results, and says it has no putts, greens or penalties to count', () => {
    const a = analyze(enteredRound('2026-11-20', setup, bogeyGolf));
    expect(a.entered).toBe(true);
    expect(a.totals.strokes).toBe(COURSE_PARS.reduce((s, p) => s + p + 1, 0));
    expect(a.toPar).toBe(18);
    expect(a.totals.holes).toBe(18);
    expect(analyze(enteredRound('2026-11-20', setup, [...COURSE_PARS])).toPar).toBe(0);
  });

  it('refuses strokes that do not fit the course: a wrong count of holes, or a hole under one stroke', () => {
    expect(() => enteredRound('2026-11-20', setup, bogeyGolf.slice(0, 17))).toThrow();
    expect(() => enteredRound('2026-11-20', setup, [0, ...bogeyGolf.slice(1)])).toThrow();
  });
});

describe('every round as one CSV (v44)', () => {
  it('has a row per finished hole with the date, course and nines, and marks the entered rounds', () => {
    const entries: Entry[] = [
      { id: 'a', endedAt: Date.parse('2026-11-20T18:00:00'), round: enteredRound('2026-11-20', setup, bogeyGolf) },
    ];
    const lines = historyCsv(entries).trimEnd().split('\r\n');
    expect(lines[0]).toBe('날짜,코스,전반,후반,홀,파,타수,퍼트,OB,해저드,넣은 기록');
    expect(lines).toHaveLength(1 + 18);
    expect(lines[1]).toBe(`2026-11-20,${DEFAULT_COURSE.name},${DEFAULT_COURSE.front},${DEFAULT_COURSE.back},1,${COURSE_PARS[0]},${bogeyGolf[0]},,,,예`);
  });

  it('quotes a course name with a comma', () => {
    const r = enteredRound('2026-11-20', { course: { id: null, name: '동네, 골프장', front: '', back: '' }, pars: COURSE_PARS }, bogeyGolf);
    const lines = historyCsv([{ id: 'b', endedAt: 1, round: r }]).split('\r\n');
    expect(lines[1].startsWith('2026-11-20,"동네, 골프장",,,1,')).toBe(true);
  });
});

// v47 (the user's call): an entered round reports what was entered (strokes, to-par, each
// hole's strokes, and what follows from strokes alone) and says plainly that the rest was not recorded. It never shows
// or sends a count it does not have: no putts, OB, mulligans, greens or strokes lost by area.
describe('what an entered round reports (v47)', () => {
  const r = enteredRound('2026-11-20', setup, bogeyGolf);
  const NEVER = ['퍼트 0', '퍼0', '평균 퍼트', '1퍼트', '3퍼트', '그린 적중', '가장 많이 잃은', 'OB 0', '멀리건 0', '드0', '그5', '[잃은 타수]'];
  const firstHole = `1번 Par${COURSE_PARS[0]}: ${COURSE_PARS[0] + 1}타 (+1)`;

  it('shares strokes, to-par and each hole\'s strokes, and says the details were not recorded', async () => {
    const { reportText } = await import('../src/report');
    const text = reportText(r);
    expect(text).toContain('총 90타 (+18) · 18/18홀');
    expect(text).toContain('전반 45타 · 후반 45타');
    expect(text).toContain(firstHole);
    expect(text).toContain('홀별 타수만 넣은 기록입니다. 퍼트·벌타·샷은 기록하지 않았습니다.');
    expect(text).toContain('분포: 보기 18');
    for (const never of NEVER) expect(text, never).not.toContain(never);
  });

  it('writes the analysis text from strokes alone', async () => {
    const { analysisText } = await import('../src/report');
    const text = analysisText(r);
    expect(text).toContain('[홀별] 홀 | 파 | 타수 | 파 대비');
    expect(text).toContain(`1 | ${COURSE_PARS[0]} | ${COURSE_PARS[0] + 1} | +1`);
    expect(text).toContain('타수 90 (+18)');
    expect(text).toContain('홀별 타수만 넣은 기록입니다.');
    for (const never of NEVER) expect(text, never).not.toContain(never);
  });

  it('draws the share card without putts or greens: the best hole and a word that it is an entered round', async () => {
    const { shareCardContent } = await import('../src/share-card');
    const c = shareCardContent(r);
    expect(c.total).toBe('90');
    expect(c.scorecard.flatMap((n) => n.holes).every((x) => x.score !== null && x.putts === null)).toBe(true);
    expect(c.scorecard.map((n) => n.putts)).toEqual(['–', '–']);
    expect(c.stats.map((s) => s.key)).toEqual(['best', 'entered']);
    expect(c.stats[1]).toMatchObject({ label: '넣은 기록', value: '타수만', sub: '퍼트·벌타 없음' });
  });

  it('leaves a round recorded hole by hole as it was: putts, greens and the areas', async () => {
    const { reportText, analysisText } = await import('../src/report');
    const { shareCardContent } = await import('../src/share-card');
    const { newRound } = await import('../src/round');
    const base = newRound(new Date(2026, 10, 10));
    const rec = { ...base, current: 17, closed: true as const, holes: base.holes.map((h) => ({ ...h, driver: 1, approach: h.par - 2, putts: 2 })) };
    expect(reportText(rec)).toContain('퍼트 36 · OB 0 · 멀리건 0');
    expect(reportText(rec)).toContain('평균 퍼트 2.0개');
    expect(reportText(rec)).not.toContain('홀별 타수만');
    expect(analysisText(rec)).toContain('[잃은 타수]');
    expect(shareCardContent(rec).stats.map((s) => s.key)).toEqual(['putts', 'gir', 'fairway', 'penalty', 'best']);
  });
});

describe('trends with entered rounds (v44)', () => {
  it('average strokes over every full round, and putts, greens and OB over the recorded ones only; the line marks the entered', async () => {
    const { newRound } = await import('../src/round');
    const { trends } = await import('../src/history');
    const base = newRound(new Date(2026, 10, 10));
    const recorded = { ...base, date: '2026-11-10', current: 17, closed: true as const, holes: base.holes.map((h) => ({ ...h, driver: 1, approach: h.par - 3, putts: 2 })) };
    const entered = enteredRound('2026-11-20', setup, bogeyGolf);
    const t = trends([
      { id: 'r', endedAt: Date.parse('2026-11-10T18:00:00'), round: recorded },
      { id: 'e', endedAt: Date.parse('2026-11-20T18:00:00'), round: entered },
    ]);
    expect(t.all?.strokes).toBe((72 + 90) / 2);
    expect(t.all?.putts).toBe(36);
    expect(t.all?.recorded).toBe(1);
    expect(t.series).toEqual([72, 90]);
    expect(t.entered).toEqual([false, true]);
  });
});
