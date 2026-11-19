import './style.css';
import {
  AREA_LABELS,
  HOLE_COUNT,
  MAX_COUNT,
  PARS,
  PENALTIES,
  SCORE_LABELS,
  SHOT_TAGS,
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
import { CLUB_ICONS } from './icons';
import { holeArt, layoutBend } from './hole-art';
import { registerOffline } from './offline';
import { dateLabel, detailLines, insights, mailtoHref, reportSubject, reportText } from './report';
import { STORAGE_KEY, clearRound, loadPrefs, loadRound, preserveUnreadable, requestPersistence, savePrefs, saveRound, type CourseChoice } from './storage';
import { trackSummaryHeight } from './layout';
import { keepScreenOn } from './wake';
import { courseSource, distanceLabel, holeInfo, resolveChoice, roundSetup } from './courses';
import { closePicker, openPicker, pickerOpen } from './picker';

const LABELS: Record<Counter, string> = { driver: '드라이버', approach: '어프로치', putts: '퍼터', ob: 'OB', hazard: '해저드', mulligan: '멀리건' };

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

function setLabel(el: Element, label: string): void {
  if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
}

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

/** Changes one hole; false when nothing changed. */
function setHoleAt(index: number, patch: (h: Hole) => Hole): boolean {
  const before = round.holes[index];
  const after = patch(before);
  if (after === before) return false;
  const holes = round.holes.slice();
  holes[index] = after;
  update({ ...round, holes });
  return true;
}

const setHole = (patch: (h: Hole) => Hole) => setHoleAt(round.current, patch);

/* ---------- views: 기록 and 스코어카드 ---------- */

type View = 'entry' | 'card';
const VIEWS: View[] = ['entry', 'card'];
const TAB_ID: Record<View, string> = { entry: 'tab-entry', card: 'tab-card' };
const PANEL_ID: Record<View, string> = { entry: 'entry', card: 'card-view' };
/** Kept in memory: a reload opens 기록. */
let view: View = 'entry';
let measureSummary = (): void => undefined;

function show(next: View, focusTab = false): void {
  const changed = next !== view;
  view = next;
  for (const v of VIEWS) {
    const tab = $<HTMLButtonElement>(TAB_ID[v]);
    tab.setAttribute('aria-selected', String(v === view));
    tab.tabIndex = v === view ? 0 : -1;
    $(PANEL_ID[v]).hidden = v !== view;
  }
  // The sticky totals only exist on the scorecard; the scroll offset follows them at once.
  measureSummary();
  if (changed) window.scrollTo({ top: 0 });
  if (focusTab) $(TAB_ID[view]).focus();
}

function bindViews(): void {
  for (const v of VIEWS) $(TAB_ID[v]).addEventListener('click', () => show(v));
  $('views').addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    const other: View = view === 'entry' ? 'card' : 'entry';
    const target = ({ ArrowLeft: other, ArrowRight: other, Home: 'entry', End: 'card' } as Record<string, View>)[e.key];
    if (!target) return;
    e.preventDefault();
    show(target, true);
  });
}

/* ---------- moving between holes ---------- */

function go(index: number): void {
  if (index < 0 || index >= HOLE_COUNT || index === round.current) return;
  update({ ...round, current: index });
  window.scrollTo({ top: 0 });
  announce(`${index + 1}번 홀, Par ${hole().par}`);
}

/** "다음 홀", or the scorecard after the last hole. */
function goNext(): void {
  if (round.current === HOLE_COUNT - 1) show('card');
  else go(round.current + 1);
}

/* ---------- hole panel ---------- */

