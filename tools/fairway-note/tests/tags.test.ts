import { describe, expect, it } from 'vitest';
import { SHOT_TAGS, TAG_LABELS, analyze, bump, emptyHole, newRound, setTag, setTeeTag, strokes, tagAt, teeTag, type Hole, type Round } from '../src/round';
import { analysisText, detailLines, reportText, roundCsv } from '../src/report';
import { CORRUPT_PREFIX, STORAGE_KEY, loadRound, parseRound, preserveUnreadable, saveRound } from '../src/storage';

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const shots = (h: Hole, driver: number, approach = 0, putts = 0): Hole => ({ ...h, driver, approach, putts });

describe('shot tags', () => {
  it('stores a tag per shot, aligned with the count, and leaves untagged holes unchanged', () => {
    const h = shots(emptyHole(), 2, 1, 2);
    const a = setTag(h, 'driver', 1, 'right');
    expect(a.tags).toEqual({ driver: [null, 'right'] });
    expect(tagAt(a, 'driver', 0)).toBeNull();
    expect(tagAt(a, 'driver', 1)).toBe('right');
    expect(h.tags).toBeUndefined();
    expect(setTag(a, 'driver', 1, 'right')).toBe(a);
    // Clearing the only tag gives back a hole with no tags field at all.
    expect(setTag(a, 'driver', 1, null)).toEqual(h);
    expect(setTag(h, 'putts', 1, 'in').tags).toEqual({ putts: [null, 'in'] });
  });

  it('ignores a shot that was not played or a tag from another counter', () => {
    const h = shots(emptyHole(), 1);
    expect(setTag(h, 'driver', 1, 'left')).toBe(h);
    expect(setTag(h, 'approach', 0, 'bunker')).toBe(h);
    expect(setTag(h, 'driver', 0, 'bunker' as never)).toBe(h);
  });

  it('adds one OB for an OB tag, never twice, and takes it back when the tag goes', () => {
    const h = shots(emptyHole(), 1);
    const left = setTag(h, 'driver', 0, 'ob-left');
    expect(left.ob).toBe(1);
    expect(strokes(left)).toBe(2);
    const right = setTag(left, 'driver', 0, 'ob-right');
    expect(right.ob).toBe(1);
    expect(setTag(right, 'driver', 0, 'left')).toEqual({ ...h, tags: { driver: ['left'] } });
    expect(setTag(right, 'driver', 0, null)).toEqual(h);
  });

  it('does not add an OB the player already counted, and does not remove it with the tag', () => {
    const counted = { ...shots(emptyHole(), 1), ob: 1 };
    const tagged = setTag(counted, 'driver', 0, 'ob-left');
    expect(tagged.ob).toBe(1);
    expect(setTag(tagged, 'driver', 0, null)).toEqual(counted);
    // A second OB tee shot on top of one counted OB adds one more.
    const twice = setTag(setTag(shots(counted, 2), 'driver', 0, 'ob-left'), 'driver', 1, 'ob-right');
    expect(twice.ob).toBe(2);
  });

  it('drops the last tag with the last shot, with the OB it added', () => {
    const h = setTag(setTag(shots(emptyHole(), 2), 'driver', 0, 'left'), 'driver', 1, 'ob-right');
    expect(h.ob).toBe(1);
    const back = bump(h, 'driver', -1);
    expect(back).toEqual({ ...shots(emptyHole(), 1), tags: { driver: ['left'] } });
    expect(bump(back, 'driver', -1)).toEqual(emptyHole());
    const putt = setTag(shots(emptyHole(), 1, 0, 1), 'putts', 0, 'short');
    expect(bump(putt, 'putts', -1)).toEqual(shots(emptyHole(), 1));
    expect(bump(putt, 'putts', 1).tags).toEqual({ putts: ['short'] });
  });

  it('keeps the OB link no larger than the OB count after a minus on OB', () => {
    const h = setTag(shots(emptyHole(), 1), 'driver', 0, 'ob-left');
    const noOb = bump(h, 'ob', -1);
    expect(noOb.ob).toBe(0);
    expect(noOb.obByTag).toBeUndefined();
    // Clearing the tag now has no OB left to take back.
    expect(setTag(noOb, 'driver', 0, null)).toEqual(shots(emptyHole(), 1));
  });

  it('offers the agreed chips per counter, with the 상세 pad directions for drives', () => {
    expect(SHOT_TAGS.driver).toEqual(['fairway', 'left', 'right', 'far-left', 'far-right', 'long', 'short', 'ob-left', 'ob-right', 'whiff', 'mishit']);
    expect(SHOT_TAGS.approach).toEqual(['green', 'short', 'long', 'left', 'right', 'bunker', 'hazard', 'whiff']);
    expect(SHOT_TAGS.putts).toEqual(['in', 'short', 'long', 'left', 'right']);
    expect(TAG_LABELS.driver).toMatchObject({ 'far-left': '많이 좌', 'far-right': '많이 우', long: '김', short: '짧음' });
  });
});

