import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { recalculateWorkbook } from '../src/formula-calculation';

function book(sheets: Record<string, XLSX.WorkSheet>) {
  return { SheetNames: Object.keys(sheets), Sheets: sheets } as XLSX.WorkBook;
}
const formula = (f: string, v = 999): XLSX.CellObject => ({ t: 'n', f, v, w: 'stale' });

describe('safe workbook formula calculation', () => {
  it('calculates arithmetic, range aggregates, conditional formulas and recursive cross-sheet references', () => {
    const workbook = book({
      Main: { '!ref': 'A1:D3', A1: { t: 'n', v: 2 }, A2: { t: 'n', v: 4 }, B1: formula('SUM(A1:A2)'), B2: formula('AVERAGE(A1:A2)'), C1: formula('IF(B1>5,B1*2,0)'), D1: formula("'Other sheet'!A1+C1") },
      'Other sheet': { '!ref': 'A1', A1: formula('Main!B2+1') },
    });
    expect(recalculateWorkbook(workbook)).toMatchObject({ calculated: 5, unsupported: 0 });
    expect(workbook.Sheets.Main.D1.v).toBe(16);
    expect(workbook.Sheets.Main.B1.w).toBeUndefined();
  });
  it('keeps number formatting after removing stale formatted cache', () => {
    const cell = { ...formula('1/4'), z: '0.0%' };
    recalculateWorkbook(book({ Main: { '!ref': 'A1', A1: cell } }));
    expect(XLSX.utils.format_cell(cell)).toBe('25.0%');
  });
  it('retains cached results and propagates unsupported dependencies, even through IFERROR', () => {
    const workbook = book({ Main: { '!ref': 'A1:C1', A1: formula('XLOOKUP(1,B1,C1)', 11), B1: formula('A1+1', 12), C1: formula('IFERROR(A1,0)', 13) } });
    expect(recalculateWorkbook(workbook)).toMatchObject({ calculated: 0, unsupported: 3, warning: expect.any(String) });
    expect([workbook.Sheets.Main.A1.v, workbook.Sheets.Main.B1.v, workbook.Sheets.Main.C1.v]).toEqual([11, 12, 13]);
    expect(workbook.Sheets.Main.A1.w).toBe('stale');
  });
  it('detects cycles without overwriting caches', () => {
    const workbook = book({ Main: { '!ref': 'A1:B1', A1: formula('B1+1', 5), B1: formula('A1+1', 6) } });
    expect(recalculateWorkbook(workbook).unsupported).toBe(2);
    expect(workbook.Sheets.Main.A1.v).toBe(5);
  });
  it('rejects references and ranges into rows omitted by sheetRows', () => {
    const workbook = book({ Main: { '!ref': 'A1:C2', '!fullref': 'A1:C100', A1: { t: 'n', v: 5 }, B1: formula('SUM(A1:A100)'), C1: formula('A50+1') } });
    expect(recalculateWorkbook(workbook, { parsedRowLimit: 2 }).unsupported).toBe(2);
    expect(workbook.Sheets.Main.B1.v).toBe(999);
  });
  it('bounds range work and denies external-data formulas', () => {
    const workbook = book({ Main: { '!ref': 'A1:C1', A1: formula('SUM(D1:Z1000)'), B1: formula('WEBSERVICE("https://example.com")'), C1: formula('[external.xlsx]Sheet1!A1') } });
    expect(recalculateWorkbook(workbook, { maxReferences: 10 }).unsupported).toBe(3);
  });
  it('allows whole-column references only on complete sheets', () => {
    const complete = book({ Main: { '!ref': 'A1:B2', A1: { t: 'n', v: 2 }, A2: { t: 'n', v: 3 }, B1: formula('SUM(A:A)') } });
    expect(recalculateWorkbook(complete).unsupported).toBe(0);
    expect(complete.Sheets.Main.B1.v).toBe(5);
    complete.Sheets.Main['!fullref'] = 'A1:B100';
    expect(recalculateWorkbook(complete).unsupported).toBe(1);
  });
});
