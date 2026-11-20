import './style.css';
import {
  AREA_LABELS,
  MAX_COUNT,
  PARS,
  SCORE_LABELS,
  TAGGED,
  TAG_LABELS,
  analyze,
  bump,
  courseLabel,
  roundLabel,
  finished,
  formatToPar,
  isStale,
  newRound,
  played,
  roundCourse,
  scoreWord,
  setTeeTag,
  strokes,
  teeTag,
  type Analysis,
  type Area,
  type Counter,
  type Hole,
  type Par,
  type Round,
  type ScoreName,
  type ShotTag,
  type Tagged,
} from './round';
import { CLUB_ICONS, PEN_ICONS, icon } from './icons';
import { courseShape, courseSvg, holeThumb, layoutBend, layoutIsland, type CourseFrame } from './course-art';
import { registerOffline } from './offline';
import { analysisText, csvName, dateLabel, detailLines, insights, mailtoHref, reportSubject, reportText, roundCsv } from './report';
import { PREFS_KEY, STORAGE_KEY, clearRound, loadDisplay, loadPrefs, loadRound, preserveUnreadable, requestPersistence, saveDisplay, savePrefs, saveRound, store, type CourseChoice } from './storage';
import { keepScreenOn } from './wake';
import { courseSource, distanceLabel, holeInfo, publishedPar, resolveChoice, roundSetup } from './courses';
import { closePicker, openPicker, pickerOpen } from './picker';
import { VERSION_LABEL } from './version';
import { $, h, setText } from './dom';
import { keepBeforeNewRound, newRoundQuestion, renderHistory, type Page } from './history-view';
import { HISTORY_KEY, hasFinishedHole, readHistory } from './history';
import { renderBackup } from './backup-view';
import { bindSummaryShare, closeSummaryShare, openSummaryShare, saveSummaryImage, shareSummary } from './share-round';
import { bindShotPanel, renderShotPanel } from './shot-panel';

/** The penalty row: OB and 해저드 add a stroke each; 벙커 (상세) is noted only. */
const PENS = ['ob', 'bunker', 'hazard'] as const;
type Pen = (typeof PENS)[number];
type Mark = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | 'triple' | 'none';

const LABELS: Record<Counter, string> = { driver: '드라이버', approach: '어프로치', putts: '퍼터', ob: 'OB', hazard: '해저드', mulligan: '멀리건', bunker: '벙커' };
/** The first column is the tee shot: 드라이버, or 티샷 on a par 3, where the tee shot is rarely a driver. */
const labelOf = (key: Counter, par: Par) => (key === 'driver' && par === 3 ? '티샷' : LABELS[key]);
const PLUS = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const MINUS = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
/** The badge's scorecard mark in a 40×40 box. pathLength 1 lets a birdie or better draw itself. */
const SHAPES: Record<Mark, string> = {
  none: '',
  par: '',
  birdie: '<circle cx="20" cy="20" r="17" pathLength="1"/>',
  eagle: '<circle cx="20" cy="20" r="14" pathLength="1"/><circle cx="20" cy="20" r="19" pathLength="1"/>',
  bogey: '<rect x="4" y="4" width="32" height="32" rx="2" pathLength="1"/>',
  double: '<rect x="6.5" y="6.5" width="27" height="27" rx="1" pathLength="1"/><rect x="2" y="2" width="36" height="36" rx="2" pathLength="1"/>',
  // Triple bogey or worse: a filled square, so a big number stands out on the card.
  triple: '<rect class="fill" x="3" y="3" width="34" height="34" rx="3" pathLength="1"/>',
};
/** The scorecard legend, as each result looks on a par 4. */
const LEGEND: [Mark, string, number, string, string][] = [
  ['eagle', 'under', 2, '이글', '두 겹 동그라미'], ['birdie', 'under', 3, '버디', '동그라미'], ['par', 'par', 4, '파', '표시 없음'],
  ['bogey', 'over', 5, '보기', '네모'], ['double', 'over', 6, '더블', '두 겹 네모'], ['triple', 'over', 7, '트리플 이상', '채운 네모'],
];

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function announce(text: string): void {
  const live = $('announce');
  // Clearing first makes a repeated message (same count twice) be read again.
  live.textContent = '';
  requestAnimationFrame(() => (live.textContent = text));
}

/** Restarts a short CSS animation (skipped under reduced motion by the stylesheet). */
function replay(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

const markOf = (d: number): Mark => (d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : d === 2 ? 'double' : 'triple');
const toneOf = (d: number) => (d < 0 ? 'under' : d === 0 ? 'par' : 'over');
/** Score against par as the scorecard reads it: 이븐, +2, −1. */
const toParText = (n: number) => (n === 0 ? '이븐' : n > 0 ? `+${n}` : `−${-n}`);

const loaded = loadRound();
// An unreadable value (broken, or from a newer version) is copied aside; nothing is written until the first edit.
const kept = preserveUnreadable();
// Until a course is chosen, the page behind the picker shows the remembered (or default) course.
let round: Round = loaded ?? newRound(new Date(), roundSetup(resolveChoice(loadPrefs())));
let saved = kept !== 'failed';
/** Shown until the first edit when an unreadable saved value was copied aside. */
let rescued = kept === 'kept' && loaded === null;
/** Shown until the first edit when the round loaded but shot details it could not read were left out (the original is kept aside). */
let trimmed = kept === 'kept' && loaded !== null;
/** Set when the saved copy was removed or replaced elsewhere; this tab's round is kept and saved on the next edit. */
let detached = false;
let persistAsked = false;
/** A round left untouched for half a day, offered to continue or replace on load. */
let stale = loaded !== null && isStale(loaded);
/**
 * Versions before course selection saved an untouched round on open. Such a round (no course, nothing recorded)
 * counts as no round. A round started from the picker always has its course, so it is not this.
 */
const untouched = loaded !== null && loaded.course === undefined && !loaded.holes.some((x) => played(x) || x.mulligan > 0);
/** 기본 or 상세, kept in memory. */
let mode: 'basic' | 'detail' = 'basic';
/** Penalties in the order they were added on each hole, so "빼기" takes off the last one. Not saved. */
const added = new Map<number, Pen[]>();
/** Holes whose birdie or better has had its moment, so it plays once until the score changes back. */
const celebrated = new Set<number>();
/** 파 수정 on the scorecard: each par cell becomes a button that steps 3, 4, 5. */
let editPar = false;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function hole(): Hole {
  return round.holes[round.current];
}

/** The last hole's index: 17, or 8 in a round of one nine. */
const lastHole = () => round.holes.length - 1;

function update(next: Round, changed?: string): void {
  round = { ...next, lastEdited: Date.now() };
  saved = saveRound(round);
  if (saved) detached = false;
  rescued = false;
  trimmed = false;
  if (saved && !persistAsked) {
    persistAsked = true;
    requestPersistence();
  }
  render(changed);
}

/** Changes one hole; false when nothing changed. `reopen`: recording on it again takes back 라운드 마치기. */
function setHoleAt(index: number, patch: (h: Hole) => Hole, changed?: string, reopen = false): boolean {
  const before = round.holes[index];
  const after = patch(before);
  if (after === before) return false;
  const holes = round.holes.slice();
  holes[index] = after;
  const next: Round = { ...round, holes };
  if (reopen) delete next.closed;
  update(next, changed);
  return true;
}

/** A shot, penalty or tee result on the hole being played. A par change (파 수정) is not recording on it. */
const setHole = (patch: (h: Hole) => Hole, changed?: string) => setHoleAt(round.current, patch, changed, true);

/* ---------- views: 스코어카드, 기록 and 지난 라운드 ---------- */

type View = 'card' | 'entry' | 'hist';
const VIEWS: View[] = ['card', 'entry', 'hist'];
const TAB_ID: Record<View, string> = { card: 'tab-card', entry: 'tab-entry', hist: 'tab-hist' };
const PANEL_ID: Record<View, string> = { card: 'card-view', entry: 'entry', hist: 'hist-view' };
/** Kept in memory: a reload opens 기록. */
let view: View = 'entry';

function show(next: View, focusTab = false): void {
  // With no round yet (one was just kept), 기록 and 스코어카드 open the course picker over 지난 라운드.
  if (roundless && next !== 'hist') {
    pickFirst();
    return;
  }
  const changed = next !== view;
  view = next;
  for (const v of VIEWS) {
    const tab = $<HTMLButtonElement>(TAB_ID[v]);
    tab.setAttribute('aria-selected', String(v === view));
    tab.tabIndex = v === view ? 0 : -1;
    $(PANEL_ID[v]).hidden = v !== view;
  }
  if (changed) hideToast();
  if (changed && view !== 'entry') $(PANEL_ID[view]).scrollTop = 0;
  if (view === 'hist') renderNow();
  drawCourse();
  scrollHint();
  if (focusTab) $(TAB_ID[view]).focus();
}

function bindViews(): void {
  for (const v of VIEWS) $(TAB_ID[v]).addEventListener('click', () => show(v));
  $('views').addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    const at = VIEWS.indexOf(view);
    const step = (n: number) => VIEWS[(at + n + VIEWS.length) % VIEWS.length];
    const target = ({ ArrowLeft: step(-1), ArrowRight: step(1), Home: VIEWS[0], End: VIEWS[VIEWS.length - 1] } as Record<string, View>)[e.key];
    if (!target || !(e.target as HTMLElement).matches('[role="tab"]')) return;
    e.preventDefault();
    show(target, true);
  });
}

/* ---------- moving between holes: the arrows, 다음 홀 and a swipe all slide ---------- */

function go(index: number): void {
  if (index < 0 || index >= lastHole() + 1 || index === round.current) return;
  hideToast();
  const next: Round = { ...round, current: index };
  delete next.closed;
  update(next);
  $('sheet').scrollTop = 0;
  scrollHint();
  announce(`${index + 1}번 홀, Par ${hole().par}`);
}

