import type { DocumentTemplate, NormalizedRect, RoiField, RoiFieldRule } from './types';

/** 규칙별 화이트리스트 문자셋 매핑 */
export function getWhitelistForRule(rule?: RoiFieldRule): string | undefined {
  switch (rule) {
    case 'digits':
      return '0123456789-.,/: ';
    case 'alphanumeric':
      return '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-.,/: ';
    case 'all':
    default:
      return undefined;
  }
}

/** 캔버스에서 정규화된 ROI 영역을 크롭하여 별도 서브 캔버스로 반환합니다. */
export function cropRoiFromCanvas(
  canvas: HTMLCanvasElement,
  rect: NormalizedRect
): HTMLCanvasElement {
  const cw = canvas.width;
  const ch = canvas.height;

  const sx = Math.max(0, Math.min(cw, Math.round(rect.x * cw)));
  const sy = Math.max(0, Math.min(ch, Math.round(rect.y * ch)));
  const sw = Math.max(1, Math.min(cw - sx, Math.round(rect.width * cw)));
  const sh = Math.max(1, Math.min(ch - sy, Math.round(rect.height * ch)));

  const subCanvas = document.createElement('canvas');
  subCanvas.width = sw;
  subCanvas.height = sh;

  const ctx = subCanvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  }

  return subCanvas;
}

/** 템플릿 객체를 JSON 문자열로 직렬화합니다. */
export function serializeTemplate(template: DocumentTemplate): string {
  return JSON.stringify(template, null, 2);
}

/** JSON 문자열을 파싱하여 템플릿 객체로 검증 및 복원합니다. */
export function parseTemplate(jsonStr: string): DocumentTemplate {
  const data = JSON.parse(jsonStr);

  if (!data || typeof data !== 'object') {
    throw new Error('유효하지 않은 템플릿 JSON 형식입니다.');
  }

  if (typeof data.name !== 'string' || !Array.isArray(data.fields)) {
    throw new Error('템플릿에 name 또는 fields 배열이 누락되었습니다.');
  }

  const fields: RoiField[] = data.fields.map((f: any, idx: number) => {
    if (!f.name || !f.rect) {
      throw new Error(`필드 #${idx + 1}의 정보(name 또는 rect)가 올바르지 않습니다.`);
    }

    return {
      id: f.id || `field_${Date.now()}_${idx}`,
      name: String(f.name),
      rect: {
        x: Math.max(0, Math.min(1, Number(f.rect.x) || 0)),
        y: Math.max(0, Math.min(1, Number(f.rect.y) || 0)),
        width: Math.max(0.01, Math.min(1, Number(f.rect.width) || 0.1)),
        height: Math.max(0.01, Math.min(1, Number(f.rect.height) || 0.1)),
      },
      rule: f.rule === 'digits' || f.rule === 'alphanumeric' ? f.rule : 'all',
    };
  });

  return {
    name: data.name,
    description: data.description ? String(data.description) : undefined,
    version: '1.0',
    fields,
  };
}

/** 필드 추출 결과를 CSV 포맷 문자열로 변환합니다. */
export function exportResultsToCsv(fields: RoiField[]): string {
  const headers = ['필드명', '추출값', '신뢰도(%)', '규칙'];
  const rows = fields.map((f) => [
    `"${(f.name || '').replace(/"/g, '""')}"`,
    `"${(f.extractedValue || '').replace(/"/g, '""')}"`,
    f.confidence !== undefined ? f.confidence.toFixed(1) : '',
    f.rule || 'all',
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/** 필드 추출 결과를 Key-Value JSON 포맷 문자열로 변환합니다. */
export function exportResultsToJson(fields: RoiField[]): string {
  const result: Record<string, string> = {};
  for (const f of fields) {
    result[f.name] = f.extractedValue || '';
  }
  return JSON.stringify(result, null, 2);
}
