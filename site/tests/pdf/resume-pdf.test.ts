import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import { experience } from '../../src/data/experience';
import { highlights } from '../../src/data/highlights';
import { profile } from '../../src/data/profile';

const dist = new URL('../../dist/resume/', import.meta.url);

async function read(file: string) {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(new URL(encodeURI(file), dist))));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { totalPages, text: squash(text) };
}

/** PDF 텍스트 추출은 공백과 줄바꿈 위치가 원문과 다를 수 있어 공백을 모두 지우고 비교한다. */
function squash(value: string) {
  return value.replace(/\s+/g, '');
}

describe.each([
  { locale: 'ko' as const, file: '조일환_이력서.pdf' },
  { locale: 'en' as const, file: 'Cho_Il-hwan_Resume.pdf' },
])('résumé pdf ($locale)', ({ locale, file }) => {
  it('contains selectable text for the name, contacts and every employer', async () => {
    const { text } = await read(file);
    expect(text).toContain(squash(profile.name[locale]));
    expect(text).toContain(profile.email);
    expect(text).not.toMatch(/010-?\d/);
    expect(text).not.toContain('+82');
    for (const job of experience) expect(text, job.id).toContain(squash(job.company[locale]));
  });

  it('keeps the period digits of every employer in the extracted text', async () => {
    const { text } = await read(file);
    for (const job of experience) expect(text, job.id).toContain(squash(job.period[locale]));
  });

  it('contains every project highlight title', async () => {
    const { text } = await read(file);
    for (const h of highlights) expect(text, h.id).toContain(squash(h.title[locale]).slice(0, 16));
  });

  it('is between two and six A4 pages', async () => {
    const { totalPages } = await read(file);
    expect(totalPages).toBeGreaterThanOrEqual(2);
    expect(totalPages).toBeLessThanOrEqual(6);
  });
});
