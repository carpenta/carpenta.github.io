import type { FilterOptions } from './types';

/** 이미지 데이터를 흑백(Grayscale, 가중 휘도값)으로 변환합니다. */
export function applyGrayscale(data: Uint8ClampedArray): void {
  const len = data.length;
  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Rec. 601 표준 휘도 공식
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
}

/** 대비(Contrast)를 조절합니다. factor: 1.0(기본), >1.0(대비 증가), <1.0(대비 감소) */
export function applyContrast(data: Uint8ClampedArray, factor: number): void {
  const len = data.length;
  for (let i = 0; i < len; i += 4) {
    for (let c = 0; c < 3; c++) {
      const val = data[i + c];
      const newVal = Math.round((val - 128) * factor + 128);
      data[i + c] = Math.max(0, Math.min(255, newVal));
    }
  }
}

/** 오츠(Otsu) 알고리즘으로 전경과 배경을 가르는 최적의 이진화 임계값을 계산합니다. */
export function calculateOtsuThreshold(data: Uint8ClampedArray): number {
  const histogram = new Array(256).fill(0);
  const totalPixels = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i]; // 이미 그레이스케일이거나 R 채널 기준
    histogram[gray]++;
  }

  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let varMax = 0;
  let threshold1 = 128;
  let threshold2 = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;

    wF = totalPixels - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];

    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;

    // 분산 = wB * wF * (mB - mF)^2
    const varBetween = wB * wF * (mB - mF) * (mB - mF);

    if (varBetween > varMax) {
      varMax = varBetween;
      threshold1 = t;
      threshold2 = t;
    } else if (varBetween === varMax && varMax > 0) {
      threshold2 = t;
    }
  }

  return Math.floor((threshold1 + threshold2) / 2);
}

/** 주어진 임계값으로 이미지를 완전한 흑백(0 또는 255)으로 이진화합니다. */
export function applyBinarization(data: Uint8ClampedArray, threshold: number): void {
  const len = data.length;
  for (let i = 0; i < len; i += 4) {
    const gray = data[i];
    const val = gray >= threshold ? 255 : 0;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }
}

/** 필터 옵션을 적용하여 복제된 새 ImageData를 생성합니다. */
export function applyFilters(src: ImageData, options: FilterOptions): ImageData {
  const copy = new ImageData(
    new Uint8ClampedArray(src.data),
    src.width,
    src.height
  );

  const data = copy.data;

  // 1. 흑백 변환 (이진화 시에도 선행 필요)
  if (options.grayscale || options.binarize) {
    applyGrayscale(data);
  }

  // 2. 명암 대비 조절
  if (options.contrast !== undefined && options.contrast !== 1.0) {
    applyContrast(data, options.contrast);
  }

  // 3. 이진화
  if (options.binarize) {
    const threshold = options.threshold !== undefined
      ? options.threshold
      : calculateOtsuThreshold(data);
    applyBinarization(data, threshold);
  }

  return copy;
}
