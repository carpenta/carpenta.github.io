import type { XlsxStyles } from './xlsx-styles';
export type Format = 'pptx' | 'hwp' | 'hwpx' | 'xlsx' | 'docx';
export interface DocumentInfo {
  count: number;
  labels?: string[];
  warning?: string;
}
export interface RenderedPage {
  html: string;
  width: number;
  height?: number;
  warning?: string;
}
export type WorkerRequest =
  | { type: 'open'; buffer: ArrayBuffer; format: Exclude<Format, 'docx'>; xlsxStyles?: XlsxStyles }
  | { type: 'page'; index: number; requestId?: string };
export type WorkerResponse =
  | { type: 'ready'; info: DocumentInfo }
  | { type: 'page'; index: number; page: RenderedPage; requestId?: string }
  | { type: 'error'; message: string; requestId?: string };
