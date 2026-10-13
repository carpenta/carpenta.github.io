import type { XlsxStyles } from './xlsx-styles';
import type { DocumentInfo, Format, RenderedPage, WorkerRequest, WorkerResponse } from './types';

type PageState =
  | PptxState
  | HwpState
  | XlsxState;

type PptxState = {
  kind: 'pptx';
  presentation: unknown;
  slides: readonly unknown[];
  renderSlideToSvg: (presentation: unknown, slide: unknown, options: { textLayout: 'svg' }) => string;
  size: { width: number; height: number };
};

type HwpState = {
  kind: 'hwp' | 'hwpx';
  viewer: {
    free(): void;
    pageCount(): number;
    renderPageSvg(page: number): string;
  };
  count: number;
};

type XlsxCell = {
  v?: unknown;
  w?: string;
  t?: string;
  z?: string;
};

type XlsxMerge = { s: { r: number; c: number }; e: { r: number; c: number } };

type XlsxSheet = Record<string, unknown> & {
  '!ref'?: string;
  '!merges'?: XlsxMerge[];
};

type XlsxUtils = {
  decode_range(ref: string): { s: { r: number; c: number }; e: { r: number; c: number } };
  encode_cell(cell: { r: number; c: number }): string;
};

type XlsxState = {
  kind: 'xlsx';
  formatting?: XlsxStyles;
  formatCell: (cell: XlsxCell) => string;
  sheets: Array<{ name: string; sheet: XlsxSheet; warning?: string }>;
  utils: XlsxUtils;
  warning?: string;
};

const MAX_PAGES = 500;
const MAX_XLSX_ROWS = 1000;
const MAX_XLSX_COLS = 100;
const MAX_XLSX_CELLS = 30000;
const DEFAULT_SLIDE_SIZE = { width: 1280, height: 720 };

let state: PageState | null = null;
let hwpRuntimeReady: Promise<void> | null = null;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void handleMessage(event.data);
};

async function handleMessage(request: WorkerRequest): Promise<void> {
  try {
    if (request.type === 'open') {
      await openDocument(request.buffer, request.format, request.xlsxStyles);
      return;
    }

    renderPage(request.index, request.requestId);
  } catch (error) {
    post({ type: 'error', message: koreanError(error), requestId: request.type === 'page' ? request.requestId : undefined });
  }
}

async function openDocument(buffer: ArrayBuffer, format: Exclude<Format, 'docx'>, formatting?: XlsxStyles): Promise<void> {
  disposeState();

  if (format === 'pptx') {
    state = await openPptx(buffer);
  } else if (format === 'xlsx') {
    state = await openXlsx(buffer);
    state.formatting = formatting;
  } else {
    state = await openHwp(buffer, format);
  }

  post({ type: 'ready', info: infoForState(state) });
}

async function openPptx(buffer: ArrayBuffer): Promise<PptxState> {
  const [{ loadPresentation, getSlides, getSlideSize }, { renderSlideToSvg }] = await Promise.all([
    import('@office-kit/pptx'),
    import('@office-kit/pptx-preview'),
  ]);

  const presentation = await loadPresentation(buffer);
  const slides = getSlides(presentation).slice(0, MAX_PAGES);
  const rawSize = getSlideSize(presentation);
  const size = rawSize
    ? { width: emuToPx(Number(rawSize.width)), height: emuToPx(Number(rawSize.height)) }
    : DEFAULT_SLIDE_SIZE;

  return {
    kind: 'pptx',
    presentation,
    slides,
    renderSlideToSvg: renderSlideToSvg as PptxState['renderSlideToSvg'],
    size,
  };
}

async function openHwp(buffer: ArrayBuffer, format: 'hwp' | 'hwpx'): Promise<HwpState> {
  installWorkerCanvasDocument();

  const core = await import('@rhwp/core');
  await ensureHwpRuntime(core);

  const document = core.HwpDocument.openWithPassword(new Uint8Array(buffer), '');
  const viewer = new core.HwpViewer(document);
  const count = Math.min(viewer.pageCount(), MAX_PAGES);

  return { kind: format, viewer, count };
}

