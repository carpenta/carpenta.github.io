import { beforeAll, describe, expect, it } from 'vitest';
import { courseShape, courseSvg, holeHazards, layoutHazards, layoutIsland, type CourseFrame, type CourseShape, type HazardShape, type HoleHazard, type NamedHazard } from '../src/course-art';
import type { Par } from '../src/round';

/** One line per hazard, so the phrase table reads like the notes: "bunker green front ×1". */
function say(h: NamedHazard | HoleHazard): string {
  switch (h.at) {
    case 'tee': return `${h.kind} tee`;
    case 'green': return `${h.kind} green ${h.spot} ×${h.count}`;
    case 'ahead': return `${h.kind} ahead ${h.side ?? '-'} ×${h.count}`;
    default: return `${h.kind} ${h.at} ${h.side} ×${h.count}`;
  }
}
const read = (note: string) => layoutHazards(note).map(say);
const both = (kind: string, at: string) => [`${kind} ${at} left ×1`, `${kind} ${at} right ×1`];

describe('bunkers and water named in a hole note (v22)', () => {
  // Phrases as the bundled notes write them, each with what the drawing takes from it.
  const TABLE: [string, string[]][] = [
    // Round the green: front, back, left, right and around, by the note's words.
    ['그린 앞 벙커', ['bunker green front ×1']],
    ['그린 전방 벙커 3개', ['bunker green front ×3']],
    ['그린 입구 벙커', ['bunker green front ×1']],
    ['그린 앞 깊은 벙커', ['bunker green front ×1']],
    ['그린 앞 중앙 벙커', ['bunker green front ×1']],
    ['그린 뒤 벙커', ['bunker green back ×1']],
    ['그린 후방 벙커', ['bunker green back ×1']],
    ['그린 좌측 벙커', ['bunker green left ×1']],
    ['그린 우측 가드벙커', ['bunker green right ×1']],
    ['그린 좌우 벙커', both('bunker', 'green')],
    ['그린 양옆 벙커', both('bunker', 'green')],
    ['그린 앞 좌측 벙커', ['bunker green front-left ×1']],
    ['그린 좌측 앞 벙커', ['bunker green front-left ×1']],
    ['그린 좌전방 벙커', ['bunker green front-left ×1']],
    ['그린 우측 앞 벙커', ['bunker green front-right ×1']],
    ['그린 앞 좌우 벙커', ['bunker green front-left ×1', 'bunker green front-right ×1']],
    ['그린 입구 좌우 벙커', ['bunker green front-left ×1', 'bunker green front-right ×1']],
    ['그린 앞뒤 벙커', ['bunker green front ×1', 'bunker green back ×1']],
    ['그린 앞·우측 벙커', ['bunker green front ×1', 'bunker green right ×1']],
    ['그린 좌측 뒤·우측 앞 벙커', ['bunker green back-left ×1', 'bunker green front-right ×1']],
    ['그린 앞 벙커 2개', ['bunker green front ×2']],
    ['그린 주변 벙커', ['bunker green around ×3']],
    ['그린 둘러싼 벙커 5개', ['bunker green around ×4']],
    ['그린 주변 벙커 다수', ['bunker green around ×4']],
    ['그린 둘러싼 벙커·해저드', ['bunker green around ×3']],
    ['벙커로 둘러싸인 그린', ['bunker green around ×3']],
    ['그린 앞 연못', ['water green front ×1']],
    ['그린 앞 대형 연못', ['water green front ×1']],
    ['그린 앞 워터해저드', ['water green front ×1']],
    ['그린 앞 워터 해저드', ['water green front ×1']],
    ['그린 우측 연못', ['water green right ×1']],
    ['그린 좌측·뒤 워터해저드', ['water green left ×1', 'water green back ×1']],
    ['그린 뒤 연못·벙커', ['water green back ×1', 'bunker green back ×1']],
    ['그린 앞 해저드·벙커', ['bunker green front ×1']],
    ['페어웨이·그린 우측 벙커', ['bunker green right ×1']],
    // The fairway: left, right or both sides.
    ['페어웨이 좌측 벙커', ['bunker fairway left ×1']],
    ['우측 페어웨이 벙커', ['bunker fairway right ×1']],
    ['페어웨이 양쪽 벙커', both('bunker', 'fairway')],
    ['IP 좌우 벙커', both('bunker', 'fairway')],
    ['좌측 IP 벙커', ['bunker fairway left ×1']],
    ['낙하지점 우측 벙커', ['bunker fairway right ×1']],
    ['좌측 IP 더블 벙커', ['bunker fairway left ×2']],
    ['페어웨이 좌측 연못', ['water fairway left ×1']],
    ['IP 좌우 연못', both('water', 'fairway')],
    // A side with no place: the par decides where it goes (below).
    ['좌측 벙커', ['bunker side left ×1']],
    ['우측 벙커 3개', ['bunker side right ×3']],
    ['좌우 벙커', both('bunker', 'side')],
    ['좌측 벙커 넘기기', ['bunker side left ×1']],
    ['좌측 워터해저드', ['water side left ×1']],
    ['우측 호수', ['water side right ×1']],
    ['우측 개울', ['water side right ×1']],
    ['좌측 인공호수', ['water side left ×1']],
    ['숨은 워터해저드(우측)', ['water side right ×1']],
    ['우측 OB·벙커', ['bunker side right ×1']],
    ['좌측 호수·우측 OB', ['water side left ×1']],
    ['우측 벙커 좌측 해저드', ['bunker side right ×1']],
    ['좌우 호수·벙커', [...both('water', 'side'), ...both('bunker', 'side')]],
    // Ahead with no place: in front of a par 3's green.
    ['앞 벙커', ['bunker ahead - ×1']],
    ['전방 워터해저드', ['water ahead - ×1']],
    ['전방 좌우 벙커', ['bunker ahead left ×1', 'bunker ahead right ×1']],
    // Water in front of the tee, also as the carry the tee shot makes.
    ['티 앞 연못', ['water tee']],
    ['티 앞 워터해저드', ['water tee']],
    ['연못 넘기는 티샷', ['water tee']],
    ['호수 넘기는 티샷', ['water tee']],
    ['물 넘기는 티샷', ['water tee']],
    ['티샷 연못 건너기', ['water tee']],
  ];
  it.each(TABLE)('reads "%s"', (phrase, expected) => {
    expect(read(phrase)).toEqual(expected);
  });

  const NONE = [
    // A plain 해저드 can be a dry penalty area.
    '좌측 해저드', '좌우 해저드', '그린 앞 해저드', '해저드 넘기는 티샷', '티잉 앞 해저드',
    // A grass bunker holds no sand, and a note can say there is none.
    '좌측 그라스 벙커', '그린 뒤 그래스 벙커', '벙커 없음', '그린 주변 벙커 없음', '그린 사이드 벙커 없음', '장애물 없음',
    // Named but not placed: left out rather than guessed.
    '벙커', '깊은 벙커', '비치 벙커', '페어웨이 벙커', 'IP 벙커 2개', '연못', '큰 호수', '연못 넘기기', '세컨 연못 넘기기', '계곡 물길',
    '그린 옆 연못', '그린 옆 숨은 벙커', '그린 사이드 벙커', '그린 근처 벙커', '그린 중앙 벙커', '그린 주변 연못', '정면 벙커', '가운데 벙커',
    // Places the drawing has no rule for: across or down the middle of the fairway, beside or round the tee, tee to green.
    '페어웨이 중앙 벙커', '페어웨이 가로지르는 벙커', '좌측 크로스 벙커', '티 옆 호수', '티 둘레 호수', '티 좌측 워터해저드', '티 앞 웨이스트 벙커', '티~그린 우측 워터해저드',
    // One of two greens.
    '좌그린 앞 벙커', '그린 앞 벙커(좌측 그린)', '두 그린 사이 벙커',
    // Water words outside the list.
    '좌측 계류', '숨은 크릭',
    // Water round the green is the island's (layoutIsland).
    '그린 둘러싼 연못',
  ];
  it.each(NONE)('draws nothing for "%s"', (phrase) => {
    expect(layoutHazards(phrase)).toEqual([]);
  });

  it('reads a whole note phrase by phrase and keeps one of each, with the larger count', () => {
    expect(read('우 도그렉, 그린 앞 벙커, 우측 연못')).toEqual(['bunker green front ×1', 'water side right ×1']);
    expect(read('그린 앞 벙커 2개, 그린 앞 깊은 벙커')).toEqual(['bunker green front ×2']);
    expect(read('그린 둘러싼 벙커·해저드, 비치 벙커')).toEqual(['bunker green around ×3']);
    expect(read('좌우 해저드, 좌측 벙커')).toEqual(['bunker side left ×1']);
    expect(read('내리막, 블라인드 티샷, 좌우 OB')).toEqual([]);
    expect(layoutHazards(undefined)).toEqual([]);
  });

  it('places a bare side on the fairway of a par 4 or 5 and beside a par 3 green; ahead only on a par 3', () => {
    const at = (par: Par, note: string) => holeHazards(par, note).map(say);
    expect(at(4, '좌측 벙커')).toEqual(['bunker fairway left ×1']);
    expect(at(5, '우측 호수')).toEqual(['water fairway right ×1']);
    expect(at(3, '좌측 벙커')).toEqual(['bunker green left ×1']);
    expect(at(3, '좌우 벙커')).toEqual(['bunker green left ×1', 'bunker green right ×1']);
    expect(at(3, '페어웨이 좌측 벙커')).toEqual([]);
    expect(at(3, '앞 벙커')).toEqual(['bunker green front ×1']);
    expect(at(3, '전방 좌우 벙커')).toEqual(['bunker green front-left ×1', 'bunker green front-right ×1']);
    expect(at(4, '앞 벙커')).toEqual([]);
    expect(at(4, '전방 워터해저드')).toEqual([]);
    expect(at(5, '티 앞 연못')).toEqual(['water tee']);
    // One bunker said twice in other words is drawn once.
    expect(at(3, '그린 좌측 벙커, 좌측 벙커 2개')).toEqual(['bunker green left ×2']);
  });

  it('finds an island green only where the green is the island', () => {
    expect(layoutIsland('아일랜드 홀')).toBe(true);
    expect(layoutIsland('호수 속 아일랜드 그린')).toBe(true);
    expect(layoutIsland('그린 둘러싼 연못')).toBe(true);
    expect(layoutIsland('그린 둘러싼 워터해저드')).toBe(true);
    // The tee is the island here, not the green.
    expect(layoutIsland('연못 속 아일랜드 티, 보이지 않는 좌측 페어웨이, 우측 벙커')).toBe(false);
    expect(layoutIsland('그린 둘러싼 벙커·해저드')).toBe(false);
  });
});