function renderPanel(a: Analysis): void {
  const cur = hole();
  setText($('hole-title'), `${round.current + 1}번 홀`);
  setText($('hole-par'), `Par ${cur.par}`);

  const info = holeInfo(roundCourse(round), round.current);
  const distance = distanceLabel(info);
  const dist = $('hole-distance');
  setText(dist, distance ?? '');
  dist.hidden = distance === null;
  const layout = info?.layout ?? '';
  setText($('hole-layout'), layout);
  $('hole-layout').hidden = layout === '';
  const guide = $<HTMLAnchorElement>('hole-guide');
  if (info?.guideUrl) {
    if (guide.getAttribute('href') !== info.guideUrl) guide.setAttribute('href', info.guideUrl);
    guide.hidden = false;
  } else {
    guide.removeAttribute('href');
    guide.hidden = true;
  }
  $('hole-notes').hidden = layout === '' && !info?.guideUrl;

  const bend = layoutBend(info?.layout);
  const art = $('hole-art');
  const key = `${cur.par}:${bend}`;
  if (art.dataset.key !== key) {
    art.dataset.key = key;
    // Static markup from hole-art.ts, built from the par and a bend direction only.
    art.innerHTML = holeArt(cur.par, bend);
  }

  const s = strokes(cur);
  const score = $('hole-strokes');
  setText(score, String(s));
  const name: ScoreName | null = finished(round, round.current) ? scoreName(s - cur.par) : null;
  const cls = name ? `score mark-${name}` : 'score';
  if (score.className !== cls) score.className = cls;
  setText($('hole-name'), name ? SCORE_LABELS[name] : played(cur) ? '진행 중' : '아직 기록 없음');
  const t = a.totals;
  setText($('hole-run'), t.holes ? `합계 ${t.strokes}타 ${formatToPar(a.toPar)}` : '합계 –');

  $<HTMLButtonElement>('prev-hole').disabled = round.current === 0;
  $<HTMLButtonElement>('next-hole').disabled = round.current === HOLE_COUNT - 1;
  setText($('go-next'), round.current === HOLE_COUNT - 1 ? '스코어카드 보기' : '다음 홀');
}

/* ---------- clubs and stakes ---------- */

/** One stroke more or less on a club, a penalty or a mulligan; the hole's score follows. */
function count(key: Counter, delta: number): void {
  if (!setHole((x) => bump(x, key, delta))) return;
  navigator.vibrate?.(8);
  announce(`${round.current + 1}번 홀 ${LABELS[key]} ${hole()[key]}, ${strokes(hole())}타`);
}

function buildClubs(): void {
  const box = $('clubs');
  for (const key of TAGGED) {
    const label = LABELS[key];
    const head = h('div', { class: 'club-head', 'aria-hidden': 'true' }, h('span', { class: 'club-name' }, label));
    // Static icon markup from icons.ts, never user input.
    head.insertAdjacentHTML('afterbegin', CLUB_ICONS[key]);
    box.append(
      h('div', { class: `club club-${key}`, 'data-key': key, role: 'group', 'aria-label': label },
        head,
        h('button', { type: 'button', class: 'count', 'aria-haspopup': 'dialog' }, '0'),
        h('button', { type: 'button', class: 'plus', 'aria-label': `${label} 하나 더하기` }, '+'),
        h('button', { type: 'button', class: 'minus', 'aria-label': `${label} 하나 빼기` }, '−'),
      ),
    );
  }
  box.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    const key = button.closest<HTMLElement>('.club')!.dataset.key as Tagged;
    if (button.classList.contains('count')) openShots(key, button);
    else count(key, button.classList.contains('plus') ? 1 : -1);
  });
}

function renderClubs(): void {
  const cur = hole();
  for (const el of document.querySelectorAll<HTMLElement>('.club')) {
    const key = el.dataset.key as Tagged;
    const n = cur[key];
    const shots = el.querySelector<HTMLButtonElement>('.count')!;
    setText(shots, String(n));
    setLabel(shots, `${LABELS[key]} 샷 세부 보기 (${n}타)`);
    shots.disabled = n === 0;
    shots.classList.toggle('has-tags', (cur.tags?.[key] ?? []).some((t) => t !== null));
    el.querySelector<HTMLButtonElement>('.plus')!.disabled = n >= MAX_COUNT;
    el.querySelector<HTMLButtonElement>('.minus')!.disabled = n === 0;
  }
}

function bindStakes(): void {
  for (const key of PENALTIES) {
    $(`stake-${key}`).addEventListener('click', () => count(key, 1));
    $(`unstake-${key}`).addEventListener('click', () => {
      count(key, -1);
      // The minus hides at zero; keep focus on the stake.
      if (hole()[key] === 0) $(`stake-${key}`).focus();
    });
  }
}

