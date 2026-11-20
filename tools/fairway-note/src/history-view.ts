// The past rounds view: trends and the list, and one round read-only in a dialog it builds itself.
// renderHistory() mounts it into any container. It renders again when the history changes, never on a tap.
import { analyze, formatToPar, scoreName, type Analysis, type Round } from './round';
import { dateLabel, mailtoHref } from './report';
import {
  HISTORY_KEY,
  archiveRound,
  courseName,
  hasFinishedHole,
  hasRecord,
  loadHistory,
  newestFirst,
  preserveHistory,
  saveHistory,
  trends,
  withoutEntry,
  type Entry,
  type Trends,
} from './history';
import { h, setText } from './dom';

/** What the page lends the past rounds and backup views. */
export interface Page {
  /** The round being recorded. */
  current(): Round;
  /** Makes an imported round the one being recorded. */
  replace(next: Round): void;
  /** Scorecard tables and the total line, without links to holes. */
  scorecard(round: Round, a: Analysis): (Node | string)[];
  analysis(a: Analysis): (Node | string)[];
  /** Shares a round's report or copies it, writing the outcome into `status`. */
  share(round: Round, status: HTMLElement): Promise<void>;
  /** The share button's label, or null when the browser can neither share nor copy. */
  shareLabel: string | null;
}

const SVG = 'http://www.w3.org/2000/svg';

let page: Page | null = null;
let entries: Entry[] = [];
/** Whether the stored history could not all be read: its original is then kept aside ('kept') or could not be ('failed'). */
let unreadable: 'none' | 'kept' | 'failed' = 'none';
let started = false;
/** The mounted view, once renderHistory() has run. */
let view: { list: HTMLOListElement; trends: HTMLElement; note: HTMLElement; empty: HTMLElement; status: HTMLElement } | null = null;

/** No kept rounds yet: a small flag drawing and two calm lines. */
function emptyState(): HTMLElement {
  const box = h('div', { id: 'history-empty', class: 'hist-empty' });
  // Static markup: a flag on a little green, drawn from numbers only.
  box.innerHTML = '<svg viewBox="0 0 64 48" width="64" height="48" aria-hidden="true"><ellipse class="a-green-fill" cx="32" cy="40" rx="24" ry="6" stroke="none"/><ellipse class="a-cup" cx="34" cy="39" rx="3" ry="1.4"/><path class="a-pole-quiet" d="M34 39V8" stroke-width="2" stroke-linecap="round"/><path class="a-flag" d="M35 8c6-1 9 3 14 3-4 3-8 6-14 6z"/></svg>';
  box.append(h('p', { class: 'he-1' }, '아직 보관한 라운드가 없어요'), h('p', { class: 'he-2' }, '라운드를 마치고 "지난 라운드에 보관"을 누르면 여기에 쌓여요.'));
  return box;
}
/** The dialog for one past round, built on first use. */
let sheet: {
  dialog: HTMLDialogElement;
  title: HTMLElement;
  course: HTMLElement;
  scorecard: HTMLElement;
  analysis: HTMLElement;
  email: HTMLAnchorElement;
  share: HTMLButtonElement;
  status: HTMLElement;
} | null = null;
/** The past round open in the dialog. */
let shown: Entry | null = null;

const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** An average against par with one decimal: "+12.4", "E", "-0.6". */
function averageToPar(n: number): string {
  const v = Math.round(n * 10) / 10;
  if (v === 0) return 'E';
  return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
}

const toParClass = (toPar: number) => `topar score-${scoreName(Math.sign(toPar))}`;

function say(text: string): void {
  if (view) setText(view.status, text);
}

/* ---------- list and trends ---------- */

function item(e: Entry): HTMLLIElement {
  const a = analyze(e.round);
  const t = a.totals;
  const when = dateLabel(e.round.date);
  const where = courseName(e.round);
  const ob = t.ob ? `, OB ${t.ob}` : '';
  return h('li', {},
    h('button', {
      type: 'button',
      class: 'past-item',
      'data-id': e.id,
      'aria-label': `${when} ${where}, ${t.strokes}타 ${formatToPar(a.toPar)}, ${t.holes}홀, 퍼트 ${t.putts}${t.ob ? `, OB ${t.ob}` : ''}`,
    },
      h('span', { class: 'past-when' }, when),
      h('span', { class: 'past-score' }, `${t.strokes}타 `, h('span', { class: toParClass(a.toPar) }, formatToPar(a.toPar))),
      h('span', { class: 'past-where' }, where),
      h('span', { class: 'past-meta' }, `${t.holes}홀, 퍼트 ${t.putts}${ob}`),
    ),
  );
}

