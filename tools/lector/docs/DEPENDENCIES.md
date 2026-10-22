# Runtime dependencies

Runtime libraries are pinned in package-lock.json and served from the local origin; the app uses no runtime CDN or remote API.

| Purpose | Library | Upstream | License |
| --- | --- | --- | --- |
| Optical Character Recognition engine | tesseract.js 6.0.0 | https://github.com/naptha/tesseract.js | Apache-2.0 |
| Tesseract WebAssembly core | tesseract.js-core 6.0.0 | https://github.com/naptha/tesseract.js-core | Apache-2.0 |
| PDF document parser & renderer | pdfjs-dist 4.10.38 | https://github.com/mozilla/pdf.js | Apache-2.0 |

Trained OCR language datasets bundled locally via `scripts/setup-assets.mjs`:
- `@tesseract.js-data/eng` 1.0.0 (Apache-2.0)
- `@tesseract.js-data/kor` 1.0.0 (Apache-2.0)

Written in this package:
- Pure TypeScript 3x3 homography matrix solver and inverse bilinear perspective warp (`src/vision/homography.ts`, `src/vision/warp.ts`).
- Image grayscale, contrast, and Otsu binarization filters (`src/vision/preprocess.ts`).
- PDF direct text layer extractor (`src/pdf/reader.ts`).
- ROI bounding box crop and structured Key-Value template manager (`src/template/manager.ts`).
