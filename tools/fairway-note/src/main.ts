import './style.css';
import {
  AREA_LABELS,
  COUNTERS,
  HOLE_COUNT,
  PARS,
  SCORE_LABELS,
  SHOT_TAGS,
  TAG_LABELS,
  analyze,
  bump,
  finished,
  formatToPar,
  isStale,
  isTagged,
  MAX_COUNT,
  newRound,
  played,
  scoreName,
  setTag,
  strokes,
  tagAt,
  type Analysis,
  type Area,
  type Counter,
  type Hole,
  type Par,
  type Round,
  type ScoreName,
  type ShotTag,
  type Tagged,
  type Totals,
} from './round';
import { COUNTER_ICONS } from './icons';
import { registerOffline } from './offline';
import { dateLabel, detailLines, insights, mailtoHref, reportSubject, reportText } from './report';
import { STORAGE_KEY, clearRound, loadRound, preserveUnreadable, requestPersistence, saveRound } from './storage';
import { $, h, setText } from './dom';
import { initHistory, keepBeforeNewRound, newRoundQuestion } from './past';
import { trackSummaryHeight } from './layout';
import { keepScreenOn } from './wake';
import { courseLabel, roundCourse } from './round';
import { courseSource, resolveChoice, roundSetup } from './courses';
import { closePicker, openPicker, pickerOpen } from './picker';
import { loadPrefs, savePrefs, type CourseChoice } from './storage';

const COUNTER_TEXT: Record<Counter, { label: string; hint: string }> = {
  driver: { label: '드라이버', hint: '티샷. OB 뒤 다시 친 티샷도' },
  approach: { label: '어프로치', hint: '두 번째 샷부터 그린 전까지' },
  putts: { label: '퍼터', hint: '그린 위 퍼트' },
  ob: { label: 'OB', hint: '1벌타가 타수에 더해짐' },
  mulligan: { label: '멀리건', hint: '표시만, 타수에 넣지 않음' },
};

function announce(text: string): void {
  const live = $('announce');
  // Clearing first makes a repeated message (same count twice) be read again.
  live.textContent = '';
  requestAnimationFrame(() => (live.textContent = text));
}

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

function hole(): Hole {
  return round.holes[round.current];
}

function update(next: Round): void {
  round = { ...next, lastEdited: Date.now() };
  saved = saveRound(round);
  if (saved) detached = false;
  rescued = false;
  trimmed = false;
  if (saved && !persistAsked) {
    persistAsked = true;
    requestPersistence();
  }
  render();
}

function setHole(patch: (h: Hole) => Hole): void {
  const before = hole();
  const after = patch(before);
  if (after === before) return;
  const holes = round.holes.slice();
  holes[round.current] = after;
  update({ ...round, holes });
}

function go(index: number): void {
  if (index < 0 || index >= HOLE_COUNT || index === round.current) return;
  closeTray();
  update({ ...round, current: index });
  showHoleCard();
  announce(`${index + 1}번 홀, Par ${hole().par}`);
}

/** Brings the whole hole card between the sticky summary and the fixed hole bar, if it is not already there. */
function showHoleCard(): void {
  const card = $('hole-card').getBoundingClientRect();
  const top = document.querySelector('.summary')!.getBoundingClientRect().bottom;
  const bottom = document.querySelector('.hole-move')!.getBoundingClientRect().top;
  if (card.top < top || card.bottom > bottom) $('hole-card').scrollIntoView({ block: 'start' });
}

function toParClass(toPar: number): string {
  return `score-${scoreName(toPar)}`;
}

/* ---------- hole card ---------- */

function buildCounters(): void {
  const box = $('counters');
  for (const key of COUNTERS) {
    const { label, hint } = COUNTER_TEXT[key];
    const output = h('output', { class: 'count', 'aria-label': label }, '0');
    box.append(
      h('div', { class: `counter counter-${key}`, 'data-key': key },
        h('div', { class: 'counter-label' }, h('b', {}, label), h('span', {}, hint)),
        h('button', { type: 'button', class: 'step minus', 'data-delta': '-1', 'aria-label': `${label} 하나 빼기` }, '−'),
        isTagged(key) ? h('button', { type: 'button', class: 'count-btn', 'aria-label': `${label} 샷 세부 보기` }, output) : output,
        plusButton(key, label),
      ),
    );
  }
  box.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const countButton = target.closest<HTMLButtonElement>('button.count-btn');
    if (countButton) {
      const key = countButton.closest<HTMLElement>('.counter')!.dataset.key as Tagged;
      const n = hole()[key];
      if (!n) return;
      // The first tap opens the last shot; each further tap steps back one shot, wrapping around.
      const index = tray?.key === key ? (tray.index - 1 + n) % n : n - 1;
      openTray(key, index);
      renderTray();
      return;
    }
    const button = target.closest<HTMLButtonElement>('button.step');
    if (!button) return;
    const key = button.closest<HTMLElement>('.counter')!.dataset.key as Counter;
    const delta = Number(button.dataset.delta);
    const before = hole();
    // The stroke is recorded exactly as without details; the chips only follow it.
    if (delta > 0 && isTagged(key) && before[key] < MAX_COUNT) openTray(key, before[key]);
    else closeTray();
    setHole((x) => bump(x, key, delta));
    if (hole() === before) {
      closeTray();
      renderTray();
      return;
    }
    navigator.vibrate?.(8);
    announce(`${round.current + 1}번 홀 ${COUNTER_TEXT[key].label} ${hole()[key]}, ${strokes(hole())}타`);
  });
}