/** Moves the sheet sideways; `ms` 0 jumps there. Inline styles set through CSSOM are allowed by the page's CSP. */
function slide(el: HTMLElement, x: number, ms = 0, fade = false): void {
  el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2, .8, .2, 1), opacity ${ms}ms ease-out` : 'none';
  el.style.transform = x ? `translateX(${x}px)` : '';
  el.style.opacity = fade ? '0' : '';
}

/** A copy of the swiped sheet that carries on off screen while the next hole slides in. Hidden from assistive tech. */
function leaveGhost(sheet: HTMLElement, dir: number): void {
  const box = sheet.getBoundingClientRect();
  const ghost = sheet.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('style');
  for (const el of [ghost, ...ghost.querySelectorAll('[id]')]) el.removeAttribute('id');
  ghost.classList.add('ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  $('entry').append(ghost);
  ghost.scrollTop = sheet.scrollTop;
  requestAnimationFrame(() => slide(ghost, -dir * window.innerWidth * 0.45, 160, true));
  window.setTimeout(() => ghost.remove(), 260);
}

/**
 * One hole on or back. Only the sheet moves: the new hole's slides in from the side it comes from, and a swiped one
 * carries on out; the badge and the chips stay put.
 */
function changeHole(dir: 1 | -1, swiped = false): void {
  const sheet = $('sheet');
  const target = round.current + dir;
  if (target < 0 || target > lastHole()) {
    slide(sheet, 0, 180);
    return;
  }
  const motion = !reducedMotion();
  if (motion && swiped) leaveGhost(sheet, dir);
  // Back in place before the new hole renders, so the drawn course measures the sheet where it rests.
  slide(sheet, 0);
  go(target);
  if (swiped) navigator.vibrate?.(8);
  if (!motion) return;
  $('sheet-wrap').classList.remove('more');
  slide(sheet, dir * window.innerWidth * 0.3, 0, true);
  requestAnimationFrame(() => requestAnimationFrame(() => slide(sheet, 0, 220)));
  window.setTimeout(scrollHint, 260);
}

/** "다음 홀", or the round summary after the last hole. Leaving a hole with nothing on it says so, with 되돌리기 (v15). */
function goNext(): void {
  if (round.current === lastHole()) {
    requestFinish($('go-next'));
    return;
  }
  const from = round.current;
  const blank = !played(hole());
  changeHole(1);
  if (!blank) return;
  const text = `${from + 1}번 홀은 비워 두고 넘어갑니다`;
  showToast(text, { index: from, hole: round.holes[from], added: [...(added.get(from) ?? [])], back: true });
  announce(`${text}. ${round.current + 1}번 홀, Par ${hole().par}`);
}

/** A sideways swipe on 기록 changes the hole; a mostly vertical one is left to scroll the sheet. */
function bindSwipe(): void {
  const entry = $('entry');
  const sheet = $('sheet');
  let drag: { x: number; y: number; id: number; on: boolean; t: number } | null = null;
  let swallow = false;
  entry.addEventListener('pointerdown', (e) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || (e.target as Element).closest('.toast')) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, t: performance.now() };
  });
  entry.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        drag.on = true;
        swallow = true;
        entry.setPointerCapture(e.pointerId);
      } else {
        if (Math.abs(dy) > 12) drag = null;
        return;
      }
    }
    // At the first and last hole the sheet only gives a little.
    const edge = (dx > 0 && round.current === 0) || (dx < 0 && round.current === lastHole());
    slide(sheet, edge ? dx * 0.25 : dx);
  });
  const end = (e: PointerEvent, cancel: boolean) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.on) return;
    const dx = e.clientX - d.x;
    const speed = dx / Math.max(1, performance.now() - d.t);
    if (!cancel && (dx < -72 || speed < -0.6)) changeHole(1, true);
    else if (!cancel && (dx > 72 || speed > 0.6)) changeHole(-1, true);
    else slide(sheet, 0, 180);
    window.setTimeout(() => (swallow = false), 60);
  };
  entry.addEventListener('pointerup', (e) => end(e, false));
  entry.addEventListener('pointercancel', (e) => end(e, true));
  // A swipe that starts on a button must not also press it.
  document.addEventListener('click', (e) => {
    if (!swallow) return;
    e.stopPropagation();
    e.preventDefault();
    swallow = false;
  }, true);
}

/* ---------- the drawn course behind the screen ---------- */

/** The pills give the captions under the chips the room they take, one row or two (none where CSS hides them). */
/** The captions row under the chips is gone (v10: the notes moved into 홀 안내), so the pills keep the full height. */
function fitNotes(): void {
  $('entry').style.setProperty('--notes-h', '0px');
  fitMeta();
  fitSwitcher();
}

/**
 * In 상세 on a short screen Par and length sit under the hole number. Where that would push the switcher into the
 * badge (WebKit draws Latin letters and digits wider), the length steps aside; it stays in 홀 안내.
 */
function fitSwitcher(): void {
  const sub = $('hole-sub');
  const full = sub.dataset.full ?? '';
  setText(sub, full);
  if (getComputedStyle(sub).display === 'none' || !sub.dataset.par) return;
  const right = document.querySelector('#entry .switcher')!.getBoundingClientRect().right;
  if (right > $('badge').getBoundingClientRect().left - 6) setText(sub, sub.dataset.par);
}

/** Keeps the header to one row beside the badge: HDCP steps aside first, then the length (both stay in 홀 안내). */
function fitMeta(): void {
  const meta = $('meta');
  meta.classList.remove('tight', 'tighter');
  if (meta.scrollWidth > meta.clientWidth + 1) meta.classList.add('tight');
  if (meta.scrollWidth > meta.clientWidth + 1) meta.classList.add('tighter');
}

function drawCourse(): void {
  const svg = document.getElementById('course')!;
  const frame: CourseFrame = { width: window.innerWidth, height: window.innerHeight, bandTop: 110, bandBottom: 168, right: window.innerWidth * 0.72 };
  if (view === 'entry') {
    // The open band starts under the one-row header.
    frame.bandTop = $('hole-info').getBoundingClientRect().bottom + 6;
    frame.bandBottom = $('sheet').getBoundingClientRect().top;
    frame.right = $('sheet').getBoundingClientRect().right - 6;
    // The tee box (27px with its bevel) centred behind 다음 홀.
    const go = $('go-next').getBoundingClientRect();
    frame.teeY = go.top + go.height / 2 - 1.5;
  }
  const info = holeInfo(roundCourse(round), round.current);
  const bend = layoutBend(info?.layout);
  const island = layoutIsland(info?.layout);
  // The official length in metres, for the 100 m / 150 m markers a tall band shows.
  const first = info?.distances?.[0];
  const length = first ? Math.round(first.unit === 'yd' ? first.length * 0.9144 : first.length) : null;
  const key = [frame.width, frame.height, Math.round(frame.bandTop), Math.round(frame.bandBottom), Math.round(frame.right), Math.round(frame.teeY ?? 0), hole().par, round.current, bend, island, length].join(',');
  if (svg.dataset.key === key) return;
  svg.dataset.key = key;
  svg.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
  // Static markup from course-art.ts, built from numbers only.
  svg.innerHTML = courseSvg(courseShape(hole().par, round.current, frame, bend, island, length), frame);
}

/** The white fade at the sheet's foot when more of it is below. */
function scrollHint(): void {
  const sheet = $('sheet');
  $('sheet-wrap').classList.toggle('more', !$('entry').hidden && sheet.scrollHeight - sheet.clientHeight - sheet.scrollTop > 4);
}

/* ---------- 기록: top bar, pills, badge, 상세, penalties ---------- */

function setChip(id: string, text: string | null): void {
  const el = $(id);
  setText(el, text ?? '');
  el.hidden = text === null;
}

function buildClubs(): void {
  const box = $('clubs');
  for (const key of TAGGED) {
    const label = LABELS[key];
    const name = h('p', { class: 'club-lbl', id: `lbl-${key}` }, h('span', { class: 'club-name' }, label));
    // Static icon markup from icons.ts, never user input.
    name.insertAdjacentHTML('afterbegin', CLUB_ICONS[key]);
    const plus = h('button', { type: 'button', class: 'step plus', 'aria-label': `${label} 하나 더하기` });
    plus.innerHTML = `<span>${PLUS}</span>`;
    const minus = h('button', { type: 'button', class: 'step minus', 'aria-label': `${label} 하나 빼기` });
    minus.innerHTML = `<span>${MINUS}</span>`;
    // The count, with the club's icon beside it for screens where the names step aside.
    // The digit is for the eye; screen readers read the club with it ("드라이버 2").
    const num = h('span', { class: 'num-row' }, h('span', { class: 'count', id: `count-${key}`, 'aria-hidden': 'true' }, '0'), h('span', { class: 'sr-only', id: `count-label-${key}` }, `${label} 0`));
    num.insertAdjacentHTML('afterbegin', CLUB_ICONS[key].replace('<svg', '<svg class="pill-ico"'));
    // The long-press coach mark sits over the middle count (screen readers get it from #lp-hint).
    if (key === 'approach') {
      const coach = h('span', { class: 'coach', id: 'coach', 'aria-hidden': 'true', hidden: '' }, '숫자를 길게 누르면 바로 골라요');
      coach.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="3" fill="currentColor"/><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".6"/></svg>');
      num.append(coach);
    }
    box.append(h('div', { class: `club club-${key}`, 'data-key': key }, name,
      h('div', { class: 'pill', role: 'group', 'aria-labelledby': `lbl-${key}`, 'aria-describedby': 'lp-hint' }, plus, num, minus)));
  }
  box.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button.step');
    if (!button || button.disabled) return;
    count(button.closest<HTMLElement>('.club')!.dataset.key as Tagged, button.classList.contains('plus') ? 1 : -1);
  });
  bindNumPick();
  $('entry').addEventListener('pointerdown', dismissCoach, true);
  document.addEventListener('keydown', () => {
    if (!$('entry').hidden) dismissCoach();
  });
}

/* ---------- long-press a count: set it straight to 0 … 5+ ---------- */

let coachSeen = loadDisplay().coach;

/** The first tap or key on 기록 while the coach mark shows puts it away for good. */
function dismissCoach(): void {
  if (coachSeen || $('coach').hidden) return;
  coachSeen = true;
  saveDisplay({ coach: true });
  $('coach').hidden = true;
  $('clubs').classList.remove('coached');
}

/** A club's count or a penalty: both open the same 0 … 5+ picker on a long press. */
type Pickable = Tagged | Pen;
const isPen = (key: Pickable): key is Pen => (PENS as readonly string[]).includes(key);
/** What the picker asks for a penalty; a club asks how many times it was played. */
const PEN_QUESTION: Record<Pen, string> = { ob: 'OB 몇 번 났나요?', hazard: '해저드에 몇 번 들어갔나요?', bunker: '벙커에 몇 번 들어갔나요?' };

let press: { el: HTMLElement; key: Pickable; id: number; x: number; y: number; timer: number; fired: boolean } | null = null;
let pickKey: Pickable | null = null;
/**
 * The press that opened the picker is still held, or was let go a moment ago. Its release lands on the picker's
 * backdrop (the modal covers the + and − buttons, so it never counts a stroke) and must not close it.
 */
let holding = false;
let releasedAt = 0;

function cancelPress(): void {
  if (!press) return;
  window.clearTimeout(press.timer);
  press.el.classList.remove('pressing');
  press = null;
}

/** 3으로, 2로: the particle a spoken number takes. */
const toParticle = (n: number) => ([0, 3, 6].includes(n % 10) ? '으로' : '로');

/** The penalty order with `key` added `delta` times, or its latest |delta| taken off: 빼기 takes the last one added. */
function reorder(order: Pen[], key: Pen, delta: number): Pen[] {
  const next = order.slice();
  for (let d = delta; d > 0; d--) next.push(key);
  for (let d = -delta; d > 0; d--) {
    const at = next.lastIndexOf(key);
    if (at >= 0) next.splice(at, 1);
  }
  return next;
}

/** Sets a club's or a penalty's count; 5+ keeps a count already above five. Can be taken back from the toast like a tap. */
function setCount(key: Pickable, n: number): void {
  const index = round.current;
  const before = hole();
  const target = n === 5 ? Math.max(5, before[key]) : n;
  if (target === before[key]) return;
  const order = added.get(index) ?? [];
  if (isPen(key)) added.set(index, reorder(order, key, target - before[key]));
  if (!setHole((x) => bump(x, key, target - x[key]), key)) {
    added.set(index, order);
    return;
  }
  navigator.vibrate?.(8);
  const label = labelOf(key, hole().par);
  announce(`${index + 1}번 홀 ${label} ${hole()[key]}, ${strokes(hole())}타`);
  showToast(`${label} ${target}${toParticle(target)}`, { index, hole: before, added: [...order] });
}

function openNumPick(key: Pickable, pill: HTMLElement): void {
  pickKey = key;
  hideToast();
  const cur = hole();
  setText($('np-title'), isPen(key) ? PEN_QUESTION[key] : `${labelOf(key, cur.par)} 몇 번 쳤나요?`);
  $('np-row').replaceChildren(...[0, 1, 2, 3, 4, 5].map((n) => h('button', {
    type: 'button', 'data-np': String(n), 'aria-pressed': String(n === 5 ? cur[key] >= 5 : cur[key] === n), 'aria-label': n === 5 ? '5번 이상' : `${n}번`,
  }, n === 5 ? '5+' : String(n))));
  const dialog = $<HTMLDialogElement>('numpick');
  dialog.showModal();
  // Over the pill, or under it near the top of the screen. CSSOM, allowed by the CSP.
  const r = pill.getBoundingClientRect();
  const ch = dialog.offsetHeight;
  const top = r.top - ch - 8 < 8 ? r.bottom + 8 : r.top - ch - 8;
  dialog.style.top = `${Math.round(Math.min(top, window.innerHeight - ch - 8))}px`;
  navigator.vibrate?.(15);
  (dialog.querySelector<HTMLElement>('[aria-pressed="true"]') ?? dialog.querySelector<HTMLElement>('button'))!.focus();
}

function bindNumPick(): void {
  const dialog = $<HTMLDialogElement>('numpick');
  // A tap on the dim backdrop closes it, but not the release of the press that opened it.
  dialog.addEventListener('click', (event) => {
    const r = dialog.getBoundingClientRect();
    const outside = event.clientY < r.top || event.clientY > r.bottom || event.clientX < r.left || event.clientX > r.right;
    if (event.target === dialog && outside && !holding && Date.now() - releasedAt > 150) dialog.close();
  });
  dialog.addEventListener('close', () => {
    // Back to the button the press started on: the club's +, or the penalty itself.
    if (pickKey) document.querySelector<HTMLElement>(isPen(pickKey) ? `#stake-${pickKey}` : `.club-${pickKey} .plus`)?.focus({ preventScroll: true });
    pickKey = null;
  });
  $('np-row').addEventListener('click', (event) => {
    const b = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-np]');
    if (!b || !pickKey) return;
    const key = pickKey;
    dialog.close();
    setCount(key, Number(b.dataset.np));
  });
  // Held for half a second, a club's pill or a penalty opens the picker; a shorter press is an ordinary tap.
  const startPress = (e: PointerEvent, el: HTMLElement, key: Pickable) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelPress();
    el.classList.add('pressing');
    const p = { el, key, id: e.pointerId, x: e.clientX, y: e.clientY, timer: 0, fired: false };
    p.timer = window.setTimeout(() => {
      p.fired = true;
      el.classList.remove('pressing');
      holding = true;
      openNumPick(key, el);
    }, 500);
    press = p;
  };
  const clubs = $('clubs');
  clubs.addEventListener('pointerdown', (e) => {
    const pill = (e.target as HTMLElement).closest<HTMLElement>('.pill');
    if (pill) startPress(e, pill, pill.closest<HTMLElement>('.club')!.dataset.key as Tagged);
  });
  const pens = $('pens');
  pens.addEventListener('pointerdown', (e) => {
    const pen = (e.target as HTMLElement).closest<HTMLElement>('button.pen');
    if (pen) startPress(e, pen, pen.dataset.pen as Pen);
  });
  // Moving away (a swipe or a scroll) is not a long press.
  document.addEventListener('pointermove', (e) => {
    if (press && !press.fired && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
  });
  const end = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    if (press.fired) {
      holding = false;
      releasedAt = Date.now();
    }
    cancelPress();
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  // No copy menu or text selection on a held count or penalty.
  clubs.addEventListener('contextmenu', (e) => e.preventDefault());
  pens.addEventListener('contextmenu', (e) => e.preventDefault());
}

