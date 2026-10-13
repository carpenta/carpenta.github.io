import { unzipSync } from 'fflate';

export type XlsxStyles = {
  styles: string[];
  sheets: Record<string, {
    cells: Record<string, number>;
    rows: Record<string, { height?: number; style?: number }>;
    columns: Array<{ min: number; max: number; width?: number; style?: number }>;
  }>;
};

type Xf = {
  fontId?: number;
  fillId?: number;
  borderId?: number;
  alignment?: Element;
};

type Theme = string[];

const MAX_XML_ENTRY = 16 * 1024 * 1024;
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMPTY: XlsxStyles = { styles: [], sheets: {} };
const decoder = new TextDecoder();

const indexedColors = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

export function readXlsxStyles(buffer: ArrayBuffer): XlsxStyles {
  try {
    const zip = unzipSync(new Uint8Array(buffer), {
      filter: (file) => isRelevantXml(file.name) && file.originalSize <= MAX_XML_ENTRY,
    });
    const workbook = xml(zip, 'xl/workbook.xml');
    const rels = xml(zip, 'xl/_rels/workbook.xml.rels');
    if (!workbook || !rels) return EMPTY;

    const relationships = workbookRelationships(rels);
    const sheets = workbookSheets(workbook, relationships);
    const theme = parseTheme(xml(zip, 'xl/theme/theme1.xml'));
    const parsedStyles = parseStyles(xml(zip, 'xl/styles.xml'), theme);

    const sheetEntries: Array<[string, XlsxStyles['sheets'][string]]> = [];
    for (const sheet of sheets) {
      const sheetDoc = xml(zip, sheet.path);
      if (sheetDoc) sheetEntries.push([sheet.name, parseSheetLayout(sheetDoc)]);
    }

    return { styles: parsedStyles, sheets: Object.fromEntries(sheetEntries) };
  } catch {
    return EMPTY;
  }
}

function isRelevantXml(path: string): boolean {
  return path === 'xl/workbook.xml'
    || path === 'xl/styles.xml'
    || path === 'xl/theme/theme1.xml'
    || path === 'xl/_rels/workbook.xml.rels'
    || /^xl\/worksheets\/[^/]+\.xml$/.test(path);
}

function xml(zip: Record<string, Uint8Array>, path: string): Document | null {
  const entry = zip[path];
  if (!entry) return null;
  const doc = new DOMParser().parseFromString(decoder.decode(entry), 'application/xml');
  if (doc.documentElement.localName === 'parsererror' || doc.getElementsByTagName('parsererror').length) return null;
  return doc;
}

function workbookRelationships(doc: Document): Map<string, string> {
  const rels = new Map<string, string>();
  for (const rel of elements(doc, 'Relationship')) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (id && target) rels.set(id, normalizePath('xl', target));
  }
  return rels;
}

function workbookSheets(doc: Document, rels: Map<string, string>): Array<{ name: string; path: string }> {
  return elements(doc, 'sheet').flatMap((sheet) => {
    const name = attr(sheet, 'name');
    const relId = attr(sheet, 'id') ?? sheet.getAttributeNS(REL_NS, 'id');
    const path = relId ? rels.get(relId) : undefined;
    return name && path ? [{ name, path }] : [];
  });
}

function parseStyles(doc: Document | null, theme: Theme): string[] {
  if (!doc) return [];

  const fonts = children(first(doc, 'fonts'), 'font').map((font) => fontCss(font, theme));
  const fills = children(first(doc, 'fills'), 'fill').map((fill) => fillCss(fill, theme));
  const borders = children(first(doc, 'borders'), 'border').map((border) => borderCss(border, theme));
  const cellStyleXfs = children(first(doc, 'cellStyleXfs'), 'xf').map(parseXf);
  const cellXfs = children(first(doc, 'cellXfs'), 'xf').map((xf) => {
    const parsed = parseXf(xf);
    const base = parsed.xfId === undefined ? undefined : cellStyleXfs[parsed.xfId];
    return mergeXf(base, parsed);
  });

  const styles = cellXfs.map((xf) => [
    fonts[xf.fontId ?? 0],
    fills[xf.fillId ?? 0],
    borders[xf.borderId ?? 0],
    xf.alignment ? alignmentCss(xf.alignment) : '',
  ].filter(Boolean).join(''));

  return styles;
}

