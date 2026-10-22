import './style.css';
import { loadPdf, extractDirectPageText, renderPdfPageToCanvas } from './pdf/reader';
import { OcrClient, type SupportedLang } from './ocr/client';
import { warpPerspective, estimateTargetDimensions } from './vision/warp';
import { applyFilters, calculateOtsuThreshold } from './vision/preprocess';
import type { QuadPoints, Point } from './vision/types';
import type { RoiField, DocumentTemplate, NormalizedRect } from './template/types';
import {
  cropRoiFromCanvas,
  getWhitelistForRule,
  serializeTemplate,
  parseTemplate,
  exportResultsToCsv,
  exportResultsToJson,
} from './template/manager';
import { createSampleDocumentCanvas } from './ui/sample';

// --- State ---
interface AppState {
  fileName: string;
  isPdf: boolean;
  pdfDoc: any | null;
  currentPage: number;
  totalPages: number;
  baseCanvas: HTMLCanvasElement | null;
  currentCanvas: HTMLCanvasElement | null;
  toolMode: 'view' | 'warp' | 'roi';
  warpCorners: QuadPoints | null;
  activeCornerIdx: number | null;
  rois: RoiField[];
  isDrawingRoi: boolean;
  roiStart: Point | null;
  zoom: number;
  filters: {
    grayscale: boolean;
    contrast: number;
    binarize: boolean;
    threshold: number;
  };
}

const state: AppState = {
  fileName: '',
  isPdf: false,
  pdfDoc: null,
  currentPage: 1,
  totalPages: 1,
  baseCanvas: null,
  currentCanvas: null,
  toolMode: 'view',
  warpCorners: null,
  activeCornerIdx: null,
  rois: [],
  isDrawingRoi: false,
  roiStart: null,
  zoom: 1.0,
  filters: {
    grayscale: false,
    contrast: 1.0,
    binarize: false,
    threshold: 128,
  },
};

const ocrClient = new OcrClient('./tessdata');

// --- DOM References ---
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const welcomeEl = $('welcome');
const workspaceEl = $('workspace');
const dropZoneEl = $('drop-zone');
const chooseFileBtn = $('choose-file');
const trySampleBtn = $('try-sample');
const fileInput = $<HTMLInputElement>('file-input');

const fileBar = $('file-bar');
const fileNameEl = $('file-name');
const fileMetaEl = $('file-meta');
const openOtherBtn = $('open-other');
const closeFileBtn = $('close-file');

const docCanvas = $<HTMLCanvasElement>('doc-canvas');
const overlayLayer = $('overlay-layer');
const canvasContainer = $('canvas-container');

const toolViewBtn = $('tool-view');
const toolWarpBtn = $('tool-warp');
const toolRoiBtn = $('tool-roi');

const pageNav = $('page-nav');
const pagePrevBtn = $<HTMLButtonElement>('page-prev');
const pageNextBtn = $<HTMLButtonElement>('page-next');
const pageIndicator = $('page-indicator');

const zoomFitBtn = $('zoom-fit');
const zoomInBtn = $('zoom-in');
const zoomOutBtn = $('zoom-out');

const tabBtnText = $('tab-btn-text');
const tabBtnTemplate = $('tab-btn-template');
const tabBtnFilters = $('tab-btn-filters');
const tabPaneText = $('tab-pane-text');
const tabPaneTemplate = $('tab-pane-template');
const tabPaneFilters = $('tab-pane-filters');

const runFullOcrBtn = $('run-full-ocr');
const ocrLangSelect = $<HTMLSelectElement>('ocr-lang');
const fullTextOutput = $<HTMLTextAreaElement>('full-text-output');
const copyTextBtn = $('copy-text');
const downloadTxtBtn = $('download-txt');

const roiTableBody = $('roi-list-body');
const runTemplateOcrBtn = $('run-template-ocr');
const exportCsvBtn = $('export-csv');
const exportJsonBtn = $('export-json');
const btnSaveTemplate = $('btn-save-template');
const btnLoadTemplate = $('btn-load-template');
const templateFileInput = $<HTMLInputElement>('template-file-input');

