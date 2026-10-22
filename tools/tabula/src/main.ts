import './style.css';
import { createClient, type TabulaClient } from './client';
import { PAGE_SIZE, TabulaError, type Cell, type ColumnInfo, type FileSummary, type JsonValue, type Page } from './types';
import { download, exportName, toCsv, toJson } from './ui/export';
import { renderMeta } from './ui/meta-panel';
import { renderSchema, type SchemaTree } from './ui/schema-tree';
import { renderGrid } from './ui/table';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  welcome: $('welcome'),
  viewer: $('viewer'),
  dropZone: $('drop-zone'),
  fileInput: $<HTMLInputElement>('file-input'),
  fileBar: $('file-bar'),
  fileName: $('file-name'),
  fileMeta: $('file-meta'),
  bytes: $('bytes-read'),
  schema: $<HTMLUListElement>('schema'),
  schemaBox: $<HTMLDetailsElement>('schema-box'),
  schemaCount: $('schema-count'),
  schemaSearch: $<HTMLInputElement>('schema-search'),
  grid: $<HTMLTableElement>('grid'),
  empty: $('empty'),
  notice: $('notice'),
  range: $('page-range'),
  countRows: $<HTMLButtonElement>('count-rows'),
  prev: $<HTMLButtonElement>('prev'),
  next: $<HTMLButtonElement>('next'),
  goto: $<HTMLInputElement>('goto'),
  metaPanel: $('meta-panel'),
  metaBody: $('meta-body'),
  openMeta: $<HTMLButtonElement>('open-meta'),
  popover: $('cell-popover'),
  popoverTitle: $('popover-title'),
  progress: $('progress'),
  progressText: $('progress-text'),
  error: $('error-message'),
  status: $('status'),
};

const FORMAT_LABEL: Record<FileSummary['format'], string> = {
  parquet: 'Parquet',
  'arrow-file': 'Arrow IPC file',
  'arrow-stream': 'Arrow IPC stream',
  avro: 'Avro',
};

interface State {
  client: TabulaClient;
  file: File;
  summary: FileSummary;
  types: Map<string, string>;
  selected: string[];
  page: Page | null;
  rowCount: number | null;
  tree: SchemaTree;
}

let state: State | null = null;
const widths = new Map<string, number>();
let popoverCell: { cell: Cell; row: Cell[]; columns: string[] } | null = null;
let reloadTimer: number | undefined;

const fmtInt = (n: number) => n.toLocaleString('ko-KR');
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

function say(text: string): void {
  ui.status.textContent = text;
}

function showError(message: string): void {
  ui.error.textContent = message;
  ui.error.hidden = false;
  say(message);
}

function clearError(): void {
  ui.error.hidden = true;
  ui.error.textContent = '';
}

function errorText(e: unknown): string {
  if (e instanceof TabulaError) {
    if (e.code === 'corrupt') return `파일이 손상되었거나 끝까지 읽을 수 없습니다. ${e.message}`;
    return e.message;
  }
  return `예상하지 못한 문제가 생겼습니다: ${(e as Error)?.message ?? e}`;
}

/** 오래 걸리면(300ms 넘게) 진행 표시와 취소 버튼을 보여 준다. */
async function withProgress<T>(label: string, work: Promise<T>): Promise<T> {
  const timer = window.setTimeout(() => {
    ui.progressText.textContent = label;
    ui.progress.hidden = false;
  }, 300);
  try {
    return await work;
  } finally {
    clearTimeout(timer);
    ui.progress.hidden = true;
    updateBytes();
  }
}

function updateBytes(): void {
  if (!state) return;
  const read = state.client.bytesRead;
  const size = state.file.size;
  ui.bytes.dataset.bytes = String(read);
  const text = ui.bytes.querySelector('.bytes-text')!;
  text.replaceChildren(Object.assign(document.createElement('b'), { textContent: fmtBytes(read) }), ` 읽음 / ${fmtBytes(size)}`);
  const fill = ui.bytes.querySelector<HTMLElement>('.bytes-fill')!;
  fill.style.width = `${size > 0 ? Math.min(100, (read / size) * 100) : 0}%`;
}

function flattenTypes(cols: ColumnInfo[]): Map<string, string> {
  return new Map(cols.map((c) => [c.name, c.type]));
}

function closeFile(): void {
  if (state) state.client.dispose();
  state = null;
  window.clearTimeout(reloadTimer);
  closePopover();
  closeMeta();
  clearError();
  ui.viewer.hidden = true;
  ui.fileBar.hidden = true;
  ui.welcome.hidden = false;
  ui.progress.hidden = true;
  ui.grid.replaceChildren();
  document.title = 'Tabula — 데이터 파일 뷰어';
}

