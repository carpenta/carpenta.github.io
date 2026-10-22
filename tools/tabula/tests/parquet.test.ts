import { expect, test } from 'vitest';
import { parquetReader } from '../src/readers/parquet';
import { nodeSource, signal } from './helpers';

const CODECS = ['UNCOMPRESSED', 'SNAPPY', 'GZIP', 'BROTLI', 'ZSTD'];
const ROW0 = [
  '0', '9007199254740993', '0', 'true', '""', '922337203685477.5807', '2022-01-08',
  '2023-11-14 22:13:20.000000', '2023-11-14 22:13:20.000', '[]', 'NULL',
];

test.each(CODECS)('reads %s', async (codec) => {
  const r = parquetReader(nodeSource(`parquet-${codec}.parquet`));
  const s = await r.open();
  expect(s.format).toBe('parquet');
  expect(s.rowCount).toBe(1000);
  expect(s.codec).toContain(codec);
  expect(s.suggestedColumns).toEqual(s.columns.map((c) => c.name));
  const p = await r.readPage(0, 100, s.suggestedColumns, signal());
  expect(p.rows).toHaveLength(100);
  expect(p.rows[0].map((c) => c.text)).toEqual(ROW0);
});

test('NULL, empty string and empty list stay distinct', async () => {
  const r = parquetReader(nodeSource('parquet-SNAPPY.parquet'));
  await r.open();
  const p = await r.readPage(0, 2, ['name', 'tags', 'st'], signal());
  expect(p.columns).toEqual(['name', 'tags', 'st']);
  expect(p.rows[0].map((c) => c.kind)).toEqual(['string', 'nested', 'null']);
  expect(p.rows[0][0].text).toBe('""');
  expect(p.rows[1].map((c) => c.text)).toEqual(['NULL', 'NULL', '{"a":1,"b":null}']);
});

test('decimal keeps scale exactly and int64 stays exact in export', async () => {
  const r = parquetReader(nodeSource('parquet-ZSTD.parquet'));
  await r.open();
  const p = await r.readPage(999, 1, ['big', 'amount'], signal());
  expect(p.rows[0].map((c) => c.text)).toEqual(['9007199254741992', '922337203685477.4808']);
  expect(p.rows[0][0].json).toBe('9007199254741992');
  expect(p.eof).toBe(true);
});

test('column types are labelled', async () => {
  const s = await parquetReader(nodeSource('parquet-SNAPPY.parquet')).open();
  const type = (n: string) => s.columns.find((c) => c.name === n)?.type;
  expect(type('amount')).toBe('decimal(18,4)');
  expect(type('ts')).toBe('timestamp(us, UTC)');
  expect(type('tags')).toBe('list<string>');
  expect(type('st')).toBe('struct');
  expect(s.columns.find((c) => c.name === 'st')?.children?.map((c) => c.name)).toEqual(['a', 'b']);
});

test('random access to row 987654 reads one row group', async () => {
  const src = nodeSource('parquet-big.parquet');
  const r = parquetReader(src);
  const s = await r.open();
  expect(s.rowCount).toBe(1000000);
  const p = await r.readPage(987654, 100, s.suggestedColumns, signal());
  expect(p.rows[0][0].text).toBe('987654');
  expect(p.rows[0][3].text).toBe('row-987654');
  expect(src.bytesRead).toBeLessThan(src.byteLength / 10);
});

test('reading one column reads less than reading all', async () => {
  const one = nodeSource('parquet-big.parquet');
  const all = nodeSource('parquet-big.parquet');
  const r1 = parquetReader(one);
  const r2 = parquetReader(all);
  const s = await r1.open();
  await r2.open();
  // footer를 읽은 양은 같으므로 페이지를 읽는 데 든 양만 비교한다
  const before = one.bytesRead;
  await r1.readPage(0, 100, ['id'], signal());
  await r2.readPage(0, 100, s.suggestedColumns, signal());
  expect(one.bytesRead - before).toBeLessThan((all.bytesRead - before) / 2);
});

test('exceeding the byte budget fails with budget and the suggestion is trimmed', async () => {
  const r = parquetReader(nodeSource('parquet-big.parquet'), { budget: 100 });
  const s = await r.open();
  expect(s.suggestedColumns).toEqual(['id']);
  expect(s.notice).toBeTruthy();
  await expect(r.readPage(0, 100, ['id', 's1'], signal())).rejects.toMatchObject({ code: 'budget' });
});

test('column stats cover every row group and never show lossy decimals', async () => {
  const s = await parquetReader(nodeSource('parquet-SNAPPY.parquet')).open();
  const cols = s.metadata.find((m) => m.title === '컬럼')!.table!;
  const at = (name: string, header: string) => cols.rows.find((r) => r[0] === name)![cols.headers.indexOf(header)];
  expect(at('ts', 'max')).toBe('2023-11-14 22:13:20.000999');
  expect(at('ts', 'min')).toBe('2023-11-14 22:13:20.000000');
  expect(at('day', 'max')).toBe(formatDay(19999));
  expect(at('id', 'max')).toBe('999');
  expect(at('amount', 'min')).toBe('');
  expect(at('amount', 'max')).toBe('');
});

const formatDay = (d: number) => new Date(d * 86400000).toISOString().slice(0, 10);

test('metadata has file, key-value, row group and column sections', async () => {
  const s = await parquetReader(nodeSource('parquet-GZIP.parquet')).open();
  expect(s.metadata.map((m) => m.title)).toEqual(['파일', 'key-value', 'row group', '컬럼']);
  expect(s.metadata[0].pairs).toContainEqual(['created_by', 'tabula fixtures']);
  expect(s.metadata[1].pairs).toContainEqual(['tabula.test', 'yes']);
  expect(s.metadata[2].table?.rows).toHaveLength(4);
  const cols = s.metadata[3].table!;
  expect(cols.headers[0]).toBe('컬럼');
  expect(cols.rows.map((r) => r[0])).toContain('st.a');
});
