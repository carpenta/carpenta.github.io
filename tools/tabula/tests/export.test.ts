import { expect, test } from 'vitest';
import { nestedCell, nullCell, numberCell, stringCell } from '../src/cells';
import { exportName, toCsv, toJson } from '../src/ui/export';
import type { Page } from '../src/types';

const page: Page = {
  start: 0,
  columns: ['id', 'name', 'tags'],
  rows: [
    [numberCell(9007199254740993n), stringCell('a,"b"'), nestedCell(['x'])],
    [numberCell(2), nullCell, nestedCell([])],
  ],
  eof: true,
};

test('csv quotes commas and quotes, leaves NULL empty and keeps full values', () => {
  expect(toCsv(page)).toBe('id,name,tags\n9007199254740993,"a,""b""","[""x""]"\n2,,[]\n');
});

test('json uses export values with int64 as strings', () => {
  expect(JSON.parse(toJson(page))).toEqual([
    { id: '9007199254740993', name: 'a,"b"', tags: ['x'] },
    { id: 2, name: null, tags: [] },
  ]);
});

test('export file name carries the 1-based row range', () => {
  expect(exportName('events.2026.parquet', 100, 50, 'csv')).toBe('events.2026-rows-101-150.csv');
  expect(exportName('noext', 0, 0, 'json')).toBe('noext-rows-1-0.json');
});
