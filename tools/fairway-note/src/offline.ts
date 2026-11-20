// Registers the offline service worker (dist/sw.js, built by vite.config.ts) and offers a new version
// once it is waiting. The new worker takes over only when the player taps the prompt.
const PROMPT = '새 버전이 있어요. 다시 열기';

export function registerOffline(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker;
  let requested = false;
  let prompt: HTMLButtonElement | null = null;

  const offer = (worker: ServiceWorker) => {
    // Only an update: the first install has no controller and needs no reload.
    if (!container.controller) return;
    if (!prompt) {
      prompt = document.createElement('button');
      prompt.type = 'button';
      prompt.className = 'update-prompt';
      prompt.textContent = PROMPT;
      document.body.append(prompt);
    }
    prompt.onclick = () => {
      requested = true;
      prompt!.disabled = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    };
  };

  container.addEventListener('controllerchange', () => {
    if (!requested) return;
    requested = false;
    location.reload();
  });

  container
    .register(new URL('./sw.js', document.baseURI))
    .then((registration) => {
      if (registration.waiting) offer(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed') offer(installing);
        });
      });
    })
    // Without a worker (private mode, unsupported scope) the app still works online.
    .catch(() => undefined);
}