const filterGrayscale = $<HTMLInputElement>('filter-grayscale');
const filterContrast = $<HTMLInputElement>('filter-contrast');
const contrastVal = $('contrast-val');
const filterBinarize = $<HTMLInputElement>('filter-binarize');
const thresholdRow = $('threshold-row');
const filterThreshold = $<HTMLInputElement>('filter-threshold');
const thresholdVal = $('threshold-val');
const btnOtsu = $('btn-otsu');
const btnApplyFilters = $('btn-apply-filters');
const btnResetFilters = $('btn-reset-filters');

const progressEl = $('progress');
const progressTextEl = $('progress-text');
const errorMessageEl = $('error-message');

// --- Helper Functions ---
function showProgress(text: string) {
  progressTextEl.textContent = text;
  progressEl.hidden = false;
}

function hideProgress() {
  progressEl.hidden = true;
}

function showError(msg: string) {
  errorMessageEl.textContent = msg;
  errorMessageEl.hidden = false;
  setTimeout(() => {
    errorMessageEl.hidden = true;
  }, 4000);
}

function switchTab(tab: 'text' | 'template' | 'filters') {
  tabBtnText.classList.toggle('active', tab === 'text');
  tabBtnText.setAttribute('aria-selected', tab === 'text' ? 'true' : 'false');
  tabPaneText.hidden = tab !== 'text';

  tabBtnTemplate.classList.toggle('active', tab === 'template');
  tabBtnTemplate.setAttribute('aria-selected', tab === 'template' ? 'true' : 'false');
  tabPaneTemplate.hidden = tab !== 'template';

  tabBtnFilters.classList.toggle('active', tab === 'filters');
  tabBtnFilters.setAttribute('aria-selected', tab === 'filters' ? 'true' : 'false');
  tabPaneFilters.hidden = tab !== 'filters';
}

function setToolMode(mode: 'view' | 'warp' | 'roi') {
  state.toolMode = mode;
  toolViewBtn.classList.toggle('active', mode === 'view');
  toolWarpBtn.classList.toggle('active', mode === 'warp');
  toolRoiBtn.classList.toggle('active', mode === 'roi');

  if (mode === 'warp' && state.currentCanvas && !state.warpCorners) {
    // 기본 4점 모서리 초기화 (약간 안쪽 5% 여백)
    const w = state.currentCanvas.width;
    const h = state.currentCanvas.height;
    const padX = w * 0.05;
    const padY = h * 0.05;
    state.warpCorners = [
      { x: padX, y: padY },
      { x: w - padX, y: padY },
      { x: w - padX, y: h - padY },
      { x: padX, y: h - padY },
    ];
  }

  renderOverlay();
}

function updateFileBar() {
  fileNameEl.textContent = state.fileName;
  if (state.isPdf) {
    fileMetaEl.textContent = `PDF · ${state.currentPage} / ${state.totalPages} 페이지`;
    pageNav.hidden = state.totalPages <= 1;
    pageIndicator.textContent = `${state.currentPage} / ${state.totalPages}`;
    pagePrevBtn.disabled = state.currentPage <= 1;
    pageNextBtn.disabled = state.currentPage >= state.totalPages;
  } else {
    fileMetaEl.textContent = state.currentCanvas
      ? `이미지 · ${state.currentCanvas.width} × ${state.currentCanvas.height} px`
      : '이미지';
    pageNav.hidden = true;
  }
  fileBar.hidden = false;
  welcomeEl.hidden = true;
  workspaceEl.hidden = false;
}

// --- Canvas Rendering & Viewport ---
function renderDocToCanvas() {
  if (!state.currentCanvas) return;
  docCanvas.width = state.currentCanvas.width;
  docCanvas.height = state.currentCanvas.height;

  const ctx = docCanvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(state.currentCanvas, 0, 0);
  }

  applyZoom();
  renderOverlay();
}

