import { TEXT_LIMIT, type Cell, type JsonValue } from './types';

export type TimeUnit = 'ms' | 'us' | 'ns';

const PER_SECOND: Record<TimeUnit, bigint> = { ms: 1000n, us: 1000000n, ns: 1000000000n };
const DIGITS: Record<TimeUnit, number> = { ms: 3, us: 6, ns: 9 };
const BINARY_PREVIEW = 32;

/** 음수 쪽으로 내림하는 나눗셈. */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

const pad = (n: number | bigint, width: number) => String(n).padStart(width, '0');

/** epoch 기준 값을 UTC 'YYYY-MM-DD HH:MM:SS.fff…'로. 단위의 자릿수를 모두 보인다. */
export function formatTimestamp(v: bigint, unit: TimeUnit): string {
  const per = PER_SECOND[unit];
  const secs = floorDiv(v, per);
  const frac = v - secs * per;
  const date = new Date(Number(secs) * 1000);
  if (Number.isNaN(date.getTime())) return `${v} (${unit})`;
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}.${pad(frac, DIGITS[unit])}`;
}

/** epoch 기준 일 수를 'YYYY-MM-DD'로. */
export function formatDate(days: number): string {
  const date = new Date(days * 86400000);
  if (Number.isNaN(date.getTime())) return `${days} (days)`;
  return date.toISOString().slice(0, 10);
}

/** 자정 기준 값을 'HH:MM:SS.fff…'로. */
export function formatTime(v: bigint, unit: TimeUnit): string {
  const per = PER_SECOND[unit];
  const secs = floorDiv(v, per);
  const frac = v - secs * per;
  const h = secs / 3600n;
  const m = (secs % 3600n) / 60n;
  const s = secs % 60n;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(frac, DIGITS[unit])}`;
}

/** 스케일을 적용한 정확한 10진 문자열. */
export function formatDecimal(unscaled: bigint, scale: number): string {
  if (scale <= 0) return (unscaled * 10n ** BigInt(-scale)).toString();
  const negative = unscaled < 0n;
  const digits = (negative ? -unscaled : unscaled).toString().padStart(scale + 1, '0');
  const text = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${text}` : text;
}

/** big-endian 2의 보수 바이트를 bigint로. */
export function bigintFromTwosComplement(bytes: Uint8Array): bigint {
  if (bytes.length === 0) return 0n;
  let v = 0n;
  for (const byte of bytes) v = (v << 8n) | BigInt(byte);
  if (bytes[0] & 0x80) v -= 1n << BigInt(bytes.length * 8);
  return v;
}

const JULIAN_EPOCH_DAY = 2440588n;
const NANOS_PER_DAY = 86400000000000n;

/** Parquet INT96(앞 8바이트 LE 하루 안의 나노초, 뒤 4바이트 LE 율리우스일)을 epoch 나노초로. */
export function int96ToNanos(bytes: Uint8Array): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset, 12);
  const nanosOfDay = view.getBigUint64(0, true);
  const day = BigInt(view.getUint32(8, true));
  return (day - JULIAN_EPOCH_DAY) * NANOS_PER_DAY + nanosOfDay;
}

const truncate = (s: string) => (s.length > TEXT_LIMIT ? `${s.slice(0, TEXT_LIMIT)}…` : s);

export const nullCell: Cell = Object.freeze({ kind: 'null', text: 'NULL', full: 'NULL', json: null }) as Cell;

export function stringCell(s: string): Cell {
  return { kind: 'string', text: s === '' ? '""' : truncate(s), full: s, json: s };
}

export function numberCell(v: number | bigint): Cell {
  const text = String(v);
  let json: JsonValue;
  if (typeof v === 'bigint') json = v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : text;
  else json = Number.isFinite(v) ? v : text;
  return { kind: 'number', text, full: text, json };
}

export function boolCell(v: boolean): Cell {
  return { kind: 'bool', text: String(v), full: String(v), json: v };
}

export function temporalCell(text: string): Cell {
  return { kind: 'temporal', text, full: text, json: text };
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function binaryCell(bytes: Uint8Array): Cell {
  const full = `0x${hex(bytes)}`;
  const text = bytes.length > BINARY_PREVIEW ? `0x${hex(bytes.subarray(0, BINARY_PREVIEW))}… (${bytes.length} B)` : full;
  return { kind: 'binary', text, full, json: full };
}

export function nestedCell(json: JsonValue): Cell {
  return { kind: 'nested', text: truncate(JSON.stringify(json)), full: JSON.stringify(json, null, 2), json };
}

/** 셀이 가진 내보내기용 값을 JSON 값으로 바꾼다. 중첩 값 안에 들어갈 때 쓴다. */
export function cellToJson(c: Cell): JsonValue {
  return c.json;
}
