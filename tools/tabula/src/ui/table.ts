import type { Cell, Page } from '../types';

const DEFAULT_WIDTH: Record<string, number> = { number: 130, temporal: 240, bool: 80, nested: 240, binary: 200, string: 190, null: 150 };
const MIN_WIDTH = 60;

export interface GridOptions {
  types: Map<string, string>;
  /** 사용자가 조절한 열 폭. 페이지가 바뀌어도 유지한다. */
  widths: Map<string, number>;
  onCell(cell: Cell, row: Cell[], column: string, anchor: HTMLElement): void;
}

/** 한 페이지를 표로 그린다. 행 번호는 1부터. */
export function renderGrid(table: HTMLTableElement, page: Page, opts: GridOptions): void {
  const cols = page.columns;
  const colgroup = document.createElement('colgroup');
  const head = document.createElement('tr');
  const rowCol = document.createElement('col');
  const lastRow = page.start + page.rows.length;
  const rowWidth = Math.max(56, String(lastRow).length * 9 + 22);
  rowCol.style.width = `${rowWidth}px`;
  colgroup.append(rowCol);
  const corner = Object.assign(document.createElement('th'), { className: 'rownum', textContent: '#' });
  corner.scope = 'col';
  head.append(corner);

  const colEls: HTMLTableColElement[] = [];
  cols.forEach((name, i) => {
    const sample = page.rows.find((r) => r[i].kind !== 'null')?.[i] ?? page.rows[0]?.[i];
    const width = opts.widths.get(name) ?? DEFAULT_WIDTH[sample?.kind ?? 'string'];
    const col = document.createElement('col');
    col.style.width = `${width}px`;
    colEls.push(col);
    colgroup.append(col);

    const th = document.createElement('th');
    th.scope = 'col';
    th.dataset.column = name;
    th.title = `${name}: ${opts.types.get(name) ?? ''}`;
    th.append(Object.assign(document.createElement('span'), { className: 'th-name', textContent: name }));
    th.append(Object.assign(document.createElement('small'), { textContent: opts.types.get(name) ?? '' }));
    const grip = Object.assign(document.createElement('span'), { className: 'resize' });
    grip.setAttribute('aria-hidden', 'true');
    grip.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const startX = ev.clientX;
      const startW = parseFloat(col.style.width);
      grip.setPointerCapture(ev.pointerId);
      const move = (e: PointerEvent) => {
        const w = Math.max(MIN_WIDTH, startW + e.clientX - startX);
        col.style.width = `${w}px`;
        opts.widths.set(name, w);
        sizeTable();
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
    th.append(grip);
    head.append(th);
  });

  const body = document.createElement('tbody');
  page.rows.forEach((row, r) => {
    const tr = document.createElement('tr');
    const num = Object.assign(document.createElement('th'), { className: 'rownum', textContent: String(page.start + r + 1) });
    num.scope = 'row';
    tr.append(num);
    row.forEach((cell, i) => {
      const td = document.createElement('td');
      td.textContent = cell.text;
      td.dataset.kind = cell.kind;
      if (cell.kind === 'string' && cell.full === '') td.classList.add('empty-string');
      const expandable = cell.kind === 'nested' || cell.text !== cell.full;
      if (expandable && cell.kind !== 'nested') td.classList.add('truncated');
      td.addEventListener('click', () => opts.onCell(cell, row, cols[i], td));
      tr.append(td);
    });
    body.append(tr);
  });

  const thead = document.createElement('thead');
  if (cols.length > 0) thead.append(head);
  table.replaceChildren(...(cols.length > 0 ? [colgroup, thead, body] : [document.createElement('thead'), document.createElement('tbody')]));

  function sizeTable() {
    table.style.width = `${rowWidth + colEls.reduce((s, c) => s + parseFloat(c.style.width), 0)}px`;
  }
  sizeTable();
}
