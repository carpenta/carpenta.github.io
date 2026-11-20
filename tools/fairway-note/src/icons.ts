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
import type { Tagged } from './round';
import { tablerInner } from './tabler';

/**
 * Fairway Note icons (v14): one family on a 24px grid, a 1.75px line with round caps and joins, in currentColor.
 * Club heads and bunker sand carry an 18% tint of the same colour; the OB and hazard stakes stay filled, as on a
 * course. Below 16px the line is 2.6 so it still draws at about 1.3px. Static markup only.
 *
 * Since v25 the UI icons are Tabler Icons 3.52.0 (MIT, vendor/tabler/LICENSE), drawn at that same line; the golf
 * glyphs stay ours, since Tabler has no club, bunker or stake. The scripts import only the files they draw, so the
 * bundle carries those; index.html's icons are filled in at build time (vite.config.ts).
 */
const GOLF = {
  driver: '<path d="M17.2 3 14 11.4"/><path d="M13.6 11c-3.7-.6-8.2.7-9 3.7-.7 2.5 1.2 4.4 4.7 4.6 3.5.2 6.4-1 7-3.1.4-1.6-.7-3.8-2.7-5.2z" fill="currentColor" fill-opacity="0.18"/>',
  approach: '<path d="M16.8 3 15.4 10.4"/><path d="M14.6 9.9l1.8.6c.6 3.2.4 6.4-.6 8.4-.8 1.6-3.5 2.1-8.2 1.6-1.9-.2-2.7-1.6-2-2.9l1-2c.4-.8 1.3-1.2 2.2-1 2.7.5 4.5-.4 5.8-4.7z" fill="currentColor" fill-opacity="0.18"/>',
  putter: '<path d="M15.4 3 13.8 15.4"/><rect x="4.5" y="15.4" width="14.5" height="4.6" rx="1.8" fill="currentColor" fill-opacity="0.18"/>',
  bunker: '<path d="M2.8 12.6c3-2.4 15.4-2.4 18.4 0"/><path d="M3.6 13.2c1.3 4.4 4.6 6.8 8.4 6.8s7.1-2.4 8.4-6.8c-3.8 1.5-13 1.5-16.8 0z" fill="currentColor" fill-opacity="0.18"/><circle cx="12" cy="12.4" r="2.4"/>',
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

/** Each club's icon on the card: beside its name, and beside its count where the names step aside. */
export const CLUB_ICONS: Record<Tagged, string> = { driver: icon('driver'), approach: icon('approach'), putts: icon('putter') };

/** The penalty row: the OB stake (white, dark band) and the hazard stake (red) stay filled; the bunker is a line icon. */
export const PEN_ICONS = {
  ob: '<svg viewBox="0 0 24 32" width="20" height="28" aria-hidden="true"><path class="stake-ob" d="M8 2h8v20l-4 7-4-7z" stroke-width="1.6" stroke-linejoin="round"/><path class="stake-band" d="M8 6.5h8v4.5H8z"/></svg>',
  hazard: '<svg viewBox="0 0 24 32" width="20" height="28" aria-hidden="true"><path class="stake-hazard" d="M8 2h8v20l-4 7-4-7z" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  bunker: icon('bunker', 26),
} as const;
