import type { ByteSource } from './types';

/**
 * Blob(File)의 구간만 읽는 ByteSource. 전체를 메모리에 올리지 않는다.
 * bytesRead는 한 번이라도 읽은 바이트의 수다. 같은 구간을 다시 읽어도 늘지 않는다.
 */
export function fileSource(blob: Blob): ByteSource {
  const ranges: [number, number][] = []; // 겹치지 않게 합친 [start, end), 정렬됨
  let bytesRead = 0;

  /** [s, e)를 읽은 구간에 더한다. 큰 Avro 파일은 블록 헤더 읽기가 수만 번이라 이분 탐색으로 자리를 찾는다. */
  function mark(s: number, e: number): void {
    let lo = 0;
    let hi = ranges.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ranges[mid][1] < s) lo = mid + 1;
      else hi = mid;
    }
    let start = s;
    let end = e;
    let removed = 0;
    let i = lo;
    while (i < ranges.length && ranges[i][0] <= end) {
      start = Math.min(start, ranges[i][0]);
      end = Math.max(end, ranges[i][1]);
      removed += ranges[i][1] - ranges[i][0];
      i++;
    }
    ranges.splice(lo, i - lo, [start, end]);
    bytesRead += end - start - removed;
  }

  return {
    byteLength: blob.size,
    get bytesRead() {
      return bytesRead;
    },
    async read(start, end) {
      const s = Math.max(0, start);
      const e = Math.min(blob.size, end);
      if (e <= s) return new Uint8Array(0);
      const bytes = new Uint8Array(await blob.slice(s, e).arrayBuffer());
      mark(s, e);
      return bytes;
    },
  };
}
