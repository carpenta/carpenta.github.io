import type { Tagged } from './round';

/** Icons for each club's counter on the card, drawn in currentColor on a 24×24 grid. Static markup only. */
const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

export const CLUB_ICONS: Record<Tagged, string> = {
  // Driver: a large rounded wood head.
  driver: `<svg viewBox="0 0 24 24" ${STROKE} aria-hidden="true"><path d="M16 3 13.6 11.5"/><path d="M13.2 10.8c-3.8-.6-8.4.7-9.3 3.9-.7 2.6 1.2 4.6 4.8 4.8 3.6.2 6.6-1 7.2-3.2.4-1.6-.7-4-2.7-5.5z" fill="currentColor"/></svg>`,
  // Approach: an iron head, the same shape as the app icon.
  approach: `<svg viewBox="0 0 24 24" ${STROKE} aria-hidden="true"><path d="M16.4 3 15.2 10.6"/><path d="M14.4 9.8 16.2 10.4c.6 3.3.4 6.6-.6 8.6-.8 1.6-3.6 2.2-8.4 1.6-2-.2-2.8-1.6-2.1-3l1.1-2.1c.4-.8 1.3-1.2 2.2-1 2.8.5 4.6-.4 6-4.7z" fill="currentColor"/></svg>`,
  // Putter: a flat blade head.
  putts: `<svg viewBox="0 0 24 24" ${STROKE} aria-hidden="true"><path d="M15 3 13.4 15.5"/><rect x="5" y="15.5" width="13.5" height="4.5" rx="1.6" fill="currentColor"/></svg>`,
};
