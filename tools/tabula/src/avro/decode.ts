import {
  bigintFromTwosComplement, binaryCell, float32Cell, boolCell, formatDate, formatDecimal, formatTime, formatTimestamp,
  nestedCell, nullCell, numberCell, stringCell, temporalCell, type TimeUnit,
} from '../cells';
import { TabulaError, type Cell, type JsonValue } from '../types';
import { avroTypeLabel, type AvroType } from './schema';

const decoder = new TextDecoder();
const truncated = () => new TabulaError('corrupt', 'Avro 데이터가 중간에 끊겼습니다.');

/** Avro 바이너리 인코딩을 읽는 커서. */
export class Cursor {
  private view: DataView;
  constructor(readonly bytes: Uint8Array, public pos = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) throw truncated();
  }

  /** zigzag varint. */
  readLong(): bigint {
    let shift = 0n;
    let v = 0n;
    for (let i = 0; i < 10; i++) {
      this.need(1);
      const b = this.bytes[this.pos++];
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return (v >> 1n) ^ -(v & 1n);
      shift += 7n;
    }
    throw new TabulaError('corrupt', 'Avro long 인코딩이 잘못되었습니다.');
  }

  readInt(): number {
    return Number(this.readLong());
  }

  readFloat(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readDouble(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  readFixed(size: number): Uint8Array {
    this.need(size);
    const v = this.bytes.subarray(this.pos, this.pos + size);
    this.pos += size;
    return v;
  }

  readBytes(): Uint8Array {
    const len = this.readInt();
    if (len < 0) throw new TabulaError('corrupt', 'Avro bytes 길이가 음수입니다.');
    return this.readFixed(len);
  }

  readString(): string {
    return decoder.decode(this.readBytes());
  }
}

const TS_UNITS: Record<string, TimeUnit> = {
  'timestamp-millis': 'ms', 'timestamp-micros': 'us', 'timestamp-nanos': 'ns',
  'local-timestamp-millis': 'ms', 'local-timestamp-micros': 'us', 'local-timestamp-nanos': 'ns',
};

const uuidFromBytes = (b: Uint8Array) => {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const decimal = (bytes: Uint8Array, scale = 0): Cell => {
  const text = formatDecimal(bigintFromTwosComplement(bytes), scale);
  return { kind: 'number', text, full: text, json: text };
};

/** 값 하나가 차지하는 최소 바이트. null이나 필드 없는 record는 0이다. */
function minWidth(t: AvroType, seen = new Set<AvroType>()): number {
  switch (t.kind) {
    case 'null':
      return 0;
    case 'float':
      return 4;
    case 'double':
      return 8;
    case 'fixed':
      return t.size;
    case 'record': {
      if (seen.has(t)) return 0;
      seen.add(t);
      return t.fields.reduce((s, f) => s + minWidth(f.type, seen), 0);
    }
    default:
      return 1;
  }
}

/** 바이트를 쓰지 않는 항목이 블록 하나에 이보다 많으면 손상으로 본다. */
const MAX_ZERO_WIDTH_ITEMS = 1_000_000;

/** 블록의 항목 수가 남은 바이트로 가능한지 확인한다. 손상된 count로 멈추거나 메모리를 다 쓰지 않게 한다. */
function checkCount(count: bigint, itemWidth: number, c: Cursor): number {
  const limit = itemWidth === 0 ? MAX_ZERO_WIDTH_ITEMS : Math.floor(c.remaining / itemWidth);
  if (count > BigInt(limit)) throw new TabulaError('corrupt', 'Avro array·map의 항목 수가 데이터보다 많습니다.');
  return Number(count);
}

/** array·map의 블록을 돌며 항목마다 fn을 부른다. 음수 count 뒤에는 블록 바이트 크기가 온다. */
function eachBlockItem(c: Cursor, itemWidth: number, fn: () => void): void {
  for (;;) {
    let count = c.readLong();
    if (count === 0n) return;
    if (count < 0n) {
      count = -count;
      c.readLong();
    }
    const n = checkCount(count, itemWidth, c);
    for (let i = 0; i < n; i++) fn();
  }
}

/** 값을 하나 디코딩해 바로 표시용 Cell로 만든다. */
export function decodeCell(t: AvroType, c: Cursor): Cell {
  switch (t.kind) {
    case 'null':
      return nullCell;
    case 'boolean':
      return boolCell(c.readFixed(1)[0] !== 0);
    case 'int': {
      const v = c.readInt();
      if (t.logical === 'date') return temporalCell(formatDate(v));
      if (t.logical === 'time-millis') return temporalCell(formatTime(BigInt(v), 'ms'));
      return numberCell(v);
    }
    case 'long': {
      const v = c.readLong();
      const unit = t.logical ? TS_UNITS[t.logical] : undefined;
      if (unit) return temporalCell(formatTimestamp(v, unit));
      if (t.logical === 'time-micros') return temporalCell(formatTime(v, 'us'));
      return numberCell(v);
    }
    case 'float':
      return float32Cell(c.readFloat());
    case 'double':
      return numberCell(c.readDouble());
    case 'bytes': {
      const b = c.readBytes();
      return t.logical === 'decimal' ? decimal(b, t.scale) : binaryCell(b);
    }
    case 'string':
      return stringCell(c.readString());
    case 'fixed': {
      const b = c.readFixed(t.size);
      if (t.logical === 'decimal') return decimal(b, t.scale);
      if (t.logical === 'uuid' && t.size === 16) return stringCell(uuidFromBytes(b));
      return binaryCell(b);
    }
    case 'enum': {
      const i = c.readInt();
      const symbol = t.symbols[i];
      if (symbol === undefined) throw new TabulaError('corrupt', 'Avro enum 값이 범위를 벗어났습니다.');
      return stringCell(symbol);
    }
    case 'array': {
      const items: JsonValue[] = [];
      eachBlockItem(c, minWidth(t.items), () => items.push(decodeCell(t.items, c).json));
      return nestedCell(items);
    }
    case 'map': {
      const obj: { [k: string]: JsonValue } = {};
      eachBlockItem(c, 1 + minWidth(t.values), () => {
        const key = c.readString();
        obj[key] = decodeCell(t.values, c).json;
      });
      return nestedCell(obj);
    }
    case 'union': {
      const i = c.readInt();
      const branch = t.branches[i];
      if (!branch) throw new TabulaError('corrupt', 'Avro union 인덱스가 범위를 벗어났습니다.');
      const cell = decodeCell(branch, c);
      const nonNull = t.branches.filter((b) => b.kind !== 'null').length;
      if (nonNull <= 1 || branch.kind === 'null') return cell;
      const label = avroTypeLabel(branch);
      return { ...cell, text: `${label}: ${cell.text}`, full: `${label}: ${cell.full}` };
    }
    case 'record': {
      const obj: { [k: string]: JsonValue } = {};
      for (const f of t.fields) obj[f.name] = decodeCell(f.type, c).json;
      return nestedCell(obj);
    }
  }
}

/** 값을 디코딩하지 않고 건너뛴다. */
export function skipValue(t: AvroType, c: Cursor): void {
  switch (t.kind) {
    case 'null':
      return;
    case 'boolean':
      c.readFixed(1);
      return;
    case 'int':
    case 'long':
    case 'enum':
      c.readLong();
      return;
    case 'float':
      c.readFixed(4);
      return;
    case 'double':
      c.readFixed(8);
      return;
    case 'bytes':
    case 'string':
      c.readBytes();
      return;
    case 'fixed':
      c.readFixed(t.size);
      return;
    case 'array':
    case 'map':
      for (;;) {
        let count = c.readLong();
        if (count === 0n) return;
        if (count < 0n) {
          c.readFixed(Number(c.readLong()));
          continue;
        }
        const item = t.kind === 'map' ? t.values : t.items;
        const n = checkCount(count, (t.kind === 'map' ? 1 : 0) + minWidth(item), c);
        for (let i = 0; i < n; i++) {
          if (t.kind === 'map') c.readBytes();
          skipValue(item, c);
        }
      }
    case 'union': {
      const branch = t.branches[c.readInt()];
      if (!branch) throw new TabulaError('corrupt', 'Avro union 인덱스가 범위를 벗어났습니다.');
      skipValue(branch, c);
      return;
    }
    case 'record':
      for (const f of t.fields) skipValue(f.type, c);
  }
}
