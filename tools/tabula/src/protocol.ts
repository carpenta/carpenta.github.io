import type { ErrorCode } from './types';

/** 메인 스레드 → worker */
export type Req =
  | { id: number; op: 'open'; file: File }
  | { id: number; op: 'page'; start: number; count: number; columns: string[] }
  | { id: number; op: 'count' }
  | { id: number; op: 'cancel'; target: number };

/** worker → 메인 스레드. bytesRead는 지금까지 파일에서 읽은 총 바이트다. */
export type Res =
  | { id: number; ok: true; result: unknown; bytesRead: number }
  | { id: number; ok: false; code: ErrorCode; message: string; bytesRead: number }
  | { id: number; progress: number };