function renderStakes(): void {
  const cur = hole();
  for (const key of PENALTIES) {
    const n = cur[key];
    const stake = $<HTMLButtonElement>(`stake-${key}`);
    const badge = stake.querySelector('.badge')!;
    setText(badge, String(n));
    badge.classList.toggle('zero', n === 0);
    stake.disabled = n >= MAX_COUNT;
    setLabel(stake, `${LABELS[key]} 하나 더하기${n ? ` (지금 ${n})` : ''}`);
    const minus = $<HTMLButtonElement>(`unstake-${key}`);
    minus.disabled = n === 0;
    // Hidden, not removed, so nothing beside it moves.
    minus.classList.toggle('off', n === 0);
  }
}

/* ---------- shot details ---------- */

/** The club whose shots the panel lists, while it is open. */
let shotsKey: Tagged | null = null;
let shotsOpener: HTMLElement | null = null;

function openShots(key: Tagged, opener: HTMLElement): void {
  if (hole()[key] === 0) return;
  shotsKey = key;
  shotsOpener = opener;
  renderShots();
  $<HTMLDialogElement>('shots').showModal();
}

function renderShots(): void {
  const key = shotsKey;
  if (!key) return;
  const cur = hole();
  const n = cur[key];
  if (n === 0) {
    $<HTMLDialogElement>('shots').close();
    return;
  }
  setText($('shots-title'), `${LABELS[key]} 샷 세부`);
  const list = $('shots-list');
  // Rebuilt only when the shots change, so a chip keeps focus after it is tapped.
  const id = `${round.current}:${key}:${n}`;
  if (list.dataset.key !== id) {
    list.dataset.key = id;
    list.replaceChildren(
      ...Array.from({ length: n }, (_, i) =>
        h('li', { class: 'shot', 'data-index': String(i) },
          h('span', { class: 'shot-no', id: `shot-${i}` }, `${i + 1}번째`),
          h('div', { class: 'chips', role: 'group', 'aria-labelledby': `shot-${i}` },
            ...(SHOT_TAGS[key] as readonly string[]).map((tag) =>
              h('button', { type: 'button', class: tag.startsWith('ob-') ? 'chip ob' : 'chip', 'data-tag': tag, 'aria-pressed': 'false' },
                (TAG_LABELS[key] as Record<string, string>)[tag]))),
        )),
    );
  }
  for (const li of list.querySelectorAll<HTMLElement>('.shot')) {
    const chosen = tagAt(cur, key, Number(li.dataset.index));
    for (const chip of li.querySelectorAll<HTMLButtonElement>('.chip')) chip.setAttribute('aria-pressed', String(chip.dataset.tag === chosen));
  }
}

function bindShots(): void {
  const dialog = $<HTMLDialogElement>('shots');
  $('shots-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    shotsKey = null;
    const list = $('shots-list');
    list.replaceChildren();
    delete list.dataset.key;
    shotsOpener?.focus();
    shotsOpener = null;
  });
  $('shots-list').addEventListener('click', (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>('button.chip');
    const key = shotsKey;
    if (!chip || !key) return;
    const index = Number(chip.closest<HTMLElement>('.shot')!.dataset.index);
    const tag = chip.dataset.tag as ShotTag;
    const next = tagAt(hole(), key, index) === tag ? null : tag;
    const obBefore = hole().ob;
    setHole((x) => setTag(x, key, index, next as ShotTag<typeof key> | null));
    navigator.vibrate?.(8);
    const name = next === null ? '지움' : (TAG_LABELS[key] as Record<string, string>)[next];
    const ob = hole().ob !== obBefore ? `, OB ${hole().ob}, ${strokes(hole())}타` : '';
    announce(`${LABELS[key]} ${index + 1}번째 ${name}${ob}`);
  });
}

/* ---------- 더보기: mulligans ---------- */

