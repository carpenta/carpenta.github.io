import type { Format } from './types';

export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
export const FORMATS = ['pptx', 'hwp', 'hwpx', 'xlsx', 'docx'] as const;
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function fileFormat(name: string, size: number): Format {
  const extension = name.split('.').pop()?.toLowerCase();
  if (!FORMATS.includes(extension as Format)) throw new Error('PPTX, HWP, HWPX, XLSX, DOCX 파일을 선택해 주세요.');
  if (!size) throw new Error('내용이 없는 파일입니다. 다른 파일을 선택해 주세요.');
  if (size > MAX_FILE_BYTES) throw new Error('파일당 최대 30 MB까지 열 수 있습니다.');
  return extension as Format;
}

// Read the central directory before a parser allocates decompressed content.
// ZIP64, multi-volume and encrypted archives are deliberately unsupported.
export function inspectZip(buffer: ArrayBuffer): string[] {
  const view = new DataView(buffer);
  let end = -1;
  for (let p = view.byteLength - 22; p >= Math.max(0, view.byteLength - 65557); p--) {
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === view.byteLength) { end = p; break; }
  }
  if (end < 0) throw new Error('문서 압축 구조가 손상되었습니다.');
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count > 5000) {
    throw new Error('분할 압축 또는 항목이 너무 많은 문서는 지원하지 않습니다.');
  }
  let offset = view.getUint32(end + 16, true);
  const directoryEnd = offset + view.getUint32(end + 12, true);
  if (directoryEnd !== end) throw new Error('지원하지 않는 ZIP 구조입니다.');
  let expanded = 0;
  const names: string[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('문서 압축 구조가 손상되었습니다.');
    const flags = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (flags & 1) throw new Error('암호가 걸린 문서는 지원하지 않습니다. 암호를 해제한 사본을 선택해 주세요.');
    if (next > end || local + 30 > offset || view.getUint32(local, true) !== 0x04034b50) throw new Error('문서 압축 구조가 손상되었습니다.');
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (dataStart + compressed > view.getUint32(end + 16, true)) throw new Error('문서 압축 범위가 올바르지 않습니다.');
    expanded += size;
    if (size > 30 * 1024 * 1024 || expanded > MAX_EXPANDED_BYTES || (size > 1024 * 1024 && size / Math.max(compressed, 1) > 300)) {
      throw new Error('압축 해제 크기가 너무 큽니다. 더 작은 문서를 선택해 주세요.');
    }
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    if (name.includes('..') || name.startsWith('/') || name.includes('\\') || names.includes(name)) throw new Error('안전하지 않은 압축 경로가 포함되어 있습니다.');
    names.push(name);
    offset = next;
  }
  if (offset !== directoryEnd) throw new Error('문서 압축 구조가 손상되었습니다.');
  return names;
}

export function validateDocument(buffer: ArrayBuffer, format: Format): void {
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('파일당 최대 30 MB까지 열 수 있습니다.');
  const bytes = new Uint8Array(buffer);
  const isOle = OLE.every((value, index) => bytes[index] === value);
  if (format === 'hwp') {
    if (!isOle) throw new Error('HWP 5.x 형식이 아닙니다. HWPX 또는 HWP 5.x로 저장한 파일을 선택해 주세요.');
    return;
  }
  if (isOle) throw new Error('암호화된 Office 문서는 지원하지 않습니다. 암호를 해제한 사본을 선택해 주세요.');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('파일 내용과 확장자가 일치하지 않거나 문서가 손상되었습니다.');
  const names = inspectZip(buffer);
  const required = { pptx: 'ppt/presentation.xml', docx: 'word/document.xml', xlsx: 'xl/workbook.xml', hwpx: 'Contents/header.xml' }[format];
  if (!names.includes(required)) throw new Error(`${format.toUpperCase()} 문서 구조를 찾을 수 없습니다. 파일 형식을 확인해 주세요.`);
}
