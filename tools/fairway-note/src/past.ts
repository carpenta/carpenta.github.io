// Past rounds: trends and the list, one round read-only in a dialog, and the backup file.
// Rendered when the history changes, never on a tap, so recording a stroke costs the same as before.
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
import { MAX_BACKUP_BYTES, backupName, backupOf, backupText, parseBackup, planImport, settleImport } from './backup';
import { $, h, setText } from './dom';

/** What the page lends this section. */
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

const BACKUP_TYPE = 'application/json';
const SVG = 'http://www.w3.org/2000/svg';

let page: Page;
let entries: Entry[] = [];
/** Whether the stored history could not all be read: its original is then kept aside ('kept') or could not be ('failed'). */
let unreadable: 'none' | 'kept' | 'failed' = 'none';
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
  setText($('history-status'), text);
}

/* ---------- list and trends ---------- */

function item(e: Entry): HTMLLIElement {
  const a = analyze(e.round);
  const t = a.totals;
  const when = dateLabel(e.round.date);
  const where = courseName(e.round);
  const ob = t.ob ? ` · OB ${t.ob}` : '';
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
      h('span', { class: 'past-meta' }, `${t.holes}홀 · 퍼트 ${t.putts}${ob}`),
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

function renderTrends(t: Trends): void {
  const box = $('history-trends');
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
  $('history-list').replaceChildren(...newestFirst(entries).map(item));
  $('history-empty').hidden = entries.length > 0;
  renderTrends(trends(entries));
  const note = $('history-note');
  note.hidden = unreadable === 'none';
  setText(note, unreadable === 'kept'
    ? '저장된 지난 라운드 중 읽을 수 없는 것이 있어 빼고 보여 줍니다. 원래 값은 이 기기에 따로 보관했습니다.'
    : unreadable === 'failed'
      ? '저장된 지난 라운드 중 읽을 수 없는 것이 있습니다. 원래 값을 따로 보관할 공간이 없어 지난 라운드를 바꾸지 않습니다.'
      : '');
}

/** Reads the history again after it changed here or in another tab. */
function refresh(): void {
  entries = loadHistory();
  if (unreadable !== 'none') unreadable = preserveHistory();
  render();
}

/* ---------- one past round ---------- */

function show(e: Entry): void {
  shown = e;
  const a = analyze(e.round);
  setText($('past-title'), `${dateLabel(e.round.date)} 라운드`);
  setText($('past-course'), courseName(e.round));
  $('past-scorecard').replaceChildren(...page.scorecard(e.round, a));
  $('past-analysis').replaceChildren(...page.analysis(a));
  $<HTMLAnchorElement>('past-email').href = mailtoHref(e.round);
  setText($('past-status'), '');
  const dialog = $<HTMLDialogElement>('past');
  if (!dialog.open) {
    dialog.showModal();
    document.documentElement.classList.add('past-open');
  }
  dialog.scrollTop = 0;
}

function removeShown(): void {
  const e = shown;
  if (!e) return;
  const t = analyze(e.round).totals;
  if (!confirm(`${dateLabel(e.round.date)} 라운드(${t.strokes}타)를 지난 라운드에서 지울까요? 백업 파일에 없으면 되돌릴 수 없습니다.`)) return;
  if (!saveHistory(withoutEntry(loadHistory(), e.id))) {
    setText($('past-status'), '지우지 못했습니다. 이 브라우저에서는 저장할 수 없습니다.');
    return;
  }
  $<HTMLDialogElement>('past').close();
  refresh();
  say(`${dateLabel(e.round.date)} 라운드를 지웠습니다.`);
}

/* ---------- backup file ---------- */

function backupFileText(): string {
  return backupText(backupOf(page.current(), loadHistory()));
}

/** Downloads the backup. The file goes only where the browser saves downloads; nothing is sent. */
function saveFile(): void {
  const name = backupName();
  const url = URL.createObjectURL(new Blob([backupFileText()], { type: BACKUP_TYPE }));
  const link = h('a', { href: url, download: name, hidden: '' });
  document.body.append(link);
  link.click();
  link.remove();
  // The download keeps its own copy; the URL only has to outlive the click.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  say(`백업 파일을 만들었습니다 (${name}). 새 기기에서는 "백업 파일 가져오기"로 불러오세요.`);
}

function canShareFiles(): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['{}'], 'fairway-note-backup.json', { type: BACKUP_TYPE })] });
  } catch {
    return false;
  }
}

/** Hands the backup to the phone's share sheet (messenger, mail, drive), where the browser can share files. */
async function shareFile(): Promise<void> {
  const file = new File([backupFileText()], backupName(), { type: BACKUP_TYPE });
  try {
    await navigator.share({ files: [file], title: 'Fairway Note 백업' });
    say('백업 파일을 공유했습니다.');
  } catch (error) {
    if ((error as DOMException).name !== 'AbortError') say('공유하지 못했습니다. "백업 파일 저장"을 써 주세요.');
  }
}

