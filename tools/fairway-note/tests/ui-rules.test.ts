import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Rules the stylesheet and the on-screen words keep (v22). They read the source files as text.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('src/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every innermost rule as its selector and declarations; an at-rule's own block is skipped, its rules are kept. */
function rules(text: string): { selector: string; body: string }[] {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
}

/**
 * 기록's own rules that still name a weight by number: the 기록 round owns them (its pills and counts, chips, the toast,
 * the +1/−1 cue of the split capsules, the 0 … 5+ picker and the hole info), and each already equals a token. Every
 * other rule takes a weight token.
 */
const ENTRY_RULES = ['.chip .lbl', '.notes li', '.count', '.cue', '.pen-count', '.toast', '.np-row button', '.mt-len, .mt-hd', '.info-n', '.hi-facts'];

describe('the stylesheet (v22)', () => {
  it('takes every font weight from the three tokens outside 기록: values, labels and helper text', () => {
    const literal = rules(css)
      .filter(({ selector, body }) => selector !== ':root' && /font-weight:\s*(\d|bold)/.test(body))
      .map(({ selector }) => selector)
      .filter((selector) => !ENTRY_RULES.includes(selector));
    expect(literal).toEqual([]);
    expect(css).toMatch(/--w-value: 800; --w-label: 600; --w-help: 400;/);
  });

  it('never transitions or prepares "all" properties', () => {
    expect(css).not.toMatch(/transition:\s*all|transition-property:\s*all|will-change:\s*all/);
  });

  it('defines every custom property it reads without a fallback', () => {
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    // Set from the page's script instead (CSSOM).
    for (const file of readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.ts'))) {
      for (const m of read(`src/${file}`).matchAll(/setProperty\('(--[\w-]+)'/g)) defined.add(m[1]);
    }
    const used = [...new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))];
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });
});

describe('the words on screen (v22)', () => {
  // 해요체 everywhere. The outgoing report and email (report.ts) stay formal; so does 기록's own "n번 홀은 비워 두고
  // 넘어갑니다", which belongs to the 기록 round. 말로 입력's parser (voice-commands.ts) lists the endings people say,
  // 습니다 among them, to understand them: words it reads, not words it shows.
  const formal = (text: string) => text.split('\n').filter((line) => /[가-힣]니다/.test(line) && !line.includes('비워 두고 넘어갑니다'));
  const NOT_SHOWN = ['report.ts', 'voice-commands.ts'];

  it('speaks 해요체 in every view, status line and question', () => {
    const files = readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.ts') && !NOT_SHOWN.includes(f));
    const found = files.flatMap((file) => formal(read(`src/${file}`)).map((line) => `${file}: ${line.trim()}`));
    expect(found).toEqual([]);
    expect(formal(read('index.html'))).toEqual([]);
  });
});
