// 테스트용 Parquet·Arrow·Avro 파일을 tests/fixtures/generated/에 만든다. 값은 행 번호에서 결정적으로 나온다.
// zstd 압축에 zlib.zstdCompressSync가 필요하다(Node 22.15 이상).
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import zlib from 'node:zlib';
import avro from 'avsc';
import { parquetWriteBuffer } from 'hyparquet-writer';
import {
  CompressionType, Decimal, Dictionary, Field, Int32, Int64, List, RecordBatchStreamWriter, Struct, Table,
  TimestampMicrosecond, Utf8, compressionRegistry, makeData, makeVector, tableToIPC, vectorFromArray,
} from 'apache-arrow';
import lz4js from 'lz4js';
import snappy from 'snappyjs';

const out = join(import.meta.dirname, 'fixtures/generated');
mkdirSync(out, { recursive: true });

// ---------- Avro ----------

const bigLong = avro.types.LongType.__with({
  fromBuffer: (buf) => buf.readBigInt64LE(),
  toBuffer: (n) => {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64LE(BigInt(n));
    return buf;
  },
  fromJSON: BigInt,
  toJSON: Number,
  isValid: (n) => typeof n === 'bigint',
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
});

export const avroSchema = {
  type: 'record',
  name: 'Event',
  namespace: 'test',
  fields: [
    { name: 'id', type: 'long' },
    { name: 'i32', type: 'int' },
    { name: 'f32', type: 'float' },
    { name: 'f64', type: 'double' },
    { name: 'flag', type: 'boolean' },
    { name: 'name', type: 'string' },
    { name: 'raw', type: 'bytes' },
    { name: 'color', type: { type: 'enum', name: 'Color', symbols: ['RED', 'GREEN', 'BLUE'] } },
    { name: 'fx', type: { type: 'fixed', name: 'Four', size: 4 } },
    { name: 'tags', type: { type: 'array', items: 'string' } },
    { name: 'attrs', type: { type: 'map', values: 'long' } },
    { name: 'opt', type: ['null', 'string'] },
    { name: 'multi', type: ['null', 'long', 'string'] },
    { name: 'inner', type: { type: 'record', name: 'Inner', fields: [{ name: 'x', type: 'int' }, { name: 'y', type: ['null', 'Color'] }] } },
    { name: 'amount', type: { type: 'bytes', logicalType: 'decimal', precision: 10, scale: 2 } },
    { name: 'uid', type: { type: 'string', logicalType: 'uuid' } },
    { name: 'day', type: { type: 'int', logicalType: 'date' } },
    { name: 'tm', type: { type: 'int', logicalType: 'time-millis' } },
    { name: 'tu', type: { type: 'long', logicalType: 'time-micros' } },
    { name: 'ts_ms', type: { type: 'long', logicalType: 'timestamp-millis' } },
    { name: 'ts_us', type: { type: 'long', logicalType: 'timestamp-micros' } },
    { name: 'ts_ns', type: { type: 'long', logicalType: 'timestamp-nanos' } },
    { name: 'lts', type: { type: 'long', logicalType: 'local-timestamp-micros' } },
  ],
};

function twos(v) {
  // 최소 길이의 big-endian 2의 보수
  let hex = (v < 0n ? (1n << 64n) + v : v).toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let buf = Buffer.from(hex, 'hex');
  if (v >= 0n && buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]);
  while (buf.length > 1 && ((buf[0] === 0xff && buf[1] & 0x80) || (buf[0] === 0 && !(buf[1] & 0x80)))) buf = buf.subarray(1);
  return buf;
}

export function avroRow(i) {
  const n = BigInt(i);
  return {
    id: n * 1000000007n,
    i32: i - 500,
    f32: i / 4,
    f64: i * 1.5,
    flag: i % 2 === 0,
    name: i % 10 === 0 ? '' : `name-${i}`,
    raw: Buffer.from([i & 255, 1, 2]),
    color: ['RED', 'GREEN', 'BLUE'][i % 3],
    fx: Buffer.from([i & 255, 0xaa, 0xbb, 0xcc]),
    tags: i % 5 === 0 ? [] : ['a', 'b'.repeat((i % 3) + 1)],
    attrs: { k: n },
    opt: i % 4 === 0 ? null : `opt-${i}`,
    multi: i % 3 === 0 ? null : i % 3 === 1 ? n : `s${i}`,
    inner: { x: i, y: i % 2 === 0 ? 'GREEN' : null },
    amount: twos(12345n + n),
    uid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    day: 19000 + i,
    tm: 3723004,
    tu: 3723004005n,
    ts_ms: 1700000000000n + n,
    ts_us: 1700000000000000n + n,
    ts_ns: 1700000000000000000n + n,
    lts: 1700000000000000n + n,
  };
}

