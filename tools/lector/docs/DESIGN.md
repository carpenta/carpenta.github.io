# Lector — document OCR & text extractor

## Contract

Static GitHub Pages application for optical character recognition and structured form extraction from PDF documents and camera-captured images. There is no API, cloud upload, user account, analytics, external service worker, or remote tracking. Selected files and extracted texts are never sent or persisted. A strict CSP meta tag limits every network request to the same origin (`self blob:`).

Core guarantees:
- **Dual-path PDF processing:** If a digital text layer exists, text is extracted directly in milliseconds without running heavy OCR inference. Scanned or flattened pages are rasterized to high-DPI canvas before OCR.
- **Client-only inference:** Tesseract.js WASM and trained language datasets (`kor`, `eng`) execute entirely in local Web Workers, keeping the main UI thread responsive.
- **In-memory transformation:** 4-point perspective warp and image filters (grayscale, contrast, Otsu binarization) run through pure TypeScript algorithms without heavy external WebAssembly dependencies.
- **Structured ROI extraction:** Target bounding boxes crop sub-canvases and run targeted character-whitelisted OCR for high-accuracy key-value table extraction.

Out of scope for this version: Cloud OCR fallbacks, multi-column flow re-layout, handwriting neural transformer models (e.g. TrOCR), or direct editing of PDF vectors.

## Architecture

TypeScript + Vite, no external UI framework.

- **PDF Module (`src/pdf/reader.ts`):** Uses `pdfjs-dist` to parse documents. Evaluates `page.getTextContent()` transforms; if character count exceeds threshold, bypasses OCR. Otherwise, renders pages to an off-screen canvas at scale 2.0.
- **Vision & Preprocessing (`src/vision/`):**
  - `homography.ts`: Solves the 8x8 linear system via Gaussian elimination with partial pivoting to calculate 3x3 perspective transformation matrices.
  - `warp.ts`: Implements inverse mapping with bilinear interpolation over canvas `ImageData`.
  - `preprocess.ts`: Rec. 601 grayscale, contrast stretching, and midpoint-stabilized Otsu threshold binarization.
- **OCR Worker Client (`src/ocr/client.ts`):** Wraps `tesseract.js` worker lifecycle with local `./tessdata` paths, progress dispatching, and field whitelist parameters.
- **Template Manager (`src/template/manager.ts`):** Normalizes bounding boxes (0.0 to 1.0), handles JSON schema serialization, and generates CSV/JSON exports.
- **Main Viewport & Overlay (`src/main.ts`):** Synchronizes canvas zoom, draggable warp pins, ROI rectangle drawing, and UI tabs.

## Verification

- **Unit tests (`vitest`):** Verifies homography calculation, matrix inversion, Otsu thresholding on bimodal distributions, PDF direct text coordinate extraction, and template round-trip serialization.
- **E2E tests (`playwright`):** Verifies page loading on port 4175, presence of `../../` back link, zero horizontal scrolling at 360px viewport width, zero external network requests, and text extraction functionality.
