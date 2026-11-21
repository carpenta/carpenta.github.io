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

  // v39 adds one named exception: the scorecard table's 6px corners (the user: "표의 round 를 줄여줘").
  it('rounds corners with three radii only: full, card and tile, and the scorecard table\'s 6px (v39)', () => {
    expect(css).toMatch(/--r-full: 999px; --r-card: 24px; --r-tile: 12px;/);
    const corner = /^(var\(--r-(full|card|tile)\)|0|inherit)$/;
    const off = declared(/border(?:-(?:top|bottom)-(?:left|right))?-radius/)
      .filter(({ selector, value }) => !(selector === '.ct' && value === '6px'))
      .filter(({ value }) => !value.split(/\s+/).every((part) => corner.test(part)))
      .map(({ selector, value }) => `${selector}: ${value}`);
    expect(off).toEqual([]);
  });

  // v39 (the user's glow mock-up): one more drop, the glass's own (--glass-drop), and lime light for what is chosen. A
  // shadow is made of these layers alone: the three v30 drops, the glass drop, the lime edge (1.5px, the token or inset),
  // and a lime glow (a blur with no offset, in --lime-glow or the lime at low alpha). One exception, the tee dots in the
  // tee list: a 1px dark ring so a white tee's dot reads on the glass.
  it('casts the v30 drops, the glass drop and lime light only (v39)', () => {
    expect(css).toMatch(/--sh-float: [^;]+;/);
    expect(css).toMatch(/--sh-raise: [^;]+;/);
    expect(css).toMatch(/--sh-sheet: [^;]+;/);
    expect(css).toMatch(/--glass-drop: 0 6px 16px rgb\(0 0 0 \/ \.28\);/);
    expect(css).toMatch(/--chosen-edge: 0 0 0 1\.5px var\(--lime\);/);
    const layer = new RegExp([
      String.raw`var\(--sh-(float|raise|sheet)\)`,
      String.raw`var\(--glass-drop\)`,
      String.raw`var\(--chosen-edge\)`,
      String.raw`inset 0 0 0 1\.5px var\(--lime\)`,
      String.raw`0 0 \d+px( \d+px)? (var\(--lime-glow\)|rgb\(196 224 79 \/ \.\d+\))`,
    ].map((s) => `^(${s})$`).join('|'));
    const off = declared(/box-shadow/)
      .filter(({ selector, value }) => !(selector === '.tee-dot' && value === 'inset 0 0 0 1px rgb(0 0 0 / .25)'))
      .filter(({ value }) => value !== 'none' && !value.split(/,\s*(?![^(]*\))/).every((part) => layer.test(part.trim())))
      .map(({ selector, value }) => `${selector}: ${value}`);
    expect(off).toEqual([]);
    // The lime glow never grows into a halo wider than the mock-up's 26px card halo.
    const blurs = [...css.matchAll(/0 0 (\d+)px(?: \d+px)? (?:var\(--lime-glow\)|rgb\(196 224 79)/g)].map((m) => Number(m[1]));
    expect(blurs.length).toBeGreaterThan(0);
    expect(Math.max(...blurs)).toBeLessThanOrEqual(26);
  });

  it('sets type in six sizes: 13, 15, 17, 22, 34 and the counts, plus the ring\'s 32 and the island\'s 11 (v39)', () => {
    expect(css).toMatch(/--t-s: 13px; --t-m: 15px; --t-l: 17px; --t-xl: 22px; --t-2xl: 34px; --t-count: 56px;/);
    const off = declared(/font-size/)
      // A size fitted to a narrow line, or 큰 글씨's, is a step times a factor; the counts are fluid up to theirs.
      .filter(({ value }) => !/^(var\(--t-(s|m|l|xl|2xl|count)\)|inherit|clamp\(.*var\(--t-count\)\)|calc\(var\(--t-(s|m|l|xl|2xl)\) \* \.?\d+(\.\d+)?\))$/.test(value))
      // v39 adds two sizes from the user's mock-up, each in its one place: the hole number in the switcher's ring (32px,
      // fixed so 큰 글씨 cannot push it out of the 80px circle) and the floating island's tab labels (11px under the icon).
      .filter(({ selector, value }) => !(value === '32px' && /\.hole-nav (#hole-title )?\.hole-n$/.test(selector)))
      .filter(({ selector, value }) => !(value === '11px' && selector === '.tab-label'))
      .map(({ selector, value }) => `${selector}: ${value}`);
    expect(off).toEqual([]);
  });

  // v38 let the drawing show through the chip row's pills alone. v39 (the user's glow mock-up) made glass the system: a
  // see-through surface is one of the glass tokens and nothing else. Map glass (dark green 50%, blur 4px) over the hole,
  // deep glass (a 62→74% gradient, blur 18px) for the card and the island, and a white tint (10%, 18% pressed) for a
  // chosen control or a primary action. A token counts as see-through if it mixes with transparent or has an alpha.
  const seeThrough = () => {
    const root = rules(css).filter(({ selector }) => selector === ':root').map(({ body }) => body).join(';');
    const clear = new Set([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
      .filter((m) => /transparent\)|\/ \.?\d/.test(m[2])).map((m) => m[1]));
    return declared(/background(?:-color)?/)
      .filter(({ selector }) => !selector.includes('::backdrop'))
      // A gradient that fades from transparent into a solid is the scroll fade, not a surface.
      .filter(({ value }) => !/gradient\(transparent/.test(value))
      .filter(({ value }) => /transparent\)|\/ \.?\d/.test(value) || [...clear].some((name) => value.includes(`var(${name})`)));
  };
  // The white tint is light glass on the dark screens (a chosen control at 10%, pressed 18%, the scorecard's cells and
  // triple's soft disc up to 24%); the lime tint marks the scorecard's current hole, faintly (8%). Pressed map glass 70%,
  // and the paper screens' title bar, glass in the page's own tone (72%) that what scrolls passes under.
  const isGlass = (value: string) => ['var(--map-glass)', 'var(--deep-glass)', 'rgb(10 24 16 / .7)', 'rgb(15 33 24 / .72)'].includes(value)
    || (/^rgb\(255 255 255 \/ (\.\d+)\)$/.test(value) && Number(value.match(/\/ (\.\d+)/)![1]) <= 0.24)
    || (/^rgb\(196 224 79 \/ (\.\d+)\)$/.test(value) && Number(value.match(/\/ (\.\d+)/)![1]) <= 0.1);

  it('paints a see-through surface from the glass tokens alone (v39)', () => {
    expect(css).toMatch(/--map-glass: rgb\(10 24 16 \/ \.5\);/);
    expect(css).toMatch(/--map-blur: blur\(4px\)/);
    expect(css).toMatch(/--deep-glass: linear-gradient\(180deg, rgb\(14 30 21 \/ \.62\), rgb\(10 22 15 \/ \.74\)\);/);
    expect(css).toMatch(/--deep-blur: blur\(18px\)/);
    // v38's rule for the chip pills is still in the file, overridden by the map glass on #hole-info (the e2e checks the
    // computed glass); it is the one old value allowed to remain.
    const off = seeThrough()
      .filter(({ selector, value }) => !isGlass(value) && !(value === 'var(--chip-on-art)' && selector.startsWith('.meta, .progress')))
      .map(({ selector, value }) => `${selector}: ${value}`);
    expect(off).toEqual([]);
  });

  it('puts the map glass on what floats over the hole and the deep glass on the card and the island (v39)', () => {
    const on = (token: string) => seeThrough().filter(({ value }) => value === token).map(({ selector }) => selector).join(' | ');
    for (const part of ['.badge', '#hole-info .meta', '#hole-info .info-chip', '.hole-nav .round', '.nav-pill']) expect(on('var(--map-glass)')).toContain(part);
    for (const part of ['.sheet', '.tabbar']) expect(on('var(--deep-glass)')).toContain(part);
    // Every glass surface blurs what is behind it, with the blur of its own glass.
    for (const { selector, value } of seeThrough().filter(({ value }) => value === 'var(--map-glass)' || value === 'var(--deep-glass)')) {
      const body = rules(css).filter((r) => r.selector === selector).map((r) => r.body).join(';');
      if (selector.startsWith('.badge[data-tone]')) continue; // the tone's override of .badge, which sets the blur
      expect(body, selector).toContain(value === 'var(--map-glass)' ? 'backdrop-filter: var(--map-blur)' : 'backdrop-filter: var(--deep-blur)');
    }
  });

  // v39: no lime slab is left (the user could not bear the bright green buttons); the rule that still sets the accent
  // on these selectors is overridden by the light-glass rule below (checked next, and on screen by the e2e).
  it('keeps the accent for the primary action alone: 라운드 마치기, 이 코스로 시작, 지난 라운드에 보관', () => {
    const accent = declared(/background(?:-color)?/)
      .filter(({ value }) => value.includes('var(--action'))
      .map(({ selector }) => selector)
      // The primary buttons: 다음 홀, .primary (이 코스로 시작, 지난 라운드에 보관, 그대로 마치기 …), the empty scorecard's
      // 홀 기록하기 and 말로 입력's 적용.
      .filter((selector) => !/(^|[\s>+~])(\.next|\.btn\.primary|\.primary|\.sh-go|\.vc-go)(?=$|[:.[\s])/.test(selector));
    expect(accent).toEqual([]);
  });

  it('dresses every primary action and the last hole\'s › as light glass with a lime edge, not a lime slab (v39)', () => {
    const glass = rules(css).find(({ selector, body }) => selector.startsWith('body :is(') && /background: rgb\(255 255 255 \/ \.1\)/.test(body));
    expect(glass).toBeDefined();
    expect(glass!.body).toMatch(/box-shadow: inset 0 0 0 1\.5px var\(--lime\)/);
    for (const part of ['.btn.primary', '.sum-actions .primary', '.check-actions .primary', '.sh-go', '.vc-go', '.next', '.hole-nav .round.finish']) {
      expect(glass!.selector, part).toContain(part);
    }
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
