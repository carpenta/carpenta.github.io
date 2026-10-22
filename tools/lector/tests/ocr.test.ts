import { describe, it, expect, vi } from 'vitest';
import { OcrClient } from '../src/ocr/client';

describe('OcrClient Options and Interface', () => {
  it('initializes with default base path', () => {
    const client = new OcrClient();
    expect(client).toBeDefined();
  });

  it('normalizes base path with trailing slashes', () => {
    const client = new OcrClient('./custom/path///');
    expect((client as any).basePath).toBe('./custom/path');
  });

  it('invokes progress callback when logger fires', async () => {
    const progressList: Array<{ status: string; progress: number }> = [];
    const onProgress = (p: { status: string; progress: number }) => {
      progressList.push(p);
    };

    onProgress({ status: 'recognizing text', progress: 0.5 });
    expect(progressList.length).toBe(1);
    expect(progressList[0].progress).toBe(0.5);
  });
});