function bindMore(): void {
  const dialog = $<HTMLDialogElement>('more');
  $('more-open').addEventListener('click', () => {
    renderMore();
    dialog.showModal();
  });
  $('more-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => $('more-open').focus());
  $('mulligan-plus').addEventListener('click', () => count('mulligan', 1));
  $('mulligan-minus').addEventListener('click', () => count('mulligan', -1));
}

function renderMore(): void {
  const n = hole().mulligan;
  setText($('mulligan-count'), String(n));
  $<HTMLButtonElement>('mulligan-minus').disabled = n === 0;
  $<HTMLButtonElement>('mulligan-plus').disabled = n >= MAX_COUNT;
}

/* ---------- par, changed from the scorecard ---------- */

let parHole: number | null = null;

function openPar(index: number): void {
  parHole = index;
  setText($('par-title'), `${index + 1}번 홀 Par`);
  for (const button of document.querySelectorAll<HTMLButtonElement>('#par-options button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.par) === round.holes[index].par));
  }
  $<HTMLDialogElement>('par-dialog').showModal();
  document.querySelector<HTMLButtonElement>('#par-options button[aria-pressed="true"]')?.focus();
}

function bindPar(): void {
  const dialog = $<HTMLDialogElement>('par-dialog');
  $('par-cancel').addEventListener('click', () => dialog.close());
  $('par-options').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-par]');
    const index = parHole;
    if (!button || index === null) return;
    const par = Number(button.dataset.par) as Par;
    dialog.close();
    if (PARS.includes(par) && setHoleAt(index, (x) => (x.par === par ? x : { ...x, par }))) announce(`${index + 1}번 홀 Par ${par}`);
  });
  // The scorecard is rebuilt on every change, so focus goes back to the same hole's new par button.
  dialog.addEventListener('close', () => {
    const index = parHole;
    parHole = null;
    if (index !== null) document.querySelector<HTMLButtonElement>(`button[data-par-hole="${index}"]`)?.focus();
  });
}

/* ---------- scorecard view ---------- */

function renderSummary(a: Analysis): void {
  const t = a.totals;
  setText($('sum-strokes'), String(t.strokes));
  const topar = $('sum-topar');
  setText(topar, t.holes ? formatToPar(a.toPar) : '');
  topar.className = t.holes && a.toPar < 0 ? 'topar under' : 'topar';
  setText($('sum-holes'), `${t.holes}/${HOLE_COUNT}`);
  setText($('sum-putts'), String(t.putts));
  setText($('sum-penalty'), String(t.ob + t.hazard));
  setText($('sum-mulligan'), String(t.mulligan));
}

function cardTable(caption: string, start: number, t: Totals): HTMLTableElement {
  const holes = round.holes.slice(start, start + 9);
  const sumLabel = start === 0 ? 'OUT' : 'IN';
  const row = (label: string, cells: (string | Node)[], total: string, cls = '') =>
    h('tr', cls ? { class: cls } : {}, h('th', { scope: 'row' }, label), ...cells.map((c) => h('td', {}, c)), h('td', { class: 'sum' }, total));
  const done = (i: number) => finished(round, start + i);
  const dash = (i: number, v: number) => (done(i) ? String(v) : '');
  return h('table', { class: 'scorecard' },
    h('caption', {}, caption),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '홀'),
      ...holes.map((_, i) => h('th', { scope: 'col' }, h('button', { type: 'button', class: 'link', 'data-hole': String(start + i), 'aria-label': `${start + i + 1}번 홀로 가기` }, String(start + i + 1)))),
      h('th', { scope: 'col', class: 'sum' }, sumLabel))),
    h('tbody', {},
      row('Par', holes.map((x, i) => h('button', { type: 'button', class: 'par-btn', 'data-par-hole': String(start + i), 'aria-label': `${start + i + 1}번 홀 Par ${x.par} 바꾸기`, 'aria-haspopup': 'dialog' }, String(x.par))),
        String(holes.reduce((s, x) => s + x.par, 0)), 'par-row'),
      row('타수', holes.map((x, i) => {
        if (!done(i)) return '';
        const s = strokes(x);
        return h('span', { class: `mark mark-${scoreName(s - x.par)}` }, String(s));
      }), t.holes ? String(t.strokes) : '', 'strokes-row'),
      row('퍼트', holes.map((x, i) => dash(i, x.putts)), t.holes ? String(t.putts) : ''),
      row('벌타', holes.map((x, i) => (done(i) && x.ob + x.hazard ? String(x.ob + x.hazard) : '')), t.ob + t.hazard ? String(t.ob + t.hazard) : ''),
      row('멀리건', holes.map((x) => (x.mulligan ? String(x.mulligan) : '')), t.mulligan ? String(t.mulligan) : ''),
    ),
  );
}

