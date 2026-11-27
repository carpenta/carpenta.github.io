import { analyze, finished, played, roundCourse, scoreName, scoreWord, strokes, teeTag, type Round, type ScoreName, type Totals } from './round';
import { dateLabel, rateSub } from './report';

/**
 * The round as a picture to share: a 1080×1350 PNG drawn on a canvas in the app's bundled font and no images, so it
 * works offline under the app's CSP. `shareCardContent` reads the numbers (from `analyze()`, as the round summary
 * does), `shareCardLayout` turns them into drawing operations (pure, unit-tested) and `drawShareCard` paints them.
 */

export const SHARE_CARD_SIZE = { width: 1080, height: 1350 } as const;
const W = SHARE_CARD_SIZE.width;
const H = SHARE_CARD_SIZE.height;
/** Side margin of the card's text. */
const M = 72;
/** The page's font stack (`--font` in style.css, v25): the bundled Pretendard, then the system's while it loads. */
const FONT = "'Pretendard', -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif";
/** The weights the image draws in, two of the bundled faces (fonts.css): 600 for labels, 800 for values, as on the page. */
export const SHARE_WEIGHTS = [600, 800] as const;

/** The image's colours: the app's palette (style.css), read from the page when the image is drawn (v19). */
export type SharePalette = Record<'turf' | 'putting' | 'ink' | 'deep' | 'paper' | 'red' | 'sand' | 'white' | 'pill' | 'muted' | 'line' | 'quiet' | 'sandTint' | 'sandLine' | 'sandBand' | 'tabInk' | 'mark', string>;
/** The palette token behind each of the image's colours. */
export const SHARE_TOKENS: Readonly<Record<keyof SharePalette, string>> = {
  turf: '--turf', putting: '--putting', ink: '--ink', deep: '--deep', paper: '--paper', red: '--red', sand: '--sand',
  white: '--white', pill: '--pill', muted: '--muted', line: '--line', quiet: '--quiet', sandTint: '--sand-tint',
  sandLine: '--sand', sandBand: '--sand-band', tabInk: '--tab-ink', mark: '--on-dark-2',
};
let C: SharePalette;
/** Sets the colours the image is drawn in: `readSharePalette()` in the app, a fixed set in tests. */
export function useSharePalette(palette: SharePalette): void {
  C = palette;
}
/** An opaque `#rrggbb` colour at opacity `a`, for the image's washes, shadows and rules. */
function alpha(color: string, a: number): string {
  const n = parseInt(color.slice(1, 7), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ---------- content: the numbers on the card ---------- */

export type Tone = 'under' | 'par' | 'over';

export interface ScorecardHole {
  /** 1–18. */
  hole: number;
  par: number;
  /** Strokes on a finished hole; null for a hole not finished (blank, or being played without a putt). */
  score: number | null;
  putts: number | null;
  mark: ScoreName | null;
  tone: Tone | null;
}

export interface ScorecardNine {
  key: 'front' | 'back';
  /** The nine's name, or 전반 9홀 / 후반 9홀 on a course without nine names (as the scorecard heads it). */
  title: string;
  label: '전반' | '후반';
  /** Par of all nine holes, as the scorecard's subtotal column shows it. */
  par: number;
  /** Strokes, score against par and putts over the nine's finished holes ('–' and '' with none). */
  strokes: string;
  toPar: string;
  tone: Tone | null;
  putts: string;
  holes: ScorecardHole[];
}

export interface CardStat {
  /**
   * updown (v28): only on a round with an 어프로치 recorded in 상세, the last of the row. entered (v47): an entered round's
   * row is its best hole and this word that it holds strokes only, in place of counts it does not have.
   */
  key: 'putts' | 'gir' | 'fairway' | 'penalty' | 'best' | 'updown' | 'entered';
  label: string;
  value: string;
  sub: string;
}

export interface ShareCardContent {
  course: string;
  /** "새별 · 레이크", "새별 9홀" for a 9-hole round, or empty for a course typed in by hand. */
  nines: string;
  date: string;
  /** The nine a 9-hole round was played on, as the round check finds it; null for an 18-hole round. */
  nine: 'front' | 'back' | null;
  total: string;
  /** 이븐, +9 or −2 (a real minus sign), as the scorecard reads it; empty with nothing finished. */
  toPar: string;
  tone: Tone | 'none';
  /** "18홀", "12/18홀", "9홀", or that nothing is recorded yet. */
  count: string;
  /** "파 72": the par of the finished holes the total is measured against; empty with nothing finished. */
  par: string;
  /** 전반 and 후반 totals; none for a 9-hole round. */
  halves: { label: '전반' | '후반'; strokes: string; toPar: string }[];
  scorecard: ScorecardNine[];
  stats: CardStat[];
}

const toneOf = (d: number): Tone => (d < 0 ? 'under' : d === 0 ? 'par' : 'over');
/** Score against par as the app's scorecard and summary read it: 이븐, +2, −1. */
const toParText = (n: number) => (n === 0 ? '이븐' : n > 0 ? `+${n}` : `−${-n}`);
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** One whole nine recorded and nothing on the other, as 라운드 마치기's check reads a 9-hole round. */
export function playedNine(round: Round): 'front' | 'back' | null {
  const blank = round.holes.flatMap((x, k) => (played(x) ? [] : [k]));
  const only = (from: number) => blank.length === 9 && blank.every((k) => k >= from && k < from + 9);
  return only(9) ? 'front' : only(0) ? 'back' : null;
}

/** Fairways hit, as the round summary counts them: finished par 4s and 5s whose tee shot has a 상세 result. */
export function fairwayHits(round: Round): { hit: number; drives: number } {
  const drives = round.holes.filter((x, i) => finished(round, i) && x.par >= 4 && teeTag(x) !== null);
  return { hit: drives.filter((x) => teeTag(x) === 'fairway').length, drives: drives.length };
}

function cardHole(round: Round, i: number): ScorecardHole {
  const x = round.holes[i];
  if (!finished(round, i)) return { hole: i + 1, par: x.par, score: null, putts: null, mark: null, tone: null };
  const s = strokes(x);
  // An entered round (v47) has no putts to show: its cells read "–", never 0.
  return { hole: i + 1, par: x.par, score: s, putts: round.entered ? null : x.putts, mark: scoreName(s - x.par), tone: toneOf(s - x.par) };
}

export function shareCardContent(round: Round): ShareCardContent {
  const a = analyze(round);
  const t = a.totals;
  const course = roundCourse(round);
  const nine = playedNine(round);
  const names: [string, string] = [course.front || '전반', course.back || '후반'];
  const half = (n: Totals) => ({ strokes: n.holes ? String(n.strokes) : '–', toPar: n.holes ? toParText(n.strokes - n.par) : '' });
  const nineCard = (start: 0 | 9): ScorecardNine => {
    const front = start === 0;
    const n = front ? a.front : a.back;
    return {
      key: front ? 'front' : 'back',
      title: (front ? course.front : course.back) || (front ? '전반 9홀' : '후반 9홀'),
      label: front ? '전반' : '후반',
      par: round.holes.slice(start, start + 9).reduce((sum, x) => sum + x.par, 0),
      ...half(n),
      tone: n.holes ? toneOf(n.strokes - n.par) : null,
      putts: n.holes && !a.entered ? String(n.putts) : '–',
      holes: Array.from({ length: 9 }, (_, k) => cardHole(round, start + k)),
    };
  };
  const both = course.front === course.back ? course.front : [course.front, course.back].filter(Boolean).join(' · ');
  const { hit, drives } = fairwayHits(round);
  const best = a.best ? round.holes[a.best.hole - 1] : null;
  const bestStat: CardStat = { key: 'best', label: '베스트 홀', value: a.best && best ? `${a.best.hole}번 홀` : '–', sub: a.best && best ? scoreWord(strokes(best), best.par) : '' };
  return {
    course: course.name,
    nines: nine ? `${names[nine === 'front' ? 0 : 1]} 9홀` : both,
    date: dateLabel(round.date),
    nine,
    total: t.holes ? String(t.strokes) : '–',
    toPar: t.holes ? toParText(a.toPar) : '',
    tone: t.holes ? toneOf(a.toPar) : 'none',
    count: !t.holes ? '기록한 홀이 없어요' : nine ? (t.holes === 9 ? '9홀' : `${t.holes}/9홀`) : t.holes === round.holes.length ? `${t.holes}홀` : `${t.holes}/${round.holes.length}홀`,
    par: t.holes ? `파 ${t.par}` : '',
    halves: nine ? [] : [{ label: '전반', ...half(a.front) }, { label: '후반', ...half(a.back) }],
    scorecard: nine === 'front' ? [nineCard(0)] : nine === 'back' ? [nineCard(9)] : [nineCard(0), nineCard(9)],
    // v47: an entered round shows its best hole and says it holds strokes only; putts, greens, fairways and penalties
    // were never entered, so they are not drawn as zeros.
    stats: a.entered ? [bestStat, { key: 'entered', label: '넣은 기록', value: '타수만', sub: '퍼트·벌타 없음' }] : [
      { key: 'putts', label: '퍼트', value: String(t.putts), sub: t.holes ? `홀당 ${one(a.puttsPerHole)}` : '' },
      { key: 'gir', label: '그린 적중', value: t.holes ? `${a.girHoles}/${t.holes}` : '–', sub: t.holes ? rateSub(a.girHoles, t.holes) : '' },
      { key: 'fairway', label: '페어웨이', value: drives ? `${hit}/${drives}` : '–', sub: drives ? rateSub(hit, drives) : '기록 없음' },
      { key: 'penalty', label: '벌타', value: `OB ${t.ob}`, sub: `해저드 ${t.hazard}` },
      bestStat,
      // 업앤다운 (v28): one 어프로치 then one putt or none, out of the split holes with an 어프로치.
      ...(a.split.upDown.chances
        ? [{ key: 'updown' as const, label: '업앤다운', value: `${a.split.upDown.made}/${a.split.upDown.chances}`, sub: rateSub(a.split.upDown.made, a.split.upDown.chances) }]
        : []),
    ],
  };
}

/** fairway-note-YYYY-MM-DD.png, after the round's date. */
export function shareCardFileName(round: Round): string {
  return `fairway-note-${round.date}.png`;
}

/* ---------- layout: drawing operations ---------- */

export interface Gradient {
  type: 'linear' | 'radial';
  /** Linear: x0, y0, x1, y1. Radial: x0, y0, r0, x1, y1, r1. */
  coords: number[];
  stops: [number, string][];
}
export type Paint = string | Gradient;
/** One radius, or top-left, top-right, bottom-right, bottom-left. */
export type Radius = number | [number, number, number, number];
export type Weight = (typeof SHARE_WEIGHTS)[number];

export interface RectOp { kind: 'rect'; id?: string; x: number; y: number; w: number; h: number; r?: Radius; fill?: Paint; stroke?: string; lineWidth?: number; shadow?: { color: string; blur: number; y: number } }
export interface CircleOp { kind: 'circle'; id?: string; cx: number; cy: number; r: number; fill?: Paint; stroke?: string; lineWidth?: number }
export interface PolyOp { kind: 'poly'; id?: string; points: [number, number][]; fill: Paint }
export interface LineOp { kind: 'line'; id?: string; x1: number; y1: number; x2: number; y2: number; stroke: string; lineWidth: number }
/** Text on an alphabetic baseline at y. `width` is its measured width; `maxWidth` is the room it was fitted into. */
export interface TextOp { kind: 'text'; id?: string; text: string; x: number; y: number; size: number; weight: Weight; color: string; align: 'left' | 'center' | 'right'; width: number; maxWidth: number }
/** An SVG path (`Path2D`). */
export interface PathOp { kind: 'path'; id?: string; d: string; fill?: string; stroke?: string; lineWidth?: number }
/** Child operations, transformed (a, b, c, d, e, f) and then clipped to a rounded rectangle in the new coordinates. */
export interface GroupOp { kind: 'group'; id?: string; ops: DrawOp[]; transform?: [number, number, number, number, number, number]; clip?: { x: number; y: number; w: number; h: number; r: number } }
export type DrawOp = RectOp | CircleOp | PolyOp | LineOp | TextOp | PathOp | GroupOp;

export interface ShareCardLayout {
  width: number;
  height: number;
  content: ShareCardContent;
  ops: DrawOp[];
}

/** Text width in px at a size and weight; the canvas measures it in the browser. */
export type Measure = (text: string, size: number, weight: Weight) => number;

/**
 * A deterministic stand-in for the canvas's measureText, for tests. Against Pretendard (measured in Chromium, v25) it
 * is wider for words (Hangul 0.94em against 0.864em, a date by about 12%) and up to 3% narrower for a short number
 * at 800 ("+9", "36"); the browser always measures the real text.
 */
export function estimateWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) em += 0.94;
    else if (ch === ' ') em += 0.27;
    else if (ch >= '0' && ch <= '9') em += 0.64;
    else if (ch >= 'A' && ch <= 'Z') em += 0.72;
    else if (ch >= 'a' && ch <= 'z') em += 0.58;
    else if ('·.,:;|!\'"'.includes(ch)) em += 0.32;
    else if ('/()[]'.includes(ch)) em += 0.4;
    else if ('+−-–'.includes(ch)) em += 0.64;
    else if (ch === '%') em += 0.88;
    else em += 0.96;
  }
  return em * size;
}

