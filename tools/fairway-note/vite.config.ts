import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { buildId, precacheFiles, serviceWorkerSource } from './scripts/service-worker.ts';
import { tablerInner } from './src/tabler.ts';

// After the build (public files included), writes dist/sw.js with every built file and a content hash.
function offlineServiceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'fairway-note-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const paths = (readdirSync(outDir, { recursive: true }) as string[]).filter((path) => statSync(join(outDir, path)).isFile());
      const files = precacheFiles(paths);
      const id = buildId(files.map((path) => ({ path, content: readFileSync(join(outDir, path)) })));
      writeFileSync(join(outDir, 'sw.js'), serviceWorkerSource({ files, buildId: id }));
    },
  };
}

// The bundled font's licence text beside the built font files: the SIL OFL asks that every copy carry it (v24).
function fontLicence(): Plugin {
  let root = '';
  return {
    name: 'fairway-note-font-licence',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'assets/Pretendard-LICENSE.txt', source: readFileSync(join(root, 'src/fonts/LICENSE.txt')) });
    },
  };
}

// The UI icons in index.html from the vendored Tabler files (v25): each `<svg data-icon="name" …></svg>` gets that file's
// shapes at the family's line (1.75, 2.6 below 16px), and Tabler's MIT notice ships beside the built files.
function tablerIcons(): Plugin {
  let root = '';
  return {
    name: 'fairway-note-tabler-icons',
    configResolved(config) {
      root = config.root;
    },
    transformIndexHtml(html) {
      return html.replace(/<svg\b([^>]*)><\/svg>/g, (whole, attrs: string) => {
        const name = /\bdata-icon="([\w-]+)"/.exec(attrs)?.[1];
        if (!name) return whole;
        const width = Number(/\bwidth="(\d+)"/.exec(attrs)?.[1] ?? 24);
        const shapes = tablerInner(readFileSync(join(root, `vendor/tabler/${name}.svg`), 'utf8'));
        return `<svg${attrs} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width < 16 ? 2.6 : 1.75}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'assets/Tabler-LICENSE.txt', source: readFileSync(join(root, 'vendor/tabler/LICENSE')) });
    },
  };
}

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  plugins: [tablerIcons(), fontLicence(), offlineServiceWorker()],
});
