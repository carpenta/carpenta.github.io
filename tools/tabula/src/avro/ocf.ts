import { inflateRaw, snappy, zstd } from '../codecs';
import { TabulaError, type ByteSource } from '../types';
import { Cursor } from './decode';
import { parseSchema, type AvroType } from './schema';

export interface OcfHeader {
  schema: AvroType;
  schemaJson: string;
  codec: string;
  meta: [string, string][];
  sync: Uint8Array;
  dataStart: number;
}

/** 블록 하나의 위치. offset에서 시작해 next 직전(sync 포함)에서 끝난다. */
export interface BlockInfo {
  offset: number;
  count: number;
  size: number;
  dataStart: number;
  next: number;
}

export const CODECS = ['null', 'deflate', 'snappy', 'zstandard'];
const HEADER_FIRST_READ = 64 * 1024;
const HEADER_MAX = 64 * 1024 * 1024;
const corrupt = (why: string) => new TabulaError('corrupt', `Avro 파일이 손상되었습니다: ${why}`);
const utf8 = new TextDecoder();

function parseHeader(bytes: Uint8Array): OcfHeader {
  const c = new Cursor(bytes, 4);
  const meta = new Map<string, Uint8Array>();
  for (;;) {
    let count = c.readLong();
    if (count === 0n) break;
    if (count < 0n) {
      count = -count;
      c.readLong();
    }
    for (let i = 0n; i < count; i++) meta.set(c.readString(), c.readBytes());
  }
  const sync = c.readFixed(16).slice();
  const schemaBytes = meta.get('avro.schema');
  if (!schemaBytes) throw corrupt('스키마가 없습니다');
  const schemaJson = utf8.decode(schemaBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(schemaJson);
  } catch {
    throw corrupt('스키마 JSON이 잘못되었습니다');
  }
  const codecBytes = meta.get('avro.codec');
  const codec = codecBytes && codecBytes.length > 0 ? utf8.decode(codecBytes) : 'null';
  const user = [...meta].filter(([k]) => k !== 'avro.schema' && k !== 'avro.codec').map(([k, v]): [string, string] => [k, utf8.decode(v)]);
  return { schema: parseSchema(parsed), schemaJson, codec, meta: user, sync, dataStart: c.pos };
}

export async function readHeader(src: ByteSource): Promise<OcfHeader> {
  for (let size = HEADER_FIRST_READ; ; size *= 4) {
    const bytes = await src.read(0, Math.min(size, src.byteLength));
    try {
      return parseHeader(bytes);
    } catch (e) {
      const ranOut = e instanceof TabulaError && e.message.includes('끊겼');
      if (!ranOut || bytes.length >= src.byteLength || size >= HEADER_MAX) throw ranOut ? corrupt('헤더가 끊겼습니다') : e;
    }
  }
}

/** offset의 블록 헤더(행 수, 바이트 크기)만 읽는다. 파일 끝이면 null. */
export async function readBlockInfo(src: ByteSource, offset: number): Promise<BlockInfo | null> {
  if (offset >= src.byteLength) return null;
  const bytes = await src.read(offset, offset + 20);
  const c = new Cursor(bytes);
  let count: bigint;
  let size: bigint;
  try {
    count = c.readLong();
    size = c.readLong();
  } catch {
    throw corrupt('블록 헤더가 끊겼습니다');
  }
  if (count < 0n || size < 0n) throw corrupt('블록 헤더 값이 음수입니다');
  const dataStart = offset + c.pos;
  const next = dataStart + Number(size) + 16;
  if (next > src.byteLength) throw corrupt('블록이 파일 끝을 넘어갑니다');
  return { offset, count: Number(count), size: Number(size), dataStart, next };
}

/** 블록을 읽어 sync를 확인하고 압축을 푼다. */
export async function readBlock(src: ByteSource, h: OcfHeader, b: BlockInfo): Promise<Uint8Array> {
  const bytes = await src.read(b.dataStart, b.next);
  const sync = bytes.subarray(b.size);
  if (sync.length !== 16 || sync.some((x, i) => x !== h.sync[i])) throw corrupt('sync 마커가 맞지 않습니다');
  const data = bytes.subarray(0, b.size);
  try {
    switch (h.codec) {
      case 'null':
        return data;
      case 'deflate':
        return inflateRaw(data);
      case 'snappy':
        return snappy(data.subarray(0, data.length - 4));
      case 'zstandard':
        return zstd(data);
    }
  } catch {
    throw corrupt(`${h.codec} 압축을 풀 수 없습니다`);
  }
  throw new TabulaError('unsupported-codec', `지원하지 않는 Avro 코덱입니다: ${h.codec}`);
}
