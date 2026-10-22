import type { MetaSection } from '../types';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};

/** 메타데이터 섹션을 서랍에 그린다. */
export function renderMeta(body: HTMLElement, sections: MetaSection[]): void {
  body.replaceChildren();
  for (const s of sections) {
    const section = el('section');
    section.append(el('h3', s.title));
    if (s.pairs) {
      if (s.pairs.length === 0) section.append(Object.assign(el('p', '없음'), { className: 'none' }));
      else {
        const dl = el('dl');
        for (const [k, v] of s.pairs) dl.append(el('dt', k), el('dd', v));
        section.append(dl);
      }
    }
    if (s.table) {
      const wrap = Object.assign(el('div'), { className: 'table-wrap' });
      const table = el('table');
      const head = el('tr');
      for (const h of s.table.headers) head.append(el('th', h));
      table.append(el('thead'), el('tbody'));
      table.tHead!.append(head);
      for (const r of s.table.rows) {
        const tr = el('tr');
        for (const c of r) tr.append(el('td', c));
        table.tBodies[0].append(tr);
      }
      wrap.append(table);
      section.append(wrap);
    }
    if (s.json !== undefined) section.append(el('pre', s.json));
    body.append(section);
  }
}
