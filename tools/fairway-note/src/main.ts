import './style.css';
import {
  AREA_LABELS,
  HOLE_COUNT,
  MAX_COUNT,
  PARS,
  PENALTIES,
  SCORE_LABELS,
  TAGGED,
  TAG_LABELS,
  analyze,
  bump,
  courseLabel,
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
import { CLUB_ICONS } from './icons';
import { courseShape, courseSvg, layoutBend, type CourseFrame } from './course-art';
import { registerOffline } from './offline';
import { dateLabel, detailLines, insights, mailtoHref, reportSubject, reportText } from './report';
import { STORAGE_KEY, clearRound, loadPrefs, loadRound, preserveUnreadable, requestPersistence, savePrefs, saveRound, type CourseChoice } from './storage';
import { keepScreenOn } from './wake';
import { courseSource, distanceLabel, holeInfo, publishedPar, resolveChoice, roundSetup } from './courses';
import { closePicker, openPicker, pickerOpen } from './picker';
import { VERSION, VERSION_LABEL } from './version';

type Penalty = (typeof PENALTIES)[number];
type Mark = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | 'none';

const LABELS: Record<Counter, string> = { driver: '드라이버', approach: '어프로치', putts: '퍼터', ob: 'OB', hazard: '해저드', mulligan: '멀리건' };
const PLUS = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const MINUS = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
/** The OB stake is white with a dark band, the hazard stake red, as on a course. */
const STAKES: Record<Penalty, string> = {
  ob: '<svg viewBox="0 0 24 32" width="20" height="28" aria-hidden="true"><path d="M8 2h8v20l-4 7-4-7z" fill="#fff" stroke="#17301A" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.5h8v4.5H8z" fill="#17301A"/></svg>',
  hazard: '<svg viewBox="0 0 24 32" width="20" height="28" aria-hidden="true"><path d="M8 2h8v20l-4 7-4-7z" fill="#C0392B" stroke="#8C2A20" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};
/** The badge's scorecard mark in a 40×40 box. pathLength 1 lets a birdie or better draw itself. */
const SHAPES: Record<Mark, string> = {
  none: '',
  par: '',
  birdie: '<circle cx="20" cy="20" r="17" pathLength="1"/>',
  eagle: '<circle cx="20" cy="20" r="14" pathLength="1"/><circle cx="20" cy="20" r="19" pathLength="1"/>',
  bogey: '<rect x="4" y="4" width="32" height="32" rx="2" pathLength="1"/>',
  double: '<rect x="6.5" y="6.5" width="27" height="27" rx="1" pathLength="1"/><rect x="2" y="2" width="36" height="36" rx="2" pathLength="1"/>',
};

type Children = (Node | string | null | false)[];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: Children): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Writes text only when it changes, so screen readers and layout are not disturbed on every tap. */
function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

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

const markOf = (d: number): Mark => (d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : 'double');
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
/** 기본 or 상세, kept in memory. */
let mode: 'basic' | 'detail' = 'basic';
/** Penalties in the order they were added on each hole, so "빼기" takes off the last one. Not saved. */
const added = new Map<number, Penalty[]>();
/** Holes whose birdie or better has had its moment, so it plays once until the score changes back. */
const celebrated = new Set<number>();
/** 파 수정 on the scorecard: each par cell becomes a button that steps 3, 4, 5. */
let editPar = false;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function hole(): Hole {
  return round.holes[round.current];
}

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

/** Changes one hole; false when nothing changed. */
function setHoleAt(index: number, patch: (h: Hole) => Hole, changed?: string): boolean {
  const before = round.holes[index];
  const after = patch(before);
  if (after === before) return false;
  const holes = round.holes.slice();
  holes[index] = after;
  update({ ...round, holes }, changed);
  return true;
}

const setHole = (patch: (h: Hole) => Hole, changed?: string) => setHoleAt(round.current, patch, changed);

/* ---------- views: 스코어카드 and 기록 ---------- */

type View = 'card' | 'entry';
const VIEWS: View[] = ['card', 'entry'];
const TAB_ID: Record<View, string> = { card: 'tab-card', entry: 'tab-entry' };
const PANEL_ID: Record<View, string> = { card: 'card-view', entry: 'entry' };
/** Kept in memory: a reload opens 기록. */
let view: View = 'entry';

function show(next: View, focusTab = false): void {
  const changed = next !== view;
  view = next;
  for (const v of VIEWS) {
    const tab = $<HTMLButtonElement>(TAB_ID[v]);
    tab.setAttribute('aria-selected', String(v === view));
    tab.tabIndex = v === view ? 0 : -1;
    $(PANEL_ID[v]).hidden = v !== view;
  }
  if (changed && view === 'card') $('card-view').scrollTop = 0;
  drawCourse();
  scrollHint();
  if (focusTab) $(TAB_ID[view]).focus();
}

function bindViews(): void {
  for (const v of VIEWS) $(TAB_ID[v]).addEventListener('click', () => show(v));
  $('views').addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    const other: View = view === 'entry' ? 'card' : 'entry';
    const target = ({ ArrowLeft: other, ArrowRight: other, Home: VIEWS[0], End: VIEWS[VIEWS.length - 1] } as Record<string, View>)[e.key];
    if (!target || !(e.target as HTMLElement).matches('[role="tab"]')) return;
    e.preventDefault();
    show(target, true);
  });
}

