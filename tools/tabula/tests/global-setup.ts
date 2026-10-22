import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** 테스트 전에 픽스처를 한 번 새로 만든다. */
export default function setup(): void {
  execFileSync(process.execPath, [join(import.meta.dirname, 'generate-fixtures.mjs')], { stdio: 'inherit' });
}
