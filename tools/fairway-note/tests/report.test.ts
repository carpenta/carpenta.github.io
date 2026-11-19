import { describe, expect, it } from 'vitest';
import { newRound, type Hole } from '../src/round';
import { analysisText, csvName, dateLabel, mailtoHref, reportSubject, reportText, roundCsv } from '../src/report';

const hole = (par: 3 | 4 | 5, driver: number, approach: number, putts: number, ob = 0, mulligan = 0, hazard = 0): Hole => ({ par, driver, approach, putts, ob, hazard, mulligan });

function sample() {
  const r = newRound(new Date(2026, 10, 19));
  r.holes[0] = hole(4, 1, 1, 2);
  r.holes[1] = hole(4, 2, 1, 3, 1, 1);
  r.holes[2] = hole(3, 1, 0, 1);
  r.holes[10] = hole(5, 1, 2, 2);
  r.holes[11] = hole(4, 1, 0, 0); // being played, no putt yet
  r.current = 11;
  return r;
}

describe('report', () => {
  it('labels the date in Korean', () => {
    expect(dateLabel('2026-01-05')).toBe('2026년 1월 5일');
  });

  it('puts the score in the subject', () => {
    expect(reportSubject(sample())).toBe('에버리스 골프리조트 새별·레이크 2026년 11월 19일 라운드 18타 (+2)');
    expect(reportSubject(newRound(new Date(2026, 10, 19)))).toBe('에버리스 골프리조트 새별·레이크 2026년 11월 19일 라운드');
  });

  it('lists finished holes and the analysis', () => {
    const text = reportText(sample());
    expect(text.split('\n').slice(0, 4)).toEqual([
      '에버리스 골프리조트 새별·레이크 · 2026년 11월 19일',
      '총 18타 (+2) · 4/18홀',
      '전반 13타 · 후반 5타',
      '퍼트 8 · OB 1 · 멀리건 1',
    ]);
    expect(text).toContain('1번 Par4: 4타 (E) 드1 어1 퍼2');
    expect(text).toContain('2번 Par4: 7타 (+3) 드2 어1 퍼3 OB 1 멀리건 1');
    expect(text).toContain('3번 Par3: 2타 (-1) 드1 어0 퍼1');
    expect(text).toContain('11번 Par5: 5타 (E) 드1 어2 퍼2');
    expect(text).not.toContain('12번');
    expect(text).toContain('[분석]');
    expect(text).toContain('분포: 버디 1 · 파 2 · 트리플 이상 1');
    expect(text).toContain('- 3퍼트 이상이 1홀 있습니다.');
  });

  it('lists hazard drops next to OB and counts both as penalty strokes', () => {
    const r = newRound(new Date(2026, 10, 19));
    r.holes[0] = hole(4, 1, 1, 2, 1, 0, 1);
    r.holes[1] = hole(5, 1, 2, 2, 0, 1, 2);
    r.current = 2;
    const text = reportText(r);
    expect(text).toContain('1번 Par4: 6타 (+2) 드1 어1 퍼2 OB 1 해저드 1');
    expect(text).toContain('2번 Par5: 7타 (+2) 드1 어2 퍼2 해저드 2 멀리건 1');
    expect(text.split('\n')[3]).toBe('퍼트 4 · OB 1 · 해저드 3 · 멀리건 1');
    expect(text).toContain('[홀별] 타수 = 드라이버 + 어프로치 + 퍼트 + 벌타(OB·해저드)');
    expect(text).toContain('- OB 1회·해저드 3회로 벌타 4타가 더해졌습니다.');
    expect(text).toContain('가장 많이 잃은 곳은 벌타입니다 (+4타)');
    const hazardOnly = newRound(new Date(2026, 10, 19));
    hazardOnly.holes[0] = hole(4, 1, 1, 2, 0, 0, 1);
    hazardOnly.current = 1;
    expect(reportText(hazardOnly)).toContain('- 해저드 1회로 벌타 1타가 더해졌습니다.');
    expect(reportText(hazardOnly)).not.toContain('OB 하나에');
  });

  it('names the round course, and Everis 새별·레이크 for rounds saved without one', () => {
    const r = newRound(new Date(2026, 10, 19), { course: { id: null, name: '동네 골프장', front: '', back: '' }, pars: Array(18).fill(4) });
    expect(reportSubject(r)).toBe('동네 골프장 2026년 11월 19일 라운드');
    expect(reportText(r).split('\n')[0]).toBe('동네 골프장 · 2026년 11월 19일');
    const { course: _, ...old } = newRound(new Date(2026, 10, 19));
    expect(reportSubject(old)).toBe('에버리스 골프리조트 새별·레이크 2026년 11월 19일 라운드');
  });

  it('says when nothing is finished', () => {
    expect(reportText(newRound(new Date(2026, 10, 19)))).toBe('에버리스 골프리조트 새별·레이크 · 2026년 11월 19일\n\n아직 끝낸 홀이 없습니다.');
  });

  it('builds a mailto link with no recipient and the encoded report', () => {
    const r = sample();
    const href = mailtoHref(r);
    expect(href.startsWith('mailto:?subject=')).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get('subject')).toBe(reportSubject(r));
    expect(url.searchParams.get('body')).toBe(reportText(r));
  });
});

