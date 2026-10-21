import type { Locale } from '../lib/paths';

export type L10n = Record<Locale, string>;

export interface Achievement {
  title: L10n;
  detail: L10n;
}

export interface Experience {
  id: string;
  company: L10n;
  team?: L10n;
  role: L10n;
  period: L10n;
  summary: L10n;
  stack: string[];
  achievements: Achievement[];
}

export interface EducationItem {
  school: L10n;
  detail: L10n;
  period: string;
}

export interface Certificate {
  name: L10n;
  issuer: L10n;
  date: string;
}

export interface SkillGroup {
  name: L10n;
  items: string[];
}

export interface Project {
  id: string;
  name: string;
  description: L10n;
  status: L10n;
  stack: string[];
  url?: string;
}

export interface DiagramNode {
  label: L10n;
  note?: L10n;
  /** 이 프로젝트에서 새로 만들거나 바꾼 부분 */
  changed?: boolean;
}
/** 위에서 아래로 흐르는 단계. 한 단계에 노드가 여럿이면 나란히 놓인다. */
export interface Diagram {
  caption: L10n;
  rows: DiagramNode[][];
}

export interface Highlight {
  id: string;
  title: L10n;
  tag: L10n;
  period: string;
  stack: string[];
  background: L10n;
  decisions: L10n[];
  result: L10n;
  diagram: Diagram;
}

export interface Tool {
  slug: string;
  kind: 'static' | 'built';
  title: L10n;
  description: L10n;
  tags: string[];
}