async function ensureHwpRuntime(core: typeof import('@rhwp/core')): Promise<void> {
  hwpRuntimeReady ??= (async () => {
    const wasm = await import('@rhwp/core/rhwp_bg.wasm?url');
    await core.default({ module_or_path: wasm.default });
    core.init_panic_hook();
  })();

  await hwpRuntimeReady;
}

async function openXlsx(buffer: ArrayBuffer): Promise<XlsxState> {
  const xlsx = await import('xlsx');
  const workbook = xlsx.read(buffer, {
    type: 'array',
    cellFormula: true,
    cellNF: true,
    cellHTML: false,
    cellText: true,
    dense: false,
    sheetRows: MAX_XLSX_ROWS + 1,
  });

  const { recalculateWorkbook } = await import('./formula-calculation');
  const calculation = recalculateWorkbook(workbook, { parsedRowLimit: MAX_XLSX_ROWS + 1 });
  const sheetNames = workbook.SheetNames.slice(0, MAX_PAGES);
  const sheets = sheetNames.map((name) => {
    const sheet = workbook.Sheets[name] as XlsxSheet;
    return { name, sheet, warning: sheetWarning(sheet, xlsx.utils as XlsxUtils) };
  });

  return {
    kind: 'xlsx',
    formatCell: cell => xlsx.utils.format_cell(cell as import('xlsx').CellObject),
    sheets,
    utils: xlsx.utils as XlsxUtils,
    warning: [calculation.calculated ? `수식 ${calculation.calculated}개를 재계산했습니다.` : '', calculation.warning, workbook.SheetNames.length > MAX_PAGES ? `시트가 ${MAX_PAGES}개를 넘어 앞 ${MAX_PAGES}개만 표시합니다.` : ''].filter(Boolean).join(' ') || undefined,
  };
}

function renderPage(index: number, requestId?: string): void {
  if (!state) {
    throw new Error('먼저 파일을 열어야 합니다.');
  }

  assertPageIndex(index, pageCount(state));

  if (state.kind === 'pptx') {
    const svg = state.renderSlideToSvg(state.presentation, state.slides[index], { textLayout: 'svg' });
    post({ type: 'page', index, requestId, page: svgPage(svg, state.size) });
    return;
  }

  if (state.kind === 'hwp' || state.kind === 'hwpx') {
    const svg = state.viewer.renderPageSvg(index);
    post({ type: 'page', index, requestId, page: svgPage(svg) });
    return;
  }

  if (state.kind === 'xlsx') {
    post({ type: 'page', index, requestId, page: renderSheet(state, index) });
  }
}

function infoForState(nextState: PageState): DocumentInfo {
  if (nextState.kind === 'pptx') {
    return {
      count: nextState.slides.length,
      labels: nextState.slides.map((_, index) => `슬라이드 ${index + 1}`),
    };
  }

  if (nextState.kind === 'hwp' || nextState.kind === 'hwpx') {
    return {
      count: nextState.count,
      labels: Array.from({ length: nextState.count }, (_, index) => `${index + 1}쪽`),
      warning: nextState.count >= MAX_PAGES ? `앞 ${MAX_PAGES}쪽만 표시합니다.` : undefined,
    };
  }

  if (nextState.kind === 'xlsx') {
    return {
      count: nextState.sheets.length,
      labels: nextState.sheets.map((sheet) => sheet.name),
      warning: nextState.warning,
    };
  }

  throw new Error('지원하지 않는 문서 상태입니다.');
}