describe('tee shot on the 상세 pad', () => {
  it('tags the first drive, counting the tee shot when none is counted yet', () => {
    const right = setTeeTag(emptyHole(), 'right');
    expect(right).toEqual({ ...shots(emptyHole(), 1), tags: { driver: ['right'] } });
    expect(teeTag(right)).toBe('right');
    expect(teeTag(emptyHole())).toBeNull();
    // A second drive is not touched: the pad is about the tee shot.
    const two = setTeeTag(shots(emptyHole(), 2), 'far-left');
    expect(two.tags).toEqual({ driver: ['far-left'] });
    expect(two.driver).toBe(2);
  });

  it('changes or clears the tee result without changing the count', () => {
    const h = setTeeTag(emptyHole(), 'long');
    expect(setTeeTag(h, 'whiff')).toEqual({ ...shots(emptyHole(), 1), tags: { driver: ['whiff'] } });
    expect(setTeeTag(h, null)).toEqual(shots(emptyHole(), 1));
    const untouched = emptyHole();
    expect(setTeeTag(untouched, null)).toBe(untouched);
  });

  it('takes back an OB the tee shot tag added when the direction changes, as a chip would', () => {
    const ob = setTag(shots(emptyHole(), 1), 'driver', 0, 'ob-right');
    expect(ob.ob).toBe(1);
    expect(setTeeTag(ob, 'right').ob).toBe(0);
  });
});

function tagged(): Round {
  const r = newRound(new Date(2026, 10, 19));
  r.holes[0] = setTag(setTag(shots(emptyHole(), 1, 1, 2), 'driver', 0, 'left'), 'putts', 0, 'short');
  r.holes[1] = setTag(setTag(shots(emptyHole(), 2, 1, 2), 'driver', 0, 'ob-left'), 'driver', 1, 'fairway');
  r.holes[2] = setTag(setTag(shots(emptyHole(), 1, 1, 2), 'driver', 0, 'right'), 'putts', 0, 'short');
  r.holes[3] = setTag(shots(emptyHole(), 1, 1, 0), 'driver', 0, 'whiff'); // being played: not counted
  r.current = 3;
  return r;
}

describe('stored tags', () => {
  it('round-trips tags and the OB link', () => {
    const kv = memory();
    const r = tagged();
    expect(saveRound(r, kv)).toBe(true);
    expect(loadRound(kv)).toEqual(r);
    expect(preserveUnreadable(kv)).toBe('none');
  });

  it('reads rounds saved before tags existed', () => {
    const r = newRound(new Date(2026, 10, 19));
    r.holes[0] = shots(emptyHole(), 1, 1, 2);
    expect(parseRound(JSON.stringify(r))).toEqual(r);
  });

  it('keeps the round but drops tags it cannot read, and copies the original aside', () => {
    const good = tagged();
    const bad = JSON.parse(JSON.stringify(good));
    bad.holes[0].tags = { driver: ['sideways'], putts: ['short', 'long', 'in'], wedge: ['left'] };
    bad.holes[1].obByTag = 5;
    bad.holes[2].tags = 'right';
    const text = JSON.stringify(bad);
    const round = parseRound(text)!;
    expect(round).not.toBeNull();
    expect(round.holes.map((h) => strokes(h))).toEqual(good.holes.map((h) => strokes(h)));
    // Unknown tag becomes no tag; extra entries past the count are dropped; unknown counters are ignored.
    expect(round.holes[0].tags).toEqual({ putts: ['short', 'long'] });
    expect(round.holes[1].obByTag).toBeUndefined();
    expect(round.holes[1].tags).toEqual(good.holes[1].tags);
    expect(round.holes[2].tags).toBeUndefined();

    const kv = memory();
    kv.map.set(STORAGE_KEY, text);
    expect(loadRound(kv)).toEqual(round);
    expect(preserveUnreadable(kv, 7)).toBe('kept');
    expect(kv.map.get(`${CORRUPT_PREFIX}7`)).toBe(text);
  });
});

