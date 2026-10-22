import { expect, test } from 'vitest';
import { Cursor, decodeCell, skipValue } from '../src/avro/decode';
import { snappy } from '../src/codecs';

/** zigzag varint */
function long(v: bigint): number[] {
  let z = v >= 0n ? v << 1n : (-v << 1n) - 1n;
  const out: number[] = [];
  do {
    let b = Number(z & 0x7fn);
    z >>= 7n;
    if (z) b |= 0x80;
    out.push(b);
  } while (z);
  return out;
}

const nullArray = { kind: 'array', items: { kind: 'null' } } as const;

test('an array of zero-width items with a huge count fails fast as corrupt', () => {
  const bytes = new Uint8Array([...long(1n << 40n), 0]);
  const t0 = Date.now();
  expect(() => decodeCell(nullArray, new Cursor(bytes))).toThrow(expect.objectContaining({ code: 'corrupt' }));
  expect(() => skipValue(nullArray, new Cursor(bytes))).toThrow(expect.objectContaining({ code: 'corrupt' }));
  expect(Date.now() - t0).toBeLessThan(200);
});

test('an array whose count exceeds the bytes left is corrupt', () => {
  const longs = { kind: 'array', items: { kind: 'long' } } as const;
  const bytes = new Uint8Array([...long(1000000n), 2, 4, 0]);
  expect(() => decodeCell(longs, new Cursor(bytes))).toThrow(expect.objectContaining({ code: 'corrupt' }));
});

test('a small array of nulls still decodes', () => {
  expect(decodeCell(nullArray, new Cursor(new Uint8Array([...long(3n), 0]))).text).toBe('[null,null,null]');
});

test('snappy refuses an absurd declared length', () => {
  expect(() => snappy(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x0f, 0]))).toThrow(/too large/);
});
