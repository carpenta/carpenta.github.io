// Builds dist/sw.js: the offline service worker with the list of built files and a build ID.
// Used by the Vite plugin in vite.config.ts and by the unit tests; never shipped as is.
import { createHash } from 'node:crypto';

export const CACHE_PREFIX = 'fairway-note-';

/** Files the worker precaches: every built file except the worker itself, source maps and dot files. */
export function precacheFiles(paths: string[]): string[] {
  return paths
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => path !== 'sw.js' && !path.endsWith('.map') && !path.split('/').some((part) => part.startsWith('.')))
    .sort();
}

/** Short content hash of the built files, so any change to them makes a new cache and a new worker. */
export function buildId(files: { path: string; content: string | Uint8Array }[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(file.path).update('\0').update(file.content).update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * The worker: cache-first for the precached files and for navigations to the tool's page.
 * It never activates itself; the page posts SKIP_WAITING when the player chooses to reopen.
 * Paths are relative to the worker, so it works under any subpath.
 */
export function serviceWorkerSource({ files, buildId: id }: { files: string[]; buildId: string }): string {
  return `// Fairway Note offline worker. Generated at build time; do not edit.
const CACHE = ${JSON.stringify(CACHE_PREFIX + id)};
const FILES = ${JSON.stringify(files, null, 2)};
const PRECACHED = new Set(FILES.map((file) => new URL(file, self.location.href).href));
const INDEX = new URL('index.html', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((file) => new Request(new URL(file, self.location.href).href, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(${JSON.stringify(CACHE_PREFIX)}) && key !== CACHE).map((key) => caches.delete(key)),
    )),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const path = url.origin + url.pathname;
  let key;
  if (request.mode === 'navigate') {
    if (path !== self.registration.scope && path !== INDEX) return;
    key = INDEX;
  } else if (PRECACHED.has(path)) {
    key = path;
  } else {
    return;
  }
  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(key)).then((hit) => hit || fetch(request)),
  );
});
`;
}
