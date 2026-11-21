// v28: 상세 splits the middle count (그린까지, stored as `approach`) into 세컨 and 어프로치. The split is an optional
// `short` count on a hole (the 어프로치 part); 세컨 is the rest. Rounds, backups and the live site's data from before
// load unchanged.
import { describe, expect, it } from 'vitest';
import {
  AREA_LABELS,
  PART_LABELS,
  SHOT_TAGS,
  TAG_LABELS,
  analyze,
  bump,
  bumpPart,
  emptyHole,
  isSplit,
  newRound,
  secondOf,
  setPart,
  shortOf,
  strokes,
  totals,
  type Hole,
  type Round,
} from '../src/round';
import { loadRound, parseRound, readRound, saveRound } from '../src/storage';
import { backupOf, backupText, parseBackup } from '../src/backup';
import { fingerprint, readHistory } from '../src/history';
import { analysisText, detailLines, insights, reportText, roundCsv } from '../src/report';
import { shareCardContent } from '../src/share-card';
import { LEGACY_TAGS, PANEL_ROWS, VIEWS, chooseViewTag, firstShot, viewRange } from '../src/shot-panel';

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

const hole = (par: 3 | 4 | 5, driver: number, approach: number, putts: number, extra: Partial<Hole> = {}): Hole =>
  ({ par, driver, approach, putts, ob: 0, hazard: 0, mulligan: 0, bunker: 0, ...extra });

/** A round with these holes, on the hole after the last of them (so all of them are finished). */
function roundOf(list: Hole[]): Round {
  const r = newRound(new Date(2026, 10, 21));
  list.forEach((h, i) => (r.holes[i] = h));
  r.current = list.length;
  return r;
}

/* ---------- saved by the live site (v18) and by v26: the shapes of their JSON, written by hand ---------- */

const PARS = [4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 3, 4, 4, 5, 5, 3, 4, 4];
const blank = (par: number) => ({ par, driver: 0, approach: 0, putts: 0, ob: 0, hazard: 0, mulligan: 0, bunker: 0 });

/** As the live site (v18) saves a round: tags on all three clubs, an approach's old 벙커 tag, an OB added by a tag. */
const V18_ROUND = {
  version: 1,
  date: '2026-11-20',
  current: 3,
  holes: [
    { par: 4, driver: 1, approach: 2, putts: 2, ob: 0, hazard: 0, mulligan: 0, bunker: 1, tags: { driver: ['fairway'], approach: ['short', 'bunker'], putts: ['long'] } },
    { par: 4, driver: 2, approach: 1, putts: 2, ob: 1, hazard: 0, mulligan: 1, bunker: 0, tags: { driver: ['ob-right'] }, obByTag: 1 },
    { par: 5, driver: 1, approach: 2, putts: 1, ob: 0, hazard: 1, mulligan: 0, bunker: 0 },
    { par: 3, driver: 1, approach: 0, putts: 0, ob: 0, hazard: 0, mulligan: 0, bunker: 0 },
    ...PARS.slice(4).map(blank),
  ],
  lastEdited: 1763600000000,
  course: { id: 'everis', name: '에버리스 골프리조트', front: '새별', back: '레이크' },
};

/** As v26 saves a 9-hole round finished with 라운드 마치기, its last hole a chip-in. */
const V26_ROUND = {
  version: 1,
  date: '2026-11-21',
  current: 8,
  holes: [
    ...PARS.slice(0, 8).map((par) => ({ ...blank(par), driver: 1, approach: par - 3, putts: 2 })),
    { par: 4, driver: 1, approach: 2, putts: 0, ob: 0, hazard: 0, mulligan: 0, bunker: 0, tags: { approach: [null, 'green'] } },
  ],
  lastEdited: 1763700000000,
  course: { id: 'everis', name: '에버리스 골프리조트', front: '새별', back: '' },
  closed: true,
};