/**
 * The penalty row sits on the steppers' columns: OB under 드라이버, 해저드 under 퍼터, and in the middle 빼기 (기본) or
 * 벙커 (상세). In that order in the document too, so Tab goes left to right.
 */
function buildPens(): void {
  const box = $('pens');
  for (const key of PENS) {
    const pen = h('button', { type: 'button', class: 'pen', id: `stake-${key}`, 'data-pen': key, 'aria-label': `${LABELS[key]} 하나 더하기`, 'aria-describedby': 'lp-hint-pen' },
      h('span', { class: 'pen-icon' }, h('span', { class: 'pen-count zero' }, '0')), h('span', { class: 'pen-lbl' }, LABELS[key]));
    pen.querySelector('.pen-icon')!.insertAdjacentHTML('afterbegin', PEN_ICONS[key]);
    box.append(pen);
    if (key === 'bunker') box.append(h('button', { type: 'button', class: 'undo', id: 'pen-undo', hidden: '' }));
  }
  box.addEventListener('click', (event) => {
    const pen = (event.target as HTMLElement).closest<HTMLButtonElement>('button.pen');
    if (pen && !pen.disabled) addPenalty(pen.dataset.pen as Pen);
  });
  $('pen-undo').addEventListener('click', undoPenalty);
}

/* ---------- undo: the last + or − or penalty can be taken back for four seconds ---------- */

/** The hole as it was before the last change, and its penalty order; `back` when 되돌리기 returns to a hole left blank. Not saved. */
let undoable: { index: number; hole: Hole; added: Pen[]; back?: boolean } | null = null;
let toastTimer = 0;

function showToast(text: string, before: NonNullable<typeof undoable>): void {
  undoable = before;
  const toast = $('toast');
  setText($('toast-msg'), text);
  toast.hidden = false;
  replay(toast, 'show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 4000);
}

function hideToast(): void {
  window.clearTimeout(toastTimer);
  undoable = null;
  $('toast').hidden = true;
}

function restore(): void {
  const before = undoable;
  if (!before) return;
  hideToast();
  if (before.back) {
    go(before.index);
    return;
  }
  added.set(before.index, before.added);
  setHoleAt(before.index, () => before.hole);
  announce('되돌렸어요');
}

/**
 * One stroke more or less on a club, a penalty or a mulligan; the hole's score follows. A club or penalty change can
 * be taken back from the toast; `order` is the penalty order to bring back with it.
 */
function count(key: Counter, delta: number, order: Pen[] = added.get(round.current) ?? []): boolean {
  const index = round.current;
  const before = hole();
  if (!setHole((x) => bump(x, key, delta), key)) return false;
  navigator.vibrate?.(8);
  const label = labelOf(key, hole().par);
  announce(`${round.current + 1}번 홀 ${label} ${hole()[key]}, ${strokes(hole())}타`);
  if (key !== 'mulligan') showToast(`${label} ${delta > 0 ? '+1' : '−1'}`, { index, hole: before, added: [...order] });
  return true;
}

function addPenalty(key: Pen): void {
  if (!count(key, 1)) return;
  added.set(round.current, [...(added.get(round.current) ?? []), key]);
}

/** The penalty "빼기" (기본) takes off: the last OB or 해저드 added on this hole, or one that is counted. */
function undoTarget(): Pen | null {
  const cur = hole();
  const order = (added.get(round.current) ?? []).filter((k) => k !== 'bunker' && cur[k] > 0);
  return order.at(-1) ?? (cur.ob > 0 ? 'ob' : cur.hazard > 0 ? 'hazard' : null);
}

function undoPenalty(): void {
  const key = undoTarget();
  if (!key) return;
  const order = added.get(round.current) ?? [];
  const at = order.lastIndexOf(key);
  if (at >= 0) added.set(round.current, [...order.slice(0, at), ...order.slice(at + 1)]);
  count(key, -1, order);
}

/** 미스샷 steps 헛스윙 → 뒤땅/토핑 → none; like every tee result it replaces the one before. */
function nextMiss(tag: ShotTag<'driver'> | null): ShotTag<'driver'> | null {
  return tag === 'whiff' ? 'mishit' : tag === 'mishit' ? null : 'whiff';
}

const isMiss = (tag: ShotTag<'driver'> | null): tag is 'whiff' | 'mishit' => tag === 'whiff' || tag === 'mishit';

function setTee(next: ShotTag<'driver'> | null): void {
  const drives = hole().driver;
  if (!setHole((x) => setTeeTag(x, next), 'tee')) return;
  navigator.vibrate?.(8);
  const counted = hole().driver > drives ? `, 드라이버 ${hole().driver}` : '';
  announce(`티샷 ${next === null ? '지움' : teeText(next, hole().par)}${counted}, ${strokes(hole())}타`);
}

function bindDetail(): void {
  $('detail').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('#tee-miss')) {
      setTee(nextMiss(teeTag(hole())));
      return;
    }
    const button = target.closest<HTMLButtonElement>('button[data-tee]');
    if (!button) return;
    const tag = button.dataset.tee as ShotTag<'driver'>;
    setTee(teeTag(hole()) === tag ? null : tag);
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-mode]')) {
    button.addEventListener('click', () => {
      mode = button.dataset.mode as typeof mode;
      render();
      $('sheet').scrollTop = 0;
      scrollHint();
    });
  }
  $('sheet').addEventListener('scroll', scrollHint, { passive: true });
}

/** A tee result in words; on a par 3 the centre of the pad is the green. */
function teeText(tag: ShotTag<'driver'>, par: Par): string {
  return tag === 'fairway' && par === 3 ? '온그린' : TAG_LABELS.driver[tag];
}

let lastMark = '';

