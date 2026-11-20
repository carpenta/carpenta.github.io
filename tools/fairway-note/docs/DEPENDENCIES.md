# Runtime dependencies

The bundle contains code written in this package, `src/data/courses.json` (golf course pars taken from each course's own published scorecard; see Course data in DESIGN.md) and one font. The app uses no runtime CDN: every file is served from the app's own folder and precached by its service worker.

| Dependency | Version | Licence | Source | In this package |
| --- | --- | --- | --- | --- |
| Pretendard (font) | 1.3.9 | SIL Open Font License 1.1, Reserved Font Name "Pretendard" | https://github.com/orioncactus/pretendard (npm `pretendard@1.3.9`, files fetched from https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2-subset/) | `src/fonts/`, bundled (v23) |
| Tabler Icons (outline SVGs) | 3.52.0 | MIT | https://github.com/tabler/tabler-icons (npm `@tabler/icons@3.52.0`, files fetched from https://cdn.jsdelivr.net/npm/@tabler/icons@3.52.0/icons/outline/) | `vendor/tabler/`, vendored only: not in the bundle yet |

## Pretendard 1.3.9

The official KS X 1001 subset files, unmodified (subsetting them again would make a Modified Version that may not keep the name). Each face covers 2,780 Hangul syllables (all of KS X 1001's 2,350 and 430 more), 51 compatibility jamo and 323 Latin characters, and carries `tnum` and `kern`.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `src/fonts/Pretendard-Regular.subset.woff2` (400) | 267,096 | `01dd73155fdfab7ce9b25224523e85a96927e21aef97f21957d41f1bfa7e3878` |
| `src/fonts/Pretendard-SemiBold.subset.woff2` (600) | 268,752 | `4247dc5e260b92640c2cbd0e75091154647b71e1d5884116655e2903468c54cc` |
| `src/fonts/Pretendard-ExtraBold.subset.woff2` (800) | 271,796 | `abb0933bd492a56403d2b288394923fdc4c210aaa827c9e44714fcac8ff70c7c` |
| `src/fonts/LICENSE.txt` (`dist/LICENSE.txt` of the package) | 4,419 | `b04538c9abec39a3db75108cf0af0fd9c77032fe8aa2cf38345b4d250e98e38e` |

`src/fonts.css` declares the three faces. The build gives the fonts hashed names in `assets/` and writes the licence beside them as `assets/Pretendard-LICENSE.txt`, so every deployed copy carries it, as the OFL asks. The fonts' own name tables also hold the copyright line and the licence's name and address.

## Tabler Icons 3.52.0

30 outline SVGs, 12,815 bytes in all, unmodified, with the package's `LICENSE` (1,073 bytes, SHA-256 `b740a1d46122672da62833e97f7e7c8a13fa85cbc7445b584b297cc00dde93db`, "Copyright (c) 2020-2026 Paweł Kuna"): `menu-2`, `chevron-left`, `chevron-right`, `chevron-up`, `chevron-down`, `chevrons-left`, `chevrons-right`, `home`, `table`, `pencil`, `history`, `share-2`, `upload`, `download`, `mail`, `microphone`, `x`, `flag-3`, `plus`, `minus`, `send`, `rotate-clockwise`, `text-size`, `info-circle`, `external-link`, `search`, `copy`, `check`, `dots-vertical`, `golf`. Each holds only `<svg>` and `<path>` with presentation attributes: no script, event attribute, style or external reference. Nothing imports them yet; the app icon each one stands for is listed under Icons in DESIGN.md. When they are wired in, the MIT notice has to ship with the built files too.

## Development-only tools

Pinned in package-lock.json: TypeScript 7.0.2 (Apache-2.0), Vite 8.3.3 (MIT), Vitest 5.0.3 (MIT), Playwright 1.64.0 (Apache-2.0).