describe('rounds and backups saved before the split', () => {
  it('reads a round the live site (v18) saved exactly as it was, with nothing to keep aside and no split', () => {
    const read = readRound(JSON.stringify(V18_ROUND));
    expect(read).not.toBeNull();
    expect(read!.lossy).toBe(false);
    expect(read!.round).toEqual(V18_ROUND);
    expect(read!.round.holes.some((h) => 'short' in h)).toBe(false);
    // Its numbers are what they were: the split adds nothing to a round that has none.
    const a = analyze(read!.round);
    expect(a.totals.strokes).toBe(5 + 6 + 5);
    expect(a.lost).toEqual({ driver: 1, approach: 1, putts: 0, penalty: 2 });
    expect(a.split).toEqual({ holes: 0, second: 0, short: 0, lost: { second: 0, short: 0 }, gir: 0, upDown: { made: 0, chances: 0 } });
  });

  it('reads a 9-hole round v26 saved exactly as it was', () => {
    const read = readRound(JSON.stringify(V26_ROUND));
    expect(read!.lossy).toBe(false);
    expect(read!.round).toEqual(V26_ROUND);
    expect(analyze(read!.round).totals.holes).toBe(9);
  });

  it('reads a backup file of those rounds, and writes them back the same', () => {
    const file = JSON.stringify({
      app: 'fairway-note', format: 1, exportedAt: '2026-11-21T03:00:00.000Z', current: V26_ROUND,
      history: [{ id: 'live-1', endedAt: 1763650000000, round: { ...V18_ROUND, current: 4 } }],
    });
    const read = parseBackup(file);
    expect(read).toEqual({ ok: true, invalid: 0, current: V26_ROUND, history: [{ id: 'live-1', endedAt: 1763650000000, round: { ...V18_ROUND, current: 4 } }] });
    if (!read.ok) return;
    const again = parseBackup(backupText(backupOf(read.current!, read.history, new Date(2026, 10, 21))));
    expect(again).toMatchObject({ ok: true, invalid: 0, current: V26_ROUND, history: read.history });
  });

  it('keeps the fingerprint of a round without a split as before, so a backup made before still matches its kept round', () => {
    const r = parseRound(JSON.stringify(V18_ROUND))!;
    expect(fingerprint(r).split(';')[0]).toBe('2026-11-20|4:1:2:2:0:0:0:1:fairway:short,bunker:long:0');
    expect(fingerprint(r).split(';')[1]).toBe('4:2:1:2:1:0:1:0:ob-right:::1');
  });
});

