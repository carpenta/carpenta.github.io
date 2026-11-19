import { describe, expect, it } from 'vitest';
import { newRound, type Hole } from '../src/round';
import { dateLabel, mailtoHref, reportSubject, reportText } from '../src/report';

const hole = (par: 3 | 4 | 5, driver: number, approach: number, putts: number, ob = 0, mulligan = 0): Hole => ({ par, driver, approach, putts, ob, mulligan });

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
    expect(reportSubject(sample())).toBe('에버리스 동코스 2026년 11월 19일 라운드 18타 (+2)');
    expect(reportSubject(newRound(new Date(2026, 10, 19)))).toBe('에버리스 동코스 2026년 11월 19일 라운드');
  });

  it('lists finished holes and the analysis', () => {
    const text = reportText(sample());
    expect(text.split('\n').slice(0, 4)).toEqual([
      '에버리스 동코스 · 2026년 11월 19일',
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

  it('says when nothing is finished', () => {
    expect(reportText(newRound(new Date(2026, 10, 19)))).toBe('에버리스 동코스 · 2026년 11월 19일\n\n아직 끝낸 홀이 없습니다.');
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