async function openFile(file: File): Promise<void> {
  closeFile();
  const client = createClient(() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
  say(`${file.name}을 여는 중`);
  let summary: FileSummary;
  try {
    summary = await withProgress('파일 구조를 읽는 중', client.open(file));
  } catch (e) {
    client.dispose();
    if (e instanceof TabulaError && e.code === 'cancelled') return;
    showError(errorText(e));
    return;
  }
  const selected = summary.suggestedColumns;
  const tree = renderSchema(ui.schema, summary.columns, selected, (names) => {
    if (!state) return;
    state.selected = names;
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => void loadPage(state?.page?.start ?? 0), 200);
  });
  state = { client, file, summary, types: flattenTypes(summary.columns), selected, page: null, rowCount: summary.rowCount, tree };
  widths.clear();
  ui.schemaSearch.value = '';
  ui.schemaCount.textContent = `${summary.columns.length}개`;
  ui.schemaBox.open = window.matchMedia('(min-width: 761px)').matches;
  ui.fileName.textContent = file.name;
  ui.fileName.title = file.name;
  ui.fileMeta.textContent = [FORMAT_LABEL[summary.format], fmtBytes(file.size), summary.codec].filter(Boolean).join(', ');
  ui.notice.textContent = summary.notice ?? '';
  ui.notice.hidden = !summary.notice;
  renderMeta(ui.metaBody, summary.metadata);
  ui.welcome.hidden = true;
  ui.viewer.hidden = false;
  ui.fileBar.hidden = false;
  document.title = `${file.name} — Tabula`;
  updateBytes();
  await loadPage(0);
}

async function loadPage(start: number): Promise<void> {
  const s = state;
  if (!s) return;
  if (s.rowCount !== null) start = Math.min(start, Math.max(0, s.rowCount - 1));
  start = Math.max(0, start);
  if (s.selected.length === 0) {
    s.page = { start, columns: [], rows: [], eof: s.page?.eof ?? false };
    ui.grid.replaceChildren();
    ui.empty.textContent = '볼 컬럼을 왼쪽에서 하나 이상 고르세요.';
    ui.empty.hidden = false;
    say('볼 컬럼을 하나 이상 고르세요.');
    updatePager();
    return;
  }
  clearError();
  let page: Page;
  try {
    page = await withProgress(`${fmtInt(start + 1)}번째 행을 찾는 중`, s.client.page(start, PAGE_SIZE, s.selected));
  } catch (e) {
    if (state !== s) return;
    if (e instanceof TabulaError && e.code === 'cancelled') {
      say('취소했습니다.');
      return;
    }
    showError(errorText(e));
    return;
  }
  if (state !== s) return;
  s.page = page;
  if (page.eof && s.rowCount === null) s.rowCount = page.start + page.rows.length;
  if (page.rows.length === 0 && page.start > 0) {
    // 끝을 지나쳤다: 마지막 페이지로
    const last = s.rowCount !== null ? Math.max(0, s.rowCount - PAGE_SIZE) : 0;
    if (last !== page.start) return loadPage(last);
  }
  ui.empty.hidden = page.rows.length > 0;
  ui.empty.textContent = page.rows.length === 0 ? '이 파일에는 행이 없습니다.' : '';
  renderGrid(ui.grid, page, { types: s.types, widths, onCell: openPopover });
  updatePager();
  say(`${fmtInt(page.start + 1)}–${fmtInt(page.start + page.rows.length)}행을 표시했습니다.`);
}

function updatePager(): void {
  const s = state;
  if (!s || !s.page) return;
  const { start, rows } = s.page;
  const shown = rows.length;
  const total = s.rowCount === null ? '?' : fmtInt(s.rowCount);
  ui.range.textContent = shown > 0 ? `${fmtInt(start + 1)}–${fmtInt(start + shown)} / ${total}` : `0 / ${total}`;
  ui.countRows.hidden = s.rowCount !== null;
  ui.prev.disabled = start === 0;
  ui.next.disabled = s.page.eof || (s.rowCount !== null && start + PAGE_SIZE >= s.rowCount) || s.selected.length === 0;
  ui.goto.max = s.rowCount !== null ? String(s.rowCount) : '';
}

async function countRows(): Promise<void> {
  const s = state;
  if (!s) return;
  ui.countRows.disabled = true;
  try {
    const n = await withProgress('행을 세는 중', s.client.count((rows) => {
      ui.progressText.textContent = `행을 세는 중: ${fmtInt(rows)}`;
      updateBytes();
    }));
    if (state !== s) return;
    s.rowCount = n;
    updatePager();
    say(`전체 ${fmtInt(n)}행입니다.`);
  } catch (e) {
    if (state !== s) return;
    if (!(e instanceof TabulaError && e.code === 'cancelled')) showError(errorText(e));
  } finally {
    ui.countRows.disabled = false;
  }
}

// ---------- 셀 팝오버 ----------

