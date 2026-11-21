import './fonts.css';
import './style.css';
import {
  AREA_LABELS,
  MAX_COUNT,
  PARS,
  PART_LABELS,
  SCORE_LABELS,
  TAG_LABELS,
  analyze,
  bump,
  bumpPart,
  isPart,
  isSplit,
  partOf,
  setPart,
  courseLabel,
  roundLabel,
  finished,
  formatToPar,
  isStale,
  newRound,
  played,
  roundCourse,
  scoreWord,
  badgeWord,
  setTeeTag,
  strokes,
  teeTag,
  type Analysis,
  type Area,
  type Counter,
  type Hole,
  type Par,
  type Part,
  type Round,
  type ScoreName,
  type ShotTag,
  type Tagged,
} from './round';
import { CLUB_ICONS, PEN_ICONS, icon } from './icons';
import { bandShape, bandSvg, bandTerrain, courseShape, courseSvg, courseTerrain, CREDIT_SIDES, FIT_BAND, holeHazards, holeThumb, layoutBend, layoutIsland, osmShape, osmSvg, osmTerrain, type ArtBand, type Box, type CourseFrame, type OsmHole, type Terrain } from './course-art';
import { osmHoleAt, osmLoading } from './osm-holes';
import { registerOffline } from './offline';
import { adviceLines, analysisText, csvName, dateLabel, detailLines, mailtoHref, rateSub, reportSubject, reportText, roundCsv } from './report';
import { PREFS_KEY, STORAGE_KEY, clearRound, loadDisplay, loadPrefs, loadRound, preserveUnreadable, requestPersistence, saveDisplay, savePrefs, saveRound, store, type CourseChoice } from './storage';
import { keepScreenOn } from './wake';
import { courseSource, distanceLabel, holeInfo, publishedPar, resolveChoice, roundSetup } from './courses';
import { closePicker, openPicker, pickerOpen } from './picker';
import { VERSION_LABEL } from './version';
import { $, h, setText } from './dom';
import { keepBeforeNewRound, newRoundQuestion, renderHistory, type Page } from './history-view';
import { HISTORY_KEY, hasFinishedHole, readHistory } from './history';
import { renderBackup } from './backup-view';
import { createRoundShare, dressRoundButtons } from './share-round';
import { VIEWS as CLUBS, bindShotPanel, renderShotPanel, type View as ClubKey } from './shot-panel';
import { bindVoice, type VoicePage } from './voice-view';
import type { Command } from './voice-commands';

/** The penalty row: OB and 해저드 add a stroke each; 벙커 (상세) is noted only. */
const PENS = ['ob', 'bunker', 'hazard'] as const;
type Pen = (typeof PENS)[number];
type Mark = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | 'triple' | 'none';

/**
 * The middle count is 그린까지 in 기본 (v28: every shot after the tee shot until on the green; 아이언 in v20–v26), and
 * 상세 shows it as its two parts, 세컨 and 어프로치. The stored key stays `approach`.
 */
const LABELS: Record<Counter | Part, string> = {
  driver: '드라이버', approach: AREA_LABELS.approach, second: PART_LABELS.second, short: PART_LABELS.short, putts: '퍼터', ob: 'OB', hazard: '해저드', mulligan: '멀리건', bunker: '벙커',
};
/** The first column is the tee shot: 드라이버, or 티샷 on a par 3, where the tee shot is rarely a driver. */
const labelOf = (key: Counter | Part, par: Par) => (key === 'driver' && par === 3 ? '티샷' : LABELS[key]);
/** A capsule: 기본's three clubs (드라이버, 그린까지, 퍼터) and 상세's four (드라이버, 세컨, 어프로치, 퍼터), in card order. */
type Club = ClubKey;
/** A capsule's count, or a penalty's: 세컨 and 어프로치 are parts of the middle count (v28). */
const valueOf = (h: Hole, key: Counter | Part): number => (isPart(key) ? partOf(h, key) : h[key]);
/** The two capsules 상세 has and 기본 does not, and the one 기본 has instead. */
const MODE_OF: Partial<Record<Club, 'basic' | 'detail'>> = { approach: 'basic', second: 'detail', short: 'detail' };
// The capsules' + and − (Tabler since v25), a little bolder than the family's line so the halves read at a glance.
const PLUS = icon('plus', 24, '', 2.4);
const MINUS = icon('minus', 24, '', 2.4);
/** 빼기 in the penalty row (v32): an arrow turning back, not the capsule's −. */
const UNDO = icon('undo', 24);
/** The badge's scorecard mark in a 40×40 box. pathLength 1 lets a birdie or better draw itself. */
const SHAPES: Record<Mark, string> = {
  none: '',
  par: '',
  birdie: '<circle cx="20" cy="20" r="17" pathLength="1"/>',
  eagle: '<circle cx="20" cy="20" r="14" pathLength="1"/><circle cx="20" cy="20" r="19" pathLength="1"/>',
  // As wide as the birdie's circle (v32: 34, it was 32), as on a paper card where ○ and □ are one size.
  bogey: '<rect x="3" y="3" width="34" height="34" rx="2" pathLength="1"/>',
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
const THEME = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
const THEME_ROUGH = THEME?.content ?? '';

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
  // The browser's bar takes the colour at the top of the view (v32): the course's rough on 기록 (the page's own value),
  // the deep header of 스코어카드 and 지난 라운드 elsewhere.
  THEME?.setAttribute('content', view === 'entry' ? THEME_ROUGH : getComputedStyle($('views')).backgroundColor);
  // 기록's header was fitted while hidden (nothing measures there) if its hole changed elsewhere: fit it now (v25).
  if (view === 'entry') fitNotes();
  drawCourse();
  scrollHint();
  if (focusTab) $(TAB_ID[view]).focus();
}

function bindViews(): void {
  for (const v of VIEWS) $(TAB_ID[v]).addEventListener('click', () => show(v));
  // 홈 (v37): the app's own first screen, 기록, as its tab opens it; no longer the site, which moved to 앱 정보.
  $('home-link').addEventListener('click', () => show('entry'));
  $('views').addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    const at = VIEWS.indexOf(view);
    const step = (n: number) => VIEWS[(at + n + VIEWS.length) % VIEWS.length];
    const target = ({ ArrowLeft: step(-1), ArrowRight: step(1), Home: VIEWS[0], End: VIEWS[VIEWS.length - 1] } as Record<string, View>)[e.key];
    if (!target || !(e.target as HTMLElement).matches('[role="tab"]')) return;
    e.preventDefault();
    show(target, true);
  });
  bindPanes();
  // 스코어카드 and 지난 라운드 say when there is more below (v26): on scroll, and whenever their content or the screen
  // changes size (a round recorded, a pane chosen, the past rounds drawn, 큰 글씨).
  const cue = new ResizeObserver(() => scrollHint());
  for (const id of ['card-view', 'hist-view']) {
    const v = $(id);
    v.addEventListener('scroll', scrollHint, { passive: true });
    for (const el of [v, ...v.children]) cue.observe(el);
  }
}

/** 스코어카드's pane (v26): its tables or the round's analysis, kept in memory like the view. */
type Pane = 'card' | 'analysis';
let pane: Pane = 'card';

function showPane(next: Pane, focus = false): void {
  const changed = next !== pane;
  pane = next;
  for (const radio of document.querySelectorAll<HTMLButtonElement>('#sc-switch [role="radio"]')) {
    const on = radio.dataset.pane === pane;
    radio.setAttribute('aria-checked', String(on));
    radio.tabIndex = on ? 0 : -1;
    if (on && focus) radio.focus();
  }
  $('sc-sheet').hidden = pane !== 'card';
  $('sc-analysis').hidden = pane !== 'analysis';
  // 파 수정 belongs to the tables: it steps aside with them, and ends there.
  $('edit-par').hidden = pane !== 'card';
  if (pane !== 'card' && editPar) {
    editPar = false;
    render();
  }
  // Each pane opens at its top, so 분석 shows its first heading right under the switch.
  if (changed) $('card-view').scrollTop = 0;
  scrollHint();
}