interface Fitted { text: string; size: number; width: number }

/** The largest size from `size` down to `min` (steps of 2) at which the text fits; below that, cut with an ellipsis. */
function fit(measure: Measure, text: string, size: number, weight: Weight, maxWidth: number, min = size): Fitted {
  for (let s = size; ; s = Math.max(min, s - 2)) {
    const width = measure(text, s, weight);
    if (width <= maxWidth) return { text, size: s, width };
    if (s === min) break;
  }
  const chars = [...text];
  while (chars.length > 1) {
    chars.pop();
    const cut = `${chars.join('').trimEnd()}…`;
    const width = measure(cut, min, weight);
    if (width <= maxWidth) return { text: cut, size: min, width };
  }
  return { text: '…', size: min, width: measure('…', min, weight) };
}

/** A golf scorecard mark in a `size` box centred on (cx, cy): ◎ eagle or better, ○ birdie, none for par, □ bogey, ⧈ double, ■ triple or worse. */
export function markShapes(mark: ScoreName, cx: number, cy: number, size: number, color: string): DrawOp[] {
  const thick = size * 0.065;
  const thin = size * 0.05;
  const square = (side: number, lineWidth: number, r: number): RectOp => ({ kind: 'rect', x: cx - side / 2, y: cy - side / 2, w: side, h: side, r, stroke: color, lineWidth });
  switch (mark) {
    case 'eagle':
      return [
        { kind: 'circle', cx, cy, r: size * 0.37, stroke: color, lineWidth: thin },
        { kind: 'circle', cx, cy, r: size / 2 - thin / 2, stroke: color, lineWidth: thin },
      ];
    case 'birdie':
      return [{ kind: 'circle', cx, cy, r: size * 0.44, stroke: color, lineWidth: thick }];
    case 'par':
      return [];
    case 'bogey':
      return [square(size * 0.8, thick, size * 0.06)];
    case 'double':
      return [square(size * 0.7, thin, size * 0.04), square(size - thin, thin, size * 0.07)];
    case 'triple':
      return [{ kind: 'rect', x: cx - size * 0.42, y: cy - size * 0.42, w: size * 0.84, h: size * 0.84, r: size * 0.09, fill: color }];
  }
}