function parseXf(el: Element): Xf & { xfId?: number } {
  return {
    fontId: numberAttr(el, 'fontId'),
    fillId: numberAttr(el, 'fillId'),
    borderId: numberAttr(el, 'borderId'),
    xfId: numberAttr(el, 'xfId'),
    alignment: child(el, 'alignment') ?? undefined,
  };
}

function mergeXf(base: Xf | undefined, xf: Xf): Xf {
  if (!base) return xf;
  return {
    fontId: xf.fontId ?? base.fontId,
    fillId: xf.fillId ?? base.fillId,
    borderId: xf.borderId ?? base.borderId,
    alignment: xf.alignment ?? base.alignment,
  };
}

function parseSheetLayout(doc: Document): XlsxStyles['sheets'][string] {
  const cells: Record<string, number> = Object.create(null) as Record<string, number>;
  const rows: Record<string, { height?: number; style?: number }> = Object.create(null) as Record<string, { height?: number; style?: number }>;
  const columns: Array<{ min: number; max: number; width?: number; style?: number }> = [];

  for (const col of elements(doc, 'col')) {
    const min = numberAttr(col, 'min');
    const max = numberAttr(col, 'max');
    if (!min || !max) continue;
    const width = numberAttr(col, 'width');
    const style = numberAttr(col, 'style');
    columns.push({
      min,
      max,
      ...(width !== undefined ? { width: columnWidthToPx(width) } : {}),
      ...(style !== undefined ? { style } : {}),
    });
  }

  for (const row of elements(doc, 'row')) {
    const rowNumber = attr(row, 'r');
    if (!rowNumber) continue;
    const height = numberAttr(row, 'ht');
    const style = numberAttr(row, 's');
    if (height !== undefined || style !== undefined) {
      rows[rowNumber] = {
        ...(height !== undefined ? { height: pointsToPx(height) } : {}),
        ...(style !== undefined ? { style } : {}),
      };
    }

    for (const c of children(row, 'c')) {
      const address = attr(c, 'r');
      const styleIndex = numberAttr(c, 's');
      if (address && styleIndex !== undefined) cells[address] = styleIndex;
    }
  }

  return { cells, rows, columns };
}

function fontCss(font: Element, theme: Theme): string {
  const css: string[] = [];
  if (enabled(child(font, 'b'))) css.push('font-weight:700;');
  if (enabled(child(font, 'i'))) css.push('font-style:italic;');
  const decorations = [enabled(child(font, 'u')) ? 'underline' : '', enabled(child(font, 'strike')) ? 'line-through' : ''].filter(Boolean);
  if (decorations.length) css.push(`text-decoration:${decorations.join(' ')};`);

  const size = numberAttr(child(font, 'sz'), 'val');
  if (size && size > 0 && size <= 200) css.push(`font-size:${round(size, 2)}pt;`);

  const name = safeFontFamily(attr(child(font, 'name'), 'val'));
  if (name) css.push(`font-family:'${name}',Arial,sans-serif;`);

  const color = colorValue(child(font, 'color'), theme);
  if (color) css.push(`color:${color};`);
  return css.join('');
}

function fillCss(fill: Element, theme: Theme): string {
  const pattern = child(fill, 'patternFill');
  if (!pattern) return '';
  const type = attr(pattern, 'patternType');
  if (type && type !== 'solid') return '';
  const color = colorValue(child(pattern, 'fgColor') ?? child(pattern, 'bgColor'), theme);
  return color ? `background-color:${color};` : '';
}

function borderCss(border: Element, theme: Theme): string {
  return (['top', 'right', 'bottom', 'left'] as const)
    .map((side) => sideCss(side, child(border, side), theme))
    .join('');
}

function sideCss(side: 'top' | 'right' | 'bottom' | 'left', el: Element | null, theme: Theme): string {
  if (!el) return '';
  const style = attr(el, 'style');
  if (!style) return '';
  const cssStyle = borderStyle(style);
  if (!cssStyle) return '';
  const color = colorValue(child(el, 'color'), theme) ?? '#dce3df';
  return `border-${side}:${cssStyle} ${color};`;
}

function borderStyle(style: string): string | null {
  if (style === 'none') return null;
  if (style === 'double') return '3px double';
  if (style === 'dotted') return '1px dotted';
  if (style === 'dashed') return '1px dashed';
  if (style === 'hair') return '1px solid';
  if (style.startsWith('medium')) return style.includes('Dash') ? '2px dashed' : '2px solid';
  if (style.startsWith('thick')) return '3px solid';
  return '1px solid';
}