/* ---------- shot details ---------- */

/** The shot whose detail chips are showing, if any. Not saved: a reload or another hole closes the chips. */
let tray: { key: Tagged; index: number } | null = null;
let trayTimer = 0;
/** Chips close on their own this long after the last tap on them; ignoring them is fine. */
const TRAY_MS = 6000;

function openTray(key: Tagged, index: number): void {
  tray = { key, index };
  armTray();
}

function armTray(): void {
  clearTimeout(trayTimer);
  trayTimer = window.setTimeout(() => {
    tray = null;
    renderTray();
  }, TRAY_MS);
}

function closeTray(): void {
  tray = null;
  clearTimeout(trayTimer);
}

function renderTray(): void {
  const box = $('shot-tray');
  const cur = hole();
  if (tray && tray.index >= cur[tray.key]) closeTray();
  for (const row of document.querySelectorAll<HTMLElement>('.counter')) {
    row.classList.toggle('tagging', row.dataset.key === tray?.key);
    const key = row.dataset.key as Counter;
    if (!isTagged(key)) continue;
    const count = row.querySelector<HTMLButtonElement>('.count-btn')!;
    count.disabled = cur[key] === 0;
    count.classList.toggle('has-tags', (cur.tags?.[key] ?? []).some((t) => t !== null));
  }
  if (!tray) {
    box.hidden = true;
    box.removeAttribute('aria-label');
    delete box.dataset.key;
    return;
  }
  const { key, index } = tray;
  box.setAttribute('aria-label', `${COUNTER_TEXT[key].label} ${index + 1}번째 샷 세부`);
  // Rebuilt only when the counter changes, so a chip keeps focus after it is tapped.
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.replaceChildren(
      h('span', { class: 'tray-shot', 'aria-hidden': 'true' }, h('b', {}, COUNTER_TEXT[key].label), h('span', { class: 'tray-no' })),
      ...(SHOT_TAGS[key] as readonly string[]).map((tag) =>
        h('button', { type: 'button', class: tag.startsWith('ob-') ? 'chip ob' : 'chip', 'data-tag': tag }, (TAG_LABELS[key] as Record<string, string>)[tag])),
    );
  }
  setText(box.querySelector('.tray-no')!, `${index + 1}번째`);
  const chosen = tagAt(cur, key, index);
  for (const chip of box.querySelectorAll<HTMLButtonElement>('.chip')) chip.setAttribute('aria-pressed', String(chip.dataset.tag === chosen));
  box.hidden = false;
}

function bindTray(): void {
  $('shot-tray').addEventListener('click', (event) => {
    if (!tray) return;
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>('button.chip');
    // A tap on the tray around the chips closes it, giving back the title and par.
    if (!chip) {
      closeTray();
      renderTray();
      return;
    }
    const { key, index } = tray;
    const tag = chip.dataset.tag as ShotTag;
    const next = tagAt(hole(), key, index) === tag ? null : tag;
    const obBefore = hole().ob;
    armTray();
    setHole((x) => setTag(x, key, index, next as ShotTag<typeof key> | null));
    navigator.vibrate?.(8);
    const name = next === null ? '지움' : (TAG_LABELS[key] as Record<string, string>)[next];
    const ob = hole().ob !== obBefore ? `, OB ${hole().ob}, ${strokes(hole())}타` : '';
    announce(`${COUNTER_TEXT[key].label} ${index + 1}번째 ${name}${ob}`);
  });
}

function plusButton(key: Counter, label: string): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'step plus', 'data-delta': '1', 'aria-label': `${label} 하나 더하기` });
  // Static icon markup from icons.ts, never user input.
  button.innerHTML = `${COUNTER_ICONS[key]}<span class="plus-mark" aria-hidden="true">+</span>`;
  return button;
}

