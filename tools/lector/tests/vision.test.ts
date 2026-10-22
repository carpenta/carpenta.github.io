import { describe, it, expect, beforeAll } from 'vitest';
import { findHomography, invertMatrix3x3, transformPoint } from '../src/vision/homography';
import { estimateTargetDimensions, warpPerspective } from '../src/vision/warp';
import { applyGrayscale, applyContrast, calculateOtsuThreshold, applyBinarization, applyFilters } from '../src/vision/preprocess';
import type { QuadPoints } from '../src/vision/types';

// Node 환경에서 ImageData 폴리필
beforeAll(() => {
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
      width: number;
      height: number;
      data: Uint8ClampedArray;
      colorSpace: PredefinedColorSpace = 'srgb';
      constructor(widthOrData: number | Uint8ClampedArray, heightOrWidth: number, height?: number) {
        if (widthOrData instanceof Uint8ClampedArray) {
          this.data = widthOrData;
          this.width = heightOrWidth;
          this.height = height ?? widthOrData.length / (4 * heightOrWidth);
        } else {
          this.width = widthOrData;
          this.height = heightOrWidth;
          this.data = new Uint8ClampedArray(this.width * this.height * 4);
        }
      }
    } as any;
  }
});

describe('Homography and Perspective Math', () => {
  it('computes identity homography correctly', () => {
    const quad: QuadPoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];

    const H = findHomography(quad, quad);
    expect(H).not.toBeNull();
    if (!H) return;

    // H should transform any point on the quad to itself
    const p1 = transformPoint(H, { x: 50, y: 50 });
    expect(Math.round(p1.x)).toBe(50);
    expect(Math.round(p1.y)).toBe(50);
  });

  it('inverts 3x3 matrix correctly', () => {
    const quadSrc: QuadPoints = [
      { x: 10, y: 10 },
      { x: 90, y: 15 },
      { x: 85, y: 95 },
      { x: 15, y: 90 }
    ];
    const quadDst: QuadPoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];

    const H = findHomography(quadSrc, quadDst);
    expect(H).not.toBeNull();
    if (!H) return;

    const H_inv = invertMatrix3x3(H);
    expect(H_inv).not.toBeNull();
    if (!H_inv) return;

    // Forward transform pSrc -> pDst
    const pDst = transformPoint(H, quadSrc[1]);
    expect(Math.round(pDst.x)).toBe(100);
    expect(Math.round(pDst.y)).toBe(0);

    // Inverse transform pDst -> pSrc
    const pRecovered = transformPoint(H_inv, { x: 100, y: 0 });
    expect(Math.round(pRecovered.x)).toBe(90);
    expect(Math.round(pRecovered.y)).toBe(15);
  });

  it('estimates dimensions of a rectangular quad', () => {
    const quad: QuadPoints = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 }
    ];
    const dims = estimateTargetDimensions(quad);
    expect(dims.width).toBe(200);
    expect(dims.height).toBe(100);
  });

  it('warps a simple 4x4 image without error', () => {
    const src = new ImageData(4, 4);
    // Fill with red
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = 255;
      src.data[i + 1] = 0;
      src.data[i + 2] = 0;
      src.data[i + 3] = 255;
    }

    const corners: QuadPoints = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 }
    ];

    const warped = warpPerspective(src, corners, 4, 4);
    expect(warped.width).toBe(4);
    expect(warped.height).toBe(4);
    expect(warped.data[0]).toBe(255); // Red preserved
  });
});

describe('Image Preprocessing & Binarization', () => {
  it('converts RGB to grayscale using Rec. 601', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255]); // Pure red
    applyGrayscale(data);
    // 0.299 * 255 = 76
    expect(data[0]).toBe(76);
    expect(data[1]).toBe(76);
    expect(data[2]).toBe(76);
  });

  it('applies contrast enhancement', () => {
    // 128 is center, should remain 128
    const data = new Uint8ClampedArray([128, 128, 128, 255]);
    applyContrast(data, 2.0);
    expect(data[0]).toBe(128);

    // 200 > 128, (200 - 128) * 1.5 + 128 = 72 * 1.5 + 128 = 236
    const data2 = new Uint8ClampedArray([200, 200, 200, 255]);
    applyContrast(data2, 1.5);
    expect(data2[0]).toBe(236);
  });

  it('calculates Otsu threshold correctly on bimodal distribution', () => {
    // Half dark (30), half bright (220)
    const data = new Uint8ClampedArray(8 * 4);
    for (let i = 0; i < 4; i++) {
      data[i * 4] = 30;
      data[i * 4 + 1] = 30;
      data[i * 4 + 2] = 30;
      data[i * 4 + 3] = 255;
    }
    for (let i = 4; i < 8; i++) {
      data[i * 4] = 220;
      data[i * 4 + 1] = 220;
      data[i * 4 + 2] = 220;
      data[i * 4 + 3] = 255;
    }

    const threshold = calculateOtsuThreshold(data);
    expect(threshold).toBeGreaterThanOrEqual(30);
    expect(threshold).toBeLessThanOrEqual(220);

    applyBinarization(data, threshold);
    // First pixel should become black (0)
    expect(data[0]).toBe(0);
    // Last pixel should become white (255)
    expect(data[7 * 4]).toBe(255);
  });

  it('applies combined filters without mutating source', () => {
    const src = new ImageData(2, 2);
    src.data[0] = 50;
    src.data[1] = 100;
    src.data[2] = 150;
    src.data[3] = 255;

    const filtered = applyFilters(src, { grayscale: true, contrast: 1.2, binarize: true, threshold: 100 });
    expect(filtered).not.toBe(src);
    expect(src.data[0]).toBe(50); // Original intact
  });
});
