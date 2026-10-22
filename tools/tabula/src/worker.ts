/// <reference lib="webworker" />
import type { Req } from './protocol';
import { createHandler } from './worker-core';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handle = createHandler((m) => scope.postMessage(m));
scope.onmessage = (ev: MessageEvent<Req>) => {
  void handle(ev.data);
};