/** Strokes of the latest full rounds as a small line, oldest on the left; its values are in the label. */
function sparkline(series: number[]): HTMLElement {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const width = 100;
  const height = 32;
  const pad = 3;
  const x = (i: number) => (i / (series.length - 1)) * width;
  // More strokes sit higher, as on any chart; a falling line is a better score.
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - 2 * pad));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'spark-line');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', series.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' '));
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(line);
  return h('div', { class: 'spark', role: 'img', 'aria-label': `최근 ${series.length}라운드 타수: ${series.join(', ')}` },
    h('span', { class: 'spark-cap' }, `최근 ${series.length}라운드 타수`),
    h('div', { class: 'spark-row' }, h('span', {}, String(series[0])), svg, h('span', {}, String(series[series.length - 1]))),
  );
}

function renderTrends(box: HTMLElement, t: Trends): void {
  box.hidden = t.rounds === 0;
  if (!t.rounds) {
    box.replaceChildren();
    return;
  }
  const items: [string, string][] = [['라운드', t.full === t.rounds ? `${t.rounds}회` : `${t.rounds}회 (18홀 ${t.full}회)`]];
  if (t.all) {
    items.push(['평균 타수', `${one(t.all.strokes)} (${averageToPar(t.all.toPar)})`]);
    if (t.recent) items.push([`최근 ${t.recent.rounds}라운드`, `${one(t.recent.strokes)} (${averageToPar(t.recent.toPar)})`]);
    items.push(['라운드당 퍼트', `${one(t.all.putts)}개`], ['그린 적중', `${Math.round(t.all.gir)}%`], ['라운드당 OB', `${one(t.all.ob)}회`]);
  }
  const note = !t.all
    ? '18홀을 모두 끝낸 라운드가 생기면 평균이 나옵니다.'
    : t.full < t.rounds ? '평균은 18홀을 모두 끝낸 라운드로 냅니다.' : '';
  box.replaceChildren(h('dl', { class: 'metrics' }, ...items.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))));
  if (t.series.length >= 2) box.append(sparkline(t.series));
  if (note) box.append(h('p', { class: 'muted small trend-note' }, note));
}

function render(): void {
  if (!view) return;
  view.list.replaceChildren(...newestFirst(entries).map(item));
  view.empty.hidden = entries.length > 0;
  renderTrends(view.trends, trends(entries));
  view.note.hidden = unreadable === 'none';
  setText(view.note, unreadable === 'kept'
    ? '저장된 지난 라운드 중 읽을 수 없는 것이 있어 빼고 보여 줍니다. 원래 값은 이 기기에 따로 보관했습니다.'
    : unreadable === 'failed'
      ? '저장된 지난 라운드 중 읽을 수 없는 것이 있습니다. 원래 값을 따로 보관할 공간이 없어 지난 라운드를 바꾸지 않습니다.'
      : '');
}

/** Reads the history again after it changed here (a round kept, deleted or imported) or in another tab. */
export function refreshHistory(): void {
  entries = loadHistory();
  if (unreadable !== 'none') unreadable = preserveHistory();
  render();
}

/* ---------- one past round ---------- */

function buildSheet(): NonNullable<typeof sheet> {
  if (sheet) return sheet;
  const title = h('h2', { id: 'past-title' });
  const course = h('p', { id: 'past-course', class: 'muted' });
  const close = h('button', { id: 'past-close', class: 'btn', type: 'button' }, '닫기');
  const scorecard = h('div', { id: 'past-scorecard' });
  const analysis = h('div', { id: 'past-analysis' });
  const email = h('a', { id: 'past-email', class: 'btn primary', href: 'mailto:' }, '이메일로 보내기');
  const share = h('button', { id: 'past-share', class: 'btn', type: 'button' });
  const status = h('p', { id: 'past-status', class: 'muted small', role: 'status' });
  const remove = h('button', { id: 'past-delete', class: 'btn danger', type: 'button' }, '이 라운드 지우기');
  const dialog = h('dialog', { id: 'past', class: 'past', 'aria-labelledby': 'past-title' },
    h('div', { class: 'past-head' }, h('div', { class: 'past-heading' }, title, course), close),
    h('div', { class: 'past-body' },
      h('h3', {}, '스코어카드'), scorecard,
      h('h3', {}, '라운드 분석'), analysis,
      h('div', { class: 'send-actions past-send' }, email, share),
      status,
      remove,
    ),
  );
  close.addEventListener('click', () => dialog.close());
  // Closed by the button, Escape, or any other close request the browser sends to a modal dialog.
  dialog.addEventListener('close', () => {
    shown = null;
    document.documentElement.classList.remove('past-open');
  });
  remove.addEventListener('click', removeShown);
  share.addEventListener('click', () => {
    if (shown && page) void page.share(shown.round, status);
  });
  // A modal dialog sits in the top layer, so it can live at the end of the page whatever view mounts the list.
  document.body.append(dialog);
  sheet = { dialog, title, course, scorecard, analysis, email, share, status };
  return sheet;
}

