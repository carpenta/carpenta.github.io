import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileSource } from '../src/source';

export const fixtures = join(import.meta.dirname, 'fixtures/generated');

export function nodeSource(name: string) {
  return fileSource(new Blob([readFileSync(join(fixtures, name))]));
}

export const signal = () => new AbortController().signal;