describe('placing the named hazards on the drawn hole (v22)', () => {
  const phone: CourseFrame = { width: 375, height: 667, bandTop: 120, bandBottom: 200, right: 270 };
  const tall: CourseFrame = { width: 390, height: 844, bandTop: 112, bandBottom: 316, right: 368, teeY: 752 };
  const short: CourseFrame = { width: 375, height: 553, bandTop: 150, bandBottom: 176, right: 359, teeY: 466 };
  /** A band just short of tall, its green low in it: room behind the green. */
  const roomAbove: CourseFrame = { width: 375, height: 667, bandTop: 92, bandBottom: 200, right: 359 };
  const FRAMES = [phone, tall, short];
  const NOTES = [
    '그린 앞 벙커', '그린 뒤 벙커', '그린 좌우 벙커', '그린 앞 좌우 벙커', '그린 좌측 뒤·우측 앞 벙커', '그린 주변 벙커 다수', '그린 앞 벙커 3개',
    '그린 앞 연못·벙커', '그린 우측·뒤 대형 호수·벙커', '좌우 호수·벙커', 'IP 좌우 벙커', '좌측 벙커 3개', '페어웨이 좌측 연못', '티 앞 연못',
    '그린 좌측 연못, 그린 우측 벙커 2개', '그린 주변 벙커, 그린 좌측 벙커',
  ];
  // Every frame, par, bend, hole and note above, drawn once for the two checks that go through all of them.
  const drawn: [string, CourseShape, CourseFrame][] = [];
  beforeAll(() => {
    for (const frame of FRAMES) for (const par of [3, 4, 5] as const) for (const bend of [-1, 0, 1] as const) for (let index = 0; index < 18; index++) {
      for (const note of NOTES) drawn.push([`${note} / par ${par} bend ${bend} hole ${index + 1} ${frame.width}×${frame.height}`, courseShape(par, index, frame, bend, false, 420, holeHazards(par, note)), frame]);
    }
  }, 30_000);
  const shapes = () => drawn;
  // Every point of the hazard's outline lies on or inside this ellipse: its axes times its largest outline factor, with room.
  const rim = (h: HazardShape, n = 48) => {
    const m = Math.max(...h.outline) * 1.06;
    const a = (h.angle * Math.PI) / 180;
    return Array.from({ length: n }, (_, j) => {
      const t = (j / n) * Math.PI * 2;
      const x = Math.cos(t) * h.rx * m;
      const y = Math.sin(t) * h.ry * m;
      return [h.cx + x * Math.cos(a) - y * Math.sin(a), h.cy + x * Math.sin(a) + y * Math.cos(a)] as const;
    });
  };
  const inBox = ([x, y]: readonly [number, number], b: { x0: number; y0: number; x1: number; y1: number }) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;

  it('never moves the hole: the green, flag, tee, fairway and markers are the same with or without hazards', () => {
    for (const frame of FRAMES) for (const par of [3, 4, 5] as const) for (const bend of [-1, 0, 1] as const) {
      const plain = courseShape(par, 4, frame, bend, false, 420);
      const named = courseShape(par, 4, frame, bend, false, 420, holeHazards(par, '그린 주변 벙커 다수, 좌우 호수·벙커, 티 앞 연못, 그린 앞 연못'));
      expect(named.hazards.length).toBeGreaterThan(0);
      expect({ ...named, hazards: [] }).toEqual({ ...plain, hazards: [] });
    }
  });

  // Checked over every frame, par, bend, hole and note above: the problems found, none expected (one expect, so it runs fast).
  it('keeps every hazard off the green and its fringe, off the flag and off the 100 m and 150 m markers', () => {
    let hazards = 0;
    const problems: string[] = [];
    for (const [what, s, frame] of shapes()) {
      const g = s.green;
      const fa = g.rx * 1.17 * Math.max(...g.outline) + 2;
      const fb = g.ry * 1.17 * Math.max(...g.outline) + 2;
      const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
      if (s.pin) {
        const fw = Math.max(13, s.pin.pole * 0.46);
        boxes.push({ x0: s.pin.x - 2, y0: s.pin.y - s.pin.pole - 3, x1: s.pin.x + fw + 1, y1: s.pin.y + 2 });
      }
      for (const m of s.markers) {
        boxes.push({ x0: m.x - 6.5, y0: m.y - 6.5, x1: m.x + 6.5, y1: m.y + 6.5 });
        // The label pill as drawn: 54px since the bundled font (v24).
        boxes.push({ x0: m.x + 10, y0: m.y - 11, x1: m.x + 10 + 54, y1: m.y + 11 });
      }
      for (const h of s.hazards) {
        hazards++;
        const r = rim(h);
        if (r.some((p) => ((p[0] - g.cx) / fa) ** 2 + ((p[1] - g.cy) / fb) ** 2 < 1)) problems.push(`${what}: ${h.kind} on the green`);
        if (r.some((p) => boxes.some((b) => inBox(p, b)))) problems.push(`${what}: ${h.kind} on the flag or a marker`);
        // Nothing rises into the header, where the chips are.
        if (r.some((p) => p[1] < frame.bandTop)) problems.push(`${what}: ${h.kind} under the chips`);
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
    expect(hazards).toBeGreaterThan(10000);
  });

  it('keeps hazards apart and their middles on the screen', () => {
    const problems: string[] = [];
    const inside = (h: HazardShape, [x, y]: readonly [number, number]) => {
      const t = (-h.angle * Math.PI) / 180;
      const dx = x - h.cx;
      const dy = y - h.cy;
      const m = Math.max(...h.outline);
      return ((dx * Math.cos(t) - dy * Math.sin(t)) / (h.rx * m)) ** 2 + ((dx * Math.sin(t) + dy * Math.cos(t)) / (h.ry * m)) ** 2 < 1;
    };
    for (const [what, s, frame] of shapes()) {
      for (const [i, a] of s.hazards.entries()) {
        if (a.cx < 6 || a.cx > frame.width - 6) problems.push(`${what}: a ${a.kind} off the screen at x ${a.cx.toFixed(0)}`);
        for (const b of s.hazards.slice(i + 1)) {
          if (rim(a, 24).some((p) => inside(b, p)) || rim(b, 24).some((p) => inside(a, p))) problems.push(`${what}: a ${a.kind} and a ${b.kind} overlap`);
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it('puts each hazard where its words say, the front toward the tee', () => {
    const one = (par: Par, note: string, frame = tall, bend: -1 | 0 | 1 = 0) => courseShape(par, 2, frame, bend, false, 420, holeHazards(par, note));
    for (const par of [3, 4, 5] as const) {
      const s = one(par, '그린 앞 벙커');
      expect(s.hazards).toHaveLength(1);
      expect(s.hazards[0].cy).toBeGreaterThan(s.green.cy + s.green.ry);
      expect(one(par, '그린 좌측 벙커').hazards[0].cx).toBeLessThan(s.green.cx - s.green.rx);
      expect(one(par, '그린 우측 벙커').hazards[0].cx).toBeGreaterThan(s.green.cx + s.green.rx);
      // Behind the green is up the screen, into the header on a tall band: drawn where the band leaves room, else left out.
      expect(one(par, '그린 뒤 벙커').hazards).toEqual([]);
      if (par !== 3) expect(one(par, '그린 뒤 벙커', roomAbove).hazards[0].cy).toBeLessThan(one(par, '', roomAbove).green.cy);
      const around = one(par, '그린 주변 벙커').hazards;
      expect(around).toHaveLength(3);
      expect(around.some((h) => h.cx < s.green.cx) && around.some((h) => h.cx > s.green.cx)).toBe(true);
      // Water in front of the tee: between the tee box and the green, clear of the box.
      const tee = one(par, '티 앞 연못');
      const w = tee.hazards[0];
      expect(w.kind).toBe('water');
      expect(w.cy + w.ry * Math.max(...w.outline) * 1.06).toBeLessThanOrEqual(tee.tee.y - 12);
      expect(w.cy).toBeGreaterThan(tee.green.cy);
    }
    // On a par 4 or 5 a bare side is the fairway's, on its edge; on a par 3 it is beside the green.
    for (const par of [4, 5] as const) {
      const s = one(par, '좌측 벙커, 우측 연못');
      const [bunker, water] = s.hazards;
      expect(bunker.cy).toBeGreaterThan(s.green.cy + s.green.ry * 2);
      expect(bunker.cx).toBeLessThan(s.tee.x);
      expect(water.cx).toBeGreaterThan(s.tee.x);
    }
    const p3 = one(3, '좌측 벙커');
    expect(Math.hypot(p3.hazards[0].cx - p3.green.cx, p3.hazards[0].cy - p3.green.cy)).toBeLessThan(p3.green.rx * 2.4);
    // A count draws that many, in a row.
    expect(one(4, '그린 앞 벙커 3개').hazards).toHaveLength(3);
    expect(one(4, '좌측 IP 더블 벙커').hazards).toHaveLength(2);
  });

  it('keeps water in front of the green between it and the 100 m marker, smaller where the band is short of room', () => {
    for (const index of [0, 4, 8, 13]) {
      for (const bend of [-1, 0, 1] as const) {
        const s = courseShape(4, index, tall, bend, false, 417, holeHazards(4, '그린 앞 연못'));
        expect(s.markers.map((m) => m.d)).toEqual([100, 150]);
        expect(s.hazards).toHaveLength(1);
        const w = s.hazards[0];
        // Nearer the green than the 100 m marker, never pushed past the markers (or under the card).
        expect(w.cy + w.ry * Math.max(...w.outline) * 1.06).toBeLessThan(s.markers[0].y - 11);
        expect(w.cy).toBeGreaterThan(s.green.cy);
      }
    }
  });

  it('sizes hazards to the hole: a bunker smaller than its green, water larger than a bunker', () => {
    for (const par of [3, 4, 5] as const) {
      const s = courseShape(par, 0, tall, 0, false, 420, holeHazards(par, '그린 좌측 벙커, 그린 우측 연못'));
      const [bunker, water] = s.hazards;
      expect(bunker.rx).toBeLessThan(s.green.rx * 0.6);
      expect(bunker.rx).toBeGreaterThanOrEqual(10);
      expect(water.rx).toBeGreaterThan(bunker.rx);
    }
  });

  // The critique of v31's first pass: v22's outline tables pulled every other point in, so ponds and bunkers came out as
  // leaves with pointed ends and greens as lemons. A plan view draws them rounded; a bunker may still be pulled in on a side.
  it('rounds bunkers, ponds and greens as a plan view does: no point of an outline sticks out past both its neighbours (v31)', () => {
    const tips = (o: number[]) => o.filter((r, j) => r - Math.max(o[(j + o.length - 1) % o.length], o[(j + 1) % o.length]) > 0.015);
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const [what, s] of shapes()) {
      for (const [kind, o] of [['green', s.green.outline], ...s.hazards.map((h) => [h.kind, h.outline] as const)] as const) {
        const key = `${kind} ${o.join(' ')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (tips([...o]).length) problems.push(`${what}: ${key}`);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
    expect(problems).toEqual([]);
  });

  it('is the same drawing every time for the same hole', () => {
    const a = courseShape(4, 7, tall, 1, false, 380, holeHazards(4, '그린 주변 벙커, 좌측 연못'));
    expect(courseShape(4, 7, tall, 1, false, 380, holeHazards(4, '그린 주변 벙커, 좌측 연못'))).toEqual(a);
  });
});

describe('the drawn course, a yardage book’s plan view (v31)', () => {
  // v22 lit the drawing (mowing stripes, a domed green, deep water with a glint, grain): it read as a game asset, and
  // since v30 nothing on top of it is see-through. A plan view in flat fills is what golfers read in a yardage book.
  const frame: CourseFrame = { width: 375, height: 667, bandTop: 120, bandBottom: 200, right: 270 };
  const plain = courseSvg(courseShape(4, 0, frame, 0), frame);
  const hazards = courseSvg(courseShape(3, 3, frame, 0, false, null, holeHazards(3, '그린 앞 연못, 그린 좌측 벙커')), frame);
  const island = courseSvg(courseShape(3, 6, frame, 0, true), frame);
  const ALL = [plain, hazards, island];
  /** The flat parts a drawn hole is made of, each painted by its class in style.css. */
  const FLAT = ['a-rough-fill', 'a-cut', 'fairway', 'bunker', 'a-sand', 'pond', 'water', 'a-fringe', 'green', 'a-cup', 'a-pole-edge', 'a-pole', 'flag', 'marker', 'a-marker', 'a-marker-label', 'tee', 'a-pole-fill'];

  it('is flat: no gradient, pattern, mask, clip path or filter, nothing painted by url(), and no grain', () => {
    for (const svg of ALL) {
      expect(svg).not.toMatch(/<(linearGradient|radialGradient|pattern|mask|clipPath|filter|fe[A-Z])\b/);
      expect(svg).not.toMatch(/url\(#|\smask=|clip-path=|filter=/);
      expect(svg).not.toContain('grain');
    }
  });

  it('draws only the flat parts, from the ground up: rough, the fairway’s first cut and the fairway, hazards, the green’s fringe and the green, the pin, the tee', () => {
    for (const svg of ALL) {
      const classes = [...new Set([...svg.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(' ')))];
      expect(classes.filter((c) => !FLAT.includes(c))).toEqual([]);
    }
    const at = (c: string) => plain.indexOf(`class="${c}"`);
    const order = ['a-rough-fill', 'a-cut', 'fairway', 'a-fringe', 'green', 'a-pole', 'tee'].map(at);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Hazards sit on the fairway and under the green.
    expect(hazards.indexOf('class="bunker"')).toBeLessThan(hazards.indexOf('class="a-fringe"'));
    expect(hazards.indexOf('class="pond"')).toBeLessThan(hazards.indexOf('class="a-fringe"'));
  });

  it('keeps sand and water flat: one fill each, water with its bank line, no lip, depth or glint', () => {
    expect(hazards.match(/<g class="bunker">/g)).toHaveLength(1);
    expect(hazards).toMatch(/<g class="bunker"><path class="a-sand" d="[^"]+"\/><\/g>/);
    for (const svg of [hazards, island]) {
      expect(svg).toMatch(/<path class="water" d="[^"]+" stroke-width="2"\/>/);
      expect(svg).not.toMatch(/\b(glint|depth|lip|collar|shadow|shade|vignette)\b/);
    }
    expect(island).not.toContain('class="bunker"');
  });

  it('marks the pin plainly: the cup, a white pole and a red pennant, no shadow or shading', () => {
    for (const svg of ALL) {
      expect(svg.match(/class="a-cup"/g)).toHaveLength(1);
      expect(svg.match(/class="a-pole"/g)).toHaveLength(1);
      expect(svg.match(/class="flag"/g)).toHaveLength(1);
      expect(svg).toMatch(/<path class="flag" d="M[\d.-]+ [\d.-]+l[\d.-]+ [\d.-]+l?-?[\d.-]+ [\d.-]+z"\/>/);
    }
  });

  // The critique of v31's first pass: the white pole was 2.1:1 on the light green, with nothing round it.
  it('edges the white pole in a dark line, so the pin reads on the light green and on the dark rough alike', () => {
    for (const svg of ALL) {
      const m = /<path class="a-pole-edge" d="([^"]+)" stroke-width="([\d.]+)" stroke-linecap="round"\/><path class="a-pole" d="([^"]+)" stroke-width="([\d.]+)"/.exec(svg);
      expect(m).not.toBeNull();
      expect(m![1]).toBe(m![3]);
      // At least 0.7px of edge each side of the pole.
      expect(Number(m![2]) - Number(m![4])).toBeGreaterThanOrEqual(1.4);
    }
  });

  it('takes every colour from the palette with hazards drawn too: no colour in the markup', () => {
    for (const svg of ALL) {
      expect(svg).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/);
      expect(svg).not.toMatch(/(fill|stroke|stop-color|flood-color|lighting-color)="(?!none")/);
      expect(svg).not.toMatch(/style=|<script|\son\w+=|href/);
    }
  });
});