function applyZoom() {
  docCanvas.style.width = `${docCanvas.width * state.zoom}px`;
  docCanvas.style.height = `${docCanvas.height * state.zoom}px`;
  overlayLayer.style.width = `${docCanvas.width * state.zoom}px`;
  overlayLayer.style.height = `${docCanvas.height * state.zoom}px`;
}

function fitToContainer() {
  if (!docCanvas.width || !docCanvas.height) return;
  const containerW = canvasContainer.clientWidth - 40;
  const containerH = canvasContainer.clientHeight - 40;
  const scaleW = containerW / docCanvas.width;
  const scaleH = containerH / docCanvas.height;
  state.zoom = Math.max(0.1, Math.min(1.0, Math.min(scaleW, scaleH)));
  applyZoom();
}

// --- Overlay Rendering (Warp Pins & ROI Boxes) ---
function renderOverlay() {
  overlayLayer.innerHTML = '';
  if (!state.currentCanvas) return;

  const scale = state.zoom;
  const cw = state.currentCanvas.width;
  const ch = state.currentCanvas.height;

  // 1. Warp Corners
  if (state.toolMode === 'warp' && state.warpCorners) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;');

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const ptsStr = state.warpCorners
      .map((p) => `${p.x * scale},${p.y * scale}`)
      .join(' ');
    poly.setAttribute('points', ptsStr);
    poly.setAttribute('stroke', '#1f5f8b');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-dasharray', '4 4');
    poly.setAttribute('fill', 'rgba(31, 95, 139, 0.15)');
    svg.appendChild(poly);
    overlayLayer.appendChild(svg);

    // 4 Draggable Pin Handles
    state.warpCorners.forEach((p, idx) => {
      const pin = document.createElement('div');
      pin.className = 'warp-pin';
      pin.style.position = 'absolute';
      pin.style.left = `${p.x * scale - 10}px`;
      pin.style.top = `${p.y * scale - 10}px`;
      pin.style.width = '20px';
      pin.style.height = '20px';
      pin.style.borderRadius = '50%';
      pin.style.background = '#1f5f8b';
      pin.style.border = '2px solid #ffffff';
      pin.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
      pin.style.cursor = 'grab';
      pin.style.pointerEvents = 'auto';
      pin.dataset.cornerIdx = String(idx);

      overlayLayer.appendChild(pin);
    });

    // 보정 실행 버튼 툴바에 부착
    const actionBadge = document.createElement('div');
    actionBadge.style.position = 'absolute';
    actionBadge.style.top = '10px';
    actionBadge.style.right = '10px';
    actionBadge.style.pointerEvents = 'auto';

    const applyWarpBtn = document.createElement('button');
    applyWarpBtn.className = 'btn primary';
    applyWarpBtn.textContent = '원근 보정 실행';
    applyWarpBtn.addEventListener('click', executeWarp);
    actionBadge.appendChild(applyWarpBtn);
    overlayLayer.appendChild(actionBadge);
  }

  // 2. ROI Bounding Boxes
  state.rois.forEach((roi) => {
    const rx = roi.rect.x * cw * scale;
    const ry = roi.rect.y * ch * scale;
    const rw = roi.rect.width * cw * scale;
    const rh = roi.rect.height * ch * scale;

    const box = document.createElement('div');
    box.className = 'roi-box';
    box.style.position = 'absolute';
    box.style.left = `${rx}px`;
    box.style.top = `${ry}px`;
    box.style.width = `${rw}px`;
    box.style.height = `${rh}px`;
    box.style.border = '2px solid #10b981';
    box.style.background = 'rgba(16, 185, 129, 0.12)';
    box.style.pointerEvents = 'auto';

    const label = document.createElement('span');
    label.style.position = 'absolute';
    label.style.top = '-20px';
    label.style.left = '0';
    label.style.background = '#10b981';
    label.style.color = '#ffffff';
    label.style.fontSize = '11px';
    label.style.fontWeight = 'bold';
    label.style.padding = '1px 6px';
    label.style.borderRadius = '3px';
    label.style.whiteSpace = 'nowrap';
    label.textContent = roi.name;
    box.appendChild(label);

    overlayLayer.appendChild(box);
  });
}

