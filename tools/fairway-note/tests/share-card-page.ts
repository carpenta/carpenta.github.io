// Test-only: exposes the share card module to tests/share-card.spec.ts on tests/share-card.html.
import { drawShareCard, readSharePalette, shareCardFileName, shareCardLayout, useSharePalette } from '../src/share-card';

// The layout is drawn in the page's palette (the app's style.css, linked from share-card.html), as the app draws it.
const layout: typeof shareCardLayout = (...args) => {
  useSharePalette(readSharePalette());
  return shareCardLayout(...args);
};
Object.assign(window, { shareCard: { drawShareCard, shareCardFileName, shareCardLayout: layout, readSharePalette } });
