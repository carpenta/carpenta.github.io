import type { Project } from './types';

export const projects: Project[] = [
  {
    id: 'agent-mission-control',
    name: 'Agent Mission Control',
    description: {
      ko: '여러 코딩 에이전트의 상태를 픽셀 캐릭터로 보여주고 작업 보드로 관리하는 로컬 우선 macOS 앱입니다.',
      en: 'A local-first macOS app that shows the state of multiple coding agents as pixel characters and manages their work on a task board.',
    },
    status: { ko: '1단계 완료', en: 'Phase 1 delivered' },
    stack: ['Electron', 'SQLite', 'TypeScript'],
  },
];
