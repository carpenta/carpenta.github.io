import * as XLSX from 'xlsx';
// This package has no TypeScript declarations; the callback boundary is typed below.
// @ts-ignore
import FormulaParser from 'fast-formula-parser';

type Value = number | string | boolean | null;
type Ref = { sheet?: string; row: number; col: number };
type RangeRef = { sheet?: string; from: Ref; to: Ref };
type Frame = { invalid: boolean };
export type CalculationOptions = { parsedRowLimit?: number; maxReferences?: number; maxFormulas?: number };

// Keep expensive, volatile, external-data and unverified functions out of the evaluator.
const supported = new Set('SUM AVERAGE MIN MAX COUNT COUNTA COUNTBLANK IF IFERROR IFNA AND OR NOT ABS ROUND ROUNDUP ROUNDDOWN INT MOD POWER SQRT SUMIF SUMIFS COUNTIF COUNTIFS AVERAGEIF AVERAGEIFS CONCATENATE CONCAT LEFT RIGHT MID LEN LOWER UPPER TRIM VALUE TEXT TRUE FALSE'.split(' '));

/** Call inside the document worker only. Unsupported dependencies never reuse stale caches as inputs. */
export function recalculateWorkbook(workbook: XLSX.WorkBook, options: CalculationOptions = {}) {
  const results = new Map<string, Value>();
  const failed = new Set<string>();
  const visiting = new Set<string>();
  const frames: Frame[] = [];
  const parsers: Array<{ parse: (formula: string, ref: Ref) => unknown }> = [];
  const sheets = new Map(workbook.SheetNames.map(name => [name.toLowerCase(), name]));
  let references = 0;
  let attempts = 0;
  let calculated = 0;
  let unsupported = 0;
  const reject = (): never => {
    for (const frame of frames) frame.invalid = true;
    throw new Error('Formula cannot be calculated safely');
  };
  const resolve = (name?: string) => {
    const actual = name && sheets.get(name.toLowerCase());
    if (!actual) return reject();
    return actual;
  };
  const getCell = (ref: Ref): Value => {
    if (++references > (options.maxReferences ?? 200_000)) return reject();
    const name = resolve(ref.sheet);
    const sheet = workbook.Sheets[name];
    if (!Number.isInteger(ref.row) || !Number.isInteger(ref.col) || ref.row < 1 || ref.col < 1 || ref.row > 1_048_576 || ref.col > 16_384) return reject();
    // SheetJS records the original extent in !fullref when sheetRows truncates input.
    if (sheet['!fullref'] && sheet['!fullref'] !== sheet['!ref']) {
      const limit = options.parsedRowLimit ?? (sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).e.r + 1 : 0);
      if (ref.row > limit) return reject();
    }
    const address = XLSX.utils.encode_cell({ r: ref.row - 1, c: ref.col - 1 });
    const cell = sheet[address] as XLSX.CellObject | undefined;
    if (!cell) return null;
    if (cell.f) return evaluate(name, address, cell);
    if (cell.t === 'e' || cell.t === 'd') return reject();
    return cell.v === undefined ? null : cell.v as Value;
  };
  const getRange = (ref: RangeRef): Value[][] => {
    const name = resolve(ref.sheet);
    const sheet = workbook.Sheets[name];
    let endRow = ref.to.row;
    let endCol = ref.to.col;
    if (endRow === 1_048_576 || endCol === 16_384) {
      if (sheet['!fullref'] && sheet['!fullref'] !== sheet['!ref']) return reject();
      const extent = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
      if (endRow === 1_048_576) endRow = Math.max(ref.from.row, extent.e.r + 1);
      if (endCol === 16_384) endCol = Math.max(ref.from.col, extent.e.c + 1);
    }
    const size = (endRow - ref.from.row + 1) * (endCol - ref.from.col + 1);
    if (size < 1 || size + references > (options.maxReferences ?? 200_000)) return reject();
    const result: Value[][] = [];
    for (let row = ref.from.row; row <= endRow; row++) {
      const values: Value[] = [];
      for (let col = ref.from.col; col <= endCol; col++) values.push(getCell({ sheet: name, row, col }));
      result.push(values);
    }
    return result;
  };
  const evaluate = (name: string, address: string, cell: XLSX.CellObject): Value => {
    const key = JSON.stringify([name, address]);
    if (results.has(key)) return results.get(key)!;
    if (failed.has(key) || visiting.has(key) || frames.length >= 64) return reject();
    const frame = { invalid: false };
    frames.push(frame);
    visiting.add(key);
    try {
      if (++attempts > (options.maxFormulas ?? 10_000) || cell.f!.length > 8192 || cell.F) return reject();
      const expression = cell.f!.replace(/^=/, '');
      const syntax = expression.replace(/"(?:[^"]|"")*"/g, '""').replace(/'(?:[^']|'')*'/g, "''");
      if (/[\[\]{}]/.test(syntax)) return reject();
      for (const match of syntax.matchAll(/([A-Za-z_][A-Za-z_0-9.]*)\s*\(/g)) {
        if (!supported.has(match[1].toUpperCase())) return reject();
      }
      const depth = frames.length - 1;
      // Parser state is mutable: dependency recursion needs a separate parser at each depth.
      const parser = parsers[depth] ??= new FormulaParser({ onCell: getCell, onRange: getRange, onVariable: reject });
      const point = XLSX.utils.decode_cell(address);
      const value = parser.parse(expression, { sheet: name, row: point.r + 1, col: point.c + 1 });
      if (frame.invalid || !['number', 'string', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) return reject();
      results.set(key, value as Value);
      cell.v = value as number | string | boolean;
      cell.t = typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 's';
      delete cell.w;
      calculated++;
      return value as Value;
    } catch {
      failed.add(key);
      // Invalidate the caller even if a formula function swallows an error (e.g. IFERROR).
      return reject();
    } finally {
      visiting.delete(key);
      frames.pop();
    }
  };
  for (const name of workbook.SheetNames) {
    for (const [address, cell] of Object.entries(workbook.Sheets[name])) {
      if (address.startsWith('!') || !cell?.f) continue;
      try { evaluate(name, address, cell); } catch { unsupported++; }
    }
  }
  return {
    calculated, unsupported,
    warning: unsupported ? `수식 ${unsupported.toLocaleString('ko-KR')}개는 미지원 함수·순환 참조·읽기 범위 또는 계산 한도로 재계산하지 못했습니다. 저장된 결과가 있으면 그대로 표시합니다.` : undefined,
  };
}