/** A score's colour: red under par, green at par, ink over. */
const toneColor = (tone: Tone): string => ({ under: C.red, par: C.turf, over: C.ink })[tone];

/** The visual middle of digits and Latin capitals above the baseline, as a share of the font size. */
const CAP = 0.36;

class Ops {
  readonly list: DrawOp[] = [];
  constructor(readonly measure: Measure) {}

  push(...ops: DrawOp[]): void {
    this.list.push(...ops);
  }

  /** Fitted text; returns the op so callers can place things after it. */
  text(id: string | undefined, value: string, x: number, y: number, size: number, weight: Weight, color: string, align: TextOp['align'], maxWidth: number, min = size): TextOp {
    const f = fit(this.measure, value, size, weight, maxWidth, min);
    const op: TextOp = { kind: 'text', text: f.text, x, y, size: f.size, weight, color, align, width: f.width, maxWidth };
    if (id) op.id = id;
    this.list.push(op);
    return op;
  }
}

function background(o: Ops): void {
  o.push({ kind: 'rect', x: 0, y: 0, w: W, h: H, fill: C.deep });
  // Mowing stripes running up the fairway towards a point above the card.
  const vx = W / 2;
  const vy = -1700;
  const band = 170;
  const top = (x: number) => vx + ((x - vx) * -vy) / (H - vy);
  for (let b = -5 * band; b < W + 5 * band; b += 2 * band) {
    o.push({ kind: 'poly', points: [[top(b), 0], [top(b + band), 0], [b + band, H], [b, H]], fill: alpha(C.white, 0.035) });
  }
  o.push({ kind: 'rect', x: 0, y: 0, w: W, h: H, fill: { type: 'radial', coords: [300, 380, 0, 300, 380, 760], stops: [[0, alpha(C.putting, 0.16)], [1, alpha(C.putting, 0)]] } });
  o.push({ kind: 'rect', x: 0, y: 0, w: W, h: H, fill: { type: 'linear', coords: [0, 0, 0, H], stops: [[0, alpha(C.ink, 0)], [0.6, alpha(C.ink, 0)], [1, alpha(C.ink, 0.42)]] } });
}

