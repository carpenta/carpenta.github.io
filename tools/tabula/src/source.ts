import type { ByteSource } from './types';

/** Blob(File)의 구간만 읽는 ByteSource. 전체를 메모리에 올리지 않는다. */
export function fileSource(blob: Blob): ByteSource {
  let bytesRead = 0;
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
      bytesRead += bytes.length;
      return bytes;
    },
  };
}
