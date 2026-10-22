import { expect, test } from 'vitest';
import { detectFormat } from '../src/detect';
import { fileSource } from '../src/source';

const b = (s: string) => new TextEncoder().encode(s);

test('parquet needs PAR1 at both ends', () => {
  expect(detectFormat(b('PAR1xxxx'), b('xxxxPAR1'))).toBe('parquet');
  expect(detectFormat(b('PAR1xxxx'), b('xxxxxxxx'))).toBeNull();
});

test('arrow file and stream', () => {
  expect(detectFormat(b('ARROW1\0\0'), b('ARROW1'))).toBe('arrow-file');
  expect(detectFormat(new Uint8Array([0xff, 0xff, 0xff, 0xff, 8, 0, 0, 0]), b('x'))).toBe('arrow-stream');
});

test('avro', () => {
  expect(detectFormat(new Uint8Array([0x4f, 0x62, 0x6a, 0x01]), b('x'))).toBe('avro');
});

test('csv is not supported', () => {
  expect(detectFormat(b('a,b,c\n1,2,3'), b('1,2,3'))).toBeNull();
});

test('fileSource counts bytes it read', async () => {
  const src = fileSource(new Blob([new Uint8Array(1000)]));
  await src.read(0, 10);
  await src.read(990, 1000);
  expect(src.bytesRead).toBe(20);
  expect(src.byteLength).toBe(1000);
});

test('fileSource counts each byte once even when ranges overlap', async () => {
  const src = fileSource(new Blob([new Uint8Array(1000)]));
  await src.read(0, 100);
  await src.read(50, 150);
  await src.read(0, 100);
  await src.read(900, 2000);
  expect(src.bytesRead).toBe(250);
});
