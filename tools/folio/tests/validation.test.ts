import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { fileFormat, inspectZip, MAX_FILE_BYTES, validateDocument } from '../src/validation';
const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([key, value]) => [key, strToU8(value)]))).buffer as ArrayBuffer;
describe('local file boundary', () => {
  it('accepts all requested case-insensitive extensions', () => { for (const format of ['pptx','hwp','hwpx','xlsx','docx']) expect(fileFormat(`report.${format.toUpperCase()}`, 42)).toBe(format); });
  it('rejects empty, oversized and disguised files', () => { expect(() => fileFormat('x.docx', 0)).toThrow(); expect(() => fileFormat('x.docx', MAX_FILE_BYTES + 1)).toThrow(); expect(() => fileFormat('x.docx.exe', 30)).toThrow(); expect(() => validateDocument(new ArrayBuffer(40), 'docx')).toThrow(); });
  it('requires the correct package root', () => { const bytes = zip({ 'word/document.xml': '<document/>' }); expect(() => validateDocument(bytes, 'docx')).not.toThrow(); expect(() => validateDocument(bytes, 'xlsx')).toThrow(); });
  it('rejects huge decompression before allocating it', () => { const data = new Uint8Array(zip({ 'word/document.xml': '<document/>' })); const view = new DataView(data.buffer); for (let p=0;p<data.length-46;p++) if(view.getUint32(p,true)===0x02014b50) { view.setUint32(p+24,101*1024*1024,true); break; } expect(() => inspectZip(data.buffer)).toThrow(/압축 해제/); });
  it('rejects truncated ZIP and traversal paths', () => { const data = zip({ 'word/document.xml': '<document/>' }); expect(() => inspectZip(data.slice(0,-2))).toThrow(); expect(() => inspectZip(zip({ '../escape': 'x' }))).toThrow(); });
  it('rejects encrypted ZIP', () => { const data = new Uint8Array(zip({ 'word/document.xml': 'x' })); const view = new DataView(data.buffer); for (let p=0;p<data.length-46;p++) if(view.getUint32(p,true)===0x02014b50) { view.setUint16(p+8,1,true); break; } expect(() => inspectZip(data.buffer)).toThrow(/암호/); });
  it('rejects encrypted OOXML OLE and old HWP', () => { const data = new Uint8Array([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]); expect(() => validateDocument(data.buffer,'docx')).toThrow(/암호/); expect(() => validateDocument(new Uint8Array([72,87,80]).buffer,'hwp')).toThrow(/5.x/); });
});
