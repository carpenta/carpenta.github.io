// Test-only: exposes the share card module to tests/share-card.spec.ts on tests/share-card.html.
import { drawShareCard, shareCardFileName, shareCardLayout } from '../src/share-card';

Object.assign(window, { shareCard: { drawShareCard, shareCardFileName, shareCardLayout } });
