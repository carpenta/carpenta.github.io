import { describe, expect, it } from 'vitest';
import { COURSES, distanceLabel, holeInfo, type Course } from '../src/courses';
import { holeArt, holeShape, layoutBend } from '../src/hole-art';
import type { RoundCourse } from '../src/round';

/** A course with notes on some holes of its first nine and none on its second. Synthetic: not bundled. */
const course: Course = {
  id: 'sample',
  name: { ko: '시험 골프장', en: null },
  area: '제주',
  region: '제주 제주시',
  source: 'https://example.test/course',
  checked: '2026-11-19',
  nines: [
    {
      id: 'east',
      name: { ko: '동', en: null },
      par: [4, 4, 5, 3, 4, 4, 3, 5, 4],
      holes: [
        { distances: [{ tee: '화이트', length: 352, unit: 'm' }, { tee: '레드', length: 301, unit: 'm' }], layout: '우 도그렉', guideUrl: 'https://example.test/course/east/1' },
        null,
        { layout: '  ', guideUrl: 'javascript:alert(1)', distances: [{ tee: '화이트', length: -3, unit: 'm' }] },
        { distances: [{ tee: 'White', length: 165, unit: 'yd' }] },
      ],
    },
    { id: 'west', name: { ko: '서', en: null }, par: [4, 4, 4, 4, 4, 4, 4, 4, 4] },
  ],
};
const round: RoundCourse = { id: 'sample', name: '시험 골프장', front: '동', back: '서' };

describe('hole notes', () => {
  it('finds a hole’s notes in the nine it is on', () => {
    expect(holeInfo(round, 0, [course])).toEqual({
      distances: [{ tee: '화이트', length: 352, unit: 'm' }, { tee: '레드', length: 301, unit: 'm' }],
      layout: '우 도그렉',
      guideUrl: 'https://example.test/course/east/1',
    });
    expect(holeInfo(round, 3, [course])).toEqual({ distances: [{ tee: 'White', length: 165, unit: 'yd' }] });
  });

  it('has none for a hole, nine or course without notes', () => {
    expect(holeInfo(round, 1, [course])).toBeNull();
    expect(holeInfo(round, 4, [course])).toBeNull();
    expect(holeInfo(round, 9, [course])).toBeNull();
    expect(holeInfo({ ...round, id: null }, 0, [course])).toBeNull();
    expect(holeInfo({ ...round, id: 'gone' }, 0, [course])).toBeNull();
    expect(holeInfo({ ...round, front: '없는 코스' }, 0, [course])).toBeNull();
  });

  it('leaves out a link that is not https, an empty note and a length that is not positive', () => {
    expect(holeInfo(round, 2, [course])).toBeNull();
  });

  it('reads the same nine for both halves when one nine is played twice', () => {
    expect(holeInfo({ ...round, back: '동' }, 9, [course])).toEqual(holeInfo(round, 0, [course]));
  });

  it('labels the length from the first tee listed', () => {
    expect(distanceLabel(holeInfo(round, 0, [course]))).toBe('화이트 352m');
    expect(distanceLabel(holeInfo(round, 3, [course]))).toBe('White 165yd');
    expect(distanceLabel({ layout: '우 도그렉' })).toBeNull();
    expect(distanceLabel(null)).toBeNull();
  });
});

describe('bundled hole notes', () => {
  it('come nine to a nine, with https links to the course’s own pages and positive lengths', () => {
    for (const c of COURSES) {
      for (const n of c.nines) {
        if (n.holes === undefined) continue;
        expect(n.holes, `${c.id}/${n.id}`).toHaveLength(9);
        for (const h of n.holes) {
          if (!h) continue;
          if (h.guideUrl !== undefined) {
            expect(h.guideUrl, c.id).toMatch(/^https:\/\/[^/]+\//);
            expect(h.guideUrl, c.id).not.toMatch(/golfpass|hole19|18birdies|golfingrecord|golfzon|smartscore|kakao|openstreetmap/);
          }
          for (const d of h.distances ?? []) {
            expect(d.length, c.id).toBeGreaterThan(0);
            expect(['m', 'yd'], c.id).toContain(d.unit);
          }
        }
      }
    }
  });
});

describe('drawn hole', () => {
  it('is short to the green on a par 3 and longer on a par 4, longest on a par 5', () => {
    const [p3, p4, p5] = ([3, 4, 5] as const).map((p) => holeShape(p, 0));
    expect(p3.fairway).toBeNull();
    const run = (s: typeof p4) => s.fairway!.y1 - s.fairway!.y2;
    expect(run(p5)).toBeGreaterThan(run(p4));
    expect(p3.green.cy).toBeGreaterThan(p4.green.cy);
    expect(p4.green.cy).toBeGreaterThan(p5.green.cy);
    expect(p3.tee.y).toBeGreaterThan(p3.green.cy);
  });

  it('bends for a dogleg named in the layout note', () => {
    expect(layoutBend('우 도그렉')).toBe(1);
    expect(layoutBend('좌 도그렉, 그린 앞 벙커')).toBe(-1);
    expect(layoutBend('왼쪽 도그랙')).toBe(-1);
    expect(layoutBend('오른쪽으로 휘는 도그레그')).toBe(1);
    expect(layoutBend('우측 OB 주의')).toBe(0);
    expect(layoutBend(undefined)).toBe(0);
    expect(holeShape(4, 1).green.cx).toBeGreaterThan(holeShape(4, 0).green.cx);
    expect(holeShape(5, -1).green.cx).toBeLessThan(holeShape(5, 0).green.cx);
    // A par 3 is drawn straight.
    expect(holeShape(3, 1)).toEqual(holeShape(3, 0));
  });

  it('draws decorative markup from numbers only', () => {
    for (const par of [3, 4, 5] as const) {
      const svg = holeArt(par, layoutBend('우 도그렉'));
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).not.toMatch(/style=|<script|\son\w+=|href/);
      expect(svg.includes('art-fairway')).toBe(par !== 3);
    }
  });
});
