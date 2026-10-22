import { parquetMetadataAsync, parquetRead, parquetSchema, type AsyncBuffer, type FileMetaData, type ParquetParsers, type SchemaElement, type SchemaTree } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import {
  bigintFromTwosComplement, binaryCell, float32Cell, int96ToNanos, boolCell, formatDate, formatDecimal, formatTime, formatTimestamp,
  nestedCell, nullCell, numberCell, stringCell, temporalCell, type TimeUnit,
} from '../cells';
import { PAGE_BYTE_BUDGET, TabulaError, type ByteSource, type Cell, type ColumnInfo, type FileSummary, type JsonValue, type MetaSection, type Reader } from '../types';

type Ts = { $ts: bigint; unit: TimeUnit };
type Day = { $date: number };

/** hyparquet의 기본 변환(Date, Number)은 정밀도를 잃는다. 단위가 붙은 원시 값을 받는다. */
const parsers: Partial<ParquetParsers> = {
  timestampFromMilliseconds: (v): Ts => ({ $ts: BigInt(v), unit: 'ms' }),
  timestampFromMicroseconds: (v): Ts => ({ $ts: BigInt(v), unit: 'us' }),
  timestampFromNanoseconds: (v): Ts => ({ $ts: BigInt(v), unit: 'ns' }),
  dateFromDays: (d): Day => ({ $date: d }),
};

const isTs = (v: unknown): v is Ts => typeof v === 'object' && v !== null && '$ts' in v;
const isDay = (v: unknown): v is Day => typeof v === 'object' && v !== null && '$date' in v;
const strict = new TextDecoder('utf-8', { fatal: true });

const decimalScale = (e: SchemaElement): number | undefined =>
  e.logical_type?.type === 'DECIMAL' ? e.logical_type.scale : e.converted_type === 'DECIMAL' ? e.scale ?? 0 : undefined;

function timeUnit(e: SchemaElement): TimeUnit | undefined {
  if (e.logical_type?.type === 'TIME') return ({ MILLIS: 'ms', MICROS: 'us', NANOS: 'ns' } as const)[e.logical_type.unit];
  if (e.converted_type === 'TIME_MILLIS') return 'ms';
  if (e.converted_type === 'TIME_MICROS') return 'us';
  return undefined;
}

const isList = (n: SchemaTree) => n.element.converted_type === 'LIST' || n.element.logical_type?.type === 'LIST';
const isMap = (n: SchemaTree) =>
  n.element.converted_type === 'MAP' || n.element.converted_type === 'MAP_KEY_VALUE' || n.element.logical_type?.type === 'MAP';

/** LIST 그룹의 원소 노드. 3단(그룹 → repeated → element)과 2단 표기를 모두 다룬다. */
function listElement(n: SchemaTree): SchemaTree {
  const rep = n.children[0];
  if (!rep) return n;
  return rep.children.length === 1 ? rep.children[0] : rep;
}

/** 리프 값 하나의 Cell. */
function leafCell(v: unknown, e: SchemaElement): Cell {
  if (v === null || v === undefined) return nullCell;
  if (isTs(v)) return temporalCell(formatTimestamp(v.$ts, v.unit));
  if (isDay(v)) return temporalCell(formatDate(v.$date));
  const scale = decimalScale(e);
  if (scale !== undefined) {
    const unscaled = v instanceof Uint8Array ? bigintFromTwosComplement(v) : BigInt(v as number | bigint);
    const text = formatDecimal(unscaled, scale);
    return { kind: 'number', text, full: text, json: text };
  }
  const unit = timeUnit(e);
  if (unit && (typeof v === 'number' || typeof v === 'bigint')) return temporalCell(formatTime(BigInt(v), unit));
  if (typeof v === 'number' && e.type === 'FLOAT') return float32Cell(v);
  if (typeof v === 'bigint' || typeof v === 'number') return numberCell(v);
  if (typeof v === 'boolean') return boolCell(v);
  if (typeof v === 'string') return stringCell(v);
  if (v instanceof Uint8Array) {
    // 문자열 표시가 없는 BYTE_ARRAY: UTF-8이면 문자열로, 아니면 바이너리로
    if (e.type === 'BYTE_ARRAY') {
      try {
        return stringCell(strict.decode(v));
      } catch {
        return binaryCell(v);
      }
    }
    return binaryCell(v);
  }
  if (v instanceof Date) return temporalCell(v.toISOString());
  return nestedCell(toJsonPlain(v));
}