function pendingQuestion(pending: Round, current: Round): string {
  const t = analyze(pending).totals;
  const what = t.holes ? `${t.holes}홀 ${t.strokes}타` : '끝낸 홀 없음';
  const now = hasFinishedHole(current)
    ? ' 지금 라운드는 지난 라운드에 보관합니다.'
    : hasRecord(current) ? ' 지금 라운드는 끝낸 홀이 없어 지워집니다.' : '';
  const no = hasFinishedHole(pending) ? '이 라운드를 지난 라운드에 넣습니다.' : '이 라운드는 불러오지 않습니다.';
  return `백업 파일에 진행 중이던 라운드가 있습니다 (${dateLabel(pending.date)}, ${what}).\n\n확인: 이 라운드를 지금 라운드로 불러옵니다.${now}\n취소: ${no}`;
}

function importText(text: string): void {
  const read = parseBackup(text);
  if (!read.ok) {
    say(read.error === 'newer'
      ? '더 새 버전의 Fairway Note가 만든 백업 파일입니다. 페이지를 새로고침해 새 버전을 받은 뒤 다시 가져와 주세요.'
      : 'Fairway Note 백업 파일이 아닙니다. "백업 파일 저장"으로 만든 .json 파일을 골라 주세요.');
    return;
  }
  const before = loadHistory();
  const current = page.current();
  const plan = planImport(before, current, read);
  // Merging past rounds only adds; the round being recorded changes only on the player's yes.
  const replace = plan.pending !== null && confirm(pendingQuestion(plan.pending, current));
  const done = settleImport(plan, current, replace);
  if (done.entries.length !== before.length && !saveHistory(done.entries)) {
    say('저장할 공간이 없거나 이 브라우저에서는 저장할 수 없어 가져오지 못했습니다.');
    return;
  }
  refresh();
  if (done.round) page.replace(done.round);
  const parts = [plan.imported ? `지난 라운드 ${plan.imported}개를 가져왔습니다.` : '가져온 지난 라운드는 없습니다.'];
  if (plan.pending) {
    parts.push(replace
      ? '진행 중이던 라운드를 지금 라운드로 불러왔습니다.'
      : done.imported > plan.imported ? '진행 중이던 라운드는 지난 라운드에 넣었습니다.' : '진행 중이던 라운드는 끝낸 홀이 없어 넣지 않았습니다.');
  }
  if (plan.skipped) parts.push(`이미 있는 ${plan.skipped}개는 건너뛰었습니다.`);
  if (plan.invalid) parts.push(`읽을 수 없는 ${plan.invalid}개는 넣지 않았습니다.`);
  say(parts.join(' '));
}

async function importFile(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_BYTES) {
      say('파일이 너무 큽니다. Fairway Note 백업 파일을 골라 주세요.');
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      say('파일을 읽지 못했습니다.');
      return;
    }
    importText(text);
  } finally {
    // Lets the same file be picked again.
    input.value = '';
  }
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
    refresh();
    say(`${dateLabel(round.date)} 라운드를 지난 라운드에 보관했습니다.`);
  }
  return true;
}

function bind(): void {
  $('history-list').addEventListener('click', (event) => {
    const id = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]')?.dataset.id;
    const e = entries.find((x) => x.id === id);
    if (e) show(e);
  });
  const dialog = $<HTMLDialogElement>('past');
  $('past-close').addEventListener('click', () => dialog.close());
  // Closed by the button, Escape or the phone's back gesture.
  dialog.addEventListener('close', () => {
    shown = null;
    document.documentElement.classList.remove('past-open');
  });
  $('past-delete').addEventListener('click', removeShown);
  const share = $<HTMLButtonElement>('past-share');
  share.hidden = page.shareLabel === null;
  setText(share, page.shareLabel ?? '');
  share.addEventListener('click', () => {
    if (shown) void page.share(shown.round, $('past-status'));
  });

  $('backup-save').addEventListener('click', saveFile);
  const shareFileButton = $<HTMLButtonElement>('backup-share');
  shareFileButton.hidden = !canShareFiles();
  shareFileButton.addEventListener('click', () => void shareFile());
  const input = $<HTMLInputElement>('backup-file');
  $('backup-import').addEventListener('click', () => input.click());
  input.addEventListener('change', () => void importFile(input));

  // Another tab kept, imported or deleted a round.
  window.addEventListener('storage', (event) => {
    if (event.key !== HISTORY_KEY && event.key !== null) return;
    refresh();
    if (shown && !entries.some((x) => x.id === shown!.id)) dialog.close();
  });
}

export function initHistory(p: Page): void {
  page = p;
  // A history this version cannot fully read is copied aside now, like the round key, so the note is true from the start.
  unreadable = preserveHistory();
  entries = loadHistory();
  bind();
  render();
}
