# Fairway Note — golf score notes

## Contract

Static GitHub Pages application for keeping one 18-hole golf round on a phone. Each hole counts drives (tee shots), approaches, putts, OBs and mulligans with tap buttons. Totals and a round analysis update on every tap.

- Hole strokes = drives + approaches + putts + OBs. Each OB adds one penalty stroke; the replayed shot is counted as another drive or approach. Mulligans are shown but never counted.
- Pars default to 4 and can be set to 3, 4 or 5 per hole. Hole-by-hole pars for the course were not available from public sources.
- The round is saved to one localStorage key (`fairway-note:round:v1`) so it survives reloads, and is removed by "새 라운드 시작". Nothing is sent over the network; there is no account, analytics, service worker, sessionStorage, IndexedDB or cookie. A CSP meta tag sets `connect-src 'none'` and limits scripts and images to the same origin.
- If storage is unavailable, the app keeps working in memory and says so.

Out of scope: round history, playing partners, GPS distances, sharing, other languages.

## Architecture

TypeScript + Vite, no runtime dependencies, no UI framework.

- `src/round.ts` — pure model: the `Round` and `Hole` types, counter bounds (0–15), strokes, played (a hole with at least one stroke or penalty), green in regulation, totals and `analyze()`.
- `src/storage.ts` — validates and restores a saved round. Any malformed value (wrong version, hole count, par or count) is ignored and a new round starts. Storage exceptions are caught.
- `src/main.ts` — renders the summary bar, hole tabs, hole card, scorecard and analysis from the current round after every change, using DOM nodes rather than HTML strings.

Analysis covers played holes only:
- putts per hole, one-putts, three-putts or worse
- greens in regulation: at least one putt after drives + approaches + OBs ≤ par − 2
- score distribution, average per par, best and worst hole (omitted when every hole has the same score against par)
- strokes lost per area against a regulation pattern of one tee shot, par − 3 approaches and two putts, plus OB penalties; the area with the most lost strokes is named

## UI

- Mobile first, light theme for outdoor reading, system fonts, `word-break: keep-all` for Korean.
- A sticky summary bar keeps total strokes, score against par, holes played, putts, OBs and mulligans visible.
- Hole tabs in two rows of nine show each hole's strokes coloured by score.
- Counter buttons are at least 52px tall. Minus is disabled at zero.
- The scorecard splits into front and back nine tables so it fits 360px without horizontal scrolling. Hole numbers jump to that hole.
- The link back to the site (`../../`) is always visible in the header.

## Verification

- Vitest unit tests for the model and storage.
- Playwright Chromium e2e for tapping and totals, analysis text, reload and reset, broken saved data, navigation, no external requests, no storage beyond the round key, the back link and no horizontal scroll at 360px.
