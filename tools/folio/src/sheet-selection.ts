/** Parent-owned interactions. The XLSX frame itself remains script-disabled. */
export function attachSheetSelection(doc: Document): void {
  const table = doc.querySelector<HTMLTableElement>('.sheet-view table');
  if (!table) return;
  const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>('td[data-row]'));
  if (!cells.length) return;
  const box = (cell: HTMLTableCellElement) => ({ r: Number(cell.dataset.row), c: Number(cell.dataset.col), er: Number(cell.dataset.row) + cell.rowSpan - 1, ec: Number(cell.dataset.col) + cell.colSpan - 1 });
  let anchor = cells[0];
  let end = anchor;
  let selected: HTMLTableCellElement[] = [];
  let bounds = box(anchor);
  let dragging = false;
  const bar = doc.createElement('div');
  bar.className = 'selection-info';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  table.before(bar);
  table.tabIndex = 0;
  table.setAttribute('aria-label', '스프레드시트. 드래그로 범위 선택, Shift와 방향키로 확장, Ctrl 또는 Command+C로 복사');
  const column = (n: number): string => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  const address = (r: number, c: number) => `${column(c)}${r + 1}`;
  function paint() {
    const a = box(anchor), b = box(end);
    bounds = { r: Math.min(a.r,b.r), c: Math.min(a.c,b.c), er: Math.max(a.er,b.er), ec: Math.max(a.ec,b.ec) };
    // Include entire merged cells, including merges intersecting an expanded range.
    let changed = true;
    while (changed) {
      changed = false;
      for (const cell of cells) {
        const p = box(cell);
        if (p.er < bounds.r || p.r > bounds.er || p.ec < bounds.c || p.c > bounds.ec) continue;
        const next = { r: Math.min(bounds.r,p.r), c: Math.min(bounds.c,p.c), er: Math.max(bounds.er,p.er), ec: Math.max(bounds.ec,p.ec) };
        if (Object.keys(next).some(k => next[k as keyof typeof next] !== bounds[k as keyof typeof bounds])) { bounds = next; changed = true; }
      }
    }
    selected = cells.filter(cell => { const p = box(cell); return p.r <= bounds.er && p.er >= bounds.r && p.c <= bounds.ec && p.ec >= bounds.c; });
    const set = new Set(selected);
    for (const cell of cells) { cell.classList.toggle('cell-selected', set.has(cell)); cell.classList.toggle('cell-active', cell === anchor); cell.setAttribute('aria-selected', String(set.has(cell))); }
    const first = address(bounds.r,bounds.c), last = address(bounds.er,bounds.ec);
    bar.textContent = `${first === last ? first : `${first}:${last}`} · ${(bounds.er-bounds.r+1)*(bounds.ec-bounds.c+1)}개 셀 · 드래그로 선택 / ⌘·Ctrl+C 복사`;
  }
  const cellAt = (target: EventTarget | null) => {
    const cell = (target as Element | null)?.closest?.('td[data-row]') as HTMLTableCellElement | null;
    return cell && table.contains(cell) ? cell : null;
  };
  table.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const cell = cellAt(event.target); if (!cell) return;
    event.preventDefault(); table.focus({ preventScroll: true });
    if (!event.shiftKey) anchor = cell;
    end = cell; dragging = true; table.setPointerCapture(event.pointerId); paint();
  });
  table.addEventListener('pointermove', event => {
    if (!dragging) return;
    const cell = cellAt(doc.elementFromPoint(event.clientX,event.clientY));
    if (cell && cell !== end) { end = cell; paint(); }
    const win = doc.defaultView;
    if (win) win.scrollBy(event.clientX > win.innerWidth-30 ? 20 : event.clientX < 30 ? -20 : 0, event.clientY > win.innerHeight-30 ? 20 : event.clientY < 30 ? -20 : 0);
  });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) table.addEventListener(name, () => { dragging = false; });
  table.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); anchor = cells[0]; end = cells[cells.length-1]; paint(); return; }
    const offsets: Record<string, [number,number]> = { ArrowUp: [-1,0], ArrowDown: [1,0], ArrowLeft: [0,-1], ArrowRight: [0,1] };
    const delta = offsets[event.key]; if (!delta) return;
    event.preventDefault(); const p = box(end);
    const r = delta[0] > 0 ? p.er+1 : p.r+delta[0], c = delta[1] > 0 ? p.ec+1 : p.c+delta[1];
    const next = cells.find(cell => { const q = box(cell); return r >= q.r && r <= q.er && c >= q.c && c <= q.ec; });
    if (next) { end = next; if (!event.shiftKey) anchor = next; paint(); next.scrollIntoView({block:'nearest',inline:'nearest'}); }
  });
  doc.addEventListener('copy', event => {
    if (doc.activeElement !== table || !selected.length || !event.clipboardData) return;
    const values = new Map(selected.map(cell => { const p=box(cell); return [`${p.r}:${p.c}`,cell.textContent ?? '']; }));
    const rows: string[] = [];
    for (let r=bounds.r;r<=bounds.er;r++) { const cols: string[]=[]; for(let c=bounds.c;c<=bounds.ec;c++) { const value=values.get(`${r}:${c}`) ?? ''; cols.push(/[\t\n\r"]/.test(value) ? `"${value.replaceAll('"','""')}"` : value); } rows.push(cols.join('\t')); }
    event.preventDefault(); event.clipboardData.setData('text/plain',rows.join('\n'));
  });
  paint();
}
