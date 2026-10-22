import type { ColumnInfo } from '../types';

export interface SchemaTree {
  setSelected(names: string[]): void;
  filter(query: string): void;
}

function subTree(children: ColumnInfo[]): HTMLUListElement {
  const ul = document.createElement('ul');
  for (const c of children) {
    const li = document.createElement('li');
    li.className = 'sub';
    li.dataset.name = c.name.toLowerCase();
    const name = Object.assign(document.createElement('span'), { className: 'col-name', textContent: c.name });
    const type = Object.assign(document.createElement('span'), { className: 'col-type', textContent: c.type });
    li.append(name, type);
    if (c.children) li.append(subTree(c.children));
    ul.append(li);
  }
  return ul;
}

/** 왼쪽 컬럼 목록. 최상위 컬럼마다 체크박스가 있고, struct는 펼쳐서 하위 필드를 본다. */
export function renderSchema(root: HTMLUListElement, columns: ColumnInfo[], selected: string[], onChange: (selected: string[]) => void): SchemaTree {
  root.replaceChildren();
  const boxes: HTMLInputElement[] = [];
  for (const c of columns) {
    const li = document.createElement('li');
    li.dataset.name = [c.name, ...(c.children ?? []).map((x) => x.name)].join(' ').toLowerCase();
    const label = document.createElement('label');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: selected.includes(c.name) });
    box.dataset.column = c.name;
    box.addEventListener('change', () => onChange(boxes.filter((b) => b.checked).map((b) => b.dataset.column!)));
    boxes.push(box);
    const name = Object.assign(document.createElement('span'), { className: 'col-name', textContent: c.name, title: c.name });
    const type = Object.assign(document.createElement('span'), { className: 'col-type', textContent: c.type, title: c.type });
    label.append(box, name, type);
    li.append(label);
    if (c.children?.length) {
      const sub = subTree(c.children);
      sub.hidden = true;
      const toggle = Object.assign(document.createElement('button'), { type: 'button', className: 'toggle', textContent: '▸' });
      toggle.setAttribute('aria-label', `${c.name} 하위 필드 보기`);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        sub.hidden = !sub.hidden;
        toggle.textContent = sub.hidden ? '▸' : '▾';
        toggle.setAttribute('aria-expanded', String(!sub.hidden));
      });
      label.prepend(toggle);
      li.append(sub);
    }
    root.append(li);
  }
  return {
    setSelected(names) {
      for (const b of boxes) b.checked = names.includes(b.dataset.column!);
    },
    filter(query) {
      const q = query.trim().toLowerCase();
      for (const li of root.children as HTMLCollectionOf<HTMLLIElement>) li.hidden = q !== '' && !li.dataset.name!.includes(q);
    },
  };
}
