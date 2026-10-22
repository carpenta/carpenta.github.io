import { TabulaError } from '../types';

type Primitive = 'null' | 'boolean' | 'int' | 'long' | 'float' | 'double' | 'bytes' | 'string';

export type AvroType =
  | { kind: Primitive; logical?: string; precision?: number; scale?: number }
  | { kind: 'fixed'; name: string; size: number; logical?: string; precision?: number; scale?: number }
  | { kind: 'enum'; name: string; symbols: string[] }
  | { kind: 'array'; items: AvroType }
  | { kind: 'map'; values: AvroType }
  | { kind: 'union'; branches: AvroType[] }
  | { kind: 'record'; name: string; fields: { name: string; type: AvroType }[] };

const PRIMITIVES = new Set<string>(['null', 'boolean', 'int', 'long', 'float', 'double', 'bytes', 'string']);

const invalid = (why: string) => new TabulaError('corrupt', `Avro 스키마를 해석할 수 없습니다: ${why}`);

/** 스키마 JSON을 AvroType으로. named type 참조와 namespace를 해결한다. 재귀 record는 같은 객체를 가리킨다. */
export function parseSchema(json: unknown): AvroType {
  const named = new Map<string, AvroType>();

  const fullName = (name: string, ns: string | undefined) => (name.includes('.') || !ns ? name : `${ns}.${name}`);
  const short = (name: string) => name.slice(name.lastIndexOf('.') + 1);

  function walk(s: unknown, ns: string | undefined): AvroType {
    if (typeof s === 'string') {
      if (PRIMITIVES.has(s)) return { kind: s as Primitive };
      const found = named.get(fullName(s, ns)) ?? named.get(s);
      if (!found) throw invalid(`알 수 없는 타입 ${s}`);
      return found;
    }
    if (Array.isArray(s)) return { kind: 'union', branches: s.map((b) => walk(b, ns)) };
    if (!s || typeof s !== 'object') throw invalid('타입이 아닌 값');
    const o = s as Record<string, unknown>;
    const type = o.type;
    const logical = typeof o.logicalType === 'string' ? o.logicalType : undefined;
    const precision = typeof o.precision === 'number' ? o.precision : undefined;
    const scale = typeof o.scale === 'number' ? o.scale : undefined;
    const space = typeof o.namespace === 'string' ? o.namespace : ns;

    if (typeof type === 'string' && PRIMITIVES.has(type)) return { kind: type as Primitive, logical, precision, scale };
    if (type === 'array') return { kind: 'array', items: walk(o.items, ns) };
    if (type === 'map') return { kind: 'map', values: walk(o.values, ns) };
    if (type === 'enum' || type === 'fixed' || type === 'record' || type === 'error') {
      if (typeof o.name !== 'string') throw invalid('이름 없는 named type');
      const name = fullName(o.name, space);
      const childNs = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : space;
      if (type === 'enum') {
        const t: AvroType = { kind: 'enum', name: short(name), symbols: (o.symbols as string[]) ?? [] };
        named.set(name, t);
        return t;
      }
      if (type === 'fixed') {
        const t: AvroType = { kind: 'fixed', name: short(name), size: Number(o.size), logical, precision, scale };
        named.set(name, t);
        return t;
      }
      const t: AvroType = { kind: 'record', name: short(name), fields: [] };
      named.set(name, t);
      for (const f of (o.fields as { name: string; type: unknown }[]) ?? []) t.fields.push({ name: f.name, type: walk(f.type, childNs) });
      return t;
    }
    if (typeof type === 'object' || Array.isArray(type)) return walk(type, space);
    if (typeof type === 'string') return walk(type, space);
    throw invalid(`알 수 없는 타입 ${String(type)}`);
  }

  return walk(json, undefined);
}

/** 화면에 보일 짧은 타입 이름. */
export function avroTypeLabel(t: AvroType): string {
  switch (t.kind) {
    case 'record':
    case 'enum':
      return t.name;
    case 'fixed':
      return t.logical === 'decimal' ? `decimal(${t.precision},${t.scale ?? 0})` : t.logical ?? `fixed(${t.size})`;
    case 'array':
      return `array<${avroTypeLabel(t.items)}>`;
    case 'map':
      return `map<${avroTypeLabel(t.values)}>`;
    case 'union': {
      const others = t.branches.filter((b) => b.kind !== 'null');
      const nullable = others.length < t.branches.length;
      const inner = others.length === 1 ? avroTypeLabel(others[0]) : `union<${others.map(avroTypeLabel).join('|')}>`;
      return nullable ? `${inner}?` : inner;
    }
    default: {
      if (t.logical === 'decimal') return `decimal(${t.precision},${t.scale ?? 0})`;
      const ts = t.logical?.match(/^(local-)?timestamp-(millis|micros|nanos)$/);
      if (ts) {
        const unit = { millis: 'ms', micros: 'us', nanos: 'ns' }[ts[2] as 'millis' | 'micros' | 'nanos'];
        // timestamp-*는 UTC 기준 순간, local-timestamp-*는 시간대 없는 값이다
        return ts[1] ? `local-timestamp(${unit})` : `timestamp(${unit}, UTC)`;
      }
      return t.logical ?? t.kind;
    }
  }
}