/** 스키마를 모르는 값(JSON·GEOMETRY 변환 결과 등)을 JSON으로. */
function toJsonPlain(v: unknown): JsonValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return leafCell(v, { name: '' }).json;
  if (Array.isArray(v)) return v.map(toJsonPlain);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJsonPlain(x)]));
  return v as JsonValue;
}

/** 스키마 노드를 따라 값을 JSON으로. */
function toJson(v: unknown, n: SchemaTree): JsonValue {
  if (v === null || v === undefined) return null;
  if (n.children.length === 0) {
    if (Array.isArray(v) && n.element.repetition_type === 'REPEATED') return v.map((x) => leafCell(x, n.element).json);
    return leafCell(v, n.element).json;
  }
  if (isList(n) && Array.isArray(v)) {
    const el = listElement(n);
    return v.map((x) => toJson(x, el));
  }
  if (isMap(n)) {
    const kv = n.children[0];
    const valueNode = kv?.children[1];
    if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), valueNode ? toJson(x, valueNode) : toJsonPlain(x)]));
    if (typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valueNode ? toJson(x, valueNode) : toJsonPlain(x)]));
    }
  }
  if (Array.isArray(v)) return v.map((x) => toJsonPlain(x));
  if (typeof v === 'object') {
    const out: { [k: string]: JsonValue } = {};
    for (const child of n.children) out[child.element.name] = toJson((v as Record<string, unknown>)[child.element.name], child);
    return out;
  }
  return toJsonPlain(v);
}

function cellFor(v: unknown, n: SchemaTree): Cell {
  if (n.children.length === 0 && !(Array.isArray(v) && n.element.repetition_type === 'REPEATED')) return leafCell(v, n.element);
  if (v === null || v === undefined) return nullCell;
  return nestedCell(toJson(v, n));
}

function typeLabel(n: SchemaTree): string {
  const e = n.element;
  if (n.children.length > 0) {
    if (isList(n)) return `list<${typeLabel(listElement(n))}>`;
    if (isMap(n)) {
      const kv = n.children[0];
      return kv && kv.children.length === 2 ? `map<${typeLabel(kv.children[0])},${typeLabel(kv.children[1])}>` : 'map';
    }
    return 'struct';
  }
  const lt = e.logical_type;
  let label: string;
  if (decimalScale(e) !== undefined) label = `decimal(${lt?.type === 'DECIMAL' ? lt.precision : e.precision},${decimalScale(e)})`;
  else if (lt?.type === 'TIMESTAMP') label = `timestamp(${({ MILLIS: 'ms', MICROS: 'us', NANOS: 'ns' } as const)[lt.unit]}${lt.isAdjustedToUTC ? ', UTC' : ''})`;
  else if (e.converted_type === 'TIMESTAMP_MILLIS') label = 'timestamp(ms)';
  else if (e.converted_type === 'TIMESTAMP_MICROS') label = 'timestamp(us)';
  else if (e.type === 'INT96') label = 'timestamp(ns, INT96)';
  else if (timeUnit(e)) label = `time(${timeUnit(e)})`;
  else if (lt?.type === 'DATE' || e.converted_type === 'DATE') label = 'date';
  else if (lt?.type === 'STRING' || e.converted_type === 'UTF8') label = 'string';
  else if (lt?.type === 'INTEGER') label = `${lt.isSigned ? 'int' : 'uint'}${lt.bitWidth}`;
  else if (lt) label = lt.type.toLowerCase();
  else if (e.converted_type) label = e.converted_type.toLowerCase();
  else label = (e.type ?? 'unknown').toLowerCase();
  return e.repetition_type === 'REPEATED' ? `repeated ${label}` : label;
}

function columnInfo(n: SchemaTree): ColumnInfo {
  const info: ColumnInfo = { name: n.element.name, type: typeLabel(n) };
  if (n.children.length > 0 && !isList(n) && !isMap(n)) info.children = n.children.map(columnInfo);
  return info;
}

/** DECIMAL 표시를 지운 metadata 사본. hyparquet가 decimal을 Number로 바꾸지 않게 한다. */
function withRawDecimals(md: FileMetaData): FileMetaData {
  return {
    ...md,
    schema: md.schema.map((e) => {
      if (decimalScale(e) === undefined) return e;
      const { converted_type: _c, logical_type: _l, ...rest } = e;
      return rest as SchemaElement;
    }),
  };
}

const str = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return binaryCell(v).text;
  if (isTs(v)) return formatTimestamp(v.$ts, v.unit);
  if (isDay(v)) return formatDate(v.$date);
  return String(v);
};
const bytes = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