function executeWarp() {
  if (!state.currentCanvas || !state.warpCorners) return;
  showProgress('원근 왜곡 보정 중...');

  setTimeout(() => {
    try {
      const ctx = state.currentCanvas!.getContext('2d');
      if (!ctx) return;
      const srcData = ctx.getImageData(0, 0, state.currentCanvas!.width, state.currentCanvas!.height);

      const dims = estimateTargetDimensions(state.warpCorners!);
      const warpedData = warpPerspective(srcData, state.warpCorners!, dims.width, dims.height);

      const warpedCanvas = document.createElement('canvas');
      warpedCanvas.width = dims.width;
      warpedCanvas.height = dims.height;
      const wCtx = warpedCanvas.getContext('2d');
      if (wCtx) {
        wCtx.putImageData(warpedData, 0, 0);
      }

      state.currentCanvas = warpedCanvas;
      state.warpCorners = null;
      setToolMode('view');
      renderDocToCanvas();
      fitToContainer();
      updateFileBar();
    } catch (e: any) {
      showError(`원근 보정 오류: ${e.message}`);
    } finally {
      hideProgress();
    }
  }, 50);
}

// --- Interactive Events on Canvas/Overlay ---
overlayLayer.addEventListener('mousedown', (e) => {
  const target = e.target as HTMLElement;

  if (state.toolMode === 'warp' && target.classList.contains('warp-pin')) {
    state.activeCornerIdx = Number(target.dataset.cornerIdx);
    return;
  }

  if (state.toolMode === 'roi' && state.currentCanvas) {
    const rect = overlayLayer.getBoundingClientRect();
    const x = (e.clientX - rect.left) / state.zoom;
    const y = (e.clientY - rect.top) / state.zoom;
    state.isDrawingRoi = true;
    state.roiStart = { x, y };
  }
});

window.addEventListener('mousemove', (e) => {
  if (state.activeCornerIdx !== null && state.warpCorners && state.currentCanvas) {
    const rect = overlayLayer.getBoundingClientRect();
    const x = Math.max(0, Math.min(state.currentCanvas.width, (e.clientX - rect.left) / state.zoom));
    const y = Math.max(0, Math.min(state.currentCanvas.height, (e.clientY - rect.top) / state.zoom));
    state.warpCorners[state.activeCornerIdx] = { x, y };
    renderOverlay();
    return;
  }

  if (state.isDrawingRoi && state.roiStart && state.currentCanvas) {
    const rect = overlayLayer.getBoundingClientRect();
    const curX = Math.max(0, Math.min(state.currentCanvas.width, (e.clientX - rect.left) / state.zoom));
    const curY = Math.max(0, Math.min(state.currentCanvas.height, (e.clientY - rect.top) / state.zoom));

    const minX = Math.min(state.roiStart.x, curX);
    const minY = Math.min(state.roiStart.y, curY);
    const w = Math.abs(curX - state.roiStart.x);
    const h = Math.abs(curY - state.roiStart.y);

    let tempBox = overlayLayer.querySelector('.temp-roi-box') as HTMLElement;
    if (!tempBox) {
      tempBox = document.createElement('div');
      tempBox.className = 'temp-roi-box';
      tempBox.style.position = 'absolute';
      tempBox.style.border = '2px dashed #10b981';
      tempBox.style.background = 'rgba(16, 185, 129, 0.2)';
      tempBox.style.pointerEvents = 'none';
      overlayLayer.appendChild(tempBox);
    }
    tempBox.style.left = `${minX * state.zoom}px`;
    tempBox.style.top = `${minY * state.zoom}px`;
    tempBox.style.width = `${w * state.zoom}px`;
    tempBox.style.height = `${h * state.zoom}px`;
  }
});

