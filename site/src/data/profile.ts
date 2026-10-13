import type { L10n } from './types';

export const profile = {
  name: { ko: '조일환', en: 'Cho Il-hwan' } satisfies L10n,
  role: { ko: 'Developer', en: 'Developer' } satisfies L10n,
  tagline: {
    ko: '데이터 플랫폼을 15년 만들었고, 지금은 직접 쓰는 제품과 도구를 만듭니다.',
    en: 'Fifteen years building data platforms. Now building the products and tools I use myself.',
  } satisfies L10n,
  headline: {
    ko: '초대용량 데이터 인프라 설계부터 LLM 기반 AI 서비스 아키텍처까지 다뤄 온 15년 차 개발자입니다.',
    en: 'A developer with fifteen years of experience, from very large data infrastructure to LLM-based AI service architecture.',
  } satisfies L10n,
  intro: {
    ko: '150억 건(300TB+) 규모의 비정형 데이터를 처리하는 실시간 ETL 파이프라인과 데이터 플랫폼을 직접 설계하고 운영했습니다. 온프레미스 자원을 Kubernetes 기반 SaaS/PaaS로 전환해 인프라 효율을 400% 이상 개선했고, LLM Gateway API와 AI 검색 서비스 백엔드를 설계해 생성형 AI 서비스의 배포와 운영을 이끌었습니다.',
    en: 'I designed and operated real-time ETL pipelines and data platforms handling 15 billion unstructured records (300TB+). I moved on-premises resources to Kubernetes-based SaaS/PaaS, improving infrastructure efficiency by more than 400%, and led the rollout and operation of generative AI services by designing an LLM gateway API and the backend of an AI search service.',
  } satisfies L10n,
  description: {
    ko: '조일환의 프로필, 경력, 프로젝트, 그리고 브라우저에서 바로 쓰는 도구 모음.',
    en: 'Profile, experience and projects of Cho Il-hwan, plus a set of tools that run in the browser.',
  } satisfies L10n,
  email: 'carpenta.dev@gmail.com',
  github: 'https://github.com/carpenta',
  resumePdf: {
    ko: '/resume/조일환_이력서.pdf',
    en: '/resume/Cho_Il-hwan_Resume.pdf',
  } satisfies L10n,
};
