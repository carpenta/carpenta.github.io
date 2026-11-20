// Small DOM helpers shared by the page and the past rounds section. Elements are built from nodes, never HTML strings.

export type Children = (Node | string | null | false)[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: Children): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Writes text only when it changes, so screen readers and layout are not disturbed on every tap. */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