/* ---------- moving between holes: the arrows, 다음 홀 and a swipe all slide ---------- */

function go(index: number): void {
  if (index < 0 || index >= HOLE_COUNT || index === round.current) return;
  update({ ...round, current: index });
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
function leaveGhost(wrap: HTMLElement, dir: number): void {
  const box = wrap.getBoundingClientRect();
  const ghost = wrap.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('style');
  for (const el of [ghost, ...ghost.querySelectorAll('[id]')]) el.removeAttribute('id');
  ghost.querySelector('.badge')?.classList.remove('celebrate', 'settle');
  ghost.classList.add('ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  $('entry').append(ghost);
  ghost.querySelector('.sheet')!.scrollTop = $('sheet').scrollTop;
  requestAnimationFrame(() => slide(ghost, -dir * window.innerWidth * 0.45, 160, true));
  window.setTimeout(() => ghost.remove(), 260);
}

/** One hole on or back. The new hole's sheet slides in from the side it comes from; a swipe's sheet carries on out. */
function changeHole(dir: 1 | -1, swiped = false): void {
  const wrap = $('sheet-wrap');
  const target = round.current + dir;
  if (target < 0 || target >= HOLE_COUNT) {
    slide(wrap, 0, 180);
    return;
  }
  const motion = !reducedMotion();
  if (motion && swiped) leaveGhost(wrap, dir);
  // Back in place before the new hole renders, so the drawn course measures the sheet where it rests.
  slide(wrap, 0);
  go(target);
  if (swiped) navigator.vibrate?.(8);
  if (!motion) return;
  slide(wrap, dir * window.innerWidth * 0.3, 0, true);
  requestAnimationFrame(() => requestAnimationFrame(() => slide(wrap, 0, 220)));
}

/** "다음 홀", or the scorecard after the last hole. */
function goNext(): void {
  if (round.current === HOLE_COUNT - 1) show('card');
  else changeHole(1);
}

/** A sideways swipe on 기록 changes the hole; a mostly vertical one is left to scroll the sheet. */
function bindSwipe(): void {
  const entry = $('entry');
  const wrap = $('sheet-wrap');
  let drag: { x: number; y: number; id: number; on: boolean; t: number } | null = null;
  let swallow = false;
  entry.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
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
    const edge = (dx > 0 && round.current === 0) || (dx < 0 && round.current === HOLE_COUNT - 1);
    slide(wrap, edge ? dx * 0.25 : dx);
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
    else slide(wrap, 0, 180);
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

function drawCourse(): void {
  const svg = document.getElementById('course')!;
  const frame: CourseFrame = { width: window.innerWidth, height: window.innerHeight, bandTop: 110, bandBottom: 168, right: window.innerWidth * 0.72 };
  if (view === 'entry') {
    frame.bandTop = $('hole-info').getBoundingClientRect().bottom + 6;
    frame.bandBottom = $('sheet').getBoundingClientRect().top;
    frame.right = $('badge').getBoundingClientRect().left - 6;
  }
  const bend = layoutBend(holeInfo(roundCourse(round), round.current)?.layout);
  const key = [frame.width, frame.height, Math.round(frame.bandTop), Math.round(frame.bandBottom), Math.round(frame.right), hole().par, round.current, bend].join(',');
  if (svg.dataset.key === key) return;
  svg.dataset.key = key;
  svg.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
  // Static markup from course-art.ts, built from numbers only.
  svg.innerHTML = courseSvg(courseShape(hole().par, round.current, frame, bend), frame);
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
    box.append(h('div', { class: `club club-${key}`, 'data-key': key }, name,
      h('div', { class: 'pill', role: 'group', 'aria-labelledby': `lbl-${key}` }, plus, h('span', { class: 'count', id: `count-${key}` }, '0'), minus)));
  }
  box.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button.step');
    if (!button || button.disabled) return;
    count(button.closest<HTMLElement>('.club')!.dataset.key as Tagged, button.classList.contains('plus') ? 1 : -1);
  });
}

