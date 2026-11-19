import { describe, expect, it, vi } from 'vitest';
import { buildId, precacheFiles, serviceWorkerSource } from '../scripts/service-worker';

const SCOPE = 'https://carpenta.github.io/tools/fairway-note/';

class FakeRequest {
  cache?: string;
  constructor(public url: string, init: { cache?: string } = {}) { this.cache = init.cache; }
}

type Listener = (event: Record<string, unknown>) => void;

// Runs the generated worker against a fake service worker global and Cache Storage.
function runWorker(source: string, existingCaches: string[] = []) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, string>>(existingCaches.map((name) => [name, new Map()]));
  const reloads: (string | undefined)[] = [];
  const network = vi.fn(async (request: { url: string } | string) => `network:${typeof request === 'string' ? request : request.url}`);
  const self = {
    location: { href: `${SCOPE}sw.js`, origin: 'https://carpenta.github.io' },
    registration: { scope: SCOPE },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  };
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        addAll: async (requests: FakeRequest[]) => {
          for (const request of requests) {
            reloads.push(request.cache);
            store.set(request.url, `cached:${request.url.slice(SCOPE.length)}`);
          }
        },
        match: async (request: { url: string } | string) => store.get(typeof request === 'string' ? new URL(request, self.location.href).href : request.url),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  new Function('self', 'caches', 'fetch', 'Request', source)(self, caches, network, FakeRequest);
  async function dispatch(type: string, event: Record<string, unknown> = {}) {
    let pending: Promise<unknown> | undefined;
    let response: Promise<unknown> | undefined;
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => { pending = p; }, respondWith: (p: Promise<unknown>) => { response = p; } });
    await pending;
    return response === undefined ? undefined : await response;
  }
  return { self, stores, network, reloads, dispatch };
}

const FILES = ['assets/index-abc.js', 'assets/index-def.css', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'index.html', 'manifest.webmanifest'];

describe('precacheFiles', () => {
  it('keeps every emitted file, sorted, without the worker itself, source maps or dot files', () => {
    expect(precacheFiles(['index.html', 'sw.js', 'assets\\index-abc.js', 'assets/index-abc.js.map', '.DS_Store', 'icon-192.png', 'manifest.webmanifest']))
      .toEqual(['assets/index-abc.js', 'icon-192.png', 'index.html', 'manifest.webmanifest']);
  });
});

describe('buildId', () => {
  it('is a short content hash that changes when any file changes', () => {
    const a = buildId([{ path: 'index.html', content: 'a' }, { path: 'assets/x.js', content: 'x' }]);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(buildId([{ path: 'assets/x.js', content: 'x' }, { path: 'index.html', content: 'a' }])).toBe(a);
    expect(buildId([{ path: 'index.html', content: 'b' }, { path: 'assets/x.js', content: 'x' }])).not.toBe(a);
    expect(buildId([{ path: 'index.htm', content: 'la' }, { path: 'assets/x.js', content: 'x' }])).not.toBe(a);
  });
});

describe('serviceWorkerSource', () => {
  const source = serviceWorkerSource({ files: FILES, buildId: '0123456789ab' });

  it('precaches every file on install without activating itself', async () => {
    const worker = runWorker(source);
    await worker.dispatch('install');
    const store = worker.stores.get('fairway-note-0123456789ab')!;
    expect([...store.keys()].sort()).toEqual(FILES.map((f) => SCOPE + f).sort());
    expect(worker.reloads).toEqual(FILES.map(() => 'reload'));
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
  });

  it('activates only when the page asks', async () => {
    const worker = runWorker(source);
    await worker.dispatch('message', { data: { type: 'OTHER' } });
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
    await worker.dispatch('message', { data: { type: 'SKIP_WAITING' } });
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it('deletes older caches of this tool on activate and leaves other caches alone', async () => {
    const worker = runWorker(source, ['fairway-note-old000000000', 'folio-cache', 'other']);
    await worker.dispatch('install');
    await worker.dispatch('activate');
    expect([...worker.stores.keys()].sort()).toEqual(['fairway-note-0123456789ab', 'folio-cache', 'other']);
  });

  it('answers precached files and in-scope navigations from the cache', async () => {
    const worker = runWorker(source);
    await worker.dispatch('install');
    const get = (url: string, mode = 'no-cors') => worker.dispatch('fetch', { request: { method: 'GET', url, mode } });
    expect(await get(`${SCOPE}assets/index-abc.js`)).toBe('cached:assets/index-abc.js');
    expect(await get(SCOPE, 'navigate')).toBe('cached:index.html');
    expect(await get(`${SCOPE}?v=abc#/x`, 'navigate')).toBe('cached:index.html');
    expect(await get(`${SCOPE}index.html`, 'navigate')).toBe('cached:index.html');
    expect(worker.network).not.toHaveBeenCalled();
  });

  it('leaves other requests to the network', async () => {
    const worker = runWorker(source);
    await worker.dispatch('install');
    const handled = (request: Record<string, string>) => worker.dispatch('fetch', { request });
    expect(await handled({ method: 'POST', url: `${SCOPE}index.html`, mode: 'cors' })).toBeUndefined();
    expect(await handled({ method: 'GET', url: 'https://example.com/x.js', mode: 'no-cors' })).toBeUndefined();
    expect(await handled({ method: 'GET', url: 'https://carpenta.github.io/', mode: 'navigate' })).toBeUndefined();
    expect(await handled({ method: 'GET', url: `${SCOPE}missing.png`, mode: 'no-cors' })).toBeUndefined();
    expect(worker.network).not.toHaveBeenCalled();
  });

  it('falls back to the network when a precached file is missing from the cache', async () => {
    const worker = runWorker(source);
    const response = await worker.dispatch('fetch', { request: { method: 'GET', url: `${SCOPE}favicon.svg`, mode: 'no-cors' } });
    expect(response).toBe(`network:${SCOPE}favicon.svg`);
  });
});
