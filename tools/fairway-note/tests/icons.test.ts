import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { icon, PEN_ICONS, type IconName } from '../src/icons';
import { tablerInner } from '../src/tabler';

const vendor = (name: string) => readFileSync(new URL(`../vendor/tabler/${name}.svg`, import.meta.url), 'utf8');
const FILES = readdirSync(new URL('../vendor/tabler/', import.meta.url)).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const iconsSource = readFileSync(new URL('../src/icons.ts', import.meta.url), 'utf8');

/** The icons the scripts draw, by their Tabler files (DESIGN.md's Icons table). index.html names its own by file. */
const SCRIPT_ICONS: Partial<Record<IconName, string>> = {
  chevUp: 'chevron-up', chevDown: 'chevron-down', chevLeft: 'chevron-left', chevRight: 'chevron-right',
  chevLeft2: 'chevrons-left', chevRight2: 'chevrons-right', plus: 'plus', minus: 'minus',
  share: 'share-2', download: 'download', copy: 'copy', mail: 'mail',
};

describe('the app’s icons from the vendored Tabler set (v25)', () => {
  it('takes a Tabler file’s shapes and drops its invisible bounding box', () => {
    expect(tablerInner(vendor('menu-2'))).toBe('<path d="M4 6l16 0"/><path d="M4 12l16 0"/><path d="M4 18l16 0"/>');
    for (const name of FILES) {
      const inner = tablerInner(vendor(name));
      expect(inner, name).not.toContain('stroke="none"');
      expect(inner, name).toMatch(/^(<(path|circle|rect|line|polyline|polygon|ellipse)\b[^<>]*\/>)+$/);
    }
  });

  it('draws each icon the scripts use from its Tabler file at our 1.75 line, 2.6 below 16px, and bundles no other file', () => {
    for (const [name, file] of Object.entries(SCRIPT_ICONS) as [IconName, string][]) {
      expect(FILES, `${name}: ${file}`).toContain(file);
      const svg = icon(name, 24);
      expect(svg).toContain(`>${tablerInner(vendor(file))}</svg>`);
      expect(svg).toContain('stroke-width="1.75"');
      expect(icon(name, 12)).toContain('stroke-width="2.6"');
    }
    // Each file the scripts draw is imported by name, so the bundle carries those and not the whole folder.
    const imported = [...iconsSource.matchAll(/from '\.\.\/vendor\/tabler\/([\w-]+)\.svg\?raw'/g)].map((m) => m[1]).sort();
    expect(imported).toEqual(Object.values(SCRIPT_ICONS).sort());
    expect(iconsSource).not.toContain('import.meta.glob');
  });

  it('keeps our golf glyphs: the clubs and the bunker are no Tabler file', () => {
    const tabler = new Set(FILES.map((name) => tablerInner(vendor(name))));
    for (const golf of ['driver', 'approach', 'putter', 'bunker'] as const) {
      expect(SCRIPT_ICONS).not.toHaveProperty(golf);
      expect(tabler.has(icon(golf).replace(/^<svg[^>]*>|<\/svg>$/g, ''))).toBe(false);
    }
  });

  it('names every icon in index.html by a Tabler file for the build to fill, and draws no UI icon by hand there', () => {
    const named = [...html.matchAll(/<svg\b[^>]*\bdata-icon="([\w-]+)"[^>]*><\/svg>/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThanOrEqual(30);
    for (const name of new Set(named)) expect(FILES, name).toContain(name);
    // Each placeholder carries only what the build needs (its file, a class, its size), and no attribute twice.
    for (const [whole, attrs] of html.matchAll(/<svg\b([^>]*\bdata-icon="[\w-]+"[^>]*)><\/svg>/g)) {
      const names = [...attrs.matchAll(/\s([\w-]+)="/g)].map((m) => m[1]);
      expect(new Set(names).size, whole).toBe(names.length);
      expect(names.filter((name) => !['data-icon', 'class', 'width', 'height'].includes(name)), whole).toEqual([]);
    }
    // The only drawn SVGs left are the course, the badge's scorecard mark and our phone glyph (v31: the grain went with
    // the drawing's texture).
    const drawn = [...html.matchAll(/<svg\b([^>]*)>/g)].map((m) => m[1]).filter((attrs) => !/\bdata-icon=/.test(attrs));
    expect(drawn.map((attrs) => /\b(?:id|class|data-glyph)="([\w-]+)/.exec(attrs)?.[1])).toEqual(['course-art', 'bm', 'phone']);
    // Chrome's ⋮ menu in the Android steps is Tabler's dots-vertical: the bundled font has no ⋮.
    expect(html).not.toContain('⋮');
    expect(named).toContain('dots-vertical');
  });
});

describe('the golf icons, golf objects in the family (v31)', () => {
  // Up to v30 OB read as a pencil, 해저드 as a crayon and 벙커 as a pair of lips (design critique). Each is now a golf
  // object on the family's 24px grid at its 1.75 line, its colour from a class.
  it('draws the penalty icons as the family does: the 24px grid, the 1.75 line, round caps and joins, no tint or colour in the markup', () => {
    for (const [name, svg] of Object.entries(PEN_ICONS)) {
      expect(svg, name).toMatch(/^<svg[^>]* viewBox="0 0 24 24"/);
      expect(svg, name).toContain('stroke-width="1.75"');
      expect(svg, name).toContain('stroke-linecap="round" stroke-linejoin="round"');
      expect(svg, name).not.toMatch(/fill-opacity|url\(|#[0-9a-f]{3,8}\b|rgb/i);
    }
  });

  it('stands OB and 해저드 as the same post in different ground: white on grass, red at water', () => {
    expect(PEN_ICONS.ob).toContain('class="stake-ob"');
    expect(PEN_ICONS.hazard).toContain('class="stake-hazard"');
    const post = (svg: string) => /<path class="stake-[a-z]+" d="([^"]+)"/.exec(svg)![1];
    expect(post(PEN_ICONS.ob)).toBe(post(PEN_ICONS.hazard));
    const ground = (svg: string) => svg.replace(/<path class="stake-[a-z]+" d="[^"]+"\/>/, '');
    expect(ground(PEN_ICONS.ob)).not.toBe(ground(PEN_ICONS.hazard));
    // No pencil: no band across the post.
    expect(PEN_ICONS.ob).not.toContain('stake-band');
  });

  // The critique of v31's first pass: OB's white post was 1.1:1 on its button, an empty outline beside two filled icons.
  it('builds each post as a solid: a lit face and, inside its line, a shaded side, so the white post is not an empty outline', () => {
    for (const cls of ['stake-ob', 'stake-hazard']) {
      const svg = cls === 'stake-ob' ? PEN_ICONS.ob : PEN_ICONS.hazard;
      const m = new RegExp(`<path class="${cls}" d="M([\\d.]+) ([\\d.]+)h([\\d.]+)v([\\d.]+)H[\\d.]+z"/><path class="${cls}-side" d="M([\\d.]+) ([\\d.]+)h([\\d.]+)v([\\d.]+)H[\\d.]+z"/>`).exec(svg);
      expect(m, cls).not.toBeNull();
      const [x, y, w, h, sx, sy, sw, sh] = m!.slice(1).map(Number);
      // Wide enough for its fill to show inside the 1.75 line at 20px.
      expect(w, cls).toBeGreaterThanOrEqual(6);
      // The side: from the post's middle to the inside of its line, top to bottom, so the line stays whole.
      expect(sx, cls).toBeCloseTo(x + w / 2);
      expect(sx + sw, cls).toBeCloseTo(x + w - 0.875);
      expect(sy, cls).toBeCloseTo(y + 0.875);
      expect(sh, cls).toBeCloseTo(h - 1.75);
    }
  });

  it('draws the bunker as sand seen from above: one bean of sand, nothing on it (grains read as a cookie, a ball as an eye)', () => {
    expect(PEN_ICONS.bunker).toMatch(/^<svg[^>]*><path class="ic-sand" d="[^"]+"\/><\/svg>$/);
  });
});
