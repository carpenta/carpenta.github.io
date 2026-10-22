// "샘플 파일 열기"용 가짜 이벤트 데이터를 public/sample/sample.parquet에 만든다. 빌드 전에 돌고, 결과는 커밋하지 않는다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parquetWriteBuffer } from 'hyparquet-writer';

const N = 5000;
const out = join(import.meta.dirname, '../public/sample');
mkdirSync(out, { recursive: true });

// 결정적인 의사 난수
let seed = 20261022;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

const types = ['page_view', 'search', 'add_to_cart', 'checkout', 'purchase', 'refund'];
const sources = ['web', 'ios', 'android', 'partner_api'];
const tagPool = ['new_user', 'returning', 'promo', 'mobile', 'beta', 'vip'];
const start = 1792540800000000n; // 2026-10-21 00:00:00 UTC, 마이크로초

const rows = [];
let t = start;
for (let i = 0; i < N; i++) {
  t += BigInt(Math.floor(rand() * 20_000_000));
  const type = pick(types);
  rows.push({
    event_id: 7_300_000_000_000n + BigInt(i),
    user_id: rand() < 0.1 ? null : `u_${String(Math.floor(rand() * 90000) + 10000)}`,
    ts: t,
    event_type: type,
    amount: type === 'purchase' || type === 'refund' ? BigInt(Math.floor(rand() * 2_000_000)) * (type === 'refund' ? -1n : 1n) : null,
    tags: Array.from({ length: Math.floor(rand() * 3) }, () => pick(tagPool)),
    props: { source: pick(sources), ver: `4.${Math.floor(rand() * 5)}.${Math.floor(rand() * 10)}` },
  });
}

const col = (name) => rows.map((r) => r[name]);
const buf = parquetWriteBuffer({
  columnData: ['event_id', 'user_id', 'ts', 'event_type', 'amount', 'tags', 'props'].map((name) => ({ name, data: col(name) })),
  schema: [
    { name: 'root', num_children: 7 },
    { name: 'event_id', type: 'INT64', repetition_type: 'REQUIRED' },
    { name: 'user_id', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' },
    { name: 'ts', type: 'INT64', converted_type: 'TIMESTAMP_MICROS', logical_type: { type: 'TIMESTAMP', isAdjustedToUTC: true, unit: 'MICROS' }, repetition_type: 'REQUIRED' },
    { name: 'event_type', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
    { name: 'amount', type: 'INT64', converted_type: 'DECIMAL', scale: 2, precision: 12, repetition_type: 'OPTIONAL' },
    { name: 'tags', converted_type: 'LIST', num_children: 1, repetition_type: 'OPTIONAL' },
    { name: 'list', num_children: 1, repetition_type: 'REPEATED' },
    { name: 'element', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' },
    { name: 'props', num_children: 2, repetition_type: 'OPTIONAL' },
    { name: 'source', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' },
    { name: 'ver', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' },
  ],
  codec: 'SNAPPY',
  rowGroupSize: 1000,
  kvMetadata: [{ key: 'tabula.sample', value: 'synthetic events, not real data' }],
  createdBy: 'tabula sample generator',
});
writeFileSync(join(out, 'sample.parquet'), new Uint8Array(buf));
console.log(`sample written: ${N} rows`);
