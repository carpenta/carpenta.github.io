# Tabula — data file viewer

## Contract

Static GitHub Pages application for browsing Parquet, Arrow IPC and Avro container files as tables. There is no API, upload, account, analytics, service worker, localStorage, sessionStorage, IndexedDB or history. Selected files and their names are never sent or persisted. One file is open at a time; closing or replacing it terminates its worker. A CSP meta tag limits every request to the same origin. Browser and OS memory management are outside the application guarantee.

The viewer never reads a whole file to show it:
- It reads metadata and the visible page (100 rows) only.
- A file of several gigabytes opens as fast as its footer or header can be read.
- One page may need at most 512 MB of input. Above that, the viewer stops and asks for fewer columns.

Values are shown without loss:
- int64 and uint64 stay BigInt.
- Decimals are scaled exactly from their unscaled integers.
- Timestamps keep every digit of their unit (ms, µs, ns), and zoned timestamps display in UTC.
- NULL, the empty string and the empty list render differently.
- float32 values print the shortest text that round-trips as float32.
- JSON export always writes int64 and decimals as strings.
- Parquet decimal statistics are left blank, because the metadata parser has already turned them into floats.

Out of scope for this version: ORC, SQL or whole-file sort and filter, editing, conversion, remote files and multi-file datasets.

## Architecture

TypeScript + Vite, no UI framework.

- **Worker.** The main thread hands the `File` to a dedicated module worker. The worker reads byte ranges with `Blob.slice()` through a `ByteSource` that also counts distinct bytes read. The header shows that count as "읽은 양".
- **Format detection.** The worker sniffs the first bytes for magic numbers: `PAR1`, `ARROW1`, the Arrow stream continuation marker, or `Obj\x01`. A Parquet file that lacks its trailing `PAR1` is reported as truncated, not unsupported. The file picker does not filter by extension.
- **Readers.** Each format implements one `Reader` interface: `open`, `readPage(start, count, columns)` and `countRows`. Readers turn values into display cells inside the worker (`{ kind, text, full, json }`), so BigInt and binary data never cross to the UI.
- **Requests.** Page navigation continues from the latest requested page and discards stale replies; overlapping long operations share one progress indicator. The worker serializes requests. Cancel bypasses the queue and aborts the running request. The client ignores replies from a disposed worker.

Per format:
- **Parquet** uses hyparquet with hyparquet-compressors.
  - Footer metadata gives the row count, row groups and column statistics.
  - A page reads only the selected top-level columns and the row groups that overlap it, and uses offset indexes when present.
  - Decimal annotations are stripped from a copy of the metadata so the reader receives unscaled values.
  - Timestamp and date parsers return tagged raw values instead of `Date`.
- **Avro** is decoded by an in-house decoder covering the whole binary specification.
  - Supported: primitives, records, enums, arrays and maps (including negative block counts), unions, fixed, named references, and the decimal, uuid, date, time and timestamp logical types.
  - Paging reads only block headers (row count and byte size) up to the target block. The reader remembers block offsets so moving back is immediate.
  - Codecs: deflate (fflate), snappy (hyparquet's pure JS decoder, CRC excluded) and zstandard (fzstd).
- **Arrow** uses apache-arrow.
  - The worker passes an object shaped like a Node `FileHandle` that is backed by the `ByteSource`, so only the bytes apache-arrow asks for are read.
  - Batches are read forward; moving back reopens the reader.
  - Compressed bodies are decoded through apache-arrow's compression registry with fzstd and an in-house LZ4 frame decoder. Output is realigned to 8 bytes when needed.
  - Timestamp, time, date and decimal values are read from the underlying typed arrays, because apache-arrow's getters return lossy numbers.

## UI

Cool, graph-paper-like light palette with a matching dark scheme; system sans for the interface and system monospace for values. The one accent is ochre, used only for the bytes-read meter in the header, which makes partial reading visible.

The welcome screen has a drop target, a file button and a synthetic sample file generated at build time.

The viewer is a two-column layout:
- On the left, a searchable column list with a checkbox per top-level column and expandable struct fields.
- On the right, a sticky-header table with row numbers, typed headers, resizable columns, right-aligned numbers and italic NULLs.
- Below the table, a pager with previous, next, go-to-row, row counting for formats without a stored count, and CSV and JSON export of the current page.
- Clicking a cell opens a popover with the full value and copy actions.
- Metadata opens in a right-hand drawer:
  - Parquet: file facts, key-value metadata, row groups, and per-column codec, encodings, sizes, ratio, share, min, max and null count.
  - Avro: codec, sync marker, user metadata and the schema JSON.
  - Arrow: schema, schema metadata and field metadata.

Long operations show a progress pill with cancel after 300 ms. Errors appear in one banner, and the app stays usable afterwards. Below 760 px the column list collapses above the table. Copy is Korean.

## Verification

Vitest covers:
- Cell formatting edge cases (negative epochs, nanoseconds, decimals, INT96, two's complement).
- Magic-byte detection and distinct-byte accounting.
- The Avro decoder across all types, four codecs, block skipping and truncation.
- The Parquet reader across five codecs, nested types, column pruning, row group access, budget and metadata.
- The Arrow reader across file and stream formats, ZSTD and LZ4 bodies and batch boundaries.
- LZ4 frame decoding, the worker handler against real files, the client protocol and export formatting.

Fixtures are generated deterministically by `tests/generate-fixtures.mjs`:
- avsc writes the Avro files, hyparquet-writer the Parquet files and apache-arrow the Arrow files.
- Node `zlib` and lz4js are the compressors.
- No personal data is used.
- Parquet LZ4 variants and INT96 columns have no Node writer available. Their decoding relies on the library; only the INT96 conversion used for column statistics is unit-tested.

Playwright (Chromium) covers:
- Opening every format; paging, go-to-row and end of file; column selection and search.
- The cell popover and the metadata drawer.
- Partial reading of a 1,000,000-row Parquet file (bytes read under a tenth of the file).
- Row counting, and closing a file mid-count without leaking into the next file.
- Corrupt and unsupported files, the sample, and CSV and JSON export.
- No off-origin requests and no storage use; the home link and no horizontal scroll at 360 px and 1280 px.