function bindPanes(): void {
  const radios = [...document.querySelectorAll<HTMLButtonElement>('#sc-switch [role="radio"]')];
  for (const radio of radios) radio.addEventListener('click', () => showPane(radio.dataset.pane as Pane));
  // A radio group: the arrows move to the other choice and choose it, going round; Home and End go to the ends.
  $('sc-switch').addEventListener('keydown', (event) => {
    const at = radios.findIndex((radio) => radio.dataset.pane === pane);
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : step === undefined ? -1 : (at + step + radios.length) % radios.length;
    if (to < 0) return;
    event.preventDefault();
    showPane(radios[to].dataset.pane as Pane, true);
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
    requestFinish($('next-hole'));
    return;
  }
  const from = round.current;
  const blank = !played(hole());
  changeHole(1);
  if (!blank) return;
  const text = `${from + 1}번 홀은 비워 두고 넘어가요`;
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
    // A mouse with no button held is not dragging: its press ended somewhere 기록 did not see (v18).
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      drag = null;
      return;
    }
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
  // A press can end outside 기록: a long press's release lands on the 0 … 5+ picker it opened. Left behind, that press
  // read the next sideways move as a swipe, slid the sheet and swallowed the next click, 되돌리기 included (v18).
  const forget = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id && !entry.contains(e.target as Node)) drag = null;
  };
  document.addEventListener('pointerup', forget, true);
  document.addEventListener('pointercancel', forget, true);
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
  // The words beside the hole number (v25): "번 홀", or 번 where that cannot fit, never cut with an ellipsis (nothing
  // at all only on a screen narrower than any the app is made for). The button's name always says "5번 홀".
  const unit = document.querySelector<HTMLElement>('#hole-title .hole-u')!;
  for (const words of ['번 홀', '번', '']) {
    setText(unit, words);
    if (unit.scrollWidth <= unit.clientWidth + 0.5) break;
  }
  const sub = $('hole-sub');
  const full = sub.dataset.full ?? '';
  setText(sub, full);
  if (getComputedStyle(sub).display === 'none' || !sub.dataset.par) return;
  // The switcher is bounded by its column (v18): when the line would be cut, the length steps aside instead.
  const right = document.querySelector('#entry .switcher')!.getBoundingClientRect().right;
  // Any overflow at all steps the length aside (v29: a 1px allowance left "Par 3, 159 …" cut with an ellipsis).
  const range = document.createRange();
  range.selectNodeContents(sub);
  if (range.getBoundingClientRect().width > sub.getBoundingClientRect().width + 0.01 || right > $('badge').getBoundingClientRect().left - 6) setText(sub, sub.dataset.par);
}

/** Keeps the header to one row beside the badge: HDCP steps aside first, then the length (both stay in 홀 안내). */
function fitMeta(): void {
  const meta = $('meta');
  meta.classList.remove('tight', 'tighter');
  if (meta.scrollWidth > meta.clientWidth + 1) meta.classList.add('tight');
  if (meta.scrollWidth > meta.clientWidth + 1) meta.classList.add('tighter');
}

/**
 * The part of 기록's screen the drawing is seen in (v33), measured now: from under whatever is over its top (since v38
 * the hole switcher and the score badge, with the chip row's see-through pills as boxes the hole keeps clear of; a
 * banner under them, whose buttons the credit must not cover) to the entry sheet's top edge, across the sheet's width. While the © OpenStreetMap link shows: its
 * text and its touch area (with its ::after), as they would stand at the band's left (mirrored if it stands at the right
 * now), for the hole to keep out of and keep water from behind.
 */
function artBand(): ArtBand {
  const banners = document.querySelector('#entry .banners')!.getBoundingClientRect();
  const sheet = $('sheet').getBoundingClientRect();
  // v38: from under the switcher and the score badge, so the hole also lies behind the chip row, whose pills are
  // see-through: they no longer hide the drawing. A banner (which takes over the chip row) still ends it at its bottom.
  // v39: under the top bar (the course's name and the score badge); the switcher moved down to the band's foot.
  const bar = Math.max(document.querySelector('#entry .round-head')!.getBoundingClientRect().bottom, $('badge').getBoundingClientRect().bottom);
  const top = Math.max(bar, banners.height > 0 ? banners.bottom : 0);
  // The hole itself keeps clear of the pills (v38): the drawing shows through them, but the tee, the green and the flag
  // are never under one.
  const keep = [...document.querySelectorAll('#hole-info > :is(.meta, .progress, .info-chip, .thumb)')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0 && r.bottom > top)
    .map((r) => ({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }));
  // v39: down to the low hole switcher (it sits over the hole's foot, between the hole and the card).
  const foot = Math.min(sheet.top, document.querySelector('#entry .hole-nav')!.getBoundingClientRect().top);
  const band: ArtBand = { x0: sheet.left, y0: top, x1: sheet.right, y1: foot, keep };
  const link = $('osm-credit');
  const text = link.getBoundingClientRect();
  if (!link.hidden && text.width > 0) {
    const after = getComputedStyle(link, '::after');
    const out = (v: string) => Math.max(0, -parseFloat(v) || 0);
    const at = (b: Box): Box => (link.classList.contains('end') ? { x0: band.x0 + band.x1 - b.x1, y0: b.y0, x1: band.x0 + band.x1 - b.x0, y1: b.y1 } : b);
    band.credit = {
      text: at({ x0: text.left, y0: text.top, x1: text.right, y1: text.bottom }),
      touch: at({ x0: text.left - out(after.left), y0: text.top - out(after.top), x1: text.right + out(after.right), y1: text.bottom + out(after.bottom) }),
    };
  }
  return band;
}

/** The painter (v39), loaded the first time 기록 paints a hole. */
let painter: Promise<typeof import('./course-paint')> | null = null;

/**
 * The painted ground under the drawing (v39): painted again only when the hole or the screen changes (`key`). Until the
 * new paint is ready the drawing keeps its own flat ground, so no frame shows the old hole's paint under the new hole;
 * then the drawing's ground goes clear (`.painted`) over the paint. Null hides it (off 기록, or no band to fit).
 */
function paintGround(terrain: Terrain | null, key: string, frame: CourseFrame): void {
  const canvas = $<HTMLCanvasElement>('course-paint');
  const svg = $('course');
  if (!terrain) {
    canvas.hidden = true;
    svg.classList.remove('painted');
    delete canvas.dataset.key;
    return;
  }
  if (canvas.dataset.key === key) return;
  canvas.dataset.key = key;
  svg.classList.remove('painted');
  painter ??= import('./course-paint');
  void painter.then(({ paintTerrain }) => {
    if (canvas.dataset.key !== key) return;
    paintTerrain(canvas, terrain, frame.width, frame.height, Math.min(2, window.devicePixelRatio || 1));
    canvas.hidden = false;
    svg.classList.add('painted');
  });
}

/** The same hole paints the same woodland: a number from the course, the nine and the hole. */
const groundSeed = (course: string | null, nine: string | null, hole: number) => [...`${course ?? ""}:${nine ?? ""}:${hole}`].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