function renderHole(): void {
  const cur = hole();
  const n = round.current + 1;
  setText($('hole-title'), `${n}번 홀`);
  for (const button of document.querySelectorAll<HTMLButtonElement>('.par-pick button')) {
    const on = Number(button.dataset.par) === cur.par;
    button.setAttribute('aria-checked', String(on));
    button.tabIndex = on ? 0 : -1;
  }
  const s = strokes(cur);
  setText($('hole-strokes'), String(s));
  const topar = $('hole-topar');
  const name = $('hole-name');
  if (finished(round, round.current)) {
    setText(topar, formatToPar(s - cur.par));
    topar.className = `topar ${toParClass(s - cur.par)}`;
    setText(name, SCORE_LABELS[scoreName(s - cur.par)]);
  } else {
    setText(topar, '');
    setText(name, played(cur) ? '진행 중 · 퍼트를 넣으면 스코어가 정해집니다' : '아직 기록 없음');
  }
  for (const row of document.querySelectorAll<HTMLElement>('.counter')) {
    const key = row.dataset.key as Counter;
    setText(row.querySelector('output')!, String(cur[key]));
    row.querySelector<HTMLButtonElement>('.minus')!.disabled = cur[key] === 0;
    row.querySelector<HTMLButtonElement>('.plus')!.disabled = cur[key] === MAX_COUNT;
  }
  $<HTMLButtonElement>('prev-hole').disabled = round.current === 0;
  const next = $<HTMLButtonElement>('next-hole');
  next.disabled = round.current === HOLE_COUNT - 1;
  setText(next, round.current === HOLE_COUNT - 1 ? '마지막 홀' : `${n + 1}번 홀 ▶`);
}

/* ---------- tabs and summary ---------- */

function renderTabs(): void {
  const list = $('hole-tabs');
  list.replaceChildren(
    ...round.holes.map((x, i) => {
      const s = strokes(x);
      const done = finished(round, i);
      const state = done ? `, ${s}타` : played(x) ? `, 진행 중 ${s}타` : '';
      const button = h('button', { type: 'button', 'data-hole': String(i), 'aria-label': `${i + 1}번 홀${state}` },
        h('span', { class: 'tab-no' }, String(i + 1)),
        h('span', { class: 'tab-score' }, played(x) ? String(s) : '·'),
      );
      if (done) button.classList.add(toParClass(s - x.par));
      else if (played(x)) button.classList.add('in-progress');
      if (i === round.current) button.setAttribute('aria-current', 'true');
      return h('li', {}, button);
    }),
  );
}

function renderSummary(a: Analysis): void {
  $('sum-strokes').textContent = String(a.totals.strokes);
  const topar = $('sum-topar');
  topar.textContent = a.totals.holes ? formatToPar(a.toPar) : '';
  topar.className = `topar ${a.totals.holes ? toParClass(Math.sign(a.toPar)) : ''}`;
  $('sum-holes').textContent = `${a.totals.holes}/${HOLE_COUNT}`;
  $('sum-putts').textContent = String(a.totals.putts);
  $('sum-ob').textContent = String(a.totals.ob);
  $('sum-mulligan').textContent = String(a.totals.mulligan);
}

/* ---------- scorecard ---------- */

function cardTable(r: Round, caption: string, start: number, t: Totals, links: boolean): HTMLTableElement {
  const holes = r.holes.slice(start, start + 9);
  const sumLabel = start === 0 ? 'OUT' : 'IN';
  const row = (label: string, cells: (string | Node)[], total: string, cls = '') =>
    h('tr', cls ? { class: cls } : {}, h('th', { scope: 'row' }, label), ...cells.map((c) => h('td', {}, c)), h('td', { class: 'sum' }, total));
  const done = (i: number) => finished(r, start + i);
  const dash = (i: number, v: number) => (done(i) ? String(v) : '');
  const number = (i: number) => (links
    ? h('button', { type: 'button', class: 'link', 'data-hole': String(start + i), 'aria-label': `${start + i + 1}번 홀로 가기` }, String(start + i + 1))
    : String(start + i + 1));
  return h('table', { class: 'scorecard' },
    h('caption', {}, caption),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '홀'),
      ...holes.map((_, i) => h('th', { scope: 'col' }, number(i))),
      h('th', { scope: 'col', class: 'sum' }, sumLabel))),
    h('tbody', {},
      row('Par', holes.map((x) => String(x.par)), String(holes.reduce((s, x) => s + x.par, 0)), 'par-row'),
      row('타수', holes.map((x, i) => {
        if (!done(i)) return '';
        const s = strokes(x);
        return h('span', { class: `mark ${toParClass(s - x.par)}` }, String(s));
      }), t.holes ? String(t.strokes) : '', 'strokes-row'),
      row('퍼트', holes.map((x, i) => dash(i, x.putts)), t.holes ? String(t.putts) : ''),
      row('OB', holes.map((x, i) => (done(i) && x.ob ? String(x.ob) : '')), t.ob ? String(t.ob) : ''),
      row('멀리건', holes.map((x) => (x.mulligan ? String(x.mulligan) : '')), t.mulligan ? String(t.mulligan) : ''),
    ),
  );
}

