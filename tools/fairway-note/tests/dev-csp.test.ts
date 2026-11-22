import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { devCsp } from '../vite.config.ts';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const policy = (page: string) => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(page)?.[1] ?? '';

describe('dev server CSP', () => {
  it('lets vite dev inject its styles and reach its reload socket', () => {
    const dev = policy(devCsp(html));
    expect(dev).toContain("style-src 'self' 'unsafe-inline'");
    expect(dev).toContain("connect-src 'self' ws: wss:");
  });

  it('keeps everything else as written', () => {
    const dev = policy(devCsp(html));
    expect(dev.replace(" 'unsafe-inline'", '').replace("'self' ws: wss:", "'none'")).toBe(policy(html));
    expect(dev).toContain("script-src 'self';");
  });
});