function alignmentCss(alignment: Element): string {
  const css: string[] = [];
  const horizontal = attr(alignment, 'horizontal');
  const vertical = attr(alignment, 'vertical');
  const wrapText = attr(alignment, 'wrapText');
  const indent = numberAttr(alignment, 'indent');


  const textAlign = horizontalAlign(horizontal);
  if (textAlign) css.push(`text-align:${textAlign};`);

  const verticalAlign = vertical === 'center' ? 'middle' : vertical;
  if (verticalAlign && ['top', 'middle', 'bottom'].includes(verticalAlign)) css.push(`vertical-align:${verticalAlign};`);
  if (wrapText === '1' || wrapText === 'true') css.push('white-space:pre-wrap;');
  if (indent && indent > 0 && indent < 16) css.push(`padding-left:${5 + indent * 12}px;`);


  return css.join('');
}

function horizontalAlign(value: string | null): string | null {
  if (!value || value === 'general') return null;
  if (value === 'centerContinuous') return 'center';
  if (['left', 'center', 'right', 'justify'].includes(value)) return value;
  if (value === 'distributed') return 'justify';
  return null;
}

function parseTheme(doc: Document | null): Theme {
  if (!doc) return [];
  const scheme = first(doc, 'clrScheme');
  if (!scheme) return [];
  return ['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'].map(name => {
    const slot = child(scheme, name);
    const color = child(slot, 'srgbClr') ?? child(slot, 'sysClr');
    return hex(attr(color, 'val')) ?? hex(attr(color, 'lastClr')) ?? '';
  });
}

function colorValue(el: Element | null, theme: Theme): string | null {
  if (!el) return null;
  const rgb = hex(attr(el, 'rgb'));
  if (rgb) return `#${rgb}`;

  const indexed = numberAttr(el, 'indexed');
  if (indexed !== undefined) {
    const value = indexedColors[indexed];
    if (value) return `#${value}`;
  }

  const themeIndex = numberAttr(el, 'theme');
  if (themeIndex !== undefined) {
    const value = theme[themeIndex];
    if (value) {
      const tint = numberAttr(el, 'tint') ?? 0;
      return `#${applyTint(value, tint)}`;
    }
  }

  return null;
}

function applyTint(color: string, tint: number): string {
  const rgb = [0, 2, 4].map((start) => parseInt(color.slice(start, start + 2), 16));
  return rgb.map((channel) => {
    const tinted = tint < 0 ? channel * (1 + tint) : channel * (1 - tint) + 255 * tint;
    return Math.max(0, Math.min(255, Math.round(tinted))).toString(16).padStart(2, '0').toUpperCase();
  }).join('');
}

function safeFontFamily(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 80);
  return cleaned || null;
}

function pointsToPx(value: number): number {
  return round(value * 96 / 72, 2);
}

function columnWidthToPx(value: number): number {
  return Math.max(24, Math.round(value >= 1 ? value * 7 + 5 : value * 12));
}

function normalizePath(base: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : `${base}/${target}`).split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function hex(value: string | null): string | null {
  const normalized = value?.replace(/^#/, '').toUpperCase();
  if (!normalized) return null;
  if (/^[0-9A-F]{8}$/.test(normalized)) return normalized.slice(2);
  if (/^[0-9A-F]{6}$/.test(normalized)) return normalized;
  return null;
}

function numberAttr(el: Element | null, name: string): number | undefined {
  const value = attr(el, name);
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function attr(el: Element | null, name: string): string | null {
  if (!el) return null;
  const direct = el.getAttribute(name);
  if (direct !== null) return direct;
  for (const item of Array.from(el.attributes)) {
    if (item.localName === name) return item.value;
  }
  return null;
}

function first(root: ParentNode, name: string): Element | null {
  return elements(root, name)[0] ?? null;
}

function child(root: Element | null, name: string): Element | null {
  return children(root, name)[0] ?? null;
}

function children(root: Element | null, name?: string): Element[] {
  if (!root) return [];
  return Array.from(root.children).filter((el) => !name || el.localName === name);
}

function elements(root: ParentNode, name: string): Element[] {
  return Array.from(root.querySelectorAll('*')).filter((el) => el.localName === name);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function enabled(el: Element | null): boolean { return !!el && !['0','false','none'].includes(attr(el,'val') ?? ''); }
