import { detectFormat } from './detect';
import type { Req, Res } from './protocol';
import { arrowReader } from './readers/arrow';
import { avroReader } from './readers/avro';
import { parquetReader } from './readers/parquet';
import { fileSource } from './source';
import { TabulaError, type ByteSource, type Reader } from './types';

const PROBE = 64 * 1024;

/**
 * worker가 받은 요청을 처리하는 함수를 만든다. 요청은 한 번에 하나씩 처리하고(reader 상태가 섞이지 않게),
 * cancel만 줄을 서지 않고 바로 해당 요청을 멈춘다.
 */
export function createHandler(post: (m: Res) => void): (req: Req) => Promise<void> {
  let src: ByteSource | null = null;
  let reader: Reader | null = null;
  const controllers = new Map<number, AbortController>();
  let queue: Promise<void> = Promise.resolve();

  const bytes = () => src?.bytesRead ?? 0;

  async function run(req: Exclude<Req, { op: 'cancel' }>, signal: AbortSignal): Promise<unknown> {
    if (req.op === 'open') {
      src = fileSource(req.file);
      const head = await src.read(0, PROBE);
      const tail = await src.read(Math.max(0, src.byteLength - PROBE), src.byteLength);
      const format = detectFormat(head, tail);
      if (!format) throw new TabulaError('unsupported-format', 'Parquet, Arrow IPC, Avro 파일만 열 수 있습니다.');
      reader = format === 'parquet' ? parquetReader(src) : format === 'avro' ? avroReader(src) : arrowReader(src, format);
      return reader.open();
    }
    if (!reader) throw new TabulaError('corrupt', '열린 파일이 없습니다.');
    if (req.op === 'page') return reader.readPage(req.start, req.count, req.columns, signal);
    return reader.countRows(signal, (rows) => post({ id: req.id, progress: rows }));
  }

  return (req) => {
    if (req.op === 'cancel') {
      controllers.get(req.target)?.abort();
      return Promise.resolve();
    }
    const controller = new AbortController();
    controllers.set(req.id, controller);
    const task = queue.then(async () => {
      try {
        if (controller.signal.aborted) throw new TabulaError('cancelled', '취소했습니다.');
        const result = await run(req, controller.signal);
        post({ id: req.id, ok: true, result, bytesRead: bytes() });
      } catch (e) {
        const err = e instanceof TabulaError ? e : new TabulaError('corrupt', `파일을 읽는 중 문제가 생겼습니다: ${(e as Error)?.message ?? e}`);
        post({ id: req.id, ok: false, code: err.code, message: err.message, bytesRead: bytes() });
      } finally {
        controllers.delete(req.id);
      }
    });
    queue = task;
    return task;
  };
}
