import { expect, test } from 'vitest';
import { avroReader } from '../src/readers/avro';
import { TabulaError } from '../src/types';
import { nodeSource, signal } from './helpers';

const ROW0 = [
  '0', '-500', '0', '0', 'true', '""', '0x000102', 'RED', '0x00aabbcc', '[]', '{"k":"0"}', 'NULL', 'NULL',
  '{"x":0,"y":"GREEN"}', '123.45', '00000000-0000-4000-8000-000000000000', '2022-01-08', '01:02:03.004',
  '01:02:03.004005', '2023-11-14 22:13:20.000', '2023-11-14 22:13:20.000000', '2023-11-14 22:13:20.000000000',
  '2023-11-14 22:13:20.000000',
];

test.each(['null', 'deflate', 'snappy', 'zstandard'])('reads %s codec', async (codec) => {
  const r = avroReader(nodeSource(`avro-all-types-${codec}.avro`));
  const s = await r.open();
  expect(s.format).toBe('avro');
  expect(s.codec).toBe(codec);
  expect(s.rowCount).toBeNull();
  expect(s.columns.map((c) => c.name)).toEqual(s.suggestedColumns);
  const p = await r.readPage(0, 100, s.suggestedColumns, signal());
  expect(p.rows).toHaveLength(100);
  expect(p.rows[0].map((c) => c.text)).toEqual(ROW0);
});

test('unions with several non-null branches show the branch, and row 999 decodes', async () => {
  const r = avroReader(nodeSource('avro-all-types-deflate.avro'));
  const s = await r.open();
  const p = await r.readPage(900, 100, ['id', 'multi', 'f32', 'name'], signal());
  // 페이지의 컬럼 순서는 요청 순서가 아니라 파일 스키마 순서다
  expect(p.columns).toEqual(['id', 'f32', 'name', 'multi']);
  expect(p.rows[1][3].text).toBe('long: 901');
  expect(p.rows[2][3].text).toBe('string: s902');
  expect(p.rows[2][3].json).toBe('s902');
  expect(p.rows[99].map((c) => c.text)).toEqual([String(999n * 1000000007n), '249.75', 'name-999', 'NULL']);
  expect(p.eof).toBe(true);
  expect(s.columns.find((c) => c.name === 'multi')?.type).toBe('union<long|string>?');
  expect(s.columns.find((c) => c.name === 'opt')?.type).toBe('string?');
  const type = (n: string) => s.columns.find((c) => c.name === n)?.type;
  expect([type('ts_ms'), type('ts_us'), type('ts_ns'), type('lts')]).toEqual([
    'timestamp(ms, UTC)', 'timestamp(us, UTC)', 'timestamp(ns, UTC)', 'local-timestamp(us)',
  ]);
  expect(s.columns.find((c) => c.name === 'inner')?.children?.map((c) => c.name)).toEqual(['x', 'y']);
});

test('metadata shows schema, codec and user metadata', async () => {
  const s = await avroReader(nodeSource('avro-all-types-zstandard.avro')).open();
  const file = s.metadata.find((m) => m.title === '파일');
  expect(file?.pairs).toContainEqual(['codec', 'zstandard']);
  expect(file?.pairs).toContainEqual(['tabula.test', 'yes']);
  expect(s.metadata.find((m) => m.title === '스키마')?.json).toContain('"timestamp-nanos"');
});

test('opening a big file and its first page reads under 5% of it', async () => {
  const src = nodeSource('avro-big.avro');
  const r = avroReader(src);
  const s = await r.open();
  await r.readPage(0, 100, s.suggestedColumns, signal());
  expect(src.bytesRead).toBeLessThan(src.byteLength * 0.05);
});

test('jumping to row 150000 reads only block headers before it', async () => {
  const src = nodeSource('avro-big.avro');
  const r = avroReader(src);
  const s = await r.open();
  const p = await r.readPage(150000, 100, s.suggestedColumns, signal());
  expect(p.rows[0][0].text).toBe(String(150000n * 1000000007n));
  expect(src.bytesRead).toBeLessThan(src.byteLength * 0.05);
  const back = await r.readPage(100, 100, ['id'], signal());
  expect(back.rows[0][0].text).toBe(String(100n * 1000000007n));
});

test('reading past the end reports eof and the real total', async () => {
  const r = avroReader(nodeSource('avro-big.avro'));
  const s = await r.open();
  const p = await r.readPage(250000, 100, s.suggestedColumns, signal());
  expect(p.rows).toEqual([]);
  expect(p.eof).toBe(true);
  expect(p.total).toBe(200000);
});

test('countRows notices a damaged sync marker', async () => {
  const r = avroReader(nodeSource('avro-bad-sync.avro'));
  await r.open();
  await expect(r.countRows(signal(), () => {})).rejects.toMatchObject({ code: 'corrupt' });
});

test('countRows walks every block', async () => {
  const r = avroReader(nodeSource('avro-big.avro'));
  await r.open();
  const seen: number[] = [];
  expect(await r.countRows(signal(), (n) => seen.push(n))).toBe(200000);
  expect(seen.length).toBeGreaterThan(0);
});

test('a truncated file fails with corrupt when the page reaches the cut', async () => {
  const r = avroReader(nodeSource('truncated.avro'));
  const s = await r.open();
  await expect(r.readPage(0, 100, s.suggestedColumns, signal())).resolves.toBeTruthy();
  await expect(r.readPage(190000, 100, s.suggestedColumns, signal())).rejects.toMatchObject({ code: 'corrupt' });
});

test('aborted countRows fails with cancelled', async () => {
  const r = avroReader(nodeSource('avro-big.avro'));
  await r.open();
  const ac = new AbortController();
  ac.abort();
  const err = await r.countRows(ac.signal, () => {}).catch((e) => e);
  expect(err).toBeInstanceOf(TabulaError);
  expect(err.code).toBe('cancelled');
});
