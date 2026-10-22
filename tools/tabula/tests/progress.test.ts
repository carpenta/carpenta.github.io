import { expect, test } from 'vitest';
import { createProgress } from '../src/ui/progress';

test('overlapping work keeps the indicator until the last one ends and shows the earlier label again', () => {
  const log: string[] = [];
  const p = createProgress((label) => log.push(`show ${label}`), () => log.push('hide'));
  const count = p.begin('행을 세는 중');
  const page = p.begin('페이지를 읽는 중');
  page.end();
  expect(log.at(-1)).toBe('show 행을 세는 중');
  count.update('행을 세는 중: 10');
  expect(log.at(-1)).toBe('show 행을 세는 중: 10');
  count.end();
  expect(log.at(-1)).toBe('hide');
  count.end();
  expect(log.filter((l) => l === 'hide')).toHaveLength(1);
});
