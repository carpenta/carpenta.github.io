import type { Point, QuadPoints } from './types';
import { findHomography, invertMatrix3x3 } from './homography';

function dist(p1: Point, p2: Point): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 4점으로부터 보정 후의 가로/세로 최적 해상도를 추정합니다 (A4/실제비율 유지). */
export function estimateTargetDimensions(corners: QuadPoints): { width: number; height: number } {
  const [tl, tr, br, bl] = corners;
  const widthTop = dist(tl, tr);
  const widthBottom = dist(bl, br);
  const width = Math.max(Math.round(Math.max(widthTop, widthBottom)), 10);

  const heightLeft = dist(tl, bl);
  const heightRight = dist(tr, br);
  const height = Math.max(Math.round(Math.max(heightLeft, heightRight)), 10);

  return { width, height };
}

/**
 * 4점 모서리로 지정된 왜곡 영역을 반듯한 직사각형 이미지로 폅니다 (Perspective Warp).
 * 역방향 매핑(Inverse mapping)과 쌍선형 보간(Bilinear Interpolation)을 사용하여 구멍(Hole) 없는 고품질 결과를 생성합니다.
 */
export function warpPerspective(
  srcData: ImageData,
  srcCorners: QuadPoints,
  targetWidth?: number,
  targetHeight?: number
): ImageData {
  const dims = estimateTargetDimensions(srcCorners);
  const dstW = targetWidth ?? dims.width;
  const dstH = targetHeight ?? dims.height;

  const dstCorners: QuadPoints = [
    { x: 0, y: 0 },
    { x: dstW - 1, y: 0 },
    { x: dstW - 1, y: dstH - 1 },
    { x: 0, y: dstH - 1 }
  ];

  const H = findHomography(srcCorners, dstCorners);
  if (!H) {
    // 변환 불가능할 경우 원본을 그대로 또는 빈 이미지 반환
    return new ImageData(dstW, dstH);
  }

  const H_inv = invertMatrix3x3(H);
  if (!H_inv) {
    return new ImageData(dstW, dstH);
  }

  const [
    m0, m1, m2,
    m3, m4, m5,
    m6, m7, m8
  ] = H_inv;

  const srcW = srcData.width;
  const srcH = srcData.height;
  const srcPixels = srcData.data;

  const dstData = new ImageData(dstW, dstH);
  const dstPixels = dstData.data;

  for (let dy = 0; dy < dstH; dy++) {
    const rowOffset = dy * dstW * 4;
    for (let dx = 0; dx < dstW; dx++) {
      // (dx, dy, 1) * H_inv
      const w = m6 * dx + m7 * dy + m8;
      if (Math.abs(w) < 1e-12) continue;

      const sx = (m0 * dx + m1 * dy + m2) / w;
      const sy = (m3 * dx + m4 * dy + m5) / w;

      if (sx < 0 || sx > srcW - 1 || sy < 0 || sy > srcH - 1) {
        // 배경은 흰색 (문서 스캔 기본값)
        const dIdx = rowOffset + dx * 4;
        dstPixels[dIdx] = 255;
        dstPixels[dIdx + 1] = 255;
        dstPixels[dIdx + 2] = 255;
        dstPixels[dIdx + 3] = 255;
        continue;
      }

      // Bilinear interpolation
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const y0 = Math.floor(sy);
      const y1 = Math.min(y0 + 1, srcH - 1);

      const xDiff = sx - x0;
      const yDiff = sy - y0;
      const w00 = (1 - xDiff) * (1 - yDiff);
      const w10 = xDiff * (1 - yDiff);
      const w01 = (1 - xDiff) * yDiff;
      const w11 = xDiff * yDiff;

      const idx00 = (y0 * srcW + x0) * 4;
      const idx10 = (y0 * srcW + x1) * 4;
      const idx01 = (y1 * srcW + x0) * 4;
      const idx11 = (y1 * srcW + x1) * 4;

      const dIdx = rowOffset + dx * 4;

      for (let c = 0; c < 3; c++) {
        dstPixels[dIdx + c] = Math.round(
          srcPixels[idx00 + c] * w00 +
          srcPixels[idx10 + c] * w10 +
          srcPixels[idx01 + c] * w01 +
          srcPixels[idx11 + c] * w11
        );
      }
      dstPixels[dIdx + 3] = 255; // Alpha
    }
  }

  return dstData;
}
