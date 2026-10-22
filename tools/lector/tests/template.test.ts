import { describe, it, expect } from 'vitest';
import {
  getWhitelistForRule,
  serializeTemplate,
  parseTemplate,
  exportResultsToCsv,
  exportResultsToJson,
} from '../src/template/manager';
import type { DocumentTemplate, RoiField } from '../src/template/types';

describe('Template Manager & Serialization', () => {
  it('returns appropriate whitelist for field rules', () => {
    expect(getWhitelistForRule('digits')).toContain('0123456789');
    expect(getWhitelistForRule('alphanumeric')).toContain('abc');
    expect(getWhitelistForRule('all')).toBeUndefined();
  });

  it('serializes and parses template JSON roundtrip', () => {
    const template: DocumentTemplate = {
      name: '세금계산서 기본형',
      description: '사업자번호 및 합계금액 추출',
      version: '1.0',
      fields: [
        {
          id: 'f1',
          name: '등록번호',
          rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
          rule: 'digits',
        },
        {
          id: 'f2',
          name: '상호',
          rect: { x: 0.1, y: 0.26, width: 0.3, height: 0.05 },
          rule: 'all',
        },
      ],
    };

    const json = serializeTemplate(template);
    const restored = parseTemplate(json);

    expect(restored.name).toBe('세금계산서 기본형');
    expect(restored.fields.length).toBe(2);
    expect(restored.fields[0].name).toBe('등록번호');
    expect(restored.fields[0].rule).toBe('digits');
  });

  it('throws helpful error on malformed template json', () => {
    expect(() => parseTemplate('{}')).toThrow();
    expect(() => parseTemplate('{"name": "test"}')).toThrow();
    expect(() => parseTemplate('{"name": "test", "fields": [{}]}')).toThrow();
  });

  it('exports field results to CSV and JSON formats', () => {
    const fields: RoiField[] = [
      {
        id: 'f1',
        name: '등록번호',
        rect: { x: 0, y: 0, width: 0.1, height: 0.1 },
        extractedValue: '123-45-67890',
        confidence: 96.5,
      },
      {
        id: 'f2',
        name: '공급가액',
        rect: { x: 0, y: 0, width: 0.1, height: 0.1 },
        extractedValue: '1,000,000',
        confidence: 98.2,
      },
    ];

    const csv = exportResultsToCsv(fields);
    expect(csv).toContain('"등록번호","123-45-67890",96.5');
    expect(csv).toContain('"공급가액","1,000,000",98.2');

    const json = exportResultsToJson(fields);
    const parsed = JSON.parse(json);
    expect(parsed['등록번호']).toBe('123-45-67890');
    expect(parsed['공급가액']).toBe('1,000,000');
  });
});