/** Front and back nine tables and the total line. A past round shows them without links to holes. */
function scorecardNodes(r: Round, a: Analysis, links = true): Node[] {
  return [
    cardTable(r, '전반 9홀', 0, a.front, links),
    cardTable(r, '후반 9홀', 9, a.back, links),
    h('p', { class: 'card-total' },
      '합계 ', h('b', {}, `${a.totals.strokes}타`),
      a.totals.holes ? ` (${formatToPar(a.toPar)}) · ` : ' · ',
      `${a.totals.holes}홀 · 퍼트 ${a.totals.putts} · OB ${a.totals.ob} · 멀리건 ${a.totals.mulligan}`),
  ];
}

function renderScorecard(a: Analysis): void {
  $('scorecard').replaceChildren(...scorecardNodes(round, a));
}

/* ---------- analysis ---------- */

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
    ['OB', `${t.ob}회 (+${t.ob}타)`],
    ['멀리건', `${t.mulligan}회`],
  ];
  const maxDist = Math.max(...Object.values(a.distribution));
  const maxLost = Math.max(1, ...Object.values(a.lost));
  return [
    h('p', { class: 'headline' }, `${t.holes}홀 ${t.strokes}타`, h('span', { class: `topar ${toParClass(Math.sign(a.toPar))}` }, ` ${formatToPar(a.toPar)}`),
      t.holes < HOLE_COUNT ? h('span', { class: 'muted' }, ` · 남은 ${HOLE_COUNT - t.holes}홀`) : null),
    h('dl', { class: 'metrics' }, ...metrics.flatMap(([k, v]) => [h('div', {}, h('dt', {}, k), h('dd', {}, v))])),
    h('h3', {}, '스코어 분포'),
    h('div', { class: 'bars' }, ...(Object.keys(SCORE_LABELS) as ScoreName[]).map((k) => bar(SCORE_LABELS[k], a.distribution[k], maxDist, `${a.distribution[k]}홀`, `score-${k}`))),
    h('h3', {}, '영역별 잃은 타수'),
    h('p', { class: 'muted small' }, '홀마다 티샷 1번, 어프로치 Par−3번, 퍼트 2번을 기준으로 더 친 타수입니다. 기준보다 적게 친 홀이 다른 홀의 손실을 지우지 않습니다.'),
    h('div', { class: 'bars' }, ...(Object.keys(AREA_LABELS) as Area[]).map((k) => bar(AREA_LABELS[k], a.lost[k], maxLost, a.lost[k] > 0 ? `+${a.lost[k]}` : '0', a.worstAreas.includes(k) ? 'worst' : 'area'))),
    h('h3', {}, 'Par별 평균'),
    h('dl', { class: 'metrics three' }, ...a.byPar.map((p) => h('div', {}, h('dt', {}, `Par ${p.par}`), h('dd', {}, p.holes ? `${one(p.average)}타 (${p.holes}홀)` : '—')))),
    a.best && a.worst
      ? h('p', { class: 'best-worst' }, `가장 잘한 홀 ${a.best.hole}번 (${formatToPar(a.best.toPar)}) · 가장 아쉬운 홀 ${a.worst.hole}번 (${formatToPar(a.worst.toPar)})`)
      : '',
    h('h3', {}, '정리'),
    h('ul', { class: 'insights' }, ...insights(a).map((s) => h('li', {}, s))),
    ...(a.details
      ? [h('h3', {}, '샷 세부'), h('ul', { class: 'insights details' }, ...detailLines(a).map((s) => h('li', {}, s)))]
      : []),
  ];
}

/* ---------- send ---------- */

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

/* ---------- course ---------- */

