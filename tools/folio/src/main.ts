import './style.css';
import { attachSheetSelection } from './sheet-selection';
import { fileFormat, validateDocument } from './validation';
import { previewDocument } from './sanitize';
import type { DocumentInfo, Format, RenderedPage, WorkerResponse } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>('file-input');
const frame = $<HTMLIFrameElement>('document-frame');
const selector = $<HTMLSelectElement>('page-select');
let worker: Worker | undefined;
let renderer: HTMLIFrameElement | undefined;
let pendingDocx: ArrayBuffer | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let pages: RenderedPage[] = [];
let current: RenderedPage | undefined;
let format: Format | undefined;
let info: DocumentInfo = { count: 0 };
let pageIndex = 0;
let zoom = 1;
let fit = true;
let busy = false;
let exportAbort: AbortController | undefined;
let exportSequence = 0;
const exportRequests = new Map<string, { resolve: (page: RenderedPage) => void; reject: (error: Error) => void }>();
const exportHint = '미리보기 전체를 이미지 PDF로 저장합니다. 표시 제한을 넘는 내용은 제외됩니다.';

const notices: Record<Format, string> = {
  pptx: '슬라이드 미리보기 · 애니메이션·동영상·일부 차트와 도형은 생략될 수 있습니다.',
  hwp: 'HWP 5.x 미리보기 · 원본 글꼴과 복잡한 배치는 다르게 보일 수 있습니다.',
  hwpx: 'HWPX 미리보기 · 원본 글꼴과 복잡한 배치는 다르게 보일 수 있습니다.',
  xlsx: '기본 셀 서식과 지원하는 수식의 계산 결과를 표시합니다. 조건부 서식·차트·외부 연결은 지원하지 않습니다.',
  docx: '문서 미리보기 · 원본 글꼴과 페이지 나눔이 다를 수 있습니다. 외부 콘텐츠는 표시하지 않습니다.',
};

function setStatus(message: string) { $('status').textContent = message; }
function clearTimer() { if (timer) clearTimeout(timer); timer = undefined; }
function deadline() { clearTimer(); timer = setTimeout(() => fail('문서를 처리하는 데 시간이 너무 오래 걸립니다. 더 작은 파일로 다시 시도해 주세요.'), 45_000); }
function release() {
  exportAbort?.abort(); exportAbort = undefined;
  for (const pending of exportRequests.values()) pending.reject(new DOMException('PDF 만들기를 취소했습니다.', 'AbortError'));
  exportRequests.clear();
  $('cancel-export').hidden = true;
  $('export-status').textContent = exportHint;
  $('download-pdf').textContent = 'PDF 다운로드';
  generation++;
  clearTimer();
  worker?.terminate(); worker = undefined;
  renderer?.remove(); renderer = undefined; pendingDocx = undefined;
  pages = []; current = undefined; info = { count: 0 }; format = undefined;
  frame.removeAttribute('srcdoc');
  frame.src = 'about:blank';
  input.value = '';
  selector.replaceChildren();
  $('file-name').textContent = ''; $('file-meta').textContent = '';
  busy = false;
}
function closeFile(focus = true) {
  release();
  $('viewer').hidden = true; $('loading').hidden = true; $('welcome').hidden = false;
  $('error-message').hidden = true;
  $('reload-app').hidden = true;
  setStatus('문서를 닫았습니다.');
  if (focus) $('choose-file').focus();
}
function fail(message: string, reload = false) {
  closeFile(false);
  const error = $('error-message');
  error.textContent = message; error.hidden = false;
  $('reload-app').hidden = !reload;
  setStatus(message);
  error.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}