function show(e: Entry): void {
  if (!page) return;
  const s = buildSheet();
  shown = e;
  const a = analyze(e.round);
  setText(s.title, `${dateLabel(e.round.date)} 라운드`);
  setText(s.course, courseName(e.round));
  s.scorecard.replaceChildren(...page.scorecard(e.round, a));
  s.analysis.replaceChildren(...page.analysis(a));
  s.email.href = mailtoHref(e.round);
  s.share.hidden = page.shareLabel === null;
  setText(s.share, page.shareLabel ?? '');
  setText(s.status, '');
  if (!s.dialog.open) {
    s.dialog.showModal();
    document.documentElement.classList.add('past-open');
  }
  s.dialog.scrollTop = 0;
}

function removeShown(): void {
  const e = shown;
  if (!e || !sheet) return;
  const t = analyze(e.round).totals;
  if (!confirm(`${dateLabel(e.round.date)} 라운드(${t.strokes}타)를 지난 라운드에서 지울까요? 백업 파일에 없으면 되돌릴 수 없습니다.`)) return;
  if (!saveHistory(withoutEntry(loadHistory(), e.id))) {
    setText(sheet.status, '지우지 못했습니다. 이 브라우저에서는 저장할 수 없습니다.');
    return;
  }
  sheet.dialog.close();
  refreshHistory();
  say(`${dateLabel(e.round.date)} 라운드를 지웠습니다.`);
}

/* ---------- for the page ---------- */

/** The question before a new round replaces this one; `name` is how the question calls it (the earlier-day picker names its date). */
export function newRoundQuestion(round: Round, name = '지금 라운드'): string {
  if (hasFinishedHole(round)) return `${name}를 지난 라운드에 보관하고 새로 시작할까요?`;
  if (hasRecord(round)) return `끝낸 홀이 없어 지난 라운드에 보관하지 않습니다. ${name}를 지우고 새로 시작할까요?`;
  return `${name} 기록을 지우고 새로 시작할까요?`;
}

/** Keeps a finished round among past rounds before a new one replaces it. False when it could not be kept and the player chose to keep it for now. */
export function keepBeforeNewRound(round: Round): boolean {
  const result = archiveRound(round);
  if (result === 'failed') {
    return confirm('지난 라운드에 보관하지 못했습니다(저장 공간이 부족하거나 이 브라우저에서는 저장할 수 없음). 그래도 새로 시작하면 지금 라운드는 지워집니다. 취소하고 "백업 파일 저장"으로 먼저 내보낼 수 있습니다.\n\n새로 시작할까요?');
  }
  if (result === 'kept') {
    refreshHistory();
    say(`${dateLabel(round.date)} 라운드를 지난 라운드에 보관했습니다.`);
  }
  return true;
}

function onStorage(event: StorageEvent): void {
  if (event.key !== HISTORY_KEY && event.key !== null) return;
  refreshHistory();
  if (shown && !entries.some((x) => x.id === shown!.id)) sheet?.dialog.close();
}

/** Mounts the past rounds view into `container`, replacing what it held. Calling it again moves the view. */
export function renderHistory(container: HTMLElement, p: Page): void {
  page = p;
  if (!started) {
    started = true;
    // A history this version cannot fully read is copied aside now, like the round key, so the note is true from the start.
    unreadable = preserveHistory();
    window.addEventListener('storage', onStorage);
  }
  const list = h('ol', { id: 'history-list', class: 'history-list', 'aria-label': '지난 라운드 목록' });
  list.addEventListener('click', (event) => {
    const id = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]')?.dataset.id;
    const e = entries.find((x) => x.id === id);
    if (e) show(e);
  });
  view = {
    list,
    trends: h('div', { id: 'history-trends', class: 'history-trends', hidden: '' }),
    note: h('p', { id: 'history-note', class: 'muted small', hidden: '' }),
    empty: emptyState(),
    status: h('p', { id: 'history-status', class: 'muted small', role: 'status' }),
  };
  container.setAttribute('aria-labelledby', 'history-title');
  container.replaceChildren(h('h2', { id: 'history-title' }, '지난 라운드'), view.note, view.trends, view.list, view.empty, view.status);
  refreshHistory();
}
