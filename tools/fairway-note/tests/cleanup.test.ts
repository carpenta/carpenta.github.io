// v29, the first design clean-up: one voice (해요체) in every sentence the app writes, advice on the page that adds to
// the tiles instead of repeating them, rates only from three or more, and the score badge's word in numbers past +3.
import { describe, expect, it } from 'vitest';
import { analyze, badgeWord, newRound, type Hole, type Round } from '../src/round';
import { adviceLines, detailLines, insights, rateSub, reportText } from '../src/report';

const hole = (par: 3 | 4 | 5, driver: number, approach: number, putts: number, extra: Partial<Hole> = {}): Hole =>
  ({ par, driver, approach, putts, ob: 0, hazard: 0, mulligan: 0, bunker: 0, ...extra });

function roundOf(list: Hole[]): Round {
  const r = newRound(new Date(2026, 10, 21));
  list.forEach((h, i) => (r.holes[i] = h));
  r.current = list.length;
  return r;
}

/** A round that says everything: 3 putts, OB and a hazard, a mulligan, tagged short putts and a whiff, split holes. */
const busy = roundOf([
  hole(4, 2, 2, 3, { ob: 1, mulligan: 1, tags: { driver: ['whiff'], putts: ['short', 'short'] } }),
  hole(4, 1, 2, 2, { hazard: 1, short: 1, tags: { putts: ['short'] } }),
  hole(5, 1, 3, 1, { short: 1 }),
  hole(3, 1, 1, 2),
]);

describe('one voice on the page (v29)', () => {
  it('gives the page its advice and shot details in 해요체, and leaves the outgoing report formal as decided in v23', () => {
    const a = analyze(busy);
    const page = [...adviceLines(a), ...detailLines(a, true)];
    expect(page.length).toBeGreaterThan(4);
    for (const line of page) expect(line, line).not.toMatch(/습니다|입니다/);
    expect(detailLines(a, true)).toContain('퍼트가 짧았던 적이 3번, 길었던 적이 0번이에요. 홀을 지나가게 쳐 보세요.');
    // The report and email keep their formal sentences.
    expect(insights(a)).toContain('3퍼트 이상이 1홀 있습니다. 첫 퍼트 거리감을 맞추면 바로 줄일 수 있는 타수입니다.');
    expect(detailLines(a)).toContain('퍼트가 짧았던 적이 3번, 길었던 적이 0번입니다. 홀을 지나가게 쳐 보세요.');
    expect(reportText(busy)).toContain('[샷 세부]');
  });
});

describe('advice on the page (v29)', () => {
  it('keeps only what the tiles and the lost strokes do not already say', () => {
    const advice = adviceLines(analyze(busy));
    expect(advice).toEqual([
      '3퍼트 이상이 1홀 있어요. 첫 퍼트 거리감을 맞추면 바로 줄일 수 있어요.',
      'OB 1회·해저드 1회로 벌타 2타가 더해졌어요. 다시 친 샷까지 치면 OB 하나에 보통 2타를 잃어요.',
      '멀리건 1회를 썼어요. 멀리건 없이 쳤다면 스코어가 더 나왔을 수 있어요.',
    ]);
    for (const line of advice) expect(line).not.toMatch(/가장 많이 잃|GIR|그린 적중|업앤다운|상세로 나눈|기준 타수/);
    expect(adviceLines(analyze(roundOf([hole(4, 1, 1, 2)])))).toEqual([]);
  });
});

describe('rates (v29)', () => {
  it('says a percent only from three or more', () => {
    expect(rateSub(1, 1)).toBe('');
    expect(rateSub(1, 2)).toBe('');
    expect(rateSub(2, 3)).toBe('67%');
    expect(rateSub(0, 0)).toBe('');
  });
});

describe('the score badge (v29)', () => {
  it('names 이글 to 더블 in words and the rest as the score against par, as a scorecard reads it', () => {
    expect([badgeWord(1, 3), badgeWord(1, 5), badgeWord(2, 5), badgeWord(3, 5), badgeWord(3, 4), badgeWord(4, 4), badgeWord(5, 4)]).toEqual(['홀인원', '홀인원', '−3', '이글', '버디', '파', '보기']);
    expect([badgeWord(6, 4), badgeWord(7, 4), badgeWord(8, 4), badgeWord(9, 4), badgeWord(10, 3)]).toEqual(['더블', '+3', '+4', '+5', '+7']);
  });

  it('never says more than two syllables under the number, so the word fits the 60px ring with 큰 글씨 too', () => {
    for (const par of [3, 4, 5]) {
      for (let strokes = 1; strokes <= 15; strokes += 1) {
        const word = badgeWord(strokes, par);
        // 홀인원 is the one word shown alone, in place of the number (main.ts).
        if (strokes === 1) continue;
        const syllables = word.match(/[가-힣]/g)?.length ?? 0;
        expect(syllables === 0 ? /^[+−]\d{1,2}$/.test(word) : syllables <= 2, `${strokes} on a par ${par}: ${word}`).toBe(true);
      }
    }
  });
});
