import chevronDown from '../vendor/tabler/chevron-down.svg?raw';
import chevronLeft from '../vendor/tabler/chevron-left.svg?raw';
import chevronRight from '../vendor/tabler/chevron-right.svg?raw';
import chevronUp from '../vendor/tabler/chevron-up.svg?raw';
import chevronsLeft from '../vendor/tabler/chevrons-left.svg?raw';
import chevronsRight from '../vendor/tabler/chevrons-right.svg?raw';
import copy from '../vendor/tabler/copy.svg?raw';
import download from '../vendor/tabler/download.svg?raw';
import mail from '../vendor/tabler/mail.svg?raw';
import minus from '../vendor/tabler/minus.svg?raw';
import plus from '../vendor/tabler/plus.svg?raw';
import share from '../vendor/tabler/share-2.svg?raw';
import type { Part, Tagged } from './round';
import { tablerInner } from './tabler';

/**
 * Fairway Note icons (v14): one family on a 24px grid, a 1.75px line with round caps and joins, in currentColor.
 * Club heads carry an 18% tint of the same colour. The penalty glyphs (v31) are golf objects in the same family, their
 * colours from classes in style.css: OB a white post on grass, 해저드 the same post in red at water, each post a lit face
 * and a shaded side so it reads as a solid (white alone was an empty outline on its light button), and 벙커 a bean of
 * sand seen from above (before, they read as a pencil, a crayon and a pair of lips; grains on the sand read as a cookie).
 * Below 16px the line is 2.6 so it still draws at about 1.3px. Static markup only.
 *
 * Since v25 the UI icons are Tabler Icons 3.52.0 (MIT, vendor/tabler/LICENSE), drawn at that same line; the golf
 * glyphs stay ours, since Tabler has no club, bunker or stake. The scripts import only the files they draw, so the
 * bundle carries those; index.html's icons are filled in at build time (vite.config.ts).
 */
const GOLF = {
  driver: '<path d="M17.2 3 14 11.4"/><path d="M13.6 11c-3.7-.6-8.2.7-9 3.7-.7 2.5 1.2 4.4 4.7 4.6 3.5.2 6.4-1 7-3.1.4-1.6-.7-3.8-2.7-5.2z" fill="currentColor" fill-opacity="0.18"/>',
  approach: '<path d="M16.8 3 15.4 10.4"/><path d="M14.6 9.9l1.8.6c.6 3.2.4 6.4-.6 8.4-.8 1.6-3.5 2.1-8.2 1.6-1.9-.2-2.7-1.6-2-2.9l1-2c.4-.8 1.3-1.2 2.2-1 2.7.5 4.5-.4 5.8-4.7z" fill="currentColor" fill-opacity="0.18"/>',
  putter: '<path d="M15.4 3 13.8 15.4"/><rect x="4.5" y="15.4" width="14.5" height="4.6" rx="1.8" fill="currentColor" fill-opacity="0.18"/>',
  // Out of bounds is marked by white posts: one, standing on a mound of grass. Its shaded side sits inside the line
  // (from the middle to the line's inner edge), so the line stays whole.
  ob: '<path class="ic-grass" d="M4.5 20.5c2.6-1.8 12.4-1.8 15 0"/><path class="stake-ob" d="M9 3.5h6v15.5H9z"/><path class="stake-ob-side" d="M12 4.375h2.125v13.75H12z"/>',
  // A penalty area by its red posts: the same post, at the water's edge.
  hazard: '<path class="ic-water" d="M3.5 20.5c1.4-1 2.8-1 4.2 0s2.8 1 4.3 0 2.8-1 4.3 0 2.8 1 4.2 0"/><path class="stake-hazard" d="M9 3.5h6v15.5H9z"/><path class="stake-hazard-side" d="M12 4.375h2.125v13.75H12z"/>',
  // A bunker seen from above: a bean of sand, one side pulled in, nothing on it.
  bunker: '<path class="ic-sand" d="M3.6 13.6c-.4-3 1.6-5.6 4.4-5.6 2 0 2.9 1.4 4.6 1.4s2.6-1.9 4.9-1.9c2.4 0 3.6 1.8 3.3 4.4-.4 3.6-4 5.6-8.6 5.6-4.3 0-8.3-1.2-8.6-3.9z"/>',
} as const;

/** The UI icons the scripts draw, each a Tabler file read at build time (DESIGN.md's Icons table). Where a shot went, in
 * the club panel (v18): up for 김, down for 짧음, out to the side for 좌 and 우, two for 많이. */
const TABLER = {
  chevUp: chevronUp, chevDown: chevronDown, chevLeft: chevronLeft, chevRight: chevronRight, chevLeft2: chevronsLeft, chevRight2: chevronsRight,
  plus, minus, share, download, copy, mail,
};

const PATHS: Record<keyof typeof GOLF | keyof typeof TABLER, string> = {
  ...GOLF,
  ...(Object.fromEntries(Object.entries(TABLER).map(([name, svg]) => [name, tablerInner(svg)])) as Record<keyof typeof TABLER, string>),
};

export type IconName = keyof typeof PATHS;

/** One icon at `size` px, at the family's line unless told otherwise (the capsules' + and − are bolder). */
export function icon(name: IconName, size = 24, cls = '', line = size < 16 ? 2.6 : 1.75): string {
  return `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${line}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

/** Each club's icon on the card: beside its name, and beside its count where the names step aside. 상세's 세컨 and
 * 어프로치 (v28) are both iron shots of the middle count, and wear its iron. */
export const CLUB_ICONS: Record<Tagged | Part, string> = { driver: icon('driver'), approach: icon('approach'), second: icon('approach'), short: icon('approach'), putts: icon('putter') };

/** The penalty row (v31): OB, 해저드 and 벙커 as golf objects in the family, at 24px. */
export const PEN_ICONS = {
  ob: icon('ob', 24),
  hazard: icon('hazard', 24),
  bunker: icon('bunker', 24),
} as const;
