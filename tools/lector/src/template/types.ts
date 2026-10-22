export type RoiFieldRule = 'all' | 'digits' | 'alphanumeric';

export interface NormalizedRect {
  /** 0.0 ~ 1.0 사이의 정규화된 좌상단 X 좌표 */
  x: number;
  /** 0.0 ~ 1.0 사이의 정규화된 좌상단 Y 좌표 */
  y: number;
  /** 0.0 ~ 1.0 사이의 정규화된 가로 너비 */
  width: number;
  /** 0.0 ~ 1.0 사이의 정규화된 세로 높이 */
  height: number;
}

export interface RoiField {
  id: string;
  name: string;
  rect: NormalizedRect;
  rule?: RoiFieldRule;
  extractedValue?: string;
  confidence?: number;
}

export interface DocumentTemplate {
  name: string;
  description?: string;
  version: '1.0';
  fields: RoiField[];
}