function renderEntry(a: Analysis, changed?: string): void {
  const cur = hole();
  const i = round.current;
  setText($('hole-n'), String(i + 1));
  $('hole-title').classList.toggle('two', i >= 9);
  setText($('hole-par'), `Par ${cur.par}`);
  // Progress, once a hole is finished: how far the round has come ("7홀까지", not to be read as hole 7), then the score
  // against par ("+3"), pinned right beside 홀 안내 so nothing moves when the length or HDCP comes and goes.
  const progN = $('prog-n');
  const progP = $('prog-p');
  progN.hidden = progP.hidden = $('progress').hidden = a.totals.holes === 0;
  setText(progN, `${a.totals.holes}홀까지`);
  if (progP.dataset.v !== String(a.toPar)) {
    progP.dataset.v = String(a.toPar);
    progP.replaceChildren(h('span', { class: 'sr-only' }, '파 대비 '), toParText(a.toPar));
  }
  progP.classList.toggle('under', a.toPar < 0);
  // A hole behind you with nothing recorded: a quiet sand dot on the hole number, which opens the strip.
  const missed = missedHoles();
  // The tick bar in the hole button: every hole, the current one longer, skipped ones in sand.
  const ticks = $('ticks');
  if (ticks.children.length !== round.holes.length) ticks.replaceChildren(...round.holes.map(() => h('i')));
  [...ticks.children].forEach((t, k) => setAttr(t, 'data-t', k === i ? 'cur' : finished(round, k) ? 'done' : missed.includes(k) ? 'miss' : 'later'));
  // The coach mark: once, on hole 1 with nothing recorded, until the first tap (remembered in the prefs key).
  const coached = !coachSeen && i === 0 && !played(cur);
  $('coach').hidden = !coached;
  $('clubs').classList.toggle('coached', coached);
  const holeBtn = $('hole-btn');
  holeBtn.classList.toggle('missed', missed.length > 0);
  // The tick bar is drawn for the eye; its news is in the button's name.
  setAttr(holeBtn, 'aria-label', `${i + 1}번 홀, Par ${cur.par}. 홀 목록, ${a.totals.holes}홀 기록${missed.length ? `, 기록 안 한 홀 ${missed.length}개` : ''}`);
  const info = holeInfo(roundCourse(round), i);
  // A short screen has no band for the drawn hole: a small picture of it leads the row instead (CSS shows it there).
  const thumb = $('hole-thumb');
  const thumbKey = `${cur.par}:${layoutBend(info?.layout)}:${layoutIsland(info?.layout)}`;
  if (thumb.dataset.key !== thumbKey) {
    thumb.dataset.key = thumbKey;
    // Static markup from course-art.ts, built from numbers only.
    thumb.innerHTML = holeThumb(cur.par, layoutBend(info?.layout), layoutIsland(info?.layout));
  }
  // One row: Par, length and HDCP (only with the course's official handicap) as text in one pill.
  setChip('hole-distance', distanceLabel(info));
  setChip('hole-hdcp', info?.si ? `HDCP ${info.si}` : null);
  // Under the hole number when 상세 on a short screen hides the row.
  const sub = $('hole-sub');
  sub.dataset.par = `Par ${cur.par}`;
  sub.dataset.full = [`Par ${cur.par}`, distanceLabel(info)].filter(Boolean).join(', ');
  // 홀 안내: the layout note's phrases ("내리막, 블라인드 티샷") and the official guide, behind one chip.
  const phrases = (info?.layout ?? '').split(/\s*[,，]\s*/).filter(Boolean);
  const notes = $('hole-notes');
  if (notes.dataset.key !== phrases.join('|')) {
    notes.dataset.key = phrases.join('|');
    notes.replaceChildren(...phrases.map((c) => h('li', {}, c)));
  }
  notes.hidden = phrases.length === 0;
  $('hi-none').hidden = phrases.length > 0;
  setText($('hi-title'), `${i + 1}번 홀 안내`);
  setText($('hi-facts'), [`Par ${cur.par}`, distanceLabel(info), info?.si ? `HDCP ${info.si}` : null].filter(Boolean).join(', '));
  const guide = $<HTMLAnchorElement>('hole-guide');
  if (info?.guideUrl) setAttr(guide, 'href', info.guideUrl);
  else guide.removeAttribute('href');
  guide.hidden = !info?.guideUrl;
  const infoBtn = $('info-btn');
  infoBtn.hidden = phrases.length === 0 && !info?.guideUrl;
  const infoN = $('info-n');
  infoN.hidden = phrases.length === 0;
  setText(infoN, String(phrases.length));
  setAttr(infoBtn, 'aria-label', `홀 안내${phrases.length ? `, 특징 ${phrases.length}개` : ''}`);
  fitNotes();
  $<HTMLButtonElement>('prev-hole').disabled = i === 0;
  $<HTMLButtonElement>('next-hole').disabled = i === lastHole();

  for (const key of TAGGED) {
    const n = cur[key];
    const el = $(`count-${key}`);
    const before = el.textContent;
    setText(el, String(n));
    el.classList.toggle('zero', n === 0);
    if (changed === key && before !== el.textContent) replay(el, 'bump');
    const club = document.querySelector(`.club-${key}`)!;
    club.querySelector<HTMLButtonElement>('.plus')!.disabled = n >= MAX_COUNT;
    club.querySelector<HTMLButtonElement>('.minus')!.disabled = n === 0;
    const label = labelOf(key, cur.par);
    setText($(`count-label-${key}`), `${label} ${n}`);
    setText(club.querySelector('.club-name')!, label);
    setAttr(club.querySelector('.plus')!, 'aria-label', `${label} 하나 더하기`);
    setAttr(club.querySelector('.minus')!, 'aria-label', `${label} 하나 빼기`);
  }

  // The badge: the hole's computed score with its scorecard mark.
  const s = strokes(cur);
  const done = finished(round, i);
  const d = s - cur.par;
  const mark: Mark = done ? markOf(d) : 'none';
  // Before the first tap a quiet ring shows the hole's par: the goal, not an empty score.
  const name = done ? scoreWord(s, cur.par) : played(cur) ? '진행 중' : 'Par';
  setText($('hole-strokes'), String(played(cur) ? s : cur.par));
  const bmark = $('bmark');
  setAttr(bmark, 'data-mark', mark);
  bmark.classList.toggle('two', s >= 10);
  const badge = $('badge');
  setAttr(badge, 'data-tone', done ? toneOf(d) : played(cur) ? 'progress' : 'none');
  // The badge is a 96px circle: 트리플 보기 and 쿼드러플 보기 read 트리플 and 쿼드러플 there (the label keeps the full name).
  setText($('hole-name'), name.replace(/^(트리플|쿼드러플) 보기$/, '$1'));
  setAttr(badge, 'aria-label', played(cur) ? `이 홀 ${s}타 ${name}` : `이 홀 아직 기록 전, Par ${cur.par}`);
  const markKey = `${i}:${mark}`;
  // Static markup from SHAPES; written only when the mark changes, so a drawing mark is not restarted.
  if (markKey !== lastMark) $('bm').innerHTML = SHAPES[mark];
  const under = mark === 'birdie' || mark === 'eagle';
  if (!under) celebrated.delete(i);
  if (changed && under && !celebrated.has(i)) {
    // A birdie or better: the mark draws itself and the badge rings, once.
    celebrated.add(i);
    badge.classList.remove('settle');
    replay(badge, 'celebrate');
    navigator.vibrate?.([12, 60, 18]);
  } else if (changed && lastMark && lastMark !== markKey && mark !== 'none' && !under) {
    badge.classList.remove('celebrate');
    replay(badge, 'settle');
  }
  lastMark = markKey;

  // 기본 / 상세
  setAttr($('entry'), 'data-mode', mode);
  // 상세 on a short screen shows Par and length under the hole number: fit them beside the badge.
  fitSwitcher();
  $('detail').hidden = mode !== 'detail';
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-mode]')) setAttr(button, 'aria-pressed', String(button.dataset.mode === mode));
  const tag = teeTag(cur);
  setText($('center-label'), cur.par === 3 ? '온그린' : '페어웨이');
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-tee]')) {
    const t = button.dataset.tee;
    // An OB tag from a shot's details shows on its side of the pad.
    setAttr(button, 'aria-pressed', String(tag === t || (tag === 'ob-left' && t === 'left') || (tag === 'ob-right' && t === 'right')));
  }
  const value = $('tee-val');
  setText(value, tag ? teeText(tag, cur.par) : '선택 안 함');
  value.classList.toggle('none', !tag);
  const miss = $('tee-miss');
  const missLabel = isMiss(tag) ? TAG_LABELS.driver[tag] : null;
  setText(miss, missLabel ?? '미스샷');
  setAttr(miss, 'aria-pressed', String(missLabel !== null));
  setAttr(miss, 'aria-label', `미스샷 ${missLabel ?? '없음'}. 누를 때마다 헛스윙, 뒤땅/토핑, 없음 순서로 바뀌어요`);

  for (const key of PENS) {
    const n = cur[key];
    const pen = $<HTMLButtonElement>(`stake-${key}`);
    pen.classList.toggle('on', n > 0);
    const badgeEl = pen.querySelector('.pen-count')!;
    setText(badgeEl, String(n));
    badgeEl.classList.toggle('zero', n === 0);
    pen.disabled = n >= MAX_COUNT;
    setAttr(pen, 'aria-label', `${LABELS[key]} 하나 더하기${n ? ` (지금 ${n})` : ''}`);
  }
  const target = undoTarget();
  const undo = $('pen-undo');
  undo.hidden = target === null;
  if (target) {
    if (undo.dataset.key !== target) {
      undo.dataset.key = target;
      // Static icon markup and a fixed label.
      undo.innerHTML = `<span class="u-ico">${MINUS}</span><span>${LABELS[target]} 빼기</span>`;
    }
    setAttr(undo, 'aria-label', `${LABELS[target]} 하나 빼기`);
  }
  setText($('go-next'), i === lastHole() ? '라운드 마치기' : '다음 홀');
}

/* ---------- 스코어카드 ---------- */

/** How a scorecard is shown: the current round's columns open holes or, in 파 수정, step pars; a past round's only read. */
type CardMode = 'open' | 'edit' | 'read';

/** A hole's column: a button that opens the hole, a column whose par cell is the button (파 수정), or plain (a past round). */
function holeColumn(r: Round, i: number, mode: CardMode): HTMLElement {
  const x = r.holes[i];
  const done = finished(r, i);
  const s = strokes(x);
  const d = s - x.par;
  const published = publishedPar(roundCourse(r), i);
  const par = mode === 'edit'
    ? h('button', { type: 'button', class: `par-btn${published !== null && x.par !== published ? ' changed' : ''}`, 'data-par-hole': String(i), 'aria-label': `${i + 1}번 홀 Par ${x.par}, 누르면 바뀜` }, String(x.par))
    : h('span', { class: 'pr' }, String(x.par));
  const cells = [
    h('span', { class: 'no' }, String(i + 1)),
    par,
    h('span', { class: 'sc-row' }, h('span', { class: 'm', 'data-mark': done ? markOf(d) : 'none', 'data-tone': done ? toneOf(d) : 'none' }, h('b', {}, done ? String(s) : '–'))),
    h('span', { class: 'pt' }, done ? String(x.putts) : ''),
  ];
  if (mode === 'read') return h('div', { class: 'col' }, ...cells);
  if (mode === 'edit') return h('div', { class: 'col', 'aria-current': String(i === r.current) }, ...cells);
  const state = done ? `, ${s}타 ${scoreWord(s, x.par)}, 퍼트 ${x.putts}` : ', 기록 없음';
  return h('button', { type: 'button', class: 'col', 'data-hole': String(i), 'aria-current': String(i === r.current), 'aria-label': `${i + 1}번 홀로 가기, Par ${x.par}${state}` }, ...cells);
}

/** 파 수정: Par 3 → 4 → 5 → 3, keeping focus on the same hole's button. */
function cyclePar(index: number): void {
  const next = PARS[(PARS.indexOf(round.holes[index].par) + 1) % PARS.length];
  setHoleAt(index, (x) => ({ ...x, par: next }));
  document.querySelector<HTMLButtonElement>(`button[data-par-hole="${index}"]`)?.focus();
  announce(`${index + 1}번 홀 Par ${next}`);
}

function table(r: Round, a: Analysis, from: number, to: number, sub: string | null, mode: CardMode): HTMLElement {
  const labels = h('div', { class: 'rowlbl', 'aria-hidden': 'true' }, h('span', {}, '홀'), h('span', { class: 'pr-row' }, '파'), h('span', { class: 'sc-row' }, '타수'), h('span', {}, '퍼트'));
  const box = h('div', { class: 'tbl' }, labels);
  for (let i = from; i < to; i++) box.append(holeColumn(r, i, mode));
  if (sub) {
    // The nine this subtotal closes: holes 1–9 or 10–18.
    const start = from >= 9 ? 9 : 0;
    const t = a[start === 0 ? 'front' : 'back'];
    const par = r.holes.slice(start, start + 9).reduce((n, x) => n + x.par, 0);
    box.append(h('div', { class: 'col sub' }, h('span', { class: 'no' }, sub), h('span', { class: 'pr' }, String(par)),
      h('span', { class: 'sc-row' }, h('b', { class: 'sub-v' }, t.holes ? String(t.strokes) : '–')), h('span', { class: 'pt' }, t.holes ? String(t.putts) : '')));
  }
  return box;
}

/**
 * One nine of the round being recorded as a classic scorecard table: holes as columns and the nine's subtotal, rows
 * 홀, 파, 타수, 퍼트, the current hole's column marked, blank cells for holes not finished. The whole table is one
 * button: it opens the hole strip at that nine.
 */
