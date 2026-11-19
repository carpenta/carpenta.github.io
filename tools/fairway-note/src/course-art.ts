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

/** An island green named in a hole's layout note ("아일랜드 홀"): the only water the drawing shows. */
export function layoutIsland(layout: string | undefined): boolean {
  return /아일랜드/.test(layout ?? '');
}

/** The screen the course is drawn behind, in CSS pixels. */
export interface CourseFrame {
  width: number;
  height: number;
  /** The open band between the top bar's info line and the sheet, where the green and its flag can be seen. */
  bandTop: number;
  bandBottom: number;
  /** The green keeps left of this (the score badge). */
  right: number;
}

/** Our own plan of a hole, tee at the bottom of the screen and green at the top. No bunkers are drawn, and water only round an island green the note names. */
export interface CourseShape {
  /** `outline` scales the green's radius at eight points round it, so each hole's green looks its own. */
  green: { cx: number; cy: number; rx: number; ry: number; outline: number[] };
  /** Null when the open band is too short to show the flag whole. */
  pin: { x: number; y: number; pole: number } | null;
  tee: { x: number; y: number; width: number };
  /** The fairway's outline, from in front of the tee to in front of the green; null on a par 3. */
  fairway: [number, number][] | null;
  /** Water round the green, for an island green. */
  water: boolean;
}

// Per-hole variety without inventing features: where the pin stands and the outline of the green.
const PIN = [[0.3, -0.1], [-0.32, 0.05], [0.12, -0.2], [0.36, 0.1], [-0.3, -0.12], [0.24, 0.12], [-0.2, -0.1], [0.3, 0.05], [-0.26, -0.15],
  [0.2, 0.1], [-0.34, 0], [0.28, -0.12], [-0.14, 0.12], [0.32, -0.05], [-0.22, 0.1], [0.3, -0.1], [-0.3, 0.06], [0.16, -0.1]];
const GREENS = [[1, 0.92, 1.06, 0.95, 1.02, 0.9, 1.04, 0.97], [0.95, 1.05, 0.92, 1.04, 0.97, 1.06, 0.9, 1.02], [1.04, 0.9, 1.02, 0.96, 1.07, 0.93, 0.98, 1.03]];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function courseShape(par: Par, index: number, frame: CourseFrame, bend: Bend, island = false): CourseShape {
  const { width: W, height: H, bandTop, bandBottom, right } = frame;
  const i = ((index % PIN.length) + PIN.length) % PIN.length;
  const k = par === 3 ? 0 : par === 4 ? 1 : 2;
  const band = bandBottom - bandTop;
  // A par 3's green is near and large; a par 5's is far and small.
  const rx = W * [0.27, 0.2, 0.165][k];
  const ry = rx * 0.66;
  const turn = k === 0 ? 0 : bend;
  const cx = clamp(Math.min(W * 0.47, right - rx * 0.75) + turn * W * 0.12, rx, right - rx * 0.75);
  // The pin and flag stand in the open band; the green tucks under the sheet's edge.
  const pinY = band > 40 ? bandBottom - 10 : bandBottom - 4;
  const pole = Math.max(18, Math.min([40, 34, 30][k], band - 16));
  const cy = pinY + ry * 0.18;
  const tee = { x: W / 2, y: H - [64, 56, 52][k], width: W * [0.3, 0.26, 0.24][k] };

  let fairway: [number, number][] | null = null;
  if (k > 0) {
    // Half-widths along the hole; a par 5 narrows between two landing areas.
    const half = k === 1 ? [0.15, 0.22, 0.33, 0.43, 0.5, 0.52, 0.44] : [0.12, 0.18, 0.27, 0.23, 0.35, 0.48, 0.42];
    const ts = [0, 0.12, 0.3, 0.5, 0.7, 0.88, 1];
    const y0 = cy + ry * 0.7;
    const y1 = tee.y - 36;
    // Straight from the green to the tee; a dogleg runs straight off the tee and turns toward the green.
    const at = (t: number): [number, number] => [turn ? tee.x + (cx - tee.x) * (1 - t) ** 2 : cx + (tee.x - cx) * t, y0 + (y1 - y0) * t];
    const rightSide = ts.map((t, j): [number, number] => [at(t)[0] + W * half[j], at(t)[1]]);
    const leftSide = ts.map((t, j): [number, number] => [at(t)[0] - W * half[j], at(t)[1]]).reverse();
    const [topX, topY] = at(0);
    const [botX, botY] = at(1);
    fairway = [[topX, topY - ry * 0.25], ...rightSide, [botX, botY + 14], ...leftSide];
  }

  return {
    green: { cx, cy, rx, ry, outline: GREENS[i % GREENS.length] },
    pin: band >= 30 ? { x: cx + rx * PIN[i][0], y: pinY, pole } : null,
    tee,
    fairway,
    water: island,
  };
}

