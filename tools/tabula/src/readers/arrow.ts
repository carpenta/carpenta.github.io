import { CompressionType, DataType, RecordBatchReader, Type, compressionRegistry, type RecordBatch, type Schema, type Vector } from 'apache-arrow';
import {
  binaryCell, boolCell, float32Cell, formatDate, formatDecimal, formatTime, formatTimestamp, nestedCell, nullCell, numberCell, stringCell,
  temporalCell, type TimeUnit,
} from '../cells';
import { lz4Frame, zstd } from '../codecs';
import { TabulaError, type ByteSource, type Cell, type ColumnInfo, type FileSummary, type JsonValue, type Reader } from '../types';

// apache-arrow는 해제한 버퍼 위에 BigInt64Array 등을 바로 만든다. 시작 위치가 8의 배수가 아니면 복사한다.
const aligned = (b: Uint8Array) => (b.byteOffset % 8 === 0 ? b : b.slice());
compressionRegistry.set(CompressionType.ZSTD, { decode: (b) => aligned(zstd(b)) });
compressionRegistry.set(CompressionType.LZ4_FRAME, { decode: (b) => aligned(lz4Frame(b)) });

const UNITS: TimeUnit[] = ['ms', 'ms', 'us', 'ns']; // SECOND은 ms로 바꿔 쓴다
const UNIT_LABEL = ['s', 'ms', 'us', 'ns'];
const cancelled = () => new TabulaError('cancelled', '취소했습니다.');

/** 벡터의 i번째 값이 들어 있는 Data 조각과 그 안의 실제 인덱스. */
function locate(v: Vector, i: number): { values: ArrayLike<unknown> & { [k: number]: unknown }; at: number; stride: number } {
  let k = i;
  for (const d of v.data) {
    if (k < d.length) return { values: d.values as never, at: d.offset + k, stride: d.stride };
    k -= d.length;
  }
  throw new RangeError('index out of range');
}

/** 128·256비트 decimal의 little-endian 32비트 워드를 bigint로. */
function decimalWords(words: ArrayLike<number>, from: number, count: number): bigint {
  let v = 0n;
  for (let w = count - 1; w >= 0; w--) v = (v << 32n) | BigInt(words[from + w] >>> 0);
  const bits = BigInt(count * 32);
  return v >= 1n << (bits - 1n) ? v - (1n << bits) : v;
}

function typeLabel(t: DataType): string {
  // 타입별 속성(bitWidth, unit 등)은 DataType 하위 클래스에만 있다
  const x = t as unknown as Record<string, any>;
  switch (t.typeId) {
    case Type.Int:
      return `${x.isSigned ? 'int' : 'uint'}${x.bitWidth}`;
    case Type.Float:
      return ['float16', 'float32', 'float64'][x.precision];
    case Type.Utf8:
    case Type.LargeUtf8:
    case Type.Utf8View:
      return 'utf8';
    case Type.Binary:
    case Type.LargeBinary:
    case Type.BinaryView:
      return 'binary';
    case Type.FixedSizeBinary:
      return `fixed_binary(${x.byteWidth})`;
    case Type.Bool:
      return 'bool';
    case Type.Decimal:
      return `decimal(${x.precision},${x.scale})`;
    case Type.Date:
      return 'date';
    case Type.Time:
      return `time(${UNIT_LABEL[x.unit]})`;
    case Type.Timestamp: {
      const tz = x.timezone;
      // 시간대가 있는 값은 UTC epoch이고 UTC로 표시한다
      return `timestamp(${UNIT_LABEL[x.unit]}${tz ? ', UTC' : ''})`;
    }
    case Type.List:
    case Type.LargeList:
    case Type.FixedSizeList:
      return `list<${typeLabel(t.children[0].type)}>`;
    case Type.Struct:
      return 'struct';
    case Type.Map:
      return 'map';
    case Type.Dictionary:
      return `dictionary<${typeLabel(x.dictionary)}>`;
    default:
      return String(t).toLowerCase();
  }
}

function columnInfo(name: string, t: DataType): ColumnInfo {
  return t.typeId === Type.Struct
    ? { name, type: typeLabel(t), children: t.children.map((f) => columnInfo(f.name, f.type)) }
    : { name, type: typeLabel(t) };
}

