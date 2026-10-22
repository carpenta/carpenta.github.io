import { expect, test } from 'vitest';
import {
  float32Cell, binaryCell, bigintFromTwosComplement, formatDate, formatDecimal, formatTime, formatTimestamp,
  int96ToNanos, nestedCell, nullCell, numberCell, stringCell,
} from '../src/cells';

test('timestamps keep every digit of their unit', () => {
  expect(formatTimestamp(0n, 'ms')).toBe('1970-01-01 00:00:00.000');
  expect(formatTimestamp(-1n, 'us')).toBe('1969-12-31 23:59:59.999999');
  expect(formatTimestamp(1700000000123456789n, 'ns')).toBe('2023-11-14 22:13:20.123456789');
});

test('dates and times', () => {
  expect(formatDate(0)).toBe('1970-01-01');
  expect(formatDate(-1)).toBe('1969-12-31');
  expect(formatTime(3723004n, 'ms')).toBe('01:02:03.004');
});

test('decimals apply scale exactly', () => {
  expect(formatDecimal(12345n, 2)).toBe('123.45');
  expect(formatDecimal(-5n, 3)).toBe('-0.005');
  expect(formatDecimal(7n, 0)).toBe('7');
  expect(formatDecimal(9223372036854775807n, 4)).toBe('922337203685477.5807');
});

test('two complement big-endian bytes', () => {
  expect(bigintFromTwosComplement(new Uint8Array([0xff, 0xfe]))).toBe(-2n);
  expect(bigintFromTwosComplement(new Uint8Array([0x01, 0x00]))).toBe(256n);
});

test('INT96 epoch day plus one nanosecond', () => {
  expect(int96ToNanos(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0x8c, 0x3d, 0x25, 0x00]))).toBe(1n);
});

test('NULL, empty string and empty list stay distinct', () => {
  expect(nullCell).toMatchObject({ kind: 'null', text: 'NULL', json: null });
  expect(stringCell('')).toMatchObject({ kind: 'string', text: '""', full: '', json: '' });
  expect(nestedCell([])).toMatchObject({ kind: 'nested', text: '[]' });
});

test('int64 stays exact and always exports as a string', () => {
  expect(numberCell(9007199254740993n)).toMatchObject({ text: '9007199254740993', json: '9007199254740993' });
  expect(numberCell(42n).json).toBe('42');
  expect(numberCell(42).json).toBe(42);
});

test('float32 prints the shortest text that round-trips as float32', () => {
  expect(float32Cell(Math.fround(0.1)).text).toBe('0.1');
  expect(float32Cell(Math.fround(249.75)).text).toBe('249.75');
  expect(float32Cell(Math.fround(1 / 3)).text).toBe('0.33333334');
  expect(float32Cell(Math.fround(0.1)).json).toBe(0.1);
  expect(float32Cell(NaN).text).toBe('NaN');
});

test('binary preview and truncation', () => {
  expect(binaryCell(new Uint8Array(40)).text).toBe('0x' + '00'.repeat(32) + '… (40 B)');
  const long = stringCell('a'.repeat(500));
  expect(long.text.length).toBe(201);
  expect(long.full.length).toBe(500);
});
