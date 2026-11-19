import './style.css';
import {
  AREA_LABELS,
  COUNTERS,
  HOLE_COUNT,
  PARS,
  SCORE_LABELS,
  analyze,
  bump,
  finished,
  formatToPar,
  localDate,
  MAX_COUNT,
  newRound,
  played,
  scoreName,
  strokes,
  type Analysis,
  type Area,
  type Counter,
  type Hole,
  type Par,
  type Round,
  type ScoreName,
  type Totals,
} from './round';
import { STORAGE_KEY, clearRound, loadRound, saveRound } from './storage';

const COUNTER_TEXT: Record<Counter, { label: string; hint: string }> = {
  driver: { label: '드라이버', hint: '티샷. OB 뒤 다시 친 티샷도' },
  approach: { label: '어프로치', hint: '두 번째 샷부터 그린 전까지' },
  putts: { label: '퍼터', hint: '그린 위 퍼트' },
  ob: { label: 'OB', hint: '1벌타가 타수에 더해짐' },
  mulligan: { label: '멀리건', hint: '표시만, 타수에 넣지 않음' },
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

function announce(text: string): void {
  const live = $('announce');
  // Clearing first makes a repeated message (same count twice) be read again.
  live.textContent = '';
  requestAnimationFrame(() => (live.textContent = text));
}

const loaded = loadRound();
let round: Round = loaded ?? newRound();
let saved = saveRound(round);
/** A round left from an earlier day, offered to continue or replace on load. */
let stale = loaded !== null && loaded.date !== localDate() && loaded.holes.some((x) => played(x) || x.mulligan > 0);

function hole(): Hole {
  return round.holes[round.current];
}

function update(next: Round): void {
  round = next;
  saved = saveRound(round);
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
    box.append(
      h('div', { class: `counter counter-${key}`, 'data-key': key },
        h('div', { class: 'counter-label' }, h('b', {}, label), h('span', {}, hint)),
        h('button', { type: 'button', class: 'step minus', 'data-delta': '-1', 'aria-label': `${label} 하나 빼기` }, '−'),
        h('output', { class: 'count', 'aria-label': label }, '0'),
        h('button', { type: 'button', class: 'step plus', 'data-delta': '1', 'aria-label': `${label} 하나 더하기` }, '+'),
      ),
    );
  }
  box.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button.step');
    if (!button) return;
    const key = button.closest<HTMLElement>('.counter')!.dataset.key as Counter;
    const before = hole();
    setHole((x) => bump(x, key, Number(button.dataset.delta)));
    if (hole() === before) return;
    navigator.vibrate?.(8);
    announce(`${round.current + 1}번 홀 ${COUNTER_TEXT[key].label} ${hole()[key]}, ${strokes(hole())}타`);
  });
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

function renderScorecard(a: Analysis): void {
  $('scorecard').replaceChildren(
    cardTable('전반 9홀', 0, a.front),
    cardTable('후반 9홀', 9, a.back),
    h('p', { class: 'card-total' },
      '합계 ', h('b', {}, `${a.totals.strokes}타`),
      a.totals.holes ? ` (${formatToPar(a.toPar)}) · ` : ' · ',
      `${a.totals.holes}홀 · 퍼트 ${a.totals.putts} · OB ${a.totals.ob} · 멀리건 ${a.totals.mulligan}`),
  );
}

/* ---------- analysis ---------- */

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

function bar(label: string, value: number, max: number, text: string, cls = ''): HTMLElement {
  const fill = h('span', { class: `bar-fill ${cls}` });
  fill.style.width = `${max > 0 ? Math.max(0, (value / max) * 100) : 0}%`;
  return h('div', { class: 'bar-row' }, h('span', { class: 'bar-label' }, label), h('span', { class: 'bar-track' }, fill), h('span', { class: 'bar-value' }, text));
}

function insights(a: Analysis): string[] {
  const t = a.totals;
  const out: string[] = [];
  if (a.worstAreas.length) {
    const names = a.worstAreas.map((k) => AREA_LABELS[k]).join('·');
    out.push(`기준(티샷 1, 어프로치 Par−3, 퍼트 2) 대비 가장 많이 잃은 곳은 ${names}입니다 (+${a.lost[a.worstAreas[0]]}타).`);
  } else {
    out.push('모든 영역이 기준 타수 안에 있습니다. 좋은 라운드입니다.');
  }
  if (a.threePutts) out.push(`3퍼트 이상이 ${a.threePutts}홀 있습니다. 첫 퍼트 거리감을 맞추면 바로 줄일 수 있는 타수입니다.`);
  if (t.ob) out.push(`OB ${t.ob}회로 벌타 ${t.ob}타가 더해졌습니다. 다시 친 샷까지 치면 OB 하나에 보통 2타를 잃습니다.`);
  if (t.mulligan) out.push(`멀리건 ${t.mulligan}회를 썼습니다. 멀리건 없이 쳤다면 스코어가 더 나왔을 수 있습니다.`);
  out.push(`그린 적중(GIR)은 ${a.girHoles}/${t.holes}홀 (${pct(a.girHoles, t.holes)}%)입니다.`);
  return out;
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
    ['OB', `${t.ob}회 (+${t.ob}타)`],
    ['멀리건', `${t.mulligan}회`],
  ];
  const maxDist = Math.max(...Object.values(a.distribution));
  const maxLost = Math.max(1, ...Object.values(a.lost));
  box.replaceChildren(
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
  );
}

/* ---------- everything ---------- */

function render(): void {
  const a = analyze(round);
  renderHole();
  renderTabs();
  renderSummary(a);
  renderScorecard(a);
  renderAnalysis(a);
  const [y, m, d] = round.date.split('-').map(Number);
  setText($('save-state'), saved
    ? `${y}년 ${m}월 ${d}일 라운드 · 이 기기에만 자동 저장됩니다.`
    : '이 브라우저에서는 저장할 수 없습니다. 새로고침하면 기록이 지워집니다.');
  $('stale').hidden = !stale;
  if (stale) setText($('stale-text'), `${y}년 ${m}월 ${d}일에 기록하던 라운드입니다.`);
}

function bind(): void {
  buildCounters();
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
  const startNew = () => {
    stale = false;
    clearRound();
    update(newRound());
    window.scrollTo({ top: 0 });
  };
  $('new-round').addEventListener('click', () => {
    if (confirm('지금 라운드 기록을 지우고 새로 시작할까요?')) startNew();
  });
  $('stale-new').addEventListener('click', startNew);
  $('stale-keep').addEventListener('click', () => {
    stale = false;
    render();
  });
  // Another tab of this tool saved the round: show that instead of overwriting it on the next tap.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    round = loadRound() ?? newRound();
    render();
  });
}

bind();
render();
