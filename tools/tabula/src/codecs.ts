import { inflateSync } from 'fflate';
import { decompress } from 'fzstd';
import { snappyUncompress } from 'hyparquet';
import { PAGE_BYTE_BUDGET } from './types';

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
  const len = outLen ?? snappyLength(b);
  // 손상된 길이로 수십 GB를 할당하지 않는다
  if (len > PAGE_BYTE_BUDGET) throw new Error('snappy block is too large');
  const out = new Uint8Array(len);
  snappyUncompress(b, out);
  return out;
}

/** LZ4 블록 하나를 out.buf[out.pos..]에 푼다. 앞 블록의 출력을 참조할 수 있도록 같은 버퍼에 이어 쓴다. */
function lz4Block(src: Uint8Array, out: { buf: Uint8Array; pos: number }): void {
  const ensure = (n: number) => {
    if (out.pos + n <= out.buf.length) return;
    const next = new Uint8Array(Math.max(out.buf.length * 2, out.pos + n));
    next.set(out.buf.subarray(0, out.pos));
    out.buf = next;
  };
  let i = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) {
      let b: number;
      do {
        b = src[i++];
        lit += b;
      } while (b === 255);
    }
    ensure(lit);
    out.buf.set(src.subarray(i, i + lit), out.pos);
    out.pos += lit;
    i += lit;
    if (i >= src.length) break; // 마지막 시퀀스는 리터럴만 있다
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    if (offset === 0 || offset > out.pos) throw new Error('lz4 offset out of range');
    let len = (token & 15) + 4;
    if ((token & 15) === 15) {
      let b: number;
      do {
        b = src[i++];
        len += b;
      } while (b === 255);
    }
    ensure(len);
    // 겹치는 복사는 바이트 단위로
    for (let k = 0; k < len; k++, out.pos++) out.buf[out.pos] = out.buf[out.pos - offset];
  }
}

/** LZ4 frame 형식(이어 붙은 frame 포함). */
export function lz4Frame(b: Uint8Array): Uint8Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = { buf: new Uint8Array(Math.max(64, b.length * 4)), pos: 0 };
  let p = 0;
  while (p < b.length) {
    if (view.getUint32(p, true) !== 0x184d2204) throw new Error('lz4 frame magic is missing');
    const flg = b[p + 4];
    p += 6; // magic, FLG, BD
    if (flg & 0x08) p += 8; // content size
    if (flg & 0x01) p += 4; // dictionary id
    p += 1; // header checksum
    for (;;) {
      const size = view.getUint32(p, true);
      p += 4;
      if (size === 0) break;
      const len = size & 0x7fffffff;
      const block = b.subarray(p, p + len);
      if (size & 0x80000000) {
        if (out.pos + len > out.buf.length) {
          const next = new Uint8Array(Math.max(out.buf.length * 2, out.pos + len));
          next.set(out.buf.subarray(0, out.pos));
          out.buf = next;
        }
        out.buf.set(block, out.pos);
        out.pos += len;
      } else {
        lz4Block(block, out);
      }
      p += len;
      if (flg & 0x10) p += 4; // block checksum
    }
    if (flg & 0x04) p += 4; // content checksum
  }
  return out.buf.slice(0, out.pos);
}