/** 통계 값을 비교할 수 있는 원시 값으로. 비교할 수 없으면 undefined. */
function statKey(v: unknown): bigint | number | string | boolean | undefined {
  if (isTs(v)) return v.$ts;
  if (isDay(v)) return v.$date;
  if (typeof v === 'bigint' || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  return undefined;
}

/** row group 하나의 통계 값을 화면용 값으로. decimal은 hyparquet가 이미 Number로 바꿔 정밀도를 잃었으므로 버린다. */
function statValue(v: unknown, e: SchemaElement | undefined): unknown {
  if (v === undefined || v === null || !e) return v ?? undefined;
  if (decimalScale(e) !== undefined) return undefined;
  if (e.type === 'INT96' && v instanceof Uint8Array && v.length === 12) return { $ts: int96ToNanos(v), unit: 'ns' } satisfies Ts;
  return v;
}

function leafElements(tree: SchemaTree): Map<string, SchemaElement> {
  const out = new Map<string, SchemaElement>();
  const walk = (n: SchemaTree, path: string[]) => {
    if (n.children.length === 0) out.set(path.join('.'), n.element);
    for (const c of n.children) walk(c, [...path, c.element.name]);
  };
  for (const c of tree.children) walk(c, [c.element.name]);
  return out;
}

function metadataSections(md: FileMetaData, tree: SchemaTree): MetaSection[] {
  const leaves = leafElements(tree);
  const groups = md.row_groups;
  const perColumn = new Map<string, { codec: Set<string>; enc: Set<string>; comp: number; uncomp: number; min?: unknown; max?: unknown; nulls: bigint; type: string }>();
  let total = 0;
  for (const g of groups) {
    for (const c of g.columns) {
      const m = c.meta_data;
      if (!m) continue;
      const key = m.path_in_schema.join('.');
      const entry = perColumn.get(key) ?? { codec: new Set(), enc: new Set(), comp: 0, uncomp: 0, nulls: 0n, type: m.type };
      entry.codec.add(m.codec);
      m.encodings.forEach((x) => entry.enc.add(x));
      entry.comp += Number(m.total_compressed_size);
      entry.uncomp += Number(m.total_uncompressed_size);
      total += Number(m.total_compressed_size);
      const st = m.statistics;
      if (st) {
        const el = leaves.get(key);
        const min = statValue(st.min_value ?? st.min, el);
        const max = statValue(st.max_value ?? st.max, el);
        const kMin = statKey(min);
        const kMax = statKey(max);
        // 비교할 수 없는 값(바이너리 등)은 첫 row group 것만 보여 준다
        if (min !== undefined && (entry.min === undefined || (kMin !== undefined && kMin < statKey(entry.min)!))) entry.min = min;
        if (max !== undefined && (entry.max === undefined || (kMax !== undefined && kMax > statKey(entry.max)!))) entry.max = max;
        if (st.null_count !== undefined) entry.nulls += BigInt(st.null_count);
      }
      perColumn.set(key, entry);
    }
  }
  return [
    {
      title: '파일',
      pairs: [
        ['created_by', md.created_by ?? ''],
        ['version', String(md.version)],
        ['행 수', Number(md.num_rows).toLocaleString('ko-KR')],
        ['row group 수', String(groups.length)],
        ['metadata 크기', bytes(md.metadata_length)],
      ],
    },
    { title: 'key-value', pairs: (md.key_value_metadata ?? []).map((kv): [string, string] => [kv.key, kv.value ?? '']) },
    {
      title: 'row group',
      table: {
        headers: ['#', '행 수', '압축 크기', '비압축 크기'],
        rows: groups.map((g, i) => [
          String(i),
          Number(g.num_rows).toLocaleString('ko-KR'),
          bytes(Number(g.total_compressed_size ?? g.columns.reduce((s, c) => s + Number(c.meta_data?.total_compressed_size ?? 0), 0))),
          bytes(Number(g.total_byte_size)),
        ]),
      },
    },
    {
      title: '컬럼',
      table: {
        headers: ['컬럼', '물리 타입', '코덱', '인코딩', '압축', '비압축', '비율', '비중', 'min', 'max', 'null 수'],
        rows: [...perColumn].map(([name, e]) => [
          name, e.type, [...e.codec].join(', '), [...e.enc].join(', '), bytes(e.comp), bytes(e.uncomp),
          e.comp > 0 ? `${(e.uncomp / e.comp).toFixed(1)}×` : '', total > 0 ? `${((e.comp / total) * 100).toFixed(1)}%` : '',
          str(e.min), str(e.max), String(e.nulls),
        ]),
      },
    },
  ];
}

/** row group의 최상위 컬럼별 압축 바이트. */
function chunkBytes(md: FileMetaData, group: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of md.row_groups[group].columns) {
    const top = c.meta_data?.path_in_schema[0];
    if (top) out.set(top, (out.get(top) ?? 0) + Number(c.meta_data?.total_compressed_size ?? 0));
  }
  return out;
}

