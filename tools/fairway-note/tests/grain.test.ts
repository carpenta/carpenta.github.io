import { describe, expect, it } from 'vitest';
import { grainPixels, SAND_GRAIN, TURF_GRAIN, type Rgba } from '../src/grain';

// The drawn course's tints in the palette's spirit: deep at 30%, sun at 20% (the page reads the real tokens).
const DARK: Rgba = [20, 43, 32, 0.3];
const LIGHT: Rgba = [195, 213, 90, 0.2];

/** The tile's alpha as 0–1 values, one per pixel. */
const alphas = (px: Uint8ClampedArray) => Array.from({ length: px.length / 4 }, (_, i) => px[i * 4 + 3] / 255);

describe('the grain tile for the drawn course (v22): seeded noise made once on a canvas, no SVG filter', () => {
  it('is one size per screen: the tile in CSS px times the device scale', () => {
    for (const scale of [1, 2, 3]) {
      expect(grainPixels(TURF_GRAIN, scale, DARK, LIGHT)).toHaveLength((TURF_GRAIN.css * scale) ** 2 * 4);
      expect(grainPixels(SAND_GRAIN, scale, DARK, LIGHT)).toHaveLength((SAND_GRAIN.css * scale) ** 2 * 4);
    }
  });

  it('is the same tile every time: seeded, not random', () => {
    expect(grainPixels(TURF_GRAIN, 2, DARK, LIGHT)).toEqual(grainPixels(TURF_GRAIN, 2, DARK, LIGHT));
    expect(grainPixels({ ...TURF_GRAIN, seed: TURF_GRAIN.seed + 1 }, 2, DARK, LIGHT)).not.toEqual(grainPixels(TURF_GRAIN, 2, DARK, LIGHT));
  });

  it('is fine and faint: specks over part of the tile, at most the tints’ own alpha, a few percent on average', () => {
    for (const spec of [TURF_GRAIN, SAND_GRAIN]) {
      const a = alphas(grainPixels(spec, 3, DARK, LIGHT));
      const max = Math.max(...a);
      const mean = a.reduce((s, x) => s + x, 0) / a.length;
      const covered = a.filter((x) => x > 0).length / a.length;
      expect(max).toBeLessThanOrEqual(0.3 + 0.2 + 0.01);
      expect(mean).toBeGreaterThan(0.01);
      expect(mean).toBeLessThan(0.08);
      expect(covered).toBeGreaterThan(0.2);
      expect(covered).toBeLessThan(0.8);
    }
  });

  it('holds only the two tints: every speck is the dark one, the light one, or the two laid over each other', () => {
    const px = grainPixels(TURF_GRAIN, 2, DARK, LIGHT);
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      // Between the dark and the light tint on every channel (a mix of the two, never a third colour).
      for (let c = 0; c < 3; c++) {
        expect(px[i + c]).toBeGreaterThanOrEqual(Math.min(DARK[c], LIGHT[c]) - 1);
        expect(px[i + c]).toBeLessThanOrEqual(Math.max(DARK[c], LIGHT[c]) + 1);
      }
    }
  });

  it('repeats without a seam: across the tile’s edge the noise changes no more than between neighbours inside it', () => {
    for (const spec of [TURF_GRAIN, SAND_GRAIN]) {
      for (const scale of [2, 3]) {
        const n = spec.css * scale;
        const a = alphas(grainPixels(spec, scale, DARK, LIGHT));
        const at = (x: number, y: number) => a[y * n + x];
        // The change from one column (or row) to the next, summed down it: at the seam, and on average inside.
        const across = (k: number, j: number, vertical: boolean) => {
          let sum = 0;
          for (let i = 0; i < n; i++) sum += Math.abs(vertical ? at(i, k) - at(i, j) : at(k, i) - at(j, i));
          return sum;
        };
        for (const vertical of [false, true]) {
          let inside = 0;
          for (let k = 0; k < n - 1; k++) inside += across(k, k + 1, vertical);
          inside /= n - 1;
          expect(across(n - 1, 0, vertical)).toBeLessThanOrEqual(inside * 1.4);
        }
      }
    }
  });

  it('draws the turf grain coarser than the sand’s, in a larger tile', () => {
    expect(TURF_GRAIN.css).toBeGreaterThan(SAND_GRAIN.css);
    expect(TURF_GRAIN.feature).toBeGreaterThan(SAND_GRAIN.feature);
  });
});
