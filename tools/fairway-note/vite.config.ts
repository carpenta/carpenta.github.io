import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { buildId, precacheFiles, serviceWorkerSource } from './scripts/service-worker.ts';

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

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  plugins: [fontLicence(), offlineServiceWorker()],
});
