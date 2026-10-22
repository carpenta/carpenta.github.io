import { expect, test } from 'vitest';
import { createClient } from '../src/client';
import { TabulaError } from '../src/types';

/** postMessage로 보낸 요청을 기록하고, 테스트가 응답을 직접 흘려 넣는 가짜 Worker. */
function fakeWorker() {
  const sent: any[] = [];
  const w = {
    sent,
    terminated: false,
    onmessage: null as ((ev: { data: unknown }) => void) | null,
    postMessage(msg: unknown) {
      sent.push(msg);
    },
    terminate() {
      w.terminated = true;
    },
    reply(data: unknown) {
      w.onmessage?.({ data });
    },
  };
  return w;
}

const file = new File([new Uint8Array(4)], 'x.parquet');

test('resolves by request id even when replies arrive out of order', async () => {
  const w = fakeWorker();
  const c = createClient(() => w as unknown as Worker);
  const a = c.page(0, 100, ['a']);
  const b = c.page(100, 100, ['a']);
  const [ida, idb] = w.sent.map((m) => m.id);
  expect(w.sent.map((m) => m.op)).toEqual(['page', 'page']);
  w.reply({ id: idb, ok: true, result: { start: 100 }, bytesRead: 10 });
  w.reply({ id: ida, ok: true, result: { start: 0 }, bytesRead: 20 });
  expect(await a).toEqual({ start: 0 });
  expect(await b).toEqual({ start: 100 });
});

test('errors become TabulaError with the worker code', async () => {
  const w = fakeWorker();
  const c = createClient(() => w as unknown as Worker);
  const p = c.open(file);
  expect(w.sent[0]).toMatchObject({ op: 'open', file });
  w.reply({ id: w.sent[0].id, ok: false, code: 'unsupported-format', message: 'nope', bytesRead: 8 });
  const err = await p.catch((e) => e);
  expect(err).toBeInstanceOf(TabulaError);
  expect(err.code).toBe('unsupported-format');
});

test('cancel rejects pending requests with cancelled and posts cancel', async () => {
  const w = fakeWorker();
  const c = createClient(() => w as unknown as Worker);
  const p = c.count(() => {});
  const id = w.sent[0].id;
  c.cancel();
  expect(w.sent[1]).toMatchObject({ op: 'cancel', target: id });
  await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  // 취소한 뒤 늦게 온 응답은 무시한다
  w.reply({ id, ok: true, result: 5, bytesRead: 0 });
});

test('replies after dispose are ignored and the worker is terminated', async () => {
  const w = fakeWorker();
  const c = createClient(() => w as unknown as Worker);
  const p = c.page(0, 1, []);
  c.dispose();
  expect(w.terminated).toBe(true);
  await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  w.reply({ id: w.sent[0].id, ok: true, result: {}, bytesRead: 999 });
  expect(c.bytesRead).toBe(0);
});

test('progress messages call onProgress', async () => {
  const w = fakeWorker();
  const c = createClient(() => w as unknown as Worker);
  const seen: number[] = [];
  const p = c.count((n) => seen.push(n));
  const id = w.sent[0].id;
  w.reply({ id, progress: 100 });
  w.reply({ id, progress: 200 });
  w.reply({ id, ok: true, result: 250, bytesRead: 5 });
  expect(await p).toBe(250);
  expect(seen).toEqual([100, 200]);
});

test('bytesRead follows the latest reply', async () => {
  const w = fakeWorker();
  const c = createClient(() => w as unknown as Worker);
  const p = c.page(0, 1, []);
  w.reply({ id: w.sent[0].id, ok: true, result: {}, bytesRead: 1234 });
  await p;
  expect(c.bytesRead).toBe(1234);
});