const f = (n: number) => n.toFixed(1);

/** A closed curve through the points (Catmull-Rom as cubic Béziers). */
function smooth(pts: [number, number][]): string {
  const n = pts.length;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/** The SVG content for the course behind the screen. Decorative and built from numbers only. */
export function courseSvg(shape: CourseShape, frame: CourseFrame): string {
  const { width: W, height: H } = frame;
  const { green: g, pin, tee, fairway } = shape;
  const out: string[] = [
    '<defs>',
    '<radialGradient id="course-rough" cx="50%" cy="46%" r="75%"><stop offset="0" stop-color="#4A7B37"/><stop offset="0.6" stop-color="#3E6B2E"/><stop offset="1" stop-color="#335A27"/></radialGradient>',
    '<pattern id="course-mow" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)"><rect width="20" height="40" fill="#66B35A"/></pattern>',
    '<radialGradient id="course-dome" cx="42%" cy="38%" r="70%"><stop offset="0" stop-color="#9ED583"/><stop offset="1" stop-color="#8CCB6E"/></radialGradient>',
    '</defs>',
    `<rect width="${W}" height="${H}" fill="url(#course-rough)"/>`,
  ];
  if (fairway) {
    const d = smooth(fairway);
    out.push(`<path class="fairway" d="${d}" fill="#5BAA4F" stroke="#4C8A3E" stroke-width="14" stroke-linejoin="round" paint-order="stroke"/>`);
    out.push(`<path d="${d}" fill="url(#course-mow)"/>`);
  }
  const ring = (s: number) => g.outline.map((r, j): [number, number] => {
    const a = (j / g.outline.length) * Math.PI * 2;
    return [g.cx + Math.cos(a) * g.rx * r * s, g.cy + Math.sin(a) * g.ry * r * s];
  });
  if (shape.water) {
    out.push(`<path class="water" d="${smooth(ring(1.75))}" fill="#5E9DC2"/>`);
    out.push(`<path d="${smooth(ring(1.62))}" fill="none" stroke="#7FB4D3" stroke-width="3"/>`);
  }
  out.push(`<path d="${smooth(ring(1.14))}" fill="#74B95E"/>`);
  out.push(`<path class="green" d="${smooth(ring(1))}" fill="url(#course-dome)"/>`);
  if (pin) {
    const flag = Math.max(12, pin.pole * 0.42);
    out.push(`<path d="M${f(pin.x)} ${f(pin.y)}l${f(pin.pole * 0.55)} ${f(pin.pole * 0.2)}" stroke="#5E9B4C" stroke-width="2.5" stroke-linecap="round"/>`);
    out.push(`<ellipse cx="${f(pin.x)}" cy="${f(pin.y)}" rx="3.4" ry="1.8" fill="#17301A"/>`);
    out.push(`<path d="M${f(pin.x)} ${f(pin.y)}V${f(pin.y - pin.pole)}" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>`);
    out.push(`<path class="flag" d="M${f(pin.x + 1)} ${f(pin.y - pin.pole)}l${f(flag)} ${f(pin.pole * 0.15)}l${f(-flag)} ${f(pin.pole * 0.15)}z" fill="#C0392B"/>`);
  }
  out.push(`<rect class="tee" x="${f(tee.x - tee.width / 2)}" y="${f(tee.y - 12)}" width="${f(tee.width)}" height="24" rx="9" fill="#8CCB6E" stroke="#74B95E" stroke-width="2"/>`);
  out.push(`<circle cx="${f(tee.x - tee.width * 0.3)}" cy="${f(tee.y - 3)}" r="4" fill="#FFFFFF"/><circle cx="${f(tee.x + tee.width * 0.3)}" cy="${f(tee.y - 3)}" r="4" fill="#FFFFFF"/>`);
  return out.join('');
}
