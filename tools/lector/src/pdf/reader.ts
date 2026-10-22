import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

// 기본 로컬 상대 경로 워커 지정 (Vite 번들 환경)
export function initPdfWorker(workerSrc: string = './pdf/pdf.worker.min.mjs'): void {
  if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  }
}

export interface ExtractedPdfText {
  hasText: boolean;
  text: string;
  charCount: number;
}

/** PDF 문서를 로드합니다. */
export async function loadPdf(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  initPdfWorker();
  const loadingTask = pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  return await loadingTask.promise;
}

/**
 * PDF 페이지에 내장된 디지털 텍스트 레이어를 직접 추출합니다.
 * 스캔본이 아닌 일반 전자 문서라면 OCR 없이 수십 밀리초 만에 원문 텍스트를 추출할 수 있습니다.
 */
export async function extractDirectPageText(page: PDFPageProxy): Promise<ExtractedPdfText> {
  const content = await page.getTextContent();
  if (!content.items || content.items.length === 0) {
    return { hasText: false, text: '', charCount: 0 };
  }

  const lines: string[] = [];
  let currentLine = '';
  let lastY: number | null = null;

  for (const item of content.items) {
    if (!('str' in item)) continue;
    const str = item.str;
    if (!str) continue;

    // item.transform = [scaleX, skewX, skewY, scaleY, posX, posY]
    const y = item.transform[5];

    if (lastY !== null && Math.abs(y - lastY) > 5) {
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }
      currentLine = str;
    } else {
      currentLine += (currentLine.length > 0 && !currentLine.endsWith(' ') ? ' ' : '') + str;
    }
    lastY = y;
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  const fullText = lines.join('\n');
  const meaningfulText = fullText.replace(/\s+/g, '');

  return {
    hasText: meaningfulText.length > 5, // 최소 5글자 이상의 의미 있는 텍스트가 있을 때 텍스트 레이어로 판정
    text: fullText,
    charCount: meaningfulText.length,
  };
}

/** PDF 페이지를 캔버스에 렌더링합니다 (OCR 및 화면 표시용, 기본 2.0 배율로 고해상도 유지). */
export async function renderPdfPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number = 2.0
): Promise<void> {
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const renderContext = {
    canvasContext: ctx,
    viewport,
  };

  await page.render(renderContext).promise;
}
