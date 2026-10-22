# Runtime dependencies

Runtime libraries are pinned in package-lock.json and bundled into the worker; the app uses no runtime CDN.

| Purpose | Library | Upstream | License |
| --- | --- | --- | --- |
| Parquet reading | hyparquet 1.31.5 | https://github.com/hyparam/hyparquet | MIT |
| Parquet decompression (snappy WASM, gzip, brotli, zstd, lz4) | hyparquet-compressors 1.1.2 (with hysnappy 1.1.1) | https://github.com/hyparam/hyparquet-compressors | MIT |
| Arrow IPC reading | apache-arrow 21.2.0 (with flatbuffers 25.9.23, tslib 2.8.1, json-with-bigint 3.5.12) | https://github.com/apache/arrow-js | Apache-2.0 (flatbuffers Apache-2.0, tslib 0BSD, json-with-bigint MIT) |
| Avro deflate | fflate 0.8.3 | https://github.com/101arrowz/fflate | MIT |
| Avro zstandard, Arrow ZSTD | fzstd 0.1.1 | https://github.com/101arrowz/fzstd | MIT |

Written in this package: the Avro binary decoder and container reader (`src/avro/`), and the LZ4 frame decoder used for Arrow LZ4_FRAME bodies (`src/codecs.ts`). Avro snappy blocks use hyparquet's pure JS `snappyUncompress`.

Development-only tools that generate test files and the sample: hyparquet-writer 0.17.0 (MIT), avsc 5.7.9 (MIT), snappyjs 0.7.0 (MIT), lz4js 0.2.0 (ISC).