export function parquetReader(src: ByteSource, opts: { budget?: number } = {}): Reader {
  const budget = opts.budget ?? PAGE_BYTE_BUDGET;
  let md: FileMetaData;
  let raw: FileMetaData;
  let tree: SchemaTree;
  const file: AsyncBuffer = {
    byteLength: src.byteLength,
    slice: async (s, e) => {
      const b = await src.read(s, e ?? src.byteLength);
      return (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.slice().buffer) as ArrayBuffer;
    },
  };

  const cancelled = () => new TabulaError('cancelled', '취소했습니다.');

  return {
    async open(): Promise<FileSummary> {
      try {
        md = await parquetMetadataAsync(file, { parsers });
      } catch (e) {
        throw new TabulaError('corrupt', `Parquet 메타데이터를 읽을 수 없습니다: ${(e as Error).message}`);
      }
      raw = withRawDecimals(md);
      tree = parquetSchema(md);
      const names = tree.children.map((c) => c.element.name);
      const codecs = new Set(md.row_groups.flatMap((g) => g.columns.map((c) => c.meta_data?.codec ?? '')).filter(Boolean));
      const unsupported = [...codecs].filter((c) => c !== 'UNCOMPRESSED' && !(c in compressors) && c !== 'SNAPPY');
      if (unsupported.length) throw new TabulaError('unsupported-codec', `지원하지 않는 Parquet 코덱입니다: ${unsupported.join(', ')}`);

      let suggested = names;
      let notice: string | undefined;
      if (md.row_groups.length > 0) {
        const sizes = chunkBytes(md, 0);
        let sum = 0;
        suggested = [];
        for (const n of names) {
          sum += sizes.get(n) ?? 0;
          if (sum > budget && suggested.length > 0) break;
          suggested.push(n);
        }
        if (suggested.length < names.length) {
          notice = `첫 row group이 커서 앞쪽 컬럼 ${suggested.length}개만 골랐습니다. 왼쪽에서 볼 컬럼을 바꿀 수 있습니다.`;
        }
      }
      return {
        format: 'parquet',
        byteLength: src.byteLength,
        rowCount: Number(md.num_rows),
        codec: [...codecs].join(', ') || 'UNCOMPRESSED',
        columns: tree.children.map(columnInfo),
        suggestedColumns: suggested,
        notice,
        metadata: metadataSections(md, tree),
      };
    },

    async readPage(start, count, columns, signal) {
      const total = Number(md.num_rows);
      const end = Math.min(total, start + count);
      const picked = tree.children.filter((c) => columns.includes(c.element.name));
      if (start >= end || picked.length === 0) return { start, columns: picked.map((c) => c.element.name), rows: [], eof: end >= total, total };
      if (signal.aborted) throw cancelled();

      let need = 0;
      let groupStart = 0;
      md.row_groups.forEach((g, i) => {
        const groupEnd = groupStart + Number(g.num_rows);
        if (groupEnd > start && groupStart < end) {
          const sizes = chunkBytes(md, i);
          for (const c of picked) need += sizes.get(c.element.name) ?? 0;
        }
        groupStart = groupEnd;
      });
      if (need > budget) {
        throw new TabulaError('budget', `이 페이지를 읽으려면 ${bytes(need)}가 필요합니다. 컬럼 수를 줄여 주세요.`);
      }

      const names = picked.map((c) => c.element.name);
      let rows: Record<string, unknown>[] = [];
      try {
        await parquetRead({
          file, metadata: raw, columns: names, rowStart: start, rowEnd: end, rowFormat: 'object',
          compressors, parsers, utf8: false, useOffsetIndex: true,
          onComplete: (r) => {
            rows = r;
          },
        });
      } catch (e) {
        throw new TabulaError('corrupt', `Parquet 데이터를 읽을 수 없습니다: ${(e as Error).message}`);
      }
      if (signal.aborted) throw cancelled();
      return {
        start,
        columns: names,
        rows: rows.map((r) => picked.map((c) => cellFor(r[c.element.name], c))),
        eof: end >= total,
        total,
      };
    },

    async countRows() {
      return Number(md.num_rows);
    },
  };
}