function classicNine(r: Round, a: Analysis, start: number): HTMLElement {
  const course = roundCourse(r);
  const single = r.holes.length === 9;
  const name = (start === 0 ? course.front : course.back) || (single ? '9홀' : start === 0 ? '전반 9홀' : '후반 9홀');
  const label = single ? '9홀' : start === 0 ? '전반' : '후반';
  const t = start === 0 ? a.front : a.back;
  const cols = Array.from({ length: 9 }, (_, k) => start + k);
  const cell = (k: number, ...content: (Node | string)[]) => h('span', { class: k === r.current ? 'cur' : '', 'data-col': String(k) }, ...content);
  const score = (k: number) => {
    const x = r.holes[k];
    if (!finished(r, k)) return '';
    const d = strokes(x) - x.par;
    return h('span', { class: 'm', 'data-mark': markOf(d), 'data-tone': toneOf(d) }, h('b', {}, String(strokes(x))));
  };
  const row = (cls: string, head: string, cells: HTMLElement[], sum: string) => h('span', { class: `r ${cls}` }, h('span', { class: 'ct-l' }, head), ...cells, h('span', { class: 'ct-s' }, sum));
  const par = cols.reduce((n, k) => n + r.holes[k].par, 0);
  return h('button', { type: 'button', class: 'nine-tbl', 'data-nine': String(start), 'aria-label': `${name} ${label}, ${t.holes ? `${t.holes}홀 ${t.strokes}타` : '기록 없음'}. 눌러서 홀 고르기` },
    h('span', { class: 'nt-h' }, h('b', {}, name), h('small', {}, label), h('span', { class: 'nt-go' }, '홀 고르기')),
    h('span', { class: 'ct', 'aria-hidden': 'true' },
      row('r-h', '홀', cols.map((k) => cell(k, String(k + 1))), label),
      row('r-p', '파', cols.map((k) => cell(k, String(r.holes[k].par))), String(par)),
      row('r-s', '타수', cols.map((k) => cell(k, score(k))), t.holes ? String(t.strokes) : ''),
      row('r-t', '퍼트', cols.map((k) => cell(k, finished(r, k) ? String(r.holes[k].putts) : '')), t.holes ? String(t.putts) : '')));
}

/** A round's nines as scorecard columns, each nine in its own `.scorecard` block: two, or one for a 9-hole round. */
function scorecardNodes(r: Round, a: Analysis, mode: CardMode): HTMLElement[] {
  if (mode === 'open') return r.holes.length === 9 ? [classicNine(r, a, 0)] : [classicNine(r, a, 0), classicNine(r, a, 9)];
  const course = roundCourse(r);
  const single = r.holes.length === 9;
  const side = (start: number) => (single ? '9홀' : start === 0 ? '전반' : '후반');
  const nine = (start: number) => h('div', { class: 'scorecard' },
    h('div', { class: 'nine-h' }, h('h3', {}, (start === 0 ? course.front : course.back) || (single ? '9홀' : start === 0 ? '전반 9홀' : '후반 9홀')), h('span', {}, side(start))),
    table(r, a, start, start + 5, null, mode),
    table(r, a, start + 5, start + 9, single ? '합계' : side(start), mode));
  return single ? [nine(0)] : [nine(0), nine(9)];
}

/**
 * The total line under the nines, for a past round (the current round's is static markup): holes, to-par, then the
 * total in the 전반/후반 column as a bare number like the subtotals above it ("타" is read, not shown).
 */
function totalLine(a: Analysis): HTMLElement {
  const t = a.totals;
  return h('div', { class: 'tot' }, h('h3', {}, '합계'), h('span', {}, `${t.holes}홀`),
    h('b', { class: `tot-p${t.holes && a.toPar < 0 ? ' under' : ''}` }, toParText(t.holes ? a.toPar : 0)),
    h('b', { class: 'tot-n' }, h('span', {}, String(t.strokes)), h('span', { class: 'sr-only' }, '타')));
}

