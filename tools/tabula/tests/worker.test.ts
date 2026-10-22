import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Res } from '../src/protocol';
import { createHandler } from '../src/worker-core';
import { fixtures } from './helpers';

const fixture = (name: string) => new File([readFileSync(join(fixtures, name))], name);

function harness() {
  const out: Res[] = [];
  const handle = createHandler((m) => out.push(m));
  const reply = (id: number) => out.find((m) => m.id === id && !('progress' in m)) as Extract<Res, { ok: boolean }> | undefined;
  return { out, handle, reply };
}

test('opens by magic bytes regardless of the file name', async () => {
  const { handle, reply } = harness();
  const buf = readFileSync(join(fixtures, 'parquet-SNAPPY.parquet'));
  await handle({ id: 1, op: 'open', file: new File([buf], 'weird.bin') });
  const r = reply(1);
  expect(r?.ok).toBe(true);
  expect((r as { result: { format: string } }).result.format).toBe('parquet');
  expect(r?.bytesRead).toBeGreaterThan(0);
});

test.each([
  ['parquet-SNAPPY.parquet', 'parquet'],
  ['arrow-file.arrow', 'arrow-file'],
  ['arrow-stream.arrows', 'arrow-stream'],
  ['avro-all-types-null.avro', 'avro'],
])('pages %s', async (name, format) => {
  const { handle, reply } = harness();
  await handle({ id: 1, op: 'open', file: fixture(name) });
  const summary = (reply(1) as { result: { format: string; suggestedColumns: string[] } }).result;
  expect(summary.format).toBe(format);
  await handle({ id: 2, op: 'page', start: 0, count: 100, columns: summary.suggestedColumns });
  expect((reply(2) as { result: { rows: unknown[] } }).result.rows).toHaveLength(100);
});

test('unsupported files report unsupported-format', async () => {
  const { handle, reply } = harness();
  await handle({ id: 1, op: 'open', file: fixture('unsupported.txt') });
  expect(reply(1)).toMatchObject({ ok: false, code: 'unsupported-format' });
});

test('a truncated parquet file reports corrupt, not unsupported', async () => {
  const { handle, reply } = harness();
  const buf = readFileSync(join(fixtures, 'parquet-SNAPPY.parquet'));
  await handle({ id: 1, op: 'open', file: new File([buf.subarray(0, buf.length - 100)], 'cut.parquet') });
  expect(reply(1)).toMatchObject({ ok: false, code: 'corrupt' });
});

test('page before open is an error, not a crash', async () => {
  const { handle, reply } = harness();
  await handle({ id: 1, op: 'page', start: 0, count: 1, columns: [] });
  expect(reply(1)).toMatchObject({ ok: false });
});

test('cancel stops a running count', async () => {
  const { handle, reply } = harness();
  await handle({ id: 1, op: 'open', file: fixture('avro-big.avro') });
  const counting = handle({ id: 2, op: 'count' });
  await handle({ id: 3, op: 'cancel', target: 2 });
  await counting;
  expect(reply(2)).toMatchObject({ ok: false, code: 'cancelled' });
});