const avroCodecs = {
  null: (buf, cb) => cb(null, buf),
  deflate: (buf, cb) => zlib.deflateRaw(buf, cb),
  snappy: (buf, cb) => {
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(buf) >>> 0);
    cb(null, Buffer.concat([Buffer.from(snappy.compress(buf)), crc]));
  },
  zstandard: (buf, cb) => cb(null, zlib.zstdCompressSync(buf)),
};

async function writeAvro(name, codec, rows, blockSize) {
  // long은 모두 BigInt로 쓴다. 논리 타입이 붙은 long도 같아야 하므로 registry가 아니라 typeHook을 쓴다.
  const type = avro.Type.forSchema(avroSchema, { typeHook: (s) => (s === 'long' || s?.type === 'long' ? bigLong : undefined) });
  const encoder = new avro.streams.BlockEncoder(type, { codec, codecs: avroCodecs, blockSize, metadata: { 'tabula.test': Buffer.from('yes') } });
  // typeHook을 쓰면 헤더에 논리 타입이 빠지므로, 헤더에는 원래 스키마를 쓴다(avsc 내부 필드).
  encoder._schema = avroSchema;
  const file = createWriteStream(join(out, name));
  encoder.pipe(file);
  for (let i = 0; i < rows; i++) encoder.write(avroRow(i));
  encoder.end();
  await finished(file);
}

for (const codec of Object.keys(avroCodecs)) await writeAvro(`avro-all-types-${codec}.avro`, codec, 1000, 8192);
await writeAvro('avro-big.avro', 'deflate', 200000, 30000);
const big = readFileSync(join(out, 'avro-big.avro'));
writeFileSync(join(out, 'truncated.avro'), big.subarray(0, Math.floor(big.length * 0.6)));
writeFileSync(join(out, 'unsupported.txt'), 'a,b,c\n1,2,3\n');

// ---------- Parquet ----------

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const ts = (unit) => ({ type: 'TIMESTAMP', isAdjustedToUTC: true, unit });