function openPopover(cell: Cell, row: Cell[], column: string, anchor: HTMLElement): void {
  const s = state;
  if (!s?.page) return;
  popoverCell = { cell, row, columns: s.page.columns };
  ui.popoverTitle.textContent = column;
  ui.popover.querySelector('pre')!.textContent = cell.full;
  ui.popover.hidden = false;
  const r = anchor.getBoundingClientRect();
  const box = ui.popover.getBoundingClientRect();
  const left = Math.min(Math.max(12, r.left), window.innerWidth - box.width - 12);
  const below = r.bottom + 6;
  const top = below + box.height > window.innerHeight - 12 ? Math.max(12, r.top - box.height - 6) : below;
  ui.popover.style.left = `${left}px`;
  ui.popover.style.top = `${top}px`;
  $('close-popover').focus();
}

function closePopover(): void {
  ui.popover.hidden = true;
  popoverCell = null;
}

async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    say('클립보드에 복사하지 못했습니다.');
  }
}

// ---------- 메타데이터 서랍 ----------

function openMeta(): void {
  ui.metaPanel.hidden = false;
  ui.openMeta.setAttribute('aria-expanded', 'true');
  $('close-meta').focus();
}

function closeMeta(): void {
  ui.metaPanel.hidden = true;
  ui.openMeta.setAttribute('aria-expanded', 'false');
}

// ---------- 연결 ----------

// 머리 높이는 파일 이름 길이와 화면 폭에 따라 달라진다. 뷰어 높이와 서랍 위치가 이 값을 쓴다.
const header = document.querySelector<HTMLElement>('.top')!;
new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`)).observe(header);

const pickFile = () => ui.fileInput.click();
$('choose-file').addEventListener('click', pickFile);
$('open-other').addEventListener('click', pickFile);
$('close-file').addEventListener('click', closeFile);
ui.fileInput.addEventListener('change', () => {
  const file = ui.fileInput.files?.[0];
  ui.fileInput.value = '';
  if (file) void openFile(file);
});

$('try-sample').addEventListener('click', async () => {
  try {
    const res = await fetch('./sample/sample.parquet');
    if (!res.ok) throw new Error(String(res.status));
    void openFile(new File([await res.blob()], 'sample-events.parquet'));
  } catch {
    showError('샘플 파일을 불러오지 못했습니다.');
  }
});

for (const target of [ui.dropZone, document.body]) {
  target.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    ui.dropZone.classList.add('over');
  });
  target.addEventListener('dragleave', () => ui.dropZone.classList.remove('over'));
  target.addEventListener('drop', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ui.dropZone.classList.remove('over');
    const file = (ev as DragEvent).dataTransfer?.files[0];
    if (file) void openFile(file);
  });
}

ui.prev.addEventListener('click', () => void loadPage((state?.page?.start ?? 0) - PAGE_SIZE));
ui.next.addEventListener('click', () => void loadPage((state?.page?.start ?? 0) + PAGE_SIZE));
ui.goto.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  const n = Number(ui.goto.value);
  if (Number.isInteger(n) && n >= 1) void loadPage(n - 1);
});
ui.countRows.addEventListener('click', () => void countRows());
$('cancel-progress').addEventListener('click', () => state?.client.cancel());

ui.schemaSearch.addEventListener('input', () => state?.tree.filter(ui.schemaSearch.value));
$('select-all').addEventListener('click', () => {
  if (!state) return;
  state.selected = state.summary.columns.map((c) => c.name);
  state.tree.setSelected(state.selected);
  void loadPage(state.page?.start ?? 0);
});
$('select-none').addEventListener('click', () => {
  if (!state) return;
  state.selected = [];
  state.tree.setSelected([]);
  void loadPage(state.page?.start ?? 0);
});

ui.openMeta.addEventListener('click', () => (ui.metaPanel.hidden ? openMeta() : closeMeta()));
$('close-meta').addEventListener('click', closeMeta);
$('close-popover').addEventListener('click', closePopover);
$('copy-cell').addEventListener('click', () => popoverCell && void copy(popoverCell.cell.full, '값을 복사했습니다.'));
$('copy-row').addEventListener('click', () => {
  if (!popoverCell) return;
  const { row, columns } = popoverCell;
  const obj = Object.fromEntries(row.map((c, i): [string, JsonValue] => [columns[i], c.json]));
  void copy(JSON.stringify(obj, null, 2), '행을 JSON으로 복사했습니다.');
});
document.addEventListener('pointerdown', (ev) => {
  if (!ui.popover.hidden && !ui.popover.contains(ev.target as Node) && !(ev.target as HTMLElement).closest('#grid td')) closePopover();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (!ui.popover.hidden) closePopover();
  else if (!ui.metaPanel.hidden) closeMeta();
});

$('export-csv').addEventListener('click', () => {
  const p = state?.page;
  if (!state || !p || p.rows.length === 0) return;
  download(exportName(state.file.name, p.start, p.rows.length, 'csv'), toCsv(p), 'text/csv;charset=utf-8');
});
$('export-json').addEventListener('click', () => {
  const p = state?.page;
  if (!state || !p || p.rows.length === 0) return;
  download(exportName(state.file.name, p.start, p.rows.length, 'json'), toJson(p), 'application/json');
});
