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

export interface Highlight {
  id: string;
  title: L10n;
  tag: L10n;
  period: string;
  stack: string[];
  background: L10n;
  decisions: L10n[];
  result: L10n;
}

export interface Tool {
  slug: string;
  kind: 'static' | 'built';
  title: L10n;
  description: L10n;
  tags: string[];
}
