# Folio — local document viewer

## Contract

Static GitHub Pages application; no API, uploads, accounts, analytics, document persistence, service worker, localStorage, IndexedDB or history. One active file. Selecting another file or closing terminates its worker and discards its frame. Refresh starts empty. Site assets can be cached by the browser; the app never persists selected file contents. OS/browser memory management is outside the application guarantee.

## Architecture

TypeScript + Vite, no UI framework. Dedicated, disposable workers parse PPTX/HWP/HWPX/XLSX. Workers receive transferred ArrayBuffers and return only rendered page strings or sheet rows on demand. DOCX renders in a separate disposable renderer frame. Untrusted output is sanitized and displayed in a scriptless sandbox with a no-network CSP. Main UI does not insert document markup. Libraries and WASM ship from the same Pages origin; no runtime CDN.

XLSX styles and layout metadata are extracted with DOMParser from bounded OOXML parts in the parent before transferring the file to its worker. Only whitelisted CSS declarations are emitted. The XLSX display frame allows same-origin parent access for selection, but still disallows all scripts and network access.

ZIP central-directory budgets precede decompression, with file size, entry count, expansion and page/row limits. Worker timeouts keep malformed files from trapping the UI. Encrypted/unsupported/corrupt files show recoverable messages. No macros, external links, embedded HTML, remote images or external-data formula execution. A bounded formula parser recalculates allowlisted XLSX functions with dependency resolution; unsupported results keep their cached values with a warning.

## UI

Warm off-white canvas, dark ink, forest-green action color. Compact persistent header; spacious editorial empty state with a file drop target and distinct format tags. Viewer toolbar: document name/type/size, page or sheet navigation, zoom, open/close. Keyboard-accessible controls, screen-reader loading status, responsive mobile layout. Korean copy. Honest format-specific compatibility notes.

## Verification

Unit checks for signatures, limits, ZIP budgets and output sanitization. Real-browser fixture tests for all five formats, navigation, close/reopen, errors, mobile, privacy/network and storage. Production build tested at a repository subpath before Pages deployment.

## PDF export

Explicit download renders all available preview pages into an image PDF using html2canvas and jsPDF. SVG pages use native canvas drawing. Temporary scriptless frames preserve sanitization and network restrictions. Large sheets tile at row/column boundaries. Export is cancellable, uses request IDs independent of navigation, and enforces page/image/output memory budgets. Nothing is persisted before the requested browser download. Raster output has no searchable text layer.
