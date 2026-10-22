import { Cursor, decodeCell, skipValue } from '../avro/decode';
import { CODECS, readBlock, readBlockInfo, readHeader, type BlockInfo, type OcfHeader } from '../avro/ocf';
import { avroTypeLabel, type AvroType } from '../avro/schema';
import { TabulaError, type ByteSource, type Cell, type ColumnInfo, type FileSummary, type Reader } from '../types';

const cancelled = () => new TabulaError('cancelled', '취소했습니다.');
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function columnInfo(name: string, t: AvroType): ColumnInfo {
  const inner = t.kind === 'union' ? t.branches.find((b) => b.kind !== 'null' && t.branches.length === 2) : t;
  const children = inner?.kind === 'record' ? inner.fields.map((f) => columnInfo(f.name, f.type)) : undefined;
  return children ? { name, type: avroTypeLabel(t), children } : { name, type: avroTypeLabel(t) };
}

/** 최상위 필드 목록. 최상위가 record가 아니면 'value' 하나. */
function topFields(t: AvroType): { name: string; type: AvroType }[] {
  return t.kind === 'record' ? t.fields : [{ name: 'value', type: t }];
}

export function avroReader(src: ByteSource): Reader {
  let header: OcfHeader;
  const blocks: BlockInfo[] = [];
  const starts: number[] = []; // 각 블록의 첫 행 번호
  let knownRows = 0;
  let scanOffset = 0;
  let eof = false;
  let cache: { index: number; data: Uint8Array } | null = null;

  async function scanOne(): Promise<boolean> {
    const info = await readBlockInfo(src, scanOffset);
    if (!info) {
      eof = true;
      return false;
    }
    // 블록 끝의 sync를 확인해야 손상된 길이로 엉뚱한 곳을 다음 블록으로 읽지 않는다
    const sync = await src.read(info.next - 16, info.next);
    if (sync.some((x, i) => x !== header.sync[i])) throw new TabulaError('corrupt', 'Avro 파일이 손상되었습니다: sync 마커가 맞지 않습니다');
    blocks.push(info);
    starts.push(knownRows);
    knownRows += info.count;
    scanOffset = info.next;
    return true;
  }

  /** row가 들어 있는 블록 번호. 없으면 -1. 필요한 만큼 블록 헤더만 읽어 나간다. */
  async function locate(row: number, signal: AbortSignal): Promise<number> {
    while (row >= knownRows && !eof) {
      if (signal.aborted) throw cancelled();
      await scanOne();
    }
    if (row >= knownRows) return -1;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= row) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  async function blockData(index: number): Promise<Uint8Array> {
    if (cache?.index === index) return cache.data;
    const data = await readBlock(src, header, blocks[index]);
    cache = { index, data };
    return data;
  }

  return {
    async open(): Promise<FileSummary> {
      header = await readHeader(src);
      if (!CODECS.includes(header.codec)) throw new TabulaError('unsupported-codec', `지원하지 않는 Avro 코덱입니다: ${header.codec}`);
      scanOffset = header.dataStart;
      const fields = topFields(header.schema);
      let pretty = header.schemaJson;
      try {
        pretty = JSON.stringify(JSON.parse(header.schemaJson), null, 2);
      } catch {
        // parseHeader가 이미 검사했다
      }
      return {
        format: 'avro',
        byteLength: src.byteLength,
        rowCount: null,
        codec: header.codec,
        columns: fields.map((f) => columnInfo(f.name, f.type)),
        suggestedColumns: fields.map((f) => f.name),
        metadata: [
          { title: '파일', pairs: [['codec', header.codec], ['sync', hex(header.sync)], ...header.meta] },
          { title: '스키마', json: pretty },
        ],
      };
    },

    async readPage(start, count, columns, signal) {
      const fields = topFields(header.schema);
      const wanted = new Set(columns);
      const picked = fields.filter((f) => wanted.has(f.name)).map((f) => f.name);
      const rows: Cell[][] = [];
      let index = await locate(start, signal);
      let skip = index >= 0 ? start - starts[index] : 0;
      while (index >= 0 && rows.length < count) {
        if (signal.aborted) throw cancelled();
        const c = new Cursor(await blockData(index));
        const records = blocks[index].count;
        for (let r = 0; r < records && rows.length < count; r++) {
          if (r < skip) {
            for (const f of fields) skipValue(f.type, c);
            continue;
          }
          const row: Cell[] = [];
          for (const f of fields) {
            if (wanted.has(f.name)) row.push(decodeCell(f.type, c));
            else skipValue(f.type, c);
          }
          rows.push(row);
        }
        skip = 0;
        if (rows.length >= count) break;
        index = await locate(starts[index] + records, signal);
      }
      const end = start + rows.length;
      if (end >= knownRows && !eof) await locate(end, signal);
      const atEnd = eof && end >= knownRows;
      return { start, columns: picked, rows, eof: atEnd, total: atEnd ? knownRows : undefined };
    },

    async countRows(signal, onProgress) {
      let n = 0;
      while (!eof) {
        if (signal.aborted) throw cancelled();
        await scanOne();
        if (++n % 20 === 0) onProgress(knownRows);
      }
      onProgress(knownRows);
      return knownRows;
    },
  };
}