function header(o: Ops, c: ShareCardContent): void {
  o.text('date', c.date, M, 118, 30, 600, C.tabInk, 'left', W - 2 * M);
  o.text('course', c.course, M, 190, 58, 800, C.white, 'left', W - 2 * M, 40);
  if (c.nines) o.text('nines', c.nines, M, 244, 34, 600, C.putting, 'left', W - 2 * M, 26);
}

/** The big total's baseline, and the size of the score-against-par mark beside it. */
const HERO = { base: 534, mark: 164 };

/** The hero: the total, its score against par in a scorecard mark, then 전반/후반 and the holes and par it counts. */
function hero(o: Ops, c: ShareCardContent, shift: number): void {
  const base = HERO.base + shift;
  const side = 44 + HERO.mark + 32 + 230;
  // With nothing finished the total is a quiet dash, not a slab.
  const total = c.toPar
    ? o.text('total', c.total, M - 6, base, 290, 800, C.white, 'left', W - 2 * M - side + 6, 180)
    : o.text('total', c.total, M, base - 60, 160, 800, C.tabInk, 'left', 200);
  // The middle of the digits, where the mark and the side lines are centred.
  const cy = base - total.size * 0.72 * 0.5;
  let x = total.x + total.width + 44;
  if (c.toPar) {
    const size = HERO.mark;
    const cx = x + size / 2;
    if (c.tone === 'under') o.push({ kind: 'group', id: 'to-par-mark', ops: [{ kind: 'circle', cx, cy, r: size / 2, fill: C.red }] });
    if (c.tone === 'over') o.push({ kind: 'group', id: 'to-par-mark', ops: [{ kind: 'rect', x: cx - size / 2 + 4, y: cy - size / 2 + 4, w: size - 8, h: size - 8, r: 26, stroke: C.sand, lineWidth: 8 }] });
    // Sized first, so the text can sit on the mark's middle.
    const fitted = fit(o.measure, c.toPar, 76, 800, size - 32, 44).size;
    o.text('to-par', c.toPar, cx, cy + fitted * CAP, fitted, 800, c.tone === 'par' ? C.putting : C.white, 'center', size - 32, 44);
    x += size + 32;
  }
  const room = W - M - x;
  const lineH = 54;
  const lines = c.halves.length + 1;
  const first = c.halves.length ? 36 : 26;
  let y = cy - ((lines - 1) * lineH - 0.72 * first) / 2;
  for (const half of c.halves) {
    const key = half.label === '전반' ? 'front' : 'back';
    let hx = x;
    hx += o.text(`half-${key}-label`, half.label, hx, y, 28, 600, C.tabInk, 'left', room).width + 14;
    hx += o.text(`half-${key}`, half.strokes, hx, y, 36, 800, C.white, 'left', x + room - hx).width + 12;
    if (half.toPar) o.text(`half-${key}-par`, half.toPar, hx, y, 28, 800, C.putting, 'left', x + room - hx, 20);
    y += lineH;
  }
  const count = o.text('count', c.count, x, y, 26, 600, C.tabInk, 'left', room, 20);
  if (c.par) o.text('hero-par', `· ${c.par}`, x + count.width + 10, y, 26, 600, C.tabInk, 'left', room - count.width - 10, 20);
}

