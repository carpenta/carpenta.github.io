import { createRequire } from 'node:module';
import { expect, test } from 'vitest';
import { lz4Frame } from '../src/codecs';

const lz4js = createRequire(import.meta.url)('lz4js');

test('lz4 frame round-trips text with long repeats', () => {
  const text = new TextEncoder().encode('tabula '.repeat(5000) + Array.from({ length: 3000 }, (_, i) => i).join(','));
  const packed = new Uint8Array(lz4js.compress(text));
  expect(packed.length).toBeLessThan(text.length);
  expect(lz4Frame(packed)).toEqual(text);
});

test('lz4 frame keeps incompressible bytes', () => {
  const bytes = Uint8Array.from({ length: 70000 }, (_, i) => (i * 2654435761) >>> 24);
  expect(lz4Frame(new Uint8Array(lz4js.compress(bytes)))).toEqual(bytes);
});
