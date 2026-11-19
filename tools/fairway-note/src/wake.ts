/**
 * Keeps the phone screen on while the round is open, so it does not lock between shots.
 * Uses the Screen Wake Lock API where it exists and quietly does nothing elsewhere:
 * a refused or missing lock only means the screen may turn off as usual.
 * The browser drops the lock when the page is hidden, so it is asked for again on return.
 */

interface Sentinel {
  release(): Promise<void>;
}

export interface WakeDeps {
  navigator: { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };
  document: {
    visibilityState: DocumentVisibilityState;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
  };
}

export function keepScreenOn(deps: WakeDeps = { navigator, document } as unknown as WakeDeps): void {
  const wakeLock = deps.navigator.wakeLock;
  if (!wakeLock || typeof wakeLock.request !== 'function') return;
  let lock: Sentinel | null = null;

  const request = async () => {
    try {
      const next = await wakeLock.request('screen');
      if (deps.document.visibilityState === 'visible') lock = next;
      else void next.release().catch(() => {});
    } catch {
      // Not allowed (battery saver, no user activation, permissions policy): leave the screen as is.
    }
  };

  const release = () => {
    const current = lock;
    lock = null;
    void current?.release().catch(() => {});
  };

  deps.document.addEventListener('visibilitychange', () => {
    if (deps.document.visibilityState === 'visible') void request();
    else release();
  });
  if (deps.document.visibilityState === 'visible') void request();
}
