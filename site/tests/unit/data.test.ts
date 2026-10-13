import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ui } from '../../src/data/ui';
import { profile } from '../../src/data/profile';
import { experience } from '../../src/data/experience';
import { education, certificates } from '../../src/data/education';
import { skills } from '../../src/data/skills';
import { projects } from '../../src/data/projects';
import { highlights } from '../../src/data/highlights';
import { tools } from '../../src/data/tools';

const all = { ui, profile, experience, education, certificates, skills, projects, highlights, tools };

// Optional local list of strings that must never appear in public data (untracked, see README).
const LIST_PATH = fileURLToPath(new URL('./forbidden.local.json', import.meta.url));
const hasList = existsSync(LIST_PATH);
let forbidden: string[] = [];
if (hasList) {
  const parsed: unknown = JSON.parse(readFileSync(LIST_PATH, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((t) => typeof t === 'string' && t.trim() !== '')) {
    throw new Error('forbidden.local.json must be a non-empty JSON array of non-empty strings');
  }
  forbidden = parsed;
}

/** Reports "term #N at offset M" for every occurrence; the term itself is never printed. */
function findForbidden(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  forbidden.forEach((term, index) => {
    const needle = term.toLowerCase();
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
      hits.push(`term #${index + 1} at offset ${at}: ${text.slice(Math.max(0, at - 12), at)}${'*'.repeat(needle.length)}${text.slice(at + needle.length, at + needle.length + 12)}`);
    }
  });
  return hits;
}

function collectL10n(value: unknown, path: string, out: { path: string; value: Record<string, unknown> }[]) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectL10n(item, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('ko' in record || 'en' in record) out.push({ path, value: record });
    else for (const [key, child] of Object.entries(record)) collectL10n(child, `${path}.${key}`, out);
  }
}

describe('content data', () => {
  it('has a non-empty ko and en string for every localized field', () => {
    const fields: { path: string; value: Record<string, unknown> }[] = [];
    collectL10n(all, 'data', fields);
    expect(fields.length).toBeGreaterThan(50);
    const broken = fields.filter(({ value }) =>
      !(typeof value.ko === 'string' && value.ko.trim() && typeof value.en === 'string' && value.en.trim()));
    expect(broken.map((f) => f.path)).toEqual([]);
  });

  if (hasList) {
    it('identifier list is present on this machine', () => {
      expect(forbidden.length).toBeGreaterThan(0);
    });
  }

  it.skipIf(!hasList)('contains no internal identifiers', () => {
    expect(findForbidden(JSON.stringify(all).toLowerCase())).toEqual([]);
  });

  it('publishes no phone number', () => {
    // Generic pattern: a run of 10+ digit-ish characters (digits, spaces, parentheses, dots, hyphens).
    // Period strings such as "2018.05 ~ 2025.10" are broken up by "~" and stay below the length limit.
    expect(JSON.stringify(all).match(/\+?\d[\d\s().-]{8,}\d/g) ?? []).toEqual([]);
    expect(Object.keys(profile)).not.toContain('phone');
    expect(Object.keys(profile)).not.toContain('phoneHref');
  });

  it('lists the current employer by company and role only', () => {
    const current = experience[0];
    expect(current.company.ko).toBe('호랑이얼굴');
    expect(current.role.en).toBe('Platform Lead');
    expect(current.achievements).toEqual([]);
    expect(current.stack).toEqual([]);
  });

  it('lists employers in résumé order', () => {
    expect(experience.map((e) => e.company.en)).toEqual(['Tigerface', 'SK Telecom', 'KakaoPay', 'Kakao', 'enSalt']);
  });

  it('has three project highlights with decisions and a result', () => {
    expect(highlights).toHaveLength(3);
    for (const h of highlights) expect(h.decisions.length).toBeGreaterThanOrEqual(3);
  });

  it('registers tools with unique url-safe slugs', () => {
    const slugs = tools.map((tool) => tool.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const tool of tools) {
      expect(tool.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(['static', 'built']).toContain(tool.kind);
    }
    expect(slugs).toContain('folio');
  });
});