describe('the split on a hole', () => {
  it('is unknown on a new hole and on one entered in 기본: 세컨 is the whole count, 어프로치 none', () => {
    const h = hole(4, 1, 2, 2);
    expect(isSplit(emptyHole())).toBe(false);
    expect('short' in emptyHole()).toBe(false);
    expect([isSplit(h), secondOf(h), shortOf(h)]).toEqual([false, 2, 0]);
    // 기본's ± leaves it unknown.
    const more = bump(h, 'approach', 1);
    expect(more).toEqual({ ...h, approach: 3 });
    expect(bump(more, 'approach', -2)).toEqual({ ...h, approach: 1 });
  });

  it('is recorded by the first change to 세컨 or 어프로치: 세컨 ± moves the total only, 어프로치 ± moves both', () => {
    const h = hole(4, 1, 2, 2);
    const second = bumpPart(h, 'second', 1);
    expect(second).toEqual({ ...h, approach: 3, short: 0 });
    const short = bumpPart(h, 'short', 1);
    expect(short).toEqual({ ...h, approach: 3, short: 1 });
    expect([secondOf(short), shortOf(short), strokes(short)]).toEqual([2, 1, 6]);
    expect(bumpPart(short, 'short', -1)).toEqual({ ...h, approach: 2, short: 0 });
    expect(bumpPart(short, 'second', -1)).toEqual({ ...h, approach: 2, short: 1 });
    expect(bumpPart(short, 'second', -2)).toEqual({ ...h, approach: 1, short: 1 });
  });

  it('changes nothing past the ends: no 세컨 or 어프로치 below 0, no stroke past 15 on the middle count', () => {
    const h = hole(4, 1, 0, 0);
    expect(bumpPart(h, 'second', -1)).toBe(h);
    expect(bumpPart(h, 'short', -1)).toBe(h);
    const full = hole(4, 1, 15, 0, { short: 3 });
    expect(bumpPart(full, 'second', 1)).toBe(full);
    expect(bumpPart(full, 'short', 1)).toBe(full);
    expect(bumpPart(hole(4, 1, 13, 0, { short: 1 }), 'short', 5)).toEqual(hole(4, 1, 15, 0, { short: 3 }));
  });

  it('takes 기본\'s ± on a split hole as 세컨, and its − as 어프로치 once 세컨 is 0 (the total never drops below 어프로치)', () => {
    const h = hole(4, 1, 3, 2, { short: 1 });
    expect(bump(h, 'approach', 1)).toEqual({ ...h, approach: 4, short: 1 });
    expect(bump(h, 'approach', -1)).toEqual({ ...h, approach: 2, short: 1 });
    expect(bump(h, 'approach', -2)).toEqual({ ...h, approach: 1, short: 1 });
    expect(bump(h, 'approach', -3)).toEqual({ ...h, approach: 0, short: 0 });
    const none = hole(4, 1, 0, 0, { short: 0 });
    expect(bump(none, 'approach', -1)).toBe(none);
  });

  it('sets a part straight to a number, and records the split even when the number is already right', () => {
    const h = hole(4, 1, 2, 2);
    expect(setPart(h, 'short', 2)).toEqual({ ...h, approach: 4, short: 2 });
    expect(setPart(h, 'second', 1)).toEqual({ ...h, approach: 1, short: 0 });
    // 어프로치 0 on a hole from 기본: now it is known that all of it was 세컨.
    expect(setPart(h, 'short', 0)).toEqual({ ...h, short: 0 });
    const split = hole(4, 1, 2, 2, { short: 1 });
    expect(setPart(split, 'short', 1)).toBe(split);
    // Within 15 on the middle count.
    expect(setPart(split, 'short', 20)).toEqual({ ...split, approach: 15, short: 14 });
  });

  it('keeps the middle count\'s shot details as one list, 세컨 first, so each detail stays with its shot', () => {
    const h = hole(4, 1, 3, 2, { short: 1, tags: { approach: ['left', 'green', 'close'] } });
    // A 세컨 more goes in after the last 세컨: the 어프로치's 붙음 moves along with its shot.
    expect(bumpPart(h, 'second', 1).tags).toEqual({ approach: ['left', 'green', null, 'close'] });
    // A 세컨 less takes the last 세컨 and its detail; an 어프로치 less takes the last shot.
    expect(bumpPart(h, 'second', -1)).toEqual({ ...h, approach: 2, tags: { approach: ['left', 'close'] } });
    expect(bumpPart(h, 'short', -1)).toEqual({ ...h, approach: 2, short: 0, tags: { approach: ['left', 'green'] } });
    // 기본's − on a split hole is a 세컨 less, so the 어프로치 keeps its 붙음.
    expect(bump(h, 'approach', -1).tags).toEqual({ approach: ['left', 'close'] });
    // An 어프로치 more comes last.
    expect(bumpPart(h, 'short', 1)).toEqual({ ...h, approach: 4, short: 2 });
  });
});

