// 테스트용 Parquet·Arrow·Avro 파일을 tests/fixtures/generated/에 만든다. 값은 행 번호에서 결정적으로 나온다.
// zstd 압축에 zlib.zstdCompressSync가 필요하다(Node 22.15 이상).
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import zlib from 'node:zlib';
import avro from 'avsc';
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

console.log(`fixtures written to ${out}`);