/** 스키마를 모르는 값(Map 행 등)을 JSON으로. */
function plain(v: unknown): JsonValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return numberCell(v).json;
  if (v instanceof Uint8Array) return binaryCell(v).json;
  if (typeof v === 'object' && v !== null && 'toJSON' in v) return plain((v as { toJSON(): unknown }).toJSON());
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v as JsonValue;
}

/** 벡터 v의 i번째 값을 Cell로. */
function cellAt(v: Vector, i: number): Cell {
  if (!v.isValid(i)) return nullCell;
  const t = v.type as DataType & Record<string, unknown>;
  switch (t.typeId) {
    case Type.Int:
      return numberCell(v.get(i) as number | bigint);
    case Type.Float:
      return t.precision === 1 ? float32Cell(v.get(i) as number) : numberCell(v.get(i) as number);
    case Type.Bool:
      return boolCell(v.get(i) as boolean);
    case Type.Utf8:
    case Type.LargeUtf8:
    case Type.Utf8View:
      return stringCell(v.get(i) as string);
    case Type.Binary:
    case Type.LargeBinary:
    case Type.BinaryView:
    case Type.FixedSizeBinary:
      return binaryCell(v.get(i) as Uint8Array);
    case Type.Decimal: {
      const { values, at, stride } = locate(v, i);
      const text = formatDecimal(decimalWords(values as ArrayLike<number>, at * stride, stride), t.scale as number);
      return { kind: 'number', text, full: text, json: text };
    }
    case Type.Timestamp: {
      const { values, at } = locate(v, i);
      const unit = t.unit as number;
      const raw = BigInt(values[at] as bigint);
      return temporalCell(formatTimestamp(unit === 0 ? raw * 1000n : raw, UNITS[unit]));
    }
    case Type.Date: {
      const { values, at } = locate(v, i);
      const raw = values[at];
      return temporalCell(formatDate(t.unit === 0 ? Number(raw) : Number(BigInt(raw as bigint) / 86400000n)));
    }
    case Type.Time: {
      const { values, at } = locate(v, i);
      const unit = t.unit as number;
      const raw = BigInt(values[at] as number | bigint);
      return temporalCell(formatTime(unit === 0 ? raw * 1000n : raw, UNITS[unit]));
    }
    case Type.List:
    case Type.LargeList:
    case Type.FixedSizeList: {
      const sub = v.get(i) as Vector;
      return nestedCell(Array.from({ length: sub.length }, (_, k) => cellAt(sub, k).json));
    }
    case Type.Struct: {
      const out: { [k: string]: JsonValue } = {};
      t.children.forEach((f, k) => {
        out[f.name] = cellAt((v as unknown as { getChildAt(k: number): Vector }).getChildAt(k), i).json;
      });
      return nestedCell(out);
    }
    default: {
      const value = v.get(i);
      if (typeof value === 'string') return stringCell(value);
      if (typeof value === 'number' || typeof value === 'bigint') return numberCell(value);
      return nestedCell(plain(value));
    }
  }
}

/**
 * apache-arrow가 Node FileHandle로 알아보는 모양(fd, stat, read)의 객체. 필요한 구간만 ByteSource에서 읽는다.
 * file 형식은 footer로 batch 위치를 찾고, stream 형식은 앞에서부터 읽는다.
 */
function fileHandle(src: ByteSource) {
  return {
    fd: -1,
    stat: async () => ({ size: src.byteLength }),
    read: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
      const bytes = await src.read(position, position + length);
      buffer.set(bytes, offset);
      return { bytesRead: bytes.length, buffer };
    },
    close: async () => {},
  };
}

interface AsyncBatchReader {
  schema: Schema;
  open(): Promise<unknown>;
  next(): Promise<IteratorResult<RecordBatch>>;
}

async function openReader(src: ByteSource): Promise<AsyncBatchReader> {
  try {
    // FileHandle 모양을 넣으면 비동기 reader가 나온다
    const reader = (await RecordBatchReader.from(fileHandle(src) as unknown as Parameters<typeof RecordBatchReader.from>[0])) as AsyncBatchReader;
    await reader.open();
    return reader;
  } catch (e) {
    throw new TabulaError('corrupt', `Arrow 파일을 읽을 수 없습니다: ${(e as Error).message}`);
  }
}