export function parquetColumns(n) {
  return {
    columnData: [
      { name: 'id', data: range(n, (i) => i) },
      { name: 'big', data: range(n, (i) => 9007199254740993n + BigInt(i)) },
      { name: 'f64', data: range(n, (i) => i * 1.5) },
      { name: 'flag', data: range(n, (i) => i % 2 === 0) },
      { name: 'name', data: range(n, (i) => (i % 10 === 0 ? '' : i % 10 === 1 ? null : `name-${i}`)) },
      { name: 'amount', data: range(n, (i) => 9223372036854775807n - BigInt(i)) },
      { name: 'day', data: range(n, (i) => 19000 + i) },
      { name: 'ts', data: range(n, (i) => 1700000000000000n + BigInt(i)) },
      { name: 'ts_ms', data: range(n, (i) => 1700000000000n + BigInt(i)) },
      { name: 'tags', data: range(n, (i) => (i % 5 === 0 ? [] : i % 5 === 1 ? null : ['a', 'b'.repeat((i % 3) + 1)])) },
      { name: 'st', data: range(n, (i) => (i % 7 === 0 ? null : { a: i, b: i % 2 ? null : 'x' })) },
    ],
    schema: [
      { name: 'root', num_children: 11 },
      { name: 'id', type: 'INT32', repetition_type: 'REQUIRED' },
      { name: 'big', type: 'INT64', repetition_type: 'OPTIONAL' },
      { name: 'f64', type: 'DOUBLE', repetition_type: 'OPTIONAL' },
      { name: 'flag', type: 'BOOLEAN', repetition_type: 'OPTIONAL' },
      { name: 'name', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' },
      { name: 'amount', type: 'INT64', converted_type: 'DECIMAL', scale: 4, precision: 18, repetition_type: 'OPTIONAL' },
      { name: 'day', type: 'INT32', converted_type: 'DATE', repetition_type: 'OPTIONAL' },
      { name: 'ts', type: 'INT64', converted_type: 'TIMESTAMP_MICROS', logical_type: ts('MICROS'), repetition_type: 'OPTIONAL' },
      { name: 'ts_ms', type: 'INT64', converted_type: 'TIMESTAMP_MILLIS', logical_type: ts('MILLIS'), repetition_type: 'OPTIONAL' },
      { name: 'tags', converted_type: 'LIST', num_children: 1, repetition_type: 'OPTIONAL' },
      { name: 'list', num_children: 1, repetition_type: 'REPEATED' },
      { name: 'element', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' },
      { name: 'st', num_children: 2, repetition_type: 'OPTIONAL' },
      { name: 'a', type: 'INT32', repetition_type: 'OPTIONAL' },
      { name: 'b', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' },
    ],
  };
}

const parquetCompressors = {
  GZIP: (b) => zlib.gzipSync(b),
  BROTLI: (b) => zlib.brotliCompressSync(b),
  ZSTD: (b) => zlib.zstdCompressSync(b),
};

for (const codec of ['UNCOMPRESSED', 'SNAPPY', 'GZIP', 'BROTLI', 'ZSTD']) {
  const buf = parquetWriteBuffer({
    ...parquetColumns(1000), codec, compressors: parquetCompressors, rowGroupSize: 250,
    kvMetadata: [{ key: 'tabula.test', value: 'yes' }], createdBy: 'tabula fixtures',
  });
  writeFileSync(join(out, `parquet-${codec}.parquet`), new Uint8Array(buf));
}

{
  const n = 1000000;
  const buf = parquetWriteBuffer({
    columnData: [
      { name: 'id', data: range(n, (i) => i), type: 'INT32' },
      { name: 'v1', data: range(n, (i) => BigInt(i) * 3n), type: 'INT64' },
      { name: 'v2', data: range(n, (i) => i / 3), type: 'DOUBLE' },
      { name: 's1', data: range(n, (i) => `row-${i}`), type: 'STRING' },
      { name: 's2', data: range(n, (i) => `group-${i % 97}`), type: 'STRING' },
      { name: 'b', data: range(n, (i) => i % 3 === 0), type: 'BOOLEAN' },
      { name: 'v3', data: range(n, (i) => i * 7), type: 'INT32' },
      { name: 's3', data: range(n, (i) => `${i}`.repeat(3)), type: 'STRING' },
    ],
    rowGroupSize: 25000,
  });
  writeFileSync(join(out, 'parquet-big.parquet'), new Uint8Array(buf));
}

// ---------- Arrow ----------

function arrowBatchTable(from, n) {
  const ids = BigInt64Array.from({ length: n }, (_, k) => BigInt(from + k));
  const tsv = BigInt64Array.from({ length: n }, (_, k) => 1700000000000000n + BigInt(from + k));
  const dec = new Uint32Array(n * 4);
  for (let k = 0; k < n; k++) {
    let v = 9223372036854775807n - BigInt(from + k);
    for (let w = 0; w < 4; w++) {
      dec[k * 4 + w] = Number(v & 0xffffffffn);
      v >>= 32n;
    }
  }
  const at = (f) => Array.from({ length: n }, (_, k) => f(from + k));
  return new Table({
    id: makeVector(makeData({ type: new Int64(), length: n, data: ids })),
    name: vectorFromArray(at((i) => (i % 10 === 0 ? '' : i % 10 === 1 ? null : `name-${i}`)), new Utf8()),
    ts: makeVector(makeData({ type: new TimestampMicrosecond('UTC'), length: n, data: tsv })),
    amount: makeVector(makeData({ type: new Decimal(4, 18, 128), length: n, data: dec })),
    tags: vectorFromArray(at((i) => (i % 5 === 0 ? [] : i % 5 === 1 ? null : ['a', 'b'.repeat((i % 3) + 1)])), new List(new Field('item', new Utf8(), true))),
    st: vectorFromArray(at((i) => (i % 7 === 0 ? null : { a: i })), new Struct([new Field('a', new Int32(), true)])),
    cat: vectorFromArray(at((i) => ['x', 'y', 'z'][i % 3]), new Dictionary(new Utf8(), new Int32())),
  });
}

{
  // 한 번에 만든 뒤 잘라야 스키마(dictionary id, nullable)가 같다
  const whole = arrowBatchTable(0, 1000);
  const table = new Table([0, 250, 500, 750].flatMap((from) => whole.slice(from, from + 250).batches));
  writeFileSync(join(out, 'arrow-file.arrow'), tableToIPC(table, 'file'));
  writeFileSync(join(out, 'arrow-stream.arrows'), tableToIPC(table, 'stream'));

  // 시간대가 붙은 timestamp: 값은 UTC epoch다
  const tz = new Table({ ts: makeVector(makeData({ type: new TimestampMicrosecond('Asia/Seoul'), length: 1, data: BigInt64Array.from([1700000000000000n]) })) });
  writeFileSync(join(out, 'arrow-tz.arrows'), tableToIPC(tz, 'stream'));

  compressionRegistry.set(CompressionType.ZSTD, { encode: (b) => new Uint8Array(zlib.zstdCompressSync(b)) });
  compressionRegistry.set(CompressionType.LZ4_FRAME, { encode: (b) => new Uint8Array(lz4js.compress(b)) });
  for (const [name, compressionType] of [['zstd', CompressionType.ZSTD], ['lz4', CompressionType.LZ4_FRAME]]) {
    const writer = new RecordBatchStreamWriter({ compressionType });
    writeFileSync(join(out, `arrow-${name}.arrows`), writer.writeAll(table).toUint8Array(true));
  }
}

console.log(`fixtures written to ${out}`);
