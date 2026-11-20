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
  /** Where the tee box is drawn: behind 다음 홀, so none of it peeks out between the button and the tab bar (v14). */
  teeY?: number;
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
  /** The angle of the line of play, for the mowing stripes across it. */
  angle: number;
  /** 100 m and 150 m to the green, where a tall band shows the approach and the hole is long enough for them. */
  markers: { x: number; y: number; d: number }[];
}

// Per-hole variety without inventing features: where the pin stands and the outline of the green.
const PIN = [[0.3, -0.1], [-0.32, 0.05], [0.12, -0.2], [0.36, 0.1], [-0.3, -0.12], [0.24, 0.12], [-0.2, -0.1], [0.3, 0.05], [-0.26, -0.15],
  [0.2, 0.1], [-0.34, 0], [0.28, -0.12], [-0.14, 0.12], [0.32, -0.05], [-0.22, 0.1], [0.3, -0.1], [-0.3, 0.06], [0.16, -0.1]];
const GREENS = [[1, 0.92, 1.06, 0.95, 1.02, 0.9, 1.04, 0.97], [0.95, 1.05, 0.92, 1.04, 0.97, 1.06, 0.9, 1.02], [1.04, 0.9, 1.02, 0.96, 1.07, 0.93, 0.98, 1.03]];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** The open band from which the approach shows: the green near its top, then the fairway with distance markers. */
export const ROOMY_BAND = 110;

/**
 * `length` is the hole's official length in metres when the course publishes one: it decides which distance markers
 * a tall band shows (a marker only where the hole is at least 60 m longer than it).
 */
