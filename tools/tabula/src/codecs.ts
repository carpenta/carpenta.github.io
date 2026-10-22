import { inflateSync } from 'fflate';
import { decompress } from 'fzstd';
import { snappyUncompress } from 'hyparquet';

/** raw DEFLATE (Avro deflate 코덱). */
export function inflateRaw(b: Uint8Array): Uint8Array {
  return inflateSync(b);
}

export function zstd(b: Uint8Array): Uint8Array {
  return decompress(b);
}

/** snappy 블록 앞의 varint에 적힌 원래 길이. */
function snappyLength(b: Uint8Array): number {
  let len = 0;
  for (let i = 0, shift = 0; i < 5 && i < b.length; i++, shift += 7) {
    len += (b[i] & 0x7f) * 2 ** shift;
    if (!(b[i] & 0x80)) return len;
  }
  throw new Error('snappy length is malformed');
}

export function snappy(b: Uint8Array, outLen?: number): Uint8Array {
  const out = new Uint8Array(outLen ?? snappyLength(b));
  snappyUncompress(b, out);
  return out;
}