function renderCourse(): void {
  const course = roundCourse(round);
  setText($('course-name'), courseLabel(course));
  const source = courseSource(course);
  const box = $('par-source');
  const key = source ? `${source.source}|${source.checked}` : 'custom';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren(...(source
    ? ['기본 Par 출처: ', h('a', { href: source.source, target: '_blank', rel: 'noopener noreferrer' }, '공식 스코어카드'), ` (${source.checked} 확인) · 홀마다 바꿀 수 있습니다.`]
    : ['직접 입력한 코스라 Par 4로 시작했습니다. 홀마다 바꿀 수 있습니다.']));
}

/**
 * Starts a new round on the chosen course and remembers the choice for next time. Every way into a new round comes
 * through here, so a round with a finished hole moves to the past rounds first; if it cannot be kept, the player decides.
 */
function startRound(choice: CourseChoice): void {
  if (!keepBeforeNewRound(round)) return;
  stale = false;
  savePrefs(choice);
  clearRound();
  update(newRound(new Date(), roundSetup(choice)));
  window.scrollTo({ top: 0 });
}

/* ---------- everything ---------- */

function render(): void {
  const a = analyze(round);
  renderHole();
  renderTray();
  renderTabs();
  renderSummary(a);
  renderScorecard(a);
  renderAnalysis(a);
  renderSend(a);
  renderCourse();
  setText($('save-state'), !saved
    ? '이 브라우저에서는 저장할 수 없습니다. 새로고침하면 기록이 지워집니다.'
    : detached
      ? '저장된 기록이 다른 탭에서 지워졌거나 읽을 수 없습니다. 이 탭의 기록은 다음 입력 때 다시 저장됩니다.'
      : rescued
        ? '저장된 기록을 읽을 수 없어 새 라운드로 시작합니다. 원래 값은 이 기기에 따로 보관했습니다.'
        : trimmed
          ? '저장된 세부 기록 일부를 읽을 수 없어 빼고 불러왔습니다. 원래 값은 이 기기에 따로 보관했습니다.'
          : `${dateLabel(round.date)} 라운드 · 이 기기에만 자동 저장됩니다.`);
  $('stale').hidden = !stale;
  if (stale) setText($('stale-text'), `${dateLabel(round.date)}에 기록하던 라운드입니다.`);
}

function bind(): void {
  buildCounters();
  bindTray();
  document.querySelector('.par-pick')!.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-par]');
    if (!button) return;
    const par = Number(button.dataset.par) as Par;
    if (PARS.includes(par)) setHole((x) => (x.par === par ? x : { ...x, par }));
  });
  document.querySelector('.par-pick')!.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = PARS.indexOf(hole().par);
    const par = PARS[(i + step + PARS.length) % PARS.length];
    setHole((x) => ({ ...x, par }));
    document.querySelector<HTMLButtonElement>(`.par-pick button[data-par="${par}"]`)!.focus();
  });
  $('prev-hole').addEventListener('click', () => go(round.current - 1));
  $('next-hole').addEventListener('click', () => go(round.current + 1));
  for (const id of ['hole-tabs', 'scorecard']) {
    $(id).addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-hole]');
      if (button) go(Number(button.dataset.hole));
    });
  }
  // The current round stays until a course is chosen; cancelling the picker keeps it (startRound keeps it among past rounds).
  const startNew = () => openPicker({ mode: 'new', initial: loadPrefs(), onStart: startRound });
  $('new-round').addEventListener('click', () => {
    if (confirm(newRoundQuestion(round))) startNew();
  });
  $('stale-new').addEventListener('click', () => {
    if (confirm(newRoundQuestion(round))) startNew();
  });
  $('send-share').addEventListener('click', () => void shareReport(round, $('send-status')));
  $('stale-keep').addEventListener('click', () => {
    stale = false;
    // Saving marks the round as just edited, so the banner does not come back on the next load.
    update(round);
  });
  // Another tab of this tool saved the round: show that instead of overwriting it on the next tap.
  // If the saved round was removed or cannot be read, keep this tab's round and say it is not saved.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    const next = loadRound();
    closeTray();
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
// The course picker comes first: with no round, with an untouched one, or with one from an earlier day.
if (loaded === null || untouched) openPicker({ mode: 'first', initial: loadPrefs(), onStart: startRound });
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
trackSummaryHeight();
keepScreenOn();
registerOffline();
initHistory({
  current: () => round,
  replace: (next) => {
    stale = false;
    closeTray();
    update(next);
    window.scrollTo({ top: 0 });
  },
  scorecard: (r, a) => scorecardNodes(r, a, false),
  analysis: analysisNodes,
  share: shareReport,
  shareLabel: canShare ? '공유하기' : canCopy ? '결과 복사' : null,
});