function drawCourse(): void {
  const svg = document.getElementById('course')!;
  const frame: CourseFrame = { width: window.innerWidth, height: window.innerHeight, bandTop: 110, bandBottom: 168, right: window.innerWidth * 0.72 };
  const course = roundCourse(round);
  const credit = $('osm-credit');
  let osm: OsmHole | null = null;
  // Fitted into the band (v33) on 기록 when it is at least FIT_BAND tall; else v31's drawing behind the screen.
  let fit = false;
  if (view !== 'entry') svg.style.removeProperty('--art-bottom');
  if (view === 'entry') {
    // v31's drawing (a short band) has its open band under the one-row header.
    const head = $('hole-info').getBoundingClientRect();
    const sheet = $('sheet').getBoundingClientRect();
    frame.bandTop = head.bottom + 6;
    frame.bandBottom = Math.min(sheet.top, document.querySelector('#entry .hole-nav')!.getBoundingClientRect().top);
    frame.right = sheet.right - 6;
    // The drawing ends at the sheet's top edge (v31): the card covers the rest, and what showed round it was noise.
    svg.style.setProperty('--art-bottom', `${Math.round(frame.bandBottom)}px`);
    // v31's tee box (27px with its bevel) near the card's foot (v39: 다음 홀, where it stood, is gone).
    frame.teeY = sheet.bottom - 28;
    const open = artBand();
    // Whether to fit is still measured under the chip row (v33): the band over it (v38) only gives the hole more room.
    fit =open.y1 - Math.max(open.y0, head.height > 0 ? head.bottom : 0) >= FIT_BAND;
    // Under FIT_BAND the header's small picture shows the hole instead and the drawing steps back (v33: by the band
    // measured here, not the screen's height). The picture sits in the chip row at the chips' height, so showing it leaves
    // the band as it was; the row is fitted again round it.
    if ($('entry').classList.contains('short-band') === fit) {
      $('entry').classList.toggle('short-band', !fit);
      svg.classList.toggle('short-band', !fit);
      fitNotes();
    }
    // Everis's holes from OpenStreetMap (v27), in a band with room for the drawing and its credit.
    if (fit) {
      // A course's outlines load the first time it is drawn: the drawing waits for them rather than flash the schematic.
      const wait = osmLoading(course.id);
      if (wait) {
        void wait.then(drawCourse);
        return;
      }
      osm = osmHoleAt(course, round.current);
    }
  }
  // The credit beside the drawing whenever it is OpenStreetMap's: shown first, so the hole keeps clear of it (v27).
  credit.hidden = !osm;
  const band = fit ? artBand() : null;
  // The fitted drawing also ends under the chip row (v33): water the band cuts stops at its edge, not between the chips.
  if (band) svg.style.setProperty('--art-top', `${Math.round(band.y0)}px`);
  else svg.style.removeProperty('--art-top');
  // 홀 안내 says which drawing it is: OpenStreetMap's with its credit, or (v31) the schematic's line that it is approximate.
  $('hi-osm').hidden = !osm;
  $('hi-art').hidden = osm !== null;
  const info = holeInfo(course, round.current);
  const bend = layoutBend(info?.layout);
  const island = layoutIsland(info?.layout);
  // The official length in metres, for the 100 m / 150 m markers.
  const first = info?.distances?.[0];
  const length = first ? Math.round(first.unit === 'yd' ? first.length * 0.9144 : first.length) : null;
  // v35: where the chip gives metres the markers are bare numbers; where it gives yards they keep "m" in their pill.
  const bare = first?.unit !== 'yd';
  const nine = round.current < 9 ? course.front : course.back;
  const fitAt = band ? [band.x0, band.y0, band.x1, band.y1, ...[...band.keep, ...(band.credit ? [band.credit.text, band.credit.touch] : [])].flatMap((b) => [b.x0, b.y0, b.x1, b.y1])].map(Math.round) : [];
  const key = [frame.width, frame.height, Math.round(frame.bandTop), Math.round(frame.bandBottom), Math.round(frame.right), Math.round(frame.teeY ?? 0), hole().par, round.current, bend, island, length, info?.layout ?? '', osm ? `osm:${course.id}:${nine}` : '', ...fitAt].join(',');
  if (svg.dataset.key === key) return;
  svg.dataset.key = key;
  svg.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
  // Where the hole lies on the screen (the tee, the green's middle, px per metre, the line of play and the band it was
  // fitted into), for checks.
  const xy = ([x, y]: [number, number]) => `${x.toFixed(2)},${y.toFixed(2)}`;
  const mark = (art: string, at: { tee: [number, number]; green: [number, number]; scale: number; line: [number, number][] }, fitted: ArtBand) => Object.assign(svg.dataset, {
    art, tee: xy(at.tee), green: xy(at.green), scale: at.scale.toFixed(4), line: at.line.map(xy).join(' '), band: [fitted.x0, fitted.y0, fitted.x1, fitted.y1].map((n) => n.toFixed(2)).join(','),
  });
  // 홀 안내 says what the 100 m and 150 m markers measure to, while the drawing shows them (v33).
  const marks = $('hi-marks');
  // v35: bare numbers on the drawing, so the unit is said here once; a course in yards keeps "100 m" on its pills.
  setText(marks, bare ? '그림의 100·150 표시는 그린 중앙까지의 거리(m)예요.' : '그림의 100 m·150 m 표시는 그린 중앙까지의 거리예요.');
  if (band && osm) {
    // Static markup from course-art.ts, built from the bundled OpenStreetMap outlines (numbers only).
    // v35: the markers as bare numbers (the chip and 홀 안내 give the unit) and the green up close where the band has room.
    // v39: no green window; the painted hole is large enough to read the green in place.
    const shape = osmShape(osm, round.current, band, length, CREDIT_SIDES, { bare, inset: false });
    svg.innerHTML = osmSvg(shape, frame);
    paintGround(osmTerrain(shape, groundSeed(course.id, nine, round.current)), key, frame);
    mark('osm', shape, band);
    // The credit at the end the drawing chose (v33): the right end where water would lie behind it at the left.
    credit.classList.toggle('end', shape.credit?.side === 'end');
    marks.hidden = shape.markers.length === 0;
    return;
  }
  const named = holeHazards(hole().par, info?.layout);
  if (band) {
    // Static markup from course-art.ts, built from numbers only. Bunkers and water only where the hole's note names them (v22).
    const shape = bandShape(hole().par, round.current, band, bend, island, length, named, { bare });
    svg.innerHTML = bandSvg(shape, frame);
    paintGround(bandTerrain(shape, groundSeed(course.id, nine, round.current)), key, frame);
    mark('schematic', { tee: [shape.tee.x, shape.tee.y], green: [shape.green.cx, shape.green.cy], scale: shape.scale, line: shape.line }, band);
    marks.hidden = shape.markers.length === 0;
    return;
  }
  for (const name of ['tee', 'green', 'scale', 'line', 'band']) delete svg.dataset[name];
  svg.dataset.art = 'schematic';
  marks.hidden = true;
  // Static markup from course-art.ts, built from numbers only. Bunkers and water only where the hole's note names them (v22).
  const full = courseShape(hole().par, round.current, frame, bend, island, length, named);
  svg.innerHTML = courseSvg(full, frame);
  // v39: the painted course behind 스코어카드, 지난 라운드 and the menu too (the user's call), under their veil: the hole
  // 기록 last painted (its woodland and water, at its own scale), or this schematic painted where 기록 has painted none.
  const painted = $<HTMLCanvasElement>('course-paint').dataset.key;
  if (view === 'entry' || !painted) paintGround(courseTerrain(full, groundSeed(course.id, nine, round.current)), key, frame);
}

/** The white fade at the sheet's foot when more of it is below. */
function scrollHint(): void {
  const sheet = $('sheet');
  $('sheet-wrap').classList.toggle('more', !$('entry').hidden && sheet.scrollHeight - sheet.clientHeight - sheet.scrollTop > 4);
  // 스코어카드 and 지난 라운드 (v26): the same fade at their bottom edge while they can scroll further.
  for (const id of ['card-view', 'hist-view']) {
    const v = $(id);
    v.classList.toggle('more', !v.hidden && v.scrollHeight - v.clientHeight - v.scrollTop > 4);
  }
}

/* ---------- 기록: top bar, pills, badge, 상세, penalties ---------- */

function setChip(id: string, text: string | null): void {
  const el = $(id);
  setText(el, text ?? '');
  el.hidden = text === null;
}

function buildClubs(): void {
  const box = $('clubs');
  // Five capsules in card order (v28): 그린까지 shows in 기본, 세컨 and 어프로치 in 상세 (CSS by `data-only`), so Tab and
  // the eye go left to right in either mode.
  for (const key of CLUBS) {
    const label = LABELS[key];
    // The club's name and icon (v20): the button that opens its shot details, with a chevron and, once the club has
    // details on this hole, a dot (shot-panel.ts keeps the dot and the name).
    const chip = h('span', { class: 'lbl-in' }, h('span', { class: 'club-name', id: `name-${key}` }, label), h('span', { class: 'lbl-chev', 'aria-hidden': 'true' }), h('i', { class: 'lbl-dot', 'aria-hidden': 'true' }));
    // Static icon markup from icons.ts, never user input.
    chip.insertAdjacentHTML('afterbegin', CLUB_ICONS[key]);
    chip.querySelector('.lbl-chev')!.innerHTML = icon('chevDown', 12);
    const name = h('button', { type: 'button', class: 'club-lbl', id: `lbl-${key}`, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'shot-panel', 'aria-label': `${label} 샷 세부` }, chip);
    // Each half of the capsule is its button (v20): the top adds one, the bottom takes one off, with a brief cue.
    const plus = h('button', { type: 'button', class: 'step plus', 'aria-label': `${label} 하나 더하기` });
    plus.innerHTML = `<span>${PLUS}</span><i class="cue" aria-hidden="true" hidden>+1</i>`;
    const minus = h('button', { type: 'button', class: 'step minus', 'aria-label': `${label} 하나 빼기` });
    minus.innerHTML = `<span>${MINUS}</span><i class="cue" aria-hidden="true" hidden>−1</i>`;
    // The count on the midline, between the halves. The digit is for the eye; screen readers read the club with it ("드라이버 2").
    const num = h('span', { class: 'num-row' }, h('span', { class: 'count', id: `count-${key}`, 'aria-hidden': 'true' }, '0'), h('span', { class: 'sr-only', id: `count-label-${key}` }, `${label} 0`));
    // The long-press coach mark sits on the capsules' midline over the row (screen readers get it from #lp-hint). Not
    // inside the middle capsule any more (v32): the capsule clips what it holds and cut the line short.
    if (key === 'approach') {
      const coach = h('span', { class: 'coach', id: 'coach', 'aria-hidden': 'true', hidden: '' }, '숫자를 길게 누르면 바로 골라요');
      coach.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="3" fill="currentColor"/><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".6"/></svg>');
      box.append(coach);
    }
    // A hole entered in 기본 has no split yet (v28): 어프로치 says so quietly where its 0 would be, until it is split.
    if (key === 'short') num.append(h('span', { class: 'from-basic', 'aria-hidden': 'true' }, '기본에서', h('br'), '기록'));
    const only = MODE_OF[key];
    box.append(h('div', { class: `club club-${key}`, 'data-key': key, ...(only ? { 'data-only': only } : {}) }, name,
      h('div', { class: 'pill', role: 'group', 'aria-labelledby': `name-${key}`, 'aria-describedby': 'lp-hint' }, plus, num, minus)));
  }
  box.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button.step');
    if (!button || button.disabled) return;
    const key = button.closest<HTMLElement>('.club')!.dataset.key as Club;
    // A stroke on 세컨 or 어프로치 says the tip was seen (v28).
    if (isPart(key)) dismissTip(false);
    if (count(key, button.classList.contains('plus') ? 1 : -1)) showCue(button);
  });
  bindTip();
  bindNumPick();
  $('entry').addEventListener('pointerdown', dismissCoach, true);
  document.addEventListener('keydown', () => {
    if (!$('entry').hidden) dismissCoach();
  });
}

const cueTimers = new WeakMap<HTMLElement, number>();

