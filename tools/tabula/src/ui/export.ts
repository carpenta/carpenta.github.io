import type { Cell, JsonValue, Page } from '../types';

const csvValue = (c: Cell): string => {
  if (c.kind === 'null') return '';
  // 빈 문자열은 ""로 써서 NULL(빈 칸)과 구분한다
  if (c.kind === 'string' && c.full === '') return '""';
  const s = c.kind === 'nested' ? JSON.stringify(c.json) : c.full;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 현재 페이지를 CSV로. 잘린 표시 문자열이 아니라 전체 값을 쓴다. */
export function toCsv(page: Page): string {
  const lines = [page.columns.map((c) => csvValue({ kind: 'string', text: c, full: c, json: c })).join(',')];
  for (const row of page.rows) lines.push(row.map(csvValue).join(','));
  return `${lines.join('\n')}\n`;
}

/** 현재 페이지를 JSON 배열로. int64처럼 정밀도를 잃는 값은 문자열이다. */
export function toJson(page: Page): string {
  const rows = page.rows.map((row) => Object.fromEntries(row.map((c, i): [string, JsonValue] => [page.columns[i], c.json])));
  return JSON.stringify(rows, null, 2);
}

/** '<원본 이름>-rows-<첫 행>-<끝 행>.<ext>', 행 번호는 1부터. */
export function exportName(fileName: string, start: number, count: number, ext: 'csv' | 'json'): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${base}-rows-${start + 1}-${start + count}.${ext}`;
}

export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
