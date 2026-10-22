export type Format = 'parquet' | 'arrow-file' | 'arrow-stream' | 'avro';

/** 파일에서 바이트 구간을 읽는다. bytesRead는 지금까지 읽은 총 바이트다. */
export interface ByteSource {
  readonly byteLength: number;
  readonly bytesRead: number;
  read(start: number, end: number): Promise<Uint8Array>;
}

export interface ColumnInfo {
  name: string;
  type: string;
  children?: ColumnInfo[];
}

export interface MetaSection {
  title: string;
  pairs?: [string, string][];
  table?: { headers: string[]; rows: string[][] };
  json?: string;
}

export interface FileSummary {
  format: Format;
  byteLength: number;
  rowCount: number | null;
  codec: string;
  columns: ColumnInfo[];
  suggestedColumns: string[];
  notice?: string;
  metadata: MetaSection[];
}

export type CellKind = 'null' | 'string' | 'number' | 'bool' | 'temporal' | 'binary' | 'nested';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** 표시용 값. text는 잘린 표시 문자열, full은 전체 문자열, json은 내보내기용 값이다. */
export interface Cell {
  kind: CellKind;
  text: string;
  full: string;
  json: JsonValue;
}

export interface Page {
  start: number;
  columns: string[];
  rows: Cell[][];
  eof: boolean;
}

export interface Reader {
  open(): Promise<FileSummary>;
  readPage(start: number, count: number, columns: string[], signal: AbortSignal): Promise<Page>;
  countRows(signal: AbortSignal, onProgress: (rows: number) => void): Promise<number>;
}

export type ErrorCode = 'unsupported-format' | 'corrupt' | 'unsupported-codec' | 'budget' | 'cancelled';

export class TabulaError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'TabulaError';
  }
}

export const PAGE_SIZE = 100;
export const PAGE_BYTE_BUDGET = 512 * 1024 * 1024;
export const TEXT_LIMIT = 200;