window.addEventListener('mouseup', (e) => {
  if (state.activeCornerIdx !== null) {
    state.activeCornerIdx = null;
  }

  if (state.isDrawingRoi && state.roiStart && state.currentCanvas) {
    state.isDrawingRoi = false;
    const rect = overlayLayer.getBoundingClientRect();
    const curX = Math.max(0, Math.min(state.currentCanvas.width, (e.clientX - rect.left) / state.zoom));
    const curY = Math.max(0, Math.min(state.currentCanvas.height, (e.clientY - rect.top) / state.zoom));

    const minX = Math.min(state.roiStart.x, curX);
    const minY = Math.min(state.roiStart.y, curY);
    const w = Math.abs(curX - state.roiStart.x);
    const h = Math.abs(curY - state.roiStart.y);

    state.roiStart = null;
    const tempBox = overlayLayer.querySelector('.temp-roi-box');
    if (tempBox) tempBox.remove();

    if (w > 10 && h > 10) {
      const cw = state.currentCanvas.width;
      const ch = state.currentCanvas.height;
      const normalizedRect: NormalizedRect = {
        x: minX / cw,
        y: minY / ch,
        width: w / cw,
        height: h / ch,
      };

      const fieldName = `필드 ${state.rois.length + 1}`;
      state.rois.push({
        id: `roi_${Date.now()}`,
        name: fieldName,
        rect: normalizedRect,
        rule: 'all',
      });

      renderRoiTable();
      renderOverlay();
      switchTab('template');
    }
  }
});

// --- ROI Table UI ---
function renderRoiTable() {
  if (state.rois.length === 0) {
    roiTableBody.innerHTML = '<tr class="empty-row"><td colspan="4">지정된 필드가 없습니다.</td></tr>';
    return;
  }

  roiTableBody.innerHTML = '';
  state.rois.forEach((roi, idx) => {
    const tr = document.createElement('tr');

    // 1. Name input
    const tdName = document.createElement('td');
    const inputName = document.createElement('input');
    inputName.type = 'text';
    inputName.value = roi.name;
    inputName.style.width = '100%';
    inputName.style.padding = '3px 6px';
    inputName.style.border = '1px solid var(--line-strong)';
    inputName.style.borderRadius = '4px';
    inputName.addEventListener('change', () => {
      roi.name = inputName.value.trim() || `필드 ${idx + 1}`;
      renderOverlay();
    });
    tdName.appendChild(inputName);

    // 2. Rule select
    const tdRule = document.createElement('td');
    const selectRule = document.createElement('select');
    selectRule.innerHTML = `
      <option value="all">전체</option>
      <option value="digits">숫자 전용</option>
      <option value="alphanumeric">영문+숫자</option>
    `;
    selectRule.value = roi.rule || 'all';
    selectRule.addEventListener('change', () => {
      roi.rule = selectRule.value as any;
    });
    tdRule.appendChild(selectRule);

    // 3. Extracted value
    const tdVal = document.createElement('td');
    tdVal.style.fontFamily = 'var(--mono)';
    tdVal.textContent = roi.extractedValue || '-';
    if (roi.confidence !== undefined) {
      const confSpan = document.createElement('span');
      confSpan.style.color = 'var(--muted)';
      confSpan.style.fontSize = '11px';
      confSpan.style.marginLeft = '4px';
      confSpan.textContent = `(${roi.confidence.toFixed(0)}%)`;
      tdVal.appendChild(confSpan);
    }

    // 4. Delete button
    const tdDel = document.createElement('td');
    const btnDel = document.createElement('button');
    btnDel.className = 'btn icon';
    btnDel.textContent = '✕';
    btnDel.title = '필드 삭제';
    btnDel.addEventListener('click', () => {
      state.rois.splice(idx, 1);
      renderRoiTable();
      renderOverlay();
    });
    tdDel.appendChild(btnDel);

    tr.appendChild(tdName);
    tr.appendChild(tdRule);
    tr.appendChild(tdVal);
    tr.appendChild(tdDel);
    roiTableBody.appendChild(tr);
  });
}