describe('detail analysis', () => {
  it('counts tags on finished holes only', () => {
    const a = analyze(tagged());
    expect(a.details).toEqual({
      driver: { fairway: 1, left: 1, right: 1, 'ob-left': 1 },
      approach: {},
      putts: { short: 2 },
    });
  });

  it('has no details without tags', () => {
    const r = newRound(new Date(2026, 10, 19));
    r.holes[0] = shots(emptyHole(), 1, 1, 2);
    r.current = 1;
    expect(analyze(r).details).toBeNull();
    expect(detailLines(analyze(r))).toEqual([]);
    expect(reportText(r)).not.toContain('[샷 세부]');
  });

  it('summarises tags in the report', () => {
    const a = analyze(tagged());
    expect(detailLines(a)).toEqual([
      '티샷: 페어웨이 1 · 좌 1 · 우 1 · 좌 OB 1',
      '티샷 방향: 좌 2 (OB 1) · 우 1 (OB 0)',
      '퍼트: 짧음 2',
      '퍼트가 짧았던 적이 2번, 길었던 적이 0번입니다. 홀을 지나가게 쳐 보세요.',
    ]);
    const text = reportText(tagged());
    expect(text).toContain('[샷 세부]');
    expect(text).toContain('- 티샷 방향: 좌 2 (OB 1) · 우 1 (OB 0)');
    expect(text).toContain('1번 Par4: 4타 (E) 드1 어1 퍼2 · 드 좌 · 퍼 짧음');
    expect(text).toContain('2번 Par4: 6타 (+2) 드2 어1 퍼2 OB 1 · 드 좌 OB, 페어웨이');
  });

  it('counts far left and far right with left and right in the tee direction', () => {
    const r = newRound(new Date(2026, 10, 19));
    r.holes[0] = setTeeTag(shots(emptyHole(), 1, 1, 2), 'far-left');
    r.holes[1] = setTeeTag(shots(emptyHole(), 1, 1, 2), 'left');
    r.holes[2] = setTeeTag(shots(emptyHole(), 1, 1, 2), 'far-right');
    r.current = 3;
    const lines = detailLines(analyze(r));
    expect(lines).toContain('티샷: 좌 1 · 많이 좌 1 · 많이 우 1');
    expect(lines).toContain('티샷 방향: 좌 2 (OB 0) · 우 1 (OB 0)');
    expect(reportText(r)).toContain('1번 Par4: 4타 (E) 드1 어1 퍼2 · 드 많이 좌');
  });

  it('counts whiffs and misses in the report', () => {
    const r = newRound(new Date(2026, 10, 19));
    r.holes[0] = setTag(setTag(shots(emptyHole(), 2, 2, 1), 'driver', 0, 'whiff'), 'approach', 0, 'whiff');
    r.holes[0] = setTag(r.holes[0], 'approach', 1, 'bunker');
    r.current = 1;
    const lines = detailLines(analyze(r));
    expect(lines).toContain('티샷: 헛스윙 1');
    expect(lines).toContain('아이언: 벙커 1 · 헛스윙 1');
    expect(lines).toContain('헛스윙 2번이 타수에 들어갔습니다.');
  });

  it('shows a round saved before the rename under 아이언: the stored key and its tags stay `approach` (v20)', () => {
    const holes = Array.from({ length: 18 }, () => ({ par: 4, driver: 0, approach: 0, putts: 0, ob: 0, mulligan: 0 }));
    holes[0] = { ...holes[0], driver: 1, approach: 2, putts: 1, tags: { approach: ['hazard', 'short'] } } as typeof holes[0];
    const round = parseRound(JSON.stringify({ version: 1, date: '2026-11-19', current: 1, holes }))!;
    expect(round.holes[0]).toMatchObject({ approach: 2, tags: { approach: ['hazard', 'short'] } });
    const text = [...detailLines(analyze(round)), reportText(round), analysisText(round), roundCsv(round)].join('\n');
    expect(text).toContain('아이언: 짧음 1 · 해저드 1');
    expect(text).toContain('드라이버,아이언,퍼트');
    expect(text).not.toContain('어프로치');
  });
});
