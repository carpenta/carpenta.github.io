import { describe, expect, it } from 'vitest';
import { COURSES, distanceLabel, holeInfo, type Course } from '../src/courses';
import { courseShape, courseSvg, layoutBend, type CourseFrame } from '../src/course-art';
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
        // One published length with no tee name, and the published handicap index.
        { distances: [{ length: 385, unit: 'm' }], si: 5 },
        { layout: '좌 도그렉', si: 19 },
      ] as Course['nines'][number]['holes'],
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
    expect(holeInfo(round, 6, [course])).toBeNull();
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

  it('keeps a length with no tee name and a handicap index from 1 to 18', () => {
    expect(holeInfo(round, 4, [course])).toEqual({ distances: [{ length: 385, unit: 'm' }], si: 5 });
    expect(holeInfo(round, 5, [course])).toEqual({ layout: '좌 도그렉' });
    expect(distanceLabel(holeInfo(round, 4, [course]))).toBe('385m');
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

describe('drawn course behind the screen', () => {
  const frame: CourseFrame = { width: 375, height: 667, bandTop: 120, bandBottom: 200, right: 270 };

  it('draws a par 3 as a carry to a large green, a par 4 and 5 up a fairway to smaller ones', () => {
    const [p3, p4, p5] = ([3, 4, 5] as const).map((p) => courseShape(p, 0, frame, 0));
    expect(p3.fairway).toBeNull();
    expect(p4.fairway!.length).toBeGreaterThan(4);
    expect(p5.fairway!.length).toBeGreaterThan(4);
    expect(p3.green.rx).toBeGreaterThan(p4.green.rx);
    expect(p4.green.rx).toBeGreaterThan(p5.green.rx);
    for (const s of [p3, p4, p5]) {
      // The tee near the bottom; the green and its flag in the open band near the top, left of the badge.
      expect(s.tee.y).toBeGreaterThan(frame.height - 80);
      expect(s.pin!.y).toBeLessThanOrEqual(frame.bandBottom);
      expect(s.pin!.y - s.pin!.pole).toBeGreaterThanOrEqual(frame.bandTop - 1);
      expect(s.green.cx + s.green.rx * 0.75).toBeLessThanOrEqual(frame.right + 0.5);
    }
  });

  it('changes per hole: the pin and the outline of the green move', () => {
    const a = courseShape(4, 0, frame, 0);
    const b = courseShape(4, 1, frame, 0);
    expect(a.pin!.x).not.toBe(b.pin!.x);
    expect(a.green.outline).not.toEqual(b.green.outline);
    expect(courseShape(4, 18 + 1, frame, 0)).toEqual(b);
  });

  it('bends for a dogleg named in the layout note, and draws a par 3 straight', () => {
    expect(layoutBend('우 도그렉')).toBe(1);
    expect(layoutBend('좌 도그렉, 그린 앞 벙커')).toBe(-1);
    expect(layoutBend('왼쪽 도그랙')).toBe(-1);
    expect(layoutBend('오른쪽으로 휘는 도그레그')).toBe(1);
    expect(layoutBend('우측 OB 주의')).toBe(0);
    expect(layoutBend(undefined)).toBe(0);
    expect(courseShape(4, 0, frame, 1).green.cx).toBeGreaterThan(courseShape(4, 0, frame, 0).green.cx);
    expect(courseShape(5, 0, frame, -1).green.cx).toBeLessThan(courseShape(5, 0, frame, 0).green.cx);
    expect(courseShape(3, 0, frame, 1)).toEqual(courseShape(3, 0, frame, 0));
    // A bent green still stays left of the badge.
    const bent = courseShape(4, 0, frame, 1);
    expect(bent.green.cx + bent.green.rx * 0.75).toBeLessThanOrEqual(frame.right + 0.5);
  });

  it('leaves the flag out when the open band is too short to show it whole', () => {
    expect(courseShape(4, 0, { ...frame, bandTop: 180, bandBottom: 200 }, 0).pin).toBeNull();
  });

  it('draws decorative markup from numbers only', () => {
    for (const par of [3, 4, 5] as const) {
      const svg = courseSvg(courseShape(par, 2, frame, layoutBend('우 도그렉')), frame);
      expect(svg).toContain('<rect');
      expect(svg).not.toMatch(/style=|<script|\son\w+=|href/);
      expect(svg.includes('class="fairway"')).toBe(par !== 3);
    }
  });
});