function renderSheet(xlsx: XlsxState, index: number): RenderedPage {
  const { name, sheet, warning } = xlsx.sheets[index];
  const layout = xlsx.formatting?.sheets[name];
  const ref = sheet['!ref'];

  if (!ref) {
    return {
      html: `<section class="sheet-view" data-sheet="${escapeAttr(name)}"><h2>${escapeHtml(name)}</h2><p class="empty-sheet">빈 시트입니다.</p></section>`,
      width: 960,
      warning,
    };
  }

  const range = xlsx.utils.decode_range(ref);
  const sourceRows = range.e.r - range.s.r + 1;
  const sourceCols = range.e.c - range.s.c + 1;
  const rows = Math.min(sourceRows, MAX_XLSX_ROWS, Math.max(1, Math.floor(MAX_XLSX_CELLS / Math.min(sourceCols, MAX_XLSX_COLS))));
  const cols = Math.min(sourceCols, MAX_XLSX_COLS);
  const hiddenCells = new Set<string>();
  const mergeStarts = mergedCellMap(sheet, range.s.r, range.s.c, rows, cols);
  const rowHtml: string[] = [];

  for (let rowOffset = 0; rowOffset < rows; rowOffset += 1) {
    const rowIndex = range.s.r + rowOffset;
    const cells: string[] = [`<th scope="row">${rowIndex + 1}</th>`];

    for (let colOffset = 0; colOffset < cols; colOffset += 1) {
      const colIndex = range.s.c + colOffset;
      const hiddenKey = `${rowIndex}:${colIndex}`;

      if (hiddenCells.has(hiddenKey)) continue;

      const merge = mergeStarts.get(hiddenKey);
      if (merge) {
        for (let r = rowIndex; r <= merge.endRow; r += 1) {
          for (let c = colIndex; c <= merge.endCol; c += 1) {
            if (r !== rowIndex || c !== colIndex) hiddenCells.add(`${r}:${c}`);
          }
        }
      }

      const address = xlsx.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = sheet[address] as XlsxCell | undefined;
      const text = cellText(cell, xlsx.formatCell);
      const attrs = merge
        ? ` rowspan="${merge.endRow - rowIndex + 1}" colspan="${merge.endCol - colIndex + 1}"`
        : '';
      const column = layout?.columns.find(col => colIndex + 1 >= col.min && colIndex + 1 <= col.max);
      const styleIndex = layout?.cells[address] ?? layout?.rows[String(rowIndex + 1)]?.style ?? column?.style ?? 0;
      const css = (cell?.t === 'n' ? 'text-align:right;' : '') + (xlsx.formatting?.styles[styleIndex] ?? '');
      cells.push(`<td style="${escapeAttr(css)}" data-row="${rowIndex}" data-col="${colIndex}"${attrs}>${escapeHtml(text)}</td>`);
    }

    const height = layout?.rows[String(rowIndex + 1)]?.height;
    rowHtml.push(`<tr${height ? ` style="height:${height}px"` : ''}>${cells.join('')}</tr>`);
  }

  const widths = Array.from({ length: cols }, (_, i) => {
    const col = range.s.c + i + 1;
    return layout?.columns.find(item => col >= item.min && col <= item.max)?.width ?? 96;
  });
  const colHeaders = Array.from({ length: cols }, (_, offset) => (
    `<th scope="col">${escapeHtml(columnName(range.s.c + offset))}</th>`
  )).join('');
  const truncation = truncationWarning(sourceRows, sourceCols, rows, cols);
  const combinedWarning = [warning, truncation].filter(Boolean).join(' ');

  return {
    html: [
      `<section class="sheet-view" data-sheet="${escapeAttr(name)}">`,
      `<h2>${escapeHtml(name)}</h2>`,
      '<div class="sheet-scroll">',
      '<table class="sheet-table">',
      `<colgroup><col style="width:40px">${widths.map(width => `<col style="width:${width}px">`).join('')}</colgroup>`,
      `<thead><tr><th scope="col"></th>${colHeaders}</tr></thead>`,
      `<tbody>${rowHtml.join('')}</tbody>`,
      '</table>',
      '</div>',
      '</section>',
    ].join(''),
    width: Math.max(400, 40 + widths.reduce((total, width) => total + width, 0)),
    warning: combinedWarning || undefined,
  };
}

function mergedCellMap(sheet: XlsxSheet, minRow: number, minCol: number, rows: number, cols: number): Map<string, {
  endRow: number;
  endCol: number;
}> {
  const merges = sheet['!merges'] ?? [];
  const maxRow = minRow + rows - 1;
  const maxCol = minCol + cols - 1;
  const map = new Map<string, { endRow: number; endCol: number }>();

  for (const merge of merges) {
    if (merge.s.r < minRow || merge.s.c < minCol || merge.s.r > maxRow || merge.s.c > maxCol) continue;

    map.set(`${merge.s.r}:${merge.s.c}`, {
      endRow: Math.min(merge.e.r, maxRow),
      endCol: Math.min(merge.e.c, maxCol),
    });
  }

  return map;
}

