import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { previewDocument } from './sanitize';
import type { Format, RenderedPage } from './types';

interface PdfOptions {
  format: Format;
  count: number;
  getPage: (index: number) => Promise<RenderedPage>;
  signal: AbortSignal;
  onProgress: (completed: number, total: number) => void;
}
const MAX_TILES = 500;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 8_000_000;
function check(signal: AbortSignal) { signal.throwIfAborted(); }
function bounded<T>(promise: Promise<T>, signal: AbortSignal, milliseconds = 20000): Promise<T> {
  check(signal);
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(signal.reason ?? new DOMException('취소됨', 'AbortError')); };
    const timer = setTimeout(() => { finish(); reject(new Error('PDF 렌더링 시간이 초과되었습니다.')); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { finish(); resolve(value); }, error => { finish(); reject(error); });
  });
}

/** Raster PDF export. No file data leaves the browser or enters persistent storage. */
export async function createDocumentPdf(options: PdfOptions): Promise<Blob> {
  const { format, count, getPage, signal, onProgress } = options;
  if (!Number.isInteger(count) || count < 1 || count > MAX_TILES) throw new Error('PDF로 변환할 페이지 수가 너무 많습니다 (최대 500).');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  let tiles = 0;
  let imageBytes = 0;
  for (let index = 0; index < count; index++) {
    check(signal);
    const rendered = await bounded(getPage(index), signal, 60000);
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-20000px;top:0;border:0;pointer-events:none;';
    frame.width = String(Math.max(800, Math.min(10000, rendered.width)));
    frame.height = '1200';
    let svgUrl: string | undefined;
    try {
      const loaded = new Promise<void>((resolve, reject) => { frame.onload = () => resolve(); frame.onerror = () => reject(new Error('PDF 페이지를 준비하지 못했습니다.')); });
      frame.srcdoc = previewDocument(rendered.html, rendered.width, 1);
      document.body.append(frame);
      await bounded(loaded, signal);
      const doc = frame.contentDocument;
      const root = doc?.getElementById('folio-page');
      if (!doc || !root) throw new Error('PDF 페이지를 준비하지 못했습니다.');
      const style = doc.createElement('style');
      style.textContent = 'html,body{background:white!important;min-height:0!important;padding:0!important;margin:0!important}#folio-page{margin:0!important;box-shadow:none!important;zoom:1!important}.sheet-table thead{position:static!important}.selection-info{display:none!important}.cell-selected{box-shadow:none!important}.cell-active{outline:none!important}';
      doc.head.append(style);
      root.querySelectorAll('.cell-selected,.cell-active').forEach(el => el.classList.remove('cell-selected', 'cell-active'));
      await bounded(doc.fonts.ready, signal);
      await bounded(Promise.all(Array.from(root.querySelectorAll('img')).map(async img => {
        if (img.complete && img.naturalWidth) return;
        await img.decode();
      })), signal);
      const width = Math.ceil(Math.max(root.scrollWidth, root.getBoundingClientRect().width));
      const height = Math.ceil(Math.max(root.scrollHeight, root.getBoundingClientRect().height));
      if (!Number.isFinite(width * height) || width < 1 || height < 1 || width > 100000 || height > 1000000) throw new Error('PDF 변환 가능한 문서 크기를 초과했습니다.');
      const slide = format === 'pptx';
      const sourcePage = slide || format === 'hwp' || format === 'hwpx' || (format === 'docx' && height <= width * 1.55);
      const tileWidth = sourcePage ? width : Math.min(width, 1000);
      const tileHeight = sourcePage ? height : Math.ceil(tileWidth * 1.4142);
      // Prefer actual column edges; exceptionally wide individual cells still need tiling.
      const columnElements = root.querySelectorAll('col').length ? root.querySelectorAll('col') : root.querySelectorAll('tr:first-child > th,tr:first-child > td');
      const columnEnds = format === 'xlsx' ? Array.from(columnElements).map(cell => Math.round(cell.getBoundingClientRect().right - root.getBoundingClientRect().left)).sort((a, b) => a - b) : [];
      const columns: Array<{ x: number; width: number }> = [];
      for (let x = 0; x < width;) {
        let end = Math.min(width, x + tileWidth);
        if (columnEnds.length && end < width) end = columnEnds.filter(value => value > x && value <= end).at(-1) ?? end;
        columns.push({ x, width: end - x });
        x = end;
      }
      const rowEnds = format === 'xlsx' ? Array.from(root.querySelectorAll('tr')).map(row => Math.round(row.getBoundingClientRect().bottom - root.getBoundingClientRect().top)) : [];
      const svg = root.children.length === 1 && root.firstElementChild?.localName === 'svg' ? root.firstElementChild as SVGSVGElement : null;
      let svgImage: HTMLImageElement | undefined;
      if (svg) {
        const clone = svg.cloneNode(true) as SVGSVGElement;
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', String(width));
        clone.setAttribute('height', String(height));
        svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
        svgImage = new Image();
        svgImage.src = svgUrl;
        await bounded(svgImage.decode(), signal);
      }
      const estimated = columns.length * Math.ceil(height / tileHeight);
      if (tiles + estimated > MAX_TILES) throw new Error('PDF가 500페이지를 초과합니다. 문서를 나눠서 변환해 주세요.');
      for (let y = 0; y < height;) {
        let end = Math.min(height, y + tileHeight);
        if (rowEnds.length && end < height) {
          const boundary = rowEnds.filter(value => value > y && value <= end).at(-1);
          if (boundary) end = boundary;
        }
        const cropHeight = end - y;
        for (const { x, width: cropWidth } of columns) {
          check(signal);
          if (++tiles > MAX_TILES) throw new Error('PDF가 500페이지를 초과합니다.');
          const scale = Math.min(1.5, Math.sqrt(MAX_PIXELS / (cropWidth * cropHeight)), 8192 / Math.max(cropWidth, cropHeight));
          let canvas: HTMLCanvasElement | undefined;
          try {
            if (svgImage) {
              canvas = document.createElement('canvas');
              canvas.width = Math.ceil(cropWidth * scale);
              canvas.height = Math.ceil(cropHeight * scale);
              const ctx = canvas.getContext('2d');
              if (!ctx) throw new Error('PDF 이미지 메모리를 확보하지 못했습니다.');
              ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(svgImage, x, y, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
            } else {
              // html2canvas is not abortable; await completion before removing its source frame.
              canvas = await html2canvas(root, { backgroundColor: '#ffffff', scale, x, y, width: cropWidth, height: cropHeight, windowWidth: width, windowHeight: 1200, scrollX: 0, scrollY: 0, useCORS: false, allowTaint: false, imageTimeout: 15000, logging: false, removeContainer: true });
            }
            check(signal);
            const data = canvas.toDataURL('image/jpeg', 0.94);
            imageBytes += Math.ceil(data.length * 0.75);
            if (imageBytes > MAX_IMAGE_BYTES) throw new Error('PDF 이미지 용량이 64MB를 초과합니다. 문서를 나눠서 변환해 주세요.');
            const pageWidth = slide ? 841.89 : 595.28;
            const pageHeight = sourcePage ? pageWidth * height / width : 841.89;
            if (tiles === 1) pdf.deletePage(1);
            pdf.addPage([pageWidth, pageHeight], pageWidth > pageHeight ? 'landscape' : 'portrait');
            const margin = sourcePage ? 0 : 18;
            const ratio = Math.min((pageWidth - margin * 2) / tileWidth, (pageHeight - margin * 2) / tileHeight);
            pdf.addImage(data, 'JPEG', margin, margin, cropWidth * ratio, cropHeight * ratio, undefined, 'FAST');
          } finally { if (canvas) { canvas.width = 0; canvas.height = 0; } }
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        y = end;
      }
      onProgress(index + 1, count);
    } finally {
      frame.remove();
      if (svgUrl) URL.revokeObjectURL(svgUrl);
    }
  }
  check(signal);
  const output = pdf.output('blob');
  if (output.size > 80 * 1024 * 1024) throw new Error('PDF 파일이 80MB를 초과합니다.');
  return output;
}