describe('analysis with split holes', () => {
  // Hole 1 (par 4): 세컨 1, no 어프로치, 2 putts: on in regulation. Hole 2 (par 4): 세컨 1, 어프로치 1, 1 putt: up and
  // down. Hole 3 (par 5): 세컨 3, 어프로치 2, 2 putts. Hole 4 (par 4): entered in 기본, 그린까지 2. Hole 5 (par 3):
  // 세컨 1 (the tee shot missed), 어프로치 1, a chip-in.
  const r = roundOf([
    hole(4, 1, 1, 2, { short: 0 }),
    hole(4, 1, 2, 1, { short: 1 }),
    hole(5, 1, 5, 2, { short: 2 }),
    hole(4, 1, 2, 2),
    hole(3, 1, 2, 0, { short: 1 }),
  ]);

  it('keeps every combined number as it was: totals, strokes lost and greens in regulation', () => {
    const unsplit = roundOf(r.holes.slice(0, 5).map(({ short: _short, ...x }) => x));
    const [a, b] = [analyze(r), analyze(unsplit)];
    expect(a.totals).toEqual(b.totals);
    expect(a.lost).toEqual(b.lost);
    expect(a.worstAreas).toEqual(b.worstAreas);
    expect(a.girHoles).toBe(b.girHoles);
    expect(totals(r)).toEqual(totals(unsplit));
  });

  it('adds 세컨 against Par−3 and 어프로치 against none, over the split holes only, and counts them', () => {
    const s = analyze(r).split;
    expect(s.holes).toBe(4);
    expect([s.second, s.short]).toEqual([1 + 1 + 3 + 1, 0 + 1 + 2 + 1]);
    // 세컨 over Par−3: hole 3 has 3 on a par 5 (+1), hole 5 has 1 on a par 3 (+1). Every 어프로치 is one.
    expect(s.lost).toEqual({ second: 2, short: 4 });
  });

  it('counts a green in regulation by the split only with no 어프로치, and an up and down as one 어프로치 then one putt or none', () => {
    const s = analyze(r).split;
    expect(s.gir).toBe(1);
    expect(s.upDown).toEqual({ made: 2, chances: 3 });
  });

  it('leaves a hole being played out of it, as every other number does', () => {
    const playing = roundOf([hole(4, 1, 1, 2, { short: 0 })]);
    playing.holes[1] = hole(4, 1, 1, 0, { short: 1 });
    playing.current = 1;
    expect(analyze(playing).split.holes).toBe(1);
  });

  it('sorts the middle count\'s details by part on split holes, and keeps 그린까지 for the others', () => {
    const tagged = roundOf([
      hole(4, 1, 2, 1, { short: 1, tags: { approach: ['green', 'close'] } }),
      hole(4, 1, 2, 2, { tags: { approach: ['short'] } }),
      hole(4, 1, 2, 0, { short: 1, tags: { approach: [null, 'in'] } }),
    ]);
    const d = analyze(tagged).details!;
    expect(d.second).toEqual({ green: 1 });
    expect(d.short).toEqual({ close: 1, in: 1 });
    expect(d.approach).toEqual({ short: 1 });
    expect(detailLines(analyze(tagged))).toEqual(['그린까지: 짧음 1', '세컨: 온그린 1', '어프로치: 붙음 1 · 칩인 1']);
  });

  it('names the combined count 그린까지, and the parts 세컨 and 어프로치', () => {
    expect(AREA_LABELS.approach).toBe('그린까지');
    expect(PART_LABELS).toEqual({ second: '세컨', short: '어프로치' });
    expect(TAG_LABELS.approach).toMatchObject({ close: '붙음', in: '칩인', mishit: '뒤땅/토핑' });
  });

  it('says what the split holes show, only when there are some', () => {
    const lines = insights(analyze(r));
    expect(lines[0]).toContain('기준(티샷 1, 그린까지 Par−3, 퍼트 2)');
    expect(lines).toContain('상세로 나눈 4홀에서 세컨은 기준(Par−3)보다 +2타, 어프로치는 +4타입니다.');
    expect(lines).toContain('업앤다운은 3번 중 2번 (67%)입니다.');
    const none = insights(analyze(roundOf([hole(4, 1, 2, 2)])));
    expect(none.join('\n')).not.toMatch(/세컨|어프로치|업앤다운/);
  });
});