function sheetWarning(sheet: XlsxSheet, utils: XlsxUtils): string | undefined {
  const ref = sheet['!ref'];
  if (!ref) return undefined;

  const range = utils.decode_range(ref);
  const rows = range.e.r - range.s.r + 1;
  const cols = range.e.c - range.s.c + 1;
  return truncationWarning(rows, cols, Math.min(rows, MAX_XLSX_ROWS), Math.min(cols, MAX_XLSX_COLS));
}

function truncationWarning(sourceRows: number, sourceCols: number, shownRows: number, shownCols: number): string | undefined {
  if (sourceRows <= shownRows && sourceCols <= shownCols && sourceRows * sourceCols <= MAX_XLSX_CELLS) {
    return undefined;
  }

  return `큰 시트라서 ${shownRows.toLocaleString('ko-KR')}행, ${shownCols.toLocaleString('ko-KR')}열, 최대 ${MAX_XLSX_CELLS.toLocaleString('ko-KR')}셀까지만 표시합니다.`;
}

function cellText(cell: XlsxCell | undefined, formatCell: (cell: XlsxCell) => string): string {
  if (!cell) return '';
  if (typeof cell.w === 'string') return cell.w;
  if (cell.v === null || cell.v === undefined) return '';
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  try { return formatCell(cell); } catch { return String(cell.v); }
}

function svgPage(svg: string, fallback = DEFAULT_SLIDE_SIZE): RenderedPage {
  const dimensions = svgDimensions(svg) ?? fallback;
  return {
    html: svg,
    width: dimensions.width,
    height: dimensions.height,
  };
}

function svgDimensions(svg: string): { width: number; height: number } | null {
  const width = numberAttribute(svg, 'width');
  const height = numberAttribute(svg, 'height');
  if (width && height) return { width, height };

  const viewBox = svg.match(/\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)/i);
  if (!viewBox) return null;

  const viewBoxWidth = Number(viewBox[1]);
  const viewBoxHeight = Number(viewBox[2]);
  return Number.isFinite(viewBoxWidth) && Number.isFinite(viewBoxHeight)
    ? { width: viewBoxWidth, height: viewBoxHeight }
    : null;
}

function numberAttribute(svg: string, name: string): number | null {
  const match = svg.match(new RegExp(`\\b${name}=["']([\\d.]+)(?:px|pt|mm|cm|in)?["']`, 'i'));
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function assertPageIndex(index: number, count: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(`페이지 번호가 범위를 벗어났습니다. 0부터 ${Math.max(0, count - 1)} 사이여야 합니다.`);
  }
}

function pageCount(nextState: PageState): number {
  if (nextState.kind === 'pptx') return nextState.slides.length;
  if (nextState.kind === 'xlsx') return nextState.sheets.length;
  return nextState.count;
}

function disposeState(): void {
  if (state?.kind === 'hwp' || state?.kind === 'hwpx') {
    state.viewer.free();
  }

  state = null;
}

function installWorkerCanvasDocument(): void {
  const global = globalThis as typeof globalThis & {
    measureTextWidth?: (font: string, text: string) => number;
  };
  const canvasHost = globalThis as unknown as {
    document?: { createElement(name: string): OffscreenCanvas };
  };

  canvasHost.document ??= {
    createElement(name: string) {
      if (name !== 'canvas') throw new Error(`${name} 요소는 워커에서 만들 수 없습니다.`);
      return new OffscreenCanvas(1, 1);
    },
  };

  global.measureTextWidth ??= (font: string, text: string) => {
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('2d');
    if (!context) return text.length * 8;
    context.font = font;
    return context.measureText(text).width;
  };
}

function emuToPx(emu: number): number {
  return Math.max(1, Math.round(emu / 9525));
}

function columnName(index: number): string {
  let value = index + 1;
  let name = '';

  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }

  return name;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll('\n', ' ');
}

function koreanError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') return error;
  return '문서를 처리하는 중 오류가 발생했습니다.';
}

function post(message: WorkerResponse): void {
  self.postMessage(message);
}