const CARD = { x: 48, y: 590, w: W - 96, pad: 34 };
const CARD_GAP = 24;
/** Scorecard rows: one nine gets room for putts as well. */
const ROWS = {
  two: { title: 50, no: 40, par: 34, score: 80, putts: 0 },
  one: { title: 56, no: 48, par: 42, score: 104, putts: 42 },
};

function cardHeight(nines: number): number {
  const rows = nines === 1 ? ROWS.one : ROWS.two;
  return CARD.pad * 2 + nines * (rows.title + rows.no + rows.par + rows.score + rows.putts) + (nines - 1) * CARD_GAP;
}

function scorecard(o: Ops, c: ShareCardContent, cardY: number): void {
  const one = c.scorecard.length === 1;
  const rows = one ? ROWS.one : ROWS.two;
  const table = rows.no + rows.par + rows.score + rows.putts;
  const inner = CARD.w - 2 * CARD.pad;
  o.push({ kind: 'rect', id: 'card', x: CARD.x, y: cardY, w: CARD.w, h: cardHeight(c.scorecard.length), r: 40, fill: C.paper, shadow: { color: alpha(C.ink, 0.28), blur: 40, y: 14 } });

  const x0 = CARD.x + CARD.pad;
  const labelW = 56;
  const colGap = 8;
  const subW = 104;
  const colW = (inner - labelW - colGap - subW - 9 * colGap) / 9;
  let top = cardY + CARD.pad;
  for (const nine of c.scorecard) {
    const title = o.text(`nine-${nine.key}-title`, nine.title, x0, top + 30, 30, 800, C.ink, 'left', inner - 220, 22);
    // A course without nine names already says 전반 9홀 in the title.
    if (!nine.title.startsWith(nine.label)) o.text(`nine-${nine.key}-label`, nine.label, x0 + title.width + 14, top + 30, 24, 600, C.muted, 'left', 80);
    if (nine.tone) o.text(`nine-${nine.key}-par`, nine.toPar, x0 + inner, top + 30, 26, 800, toneColor(nine.tone), 'right', 140);
    const y = top + rows.title;
    const mid = (from: number, h: number) => from + h / 2;
    const rowNo = y;
    const rowPar = y + rows.no;
    const rowScore = rowPar + rows.par;
    const rowPutts = rowScore + rows.score;
    o.text(undefined, '홀', x0, mid(rowNo, rows.no) + 20 * CAP + 2, 20, 600, C.muted, 'left', labelW);
    o.text(undefined, '파', x0, mid(rowPar, rows.par) + 20 * CAP + 2, 20, 600, C.muted, 'left', labelW);
    o.text(undefined, '타수', x0, mid(rowScore, rows.score) + 20 * CAP + 2, 20, 600, C.muted, 'left', labelW);
    if (rows.putts) o.text(undefined, '퍼트', x0, mid(rowPutts, rows.putts) + 20 * CAP + 2, 20, 600, C.muted, 'left', labelW);
    nine.holes.forEach((hole, k) => {
      const cx0 = x0 + labelW + colGap + k * (colW + colGap);
      const cx = cx0 + colW / 2;
      const col = new Ops(o.measure);
      col.push({ kind: 'rect', x: cx0, y, w: colW, h: table, r: 14, fill: C.white, stroke: C.line, lineWidth: 2 });
      col.push({ kind: 'rect', x: cx0 + 1, y: y + 1, w: colW - 2, h: rows.no - 1, r: [13, 13, 0, 0], fill: C.pill });
      col.text(`hole-${hole.hole}-no`, String(hole.hole), cx, mid(rowNo, rows.no) + 24 * CAP + 1, 24, 800, C.ink, 'center', colW - 8, 18);
      col.text(`hole-${hole.hole}-par`, String(hole.par), cx, mid(rowPar, rows.par) + 22 * CAP + 1, 22, 600, C.muted, 'center', colW - 8);
      const sy = mid(rowScore, rows.score);
      const markSize = Math.min(colW - 12, rows.score - 14, one ? 66 : 60);
      if (hole.mark && hole.tone && hole.score !== null) {
        const color = toneColor(hole.tone);
        const shapes = markShapes(hole.mark, cx, sy, markSize, color);
        if (shapes.length) col.push({ kind: 'group', id: `hole-${hole.hole}-mark`, ops: shapes });
        const size = one ? 38 : 34;
        col.text(`hole-${hole.hole}-score`, String(hole.score), cx, sy + size * CAP, size, 800, hole.mark === 'triple' ? C.white : color, 'center', markSize * 0.7, 20);
      } else {
        col.text(`hole-${hole.hole}-score`, '–', cx, sy + 30 * CAP, 30, 600, C.quiet, 'center', colW - 8);
      }
      if (rows.putts) col.text(`hole-${hole.hole}-putts`, hole.putts === null ? '–' : String(hole.putts), cx, mid(rowPutts, rows.putts) + 22 * CAP + 1, 22, 600, C.muted, 'center', colW - 8);
      o.push({ kind: 'group', id: `hole-${hole.hole}`, ops: col.list });
    });
    // The nine's subtotal in the warm sand accent.
    const sx = x0 + labelW + colGap + 9 * (colW + colGap);
    const scx = sx + subW / 2;
    o.push({ kind: 'rect', x: sx, y, w: subW, h: table, r: 14, fill: C.sandTint, stroke: C.sandLine, lineWidth: 2 });
    o.push({ kind: 'rect', x: sx + 1, y: y + 1, w: subW - 2, h: rows.no - 1, r: [13, 13, 0, 0], fill: C.sandBand });
    o.text(`sub-${nine.key}-label`, nine.label, scx, mid(rowNo, rows.no) + 22 * CAP + 2, 22, 800, C.ink, 'center', subW - 10);
    o.text(`sub-${nine.key}-par`, String(nine.par), scx, mid(rowPar, rows.par) + 22 * CAP + 1, 22, 600, C.muted, 'center', subW - 10);
    o.text(`sub-${nine.key}`, nine.strokes, scx, mid(rowScore, rows.score) + 40 * CAP, 40, 800, nine.strokes === '–' ? C.quiet : C.ink, 'center', subW - 14, 26);
    if (rows.putts) o.text(`sub-${nine.key}-putts`, nine.putts, scx, mid(rowPutts, rows.putts) + 22 * CAP + 1, 22, 600, C.muted, 'center', subW - 10);
    top = y + table + CARD_GAP;
  }
}

