import { describe, expect, it } from 'vitest';
import { keepScreenOn, type WakeDeps } from '../src/wake';

function fakeDoc(state: 'visible' | 'hidden' = 'visible') {
  const listeners: (() => void)[] = [];
  return {
    visibilityState: state as DocumentVisibilityState,
    addEventListener: (_type: 'visibilitychange', fn: () => void) => void listeners.push(fn),
    set(next: 'visible' | 'hidden') {
      this.visibilityState = next;
      for (const fn of listeners) fn();
    },
  };
}

function fakeWakeLock(fail = false) {
  const log: string[] = [];
  return {
    log,
    request: async (type: 'screen') => {
      log.push(`request ${type}`);
      if (fail) throw new DOMException('not allowed', 'NotAllowedError');
      return { released: false, release: async () => void log.push('release') };
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('keepScreenOn', () => {
  it('does nothing and does not throw when the Wake Lock API is missing', () => {
    const doc = fakeDoc();
    expect(() => keepScreenOn({ navigator: {}, document: doc } as WakeDeps)).not.toThrow();
    expect(() => doc.set('hidden')).not.toThrow();
  });

  it('asks for a screen lock while visible, releases it when hidden and asks again when visible', async () => {
    const doc = fakeDoc();
    const wakeLock = fakeWakeLock();
    keepScreenOn({ navigator: { wakeLock }, document: doc } as WakeDeps);
    await flush();
    expect(wakeLock.log).toEqual(['request screen']);
    doc.set('hidden');
    await flush();
    expect(wakeLock.log).toEqual(['request screen', 'release']);
    doc.set('visible');
    await flush();
    expect(wakeLock.log).toEqual(['request screen', 'release', 'request screen']);
  });

  it('does not ask while the page starts hidden', async () => {
    const doc = fakeDoc('hidden');
    const wakeLock = fakeWakeLock();
    keepScreenOn({ navigator: { wakeLock }, document: doc } as WakeDeps);
    await flush();
    expect(wakeLock.log).toEqual([]);
  });

  it('ignores a refused request', async () => {
    const doc = fakeDoc();
    const wakeLock = fakeWakeLock(true);
    keepScreenOn({ navigator: { wakeLock }, document: doc } as WakeDeps);
    await flush();
    doc.set('hidden');
    doc.set('visible');
    await flush();
    expect(wakeLock.log).toEqual(['request screen', 'request screen']);
  });
});
