// The backup view: save or share one file with every round, and import one. renderBackup() mounts it into any container.
// The file goes only where the player saves or shares it; nothing is sent.
import { analyze, localDate, type Round } from './round';
import { persistenceState, saveBackupMark } from './storage';
import { dateLabel, historyCsv } from './report';
import { hasFinishedHole, hasRecord, loadHistory, saveHistory } from './history';
import { MAX_BACKUP_BYTES, backupName, backupOf, backupText, parseBackup, planImport, settleImport } from './backup';
import { refreshHistory, type Page } from './history-view';
import { loadMyCourses, mergeMyCourses, saveMyCourses } from './my-courses';
import { h, setText } from './dom';

type BackupPage = Pick<Page, 'current' | 'replace'>;

const BACKUP_TYPE = 'application/json';

let page: BackupPage | null = null;
let status: HTMLElement | null = null;

function say(text: string): void {
  if (status) setText(status, text);
}

let view: HTMLElement | null = null;

/** v43: remembers the backup (date and kept rounds) and tells the page, whose menu line says when it was. */
function saved(): void {
  saveBackupMark({ at: localDate(), rounds: loadHistory().length });
  view?.dispatchEvent(new Event('backup-saved'));
}

/** Opened from the home screen: the browser counts its storage apart from the browser's own (WebKit). */
const fromHomeScreen = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** v43: from the home screen, whether the browser keeps this site's storage; hidden in a browser tab. */
async function showKeep(line: HTMLElement): Promise<void> {
  if (!fromHomeScreen()) return;
  const kept = await persistenceState();
  if (kept === null) return;
  setText(line, kept ? '이 폰이 기록을 지우지 않도록 요청했어요.' : '브라우저가 오래 쓰지 않은 기록을 정리할 수 있어요. 백업 파일을 저장해 두세요.');
  line.hidden = false;
}

function fileText(p: BackupPage): string {
  return backupText(backupOf(p.current(), loadHistory(), new Date(), loadMyCourses()));
}

/** Downloads the backup. */
function saveFile(): void {
  if (!page) return;
  const name = backupName();
  const url = URL.createObjectURL(new Blob([fileText(page)], { type: BACKUP_TYPE }));
  const link = h('a', { href: url, download: name, hidden: '' });
  document.body.append(link);
  link.click();
  link.remove();
  // The download keeps its own copy; the URL only has to outlive the click.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  saved();
  say(`백업 파일을 만들었어요 (${name}). 새 기기에서는 "백업 파일 가져오기"로 불러오세요.`);
}