function stats(o: Ops, c: ShareCardContent, top: number): void {
  const colW = (W - 2 * M) / c.stats.length;
  c.stats.forEach((s, k) => {
    const cx = M + k * colW + colW / 2;
    if (k > 0) o.push({ kind: 'line', x1: M + k * colW, y1: top + 6, x2: M + k * colW, y2: top + 112, stroke: alpha(C.white, 0.16), lineWidth: 2 });
    o.text(`stat-${s.key}-label`, s.label, cx, top + 30, 24, 600, C.tabInk, 'center', colW - 16);
    o.text(`stat-${s.key}-value`, s.value, cx, top + 78, 42, 800, C.white, 'center', colW - 20, 28);
    if (s.sub) o.text(`stat-${s.key}-sub`, s.sub, cx, top + 110, 22, 600, C.putting, 'center', colW - 16, 18);
  });
}

/** The app icon (public/favicon.svg): an iron head on a turf tile, drawn from its own paths. */
function appIcon(x: number, y: number, size: number): GroupOp {
  return {
    kind: 'group',
    id: 'wordmark-icon',
    transform: [size / 32, 0, 0, size / 32, x, y],
    clip: { x: 0, y: 0, w: 32, h: 32, r: 7 },
    ops: [
      { kind: 'rect', x: 0, y: 0, w: 32, h: 32, fill: C.turf },
      {
        kind: 'group',
        transform: [0.0648, 0, 0, 0.0648, -2.57, -0.27],
        ops: [
          { kind: 'path', d: 'M421.6 193.3L390.7 183.8L500.5 -177.9L535.6 -167Z', fill: C.mark },
          { kind: 'path', d: 'M171.8 240.9C124.2 225.8 87.5 246.3 88.6 294.9C89.7 327.3 100.5 353.2 126.4 362.9C195.5 377 303.5 378 357.5 369.4C376.7 366.4 385.2 348.3 389.9 327.3L422.8 182.3L396 174.1L366.6 269C362.2 283.4 337.3 296.2 323 291.6Z', fill: C.white },
          { kind: 'path', d: 'M141.5 303.5H303.5M137.2 338.1H327.3', stroke: C.turf, lineWidth: 24 },
        ],
      },
    ],
  };
}