describe('the round in words, in a spreadsheet and in the share image', () => {
  const r = roundOf([hole(4, 1, 1, 2), hole(4, 1, 2, 2, { short: 1, tags: { approach: ['green', 'close'] } }), hole(3, 1, 1, 0, { short: 1 })]);

  it('writes 그린까지 on every hole, and 세컨 and 어프로치 inside it on a split hole', () => {
    const text = reportText(r);
    expect(text).toContain('[홀별] 타수 = 드라이버 + 그린까지(세컨 + 어프로치) + 퍼트 + 벌타(OB·해저드)');
    expect(text).toContain('1번 Par4: 4타 (E) 드1 그1 퍼2');
    expect(text).toContain('2번 Par4: 5타 (+1) 드1 그2(세1 어1) 퍼2 · 세 온그린 · 어 붙음');
    expect(text).toContain('3번 Par3: 2타 (-1) 드1 그1(세0 어1) 퍼0');
    expect(text).toContain('세컨·어프로치 (상세로 나눈 2홀): 그린 적중 0/2 · 업앤다운 1/2');
    // Without a split hole the header says 그린까지 alone.
    expect(reportText(roundOf([hole(4, 1, 1, 2)]))).toContain('[홀별] 타수 = 드라이버 + 그린까지 + 퍼트 + 벌타(OB·해저드)');
  });

  it('adds 세컨 and 어프로치 as the CSV\'s last columns, so the columns before them stay where they were', () => {
    const rows = roundCsv(r).split('\r\n');
    expect(rows[0]).toBe('홀,파,드라이버,그린까지,퍼트,OB,해저드,타수,파 대비,세컨,어프로치');
    expect(rows[1]).toBe('1,4,1,1,2,0,0,4,0,,');
    expect(rows[2]).toBe('2,4,1,2,2,0,0,5,1,1,1');
    expect(rows[3]).toBe('3,3,1,1,0,0,0,2,-1,0,1');
    expect(rows[4]).toBe('4,3,,,,,,,,,');
    expect(rows[19]).toBe('합계,11,3,4,4,0,0,11,0,1,2');
    expect(roundCsv(roundOf([hole(4, 1, 1, 2)])).split('\r\n')[19]).toBe('합계,4,1,1,2,0,0,4,0,,');
  });

  it('copies the split for analysis: per hole, and the strokes lost against its own pattern', () => {
    const text = analysisText(r);
    expect(text).toContain('[홀별] 홀 | 파 | 드라이버 | 그린까지 | 세컨 | 어프로치 | 퍼트 | OB | 해저드 | 타수 | 파 대비');
    expect(text).toContain('1 | 4 | 1 | 1 | - | - | 2 | 0 | 0 | 4 | E');
    expect(text).toContain('2 | 4 | 1 | 2 | 1 | 1 | 2 | 0 | 0 | 5 | +1');
    expect(text).toContain('[잃은 타수] 기준: 티샷 1번, 그린까지 파-3번, 퍼트 2번');
    // Hole 2 has 그린까지 2 on a par 4 and hole 3 one on a par 3: +1 each.
    expect(text).toContain('티샷 +0 · 그린까지 +2 · 퍼트 +0 · 벌타 +0');
    expect(text).toContain('상세로 나눈 2홀, 기준: 세컨 파-3번, 어프로치 0번');
    expect(text).toContain('세컨 +0 · 어프로치 +2');
    expect(text).toContain('그린 적중(어프로치 없이) 0/2 · 업앤다운 1/2');
  });

  it('shows the up and down rate in the share image only when the round has a chance at one', () => {
    expect(shareCardContent(r).stats.map((s) => s.key)).toEqual(['putts', 'gir', 'fairway', 'penalty', 'best', 'updown']);
    expect(shareCardContent(r).stats.at(-1)).toEqual({ key: 'updown', label: '업앤다운', value: '1/2', sub: '' });
    expect(shareCardContent(roundOf([hole(4, 1, 1, 2, { short: 0 })])).stats.map((s) => s.key)).toEqual(['putts', 'gir', 'fairway', 'penalty', 'best']);
  });
});