function buildPens(): void {
  const box = $('pens');
  for (const key of PENALTIES) {
    const pen = h('button', { type: 'button', class: 'pen', id: `stake-${key}`, 'data-pen': key, 'aria-label': `${LABELS[key]} 하나 더하기` },
      h('span', { class: 'pen-icon' }, h('span', { class: 'pen-count zero' }, '0')), h('span', { class: 'pen-lbl' }, LABELS[key]));
    pen.querySelector('.pen-icon')!.insertAdjacentHTML('afterbegin', STAKES[key]);
    box.append(pen);
  }
  box.append(h('button', { type: 'button', class: 'undo', id: 'pen-undo', hidden: '' }));
  box.addEventListener('click', (event) => {
    const pen = (event.target as HTMLElement).closest<HTMLButtonElement>('button.pen');
    if (pen && !pen.disabled) addPenalty(pen.dataset.pen as Penalty);
  });
  $('pen-undo').addEventListener('click', undoPenalty);
}

/** One stroke more or less on a club, a penalty or a mulligan; the hole's score follows. */
function count(key: Counter, delta: number): boolean {
  if (!setHole((x) => bump(x, key, delta), key)) return false;
  navigator.vibrate?.(8);
  announce(`${round.current + 1}번 홀 ${LABELS[key]} ${hole()[key]}, ${strokes(hole())}타`);
  return true;
}

function addPenalty(key: Penalty): void {
  if (!count(key, 1)) return;
  added.set(round.current, [...(added.get(round.current) ?? []), key]);
}

/** The penalty "빼기" takes off: the last one added on this hole, or one that is counted. */
function undoTarget(): Penalty | null {
  const cur = hole();
  const order = (added.get(round.current) ?? []).filter((k) => cur[k] > 0);
  return order.at(-1) ?? (cur.ob > 0 ? 'ob' : cur.hazard > 0 ? 'hazard' : null);
}

