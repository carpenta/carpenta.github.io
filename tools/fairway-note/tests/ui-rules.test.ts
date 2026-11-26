import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Rules the stylesheet and the on-screen words keep (v23). They read the source files as text.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('src/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
/** Round on purpose (v46) but sized by another rule: each is as wide as it is tall there. */
const ROUND_SIZED_ELSEWHERE: string[] = [
  '.badge.celebrate::after',   // the score badge's own circle (inset 0 on .badge, var(--badge) square)
];

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

  // v39 adds one named exception: the scorecard table's 6px corners (the user: "표의 round 를 줄여줘"). v46 (the user:
  // "조금 더 선이 깔끔하게 떨어지고 edge 가 있었으면, 약간 유아틱"; their pick of mock-up A, design/v46/): no more pills.
  // Controls 12px, cards 16px, tiles 8px, and full round only for what is round on purpose (next test).
  it('rounds corners with four radii only: round, control, card and tile, and the scorecard table\'s 6px (v46)', () => {
    expect(css).toMatch(/--r-round: 999px; --r-ctl: 12px; --r-card: 16px; --r-tile: 8px;/);
    expect(css).not.toMatch(/--r-full/);
    const corner = /^(var\(--r-(round|ctl|card|tile)\)|0|inherit)$/;
    const off = declared(/border(?:-(?:top|bottom)-(?:left|right))?-radius/)
      .filter(({ selector, value }) => !(selector === '.ct' && value === '6px'))
      .filter(({ value }) => !value.split(/\s+/).every((part) => corner.test(part)))
      .map(({ selector, value }) => `${selector}: ${value}`);
    expect(off).toEqual([]);
  });

  // What is round on purpose (v46): a rule that rounds fully draws a circle, as wide as it is tall (the hole ring, the
  // score, icon buttons, birdie and eagle marks, dots, the switch knob). Everything else that used to be a pill is a
  // 12px control now.
  it('rounds fully only what is as wide as it is tall (v46)', () => {
    const size = (body: string, prop: string) => new RegExp(`(?:^|;)\\s*${prop}: ([^;]+)`).exec(body)?.[1].trim();
    const round = rules(css).filter(({ body }) => /border-radius: var\(--r-round\)/.test(body));
    expect(round.length).toBeGreaterThan(10);
    const off = round
      .filter(({ selector, body }) => !(size(body, 'width') && size(body, 'width') === size(body, 'height')) && !ROUND_SIZED_ELSEWHERE.includes(selector))
      .map(({ selector }) => selector);
    expect(off).toEqual([]);
  });

  // v39 (the user's glow mock-up): one more drop, the glass's own (--glass-drop), and lime light for what is chosen. A
  // shadow is made of these layers alone: the three v30 drops, the glass drop, the lime edge (the token or inset), a lime
  // glow (a blur with no offset, in --lime-glow), and since v46 a panel's 1px hairline (--panel-line) where the panels
  // had a lime halo. One exception, the tee dots in the tee list: a 1px dark ring so a white tee's dot reads on the glass.
  // v46: every lime edge is 1px (the user: "선이 깔끔하게").
  it('casts the v30 drops, the glass drop, a 1px lime edge, the panel hairline and the ring\'s glow only (v46)', () => {
    expect(css).toMatch(/--sh-float: [^;]+;/);
    expect(css).toMatch(/--sh-raise: [^;]+;/);
    expect(css).toMatch(/--sh-sheet: [^;]+;/);
    expect(css).toMatch(/--glass-drop: 0 6px 16px rgb\(0 0 0 \/ \.28\);/);
    expect(css).toMatch(/--chosen-edge: 0 0 0 1px var\(--lime\);/);
    expect(css).toMatch(/--panel-line: inset 0 0 0 1px rgb\(255 255 255 \/ \.1\);/);
    const layer = new RegExp([
      String.raw`var\(--sh-(float|raise|sheet)\)`,
      String.raw`var\(--glass-drop\)`,
      String.raw`var\(--chosen-edge\)`,
      String.raw`var\(--panel-line\)`,
      String.raw`inset 0 0 0 1px var\(--lime\)`,
      String.raw`0 0 \d+px( \d+px)? var\(--lime-glow\)`,
    ].map((s) => `^(${s})$`).join('|'));
    const off = declared(/box-shadow/)
      .filter(({ selector, value }) => !(selector === '.tee-dot' && value === 'inset 0 0 0 1px rgb(0 0 0 / .25)'))
      .filter(({ value }) => value !== 'none' && !value.split(/,\s*(?![^(]*\))/).every((part) => layer.test(part.trim())))
      .map(({ selector, value }) => `${selector}: ${value}`);
    expect(off).toEqual([]);
    // The lime glow stays small: the ring's, no halo.
    const blurs = [...css.matchAll(/0 0 (\d+)px(?: \d+px)? var\(--lime-glow\)/g)].map((m) => Number(m[1]));
    expect(blurs.length).toBeGreaterThan(0);
    expect(Math.max(...blurs)).toBeLessThanOrEqual(16);
    // No lime light in a shadow other than through the tokens (the panels' 26px halo is gone, v46).
    expect(declared(/box-shadow/).filter(({ value }) => /rgb\(196 224 79/.test(value)).map(({ selector }) => selector)).toEqual([]);
  });

  // v42 (the user's call on the research's glow budget): a glow marked two things, where you are (the hole ring) and what
  // to do next (the main action). v46 (the user's call: "홀 링에만 남기기"): the ring alone; a main action keeps its 1px
  // lime edge, unlit, as everything chosen does.
  it('glows on the hole ring only (v46)', () => {
    const glow = /0 0 \d+px(?: \d+px)? (?:var\(--lime-glow\)|rgb\(196 224 79 \/ \.(?:2[5-9]|[3-9])\d*\))/;
    const allowed = /\.hole-title/;
    /** A selector list split at its top-level commas, each :is(…) list opened into its own entries. */
    const atoms = (selector: string): string[] => selector.split(/,(?![^(]*\))/).flatMap((part) => {
      const inner = /:is\(([^]*)\)/.exec(part);
      return inner ? inner[1].split(',').map((s) => s.trim()) : [part.trim()];
    });
    const glowing = rules(css).filter(({ body }) => [...body.matchAll(/box-shadow:([^;]*)/g)].some((m) => glow.test(m[1])));
    expect(glowing.length).toBeGreaterThan(0);
    const off = glowing.flatMap(({ selector }) => atoms(selector).filter((a) => !allowed.test(a)));
    expect(off).toEqual([]);
  });

  // v46 (the user: "선이 깔끔하게"): a control's outline, a section's rule and a chosen edge are 1px. 1.5px stays only in
  // the score marks' strokes (eagle, double) and the hole strip's dashed later/missed cells, which are glyphs, not lines.
  it('draws every control line and rule at 1px (v46)', () => {
    const thick = declared(/outline(?:-offset)?|border(?:-(?:top|bottom|left|right))?|border-width|box-shadow/)
      .filter(({ value }) => /(^|[^\d.])1\.5px/.test(value))
      .filter(({ selector }) => !/\.m\[data-mark='(eagle|double)'\]|\.scell\[data-st='(later|missed)'\]/.test(selector))
      .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
    expect(thick).toEqual([]);
  });

  it('sets type in six sizes: 13, 15, 17, 22, 34 and the counts, plus the ring\'s 32 and the island\'s 11 (v39)', () => {
    expect(css).toMatch(/--t-s: 13px; --t-m: 15px; --t-l: 17px; --t-xl: 22px; --t-2xl: 34px; --t-count: 56px;/);
    const off = declared(/font-size/)
      // A size fitted to a narrow line, or 큰 글씨's, is a step times a factor; the counts are fluid up to theirs.
      .filter(({ value }) => !/^(var\(--t-(s|m|l|xl|2xl|count)\)|inherit|clamp\(.*var\(--t-count\)\)|calc\(var\(--t-(s|m|l|xl|2xl)\) \* \.?\d+(\.\d+)?\))$/.test(value))
      // v39 adds two sizes from the user's mock-up, each in its one place: the hole number in the switcher's ring (32px,
      // fixed so 큰 글씨 cannot push it out of the 80px circle) and the floating island's tab labels (11px under the icon).
      .filter(({ selector, value }) => !(value === '32px' && /\.hole-nav (#hole-title )?\.hole-n$/.test(selector)))
      // …and 26px in the smaller ring of a short screen (under 700px tall), so 상세 fits without scrolling.
      .filter(({ selector, value }) => !(value === '26px' && /\.hole-nav #hole-title \.hole-n$/.test(selector)))
      .filter(({ selector, value }) => !(value === '11px' && selector === '.tab-label'))
      // The score badge laid out as the ring is (the user: too tight before): a 20px number, an 11px word under it, and
      // Ace, shown alone, at 15px.
      .filter(({ selector, value }) => !((value === '20px' && selector === '.badge #hole-strokes') || (value === '11px' && selector === '.badge .badge-name') || (value === '15px' && selector === '.badge.hio .badge-name')))
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
  // Besides the two glass tokens, a see-through colour is one of three tints, alone or in a gradient: the dark green of
  // the glass itself (each channel at most 40: the pressed map glass, the toast, the dialogs, the shades and veils of the
  // screens that show the painted course), white as light glass on dark (a chosen control 10%, pressed 18%, the
  // scorecard's cells and triple's soft disc, never past 24%), and lime for the scorecard's current hole (10% at most).
  const tint = (rgb: string, alpha: number) => {
    const [r, g, b] = rgb.split(' ').map(Number);
    if (r === 255 && g === 255 && b === 255) return alpha <= 0.24;
    if (r === 196 && g === 224 && b === 79) return alpha <= 0.1;
    return Math.max(r, g, b) <= 40;
  };
  const isGlass = (value: string) => {
    if (['var(--map-glass)', 'var(--deep-glass)'].includes(value)) return true;
    const colours = [...value.matchAll(/rgb\((\d+ \d+ \d+) \/ (\.?\d+(?:\.\d+)?)\)/g)];
    // Nothing else may colour it: no hex, named colour, token or mix beside the tints.
    const rest = value.replace(/rgb\([^)]*\)/g, '').replace(/linear-gradient\(|\d+deg|\d+%|[,()\s]/g, '');
    return colours.length > 0 && rest === '' && colours.every((m) => tint(m[1], Number(m[2])));
  };

  it('paints a see-through surface from the glass tokens alone (v39)', () => {
    // v42 (the user's call): the map glass frostier, .5 and 4px → .64 and 10px, so its words hold over sand and greens.
    expect(css).toMatch(/--map-glass: rgb\(10 24 16 \/ \.64\);/);
    expect(css).toMatch(/--map-blur: blur\(10px\)/);
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
    expect(glass!.body).toMatch(/box-shadow: inset 0 0 0 1px var\(--lime\)/);
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