export function courseShape(par: Par, index: number, frame: CourseFrame, bend: Bend, island = false, length: number | null = null): CourseShape {
  const { width: W, height: H, bandTop, bandBottom, right } = frame;
  const i = ((index % PIN.length) + PIN.length) % PIN.length;
  const k = par === 3 ? 0 : par === 4 ? 1 : 2;
  const band = bandBottom - bandTop;
  const roomy = band >= ROOMY_BAND;
  // A par 3's green is near and large; a par 5's is far and small. Smaller where the approach shows too, and a par 3's
  // no wider than 17% of the screen there, so a tall band does not fill with green (v14).
  const rx0 = W * [0.27, 0.2, 0.165][k] * (roomy ? 0.8 : 1);
  const rx = roomy && k === 0 ? Math.min(rx0, W * 0.17) : rx0;
  const ry = rx * 0.66;
  const turn = k === 0 ? 0 : bend;
  const cx = clamp(Math.min(W * 0.47, right - rx * 0.75) + turn * W * 0.12, rx, right - rx * 0.75);
  // A shorter pole on a short band, so phones (a 24px band) still show the flag.
  const pole = roomy ? [40, 34, 30][k] : band >= 30 ? Math.max(18, Math.min([40, 34, 30][k], band - 16)) : Math.max(14, band - 8);
  // The pin and flag stand in the open band: near its top when it is tall, else just above the sheet's edge. On a tall
  // band an island green sits low enough that its water starts below the chips.
  const pinY = roomy ? Math.max(bandTop + pole + 6, island ? bandTop + 6 + ry * 1.6 : 0) : band > 40 ? bandBottom - 10 : bandBottom - 4;
  const cy = pinY + ry * 0.18;
  const tee = { x: W / 2, y: frame.teeY ?? H - [64, 56, 52][k], width: W * [0.3, 0.26, 0.24][k] };

  let fairway: [number, number][] | null = null;
  const markers: CourseShape['markers'] = [];
  const y0 = cy + ry * 0.7;
  const y1 = tee.y - 36;
  // Straight from the green to the tee; a dogleg runs straight off the tee and turns toward the green.
  const at = (t: number): [number, number] => [turn ? tee.x + (cx - tee.x) * (1 - t) ** 2 : cx + (tee.x - cx) * t, y0 + (y1 - y0) * t];
  if (k > 0) {
    // Half-widths along the hole; a par 5 narrows between two landing areas.
    const half = k === 1 ? [0.15, 0.22, 0.33, 0.43, 0.5, 0.52, 0.44] : [0.12, 0.18, 0.27, 0.23, 0.35, 0.48, 0.42];
    const ts = [0, 0.12, 0.3, 0.5, 0.7, 0.88, 1];
    const rightSide = ts.map((t, j): [number, number] => [at(t)[0] + W * half[j], at(t)[1]]);
    const leftSide = ts.map((t, j): [number, number] => [at(t)[0] - W * half[j], at(t)[1]]).reverse();
    const [topX, topY] = at(0);
    const [botX, botY] = at(1);
    fairway = [[topX, topY - ry * 0.25], ...rightSide, [botX, botY + 14], ...leftSide];
    // Distance markers from the real length, only in a band tall enough to show the approach.
    if (roomy && length !== null) {
      for (const d of [100, 150]) {
        if (length < d + 60) continue;
        const y = y0 + (bandBottom - 6 - y0) * (d / 165);
        if (y > bandBottom - 14) continue;
        markers.push({ x: at((y - y0) / (y1 - y0))[0], y, d });
      }
    }
  }

  return {
    green: { cx, cy, rx, ry, outline: GREENS[i % GREENS.length] },
    pin: band >= 24 ? { x: cx + rx * PIN[i][0], y: pinY, pole } : null,
    tee,
    fairway,
    water: island,
    angle: (Math.atan2(y0 - y1, cx - tee.x) * 180) / Math.PI,
    markers,
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

/**
 * A 40×28 picture of the hole for the header of a short screen, where the drawn band has no room (v15). Facing the
 * green, tee at the left and green at the right: a par 3 is a carry to a green, a par 4 or 5 a fairway, a dogleg turns
 * up (left) or down (right), and an island green has water round it. Decorative and built from numbers only.
 */
export function holeThumb(par: Par, bend: Bend, island: boolean): string {
  const k = par === 3 ? 0 : par === 4 ? 1 : 2;
  const turn = k === 0 ? 0 : bend;
  const g = { cx: [26, 31, 33][k], cy: 14 + turn * 6, rx: [7.5, 5.5, 4.5][k], ry: [6, 4.5, 4][k] };
  const teeX = [5, 4, 3][k];
  const out = ['<svg viewBox="0 0 40 28" width="40" height="28" aria-hidden="true" focusable="false"><rect width="40" height="28" fill="#3E6B2E"/>'];
  if (k > 0) {
    // Straight off the tee, turning toward the green in the last third.
    out.push(`<path class="th-fairway" d="M${teeX + 3} 14Q${f(g.cx - 4)} 14 ${f(g.cx - g.rx * 0.6)} ${f(g.cy)}" fill="none" stroke="#5BAA4F" stroke-width="${k === 1 ? 7 : 6}" stroke-linecap="round"/>`);
  }
  if (island) out.push(`<ellipse class="th-water" cx="${f(g.cx)}" cy="${f(g.cy)}" rx="${f(g.rx * 1.6)}" ry="${f(g.ry * 1.6)}" fill="#4F90B8"/>`);
  out.push(`<ellipse class="th-green" cx="${f(g.cx)}" cy="${f(g.cy)}" rx="${f(g.rx)}" ry="${f(g.ry)}" fill="#8CCB6E" stroke="#4E963F" stroke-width="1"/>`);
  out.push(`<rect x="${teeX - 2}" y="12" width="5" height="4" rx="1.5" fill="#A2D987"/>`);
  // The flag: a white pole and a red pennant, kept inside the picture.
  const top = Math.max(2, g.cy - 9);
  out.push(`<path d="M${f(g.cx)} ${f(g.cy)}V${f(top)}" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round"/><path d="M${f(g.cx + 0.5)} ${f(top)}l4 1.6-4 1.6z" fill="#D2402F"/>`);
  out.push('</svg>');
  return out.join('');
}

/** The SVG content for the course behind the screen. Decorative and built from numbers only. */
export function courseSvg(shape: CourseShape, frame: CourseFrame): string {
  const { width: W, height: H } = frame;
  const { green: g, pin, tee, fairway } = shape;
  const out: string[] = [
    '<defs>',
    // Two-tone rough with a short grain, a vignette and a shade under the header.
    '<radialGradient id="course-rough" cx="50%" cy="46%" r="78%"><stop offset="0" stop-color="#4B7C38"/><stop offset="0.62" stop-color="#3E6B2E"/><stop offset="1" stop-color="#30561F"/></radialGradient>',
    '<pattern id="course-grain" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M2 4l1.1-2.2M9 10l1-2.3M13 4.5l.8-2M5.5 14l1-2.1M12 15l.8-1.8" stroke="#2A4F20" stroke-width="1.1" stroke-linecap="round" opacity=".55"/><path d="M4.5 8.5l.9-1.9M11 1.5l.7-1.4M15 11l.7-1.6M1 13l.8-1.7" stroke="#6A9C52" stroke-width="1" stroke-linecap="round" opacity=".4"/></pattern>',
    // Mowing stripes across the line of play.
    `<pattern id="course-mow" width="44" height="44" patternUnits="userSpaceOnUse" patternTransform="rotate(${f(shape.angle)})"><rect width="22" height="44" fill="#67B45B"/></pattern>`,
    '<radialGradient id="course-dome" cx="40%" cy="34%" r="72%"><stop offset="0" stop-color="#A6DA8C"/><stop offset="0.7" stop-color="#8FCC71"/><stop offset="1" stop-color="#7FC163"/></radialGradient>',
    '<radialGradient id="course-vignette" cx="50%" cy="50%" r="75%"><stop offset="0.62" stop-color="#0B200D" stop-opacity="0"/><stop offset="1" stop-color="#0B200D" stop-opacity=".38"/></radialGradient>',
    '<linearGradient id="course-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B200D" stop-opacity=".42"/><stop offset=".22" stop-color="#0B200D" stop-opacity="0"/></linearGradient>',
    '<linearGradient id="course-teebox" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A2D987"/><stop offset="1" stop-color="#84C468"/></linearGradient>',
    // Faint mowing bands on the green, across the line of play (rings read as contours).
    `<pattern id="course-gmow" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(${f(shape.angle + 90)})"><rect width="7" height="14" fill="#FFFFFF"/></pattern>`,
    // An island green's water fades in over 30px below the top of the open band, under the chips.
    `<linearGradient id="course-wfade" gradientUnits="userSpaceOnUse" x1="0" y1="${frame.bandTop}" x2="0" y2="${frame.bandTop + 30}"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>`,
    `<mask id="course-wmask"><rect width="${W}" height="${H}" fill="url(#course-wfade)"/></mask>`,
    '</defs>',
    `<rect width="${W}" height="${H}" fill="url(#course-rough)"/><rect width="${W}" height="${H}" fill="url(#course-grain)"/>`,
  ];
  if (fairway) {
    const d = smooth(fairway);
    // The rough's darker edge, the first cut, the fairway, then its stripes.
    out.push(`<path d="${d}" fill="none" stroke="#386A2B" stroke-width="20" stroke-linejoin="round"/>`);
    out.push(`<path d="${d}" fill="none" stroke="#549F47" stroke-width="10" stroke-linejoin="round"/>`);
    out.push(`<path class="fairway" d="${d}" fill="#5BAA4F"/><path d="${d}" fill="url(#course-mow)"/>`);
  }
  const ring = (s: number) => g.outline.map((r, j): [number, number] => {
    const a = (j / g.outline.length) * Math.PI * 2;
    return [g.cx + Math.cos(a) * g.rx * r * s, g.cy + Math.sin(a) * g.ry * r * s];
  });
  if (shape.water) {
    out.push(`<g mask="url(#course-wmask)"><path class="water" d="${smooth(ring(1.78))}" fill="#4F90B8"/>`);
    out.push(`<path d="${smooth(ring(1.66))}" fill="none" stroke="#86BCD9" stroke-width="2.5" opacity=".8"/>`);
    out.push(`<path d="${smooth(ring(1.5))}" fill="none" stroke="#6FA9CB" stroke-width="1.5" stroke-dasharray="10 14" opacity=".7"/></g>`);
  }
  // The green: its fringe, a softly domed surface and faint mowing bands.
  out.push(`<path d="${smooth(ring(1.17))}" fill="#6CB257" stroke="#4E963F" stroke-width="1.5"/>`);
  out.push(`<path class="green" d="${smooth(ring(1))}" fill="url(#course-dome)"/>`);
  out.push(`<path d="${smooth(ring(1))}" fill="url(#course-gmow)" opacity=".07"/>`);
  if (pin) {
    // The pole's shadow, the cup, the pole and a flag that waves.
    const fw = Math.max(13, pin.pole * 0.46);
    const fh = Math.max(10, pin.pole * 0.34);
    const top = pin.y - pin.pole;
    const x = pin.x;
    out.push(`<path d="M${f(x)} ${f(pin.y)}l${f(pin.pole * 0.6)} ${f(pin.pole * 0.22)}" stroke="#2F6A28" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/>`);
    out.push(`<ellipse cx="${f(x)}" cy="${f(pin.y)}" rx="3.6" ry="1.9" fill="#17301A"/>`);
    out.push(`<path d="M${f(x)} ${f(pin.y)}V${f(top)}" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>`);
    out.push(`<path class="flag" d="M${f(x + 1)} ${f(top)}C${f(x + fw * 0.4)} ${f(top - 2.5)} ${f(x + fw * 0.7)} ${f(top + fh * 0.2)} ${f(x + fw)} ${f(top + fh * 0.42)}C${f(x + fw * 0.66)} ${f(top + fh * 0.62)} ${f(x + fw * 0.34)} ${f(top + fh * 0.66)} ${f(x + 1)} ${f(top + fh * 0.84)}Z" fill="#D2402F"/>`);
    out.push(`<path d="M${f(x + 1)} ${f(top)}C${f(x + fw * 0.4)} ${f(top - 2.5)} ${f(x + fw * 0.55)} ${f(top + fh * 0.1)} ${f(x + fw * 0.62)} ${f(top + fh * 0.3)}L${f(x + 1)} ${f(top + fh * 0.5)}Z" fill="#A92E21" opacity=".55"/>`);
  }
  for (const m of shape.markers) {
    const w = m.d === 100 ? 46 : 48;
    out.push(`<g class="marker"><circle cx="${f(m.x)}" cy="${f(m.y)}" r="5.5" fill="#FFFFFF" stroke="#1E3B21" stroke-opacity=".35" stroke-width="1.5"/>`);
    out.push(`<rect x="${f(m.x + 10)}" y="${f(m.y - 11)}" width="${w}" height="22" rx="11" fill="#0E2410" fill-opacity=".66"/>`);
    out.push(`<text x="${f(m.x + 10 + w / 2)}" y="${f(m.y + 4.5)}" text-anchor="middle">${m.d} m</text></g>`);
  }
  // A bevelled tee box with two markers.
  out.push(`<rect x="${f(tee.x - tee.width / 2)}" y="${f(tee.y - 9)}" width="${f(tee.width)}" height="24" rx="10" fill="#5E9E4C"/>`);
  out.push(`<rect class="tee" x="${f(tee.x - tee.width / 2)}" y="${f(tee.y - 12)}" width="${f(tee.width)}" height="24" rx="10" fill="url(#course-teebox)"/>`);
  for (const dx of [-0.3, 0.3]) {
    out.push(`<ellipse cx="${f(tee.x + tee.width * dx)}" cy="${f(tee.y + 1.5)}" rx="4.5" ry="1.8" fill="#2F6A28" opacity=".5"/><circle cx="${f(tee.x + tee.width * dx)}" cy="${f(tee.y - 3)}" r="4.2" fill="#FFFFFF"/>`);
  }
  out.push(`<rect width="${W}" height="${H}" fill="url(#course-vignette)"/><rect width="${W}" height="${H}" fill="url(#course-shade)"/>`);
  return out.join('');
}