/** v44: every kept round as a CSV (BOM so Excel reads Korean), named by today's date. */
function saveCsv(): void {
  const name = `fairway-note-rounds-${localDate()}.csv`;
  const url = URL.createObjectURL(new Blob(['\uFEFF', historyCsv(loadHistory())], { type: 'text/csv;charset=utf-8' }));
  const link = h('a', { href: url, download: name, hidden: '' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  say(`모든 라운드를 CSV 파일로 만들었어요 (${name}). 엑셀이나 구글 시트에서 열 수 있어요.`);
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
  if (!page) return;
  const file = new File([fileText(page)], backupName(), { type: BACKUP_TYPE });
  try {
    await navigator.share({ files: [file], title: 'Fairway Note 백업' });
    saved();
    say('백업 파일을 공유했어요.');
  } catch (error) {
    if ((error as DOMException).name !== 'AbortError') say('공유하지 못했어요. "백업 파일 저장"을 써 주세요.');
  }
}

function pendingQuestion(pending: Round, current: Round): string {
  const t = analyze(pending).totals;
  const what = t.holes ? `${t.holes}홀 ${t.strokes}타` : '끝낸 홀 없음';
  const now = hasFinishedHole(current)
    ? ' 지금 라운드는 지난 라운드에 보관해요.'
    : hasRecord(current) ? ' 지금 라운드는 끝낸 홀이 없어 지워져요.' : '';
  const no = hasFinishedHole(pending) ? '이 라운드를 지난 라운드에 넣어요.' : '이 라운드는 불러오지 않아요.';
  return `백업 파일에 진행 중이던 라운드가 있어요 (${dateLabel(pending.date)}, ${what}).\n\n확인: 이 라운드를 지금 라운드로 불러와요.${now}\n취소: ${no}`;
}

function importText(p: BackupPage, text: string): void {
  const read = parseBackup(text);
  if (!read.ok) {
    say(read.error === 'newer'
      ? '더 새 버전의 Fairway Note가 만든 백업 파일이에요. 페이지를 새로고침해 새 버전을 받은 뒤 다시 가져와 주세요.'
      : 'Fairway Note 백업 파일이 아니에요. "백업 파일 저장"으로 만든 .json 파일을 골라 주세요.');
    return;
  }
  const before = loadHistory();
  const current = p.current();
  const plan = planImport(before, current, read);
  // Merging past rounds only adds; the round being recorded changes only on the player's yes.
  const replace = plan.pending !== null && confirm(pendingQuestion(plan.pending, current));
  const done = settleImport(plan, current, replace);
  if (done.entries.length !== before.length && !saveHistory(done.entries)) {
    say('저장할 공간이 없거나 이 브라우저에서는 저장할 수 없어 가져오지 못했어요.');
    return;
  }
  refreshHistory();
  if (done.round) p.replace(done.round);
  const parts = [plan.imported ? `지난 라운드 ${plan.imported}개를 가져왔어요.` : '가져온 지난 라운드는 없어요.'];
  if (plan.pending) {
    parts.push(replace
      ? '진행 중이던 라운드를 지금 라운드로 불러왔어요.'
      : done.imported > plan.imported ? '진행 중이던 라운드는 지난 라운드에 넣었어요.' : '진행 중이던 라운드는 끝낸 홀이 없어 넣지 않았어요.');
  }
  // 내 코스 (v45): added beside the rounds; the same course is not added twice.
  if (read.courses?.length) {
    const mine = mergeMyCourses(loadMyCourses(), read.courses);
    if (mine.imported && saveMyCourses(mine.courses)) parts.push(`내 코스 ${mine.imported}개를 가져왔어요.`);
  }
  if (plan.skipped) parts.push(`이미 있는 ${plan.skipped}개는 건너뛰었어요.`);
  if (plan.invalid) parts.push(`읽을 수 없는 ${plan.invalid}개는 넣지 않았어요.`);
  say(parts.join(' '));
}

async function importFile(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  if (!file || !page) return;
  try {
    if (file.size > MAX_BACKUP_BYTES) {
      say('파일이 너무 커요. Fairway Note 백업 파일을 골라 주세요.');
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      say('파일을 읽지 못했어요.');
      return;
    }
    importText(page, text);
  } finally {
    // Lets the same file be picked again.
    input.value = '';
  }
}

/** Mounts the backup view into `container`, replacing what it held. Calling it again moves the view. */
export function renderBackup(container: HTMLElement, p: BackupPage): void {
  page = p;
  const save = h('button', { id: 'backup-save', class: 'btn', type: 'button' }, '백업 파일 저장');
  const load = h('button', { id: 'backup-import', class: 'btn', type: 'button' }, '백업 파일 가져오기');
  const share = h('button', { id: 'backup-share', class: 'btn', type: 'button' }, '백업 파일 공유');
  // v44: every kept round as one spreadsheet file, beside the backup.
  const csv = h('button', { id: 'backup-csv', class: 'btn', type: 'button' }, '모든 라운드 CSV 저장');
  csv.addEventListener('click', saveCsv);
  const input = h('input', { id: 'backup-file', type: 'file', accept: 'application/json,.json', hidden: '' });
  status = h('p', { id: 'backup-status', class: 'muted small', role: 'status' });
  share.hidden = !canShareFiles();
  save.addEventListener('click', saveFile);
  share.addEventListener('click', () => void shareFile());
  load.addEventListener('click', () => input.click());
  input.addEventListener('change', () => void importFile(input));
  // v43: what the file holds (backup.ts: the course, date and holes of each round; no name or contact), and from the
  // home screen whether the browser keeps the storage.
  const what = h('p', { id: 'backup-what', class: 'muted small' }, '백업 파일에는 코스·날짜·홀별 기록만 들어가요. 이름이나 연락처는 없어요.');
  const keep = h('p', { id: 'backup-keep', class: 'muted small', hidden: '' });
  view = container;
  container.setAttribute('aria-labelledby', 'backup-title');
  container.replaceChildren(
    h('h2', { id: 'backup-title' }, '백업'),
    h('p', { class: 'muted small' }, '모든 라운드를 파일 하나로 저장해요. 폰을 바꾸면 새 폰에서 가져오세요. 파일은 저장한 곳에만 있어요.'),
    h('div', { class: 'backup-actions' }, save, load, share, csv),
    input,
    status,
    what,
    keep,
  );
  void showKeep(keep);
}