function footer(o: Ops): void {
  const y = 1302;
  const icon = 38;
  const name = o.measure('Fairway Note', 26, 600);
  const x = (W - (icon + 14 + name)) / 2;
  o.push(appIcon(x, y - 29, icon));
  o.text('wordmark', 'Fairway Note', x + icon + 14, y, 26, 600, alpha(C.white, 0.78), 'left', 300);
}

export function shareCardLayout(round: Round, measure: Measure = estimateWidth): ShareCardLayout {
  const content = shareCardContent(round);
  const o = new Ops(measure);
  // A single nine is shorter than two; the room it leaves goes evenly above the hero, above the card and below it,
  // so the stats and the wordmark stay where an 18-hole card has them.
  const step = Math.round((cardHeight(2) - cardHeight(content.scorecard.length)) / 3);
  background(o);
  header(o, content);
  hero(o, content, step);
  scorecard(o, content, CARD.y + 2 * step);
  stats(o, content, CARD.y + cardHeight(2) + 40);
  footer(o);
  return { width: W, height: H, content, ops: o.list };
}

/* ---------- drawing on a canvas ---------- */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: Radius = 0): void {
  const [tl, tr, br, bl] = typeof r === 'number' ? [r, r, r, r] : r;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.arcTo(x + w, y, x + w, y + h, tr);
  ctx.arcTo(x + w, y + h, x, y + h, br);
  ctx.arcTo(x, y + h, x, y, bl);
  ctx.arcTo(x, y, x + w, y, tl);
  ctx.closePath();
}