describe('saving the split', () => {
  it('round-trips a split round, 어프로치 0 included, through storage, a backup and the past rounds', () => {
    const r = roundOf([hole(4, 1, 2, 2, { short: 0 }), hole(4, 1, 3, 1, { short: 2, tags: { approach: [null, 'close', 'in'] } }), hole(4, 1, 2, 2)]);
    const kv = memory();
    expect(saveRound(r, kv)).toBe(true);
    expect(loadRound(kv)).toEqual(r);
    expect(readRound(JSON.stringify(r))!.lossy).toBe(false);
    const backup = parseBackup(backupText(backupOf(r, [{ id: 'k', endedAt: 1, round: r }], new Date(2026, 10, 21))));
    expect(backup).toMatchObject({ ok: true, invalid: 0, current: r });
    expect(readHistory(JSON.stringify([{ id: 'k', endedAt: 1, round: r }]))).toEqual({ entries: [{ id: 'k', endedAt: 1, round: r }], lossy: false });
  });

  it('tells a split round from the same round without it, by fingerprint', () => {
    const plain = roundOf([hole(4, 1, 2, 2)]);
    const split = roundOf([hole(4, 1, 2, 2, { short: 1 })]);
    expect(fingerprint(split)).not.toBe(fingerprint(plain));
    expect(fingerprint(split).split('|')[1].split(';')[0]).toBe('4:1:2:2:0:0:0:0::::0:s1');
  });

  it('drops a split it cannot read but keeps the hole and its score, and keeps the original aside', () => {
    for (const short of [3, -1, 1.5, '1', null]) {
      const text = JSON.stringify({ ...V18_ROUND, holes: V18_ROUND.holes.map((h, i) => (i === 0 ? { ...h, short } : h)) });
      const read = readRound(text);
      expect(read, String(short)).not.toBeNull();
      expect(read!.lossy, String(short)).toBe(true);
      expect(read!.round.holes[0], String(short)).toEqual(V18_ROUND.holes[0]);
    }
  });
});

describe('the detail panels of 세컨 and 어프로치', () => {
  it('offers every detail of the middle count in one of its panels, or keeps it to read', () => {
    const offered = new Set([...PANEL_ROWS.approach, ...PANEL_ROWS.second, ...PANEL_ROWS.short].flat());
    expect([...offered, ...(LEGACY_TAGS.approach ?? [])].sort()).toEqual([...SHOT_TAGS.approach].sort());
    expect(PANEL_ROWS.second).toEqual(PANEL_ROWS.approach);
    expect(PANEL_ROWS.short).toEqual([['left', 'close', 'right'], ['long', 'short'], ['in', 'mishit']]);
    expect(VIEWS).toEqual(['driver', 'approach', 'second', 'short', 'putts']);
  });

  it('shows 세컨 the first shots of the middle count and 어프로치 the rest', () => {
    const h = hole(4, 1, 3, 2, { short: 1 });
    expect(viewRange(h, 'second')).toEqual([0, 2]);
    expect(viewRange(h, 'short')).toEqual([2, 3]);
    expect(viewRange(h, 'approach')).toEqual([0, 3]);
    // A hole from 기본: all of it is 세컨 until it is split.
    expect(viewRange(hole(4, 1, 2, 2), 'second')).toEqual([0, 2]);
    expect(viewRange(hole(4, 1, 2, 2), 'short')).toEqual([2, 2]);
    expect(firstShot(h, 'second')).toBe(1);
    expect(firstShot(h, 'short')).toBe(0);
  });

  it('writes a chip on the right shot of the one list, records the split, and from none counts that part\'s first shot', () => {
    const h = hole(4, 1, 3, 2, { short: 1 });
    expect(chooseViewTag(h, 'short', 0, 'close').tags).toEqual({ approach: [null, null, 'close'] });
    expect(chooseViewTag(h, 'second', 1, 'green').tags).toEqual({ approach: [null, 'green'] });
    const plain = hole(4, 1, 2, 2);
    expect(chooseViewTag(plain, 'second', 0, 'left')).toEqual({ ...plain, short: 0, tags: { approach: ['left'] } });
    expect(chooseViewTag(plain, 'short', 0, 'in')).toEqual({ ...plain, approach: 3, short: 1, tags: { approach: [null, null, 'in'] } });
    // A 세컨 counted from none goes in before the 어프로치s.
    const chips = hole(4, 1, 1, 1, { short: 1, tags: { approach: ['close'] } });
    expect(chooseViewTag(chips, 'second', 0, 'right')).toEqual({ ...chips, approach: 2, tags: { approach: ['right', 'close'] } });
    // The same chip again clears it.
    expect(chooseViewTag(chooseViewTag(h, 'short', 0, 'close'), 'short', 0, 'close').tags).toBeUndefined();
  });
});