function undoPenalty(): void {
  const key = undoTarget();
  if (!key) return;
  const order = added.get(round.current) ?? [];
  const at = order.lastIndexOf(key);
  if (at >= 0) added.set(round.current, [...order.slice(0, at), ...order.slice(at + 1)]);
  count(key, -1);
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
  // 합계: the finished holes against par, once there is one.
  const total = $('total-chip');
  total.hidden = a.totals.holes === 0;
  const totalValue = $('total-v');
  setText(totalValue, toParText(a.toPar));
  totalValue.classList.toggle('under', a.toPar < 0);
  setText($('total-holes'), `, ${a.totals.holes}홀`);
  const info = holeInfo(roundCourse(round), i);
  setChip('hole-distance', distanceLabel(info));
  const si = (info as { si?: unknown } | null)?.si;
  setChip('hole-si', typeof si === 'number' ? `HDCP ${si}` : null);
  setChip('hole-layout', info?.layout ?? null);
  const guide = $<HTMLAnchorElement>('hole-guide');
  if (info?.guideUrl) setAttr(guide, 'href', info.guideUrl);
  else guide.removeAttribute('href');
  guide.hidden = !info?.guideUrl;
  $<HTMLButtonElement>('prev-hole').disabled = i === 0;
  $<HTMLButtonElement>('next-hole').disabled = i === HOLE_COUNT - 1;

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
  }

  // The badge: the hole's computed score with its scorecard mark.
  const s = strokes(cur);
  const done = finished(round, i);
  const d = s - cur.par;
  const mark: Mark = done ? markOf(d) : 'none';
  const name = done ? scoreWord(s, cur.par) : played(cur) ? '진행 중' : '기록 전';
  setText($('hole-strokes'), played(cur) ? String(s) : '–');
  const bmark = $('bmark');
  setAttr(bmark, 'data-mark', mark);
  bmark.classList.toggle('two', s >= 10);
  const badge = $('badge');
  setAttr(badge, 'data-tone', done ? toneOf(d) : 'none');
  setText($('hole-name'), name);
  setAttr(badge, 'aria-label', played(cur) ? `이 홀 ${s}타, ${name}` : '이 홀 아직 기록 전');
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
  setAttr($('sheet'), 'data-mode', mode);
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

  for (const key of PENALTIES) {
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
  setText($('go-next'), i === HOLE_COUNT - 1 ? '라운드 마치기' : '다음 홀');
}

/* ---------- 스코어카드 ---------- */

/** A hole's column: a button that opens the hole, or in 파 수정 a column whose par cell is the button. */
function holeColumn(i: number): HTMLElement {
  const x = round.holes[i];
  const done = finished(round, i);
  const s = strokes(x);
  const d = s - x.par;
  const published = publishedPar(roundCourse(round), i);
  const par = editPar
    ? h('button', { type: 'button', class: `par-btn${published !== null && x.par !== published ? ' changed' : ''}`, 'data-par-hole': String(i), 'aria-label': `${i + 1}번 홀 Par ${x.par}, 누르면 바뀜` }, String(x.par))
    : h('span', { class: 'pr' }, String(x.par));
  const cells = [
    h('span', { class: 'no' }, String(i + 1)),
    par,
    h('span', { class: 'sc-row' }, h('span', { class: 'm', 'data-mark': done ? markOf(d) : 'none', 'data-tone': done ? toneOf(d) : 'none' }, h('b', {}, done ? String(s) : '–'))),
    h('span', { class: 'pt' }, done ? String(x.putts) : ''),
  ];
  if (editPar) return h('div', { class: 'col', 'aria-current': String(i === round.current) }, ...cells);
  const state = done ? `, ${s}타 ${scoreWord(s, x.par)}, 퍼트 ${x.putts}` : ', 기록 없음';
  return h('button', { type: 'button', class: 'col', 'data-hole': String(i), 'aria-current': String(i === round.current), 'aria-label': `${i + 1}번 홀로 가기, Par ${x.par}${state}` }, ...cells);
}

/** 파 수정: Par 3 → 4 → 5 → 3, keeping focus on the same hole's button. */
function cyclePar(index: number): void {
  const next = PARS[(PARS.indexOf(round.holes[index].par) + 1) % PARS.length];
  setHoleAt(index, (x) => ({ ...x, par: next }));
  document.querySelector<HTMLButtonElement>(`button[data-par-hole="${index}"]`)?.focus();
  announce(`${index + 1}번 홀 Par ${next}`);
}

function table(from: number, to: number, sub: string | null): HTMLElement {
  const labels = h('div', { class: 'rowlbl', 'aria-hidden': 'true' }, h('span', {}, '홀'), h('span', { class: 'pr-row' }, '파'), h('span', { class: 'sc-row' }, '타수'), h('span', {}, '퍼트'));
  const box = h('div', { class: 'tbl' }, labels);
  for (let i = from; i < to; i++) box.append(holeColumn(i));
  if (sub) {
    const start = sub === '전반' ? 0 : 9;
    const t = analyze(round)[start === 0 ? 'front' : 'back'];
    const par = round.holes.slice(start, start + 9).reduce((n, x) => n + x.par, 0);
    box.append(h('div', { class: 'col sub' }, h('span', { class: 'no' }, sub), h('span', { class: 'pr' }, String(par)),
      h('span', { class: 'sc-row' }, h('b', { class: 'sub-v' }, t.holes ? String(t.strokes) : '–')), h('span', { class: 'pt' }, t.holes ? String(t.putts) : '')));
  }
  return box;
}