function ready(value: DocumentInfo) {
  if (!Number.isInteger(value.count) || value.count < 1 || value.count > 500) { fail('표시할 페이지가 없거나 500페이지 제한을 초과했습니다.'); return; }
  info = value;
  selector.replaceChildren(...Array.from({ length: info.count }, (_, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = info.labels?.[index] ?? `${index + 1} 페이지`;
    return option;
  }));
  const sheet = format === 'xlsx';
  $('page-label').textContent = sheet ? '시트 선택' : '페이지 선택';
  $('page-total').textContent = `/ ${info.count}${sheet ? ' 시트' : ''}`;
  $('prev-page').setAttribute('aria-label', sheet ? '이전 시트' : '이전 페이지');
  $('next-page').setAttribute('aria-label', sheet ? '다음 시트' : '다음 페이지');
  showPage(0);
}
function controls() {
  const locked = busy || !!exportAbort;
  $<HTMLButtonElement>('download-pdf').disabled = locked || !current;
  $<HTMLButtonElement>('prev-page').disabled = locked || pageIndex === 0;
  $<HTMLButtonElement>('next-page').disabled = locked || pageIndex >= info.count - 1;
  selector.disabled = locked;
  $<HTMLButtonElement>('zoom-in').disabled = locked || zoom >= 2;
  $<HTMLButtonElement>('zoom-out').disabled = locked || zoom <= .2;
  $<HTMLButtonElement>('fit-page').disabled = locked;
}
function draw() {
  if (!current) return;
  if (fit) zoom = Math.min(1, Math.max(.2, (frame.clientWidth - 48) / current.width));
  $('zoom-level').textContent = `${Math.round(zoom * 100)}%`;
  frame.setAttribute('sandbox', format === 'xlsx' ? 'allow-same-origin' : '');
  frame.srcdoc = previewDocument(current.html, current.width, zoom);
  controls();
}
function showResult(page: RenderedPage) {
  clearTimer(); busy = false; current = page;
  $('loading').hidden = true; $('viewer').hidden = false;
  selector.value = String(pageIndex);
  $('compatibility').textContent = [format && notices[format], info.warning, page.warning].filter(Boolean).join(' ');
  draw();
  setStatus(`${format === 'xlsx' ? info.labels?.[pageIndex] ?? '시트' : `${pageIndex + 1} 페이지`} 열람 중. 전체 ${info.count}${format === 'xlsx' ? '개 시트' : '페이지'}.`);
}
function showPage(index: number) {
  if (index < 0 || index >= info.count || !Number.isInteger(index)) return;
  pageIndex = index; busy = true; controls();
  setStatus('페이지를 읽고 있습니다.');
  deadline();
  if (format === 'docx') showResult(pages[index]);
  else worker?.postMessage({ type: 'page', index });
}
async function openFile(file: File) {
  // Validate name/size before clearing an existing document.
  let nextFormat: Format;
  try { nextFormat = fileFormat(file.name, file.size); }
  catch (error) { fail((error as Error).message); return; }
  release();
  const session = generation;
  format = nextFormat; fit = true; zoom = 1; pageIndex = 0;
  $('welcome').hidden = true; $('viewer').hidden = true; $('error-message').hidden = true; $('loading').hidden = false;
  $('file-name').textContent = file.name;
  $('file-meta').textContent = `${nextFormat.toUpperCase()} · ${file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`} · 로컬 파일`;
  $('file-icon').textContent = nextFormat.toUpperCase();
  setStatus('문서를 읽고 있습니다.'); deadline();
  try {
    const buffer = await file.arrayBuffer();
    if (session !== generation) return;
    validateDocument(buffer, nextFormat);
    if (nextFormat === 'docx') {
      const helper = document.createElement('iframe');
      helper.setAttribute('aria-hidden', 'true'); helper.tabIndex = -1;
      helper.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      // Laid out offscreen so docx-preview can measure page widths.
      helper.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;height:900px;visibility:hidden;border:0';
      renderer = helper;
      pendingDocx = buffer;
      helper.src = new URL('renderer.html', location.href).href;
      document.body.append(helper);
    } else {
      const active = new Worker(new URL('./document.worker.ts', import.meta.url), { type: 'module' });
      worker = active;
      active.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (session !== generation) return;
        if ((data.type === 'page' || data.type === 'error') && data.requestId) {
          const pending = exportRequests.get(data.requestId);
          if (pending) { if (data.type === 'page') pending.resolve(data.page); else pending.reject(new Error(data.message)); }
          return;
        }
        if (data.type === 'ready') ready(data.info);
        else if (data.type === 'page' && data.index === pageIndex) showResult(data.page);
        else if (data.type === 'error') fail(data.message);
      };
      active.onerror = () => { if (session === generation) fail('뷰어가 업데이트되었거나 해석 엔진을 불러오지 못했습니다. 새로고침한 뒤 파일을 다시 선택해 주세요.', true); };
      const xlsxStyles = nextFormat === 'xlsx' ? (await import('./xlsx-styles')).readXlsxStyles(buffer) : undefined;
      if (session !== generation) return;
      active.postMessage({ type: 'open', format: nextFormat, buffer, xlsxStyles }, [buffer]);
    }
  } catch (error) { if (session === generation) fail(error instanceof Error ? error.message : '문서를 열지 못했습니다.'); }
}
window.addEventListener('message', (event: MessageEvent) => {
  if (!renderer || event.source !== renderer.contentWindow || event.origin !== location.origin) return;
  if (event.data.type === 'docx-loaded' && pendingDocx) {
    const buffer = pendingDocx; pendingDocx = undefined;
    renderer.contentWindow?.postMessage({ type: 'render-docx', buffer }, location.origin, [buffer]);
  } else if (event.data.type === 'docx-ready') {
    pages = event.data.pages;
    renderer.remove(); renderer = undefined;
    ready({ count: pages.length });
  } else if (event.data.type === 'docx-error') fail(event.data.message);
});
for (const id of ['choose-file', 'open-file']) $(id).addEventListener('click', () => input.click());
input.addEventListener('change', () => { const file = input.files?.[0]; if (file) void openFile(file); });
$('reload-app').addEventListener('click', () => location.reload());
$('close-file').addEventListener('click', () => closeFile());
$('cancel-load').addEventListener('click', () => closeFile());
$('prev-page').addEventListener('click', () => showPage(pageIndex - 1));
$('next-page').addEventListener('click', () => showPage(pageIndex + 1));
selector.addEventListener('change', () => showPage(Number(selector.value)));
for (const [id, increment] of [['zoom-in', .1], ['zoom-out', -.1]] as const) {
  $(id).addEventListener('click', () => { fit = false; zoom = Math.max(.2, Math.min(2, Math.round((zoom + increment) * 100) / 100)); draw(); });
}
$('fit-page').addEventListener('click', () => { fit = true; draw(); });
const resizeObserver = new ResizeObserver(() => { if (fit && current) draw(); });
resizeObserver.observe(frame);
const dialog = $<HTMLDialogElement>('about-dialog');
$('about-button').addEventListener('click', () => dialog.showModal());
$('close-about').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !dialog.open) closeFile();
  if ((event.ctrlKey || event.metaKey) && event.key === 'o') { event.preventDefault(); input.click(); }
});
let dragDepth = 0;
window.addEventListener('dragenter', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; $('drop-zone').classList.add('dragging'); } });
window.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop-zone').classList.remove('dragging'); } });
window.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; $('drop-zone').classList.remove('dragging');
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  if (files.length > 1) { fail('한 번에 하나의 파일을 놓아주세요.'); return; }
  void openFile(files[0]);
});
$('try-sample').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('try-sample');
  button.disabled = true;
  const session = generation;
  try {
    const { utils, write } = await import('xlsx');
    if (session !== generation) return;
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Folio — 작은 프로젝트 노트', '상태', '메모'], ['로컬에서 문서 열기', '완료', '파일을 서버로 전송하지 않아요.'], ['시트 바꾸기', '살펴보기', '위쪽에서 다른 시트를 선택해 보세요.'], ['나만의 파일 열기', '다음 단계', '다른 파일 열기 버튼을 눌러 주세요.']]), '프로젝트 노트');
    utils.book_append_sheet(book, utils.aoa_to_sheet([['지원 형식', '보기 방식'], ['PPTX', '슬라이드'], ['HWP · HWPX · DOCX', '페이지'], ['XLSX', '시트']]), '지원 형식');
    const bytes = write(book, { type: 'array', bookType: 'xlsx' });
    await openFile(new File([bytes], 'Folio 샘플.xlsx'));
  } catch { fail('샘플을 준비하지 못했습니다. 다시 시도해 주세요.'); }
  finally { button.disabled = false; }
});
window.addEventListener('pagehide', () => closeFile(false));

frame.addEventListener('load', () => { if (format === 'xlsx' && frame.contentDocument) attachSheetSelection(frame.contentDocument); });

function pageForExport(index: number, signal: AbortSignal): Promise<RenderedPage> {
  if (signal.aborted) return Promise.reject(new DOMException('취소', 'AbortError'));
  if (format === 'docx') return Promise.resolve(pages[index]);
  if (!worker) return Promise.reject(new Error('열린 문서가 없습니다.'));
  const activeWorker = worker;
  return new Promise((resolve, reject) => {
    const requestId = `pdf-${++exportSequence}`;
    const timeout = setTimeout(() => finish(undefined, new Error('PDF 페이지를 읽는 데 시간이 너무 오래 걸립니다.')), 45000);
    const cancel = () => finish(undefined, new DOMException('취소', 'AbortError'));
    const finish = (page?: RenderedPage, error?: Error) => {
      clearTimeout(timeout); signal.removeEventListener('abort', cancel); exportRequests.delete(requestId);
      if (error) reject(error); else resolve(page!);
    };
    signal.addEventListener('abort', cancel, { once: true });
    exportRequests.set(requestId, { resolve: page => finish(page), reject: error => finish(undefined, error) });
    activeWorker.postMessage({ type: 'page', index, requestId });
  });
}
$('cancel-export').addEventListener('click', () => exportAbort?.abort());
$('download-pdf').addEventListener('click', async () => {
  if (!format || !current || busy || exportAbort) return;
  const session = generation;
  const selectedFormat = format;
  const count = info.count;
  const fileName = ($('file-name').textContent || 'document').replace(/\.[^.]+$/, '') + '.pdf';
  const controller = new AbortController(); exportAbort = controller;
  $('cancel-export').hidden = false;
  $('download-pdf').textContent = 'PDF 만드는 중…';
  $('export-status').textContent = 'PDF 변환 도구를 준비하고 있습니다. 파일은 서버로 전송하지 않습니다.';
  controls();
  try {
    const { createDocumentPdf } = await import('./pdf-export');
    controller.signal.throwIfAborted();
    const blob = await createDocumentPdf({
      format: selectedFormat, count, signal: controller.signal,
      getPage: index => pageForExport(index, controller.signal),
      onProgress: (done, total) => {
        if (session === generation) $('export-status').textContent = `PDF 만드는 중 · ${done} / ${total}${selectedFormat === 'xlsx' ? ' 시트' : ' 페이지'} · 큰 시트는 여러 장으로 나눕니다.`;
      },
    });
    controller.signal.throwIfAborted();
    if (session !== generation) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = fileName;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    $('export-status').textContent = `PDF 다운로드 완료 · ${count}${selectedFormat === 'xlsx' ? '개 시트' : '페이지'}의 미리보기 · ${(blob.size/1024/1024).toFixed(1)} MB`;
  } catch (error) {
    if (session === generation) $('export-status').textContent = controller.signal.aborted
      ? 'PDF 만들기를 취소했습니다. 문서는 계속 열람할 수 있습니다.'
      : `PDF를 만들지 못했습니다. ${error instanceof Error ? error.message : '다시 시도해 주세요.'}`;
  } finally {
    if (exportAbort === controller) {
      exportAbort = undefined; $('cancel-export').hidden = true;
      $('download-pdf').textContent = 'PDF 다운로드'; controls();
    }
  }
});
