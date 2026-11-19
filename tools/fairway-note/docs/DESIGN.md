# Fairway Note — golf score notes

## Contract

Static GitHub Pages application for keeping one 18-hole golf round on a phone. Each hole counts drives (tee shots), approaches, putts, OBs and mulligans with tap buttons. Totals and a round analysis update on every tap.

- Hole strokes = drives + approaches + putts + OBs. Each OB adds one penalty stroke; the replayed shot is counted as another drive or approach. Mulligans are shown but never counted.
- The hole being played counts toward totals and analysis only once it has a putt, so a tee shot alone never reads as an eagle. A hole finished without a putt (chip-in) counts once the player moves to another hole.
- Pars default to 4 and can be set to 3, 4 or 5 per hole. Hole-by-hole pars for the course were not available from public sources.
- The round is saved to one localStorage key (`fairway-note:round:v1`) so it survives reloads, and is removed by "새 라운드 시작". Opening the page writes nothing; the first edit saves the round and asks once for persistent storage (`navigator.storage.persist()`, failures ignored). A stored value this version cannot read (broken, or written by a newer version) is never overwritten or removed: it is first copied to `fairway-note:corrupt:<timestamp>` (newest 3 kept), and if that copy fails the round is not saved. Nothing is sent over the network; there is no account, analytics, sessionStorage, IndexedDB or cookie. Cache Storage holds only the app's own built files for offline use (see Offline). A CSP meta tag sets `connect-src 'none'` and limits scripts, styles and images to the same origin with no inline style elements (bar widths are set through the CSSOM, which CSP allows).
- Results leave the device only when the player asks: "이메일로 보내기" is a `mailto:` link with the subject and a plain-text report (totals, finished holes, analysis) and no recipient, which hands the text to the phone's mail app; "공유하기" calls the Web Share API, falling back to copying the report to the clipboard. The app itself makes no request.
- If storage is unavailable, the app keeps working in memory and says so.
- Saved rounds carry `lastEdited` (ms). A round whose last edit is at least 12 hours old (or, for rounds saved without `lastEdited`, one from an earlier date) is offered to continue or replace on load; replacing asks for confirmation, and continuing saves the round so the offer does not return. A round that crosses midnight is not offered. A save from another tab replaces the open tab's round through the `storage` event, so tabs do not silently overwrite each other. If another tab removes the saved round, the open tab keeps its round in memory and says it will be saved again on the next edit.

- After the first visit the app opens and records without a connection (see Offline).

Out of scope: round history, playing partners, GPS distances, sharing, other languages.

## Architecture

TypeScript + Vite, no runtime dependencies, no UI framework.

- `src/round.ts` — pure model: the `Round` and `Hole` types, counter bounds (0–15), strokes, played (a hole with at least one stroke or penalty), green in regulation, totals and `analyze()`.
- `src/report.ts` — the plain-text report, its subject and the `mailto:` link, plus the analysis notes shown on the page.
- `src/icons.ts` — static SVG icons for each counter's + button (driver head, iron, putter, OB stake, retry).
- `src/storage.ts` — validates and restores a saved round. Any malformed value (wrong version, hole count, par or count) is ignored and a new round starts, after the value is copied aside. Storage exceptions are caught.
- `src/offline.ts` — registers the service worker and shows the update prompt.
- `scripts/service-worker.ts` — builds `dist/sw.js`; a small plugin in `vite.config.ts` calls it after the build.
- `src/main.ts` — renders the summary bar, hole tabs, hole card, scorecard and analysis from the current round after every change, using DOM nodes rather than HTML strings.

Analysis covers played holes only:
- putts per hole, one-putts, three-putts or worse
- greens in regulation: at least one putt after drives + approaches + OBs ≤ par − 2
- score distribution, average per par, best and worst hole (omitted when every hole has the same score against par)
- strokes lost per area against a regulation pattern of one tee shot, par − 3 approaches and two putts, plus OB penalties. Each hole adds only its own excess, so a better-than-regulation hole never offsets a loss elsewhere. Every area tied for the most lost strokes is named.

## Offline