function renderCard(a: Analysis): void {
  const course = roundCourse(round);
  setText($('sc-sub'), `${course.name} · ${dateLabel(round.date).replace(/^\d+년 /, '')}`);
  $('sc-sheet').classList.toggle('editing', editPar);
  const edit = $('edit-par');
  setText(edit, editPar ? '완료' : '파 수정');
  edit.classList.toggle('on', editPar);
  $('edit-hint').hidden = !editPar;
  const t = a.totals;
  setText($('sum-strokes'), String(t.strokes));
  const topar = $('sum-topar');
  setText(topar, toParText(t.holes ? a.toPar : 0));
  topar.classList.toggle('under', t.holes > 0 && a.toPar < 0);
  setText($('sum-putts'), String(t.putts));
  setText($('sum-ob'), String(t.ob));
  setText($('sum-hazard'), String(t.hazard));
  const nine = (start: number) => [
    h('div', { class: 'nine-h' }, h('h3', {}, (start === 0 ? course.front : course.back) || (start === 0 ? '전반 9홀' : '후반 9홀')), h('span', {}, start === 0 ? '전반' : '후반')),
    table(start, start + 5, null),
    table(start + 5, start + 9, start === 0 ? '전반' : '후반'),
  ];
  $('scorecard').replaceChildren(...nine(0), ...nine(9));
  setText($('tot-holes'), `${t.holes}홀`);
  setText($('tot-strokes'), `${t.strokes}타`);
  const total = $('tot-topar');
  setText(total, toParText(t.holes ? a.toPar : 0));
  total.classList.toggle('under', t.holes > 0 && a.toPar < 0);

  const areas = Object.keys(AREA_LABELS) as Area[];
  const most = Math.max(...areas.map((k) => a.lost[k]));
  setText($('lost-note'), !t.holes
    ? '홀을 기록하면 보여요.'
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
  const box = $('analysis');
  const t = a.totals;
  if (!t.holes) {
    box.replaceChildren(h('p', { class: 'muted' }, '홀을 기록하면 여기에 합계와 분석이 나옵니다.'));
    return;
  }
  const metrics = [
    ['평균 퍼트', `${one(a.puttsPerHole)}개/홀`],
    ['1퍼트', `${a.onePutts}홀`],
    ['3퍼트 이상', `${a.threePutts}홀`],
    ['그린 적중', `${a.girHoles}/${t.holes} (${pct(a.girHoles, t.holes)}%)`],
    ['벌타', `OB ${t.ob} · 해저드 ${t.hazard} (+${t.ob + t.hazard}타)`],
    ['멀리건', `${t.mulligan}회`],
  ];
  const maxDist = Math.max(...Object.values(a.distribution));
  box.replaceChildren(
    h('p', { class: 'headline' }, `${t.holes}홀 ${t.strokes}타`, h('span', { class: a.toPar < 0 ? 'under' : '' }, ` ${formatToPar(a.toPar)}`),
      t.holes < HOLE_COUNT ? h('span', { class: 'muted' }, ` · 남은 ${HOLE_COUNT - t.holes}홀`) : null),
    h('dl', { class: 'metrics' }, ...metrics.flatMap(([k, v]) => [h('div', {}, h('dt', {}, k), h('dd', {}, v))])),
    h('h4', {}, '스코어 분포'),
    h('div', { class: 'bars' }, ...(Object.keys(SCORE_LABELS) as ScoreName[]).map((k) => bar(SCORE_LABELS[k], a.distribution[k], maxDist, `${a.distribution[k]}홀`, `score-${k}`))),
    h('h4', {}, 'Par별 평균'),
    h('dl', { class: 'metrics three' }, ...a.byPar.map((p) => h('div', {}, h('dt', {}, `Par ${p.par}`), h('dd', {}, p.holes ? `${one(p.average)}타 (${p.holes}홀)` : '—')))),
    a.best && a.worst
      ? h('p', { class: 'best-worst' }, `가장 잘한 홀 ${a.best.hole}번 (${formatToPar(a.best.toPar)}) · 가장 아쉬운 홀 ${a.worst.hole}번 (${formatToPar(a.worst.toPar)})`)
      : '',
    h('h4', {}, '정리'),
    h('ul', { class: 'insights' }, ...insights(a).map((s) => h('li', {}, s))),
    ...(a.details
      ? [h('h4', {}, '샷 세부'), h('ul', { class: 'insights details' }, ...detailLines(a).map((s) => h('li', {}, s)))]
      : []),
  );
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
}

async function shareReport(): Promise<void> {
  const text = reportText(round);
  const status = $('send-status');
  if (canShare) {
    try {
      await navigator.share({ title: reportSubject(round), text });
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
  setText($('course-name'), courseLabel(course));
  const source = courseSource(course);
  const box = $('par-source');
  const key = source ? `${source.source}|${source.checked}` : 'custom';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren(...(source
    ? ['기본 Par 출처: ', h('a', { href: source.source, target: '_blank', rel: 'noopener noreferrer' }, '공식 스코어카드'), ` (${source.checked} 확인) · 파 수정에서 홀마다 바꿀 수 있습니다.`]
    : ['직접 입력한 코스라 Par 4로 시작했습니다. 파 수정에서 홀마다 바꿀 수 있습니다.']));
}

/* ---------- menu: course, version and mulligans ---------- */

let menuOpener: HTMLElement | null = null;

function renderMenu(): void {
  const cur = hole();
  setText($('mulligan-count'), String(cur.mulligan));
  $<HTMLButtonElement>('mulligan-minus').disabled = cur.mulligan === 0;
  $<HTMLButtonElement>('mulligan-plus').disabled = cur.mulligan >= MAX_COUNT;
  setText($('menu-version'), VERSION_LABEL);
}

function bindMenu(): void {
  const menu = $<HTMLDialogElement>('menu');
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-menu]')) {
    button.addEventListener('click', () => {
      menuOpener = button;
      renderMenu();
      menu.showModal();
    });
  }
  $('menu-close').addEventListener('click', () => menu.close());
  menu.addEventListener('close', () => menuOpener?.focus());
  $('mulligan-plus').addEventListener('click', () => count('mulligan', 1));
  $('mulligan-minus').addEventListener('click', () => count('mulligan', -1));
}

/** Starts a new round on the chosen course and remembers the choice for next time. */
function startRound(choice: CourseChoice): void {
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
  return { text: `${dateLabel(round.date)} 라운드 · 이 기기에만 자동 저장됩니다.`, problem: false };
}

function render(changed?: string): void {
  const a = analyze(round);
  renderEntry(a, changed);
  renderCard(a);
  renderAnalysis(a);
  renderSend(a);
  renderCourse();
  renderMenu();
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
  buildPens();
  bindDetail();
  bindMenu();
  setText($('app-version'), VERSION_LABEL);
  $('app-version').setAttribute('aria-label', `버전 ${VERSION}`);
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
  // The current round stays until a course is chosen; cancelling the picker keeps it.
  const startNew = () => openPicker({ mode: 'new', initial: loadPrefs(), onStart: startRound });
  $('new-round').addEventListener('click', () => {
    if (confirm('지금 라운드 기록을 지우고 새로 시작할까요?')) startNew();
  });
  $('stale-new').addEventListener('click', () => {
    if (confirm('지금 라운드 기록을 지우고 새로 시작할까요?')) startNew();
  });
  $('send-share').addEventListener('click', () => void shareReport());
  $('stale-keep').addEventListener('click', () => {
    stale = false;
    // Saving marks the round as just edited, so the banner does not come back on the next load.
    update(round);
  });
  window.addEventListener('resize', () => {
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
      // Another tab started the round while this one was still choosing the first course.
      if (pickerOpen() === 'first') closePicker();
    } else {
      detached = true;
    }
    render();
  });
}

bind();
render();
if (loaded === null) openPicker({ mode: 'first', initial: loadPrefs(), onStart: startRound });
keepScreenOn();
registerOffline();