// --- Loading Files (PDF & Images) ---
async function loadFile(file: File) {
  showProgress('파일 읽는 중...');
  try {
    state.fileName = file.name;
    state.rois = [];
    state.warpCorners = null;

    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const arrayBuffer = await file.arrayBuffer();
      state.isPdf = true;
      state.pdfDoc = await loadPdf(arrayBuffer);
      state.totalPages = state.pdfDoc.numPages;
      state.currentPage = 1;
      await renderPdfCurrentPage();
    } else {
      state.isPdf = false;
      state.pdfDoc = null;
      state.totalPages = 1;
      state.currentPage = 1;

      const img = new Image();
      const url = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('이미지 로딩에 실패했습니다.'));
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      state.baseCanvas = canvas;
      state.currentCanvas = canvas;
      renderDocToCanvas();
      fitToContainer();
      updateFileBar();
    }
  } catch (e: any) {
    showError(`파일 로드 실패: ${e.message}`);
  } finally {
    hideProgress();
  }
}

async function renderPdfCurrentPage() {
  if (!state.pdfDoc) return;
  showProgress(`PDF ${state.currentPage}페이지 렌더링 중...`);

  try {
    const page = await state.pdfDoc.getPage(state.currentPage);
    const canvas = document.createElement('canvas');
    await renderPdfPageToCanvas(page, canvas, 2.0);

    state.baseCanvas = canvas;
    state.currentCanvas = canvas;
    renderDocToCanvas();
    fitToContainer();
    updateFileBar();
  } catch (e: any) {
    showError(`PDF 페이지 렌더링 실패: ${e.message}`);
  } finally {
    hideProgress();
  }
}

// --- OCR Execution ---
runFullOcrBtn.addEventListener('click', async () => {
  if (!state.currentCanvas) return;
  const lang = ocrLangSelect.value as SupportedLang;

  // 1. PDF 텍스트 레이어 체크 (스마트 다이렉트 추출)
  if (state.isPdf && state.pdfDoc) {
    try {
      showProgress('PDF 디지털 텍스트 레이어 확인 중...');
      const page = await state.pdfDoc.getPage(state.currentPage);
      const direct = await extractDirectPageText(page);

      if (direct.hasText) {
        fullTextOutput.value = direct.text;
        hideProgress();
        showError('✓ PDF 디지털 텍스트 레이어에서 즉시 추출되었습니다.');
        return;
      }
    } catch {
      // 폴백하여 OCR 진행
    }
  }

  // 2. OCR 인식 수행
  showProgress('OCR 언어 모델 로딩 및 텍스트 추출 중...');
  try {
    const result = await ocrClient.recognize(state.currentCanvas, {
      lang,
      onProgress: (p) => {
        showProgress(`${p.status} (${Math.round(p.progress * 100)}%)`);
      },
    });

    fullTextOutput.value = result.text;
    if (!result.text) {
      showError('인식된 텍스트가 없습니다. 이미지 필터에서 흑백/대비를 조절해 보세요.');
    }
  } catch (e: any) {
    showError(`OCR 처리 오류: ${e.message}`);
  } finally {
    hideProgress();
  }
});

runTemplateOcrBtn.addEventListener('click', async () => {
  if (!state.currentCanvas || state.rois.length === 0) {
    showError('추출할 양식 필드(ROI)가 없습니다. 캔버스에서 필드를 먼저 지정하세요.');
    return;
  }

  const lang = ocrLangSelect.value as SupportedLang;

  for (let i = 0; i < state.rois.length; i++) {
    const roi = state.rois[i];
    showProgress(`[${i + 1}/${state.rois.length}] '${roi.name}' 필드 추출 중...`);

    const subCanvas = cropRoiFromCanvas(state.currentCanvas, roi.rect);
    const whitelist = getWhitelistForRule(roi.rule);

    try {
      const res = await ocrClient.recognize(subCanvas, {
        lang,
        whitelist,
      });

      roi.extractedValue = res.text.replace(/\n+/g, ' ');
      roi.confidence = res.confidence;
    } catch {
      roi.extractedValue = '';
      roi.confidence = 0;
    }
    renderRoiTable();
  }

  hideProgress();
  showError('✓ 양식 필드 추출이 완료되었습니다.');
});

