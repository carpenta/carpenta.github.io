import { expect, test } from 'vitest';
import { arrowReader } from '../src/readers/arrow';
import { nodeSource, signal } from './helpers';

const ROW0 = ['0', '""', '2023-11-14 22:13:20.000000', '922337203685477.5807', '[]', 'NULL', 'x'];
const ROW1 = ['1', 'NULL', '2023-11-14 22:13:20.000001', '922337203685477.5806', 'NULL', '{"a":1}', 'y'];

const files = [
  ['file', 'arrow-file.arrow', 'arrow-file'],
  ['stream', 'arrow-stream.arrows', 'arrow-stream'],
  ['zstd', 'arrow-zstd.arrows', 'arrow-stream'],
  ['lz4', 'arrow-lz4.arrows', 'arrow-stream'],
] as const;

test.each(files)('reads arrow %s', async (_, name, format) => {
  const r = arrowReader(nodeSource(name), format);
  const s = await r.open();
  expect(s.format).toBe(format);
  expect(s.rowCount).toBeNull();
  expect(s.columns.map((c) => [c.name, c.type])).toEqual([
    ['id', 'int64'], ['name', 'utf8'], ['ts', 'timestamp(us, UTC)'], ['amount', 'decimal(18,4)'],
    ['tags', 'list<utf8>'], ['st', 'struct'], ['cat', 'dictionary<utf8>'],
  ]);
  const p = await r.readPage(0, 100, s.suggestedColumns, signal());
  expect(p.rows).toHaveLength(100);
  expect(p.rows[0].map((c) => c.text)).toEqual(ROW0);
  expect(p.rows[1].map((c) => c.text)).toEqual(ROW1);
});

test('a page crosses a batch boundary', async () => {
  const r = arrowReader(nodeSource('arrow-stream.arrows'), 'arrow-stream');
  await r.open();
  const p = await r.readPage(200, 100, ['id', 'ts'], signal());
  expect(p.columns).toEqual(['id', 'ts']);
  expect(p.rows.map((row) => row[0].text)).toEqual(Array.from({ length: 100 }, (_, i) => String(200 + i)));
  expect(p.rows[99][1].text).toBe('2023-11-14 22:13:20.000299');
});

test('going back restarts and returns the same rows', async () => {
  const r = arrowReader(nodeSource('arrow-file.arrow'), 'arrow-file');
  await r.open();
  const first = await r.readPage(10, 5, ['id'], signal());
  await r.readPage(900, 100, ['id'], signal());
  const again = await r.readPage(10, 5, ['id'], signal());
  expect(again.rows).toEqual(first.rows);
});

test('the last page reports eof', async () => {
  const r = arrowReader(nodeSource('arrow-file.arrow'), 'arrow-file');
  await r.open();
  const p = await r.readPage(950, 100, ['id'], signal());
  expect(p.rows).toHaveLength(50);
  expect(p.eof).toBe(true);
});

test('reading past the end reports eof and the real total', async () => {
  const r = arrowReader(nodeSource('arrow-file.arrow'), 'arrow-file');
  await r.open();
  const p = await r.readPage(4999, 100, ['id'], signal());
  expect(p.rows).toEqual([]);
  expect(p.eof).toBe(true);
  expect(p.total).toBe(1000);
});

test('zoned timestamps are labelled and shown in UTC', async () => {
  const r = arrowReader(nodeSource('arrow-tz.arrows'), 'arrow-stream');
  const s = await r.open();
  expect(s.columns[0].type).toBe('timestamp(us, UTC)');
  const p = await r.readPage(0, 1, ['ts'], signal());
  expect(p.rows[0][0].text).toBe('2023-11-14 22:13:20.000000');
});

test('countRows is 1000 and does not disturb paging', async () => {
  const r = arrowReader(nodeSource('arrow-stream.arrows'), 'arrow-stream');
  await r.open();
  await r.readPage(300, 10, ['id'], signal());
  expect(await r.countRows(signal(), () => {})).toBe(1000);
  const p = await r.readPage(310, 1, ['id'], signal());
  expect(p.rows[0][0].text).toBe('310');
});

test('int64 and decimal export as exact strings', async () => {
  const r = arrowReader(nodeSource('arrow-zstd.arrows'), 'arrow-stream');
  const s = await r.open();
  const p = await r.readPage(0, 1, s.suggestedColumns, signal());
  expect(p.rows[0][3].json).toBe('922337203685477.5807');
  expect(p.rows[0][4].json).toEqual([]);
});