function renderCard(a: Analysis): void {
  const course = roundCourse(round);
  setText($('sc-sub'), `${course.name} ${dateLabel(round.date).replace(/^\d+년 /, '')}`);
  $('sc-sheet').classList.toggle('editing', editPar);
  const edit = $('edit-par');
  setText(edit, editPar ? '완료' : '파 수정');
  edit.classList.toggle('on', editPar);
  $('edit-hint').hidden = !editPar;
  const t = a.totals;
  // The hero, or a first-run line with a way to the hole when nothing is recorded yet.
  $('sc-hero').hidden = t.holes === 0;
  $('sh-empty').hidden = t.holes > 0;
  setText($('sh-go'), `${round.current + 1}번 홀 기록하기`);
  setAttr($('sh-ring'), 'data-tone', t.holes ? toneOf(a.toPar) : 'over');
  setText($('sh-sub'), `${round.holes.length}홀 중 ${t.holes}홀 기록`);
  setText($('sum-strokes'), String(t.strokes));
  const topar = $('sum-topar');
  setText(topar, toParText(t.holes ? a.toPar : 0));
  topar.classList.toggle('under', t.holes > 0 && a.toPar < 0);
  setText($('sum-putts'), String(t.putts));
  setText($('sum-ob'), String(t.ob));
  setText($('sum-hazard'), String(t.hazard));
  $('scorecard').replaceChildren(...scorecardNodes(round, a, editPar ? 'edit' : 'open'));
  setText($('tot-holes'), `${t.holes}홀`);
  // The total sits in the 전반/후반 column under the subtotals: a bare number like them ("타" is read, not shown), and
  // a dash with no to-par before any hole is recorded, as the empty subtotals above it are blank.
  setText($('tot-strokes'), t.holes ? String(t.strokes) : '–');
  setText($('tot-unit'), t.holes ? '타' : '');
  const total = $('tot-topar');
  setText(total, t.holes ? toParText(a.toPar) : '');
  total.classList.toggle('under', t.holes > 0 && a.toPar < 0);

  const areas = Object.keys(AREA_LABELS) as Area[];
  const most = Math.max(...areas.map((k) => a.lost[k]));
  // 타수를 잃은 곳 waits for three finished holes: one or two say little.
  const waiting = t.holes < 3;
  $('lost-bars').hidden = waiting;
  setText($('lost-note'), waiting
    ? `${3 - t.holes}홀 더 기록하면 어디서 타수를 잃었는지 보여요.`
    : a.worstAreas.length
      ? `${a.worstAreas.map((k) => AREA_LABELS[k]).join(', ')}에서 가장 많이 잃었어요. 티샷 1번, 어프로치 Par−3번, 퍼트 2번을 기준으로 셌어요.`
      : '기준보다 잃은 타수가 없어요.');
  const scale = Math.max(most, 3);
  $('lost-bars').replaceChildren(...areas.map((k) => {
    const fill = h('i');
    fill.style.width = `${(a.lost[k] / scale) * 100}%`;
    return h('li', { class: a.worstAreas.includes(k) ? 'worst' : '' }, h('span', {}, AREA_LABELS[k]), h('span', { class: 'bar' }, fill), h('span', { class: 'v' }, `+${a.lost[k]}`));
  }));
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

function bar(label: string, value: number, max: number, text: string, cls = ''): HTMLElement {
  const fill = h('span', { class: `bar-fill ${cls}` });
  fill.style.width = `${max > 0 ? Math.max(0, (value / max) * 100) : 0}%`;
  return h('div', { class: 'bar-row' }, h('span', { class: 'bar-label' }, label), h('span', { class: 'bar-track' }, fill), h('span', { class: 'bar-value' }, text));
}

function renderAnalysis(a: Analysis): void {
  $('analysis').replaceChildren(...analysisNodes(a));
}

/** The analysis of a round, for this round and for past ones. */
function analysisNodes(a: Analysis): (Node | string)[] {
  const t = a.totals;
  if (!t.holes) return [h('p', { class: 'muted' }, '홀을 기록하면 여기에 합계와 분석이 나옵니다.')];
  const metrics = [
    ['평균 퍼트', `${one(a.puttsPerHole)}개/홀`],
    ['1퍼트', `${a.onePutts}홀`],
    ['3퍼트 이상', `${a.threePutts}홀`],
    ['그린 적중', `${a.girHoles}/${t.holes} (${pct(a.girHoles, t.holes)}%)`],
    ['벌타', `OB ${t.ob}, 해저드 ${t.hazard} (+${t.ob + t.hazard}타)`],
    ['멀리건', `${t.mulligan}회`],
  ];
  const maxDist = Math.max(...Object.values(a.distribution));
  return [
    h('p', { class: 'headline' }, `${t.holes}홀 ${t.strokes}타`, h('span', { class: a.toPar < 0 ? 'under' : '' }, ` ${formatToPar(a.toPar)}`),
      t.holes < round.holes.length ? h('span', { class: 'muted' }, `, 남은 ${round.holes.length - t.holes}홀`) : null),
    h('dl', { class: 'metrics' }, ...metrics.flatMap(([k, v]) => [h('div', {}, h('dt', {}, k), h('dd', {}, v))])),
    h('h4', {}, '스코어 분포'),
    h('div', { class: 'bars' }, ...(Object.keys(SCORE_LABELS) as ScoreName[]).map((k) => bar(SCORE_LABELS[k], a.distribution[k], maxDist, `${a.distribution[k]}홀`, `score-${k}`))),
    h('h4', {}, 'Par별 평균'),
    h('dl', { class: 'metrics three' }, ...a.byPar.map((p) => h('div', {}, h('dt', {}, `Par ${p.par}`), h('dd', {}, p.holes ? `${one(p.average)}타 (${p.holes}홀)` : '—')))),
    a.best && a.worst
      ? h('p', { class: 'best-worst' }, `가장 잘한 홀 ${a.best.hole}번 (${formatToPar(a.best.toPar)}), 가장 아쉬운 홀 ${a.worst.hole}번 (${formatToPar(a.worst.toPar)})`)
      : '',
    h('h4', {}, '정리'),
    h('ul', { class: 'insights' }, ...insights(a).map((s) => h('li', {}, s))),
    ...(a.details
      ? [h('h4', {}, '샷 세부'), h('ul', { class: 'insights details' }, ...detailLines(a).map((s) => h('li', {}, s)))]
      : []),
  ];
}

const canShare = typeof navigator.share === 'function';
const canCopy = typeof navigator.clipboard?.writeText === 'function';

function renderSend(a: Analysis): void {
  const ready = a.totals.holes > 0;
  $('send-actions').hidden = !ready;
  setText($('send-note'), ready
    ? '이메일은 휴대폰 메일 앱이 열리고 스코어카드와 분석이 본문에 채워집니다. 받는 사람은 메일 앱에서 넣으세요.'
    : '홀을 끝내면 스코어카드와 분석을 이메일이나 메신저로 보낼 수 있습니다.');
  if (ready) $<HTMLAnchorElement>('send-email').href = mailtoHref(round);
  const share = $<HTMLButtonElement>('send-share');
  share.hidden = !canShare && !canCopy;
  setText(share, canShare ? '공유하기' : '결과 복사');
  $('send-copy').hidden = !canCopy;
}

/** CSV 저장: the round's holes as a spreadsheet file, UTF-8 with a BOM so Excel reads the Korean headers. */
function saveCsv(): void {
  const name = csvName(round);
  const url = URL.createObjectURL(new Blob(['\uFEFF', roundCsv(round)], { type: 'text/csv;charset=utf-8' }));
  const link = h('a', { href: url, download: name, hidden: '' });
  document.body.append(link);
  link.click();
  link.remove();
  // The download keeps its own copy; the URL only has to outlive the click.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  setText($('send-status'), `CSV 파일을 저장했어요 (${name}). 엑셀이나 구글 시트에서 열 수 있어요.`);
}

/** 분석용 텍스트 복사: the round as plain facts on the clipboard, to paste into a note or any chat. */
async function copyAnalysis(): Promise<void> {
  try {
    await navigator.clipboard.writeText(analysisText(round));
    setText($('send-status'), '분석용 텍스트를 복사했어요. 메모나 채팅에 붙여 넣으세요.');
  } catch {
    setText($('send-status'), '복사하지 못했어요. CSV 저장이나 이메일을 써 주세요.');
  }
}

/** Shares a round's report (this round or a past one), or copies it where the browser cannot share. */
async function shareReport(r: Round, status: HTMLElement): Promise<void> {
  const text = reportText(r);
  if (canShare) {
    try {
      await navigator.share({ title: reportSubject(r), text });
      setText(status, '');
    } catch (error) {
      // Closing the share sheet is not an error worth showing.
      if ((error as DOMException).name !== 'AbortError') setText(status, '공유하지 못했습니다. 이메일로 보내기를 써 주세요.');
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setText(status, '결과를 복사했습니다. 메신저나 메모에 붙여 넣으세요.');
  } catch {
    setText(status, '복사하지 못했습니다. 이메일로 보내기를 써 주세요.');
  }
}

function renderCourse(): void {
  const course = roundCourse(round);
  setText($('course-name'), roundLabel(round));
  const source = courseSource(course);
  const box = $('par-source');
  const key = source ? `${source.source}|${source.checked}` : 'custom';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren(...(source
    ? ['기본 Par 출처: ', h('a', { href: source.source, target: '_blank', rel: 'noopener noreferrer' }, '공식 스코어카드'), ` (${source.checked} 확인). 파 수정에서 홀마다 바꿀 수 있어요.`]
    : ['직접 입력한 코스라 Par 4로 시작했습니다. 파 수정에서 홀마다 바꿀 수 있습니다.']));
}

/* ---------- menu: course, version and mulligans ---------- */

let menuOpener: HTMLElement | null = null;

function renderMenu(): void {
  const cur = hole();
  setText($('mulligan-count'), String(cur.mulligan));
  $<HTMLButtonElement>('mulligan-minus').disabled = cur.mulligan === 0;
  $<HTMLButtonElement>('mulligan-plus').disabled = cur.mulligan >= MAX_COUNT;
  setText($('mulligan-sub'), `${round.current + 1}번 홀 ${cur.mulligan}개, 타수에 넣지 않아요`);
  setText($('menu-version'), VERSION_LABEL);
  setText($('about-version'), VERSION_LABEL);
  setText($('new-question'), newRoundQuestion(round));
  setText($('new-sub'), hasFinishedHole(round) ? '지금 라운드는 지난 라운드에 남아요' : '끝낸 홀이 없으면 남기지 않아요');
}

/** Opens one item's panel (or none), closing the others. */
function openItem(id: string | null): void {
  for (const item of document.querySelectorAll<HTMLButtonElement>('#menu .mi[aria-controls]')) {
    const on = item.id === `mi-${id}`;
    setAttr(item, 'aria-expanded', String(on));
    const panel = $(item.getAttribute('aria-controls')!);
    panel.hidden = !on;
    // On a short screen the opened panel's buttons may sit below the fold: bring them into the sheet's view.
    if (on) panel.scrollIntoView({ block: 'nearest' });
  }
}

/** 큰 글씨: numbers and labels about 1.15 times larger, for reading at arm's length in sunlight. */
function applyBig(on: boolean): void {
  document.body.classList.toggle('big', on);
  setAttr($('mi-big'), 'aria-checked', String(on));
}

/** 코스 바꾸기: the round moves to another course or nine order; its strokes stay and each hole takes that course's par. */
function changeCourse(choice: CourseChoice): void {
  const setup = roundSetup(choice);
  savePrefs(choice);
  update({ ...round, course: setup.course, holes: round.holes.map((x, i) => (x.par === setup.pars[i] ? x : { ...x, par: setup.pars[i] })) });
  announce(`코스를 ${roundLabel({ course: setup.course, holes: setup.pars })}로 바꿨어요`);
}

function bindMenu(): void {
  const menu = $<HTMLDialogElement>('menu');
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-menu]')) {
    button.addEventListener('click', () => {
      menuOpener = button;
      renderMenu();
      openItem(null);
      menu.showModal();
    });
  }
  for (const item of document.querySelectorAll<HTMLButtonElement>('#menu .mi[aria-controls]')) {
    item.addEventListener('click', () => openItem(item.getAttribute('aria-expanded') === 'true' ? null : item.id.slice(3)));
  }
  // 큰 글씨: a switch, remembered in the prefs key.
  const big = $('mi-big');
  big.addEventListener('click', () => {
    const on = big.getAttribute('aria-checked') !== 'true';
    applyBig(on);
    saveDisplay({ big: on });
    render();
    announce(on ? '큰 글씨를 켰어요' : '큰 글씨를 껐어요');
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('#menu [data-collapse]')) {
    button.addEventListener('click', () => {
      openItem(null);
      $('mi-new').focus();
    });
  }
  $('menu-close').addEventListener('click', () => menu.close());
  // A tap on the dim backdrop, outside the sheet, closes it.
  menu.addEventListener('click', (event) => {
    const r = menu.getBoundingClientRect();
    if (event.target === menu && (event.clientY < r.top || event.clientY > r.bottom || event.clientX < r.left || event.clientX > r.right)) menu.close();
  });
  menu.addEventListener('close', () => menuOpener?.focus());
  $('mulligan-plus').addEventListener('click', () => count('mulligan', 1));
  $('mulligan-minus').addEventListener('click', () => count('mulligan', -1));
  // The panel is the question; the course picker still lets the player go back.
  $('new-round').addEventListener('click', () => {
    menu.close();
    openPicker({ mode: 'new', initial: loadPrefs(), onStart: startRound });
  });
  $('change-course').addEventListener('click', () => {
    menu.close();
    // The round keeps its holes: 18 or 9 is fixed here.
    openPicker({ mode: 'new', initial: loadPrefs(), title: '코스 바꾸기', startLabel: '이 코스로 바꾸기', onStart: changeCourse, holes: round.holes.length === 9 ? 9 : 18 });
  });
}

/* ---------- 라운드 마치기: a summary of what the recorded holes say ---------- */

/** Set once a round is kept from the summary: no round until a course is chosen, as on a first visit. */
let roundless = false;
let summaryOpener: HTMLElement | null = null;

function renderSummary(): void {
  const a = analyze(round);
  const t = a.totals;
  const nine = roundCheck().nine;
  const [front, back] = nineNames();
  const playedNine = nine === 'front' ? front : back;
  setText($('sum-title'), nine || round.holes.length === 9 ? '9홀 라운드 요약' : '라운드 요약');
  setText($('sum-sub'), `${nine ? `${roundCourse(round).name} ${playedNine}` : roundLabel(round)}, ${dateLabel(round.date).replace(/^\d+년 /, '')}`);
  setAttr($('sum-ring'), 'data-tone', t.holes ? toneOf(a.toPar) : 'over');
  setText($('sum-total'), String(t.strokes));
  const vs = $('sum-vs');
  setText(vs, t.holes ? `파 대비 ${toParText(a.toPar)}` : '기록한 홀이 없어요');
  vs.classList.toggle('under', t.holes > 0 && a.toPar < 0);
  const count = round.holes.length;
  setText($('sum-count'), !t.holes ? '홀을 기록하면 여기에 보여요' : nine ? `${playedNine} 9홀을 모두 기록했어요` : t.holes === count ? `${count}홀을 모두 기록했어요` : `${t.holes}홀만 기록했어요. 기록한 홀만 계산해요`);
  const d = a.distribution;
  const marks: [Mark, string, number][] = [['eagle', '이글', d.eagle], ['birdie', '버디', d.birdie], ['par', '파', d.par], ['bogey', '보기', d.bogey], ['double', '더블', d.double], ['triple', '트리플+', d.triple]];
  $('sum-marks').replaceChildren(...marks.map(([m, label, n]) => h('li', {},
    h('span', { class: 'm', 'data-mark': m, 'data-tone': m === 'eagle' || m === 'birdie' ? 'under' : m === 'par' ? 'par' : 'over' }, h('b', {}, String(n))),
    h('small', {}, m === 'triple' ? h('span', { 'aria-hidden': 'true' }, label) : label, m === 'triple' ? h('span', { class: 'sr-only' }, '트리플 이상') : null))));
  const done = round.holes.map((x, i) => ({ x, i })).filter(({ i }) => finished(round, i));
  const drives = done.filter(({ x }) => x.par >= 4 && teeTag(x) !== null);
  const hit = drives.filter(({ x }) => teeTag(x) === 'fairway').length;
  const half = (n: typeof a.front) => (n.holes ? [`${n.strokes}타`, toParText(n.strokes - n.par)] : ['기록 없음', '']);
  const best = a.best ? round.holes[a.best.hole - 1] : null;
  const stat = (label: string, value: string, small = '') => h('div', {}, h('dt', {}, label), h('dd', {}, value, small ? h('small', {}, small) : null));
  // A 9-hole round has no other nine to compare.
  $('sum-stats').replaceChildren(
    ...(nine || count === 9 ? [] : [stat('전반', ...half(a.front) as [string, string]), stat('후반', ...half(a.back) as [string, string])]),
    stat('퍼트', `${t.putts}개`, t.holes ? `홀당 ${one(a.puttsPerHole)}` : ''),
    stat('그린 적중', t.holes ? `${a.girHoles}/${t.holes}` : '–', t.holes ? `${pct(a.girHoles, t.holes)}%` : ''),
    stat('페어웨이 안착', drives.length ? `${hit}/${drives.length}` : '기록 없음', drives.length ? `${pct(hit, drives.length)}%` : '상세에서 티샷 방향을 고르면 보여요'),
    stat('벌타', `OB ${t.ob}`, `해저드 ${t.hazard}`),
    stat('베스트 홀', a.best && best ? `${a.best.hole}번 홀` : '–', a.best && best ? scoreWord(strokes(best), best.par) : ''),
  );
  setText($('sum-insight'), !t.holes
    ? '홀을 기록하면 어디서 타수를 잃었는지 보여요.'
    : a.worstAreas.length
      ? `타수를 가장 많이 잃은 곳: ${a.worstAreas.map((k) => AREA_LABELS[k]).join(', ')} +${a.lost[a.worstAreas[0]]}`
      : '기준보다 잃은 타수가 없어요.');
  $<HTMLAnchorElement>('sum-mail').href = mailtoHref(round);
  $('sum-share').hidden = !canShare && !canCopy;
  setAttr($('sum-share'), 'aria-label', canShare ? '공유' : '결과 복사');
  $<HTMLButtonElement>('sum-archive').disabled = t.holes === 0;
}

/** Only 라운드 마치기 opens it: the player moves on from the hole being played, which then counts like any other. */
function openSummary(from: HTMLElement): void {
  summaryOpener = from;
  hideToast();
  if (!round.closed) update({ ...round, closed: true });
  setText($('sum-status'), '');
  renderSummary();
  $<HTMLDialogElement>('summary').showModal();
  // The share image is drawn after the sheet shows, with a placeholder until then.
  openSummaryShare(round);
}

/** 지난 라운드에 보관: the round joins the past rounds and the app waits, as on a first visit, for the next course. */
function keepFinishedRound(): void {
  if (!keepBeforeNewRound(round)) return;
  summaryOpener = $('tab-hist');
  $<HTMLDialogElement>('summary').close();
  hideToast();
  stale = false;
  editPar = false;
  added.clear();
  celebrated.clear();
  clearRound();
  round = newRound(new Date(), roundSetup(resolveChoice(loadPrefs())));
  roundless = true;
  backupNudge = 'ask';
  render();
  show('hist', true);
  announce('지난 라운드에 보관했어요. 다음 라운드는 코스를 고르고 시작해요');
}

/* ---------- saved records gone or unreadable: said on the first screen, with a way back ---------- */

type Missing = 'unreadable' | 'gone';

/** Why the first screen has nothing to continue when that is not a first visit; null on an ordinary first visit. */
function missingKind(): Missing | null {
  if (rescued) return 'unreadable';
  const kv = store();
  const raw = (key: string) => {
    try {
      return kv?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const past = raw(HISTORY_KEY);
  const read = readHistory(past);
  if (past !== null && read.lossy && read.entries.length === 0) return 'unreadable';
  // Opened from the home screen with nothing stored at all: the browser may have cleared this site's data.
  if (standalone() && raw(STORAGE_KEY) === null && raw(PREFS_KEY) === null && past === null) return 'gone';
  return null;
}

function showMissing(kind: Missing | null): void {
  $('picker-missing').hidden = kind === null;
  if (!kind) return;
  setText($('pm-title'), kind === 'gone' ? '저장된 기록을 찾지 못했어요' : '저장된 기록을 읽지 못했어요');
  setText($('pm-text'), kind === 'gone'
    ? '홈 화면에서 열었는데 이 기기에 기록이 없어요. 브라우저가 오래 쓰지 않은 사이트의 기록을 정리했을 수 있어요. 백업 파일이 있으면 되살릴 수 있어요.'
    : '이 기기에 저장된 기록을 읽을 수 없어 원래 값은 따로 보관했어요. 백업 파일이 있으면 되살릴 수 있어요.');
  setText($('pm-status'), '');
}

function bindMissing(): void {
  // The backup view's own file picker and import, from the first screen.
  $('pm-restore').addEventListener('click', () => $('backup-import').click());
  $('pm-close').addEventListener('click', () => {
    $('picker-missing').hidden = true;
    $('picker-start').focus();
  });
  // The import says how it went in the backup view (in the menu); the card says it here too.
  new MutationObserver(() => {
    if (!$('picker-missing').hidden) setText($('pm-status'), $('backup-status').textContent ?? '');
  }).observe($('backup'), { subtree: true, childList: true, characterData: true });
}

/** With no round, 기록 and 스코어카드 start with the course picker; 닫기 stays on 지난 라운드. */
function pickFirst(): void {
  openPicker({ mode: 'new', initial: loadPrefs(), cancelLabel: '닫기', onStart: startRound });
}

function bindSummary(): void {
  const dialog = $<HTMLDialogElement>('summary');
  $('sum-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => summaryOpener?.focus());
  // 공유 sends the round as an image where the share sheet takes files; otherwise the text share or copy as before.
  dialog.addEventListener('close', closeSummaryShare);
  bindSummaryShare((r) => shareReport(r, $('sum-status')));
  $('sum-share').addEventListener('click', () => void shareSummary(round));
  $('sum-save').addEventListener('click', () => saveSummaryImage(round));
  $('sum-archive').addEventListener('click', keepFinishedRound);
  $('finish-round').addEventListener('click', () => requestFinish($('finish-round')));
  bindCheck();
  bindStrip();
  bindHoleInfo();
}

/** A tap on the dim backdrop, outside the dialog's box, closes it. */
function closeOnBackdrop(dialog: HTMLDialogElement): void {
  dialog.addEventListener('click', (event) => {
    const r = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientY < r.top || event.clientY > r.bottom || event.clientX < r.left || event.clientX > r.right)) dialog.close();
  });
}

/* ---------- 라운드 마치기: a quick check first, when something looks unfinished ---------- */

/** The two nines' names, or 전반/후반 where the course has none. */
function nineNames(): [string, string] {
  const course = roundCourse(round);
  return [course.front || '전반', course.back || '후반'];
}

/** Holes with nothing recorded, holes with strokes but no putt, and whether exactly one nine was played. */
function roundCheck(): { blank: number[]; noPutt: number[]; nine: 'front' | 'back' | null } {
  const blank: number[] = [];
  const noPutt: number[] = [];
  round.holes.forEach((x, k) => {
    if (!played(x)) blank.push(k);
    else if (x.putts === 0) noPutt.push(k);
  });
  // One whole nine of an 18-hole round; a 9-hole round is already one nine.
  const only = (from: number) => round.holes.length === 18 && blank.length === 9 && blank.every((k) => k >= from && k < from + 9);
  return { blank, noPutt, nine: only(9) ? 'front' : only(0) ? 'back' : null };
}

/** "3, 4번 홀", "10–18번 홀": runs of three or more read as a range. */
function holeList(list: number[]): string {
  const out: string[] = [];
  for (let k = 0; k < list.length; k++) {
    let j = k;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j += 1;
    out.push(j >= k + 2 ? `${list[k] + 1}–${list[j] + 1}` : list.slice(k, j + 1).map((x) => x + 1).join(', '));
    k = j;
  }
  return `${out.join(', ')}번 홀`;
}

/** 은 or 는, by whether the word ends in a final consonant. */
const topic = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 ? '은' : '는';
};

let checkOpener: HTMLElement | null = null;

/**
 * 라운드 마치기 from the last hole or the scorecard. With every hole recorded and putted, the summary opens straight
 * away; otherwise a short list says what looks unfinished, with "그대로 마치기" or a way back to the first such hole.
 * One whole nine and nothing on the other is a 9-hole round.
 */
function requestFinish(from: HTMLElement): void {
  const c = roundCheck();
  if (!c.blank.length && !c.noPutt.length) {
    openSummary(from);
    return;
  }
  checkOpener = from;
  hideToast();
  const [front, back] = nineNames();
  const playedNine = c.nine === 'front' ? front : back;
  const other = c.nine === 'front' ? back : front;
  const items: [string, string, string][] = [];
  if (c.blank.length && !c.nine) items.push(['blank', `기록 안 한 홀 ${c.blank.length}개`, `${holeList(c.blank)}. 그대로 마치면 기록한 홀만 계산해요.`]);
  if (c.noPutt.length) items.push(['putt', `퍼트가 없는 홀 ${c.noPutt.length}개`, `${holeList(c.noPutt)}. 칩인으로 끝났다면 그대로 두세요.`]);
  setText($('check-title'), c.nine ? '9홀 라운드로 마칠까요?' : '라운드를 마칠까요?');
  setText($('check-sub'), c.nine ? `${playedNine} 9홀을 모두 기록했어요. ${other}${topic(other)} 기록이 없어요.` : `${round.holes.length}홀 중 ${round.holes.length - c.blank.length}홀을 기록했어요.`);
  const list = $('check-list');
  list.hidden = items.length === 0;
  list.replaceChildren(...items.map(([kind, title, detail]) => {
    const mark = h('span', { class: 'ci', 'aria-hidden': 'true' });
    // Static markup: a dashed square for an empty hole, the putter for a missing putt.
    mark.innerHTML = kind === 'blank'
      ? '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="4.5" y="4.5" width="15" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.75" stroke-dasharray="3 2.6"/></svg>'
      : icon('putter', 20);
    return h('li', {}, mark, h('span', {}, h('b', {}, title), h('small', {}, detail)));
  }));
  const go = c.nine ? (c.nine === 'front' ? 9 : 0) : c.blank.length ? c.blank[0] : c.noPutt[0];
  setText($('check-finish'), c.nine ? '9홀 라운드로 마치기' : '그대로 마치기');
  const back9 = $('check-go');
  back9.dataset.hole = String(go);
  setText(back9, c.nine ? `${other} 이어서 기록` : `${go + 1}번 홀 ${c.blank.includes(go) ? '기록하기' : '다시 보기'}`);
  $<HTMLDialogElement>('check').showModal();
  $('check-finish').focus();
}

function bindCheck(): void {
  const dialog = $<HTMLDialogElement>('check');
  closeOnBackdrop(dialog);
  // Closed without a choice: focus goes back to the button that asked.
  let next: (() => void) | null = null;
  dialog.addEventListener('close', () => {
    const then = next;
    next = null;
    if (then) then();
    else checkOpener?.focus();
  });
  $('check-close').addEventListener('click', () => dialog.close());
  $('check-finish').addEventListener('click', () => {
    next = () => openSummary(checkOpener ?? $('finish-round'));
    dialog.close();
  });
  $('check-go').addEventListener('click', () => {
    const k = Number($('check-go').dataset.hole);
    next = () => {
      show('entry');
      go(k);
      $('hole-btn').focus();
    };
    dialog.close();
  });
}

/* ---------- 홀 목록: every hole at a glance, opened from the hole number ---------- */

/** Holes behind the furthest one played, other than this one, with nothing recorded: worth a look before the round ends. */
function missedHoles(): number[] {
  let last = -1;
  round.holes.forEach((x, k) => {
    if (played(x)) last = k;
  });
  const upto = Math.max(round.current, last);
  return round.holes.map((_, k) => k).filter((k) => k < upto && k !== round.current && !played(round.holes[k]));
}

function renderStrip(): void {
  const a = analyze(round);
  const missed = missedHoles();
  const cells: HTMLElement[] = [];
  round.holes.forEach((x, k) => {
    const s = strokes(x);
    const done = finished(round, k);
    const d = s - x.par;
    const st = k === round.current ? 'cur' : done ? 'done' : missed.includes(k) ? 'missed' : 'later';
    const what = done ? `${s}타 ${scoreWord(s, x.par)}` : played(x) ? `${s}타 진행 중` : st === 'missed' ? '기록 안 함' : '기록 없음';
    cells.push(h('li', {}, h('button', { type: 'button', class: 'scell', 'data-jump': String(k), 'data-st': st, 'aria-current': String(k === round.current), 'aria-label': `${k + 1}번 홀 Par ${x.par}, ${what}` },
      h('span', { class: 'sc-no', 'aria-hidden': 'true' }, String(k + 1)),
      h('span', { class: 'm', 'aria-hidden': 'true', 'data-mark': done ? markOf(d) : 'none', 'data-tone': done ? toneOf(d) : 'none' }, h('b', {}, played(x) ? String(s) : '–')))));
    if (k === 8 || k === 17) {
      const t = k === 8 ? a.front : a.back;
      // A 9-hole round has one subtotal, its total.
      const label = round.holes.length === 9 ? '합계' : k === 8 ? '전반' : '후반';
      cells.push(h('li', {}, h('span', { class: 'scell sub' }, h('span', { class: 'sc-no' }, label), h('b', { class: 'sub-v' }, t.holes ? String(t.strokes) : '–'))));
    }
  });
  $('strip-row').replaceChildren(...cells);
  const note = $('strip-note');
  note.classList.toggle('warn', missed.length > 0);
  setText(note, missed.length ? `기록 안 한 홀 ${missed.length}개` : `${a.totals.holes}홀 기록`);
}

/** Opens the hole strip with `at` (the current hole by default) in view and focused. */
function openStrip(at = round.current): void {
  hideToast();
  renderStrip();
  const dialog = $<HTMLDialogElement>('strip');
  // Just under the hole switcher, so the hole number and the strip read together. CSSOM, allowed by the CSP.
  dialog.style.top = `${Math.round(document.querySelector('#entry .switcher')!.getBoundingClientRect().bottom + 8)}px`;
  dialog.showModal();
  setAttr($('hole-btn'), 'aria-expanded', 'true');
  const row = $('strip-row');
  const here = row.querySelector<HTMLElement>(`[data-jump="${at}"]`)!;
  row.scrollLeft = here.offsetLeft - (row.clientWidth - here.offsetWidth) / 2;
  here.focus({ preventScroll: true });
}

/* ---------- 홀 안내: the layout notes and the official guide, opened from one chip ---------- */

function bindHoleInfo(): void {
  const dialog = $<HTMLDialogElement>('hole-pop');
  const button = $('info-btn');
  closeOnBackdrop(dialog);
  button.addEventListener('click', () => {
    hideToast();
    dialog.showModal();
    // Under the header row, from the left margin. CSSOM, allowed by the CSP.
    dialog.style.top = `${Math.round($('hole-info').getBoundingClientRect().bottom + 8)}px`;
    setAttr(button, 'aria-expanded', 'true');
    dialog.focus();
  });
  dialog.addEventListener('close', () => {
    setAttr(button, 'aria-expanded', 'false');
    button.focus();
  });
}

function bindStrip(): void {
  const dialog = $<HTMLDialogElement>('strip');
  closeOnBackdrop(dialog);
  $('hole-btn').addEventListener('click', () => openStrip());
  dialog.addEventListener('close', () => {
    setAttr($('hole-btn'), 'aria-expanded', 'false');
    $('hole-btn').focus();
  });
  // Arrow keys, Home and End move along the holes.
  $('strip-row').addEventListener('keydown', (event) => {
    const cells = [...$('strip-row').querySelectorAll<HTMLButtonElement>('button[data-jump]')];
    const at = cells.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: cells.length - 1 }[event.key];
    if (at < 0 || to === undefined) return;
    event.preventDefault();
    cells[Math.max(0, Math.min(cells.length - 1, to))].focus();
  });
  $('strip-row').addEventListener('click', (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-jump]');
    if (!cell) return;
    dialog.close();
    go(Number(cell.dataset.jump));
  });
}