export function arrowReader(src: ByteSource, format: 'arrow-file' | 'arrow-stream'): Reader {
  let schema: Schema;
  let reader: AsyncBatchReader | null = null;
  let current: RecordBatch | null = null;
  let currentStart = 0; // current의 첫 행 번호
  let nextStart = 0; // 다음 batch의 첫 행 번호
  let done = false;

  async function restart(): Promise<void> {
    reader = await openReader(src);
    current = null;
    currentStart = 0;
    nextStart = 0;
    done = false;
  }

  async function advance(): Promise<boolean> {
    if (done || !reader) return false;
    let r: IteratorResult<RecordBatch>;
    try {
      r = await reader.next();
    } catch (e) {
      throw new TabulaError('corrupt', `Arrow batch를 읽을 수 없습니다: ${(e as Error).message}`);
    }
    if (r.done) {
      done = true;
      return false;
    }
    current = r.value;
    currentStart = nextStart;
    nextStart += current.numRows;
    return true;
  }

  return {
    async open(): Promise<FileSummary> {
      await restart();
      schema = reader!.schema;
      const fields = schema.fields;
      const fieldMeta = fields.flatMap((f) => [...f.metadata].map(([k, val]): [string, string] => [`${f.name}.${k}`, val]));
      return {
        format,
        byteLength: src.byteLength,
        rowCount: null,
        codec: 'Arrow IPC',
        columns: fields.map((f) => columnInfo(f.name, f.type)),
        suggestedColumns: fields.map((f) => f.name),
        metadata: [
          {
            title: '파일',
            pairs: [
              ['형식', format === 'arrow-file' ? 'Arrow IPC file' : 'Arrow IPC stream'],
              ...(format === 'arrow-file' ? [['record batch 수', String((reader as unknown as { numRecordBatches: number }).numRecordBatches)] as [string, string]] : []),
              ['dictionary', fields.some((f) => f.type.typeId === Type.Dictionary) ? '있음' : '없음'],
            ],
          },
          { title: '스키마', pairs: fields.map((f): [string, string] => [f.name, `${typeLabel(f.type)}${f.nullable ? '' : ' NOT NULL'}`]) },
          { title: '스키마 메타데이터', pairs: [...schema.metadata] },
          { title: '필드 메타데이터', pairs: fieldMeta },
        ],
      };
    },

    async readPage(start, count, columns, signal) {
      const picked = schema.fields.map((f, k) => ({ name: f.name, k })).filter((f) => columns.includes(f.name));
      if (start < currentStart || (!current && nextStart > start)) await restart();
      while (!done && (!current || start >= nextStart)) {
        if (signal.aborted) throw cancelled();
        await advance();
      }
      const rows: Cell[][] = [];
      while (current && rows.length < count) {
        if (signal.aborted) throw cancelled();
        const batch: RecordBatch = current;
        const vectors = picked.map((f) => batch.getChildAt(f.k)!);
        for (let i = Math.max(0, start + rows.length - currentStart); i < batch.numRows && rows.length < count; i++) {
          rows.push(vectors.map((vec) => cellAt(vec, i)));
        }
        if (rows.length < count && !(await advance())) break;
      }
      // 페이지가 batch 경계에서 끝나면 다음 batch를 미리 읽지 않는다. 끝인지는 다음 페이지를 요청할 때 알게 된다
      const end = start + rows.length;
      const atEnd = done && end >= nextStart;
      return { start, columns: picked.map((f) => f.name), rows, eof: atEnd, total: atEnd ? nextStart : undefined };
    },

    async countRows(signal, onProgress) {
      const counter = await openReader(src);
      let rows = 0;
      let n = 0;
      for (;;) {
        if (signal.aborted) throw cancelled();
        let r: IteratorResult<RecordBatch>;
        try {
          r = await counter.next();
        } catch (e) {
          throw new TabulaError('corrupt', `Arrow batch를 읽을 수 없습니다: ${(e as Error).message}`);
        }
        if (r.done) break;
        rows += r.value.numRows;
        if (++n % 10 === 0) onProgress(rows);
      }
      onProgress(rows);
      return rows;
    },
  };
}
