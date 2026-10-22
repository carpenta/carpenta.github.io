import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const nodeModules = resolve(root, 'node_modules');
const tessdataOut = resolve(root, 'public/tessdata');
const pdfOut = resolve(root, 'public/pdf');

async function ensureDir(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function copyIfExists(src, dest) {
  if (existsSync(src)) {
    await copyFile(src, dest);
  } else {
    console.warn(`Source file not found: ${src}`);
  }
}

async function gunzip(src, dest) {
  if (!existsSync(src)) return;
  await pipeline(createReadStream(src), createGunzip(), createWriteStream(dest));
}

async function main() {
  console.log('Setting up Lector assets in public/...');
  await ensureDir(tessdataOut);
  await ensureDir(pdfOut);

  // 1. Tesseract Worker
  const workerSrc = join(nodeModules, 'tesseract.js/dist/worker.min.js');
  await copyIfExists(workerSrc, join(tessdataOut, 'worker.min.js'));

  // 2. Tesseract Core WASM & JS
  const coreDir = join(nodeModules, 'tesseract.js-core');
  const coreFiles = [
    'tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm',
    'tesseract-core-lstm.wasm.js',
    'tesseract-core-lstm.wasm',
  ];
  for (const f of coreFiles) {
    await copyIfExists(join(coreDir, f), join(tessdataOut, f));
  }

  // 3. Language Traineddata
  const engGz = join(nodeModules, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
  const korGz = join(nodeModules, '@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz');

  await copyIfExists(engGz, join(tessdataOut, 'eng.traineddata.gz'));
  await copyIfExists(korGz, join(tessdataOut, 'kor.traineddata.gz'));

  // Also extract uncompressed .traineddata for browsers/options that don't auto-decompress
  await gunzip(engGz, join(tessdataOut, 'eng.traineddata'));
  await gunzip(korGz, join(tessdataOut, 'kor.traineddata'));

  // 4. PDF.js Worker
  const pdfWorkerSrc = join(nodeModules, 'pdfjs-dist/build/pdf.worker.min.mjs');
  await copyIfExists(pdfWorkerSrc, join(pdfOut, 'pdf.worker.min.mjs'));

  console.log('✓ Lector assets ready in public/tessdata and public/pdf');
}

main().catch((err) => {
  console.error('Failed to setup assets:', err);
  process.exit(1);
});
