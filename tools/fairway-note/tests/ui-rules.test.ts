import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Rules the stylesheet and the on-screen words keep (v23). They read the source files as text.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('src/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every innermost rule as its selector and declarations; an at-rule's own block is skipped, its rules are kept. */
function rules(text: string): { selector: string; body: string }[] {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
}

describe('the stylesheet (v23)', () => {
  // Since v25 on 기록 too: its chips, notes, penalty counts, the 0 … 5+ picker and the hole info take the tokens.
  it('takes every font weight from the three tokens, on every screen: values, labels and helper text', () => {
    const literal = rules(css)
      .filter(({ selector, body }) => selector !== ':root' && /font-weight:\s*(\d|bold)/.test(body))
      .map(({ selector }) => selector);
    expect(literal).toEqual([]);
    // The shorthand too: no `font: 700 15px …` naming a weight (a size such as `font: 16px/1.45 …` is no weight).
    const shorthand = /(^|;)\s*font:(?:[^;]*\s)?(?:[1-9]00|bold|bolder|lighter)\s/;
    expect(shorthand.test('font: 700 15px/1 var(--font)') && !shorthand.test('font: 16px/1.45 var(--font)')).toBe(true);
    expect(rules(css).filter(({ selector, body }) => selector !== ':root' && shorthand.test(body)).map(({ selector }) => selector)).toEqual([]);
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

describe('one design system (v30)', () => {
  const declared = (property: RegExp) => rules(css)
    .filter(({ selector }) => selector !== ':root')
    .flatMap(({ selector, body }) => [...body.matchAll(new RegExp(`(?:^|;)\\s*(${property.source})\\s*:\\s*([^;]+)`, 'g'))]
      .map((m) => ({ selector, property: m[1], value: m[2].trim().replace(/\s*!important$/, '') })));

  it('rounds corners with three radii only: full, card and tile', () => {
    expect(css).toMatch(/--r-full: 999px; --r-card: 24px; --r-tile: 12px;/);
    const corner = /^(var\(--r-(full|card|tile)\)|0|inherit)$/;
    const off = declared(/border(?:-(?:top|bottom)-(?:left|right))?-radius/)
      .filter(({ value }) => !value.split(/\s+/).every((part) => corner.test(part)))
      .map(({ selector, value }) => `${selector}: ${value}`);
    expect(off).toEqual([]);
  });

  it('casts three shadows only, on floating things: a control or a card over the drawing, and a sheet', () => {
    expect(css).toMatch(/--sh-float: [^;]+;/);
    expect(css).toMatch(/--sh-raise: [^;]+;/);
    expect(css).toMatch(/--sh-sheet: [^;]+;/);
    const off = declared(/box-shadow/)
      .filter(({ value }) => !/^(none|var\(--sh-(float|raise|sheet)\))$/.test(value))
      .map(({ selector, value }) => `${selector}: ${value}`);
    expect(off).toEqual([]);
  });

  it('sets type in six sizes: 13, 15, 17, 22, 34 and the counts', () => {
    expect(css).toMatch(/--t-s: 13px; --t-m: 15px; --t-l: 17px; --t-xl: 22px; --t-2xl: 34px; --t-count: 56px;/);
    const off = declared(/font-size/)
      // A size fitted to a narrow line, or 큰 글씨's, is a step times a factor; the counts are fluid up to theirs.
      .filter(({ value }) => !/^(var\(--t-(s|m|l|xl|2xl|count)\)|inherit|clamp\(.*var\(--t-count\)\)|calc\(var\(--t-(s|m|l|xl|2xl)\) \* \.?\d+(\.\d+)?\))$/.test(value))
      .map(({ selector, value }) => `${selector}: ${value}`);
    expect(off).toEqual([]);
  });

  // Tokens mixed with transparent are for shadows, backdrops, text on dark and the drawing, never for a fill; since v38
  // the one exception is the chip row's pills over the drawing (--chip-on-art), the user's call so they stop hiding it.
  const seeThrough = () => {
    const root = rules(css).find(({ selector }) => selector === ':root')!.body;
    const clear = new Set([...root.matchAll(/(--[\w-]+):\s*color-mix\([^;]*transparent[^;]*\);/g)].map((m) => m[1]));
    return declared(/background(?:-color)?/)
      .filter(({ selector }) => !selector.includes('::backdrop'))
      .filter(({ value }) => !/gradient\(/.test(value) && (/transparent\)/.test(value) || [...clear].some((name) => value.includes(`var(${name})`))));
  };

  it('paints no see-through surface but the chip row\'s pills: a background is a solid token, a gradient fade, or the backdrop', () => {
    const off = seeThrough()
      .filter(({ value }) => value !== 'var(--chip-on-art)')
      .map(({ selector, value }) => `${selector}: ${value}`);
    expect(off).toEqual([]);
  });

  it('lets the drawing show through the chip row\'s pills, and only there (v38)', () => {
    const pills = seeThrough().filter(({ value }) => value === 'var(--chip-on-art)').map(({ selector }) => selector);
    expect(pills).toEqual([".meta, .progress, .info .info-chip:not([aria-expanded='true'])"]);
  });

  it('keeps the accent for the primary action alone: 다음 홀, 라운드 마치기, 이 코스로 시작, 지난 라운드에 보관', () => {
    const accent = declared(/background(?:-color)?/)
      .filter(({ value }) => value.includes('var(--action'))
      .map(({ selector }) => selector)
      // The primary buttons: 다음 홀, .primary (이 코스로 시작, 지난 라운드에 보관, 그대로 마치기 …), the empty scorecard's
      // 홀 기록하기 and 말로 입력's 적용.
      .filter((selector) => !/(^|[\s>+~])(\.next|\.btn\.primary|\.primary|\.sh-go|\.vc-go)(?=$|[:.[\s])/.test(selector));
    expect(accent).toEqual([]);
  });
});

describe('the words on screen (v23)', () => {
  // 해요체 everywhere, 기록's "n번 홀은 비워 두고 넘어가요" too (since the merge into v23). The outgoing report and email
  // (report.ts) stay formal. 말로 입력's parser (voice-commands.ts) lists the endings people say, 습니다 among them, to
  // understand them: words it reads, not words it shows.
  const formal = (text: string) => text.split('\n').filter((line) => /[가-힣]니다/.test(line));
  const NOT_SHOWN = ['report.ts', 'voice-commands.ts'];

  it('speaks 해요체 in every view, status line and question', () => {
    const files = readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.ts') && !NOT_SHOWN.includes(f));
    const found = files.flatMap((file) => formal(read(`src/${file}`)).map((line) => `${file}: ${line.trim()}`));
    expect(found).toEqual([]);
    expect(formal(read('index.html'))).toEqual([]);
  });
});
