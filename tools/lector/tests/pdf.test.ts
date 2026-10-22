import { describe, it, expect } from 'vitest';
import { extractDirectPageText } from '../src/pdf/reader';
import type { PDFPageProxy } from 'pdfjs-dist';

describe('PDF Direct Text Extraction', () => {
  it('extracts multi-line text based on transform Y coordinate', async () => {
    const mockPage = {
      getTextContent: async () => ({
        items: [
          { str: 'Invoice No: 12345', transform: [1, 0, 0, 1, 50, 700] },
          { str: 'Date: 2026-10-22', transform: [1, 0, 0, 1, 200, 700] },
          { str: 'Total Amount: $500', transform: [1, 0, 0, 1, 50, 650] },
        ],
        styles: {},
      }),
    } as unknown as PDFPageProxy;

    const result = await extractDirectPageText(mockPage);
    expect(result.hasText).toBe(true);
    expect(result.text).toContain('Invoice No: 12345 Date: 2026-10-22');
    expect(result.text).toContain('Total Amount: $500');
    expect(result.charCount).toBeGreaterThan(10);
  });

  it('detects scanned/empty PDF pages without text layer', async () => {
    const mockPageEmpty = {
      getTextContent: async () => ({
        items: [],
        styles: {},
      }),
    } as unknown as PDFPageProxy;

    const result = await extractDirectPageText(mockPageEmpty);
    expect(result.hasText).toBe(false);
    expect(result.text).toBe('');
    expect(result.charCount).toBe(0);
  });
});