// --- Filter Controls ---
filterGrayscale.addEventListener('change', () => {
  state.filters.grayscale = filterGrayscale.checked;
});

filterContrast.addEventListener('input', () => {
  const val = parseFloat(filterContrast.value);
  state.filters.contrast = val;
  contrastVal.textContent = val.toFixed(1);
});

filterBinarize.addEventListener('change', () => {
  state.filters.binarize = filterBinarize.checked;
  thresholdRow.hidden = !filterBinarize.checked;
});

filterThreshold.addEventListener('input', () => {
  const val = parseInt(filterThreshold.value, 10);
  state.filters.threshold = val;
  thresholdVal.textContent = String(val);
});

btnOtsu.addEventListener('click', () => {
  if (!state.baseCanvas) return;
  const ctx = state.baseCanvas.getContext('2d');
  if (!ctx) return;
  const imgData = ctx.getImageData(0, 0, state.baseCanvas.width, state.baseCanvas.height);
  const otsuVal = calculateOtsuThreshold(imgData.data);
  state.filters.threshold = otsuVal;
  filterThreshold.value = String(otsuVal);
  thresholdVal.textContent = String(otsuVal);
});

btnApplyFilters.addEventListener('click', () => {
  if (!state.baseCanvas) return;
  showProgress('필터 적용 중...');

  setTimeout(() => {
    try {
      const ctx = state.baseCanvas!.getContext('2d');
      if (!ctx) return;
      const srcData = ctx.getImageData(0, 0, state.baseCanvas!.width, state.baseCanvas!.height);
      const filtered = applyFilters(srcData, state.filters);

      const canvas = document.createElement('canvas');
      canvas.width = filtered.width;
      canvas.height = filtered.height;
      const fCtx = canvas.getContext('2d');
      if (fCtx) fCtx.putImageData(filtered, 0, 0);

      state.currentCanvas = canvas;
      renderDocToCanvas();
    } catch (e: any) {
      showError(`필터 적용 오류: ${e.message}`);
    } finally {
      hideProgress();
    }
  }, 20);
});

btnResetFilters.addEventListener('click', () => {
  filterGrayscale.checked = false;
  state.filters.grayscale = false;

  filterContrast.value = '1.0';
  contrastVal.textContent = '1.0';
  state.filters.contrast = 1.0;

  filterBinarize.checked = false;
  thresholdRow.hidden = true;
  state.filters.binarize = false;

  state.currentCanvas = state.baseCanvas;
  renderDocToCanvas();
});

// --- Exports & Copy ---
copyTextBtn.addEventListener('click', () => {
  if (!fullTextOutput.value) return;
  navigator.clipboard.writeText(fullTextOutput.value);
  showError('✓ 클립보드에 복사되었습니다.');
});

downloadTxtBtn.addEventListener('click', () => {
  if (!fullTextOutput.value) return;
  const blob = new Blob([fullTextOutput.value], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.fileName || 'extracted'}_ocr.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
});