/* ---------- 지난 라운드: this round, then the kept ones ---------- */

function renderNow(a: Analysis = analyze(round)): void {
  const t = a.totals;
  setText($('now-title'), roundless ? '다음 라운드' : '지금 라운드');
  setText($('now-sub'), roundless ? '코스를 고르면 1번 홀부터 시작해요.' : `${roundLabel(round)}, ${dateLabel(round.date).replace(/^\d+년 /, '')}, ${t.holes}홀 기록`);
  setText($('now-continue'), roundless ? '코스 고르고 시작' : '이어서 기록');
  const score = $('now-score');
  setText(score, roundless ? '' : t.holes ? `${t.strokes}타 ${toParText(a.toPar)}` : '아직 없음');
  score.classList.toggle('under', t.holes > 0 && a.toPar < 0);
  score.classList.toggle('none', !t.holes);
  const kept = document.querySelectorAll('#history-list > li').length;
  setText($('hist-sub'), kept ? `보관한 라운드 ${kept}개` : '아직 보관한 라운드가 없어요');
  // The backup reminder after keeping a round; the home-screen card otherwise (once a round is kept, until 알겠어요,
  // and not when opened from the home screen). Never both at once.
  const card = $('backup-card');
  card.hidden = backupNudge === null;
  setText($('bk-h'), backupNudge === 'saved' ? '백업 파일을 저장했어요' : '라운드를 보관했어요');
  setText($('bk-text'), backupNudge === 'saved' ? '폰을 바꾸면 메뉴의 백업과 복원에서 이 파일을 열면 돼요.' : '기록은 이 기기에만 있어요. 폰을 바꾸거나 브라우저가 기록을 지울 때를 대비해 백업 파일을 저장해 두세요.');
  $('bk-save').hidden = backupNudge === 'saved';
  setText($('bk-later'), backupNudge === 'saved' ? '닫기' : '나중에');
  $('home-card').hidden = !kept || homeSeen || standalone() || backupNudge !== null;
}

