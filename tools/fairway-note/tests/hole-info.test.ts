import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COURSES, distanceLabel, holeInfo, publishedPar, type Course } from '../src/courses';
import { courseShape, courseSvg, holeThumb, layoutBend, layoutIsland, type CourseFrame } from '../src/course-art';
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
    expect(distanceLabel(holeInfo(round, 4, [course]))).toBe('385 m');
  });

  it('labels the length from the first tee listed', () => {
    expect(distanceLabel(holeInfo(round, 0, [course]))).toBe('화이트 352 m');
    expect(distanceLabel(holeInfo(round, 3, [course]))).toBe('White 165 yd');
    expect(distanceLabel({ layout: '우 도그렉' })).toBeNull();
    expect(distanceLabel(null)).toBeNull();
  });
});

describe('published par, for 파 수정', () => {
  it('reads each half from the nine the round keeps, also when one nine is played twice', () => {
    expect(publishedPar(round, 2, [course])).toBe(5);
    expect(publishedPar(round, 11, [course])).toBe(4);
    expect(publishedPar({ ...round, back: '동' }, 11, [course])).toBe(5);
  });

  it('is par 4 on a course typed in by hand, and unknown when the bundle lost the course or nine', () => {
    expect(publishedPar({ id: null, name: '동네 골프장', front: '', back: '' }, 0, [course])).toBe(4);
    expect(publishedPar({ ...round, id: 'gone' }, 0, [course])).toBeNull();
    expect(publishedPar({ ...round, front: '없는 코스' }, 0, [course])).toBeNull();
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

  it('puts water round the green only where the note names an island green', () => {
    expect(layoutIsland('아일랜드 홀')).toBe(true);
    expect(layoutIsland('좌우 해저드, 좌측 벙커')).toBe(false);
    expect(layoutIsland(undefined)).toBe(false);
    expect(courseSvg(courseShape(3, 6, frame, 0, true), frame)).toContain('class="water"');
    expect(courseSvg(courseShape(3, 6, frame, 0), frame)).not.toContain('class="water"');
  });

  it('keeps a par 3 green from filling a tall band, still the largest green', () => {
    const tall: CourseFrame = { ...frame, bandTop: 100, bandBottom: 320 };
    const [p3, p4] = ([3, 4] as const).map((p) => courseShape(p, 0, tall, 0));
    expect(p3.green.rx).toBeLessThanOrEqual(frame.width * 0.17 + 0.01);
    expect(p3.green.rx).toBeGreaterThan(p4.green.rx);
  });

  it('fades an island green\'s water in below the chips, and on a tall band sets the green low enough for its water', () => {
    const svg = courseSvg(courseShape(3, 6, frame, 0, true), frame);
    expect(svg).toMatch(new RegExp(`<linearGradient id="course-wfade" gradientUnits="userSpaceOnUse" x1="0" y1="${frame.bandTop}" x2="0" y2="${frame.bandTop + 30}">`));
    expect(svg).toMatch(/<g mask="url\(#course-wmask\)"><path class="water"/);
    const tall: CourseFrame = { ...frame, bandTop: 100, bandBottom: 320 };
    const g = courseShape(3, 6, tall, 0, true).green;
    expect(g.cy - g.ry * 1.78).toBeGreaterThanOrEqual(tall.bandTop + 6 - 0.5);
  });

  it('mows the green in faint bands across the line of play, not rings that read as contours', () => {
    const s = courseShape(4, 0, frame, 0);
    const svg = courseSvg(s, frame);
    expect(svg).toContain(`<pattern id="course-gmow" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(${(s.angle + 90).toFixed(1)})">`);
    expect(svg).toMatch(/patternTransform="rotate\([^)]*\)"><rect class="a-green-stripe" width="7" height="14"\/><\/pattern>/);
    expect(svg).toMatch(/fill="url\(#course-gmow\)"\/>/);
    expect(svg).not.toContain('stroke-opacity=".12"');
    // Faint: the band is white at a few percent (the palette in style.css, v19).
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(Number(/--art-green-stripe: color-mix\(in srgb, var\(--white\) (\d+)%, transparent\)/.exec(css)![1])).toBeLessThanOrEqual(10);
  });

  it('tucks the tee box behind 다음 홀 when told where the button is, so none of it peeks out below', () => {
    for (const par of [3, 4, 5] as const) {
      const s = courseShape(par, 0, { ...frame, teeY: 577 }, 0);
      expect(s.tee.y).toBe(577);
      // Without the button's place, the tee stays near the bottom as before.
      expect(courseShape(par, 0, frame, 0).tee.y).toBeGreaterThan(frame.height - 80);
    }
  });

  it('draws a small picture of the hole for a short screen: tee to green left to right, a dogleg turning up or down, water round an island', () => {
    const p3 = holeThumb(3, 0, false);
    const p4 = holeThumb(4, 0, false);
    expect(p3).toContain('class="th-green"');
    expect(p3).not.toContain('class="th-fairway"');
    expect(p4).toContain('class="th-fairway"');
    const greenY = (svg: string) => Number(/class="th-green" cx="[\d.]+" cy="([\d.]+)"/.exec(svg)![1]);
    // Facing the green (to the right), a left dogleg turns up the picture and a right one down.
    expect(greenY(holeThumb(4, -1, false))).toBeLessThan(greenY(p4));
    expect(greenY(holeThumb(4, 1, false))).toBeGreaterThan(greenY(p4));
    expect(holeThumb(3, 0, true)).toContain('class="th-water"');
    expect(p3).not.toContain('class="th-water"');
    for (const svg of [p3, p4, holeThumb(5, 1, false)]) {
      expect(svg).toMatch(/^<svg viewBox="0 0 40 28"/);
      expect(svg).not.toMatch(/style=|<script|\son\w+=|href/);
    }
  });

  it('leaves the flag out when the open band is too short to show it whole', () => {
    expect(courseShape(4, 0, { ...frame, bandTop: 180, bandBottom: 200 }, 0).pin).toBeNull();
  });

  it('shows 100 m and 150 m markers only in a band tall enough for the approach, and only where the hole is long enough', () => {
    const tall: CourseFrame = { ...frame, bandTop: 100, bandBottom: 320 };
    const at = (par: 3 | 4 | 5, length: number | null, f: CourseFrame = tall) => courseShape(par, 0, f, 0, false, length).markers.map((m) => m.d);
    expect(at(4, 381)).toEqual([100, 150]);
    // A marker needs the hole to be at least 60 m longer than it.
    expect(at(4, 190)).toEqual([100]);
    expect(at(4, 150)).toEqual([]);
    expect(at(4, null)).toEqual([]);
    // No fairway on a par 3, and no approach in the ordinary band.
    expect(at(3, 200)).toEqual([]);
    expect(at(4, 381, frame)).toEqual([]);
    for (const m of courseShape(5, 3, tall, 0, false, 480).markers) {
      expect(m.y).toBeGreaterThan(tall.bandTop);
      expect(m.y).toBeLessThanOrEqual(tall.bandBottom - 14);
    }
    const svg = courseSvg(courseShape(4, 0, tall, 0, false, 381), tall);
    expect(svg).toContain('>100 m<');
    expect(svg).toContain('>150 m<');
    // The flag stands near the top of a tall band, so the approach shows below it.
    const s = courseShape(4, 0, tall, 0, false, 381);
    expect(s.pin!.y - s.pin!.pole).toBeLessThan(tall.bandTop + 10);
  });

  it('draws the rough with grain, a vignette and a header shade, the fairway with its edge and first cut, and a bevelled tee', () => {
    const svg = courseSvg(courseShape(4, 0, frame, 0), frame);
    for (const id of ['course-rough', 'course-mow', 'course-dome', 'course-vignette', 'course-shade', 'course-teebox']) expect(svg).toContain(`id="${id}"`);
    // The grain is the page's noise tile (v22, src/grain.ts), which the drawing points at.
    expect(svg).toContain('fill="url(#course-grain)"');
    expect(svg).toMatch(/class="a-edge"[^>]* stroke-width="20"/);
    expect(svg).toMatch(/class="a-cut"[^>]* stroke-width="10"/);
    expect(svg.match(/<circle [^>]*r="4.2" class="a-pole-fill"/g)).toHaveLength(2);
  });

  it('takes every colour from the palette in style.css: no colour in the markup (v19)', () => {
    for (const water of [false, true]) {
      const svg = courseSvg(courseShape(4, 6, frame, 0, water), frame);
      expect(svg).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/);
      expect(svg).not.toMatch(/(fill|stroke|stop-color)="(?!none"|url\(|white")/);
    }
    for (const par of [3, 4, 5] as const) expect(holeThumb(par, 1, true)).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|(fill|stroke)="(?!none")/);
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