/** "+1" or "−1" beside the half that was tapped, drifting outward for a moment (v20). CSSOM restarts it, allowed by the CSP. */
function showCue(button: HTMLElement): void {
  const cue = button.querySelector<HTMLElement>('.cue');
  if (!cue) return;
  cue.hidden = false;
  cue.style.animation = 'none';
  void cue.offsetWidth;
  cue.style.animation = '';
  window.clearTimeout(cueTimers.get(cue));
  cueTimers.set(cue, window.setTimeout(() => { cue.hidden = true; }, 650));
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

/* ---------- 상세's one-time tip: what 세컨 and 어프로치 are (v28) ---------- */

let tipSeen = loadDisplay().split;

/**
 * Puts the tip away for good (remembered in the prefs key): a tap on it, its ×, or a stroke on 세컨 or 어프로치. When it
 * held focus (its ×), focus goes on to 세컨's name, the first thing it explained.
 */
function dismissTip(focus: boolean): void {
  if (tipSeen) return;
  tipSeen = true;
  saveDisplay({ split: true });
  const tip = $('split-tip');
  const held = tip.contains(document.activeElement);
  tip.hidden = true;
  if (focus || held) $('lbl-second').focus({ preventScroll: true });
}

function bindTip(): void {
  const tip = $('split-tip');
  // The tip sits over the capsules' middle: a tap anywhere on it puts it away and presses nothing under it.
  tip.addEventListener('click', (event) => {
    event.stopPropagation();
    dismissTip((event.target as HTMLElement).closest('#split-tip-close') !== null);
    announce('세컨과 어프로치 설명을 닫았어요');
  });
  // Nor does it start a long press or a swipe under it.
  tip.addEventListener('pointerdown', (event) => event.stopPropagation());
}

/** A club's count (세컨 and 어프로치 too) or a penalty: both open the same 0 … 5+ picker on a long press. */
type Pickable = Club | Pen;
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

/**
 * Sets a club's or a penalty's count; 5+ keeps a count already above five. Can be taken back from the toast like a tap.
 * 세컨 and 어프로치 (v28) set their part; on a hole from 기본 even the count it has records the split.
 */
function setCount(key: Pickable, n: number): void {
  const index = round.current;
  const before = hole();
  const now = valueOf(before, key);
  const target = n === 5 ? Math.max(5, now) : n;
  if (target === now && !(isPart(key) && !isSplit(before))) return;
  const order = added.get(index) ?? [];
  if (isPen(key)) added.set(index, reorder(order, key, target - now));
  const patch = isPart(key) ? (x: Hole) => setPart(x, key, target) : (x: Hole) => bump(x, key, target - x[key]);
  if (!setHole(patch, key)) {
    added.set(index, order);
    return;
  }
  if (isPart(key)) dismissTip(false);
  navigator.vibrate?.(8);
  const label = labelOf(key, hole().par);
  announce(`${index + 1}번 홀 ${label} ${valueOf(hole(), key)}, ${strokes(hole())}타`);
  showToast(`${label} ${target}${toParticle(target)}`, { index, hole: before, added: [...order] });
}

function openNumPick(key: Pickable, pill: HTMLElement): void {
  pickKey = key;
  hideToast();
  const cur = hole();
  const now = valueOf(cur, key);
  setText($('np-title'), isPen(key) ? PEN_QUESTION[key] : `${labelOf(key, cur.par)} 몇 번 쳤나요?`);
  $('np-row').replaceChildren(...[0, 1, 2, 3, 4, 5].map((n) => h('button', {
    type: 'button', 'data-np': String(n), 'aria-pressed': String(n === 5 ? now >= 5 : now === n), 'aria-label': n === 5 ? '5번 이상' : `${n}번`,
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
    if (pill) startPress(e, pill, pill.closest<HTMLElement>('.club')!.dataset.key as Club);
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
 * The penalty row sits on the steppers' columns. 기본: OB under 드라이버, 빼기 under 그린까지, 해저드 under 퍼터. 상세
 * (v36): OB, 벙커 and 해저드 together under the first three capsules and 빼기 under 퍼터, so the row reads as one group
 * at rest and 빼기 comes in at its end. placeUndo() keeps the document in the row's order, so Tab goes left to right.
 */
function buildPens(): void {
  const box = $('pens');
  for (const key of PENS) {
    const pen = h('button', { type: 'button', class: 'pen', id: `stake-${key}`, 'data-pen': key, 'aria-label': `${LABELS[key]} 하나 더하기`, 'aria-describedby': 'lp-hint-pen' },
      h('span', { class: 'pen-icon' }, h('span', { class: 'pen-count zero' }, '0')), h('span', { class: 'pen-lbl' }, LABELS[key]));
    pen.querySelector('.pen-icon')!.insertAdjacentHTML('afterbegin', PEN_ICONS[key]);
    box.append(pen);
    if (key === 'bunker') box.append(h('button', { type: 'button', class: 'undo', id: 'pen-undo', disabled: '' }));
  }
  box.addEventListener('click', (event) => {
    const pen = (event.target as HTMLElement).closest<HTMLButtonElement>('button.pen');
    if (pen && !pen.disabled) addPenalty(pen.dataset.pen as Pen);
  });
  $('pen-undo').addEventListener('click', undoPenalty);
}

/** 빼기 where the row shows it (v36): between OB and 해저드 in 기본, after 해저드 in 상세. Moved only when the mode changes. */
function placeUndo(): void {
  const undo = $('pen-undo');
  const hazard = $('stake-hazard');
  const last = mode === 'detail';
  if (last ? undo.nextElementSibling === null : undo.nextElementSibling === hazard) return;
  const focused = document.activeElement === undo;
  if (last) $('pens').append(undo);
  else hazard.before(undo);
  if (focused) undo.focus();
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
  // The hole as it was, then back to it: a spoken line can record a hole and move on (v21). A hole left blank is unchanged.
  added.set(before.index, before.added);
  setHoleAt(before.index, () => before.hole);
  if (before.back) {
    go(before.index);
    return;
  }
  announce('되돌렸어요');
}

/**
 * One stroke more or less on a club, a penalty or a mulligan; the hole's score follows. A club or penalty change can
 * be taken back from the toast; `order` is the penalty order to bring back with it.
 */
function count(key: Counter | Part, delta: number, order: Pen[] = added.get(round.current) ?? []): boolean {
  const index = round.current;
  const before = hole();
  // 세컨 and 어프로치 (v28): 세컨 moves the middle count only, 어프로치 both; the first records the hole's split.
  if (!setHole((x) => (isPart(key) ? bumpPart(x, key, delta) : bump(x, key, delta)), key)) return false;
  navigator.vibrate?.(8);
  const label = labelOf(key, hole().par);
  announce(`${round.current + 1}번 홀 ${label} ${valueOf(hole(), key)}, ${strokes(hole())}타`);
  if (key !== 'mulligan') showToast(`${label} ${delta > 0 ? '+1' : '−1'}`, { index, hole: before, added: [...order] });
  return true;
}

function addPenalty(key: Pen): void {
  // The order first: count() redraws the penalty row, and its 빼기 names the last penalty in this order (v21). The toast's
  // 되돌리기 gets the order from before, so it takes back this one only.
  const index = round.current;
  const before = added.get(index) ?? [];
  added.set(index, [...before, key]);
  if (!count(key, 1, before)) added.set(index, before);
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
  // v39: Par and the handicap beside the hole number in the low switcher; the course in the bar; the length chip lists
  // every tee where the course gives more than one.
  setText($('nav-par'), String(cur.par));
  setText($('nav-hcp'), info?.si ? String(info.si) : '–');
  const playing = roundCourse(round);
  setText($('round-name'), [playing.name, round.current < 9 ? playing.front : playing.back].filter(Boolean).join(' · '));
  const tees = info?.distances ?? [];
  const dist = $<HTMLButtonElement>('dist-btn');
  dist.disabled = tees.length < 2;
  setAttr(dist, 'aria-label', tees.length < 2 ? (distanceLabel(info) ?? '거리') : `${distanceLabel(info)}, 티별 거리 보기`);
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
  // What the schematic is drawn from (v31: always, that it is approximate; v22: the bunkers and water a note names):
  // drawCourse() shows the line while it draws the schematic (v27: an OpenStreetMap hole says so instead). Read again
  // only when the hole changes.
  const art = $('hi-art');
  const artKey = `${cur.par}|${info?.layout ?? ''}`;
  if (art.dataset.key !== artKey) {
    art.dataset.key = artKey;
    // A schematic hole is drawn from its par and length (v31: it always says so), its bunkers and water from the note.
    const named = layoutIsland(info?.layout) || holeHazards(cur.par, info?.layout).length > 0;
    setText(art, `그림은 Par와 거리로 그린 대략적인 모양이에요.${named ? ' 벙커·물은 공식 홀 안내 문구로 그린 대략 위치예요.' : ''}`);
  }
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
  // v39: on the last hole › finishes the round.
  setAttr($('next-hole'), 'aria-label', i === lastHole() ? '라운드 마치기' : '다음 홀로 이동');
  $('next-hole').classList.toggle('finish', i === lastHole());

  // A hole entered in 기본 shows in 상세 as all 세컨 (v28), said quietly until 세컨 or 어프로치 is first changed.
  const fromBasic = !isSplit(cur) && cur.approach > 0;
  for (const key of CLUBS) {
    const n = valueOf(cur, key);
    const el = $(`count-${key}`);
    const before = el.textContent;
    setText(el, String(n));
    el.classList.toggle('zero', n === 0);
    if (changed === key && before !== el.textContent) replay(el, 'bump');
    const club = document.querySelector(`.club-${key}`)!;
    // 세컨 and 어프로치 share the middle count's 15.
    club.querySelector<HTMLButtonElement>('.plus')!.disabled = (isPart(key) ? cur.approach : n) >= MAX_COUNT;
    club.querySelector<HTMLButtonElement>('.minus')!.disabled = n === 0;
    const label = labelOf(key, cur.par);
    const unsplit = isPart(key) && fromBasic;
    club.classList.toggle('unsplit', unsplit);
    setText($(`count-label-${key}`), `${label} ${n}${unsplit ? ', 기본에서 기록' : ''}`);
    setText(club.querySelector('.club-name')!, label);
    setAttr(club.querySelector('.plus')!, 'aria-label', `${label} 하나 더하기`);
    setAttr(club.querySelector('.minus')!, 'aria-label', `${label} 하나 빼기`);
  }
  // The one-time tip on what 세컨 and 어프로치 are (v28), in 상세 until it is put away.
  $('split-tip').hidden = mode !== 'detail' || tipSeen;

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
  // The badge is a 60px circle (v15). Its word under the number says two syllables at most (v29), so it stays clear of the
  // ring: 이글 to 더블, past them the score against par (−3, +3 …), and 진행 mid-hole; the spoken name keeps the whole
  // word. 홀인원 shows alone, in place of the number it already says.
  setText($('hole-name'), done ? badgeWord(s, cur.par) : played(cur) ? '진행' : 'Par');
  badge.classList.toggle('hio', done && s === 1);
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
  placeUndo();
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
  // 빼기 holds its column (v32): disabled and out of sight until there is a penalty to take off (CSS keeps its box), so
  // nothing appears or moves when one comes; then named for the one it takes, with an arrow turning back.
  const target = undoTarget();
  const undo = $<HTMLButtonElement>('pen-undo');
  undo.disabled = target === null;
  const undoKey = target ?? 'none';
  if (undo.dataset.key !== undoKey) {
    undo.dataset.key = undoKey;
    // Static icon markup and a fixed label.
    undo.innerHTML = `<span class="u-ico">${UNDO}</span><span>${target ? `${LABELS[target]} 빼기` : '빼기'}</span>`;
  }
  setAttr(undo, 'aria-label', target ? `${LABELS[target]} 하나 빼기` : '벌타 하나 빼기');
  setText($('go-next'), i === lastHole() ? '라운드 마치기' : '다음 홀');
}

/* ---------- 스코어카드 ---------- */

/** How a scorecard is shown: the current round's columns open holes or, in 파 수정, step pars; a past round's only read. */
type CardMode = 'open' | 'edit' | 'read';

/** 파 수정: Par 3 → 4 → 5 → 3, keeping focus on the same hole's column. */
function cyclePar(index: number): void {
  const next = PARS[(PARS.indexOf(round.holes[index].par) + 1) % PARS.length];
  setHoleAt(index, (x) => ({ ...x, par: next }));
  document.querySelector<HTMLButtonElement>(`#scorecard [data-hole="${index}"]`)?.focus();
  announce(`${index + 1}번 홀 Par ${next}`);
}

/**
 * One nine as a classic scorecard table, the same shape in every mode (v23): a label column, nine hole columns and the
 * nine's sum column on one grid, each column four rows (홀, 파, 타수, 퍼트), blank cells for holes not finished. In the
 * round being recorded each hole's column is a button, as tall as the table: it opens that hole in 기록 (`open`) or
 * steps its par (`edit`, 파 수정), and the current hole's column is marked. In a past round the columns only read.
 */
function nineTable(r: Round, a: Analysis, start: number, mode: CardMode): HTMLElement {
  const course = roundCourse(r);
  const single = r.holes.length === 9;
  const name = (start === 0 ? course.front : course.back) || (single ? '9홀' : start === 0 ? '전반 9홀' : '후반 9홀');
  const label = single ? '9홀' : start === 0 ? '전반' : '후반';
  const t = start === 0 ? a.front : a.back;
  const par = r.holes.slice(start, start + 9).reduce((n, x) => n + x.par, 0);
  const heading = `${mode}-nine-${start}`;
  /** The four cells of a column; screen readers get the column's name or line instead. */
  const cells = (hole: string, parCell: HTMLElement, score: Node | string, putts: string) => [
    h('span', { class: 'c-hole', 'aria-hidden': 'true' }, hole), parCell,
    h('span', { class: 'c-score', 'aria-hidden': 'true' }, score), h('span', { class: 'c-putt', 'aria-hidden': 'true' }, putts),
  ];
  const column = (i: number) => {
    const x = r.holes[i];
    const done = finished(r, i);
    const s = strokes(x);
    const d = s - x.par;
    const published = publishedPar(course, i);
    const changed = mode === 'edit' && published !== null && x.par !== published;
    const content = cells(String(i + 1), h('span', { class: `c-par${changed ? ' changed' : ''}`, 'aria-hidden': 'true' }, String(x.par)),
      done ? h('span', { class: 'm', 'data-mark': markOf(d), 'data-tone': toneOf(d) }, h('b', {}, String(s))) : '', done ? String(x.putts) : '');
    const state = done ? `${s}타 ${scoreWord(s, x.par)}, 퍼트 ${x.putts}` : '기록 없음';
    if (mode === 'read') return h('div', { class: 'ct-col', 'data-hole': String(i) }, h('span', { class: 'sr-only' }, `${i + 1}번 홀, Par ${x.par}, ${state}`), ...content);
    return h('button', {
      type: 'button',
      class: `ct-col${i === r.current ? ' cur' : ''}`,
      'data-hole': String(i),
      'aria-current': String(i === r.current),
      'aria-label': mode === 'edit' ? `${i + 1}번 홀 Par ${x.par}, 누르면 바뀜` : `${i + 1}번 홀로 가기, Par ${x.par}, ${state}`,
    }, ...content);
  };
  const labels = h('div', { class: 'ct-lbl', 'aria-hidden': 'true' }, ...cells('홀', h('span', { class: 'c-par' }, '파'), '타수', '퍼트'));
  const sum = h('div', { class: 'ct-sum' }, h('span', { class: 'sr-only' }, `${label} 합계, Par ${par}, ${t.holes ? `${t.holes}홀 ${t.strokes}타, 퍼트 ${t.putts}` : '기록 없음'}`),
    ...cells(label, h('span', { class: 'c-par', 'aria-hidden': 'true' }, String(par)), t.holes ? String(t.strokes) : '', t.holes ? String(t.putts) : ''));
  return h('div', { class: 'nine-tbl', role: 'group', 'aria-labelledby': heading },
    h('p', { class: 'nt-h', id: heading }, h('b', {}, name), h('small', {}, label)),
    h('div', { class: `ct${mode === 'edit' ? ' editing' : ''}` }, labels, ...Array.from({ length: 9 }, (_, k) => column(start + k)), sum));
}

/** A round's nines as scorecard tables: two, or one for a 9-hole round. */
function scorecardNodes(r: Round, a: Analysis, mode: CardMode): HTMLElement[] {
  return r.holes.length === 9 ? [nineTable(r, a, 0, mode)] : [nineTable(r, a, 0, mode), nineTable(r, a, 9, mode)];
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
  // The header says which round this is, as 기록's says which hole (v32): the day as the title, the course under it. The
  // view's own name is on its tab and on the 스코어카드 | 분석 switch, and on 분석 the title no longer reads 스코어카드.
  setText($('sc-title-h'), `${dateLabel(round.date).replace(/^\d+년 /, '')} 라운드`);
  setText($('sc-sub'), roundLabel(round));
  $('sc-sheet').classList.toggle('editing', editPar);
  const edit = $('edit-par');
  setText(edit, editPar ? '완료' : '파 수정');
  edit.classList.toggle('on', editPar);
  $('edit-hint').hidden = !editPar;
  // While 파 수정 is on a column steps its par, so the tip about opening holes steps aside.
  $('card-tip').hidden = editPar;
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
  const s = a.split;
  const most = Math.max(...areas.map((k) => a.lost[k]), s.lost.second, s.lost.short);
  // 타수를 잃은 곳 waits for three finished holes: one or two say little.
  const waiting = t.holes < 3;
  $('lost-bars').hidden = waiting;
  // The finding first, with its number (v29); how it was counted waits behind ⓘ.
  const lostBy = a.worstAreas.length ? a.lost[a.worstAreas[0]] : 0;
  setText($('lost-note'), waiting
    ? `${3 - t.holes}홀 더 기록하면 어디서 타수를 잃었는지 보여요.`
    : a.worstAreas.length
      ? `${a.worstAreas.map((k) => AREA_LABELS[k]).join(', ')}에서 ${a.worstAreas.length > 1 ? '각각 ' : ''}${lostBy}타 잃었어요.`
      : '기준보다 잃은 타수가 없어요.');
  // 분석's one finding is its largest line (v32); until three holes are in, the line is a quiet note.
  $('lost-note').classList.toggle('finding', !waiting);
  $('lost-how').hidden = waiting;
  // Back under three holes (a hole cleared), the ⓘ goes and its box closes with it.
  if (waiting) {
    setAttr($('lost-how'), 'aria-expanded', 'false');
    $('lost-how-box').hidden = true;
  }
  setText($('lost-method'), `티샷 1번, ${AREA_LABELS.approach} Par−3번, 퍼트 2번을 기준으로 더 친 타수와 벌타를 셌어요. 잘 친 홀이 다른 홀의 손실을 지우지는 않아요.`);
  // Under 그린까지, its two parts over the holes split in 상세 (v28): 세컨 against Par−3, 어프로치 against none.
  const splitNote = $('lost-split');
  splitNote.hidden = !s.holes;
  setText(splitNote, s.holes ? `세컨과 어프로치는 상세로 나눈 ${s.holes}홀만, 세컨 Par−3번과 어프로치 0번을 기준으로 셌어요.` : '');
  const scale = Math.max(most, 3);
  const row = (label: string, value: number, cls: string) => {
    const fill = h('i');
    fill.style.width = `${(value / scale) * 100}%`;
    return h('li', { class: cls }, h('span', {}, label), h('span', { class: 'bar' }, fill), h('span', { class: 'v' }, `+${value}`));
  };
  $('lost-bars').replaceChildren(...areas.flatMap((k) => [
    row(AREA_LABELS[k], a.lost[k], a.worstAreas.includes(k) ? 'worst' : ''),
    ...(k === 'approach' && s.holes ? [row(PART_LABELS.second, s.lost.second, 'part'), row(PART_LABELS.short, s.lost.short, 'part')] : []),
  ]));
}

const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

function bar(label: string, value: number, max: number, text: string, cls = ''): HTMLElement {
  const fill = h('span', { class: `bar-fill ${cls}` });
  fill.style.width = `${max > 0 ? Math.max(0, (value / max) * 100) : 0}%`;
  return h('div', { class: 'bar-row' }, h('span', { class: 'bar-label' }, label), h('span', { class: 'bar-track' }, fill), h('span', { class: 'bar-value' }, text));
}

function renderAnalysis(a: Analysis): void {
  $('analysis').replaceChildren(...analysisNodes(a));
}

/** A tile as the summary writes it (v23): a label, one value on one line, and its qualifier small beside the value. */
const tile = (label: Node | string, value: string, small = '') => h('div', {}, h('dt', {}, label), h('dd', {}, value, small ? h('small', {}, small) : null));

/** The analysis of a round, for this round and for past ones; `holes` is the round's length (18, or 9). */
function analysisNodes(a: Analysis, holes = round.holes.length): (Node | string)[] {
  const t = a.totals;
  if (!t.holes) return [h('p', { class: 'muted' }, '홀을 기록하면 여기에 합계와 분석이 나와요.')];
  const maxDist = Math.max(...Object.values(a.distribution));
  const advice = adviceLines(a);
  return [
    h('p', { class: 'headline' }, `${t.holes}홀 ${t.strokes}타`, h('span', { class: a.toPar < 0 ? 'under' : '' }, ` ${formatToPar(a.toPar)}`),
      t.holes < holes ? h('span', { class: 'muted' }, `, 남은 ${holes - t.holes}홀`) : null),
    h('dl', { class: 'metrics' },
      tile('평균 퍼트', `${one(a.puttsPerHole)}개/홀`),
      tile('1퍼트', `${a.onePutts}홀`),
      tile('3퍼트 이상', `${a.threePutts}홀`),
      tile('그린 적중', `${a.girHoles}/${t.holes}`, rateSub(a.girHoles, t.holes)),
      // Tiles of nothing step aside (v29): no 벌타 tile without a penalty, no 멀리건 tile without a mulligan.
      t.ob || t.hazard ? tile('벌타', `OB ${t.ob}`, `해저드 ${t.hazard}`) : '',
      t.mulligan ? tile('멀리건', `${t.mulligan}회`) : ''),
    h('h4', {}, '스코어 분포'),
    h('div', { class: 'bars' }, ...(Object.keys(SCORE_LABELS) as ScoreName[]).map((k) => bar(SCORE_LABELS[k], a.distribution[k], maxDist, `${a.distribution[k]}홀`, `score-${k}`))),
    h('h4', {}, 'Par별 평균'),
    // The par in the label and how many holes at the label's other end, so the average alone is the value.
    h('dl', { class: 'metrics three' }, ...a.byPar.map((p) => h('div', {},
      h('dt', {}, h('span', {}, `Par ${p.par}`), p.holes ? h('small', {}, `${p.holes}홀`) : null),
      h('dd', {}, p.holes ? `${one(p.average)}타` : '–')))),
    a.best && a.worst
      ? h('p', { class: 'best-worst' }, `가장 잘한 홀 ${a.best.hole}번 (${formatToPar(a.best.toPar)}), 가장 아쉬운 홀 ${a.worst.hole}번 (${formatToPar(a.worst.toPar)})`)
      : '',
    // The holes split in 상세 (v28): how many, greens hit with no 어프로치, and up and downs (one 어프로치, then one putt or none).
    ...(a.split.holes
      ? [h('h4', {}, '세컨·어프로치'), h('dl', { class: 'metrics three split' },
          tile('나눈 홀', `${a.split.holes}/${t.holes}`),
          tile('그린 적중', `${a.split.gir}/${a.split.holes}`, rateSub(a.split.gir, a.split.holes)),
          tile('업앤다운', a.split.upDown.chances ? `${a.split.upDown.made}/${a.split.upDown.chances}` : '–', a.split.upDown.chances ? rateSub(a.split.upDown.made, a.split.upDown.chances) : '')),
        h('details', { class: 'how' }, h('summary', {}, '세는 방법'), h('p', { class: 'muted split-note' }, '그린 적중은 어프로치 없이 Par−2타 안에 올린 홀, 업앤다운은 어프로치 한 번에 1퍼트 이하로 마친 홀이에요.'))]
      : []),
    // 정리 (v29): only the advice the tiles do not already give, in the page's 해요체; nothing when there is none.
    ...(advice.length ? [h('h4', {}, '정리'), h('ul', { class: 'insights' }, ...advice.map((s) => h('li', {}, s)))] : []),
    ...(a.details
      ? [h('details', { class: 'shot-details' }, h('summary', {}, '샷 세부'), h('ul', { class: 'insights details' }, ...detailLines(a, true).map((s) => h('li', {}, s))))]
      : []),
  ];
}

const canShare = typeof navigator.share === 'function';
const canCopy = typeof navigator.clipboard?.writeText === 'function';

function renderSend(a: Analysis): void {
  const ready = a.totals.holes > 0;
  $('send-actions').hidden = !ready;
  setText($('send-note'), ready
    ? '이메일은 휴대폰 메일 앱이 열리고 스코어카드와 분석이 본문에 채워져요. 받는 사람은 메일 앱에서 넣으세요.'
    : '홀을 끝내면 스코어카드와 분석을 이메일이나 메신저로 보낼 수 있어요.');
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
      if ((error as DOMException).name !== 'AbortError') setText(status, '공유하지 못했어요. 이메일로 보내기를 써 주세요.');
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setText(status, '결과를 복사했어요. 메신저나 메모에 붙여 넣으세요.');
  } catch {
    setText(status, '복사하지 못했어요. 이메일로 보내기를 써 주세요.');
  }
}

function renderCourse(): void {
  const course = roundCourse(round);
  setText($('course-name'), roundLabel(round));
  const source = courseSource(course);
  // After the tip about the hole columns (#card-tip, v23), where the pars come from.
  const box = $('par-from');
  const key = source ? `${source.source}|${source.checked}` : 'custom';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren(...(source
    ? ['기본 Par 출처: ', h('a', { href: source.source, target: '_blank', rel: 'noopener noreferrer' }, '공식 스코어카드'), ` (${source.checked} 확인). 파 수정에서 홀마다 바꿀 수 있어요.`]
    : ['직접 입력한 코스라 Par 4로 시작했어요. 파 수정에서 홀마다 바꿀 수 있어요.']));
}

/* ---------- menu: course, version and mulligans ---------- */

let menuOpener: HTMLElement | null = null;

function renderMenu(): void {
  const cur = hole();
  setText($('mulligan-count'), String(cur.mulligan));
  $<HTMLButtonElement>('mulligan-minus').disabled = cur.mulligan === 0;
  $<HTMLButtonElement>('mulligan-plus').disabled = cur.mulligan >= MAX_COUNT;
  // 멀리건 counts on its own row (v36): the title names the hole, the count sits between − and +.
  setText($('mulligan-title'), `${round.current + 1}번 홀 멀리건`);
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
      // The sheet stops on the bar (v36), and 메뉴 there says it is open.
      setAttr(button, 'aria-expanded', 'true');
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
  // A tap off the sheet closes it: on the dim backdrop, or (v36: the dim stops at the bar, which stays in view) on the bar,
  // where a view's tab goes on to that view as with the menu closed, and 메뉴 only closes it.
  menu.addEventListener('click', (event) => {
    const r = menu.getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    if (event.target !== menu || (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right)) return;
    const under = (el: Element) => {
      const b = el.getBoundingClientRect();
      return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    };
    const view = [...document.querySelectorAll<HTMLButtonElement>('#views .tab')].find(under);
    menu.close();
    view?.click();
  });
  menu.addEventListener('close', () => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-menu]')) setAttr(button, 'aria-expanded', 'false');
    menuOpener?.focus();
  });
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
  // 파 대비 as a label and the score as its value (v23); with nothing recorded, one plain sentence.
  $('sum-vs').replaceChildren(...(t.holes
    ? [h('span', {}, '파 대비'), ' ', h('b', { class: a.toPar < 0 ? 'under' : '' }, toParText(a.toPar))]
    : [h('span', { class: 'none' }, '기록한 홀이 없어요')]));
  const count = round.holes.length;
  setText($('sum-count'), !t.holes ? '홀을 기록하면 여기에 보여요' : nine ? `${playedNine} 9홀을 모두 기록했어요` : t.holes === count ? `${count}홀을 모두 기록했어요` : `${t.holes}홀만 기록했어요. 기록한 홀만 계산해요`);
  const d = a.distribution;
  const marks: [Mark, string, number][] = [['eagle', '이글', d.eagle], ['birdie', '버디', d.birdie], ['par', '파', d.par], ['bogey', '보기', d.bogey], ['double', '더블', d.double], ['triple', '트리플+', d.triple]];
  // A count of 0 steps back in the quiet ink, so 이글 0 never shouts as loud as 더블 2 (v23).
  $('sum-marks').replaceChildren(...marks.map(([m, label, n]) => h('li', {},
    h('span', { class: 'm', 'data-mark': m, 'data-tone': n === 0 ? 'none' : m === 'eagle' || m === 'birdie' ? 'under' : m === 'par' ? 'par' : 'over' }, h('b', {}, String(n))),
    h('small', {}, m === 'triple' ? h('span', { 'aria-hidden': 'true' }, label) : label, m === 'triple' ? h('span', { class: 'sr-only' }, '트리플 이상') : null))));
  const done = round.holes.map((x, i) => ({ x, i })).filter(({ i }) => finished(round, i));
  const drives = done.filter(({ x }) => x.par >= 4 && teeTag(x) !== null);
  const hit = drives.filter(({ x }) => teeTag(x) === 'fairway').length;
  const half = (n: typeof a.front) => (n.holes ? [`${n.strokes}타`, toParText(n.strokes - n.par)] : ['기록 없음', '']);
  const best = a.best ? round.holes[a.best.hole - 1] : null;
  // One value per tile, on one line (v23). 페어웨이 안착 waits for a tee result; until then its hint is said once, under the tiles.
  $('sum-stats').replaceChildren(
    // A 9-hole round has no other nine to compare.
    // A nine with nothing on it yet steps aside rather than saying 기록 없음 (v29).
    ...(nine || count === 9 ? [] : [a.front.holes ? tile('전반', ...half(a.front) as [string, string]) : '', a.back.holes ? tile('후반', ...half(a.back) as [string, string]) : '']),
    tile('퍼트', `${t.putts}개`, t.holes ? `홀당 ${one(a.puttsPerHole)}` : ''),
    tile('그린 적중', t.holes ? `${a.girHoles}/${t.holes}` : '–', t.holes ? rateSub(a.girHoles, t.holes) : ''),
    drives.length ? tile('페어웨이 안착', `${hit}/${drives.length}`, rateSub(hit, drives.length)) : '',
    t.ob || t.hazard ? tile('벌타', `OB ${t.ob}`, `해저드 ${t.hazard}`) : '',
    tile('베스트 홀', a.best && best ? `${a.best.hole}번 홀` : '–', a.best && best ? scoreWord(strokes(best), best.par) : ''),
    // 업앤다운 (v28), once an 어프로치 was recorded in 상세, as the share image has it.
    a.split.upDown.chances ? tile('업앤다운', `${a.split.upDown.made}/${a.split.upDown.chances}`, rateSub(a.split.upDown.made, a.split.upDown.chances)) : '',
  );
  $('sum-hint').hidden = drives.length > 0 || !t.holes;
  // Where the round lost most: the label, then the value, no colon between (v23); otherwise one sentence.
  $('sum-insight').replaceChildren(...(t.holes && a.worstAreas.length
    ? [h('span', {}, '타수를 가장 많이 잃은 곳'), ' ', h('b', {}, `${a.worstAreas.map((k) => AREA_LABELS[k]).join(', ')} +${a.lost[a.worstAreas[0]]}`)]
    : [!t.holes ? '홀을 기록하면 어디서 타수를 잃었는지 보여요.' : '기준보다 잃은 타수가 없어요.']));
  $<HTMLAnchorElement>('sum-mail').href = mailtoHref(round);
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
  $('sum-body').scrollTop = 0;
  fitSummary();
  // The share image is drawn after the sheet shows, with a placeholder until then.
  summaryShare.open(round);
}

/** A hairline over the round buttons while the rest of the summary can scroll under them (v23). */
function fitSummary(): void {
  const body = $('sum-body');
  $('summary').toggleAttribute('data-overflow', body.scrollHeight - body.clientHeight > 0);
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

/** The summary's 공유 and 이미지 저장 with the round's image (src/share-round.ts); the past round has its own. */
const summaryShare = createRoundShare({
  save: $('sum-save'),
  status: $('sum-status'),
  container: $('summary'),
  row: $('sum-actions'),
  preview: $('sum-card'),
  image: $<HTMLImageElement>('sum-card-img'),
  shareText: (r) => shareReport(r, $('sum-status')),
});

function bindSummary(): void {
  const dialog = $<HTMLDialogElement>('summary');
  $('sum-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => summaryOpener?.focus());
  // 공유 sends the round as an image where the share sheet takes files; otherwise the text share or copy as before.
  dialog.addEventListener('close', () => summaryShare.close());
  dressRoundButtons($('sum-share'), $('sum-save'), $('sum-mail'));
  // The preview's badge: what a tap on it does, share or save (static icon markup from icons.ts).
  $('sum-badge').innerHTML = icon('share', 14, 'b-share') + icon('download', 14, 'b-save');
  $('sum-share').addEventListener('click', () => void summaryShare.share(round));
  $('sum-save').addEventListener('click', () => summaryShare.save(round));
  // The hairline over the buttons follows whatever changes the body's height: the screen, the status line, 큰 글씨.
  const fit = new ResizeObserver(fitSummary);
  for (const el of [$('sum-body'), ...$('sum-body').children]) fit.observe(el);
  $('sum-archive').addEventListener('click', keepFinishedRound);
  $('finish-round').addEventListener('click', () => requestFinish($('finish-round')));
  bindCheck();
  bindStrip();
  bindHoleInfo();
  bindTees();
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
  // Two holes before this one in view, the first on the heading's edge (v23): no cell cut at the start, and the row
  // snaps to whole cells from there. Near the end the row simply stops at its last cell.
  const from = row.querySelector<HTMLElement>(`[data-jump="${Math.max(0, at - 2)}"]`)!;
  row.scrollLeft = from.offsetLeft - parseFloat(getComputedStyle(row).paddingLeft);
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

/** A tee's marker colour by its name ("화이트 좌그린" is white); grey where the name says no colour. */
function teeColour(name: string | undefined): string {
  const colours: [RegExp, string][] = [
    [/^(화이트|레귤러)/, '#f4f5f0'], [/^(블랙|백|챔피언)/, '#16181a'], [/^블루/, '#3d7fd9'], [/^(레드|레이디|프런트)/, '#d9483a'],
    [/^(옐로|시니어)/, '#e5c443'], [/^골드/, '#c9a227'], [/^핑크/, '#f08fb0'], [/^오렌지/, '#ec8a35'],
  ];
  return colours.find(([re]) => name && re.test(name))?.[1] ?? '#9aa79c';
}

/** v39: the length chip lists every tee the course gives for the hole, under the chip row. */
function bindTees(): void {
  const dialog = $<HTMLDialogElement>('tees-pop');
  const button = $<HTMLButtonElement>('dist-btn');
  closeOnBackdrop(dialog);
  button.addEventListener('click', () => {
    const tees = holeInfo(roundCourse(round), round.current)?.distances ?? [];
    if (tees.length < 2) return;
    hideToast();
    const list = $('tee-list');
    list.replaceChildren(...tees.map((t) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'tee-dot';
      dot.style.background = teeColour(t.tee);
      const name = document.createElement('span');
      name.className = 'tee-name';
      name.textContent = t.tee ?? '티';
      const len = document.createElement('b');
      len.textContent = `${t.length} ${t.unit}`;
      li.append(dot, name, len);
      return li;
    }));
    dialog.showModal();
    // Under the chip row, from the left margin, as 홀 안내 opens. CSSOM, allowed by the CSP.
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
  // Two lines of their own under the title (v23): the course, then the date and the holes, which never break.
  setText($('now-course'), roundless ? '코스를 고르면 1번 홀부터 시작해요.' : roundLabel(round));
  setText($('now-meta'), roundless ? '' : `${dateLabel(round.date).replace(/^\d+년 /, '')}, ${t.holes}홀 기록`);
  $('now-meta').hidden = roundless;
  setText($('now-continue'), roundless ? '코스 고르고 시작' : '이어서 기록');
  const score = $('now-score');
  setText(score, roundless ? '' : t.holes ? `${t.strokes}타 ${toParText(a.toPar)}` : '아직 없음');
  score.classList.toggle('under', t.holes > 0 && a.toPar < 0);
  score.classList.toggle('none', !t.holes);
  const kept = document.querySelectorAll('#history-list > li').length;
  // A count, never the empty card's own sentence again (v23).
  setText($('hist-sub'), `보관한 라운드 ${kept}개`);
  // The backup reminder after keeping a round; the home-screen card otherwise (once a round is kept, until 알겠어요,
  // and not when opened from the home screen). Never both at once.
  const card = $('backup-card');
  card.hidden = backupNudge === null;
  // While the reminder says the round is kept, the list's own line says it to screen readers only (the list mounts
  // after the first render).
  document.getElementById('history-status')?.classList.toggle('sr-only', !card.hidden);
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
    // The card said the round is kept; the list's line, which says the same, goes with it (v23).
    const status = document.getElementById('history-status');
    if (status) setText(status, '');
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
  if (!saved) return { text: '이 브라우저에서는 저장할 수 없어요. 새로고침하면 기록이 지워져요.', problem: true };
  if (detached) return { text: '저장된 기록이 다른 탭에서 지워졌거나 읽을 수 없어요. 이 탭의 기록은 다음 입력 때 다시 저장돼요.', problem: true };
  if (rescued) return { text: '저장된 기록을 읽을 수 없어 새 라운드로 시작해요. 원래 값은 이 기기에 따로 보관했어요.', problem: true };
  if (trimmed) return { text: '저장된 세부 기록 일부를 읽을 수 없어 빼고 불러왔어요. 원래 값은 이 기기에 따로 보관했어요.', problem: true };
  return { text: `${dateLabel(round.date)} 라운드. 이 기기에만 자동으로 저장돼요.`, problem: false };
}

/* ---------- 말로 입력 (v21): a dictated or typed line, applied through the taps' own functions ---------- */

type Said = Extract<Command, { kind: 'set' | 'add' }>;
const isSaid = (c: Command): c is Said => c.kind === 'set' || c.kind === 'add';

/**
 * One spoken count, through the function its tap uses: + and − (count), a penalty button (addPenalty), the long press
 * (setCount) for a value, and the menu's − and + for 멀리건. The long press reads 5 as "5 or more", so an exact 5 under
 * a higher count steps down to 4 first and adds one.
 */
function sayCount(c: Said): void {
  const { key } = c;
  const cur = valueOf(hole(), key);
  const target = Math.min(MAX_COUNT, Math.max(0, c.kind === 'add' ? cur + c.n : c.atLeast ? Math.max(c.n, cur) : c.n));
  // 세컨 and 어프로치 (v28) set their part as the long press does; said on a hole from 기본 they record its split.
  if (isPart(key)) {
    if (target !== cur || !isSplit(hole())) setHole((x) => setPart(x, key, target), key);
    return;
  }
  if (target === cur) return;
  if (key === 'mulligan') count(key, target - cur);
  else if (c.kind === 'add' && isPen(key) && target > cur) for (let k = cur; k < target; k += 1) addPenalty(key);
  else if (c.kind === 'add' && !isPen(key)) count(key, target - cur);
  else if (target === 5 && cur > 5) {
    setCount(key, 4);
    if (isPen(key)) addPenalty(key);
    else count(key, 1);
  } else setCount(key, target);
}

/** "드라이버 1", "OB +1": each club or penalty said, as its count now reads, or by how much it was only added to. */
function saidParts(said: Said[], before: Hole, after: Hole): string[] {
  return [...new Set(said.map((c) => c.key))].map((key) => {
    const label = labelOf(key, after.par);
    const d = valueOf(after, key) - valueOf(before, key);
    return said.some((c) => c.key === key && c.kind === 'set') || d === 0 ? `${label} ${valueOf(after, key)}` : `${label} ${d > 0 ? '+' : '−'}${Math.abs(d)}`;
  });
}

/**
 * Applies a line read by src/voice-commands.ts: its counts on this hole, then the hole move it may end with, each the
 * way its button does it. One toast says what was set ("드라이버 1 · 아이언 2 · 퍼터 2"), and its 되돌리기 takes back
 * the whole line, the move too. Says why when there is nothing to do, before changing anything.
 */
function applyLine(commands: Command[], close: () => void): string | null {
  const last = commands[commands.length - 1];
  if (last.kind === 'undo') {
    if (!undoable) return '되돌릴 것이 없어요.';
    close();
    restore();
    return null;
  }
  const from = round.current;
  const said = commands.filter(isSaid);
  if (last.kind === 'prev' && from === 0) return '지금이 1번 홀이에요.';
  if (!said.length && last.kind === 'hole' && last.n - 1 === from) return `지금 ${from + 1}번 홀이에요.`;
  close();
  const before = hole();
  const order = [...(added.get(from) ?? [])];
  for (const c of said) sayCount(c);
  const after = round.holes[from];
  // The move, as its button does it: 다음 홀 (라운드 마치기 on the last hole), the ‹ arrow, or a jump from the hole list.
  if (last.kind === 'next') goNext();
  else if (last.kind === 'prev') changeHole(-1);
  else if (last.kind === 'hole' && last.n - 1 !== from) go(last.n - 1);
  if (!said.length || (last.kind === 'next' && from === lastHole())) return null;
  const parts = saidParts(said, before, after);
  const moved = round.current !== from;
  // No-break spaces inside each "어프로치 3" and before each ·, so a toast on two lines breaks only after a ·.
  const whole = (s: string) => s.replaceAll(' ', '\u00a0');
  showToast(`${moved ? `${whole(`${from + 1}번 홀`)} ` : ''}${parts.map(whole).join('\u00a0· ')}`, { index: from, hole: before, added: order, ...(moved ? { back: true } : {}) });
  $('toast').classList.add('vc');
  announce(`${from + 1}번 홀 ${parts.join(', ')}, ${strokes(after)}타${moved ? `. ${round.current + 1}번 홀, Par ${hole().par}` : ''}`);
  return null;
}

const voicePage: VoicePage = {
  holes: () => round.holes.length,
  names: () => ({ driver: LABELS.driver, middle: mode === 'detail' ? `${LABELS.second} 하나 ${LABELS.short} 하나` : `${LABELS.approach} 둘`, putts: LABELS.putts }),
  apply: applyLine,
  // While the sheet is open the last change's 되돌리기 waits, so "되돌리기" said there still finds it.
  opened: () => window.clearTimeout(toastTimer),
  dismissed: () => {
    if (!$('toast').hidden) toastTimer = window.setTimeout(hideToast, 4000);
  },
  announce,
};

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
  if (stale) setText($('stale-text'), `${dateLabel(round.date)}에 기록하던 라운드예요.`);
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
  // 말로 입력 (v21): the opt-in one-line entry (src/voice-view.ts); applyLine applies it as taps would.
  bindVoice(voicePage);
  // 스코어카드 legend: how each result looks on a par 4.
  $('legend').replaceChildren(h('li', { class: 'lg-cap' }, '파 4 기준'), ...LEGEND.map(([m, tone, n, label, shape]) => h('li', {},
    h('span', { class: 'm', 'data-mark': m, 'data-tone': tone, 'aria-hidden': 'true' }, h('b', {}, String(n))), label, h('span', { class: 'sr-only' }, `, ${n}타 ${shape}`))));
  $('toast-undo').addEventListener('click', restore);
  // 타수를 잃은 곳's ⓘ (v29): how it counts, shown only when asked.
  const how = $('lost-how');
  how.addEventListener('click', () => {
    const open = how.getAttribute('aria-expanded') !== 'true';
    setAttr(how, 'aria-expanded', String(open));
    $('lost-how-box').hidden = !open;
  });
  $('now-continue').addEventListener('click', () => show('entry'));
  $('sh-go').addEventListener('click', () => show('entry', true));
  bindHomeCard();
  bindBackupCard();
  bindSummary();
  bindSwipe();
  $('prev-hole').addEventListener('click', () => changeHole(-1));
  // v39: › is 다음 홀 now: it moves on (saying so when the hole is left blank) and finishes the round on the last hole.
  $('next-hole').addEventListener('click', goNext);
  $('go-next').addEventListener('click', goNext);
  // 음성: the sheet's third tab opens 말로 입력's sheet (its own button stays for the menu's setting).
  $('mode-voice').addEventListener('click', () => $('voice-open').click());
  // A hole's column on the scorecard opens that hole in 기록 in one tap (v23); in 파 수정 it steps the par instead.
  $('scorecard').addEventListener('click', (event) => {
    const column = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-hole]');
    if (!column) return;
    const k = Number(column.dataset.hole);
    if (editPar) {
      cyclePar(k);
      return;
    }
    go(k);
    show('entry');
  });
  $('edit-par').addEventListener('click', () => {
    editPar = !editPar;
    render();
    announce(editPar ? '파 수정: 홀 칸을 누를 때마다 Par가 3, 4, 5 순서로 바뀌어요' : '파 수정 완료');
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
  // The bundled font can arrive after the first render (font-display: swap): fit the header again in its widths (v25).
  document.fonts?.addEventListener('loadingdone', () => fitNotes());
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
  analysis: (a, r) => analysisNodes(a, r.holes.length),
  share: shareReport,
};
// iPhone Safari shows :active only on pages that listen for touches; a passive no-op listener lets every control
// answer a press (v23) and changes nothing else.
document.addEventListener('touchstart', () => {}, { passive: true });
renderHistory($('history'), lent);
renderBackup($('backup'), lent);
bindMissing();
// The 지난 라운드 header counts the kept rounds; the list changes on keeping, deleting and importing.
new MutationObserver(() => renderNow()).observe($('history-list'), { childList: true });
renderNow();