function style(ctx: CanvasRenderingContext2D, paint: Paint): string | CanvasGradient {
  if (typeof paint === 'string') return paint;
  const [a, b, c, d, e, f] = paint.coords;
  const g = paint.type === 'linear' ? ctx.createLinearGradient(a, b, c, d) : ctx.createRadialGradient(a, b, c, d, e, f);
  for (const [offset, color] of paint.stops) g.addColorStop(offset, color);
  return g;
}

function fillAndStroke(ctx: CanvasRenderingContext2D, op: { fill?: Paint; stroke?: string; lineWidth?: number }, path?: Path2D): void {
  if (op.fill) {
    ctx.fillStyle = style(ctx, op.fill);
    if (path) ctx.fill(path);
    else ctx.fill();
  }
  if (op.stroke) {
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = op.stroke;
    ctx.lineWidth = op.lineWidth ?? 1;
    if (path) ctx.stroke(path);
    else ctx.stroke();
  }
}

/** Paints layout operations in order. */
export function paintShareCard(ctx: CanvasRenderingContext2D, ops: readonly DrawOp[]): void {
  for (const op of ops) {
    ctx.save();
    switch (op.kind) {
      case 'rect':
        if (op.shadow) {
          ctx.shadowColor = op.shadow.color;
          ctx.shadowBlur = op.shadow.blur;
          ctx.shadowOffsetY = op.shadow.y;
        }
        roundRect(ctx, op.x, op.y, op.w, op.h, op.r);
        fillAndStroke(ctx, op);
        break;
      case 'circle':
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        fillAndStroke(ctx, op);
        break;
      case 'poly':
        ctx.beginPath();
        op.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        fillAndStroke(ctx, op);
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.lineCap = 'round';
        fillAndStroke(ctx, op);
        break;
      case 'text':
        ctx.font = `${op.weight} ${op.size}px ${FONT}`;
        ctx.fillStyle = op.color;
        ctx.textAlign = op.align;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(op.text, op.x, op.y, op.maxWidth);
        break;
      case 'path':
        ctx.lineCap = 'round';
        fillAndStroke(ctx, op, new Path2D(op.d));
        break;
      case 'group':
        if (op.transform) ctx.transform(...op.transform);
        if (op.clip) {
          roundRect(ctx, op.clip.x, op.clip.y, op.clip.w, op.clip.h, op.clip.r);
          ctx.clip();
        }
        paintShareCard(ctx, op.ops);
        break;
    }
    ctx.restore();
  }
}

/**
 * The palette tokens as canvas colours: the browser resolves each (mixes too) on a probe, and one pixel gives it back
 * as `#rrggbb`, or `rgba()` for a translucent layer.
 */
export function readSharePalette(): SharePalette {
  const probe = document.createElement('i');
  probe.hidden = true;
  document.body.append(probe);
  const px = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const palette = {} as SharePalette;
  for (const [key, token] of Object.entries(SHARE_TOKENS) as [keyof SharePalette, string][]) {
    probe.style.color = `var(${token})`;
    px.clearRect(0, 0, 1, 1);
    px.fillStyle = getComputedStyle(probe).color;
    px.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = px.getImageData(0, 0, 1, 1).data;
    palette[key] = a === 255 ? `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
  }
  probe.remove();
  return palette;
}

/**
 * Waits for the faces the image draws in (v25): canvas text never waits for a font, it measures and draws in
 * whatever has loaded. They are the page's own, usually loaded already and cached offline; a face that fails or is
 * slower than 1.5 s leaves the system font, as on the page.
 */
async function loadFaces(): Promise<void> {
  const fonts = document.fonts as FontFaceSet | undefined;
  if (!fonts?.load) return;
  const loaded = Promise.all(SHARE_WEIGHTS.map((weight) => fonts.load(`${weight} 40px Pretendard`))).then(() => undefined, () => undefined);
  await Promise.race([loaded, new Promise<void>((resolve) => setTimeout(resolve, 1500))]);
}

/**
 * Draws the round's share card and encodes it as a 1080×1350 PNG. Needs only a canvas and the page's font: no
 * network and no images, so it works offline and under the app's CSP. The caller shares the file
 * (`navigator.share({ files })`) or downloads it.
 */
export async function drawShareCard(round: Round): Promise<Blob> {
  await loadFaces();
  useSharePalette(readSharePalette());
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  const measure: Measure = (text, size, weight) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    return ctx.measureText(text).width;
  };
  paintShareCard(ctx, shareCardLayout(round, measure).ops);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The share card could not be encoded'))), 'image/png');
  });
}