describe('a 9-hole round', () => {
  it('reads as one nine: "9홀" after the course, holes out of 9, no 전반·후반 line', () => {
    const r = newRound(new Date(2026, 10, 20), { course: { id: 'everis', name: '에버리스 골프리조트', front: '새별', back: '' }, pars: [4, 4, 5, 3, 4, 4, 3, 5, 4] });
    r.holes[0] = hole(4, 1, 1, 2);
    r.holes[1] = hole(4, 1, 2, 2);
    r.current = 2;
    expect(reportSubject(r)).toBe('에버리스 골프리조트 새별 9홀 2026년 11월 20일 라운드 9타 (+1)');
    const text = reportText(r);
    expect(text).toContain('에버리스 골프리조트 새별 9홀 · 2026년 11월 20일');
    expect(text).toContain('· 2/9홀');
    expect(text).not.toContain('전반');
  });
});

describe('CSV and analysis text', () => {
  it('writes one CSV row per hole, blank counts for holes not finished, and a 합계 over the finished ones', () => {
    const r = sample();
    const rows = roundCsv(r).split('\r\n');
    expect(rows[0]).toBe('홀,파,드라이버,어프로치,퍼트,OB,해저드,타수,파 대비');
    expect(rows[1]).toBe('1,4,1,1,2,0,0,4,0');
    expect(rows[2]).toBe('2,4,2,1,3,1,0,7,3');
    expect(rows[3]).toBe('3,3,1,0,1,0,0,2,-1');
    expect(rows[4]).toBe('4,3,,,,,,,');
    // Hole 12 is being played without a putt: not finished, so blank.
    expect(rows[12]).toBe('12,4,,,,,,,');
    expect(rows[19]).toBe('합계,16,5,4,8,1,0,18,2');
    expect(rows).toHaveLength(21);
    expect(rows[20]).toBe('');
    expect(csvName(r)).toBe('fairway-note-2026-11-19.csv');
  });

  it('copies the round as plain facts: course, nines, date, holes, totals and strokes lost, with no links', () => {
    const text = analysisText(sample());
    expect(text).toContain('골프장: 에버리스 골프리조트');
    expect(text).toContain('코스: 전반 새별 · 후반 레이크');
    expect(text).toContain('날짜: 2026-11-19');
    expect(text).toContain('기록한 홀: 4/18');
    expect(text).toContain('1 | 4 | 1 | 1 | 2 | 0 | 0 | 4 | E');
    expect(text).toContain('2 | 4 | 2 | 1 | 3 | 1 | 0 | 7 | +3');
    expect(text).toContain('4 | 3 | 기록 없음');
    expect(text).toContain('타수 18 (+2) · 퍼트 8 · OB 1 · 해저드 0');
    expect(text).toContain('전반 13타 (3홀) · 후반 5타 (1홀)');
    // Hole 2 (two drives, three putts, an OB) is where every lost stroke is; the approaches were all regulation.
    expect(text).toContain('티샷 +1 · 어프로치 +0 · 퍼트 +1 · 벌타 +1');
    expect(text).not.toMatch(/https?:|www\./);
  });
});