exportCsvBtn.addEventListener('click', () => {
  if (state.rois.length === 0) return;
  const csv = exportResultsToCsv(state.rois);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.fileName || 'template'}_fields.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

exportJsonBtn.addEventListener('click', () => {
  if (state.rois.length === 0) return;
  const json = exportResultsToJson(state.rois);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.fileName || 'template'}_fields.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

btnSaveTemplate.addEventListener('click', () => {
  if (state.rois.length === 0) {
    showError('저장할 템플릿 필드가 없습니다.');
    return;
  }
  const template: DocumentTemplate = {
    name: `${state.fileName || '문서'} 템플릿`,
    version: '1.0',
    fields: state.rois,
  };
  const json = serializeTemplate(template);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lector_template.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

btnLoadTemplate.addEventListener('click', () => {
  templateFileInput.click();
});

templateFileInput.addEventListener('change', async () => {
  const file = templateFileInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const tpl = parseTemplate(text);
    state.rois = tpl.fields;
    renderRoiTable();
    renderOverlay();
    showError(`✓ 템플릿 '${tpl.name}' (${tpl.fields.length}개 필드)을 불러왔습니다.`);
  } catch (e: any) {
    showError(`템플릿 로드 오류: ${e.message}`);
  } finally {
    templateFileInput.value = '';
  }
});

// --- Toolbar & UI Listeners ---
toolViewBtn.addEventListener('click', () => setToolMode('view'));
toolWarpBtn.addEventListener('click', () => setToolMode('warp'));
toolRoiBtn.addEventListener('click', () => setToolMode('roi'));

zoomFitBtn.addEventListener('click', fitToContainer);
zoomInBtn.addEventListener('click', () => {
  state.zoom = Math.min(3.0, state.zoom + 0.15);
  applyZoom();
  renderOverlay();
});
zoomOutBtn.addEventListener('click', () => {
  state.zoom = Math.max(0.15, state.zoom - 0.15);
  applyZoom();
  renderOverlay();
});

pagePrevBtn.addEventListener('click', async () => {
  if (state.currentPage > 1) {
    state.currentPage--;
    await renderPdfCurrentPage();
  }
});

pageNextBtn.addEventListener('click', async () => {
  if (state.currentPage < state.totalPages) {
    state.currentPage++;
    await renderPdfCurrentPage();
  }
});

tabBtnText.addEventListener('click', () => switchTab('text'));
tabBtnTemplate.addEventListener('click', () => switchTab('template'));
tabBtnFilters.addEventListener('click', () => switchTab('filters'));

chooseFileBtn.addEventListener('click', () => fileInput.click());
openOtherBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

closeFileBtn.addEventListener('click', () => {
  state.fileName = '';
  state.isPdf = false;
  state.pdfDoc = null;
  state.baseCanvas = null;
  state.currentCanvas = null;
  state.rois = [];
  state.warpCorners = null;
  fileBar.hidden = true;
  workspaceEl.hidden = true;
  welcomeEl.hidden = false;
  fullTextOutput.value = '';
  roiTableBody.innerHTML = '<tr class="empty-row"><td colspan="4">지정된 필드가 없습니다.</td></tr>';
});

// --- Sample Document Handler ---
trySampleBtn.addEventListener('click', () => {
  showProgress('샘플 거래명세표 생성 중...');
  setTimeout(() => {
    state.fileName = 'sample_invoice.png';
    state.isPdf = false;
    state.pdfDoc = null;
    state.totalPages = 1;
    state.currentPage = 1;
    state.rois = [
      {
        id: 'roi_sample_num',
        name: '문서번호',
        rect: { x: 0.14, y: 0.11, width: 0.22, height: 0.025 },
        rule: 'alphanumeric',
      },
      {
        id: 'roi_sample_date',
        name: '발행일자',
        rect: { x: 0.14, y: 0.13, width: 0.18, height: 0.025 },
        rule: 'digits',
      },
      {
        id: 'roi_sample_biz',
        name: '등록번호',
        rect: { x: 0.23, y: 0.175, width: 0.25, height: 0.03 },
        rule: 'digits',
      },
      {
        id: 'roi_sample_total',
        name: '합계금액',
        rect: { x: 0.72, y: 0.40, width: 0.22, height: 0.03 },
        rule: 'all',
      },
    ];

    const sampleCanvas = createSampleDocumentCanvas();
    state.baseCanvas = sampleCanvas;
    state.currentCanvas = sampleCanvas;

    renderDocToCanvas();
    renderRoiTable();
    fitToContainer();
    updateFileBar();
    hideProgress();
  }, 100);
});

// --- Drag & Drop ---
dropZoneEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZoneEl.classList.add('over');
});
dropZoneEl.addEventListener('dragleave', () => {
  dropZoneEl.classList.remove('over');
});
dropZoneEl.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZoneEl.classList.remove('over');
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

// 화면 크기 조정 시 캔버스 반응형 맞춤
window.addEventListener('resize', () => {
  if (state.currentCanvas) {
    applyZoom();
    renderOverlay();
  }
});
