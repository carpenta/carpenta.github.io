import type { Par } from './round';

/** -1 bends the drawn hole left, 1 right. */
export type Bend = -1 | 0 | 1;

/** A dogleg named in a hole's layout note: "우 도그렉", "왼쪽 도그랙", "오른쪽으로 휘는 도그레그". */
export function layoutBend(layout: string | undefined): Bend {
  if (!layout) return 0;
  const m = /(좌|왼|우|오른)[^,.·]{0,8}도그(?:렉|랙|레그)/.exec(layout);
  if (!m) return 0;
  return m[1] === '좌' || m[1] === '왼' ? -1 : 1;
}

/**
 * Our own schematic of a hole on a 60×100 grid, seen from the tee: tee box at the bottom, green at the top.
 * A par 3 is a carry over rough to a large, near green; a par 4 has a fairway; a par 5 a longer one to a smaller,
 * farther green. A dogleg moves the green to its side and curves the fairway's far end toward it.
 */
export interface HoleShape {
  tee: { x: number; y: number };
  green: { cx: number; cy: number; rx: number; ry: number };
  /** The fairway's centre line, a curve from (x1, y1) near the tee through (qx, qy) to (x2, y2) before the green. */
  fairway: { x1: number; y1: number; qx: number; qy: number; x2: number; y2: number } | null;
}

const MID = 30;

export function holeShape(par: Par, bend: Bend): HoleShape {
  const tee = { x: MID, y: 91 };
  if (par === 3) return { tee, green: { cx: MID, cy: 30, rx: 15, ry: 11 }, fairway: null };
  const far = par === 4 ? { y1: 78, y2: 31, cy: 19, rx: 11, ry: 8 } : { y1: 82, y2: 22, cy: 12, rx: 9, ry: 6.5 };
  const x2 = MID + bend * 12;
  return {
    tee,
    green: { cx: x2, cy: far.cy, rx: far.rx, ry: far.ry },
    fairway: { x1: MID, y1: far.y1, qx: MID, qy: far.y2 + 6, x2, y2: far.y2 },
  };
}

/** The drawn hole as inline SVG. Decorative (the text beside it says the same), built from numbers only. */
export function holeArt(par: Par, bend: Bend): string {
  const { tee, green, fairway } = holeShape(par, bend);
  const path = fairway
    ? `<path class="art-fairway" d="M${fairway.x1} ${fairway.y1}Q${fairway.qx} ${fairway.qy} ${fairway.x2} ${fairway.y2}" fill="none" stroke-width="15" stroke-linecap="round"/>`
    : '';
  const top = green.cy - 11;
  return [
    '<svg class="hole-art" viewBox="0 0 60 100" aria-hidden="true" focusable="false">',
    '<rect class="art-rough" width="60" height="100" rx="10"/>',
    path,
    `<ellipse class="art-green" cx="${green.cx}" cy="${green.cy}" rx="${green.rx}" ry="${green.ry}"/>`,
    `<path class="art-pin" d="M${green.cx} ${green.cy}V${top}" fill="none" stroke-width="1.2"/>`,
    `<path class="art-flag" d="M${green.cx} ${top}l6 2.5-6 2.5z"/>`,
    `<rect class="art-tee" x="${tee.x - 5}" y="${tee.y - 3}" width="10" height="6" rx="1.5"/>`,
    '</svg>',
  ].join('');
}