function renderScorecard(a: Analysis): void {
  const t = a.totals;
  $('scorecard').replaceChildren(
    cardTable('전반 9홀', 0, a.front),
    cardTable('후반 9홀', 9, a.back),
    h('p', { class: 'card-total' },
      '합계 ', h('b', {}, `${t.strokes}타`),
      t.holes ? ` (${formatToPar(a.toPar)}) · ` : ' · ',
      `${t.holes}홀 · 퍼트 ${t.putts} · OB ${t.ob} · 해저드 ${t.hazard} · 멀리건 ${t.mulligan}`),
  );
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
  const maxLost = Math.max(1, ...Object.values(a.lost));
  box.replaceChildren(
    h('p', { class: 'headline' }, `${t.holes}홀 ${t.strokes}타`, h('span', { class: a.toPar < 0 ? 'topar under' : 'topar' }, ` ${formatToPar(a.toPar)}`),
      t.holes < HOLE_COUNT ? h('span', { class: 'muted' }, ` · 남은 ${HOLE_COUNT - t.holes}홀`) : null),
    h('dl', { class: 'metrics' }, ...metrics.flatMap(([k, v]) => [h('div', {}, h('dt', {}, k), h('dd', {}, v))])),
    h('h3', {}, '스코어 분포'),
    h('div', { class: 'bars' }, ...(Object.keys(SCORE_LABELS) as ScoreName[]).map((k) => bar(SCORE_LABELS[k], a.distribution[k], maxDist, `${a.distribution[k]}홀`, `score-${k}`))),
    h('h3', {}, '영역별 잃은 타수'),
    h('p', { class: 'muted small' }, '홀마다 티샷 1번, 어프로치 Par−3번, 퍼트 2번을 기준으로 더 친 타수와 벌타(OB·해저드)입니다. 기준보다 적게 친 홀이 다른 홀의 손실을 지우지 않습니다.'),
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

/** Starts a new round on the chosen course and remembers the choice for next time. */
function startRound(choice: CourseChoice): void {
  stale = false;
  savePrefs(choice);
  clearRound();
  update(newRound(new Date(), roundSetup(choice)));
  show('entry');
  window.scrollTo({ top: 0 });
}

/* ---------- everything ---------- */

/** What the save line says, and whether it is a problem the entry screen should show too. */
function saveMessage(): { text: string; problem: boolean } {
  if (!saved) return { text: '이 브라우저에서는 저장할 수 없습니다. 새로고침하면 기록이 지워집니다.', problem: true };
  if (detached) return { text: '저장된 기록이 다른 탭에서 지워졌거나 읽을 수 없습니다. 이 탭의 기록은 다음 입력 때 다시 저장됩니다.', problem: true };
  if (rescued) return { text: '저장된 기록을 읽을 수 없어 새 라운드로 시작합니다. 원래 값은 이 기기에 따로 보관했습니다.', problem: true };
  if (trimmed) return { text: '저장된 세부 기록 일부를 읽을 수 없어 빼고 불러왔습니다. 원래 값은 이 기기에 따로 보관했습니다.', problem: true };
  return { text: `${dateLabel(round.date)} 라운드 · 이 기기에만 자동 저장됩니다.`, problem: false };
}

function render(): void {
  const a = analyze(round);
  renderPanel(a);
  renderClubs();
  renderStakes();
  renderMore();
  renderShots();
  renderSummary(a);
  renderScorecard(a);
  renderAnalysis(a);
  renderSend(a);
  renderCourse();
  const message = saveMessage();
  setText($('save-state'), message.text);
  const notice = $('notice');
  setText(notice, message.problem ? message.text : '');
  notice.hidden = !message.problem;
  $('stale').hidden = !stale;
  if (stale) setText($('stale-text'), `${dateLabel(round.date)}에 기록하던 라운드입니다.`);
}

function bind(): void {
  bindViews();
  buildClubs();
  bindStakes();
  bindShots();
  bindMore();
  bindPar();
  $('prev-hole').addEventListener('click', () => go(round.current - 1));
  $('next-hole').addEventListener('click', () => go(round.current + 1));
  $('go-next').addEventListener('click', goNext);
  $('scorecard').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const holeButton = target.closest<HTMLButtonElement>('button[data-hole]');
    if (holeButton) {
      // A hole on the scorecard opens in 기록.
      go(Number(holeButton.dataset.hole));
      show('entry');
      return;
    }
    const parButton = target.closest<HTMLButtonElement>('button[data-par-hole]');
    if (parButton) openPar(Number(parButton.dataset.parHole));
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
measureSummary = trackSummaryHeight();
keepScreenOn();
registerOffline();
