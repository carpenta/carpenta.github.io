import { createWorker, type Worker } from 'tesseract.js';

export type SupportedLang = 'kor' | 'eng' | 'kor+eng';

export interface OcrProgress {
  status: string;
  progress: number; // 0.0 ~ 1.0
}

export type OcrProgressCallback = (p: OcrProgress) => void;

export interface OcrOptions {
  lang?: SupportedLang;
  whitelist?: string; // e.g. "0123456789-"
  onProgress?: OcrProgressCallback;
}

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: BoundingBox;
}

export interface OcrResult {
  text: string;
  confidence: number;
  words?: OcrWord[];
}

export class OcrClient {
  private worker: Worker | null = null;
  private currentLang: string | null = null;
  private basePath: string;

  constructor(basePath: string = './tessdata') {
    this.basePath = basePath.replace(/\/+$/, '');
  }

  /** 워커를 생성하거나 이미 생성된 워커를 재사용합니다. */
  async getWorker(lang: SupportedLang, onProgress?: OcrProgressCallback): Promise<Worker> {
    const langKey = lang === 'kor+eng' ? 'kor+eng' : lang;

    if (this.worker && this.currentLang === langKey) {
      return this.worker;
    }

    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }

    const workerOptions = {
      workerPath: `${this.basePath}/worker.min.js`,
      corePath: `${this.basePath}/tesseract-core-simd-lstm.wasm.js`,
      langPath: this.basePath,
      gzip: true,
      logger: (m: any) => {
        if (onProgress && typeof m.progress === 'number') {
          onProgress({
            status: m.status || '인식 중',
            progress: m.progress,
          });
        }
      },
    };

    const langsArg = lang === 'kor+eng' ? ['kor', 'eng'] : [lang];
    this.worker = await createWorker(langsArg, 1, workerOptions);
    this.currentLang = langKey;

    return this.worker;
  }

  /** 이미지나 캔버스를 OCR 처리합니다. */
  async recognize(
    image: HTMLCanvasElement | ImageData | string,
    options: OcrOptions = {}
  ): Promise<OcrResult> {
    const lang = options.lang || 'kor+eng';
    const worker = await this.getWorker(lang, options.onProgress);

    if (options.whitelist) {
      await worker.setParameters({
        tessedit_char_whitelist: options.whitelist,
      });
    } else {
      // 화이트리스트 초기화 (빈 문자열이면 모든 문자 허용)
      await worker.setParameters({
        tessedit_char_whitelist: '',
      });
    }

    const ret = await worker.recognize(image as any);

    const words: OcrWord[] = ((ret.data as any).words || []).map((w: any) => ({
      text: w.text,
      confidence: w.confidence,
      bbox: {
        x0: w.bbox.x0,
        y0: w.bbox.y0,
        x1: w.bbox.x1,
        y1: w.bbox.y1,
      },
    }));

    return {
      text: ret.data.text.trim(),
      confidence: ret.data.confidence,
      words,
    };
  }

  /** 워커 종료 및 메모리 해제 */
  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.currentLang = null;
    }
  }
}
