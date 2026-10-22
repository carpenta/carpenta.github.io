import type { Req, Res } from './protocol';
import { TabulaError, type FileSummary, type Page } from './types';

export interface TabulaClient {
  open(file: File): Promise<FileSummary>;
  page(start: number, count: number, columns: string[]): Promise<Page>;
  count(onProgress: (rows: number) => void): Promise<number>;
  /** 진행 중인 요청을 모두 취소한다. 각 promise는 TabulaError('cancelled')로 끝난다. */
  cancel(): void;
  /** worker를 끝낸다. 이후 도착하는 응답은 무시한다. */
  dispose(): void;
  readonly bytesRead: number;
}

interface Pending {
  resolve(v: unknown): void;
  reject(e: unknown): void;
  onProgress?: (rows: number) => void;
}

type ReqBody = Req extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export function createClient(makeWorker: () => Worker): TabulaClient {
  const worker = makeWorker();
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let bytesRead = 0;
  let disposed = false;

  worker.onmessage = (ev: MessageEvent<Res>) => {
    if (disposed) return;
    const msg = ev.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if ('progress' in msg) {
      p.onProgress?.(msg.progress);
      return;
    }
    pending.delete(msg.id);
    bytesRead = msg.bytesRead;
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new TabulaError(msg.code, msg.message));
  };

  function send<T>(body: ReqBody, onProgress?: (rows: number) => void): Promise<T> {
    if (disposed) return Promise.reject(new TabulaError('cancelled', '뷰어가 닫혔습니다.'));
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      worker.postMessage({ ...body, id } as Req);
    });
  }

  function rejectAll(): void {
    for (const p of pending.values()) p.reject(new TabulaError('cancelled', '취소했습니다.'));
    pending.clear();
  }

  return {
    open: (file) => send<FileSummary>({ op: 'open', file }),
    page: (start, count, columns) => send<Page>({ op: 'page', start, count, columns }),
    count: (onProgress) => send<number>({ op: 'count' }, onProgress),
    cancel() {
      for (const id of pending.keys()) worker.postMessage({ id: nextId++, op: 'cancel', target: id } satisfies Req);
      rejectAll();
    },
    dispose() {
      disposed = true;
      worker.terminate();
      rejectAll();
    },
    get bytesRead() {
      return bytesRead;
    },
  };
}
