import type { L10n } from './types';

export const profile = {
  name: { ko: '조일환', en: 'Cho Il-hwan' } satisfies L10n,
  role: { ko: 'Developer', en: 'Developer' } satisfies L10n,
  tagline: {
    ko: '대용량 데이터 플랫폼을 15년간 만들어왔고, 지금은 직접 쓰는 제품과 도구를 만듭니다.',
    en: 'Fifteen years building large-scale data platforms. Now building the products and tools I use myself.',
  } satisfies L10n,
  headline: {
    ko: '대용량 분산 데이터 인프라와 LLM 기반 AI 서비스를 다뤄 온 개발자입니다.',
    en: 'A developer who works on large-scale distributed data infrastructure and LLM-based AI services.',
  } satisfies L10n,
  intro: {
    ko: '150억 건(300TB+) 규모의 데이터를 처리하는 Spark 배치·스트리밍 ETL 파이프라인과 대규모 분산 데이터 플랫폼을 직접 설계하고 운영했습니다. 온프레미스 자원을 Kubernetes 기반 SaaS/PaaS로 전환해 인프라 효율을 400% 이상 개선했고, LLM Gateway API와 AI 검색 서비스 백엔드를 설계해 생성형 AI 서비스의 배포와 운영을 이끌었습니다.',
    en: 'I designed and operated Spark batch and streaming ETL pipelines and large-scale distributed data platforms handling 15 billion records (300TB+). I moved on-premises resources to Kubernetes-based SaaS/PaaS, improving infrastructure efficiency by more than 400%, and led the rollout and operation of generative AI services by designing an LLM gateway API and the backend of an AI search service.',
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