/** Set when a round is kept from the summary; cleared with 나중에 or 닫기. In memory only. */
let backupNudge: 'ask' | 'saved' | null = null;

function bindBackupCard(): void {
  $('bk-save').addEventListener('click', () => {
    // The same download as the menu's 백업과 복원.
    $('backup-save').click();
    backupNudge = 'saved';
    renderNow();
    $('bk-later').focus();
  });
  $('bk-later').addEventListener('click', () => {
    backupNudge = null;
    renderNow();
    $('tab-hist').focus();
  });
}

let homeSeen = loadDisplay().home;
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function bindHomeCard(): void {
  const more = $('home-more');
  more.addEventListener('click', () => {
    const open = more.getAttribute('aria-expanded') !== 'true';
    setAttr(more, 'aria-expanded', String(open));
    $('hc-more').hidden = !open;
    setText(more, open ? '접기' : '방법 보기');
  });
  $('home-ok').addEventListener('click', () => {
    homeSeen = true;
    saveDisplay({ home: true });
    renderNow();
    $('tab-hist').focus();
  });
}

/**
 * Starts a new round on the chosen course and remembers the choice for next time. Every way into a new round comes
 * through here, so a round with a finished hole moves to the past rounds first; if it cannot be kept, the player decides.
 */
function startRound(choice: CourseChoice): void {
  if (!roundless && !keepBeforeNewRound(round)) return;
  roundless = false;
  hideToast();
  stale = false;
  editPar = false;
  savePrefs(choice);
  clearRound();
  added.clear();
  celebrated.clear();
  update(newRound(new Date(), roundSetup(choice)));
  show('entry');
}

/* ---------- everything ---------- */

/** What the save line says, and whether it is a problem 기록 should show too. */
function saveMessage(): { text: string; problem: boolean } {
  if (!saved) return { text: '이 브라우저에서는 저장할 수 없습니다. 새로고침하면 기록이 지워집니다.', problem: true };
  if (detached) return { text: '저장된 기록이 다른 탭에서 지워졌거나 읽을 수 없습니다. 이 탭의 기록은 다음 입력 때 다시 저장됩니다.', problem: true };
  if (rescued) return { text: '저장된 기록을 읽을 수 없어 새 라운드로 시작합니다. 원래 값은 이 기기에 따로 보관했습니다.', problem: true };
  if (trimmed) return { text: '저장된 세부 기록 일부를 읽을 수 없어 빼고 불러왔습니다. 원래 값은 이 기기에 따로 보관했습니다.', problem: true };
  return { text: `${dateLabel(round.date)} 라운드. 이 기기에만 자동으로 저장돼요.`, problem: false };
}

function render(changed?: string): void {
  const a = analyze(round);
  renderEntry(a, changed);
  renderShotPanel();
  renderCard(a);
  renderAnalysis(a);
  renderSend(a);
  renderCourse();
  renderMenu();
  renderNow(a);
  const message = saveMessage();
  setText($('save-state'), message.text);
  const notice = $('notice');
  setText(notice, message.problem ? message.text : '');
  notice.hidden = !message.problem;
  $('stale').hidden = !stale;
  if (stale) setText($('stale-text'), `${dateLabel(round.date)}에 기록하던 라운드입니다.`);
  drawCourse();
  requestAnimationFrame(scrollHint);
}

function bind(): void {
  bindViews();
  buildClubs();
  // 클럽 상세 (v17): a tap on a club's number opens its detail chips for this hole (src/shot-panel.ts).
  bindShotPanel({ hole, label: (key) => labelOf(key, hole().par), change: (patch, key) => setHole(patch, key), announce, opening: hideToast });
  buildPens();
  bindDetail();
  bindMenu();
  setText($('app-version'), VERSION_LABEL);
  // 스코어카드 legend: how each result looks on a par 4.
  $('legend').replaceChildren(h('li', { class: 'lg-cap' }, '파 4 기준'), ...LEGEND.map(([m, tone, n, label, shape]) => h('li', {},
    h('span', { class: 'm', 'data-mark': m, 'data-tone': tone, 'aria-hidden': 'true' }, h('b', {}, String(n))), label, h('span', { class: 'sr-only' }, `, ${n}타 ${shape}`))));
  $('toast-undo').addEventListener('click', restore);
  $('now-continue').addEventListener('click', () => show('entry'));
  $('sh-go').addEventListener('click', () => show('entry', true));
  bindHomeCard();
  bindBackupCard();
  bindSummary();
  setText($('picker-version'), VERSION_LABEL);
  bindSwipe();
  $('prev-hole').addEventListener('click', () => changeHole(-1));
  $('next-hole').addEventListener('click', () => changeHole(1));
  $('go-next').addEventListener('click', goNext);
  // A hole on the scorecard opens in 기록; in 파 수정 its par button steps the par instead.
  $('scorecard').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const par = target.closest<HTMLButtonElement>('button[data-par-hole]');
    if (par) {
      cyclePar(Number(par.dataset.parHole));
      return;
    }
    // A nine's table: 기록 with the hole strip open there (at the current hole when it is in that nine).
    const table = target.closest<HTMLButtonElement>('button[data-nine]');
    if (table) {
      const start = Number(table.dataset.nine);
      show('entry');
      openStrip(round.current >= start && round.current < start + 9 ? round.current : start);
      return;
    }
    const column = target.closest<HTMLButtonElement>('button[data-hole]');
    if (!column) return;
    go(Number(column.dataset.hole));
    show('entry');
  });
  $('edit-par').addEventListener('click', () => {
    editPar = !editPar;
    render();
    announce(editPar ? '파 수정: 파를 누를 때마다 3, 4, 5 순서로 바뀌어요' : '파 수정 완료');
  });
  // The current round stays until a course is chosen; cancelling the picker keeps it (startRound keeps it among past rounds).
  const startNew = () => openPicker({ mode: 'new', initial: loadPrefs(), onStart: startRound });
  // The menu's 새 라운드 shows its question in the panel and opens the picker (bindMenu); only the banner asks here.
  $('stale-new').addEventListener('click', () => {
    if (confirm(newRoundQuestion(round))) startNew();
  });
  $('send-share').addEventListener('click', () => void shareReport(round, $('send-status')));
  $('send-csv').addEventListener('click', saveCsv);
  $('send-copy').addEventListener('click', () => void copyAnalysis());
  $('stale-keep').addEventListener('click', () => {
    stale = false;
    // Saving marks the round as just edited, so the banner does not come back on the next load.
    update(round);
  });
  window.addEventListener('resize', () => {
    fitNotes();
    drawCourse();
    scrollHint();
  });
  // Another tab of this tool saved the round: show that instead of overwriting it on the next tap.
  // If the saved round was removed or cannot be read, keep this tab's round and say it is not saved.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    const next = loadRound();
    if (next) {
      round = next;
      saved = true;
      detached = false;
      rescued = false;
      trimmed = false;
      stale = isStale(next);
      roundless = false;
      // Another tab started the round while this one was still choosing the first course.
      if (pickerOpen() === 'first') closePicker();
    } else {
      detached = true;
    }
    render();
  });
}

applyBig(loadDisplay().big);
bind();
render();
// The course picker comes first: with no round, with an untouched one, or with one from an earlier day.
if (loaded === null || untouched) {
  openPicker({ mode: 'first', initial: loadPrefs(), onStart: startRound });
  showMissing(missingKind());
}
else if (stale) {
  openPicker({
    mode: 'new',
    initial: loadPrefs(),
    cancelLabel: '지난 라운드 이어서',
    // Going back continues the earlier round, as "이어서 기록" on the banner does.
    onCancel: () => {
      stale = false;
      update(round);
    },
    // A new round from here still asks before the earlier one is replaced (kept among past rounds when a hole is finished); declining leaves the banner.
    onStart: (choice) => {
      if (confirm(newRoundQuestion(round, `${dateLabel(round.date)} 라운드`))) startRound(choice);
    },
  });
}
keepScreenOn();
registerOffline();
// What the past rounds and backup views borrow from the page; each mounts into its own container.
const lent: Page = {
  current: () => round,
  replace: (next) => {
    stale = false;
    roundless = false;
    hideToast();
    added.clear();
    celebrated.clear();
    update(next);
    // A round restored from a backup file on the first screen: there is one to continue now.
    $('picker-missing').hidden = true;
    if (pickerOpen()) closePicker();
  },
  scorecard: (r, a) => [...scorecardNodes(r, a, 'read'), totalLine(a)],
  analysis: analysisNodes,
  share: shareReport,
  shareLabel: canShare ? '공유하기' : canCopy ? '결과 복사' : null,
};
renderHistory($('history'), lent);
renderBackup($('backup'), lent);
bindMissing();
// The 지난 라운드 header counts the kept rounds; the list changes on keeping, deleting and importing.
new MutationObserver(() => renderNow()).observe($('history-list'), { childList: true });
renderNow();
