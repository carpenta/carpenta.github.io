import type { Format } from './types';

const ascii = (bytes: Uint8Array, at: number, text: string) =>
  bytes.length >= at + text.length && [...text].every((ch, i) => bytes[at + i] === ch.charCodeAt(0));

/** 파일 앞부분(head)과 끝부분(tail)의 매직 바이트로 형식을 판별한다. 확장자는 보지 않는다. */
export function detectFormat(head: Uint8Array, _tail: Uint8Array): Format | null {
  // 끝의 PAR1이 없으면 잘린 파일이다. Parquet으로 보고, 메타데이터를 읽는 단계에서 손상으로 알린다
  if (ascii(head, 0, 'PAR1')) return 'parquet';
  if (ascii(head, 0, 'ARROW1')) return 'arrow-file';
  if (head.length >= 4 && head[0] === 0xff && head[1] === 0xff && head[2] === 0xff && head[3] === 0xff) return 'arrow-stream';
  if (ascii(head, 0, 'Obj') && head[3] === 0x01) return 'avro';
  return null;
}