- `dist/sw.js` is generated at build time with the list of every built file (`index.html`, `assets/*`, icons, manifest; not itself, source maps or dot files) and a build ID, the first 12 hex digits of a SHA-256 over the file names and contents. All paths are relative to the worker, so it works at `/tools/fairway-note/` and its scope is that folder.
- The page registers it with `new URL('./sw.js', document.baseURI)` in production builds only, when the browser supports service workers. A failed registration is ignored and the app keeps working online.
- Install fetches every listed file with `cache: 'reload'`, bypassing the HTTP cache (GitHub Pages serves `max-age=600`), into the cache `fairway-note-<build ID>`.
- Fetch is cache-first for same-origin GETs of precached files and for navigations to the tool's folder or its `index.html` (any query string), which get the cached `index.html`. A miss falls back to the network. Every other request is left to the browser.
- The worker never calls `skipWaiting` on its own. When a new worker is waiting and the page already has a controller, a small fixed button "새 버전이 있습니다 · 다시 열기" appears above the hole bar without blocking the page. Tapping it posts `SKIP_WAITING`; the page reloads on `controllerchange`. The round lives in localStorage, so reloading keeps it.
- Activate deletes only older `fairway-note-` caches; caches of other tools on the same origin are left alone.
- The CSP is unchanged: `default-src 'self'` already allows a same-origin worker, and the worker's own fetches are not page connections.

## UI

- Mobile first, light theme for outdoor reading, system fonts, `word-break: keep-all` for Korean.
- A sticky summary bar keeps total strokes, score against par, holes played, putts, OBs and mulligans visible.
- Hole tabs in two rows of nine show each hole's strokes coloured by score.
- Counter buttons are at least 52px tall. Minus is disabled at zero and plus at 15. White on the accent colours keeps at least 4.5:1 contrast.
- One polite live region announces each change ("3번 홀 퍼터 2, 5타") and each hole change; counters and other text are rewritten only when their value changes.
- Previous/next hole buttons sit in a fixed bottom bar padded for the home indicator. Changing hole scrolls the hole card just under the sticky summary when it is not fully visible, so at 375×553 (iPhone SE Safari) the par selector, every counter and the bar fit on one screen; screens 700px tall or less get a one-line summary, no counter hints and 48px counters. The scroll offset follows the summary's measured height (`--summary-h`, set by a ResizeObserver). The page keeps bottom padding equal to the bar.
- Small labels are at least 13px and 4.5:1 against their background for sunlight; an enabled minus button is outlined, a disabled one faded. While the page is visible it holds a Screen Wake Lock (feature-detected, errors ignored, re-requested on `visibilitychange`); it needs no network, so the CSP is unchanged. The back link is small and low in the header. On screens 440px tall or less (landscape) the summary is not sticky.
- `touch-action: manipulation`, no tap highlight and no text selection on buttons, so rapid taps never zoom or select. Safe-area insets pad the header, page and bar.
- A web app manifest and PNG icons (rendered once by `scripts/make-icons.mjs`) let the page open standalone from the home screen.
- The par picker is a radio group with roving tabindex and arrow keys.
- `scroll-margin-top` on the hole card and `scroll-padding-top` on the page keep the hole title and focused controls below the sticky summary.
- The scorecard splits into front and back nine tables so it fits 360px without horizontal scrolling. Hole numbers jump to that hole.
- The link back to the site (`../../`) is always visible in the header.

## Verification

- Vitest unit tests for the model, storage and the generated worker (precache list, build ID, install with `cache: 'reload'`, no self-activation, `SKIP_WAITING`, old cache clean-up, cache-first answers and requests left to the network), run against a fake worker global.
- Playwright Chromium e2e, including a 375×600 touch phone (one-screen layout, tap entry, bar clearance), 375×553 and 390×664 phones (whole hole card visible after moving holes), label size and contrast, minus button states, the wake lock with and without support, 320px width and the manifest, for tapping and totals, + button icons, the email link, the share sheet and its clipboard fallback, holes in progress and chip-ins, analysis text, reload and reset, broken or newer saved data kept aside, no save on open, storage failure, stale rounds (confirm, continue, crossing midnight with a fixed clock), another tab's save and removal, navigation and the sticky-summary offset, the par radio keys, the live region, no console errors or CSP violations, no external requests, no storage beyond the round key, the back link and no horizontal scroll at 360px; offline reload after the first visit with styles and tap entry working, the built worker's precache list, and the update prompt when a new worker is waiting (it reloads into the new worker and keeps the round).
