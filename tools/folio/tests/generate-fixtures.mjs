import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import * as XLSX from 'xlsx';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'tests/fixtures/generated');
await mkdir(outDir, { recursive: true });

const text = (value) => strToU8(value);
const zip = (entries) => Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, text(value)]))));
const xml = (value) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`;

await writeFile(join(outDir, 'folio-docx.docx'), docxFixture('Folio DOCX Fixture', 'DOCX table cell'));
await writeFile(join(outDir, 'folio-pptx.pptx'), pptxFixture(['Folio PPTX Slide 1', 'Folio PPTX Slide 2']));
await writeFile(join(outDir, 'folio-external.pptx'), pptxFixture(['Folio External Relation'], true));
await writeFile(join(outDir, 'folio-hwpx.hwpx'), await hwpFixture('Folio HWPX Fixture', true));
await writeFile(join(outDir, 'folio-hwp.hwp'), await hwpFixture('Folio HWP Fixture'));
await writeFile(join(outDir, 'malformed.pptx'), Buffer.from('not a valid zip document'));
await writeFile(join(outDir, 'unsupported.txt'), 'plain text is not supported');

const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
  ['Title', 'Status', 'Note'],
  ['Folio XLSX Fixture', 'ready', 'first sheet'],
  ['Network upload', 'blocked', 'local only'],
]), 'Overview');
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
  ['Second Sheet'],
  ['Folio XLSX Sheet 2'],
]), 'Second');
await writeFile(join(outDir, 'folio-xlsx.xlsx'), Buffer.from(XLSX.write(book, { type: 'array', bookType: 'xlsx' })));

function docxFixture(title, cellText) {
  return zip({
    '[Content_Types].xml': xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    '_rels/.rels': xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/beacon.png" TargetMode="External"/></Relationships>`),
    'word/document.xml': xml(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${title}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>${cellText}</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`),
  });
}

function pptxFixture(slideTexts, includeExternal = false) {
  const entries = {
    '[Content_Types].xml': xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slideTexts.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`),
    '_rels/.rels': xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`),
    'ppt/presentation.xml': xml(`<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${slideTexts.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`),
    'ppt/_rels/presentation.xml.rels': xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slideTexts.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('')}</Relationships>`),
  };
  for (const [index, slideText] of slideTexts.entries()) {
    const relId = includeExternal && index === 0 ? '<a:blip r:embed="rImg1"/>' : '';
    entries[`ppt/slides/slide${index + 1}.xml`] = xml(`<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="${index + 2}" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="500000" y="500000"/><a:ext cx="7000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${slideText}</a:t></a:r></a:p><a:p><a:r><a:t>${relId ? 'external image relation present' : 'local text only'}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    if (includeExternal && index === 0) {
      entries[`ppt/slides/_rels/slide${index + 1}.xml.rels`] = xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/beacon.png" TargetMode="External"/></Relationships>`);
    }
  }
  return zip(entries);
}

function hwpxFixture(title) {
  return zip({
    '[Content_Types].xml': xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`),
    'Contents/header.xml': xml(`<head xmlns="http://www.hancom.co.kr/hwpml/2011/head"><title>${title}</title></head>`),
    'Contents/section0.xml': xml(`<section xmlns="http://www.hancom.co.kr/hwpml/2011/section"><p><run><t>${title}</t></run></p><p><run><t>local only</t></run></p></section>`),
  });
}

async function hwpFixture(title, hwpx = false) {
  const core = await import('@rhwp/core');
  const bytes = await readFile(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm', import.meta.url));
  globalThis.measureTextWidth = (_font, text) => text.length * 7;
  await core.default({ module_or_path: bytes });
  const doc = core.HwpDocument.createEmpty();
  try {
    doc.insertText(0, 0, 0, title);
    return Buffer.from(hwpx ? doc.exportHwpx() : doc.exportHwp());
  } finally { doc.free(); }
}

// Real OOXML style parts: colors, borders, font, alignment, dimensions and number format.
const { unzipSync, strFromU8 } = await import('fflate');
const styledBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(styledBook, XLSX.utils.aoa_to_sheet([['Styled header', 'Theme cell'], [0.125, 'Wrapped text\nSecond line']]), 'Styles');
const styled = unzipSync(new Uint8Array(XLSX.write(styledBook,{type:'array',bookType:'xlsx'})));
styled['xl/styles.xml'] = text(xml(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><color theme="1"/></font><font><b/><i/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF245746"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor theme="4" tint="0.5"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FF112233"/></left><right style="thin"><color rgb="FF112233"/></right><top style="thin"><color rgb="FF112233"/></top><bottom style="double"><color rgb="FF112233"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`));
let styledSheet = strFromU8(styled['xl/worksheets/sheet1.xml']);
styledSheet = styledSheet.replace('<sheetData>', '<cols><col min="1" max="1" width="25" customWidth="1"/><col min="2" max="2" width="32" customWidth="1"/></cols><sheetData>').replace('<row r="1">','<row r="1" ht="36" customHeight="1">').replace('<c r="A1"','<c s="1" r="A1"').replace('<c r="B1"','<c s="2" r="B1"').replace('<c r="A2"','<c s="3" r="A2"').replace('<c r="B2"','<c s="3" r="B2"');
styled['xl/worksheets/sheet1.xml'] = text(styledSheet);
await writeFile(join(outDir,'folio-styled.xlsx'),zipSync(styled));

const formulaBook = XLSX.utils.book_new();
const formulaSheet = XLSX.utils.aoa_to_sheet([['수식 계산 테스트','계산 결과'],[2,999],[4,999],['비율',999],['미지원',123]]);
formulaSheet.B2 = { t:'n', f:'SUM(A2:A3)', v:999 };
formulaSheet.B3 = { t:'n', f:'IF(B2=6,\'Other sheet\'!A1*2,0)', v:999 };
formulaSheet.B4 = { t:'n', f:'1/4', v:999, z:'0.0%' };
formulaSheet.B5 = { t:'n', f:'WEBSERVICE("https://example.com/never")', v:123 };
XLSX.utils.book_append_sheet(formulaBook,formulaSheet,'Formulas');
XLSX.utils.book_append_sheet(formulaBook,XLSX.utils.aoa_to_sheet([[5]]),'Other sheet');
await writeFile(join(outDir,'folio-formulas.xlsx'),Buffer.from(XLSX.write(formulaBook,{type:'array',bookType:'xlsx'})));
const longBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(longBook,XLSX.utils.aoa_to_sheet(Array.from({length:90},(_,row)=>Array.from({length:15},(_,col)=>`R${row+1}C${col+1}`))),'긴 시트');
await writeFile(join(outDir,'folio-long.xlsx'),Buffer.from(XLSX.write(longBook,{type:'array',bookType:'xlsx'})));
