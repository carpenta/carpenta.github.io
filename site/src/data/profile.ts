import type { L10n } from './types';

export const profile = {
  name: { ko: '조일환', en: 'Cho Il-hwan' } satisfies L10n,
  role: { ko: 'Developer', en: 'Developer' } satisfies L10n,
  tagline: {
    ko: '카카오와 SK텔레콤에서 대용량 데이터 플랫폼과 검색·AI 서비스를 만들었고, 지금은 제가 직접 쓰는 제품과 도구를 만듭니다.',
    en: 'At Kakao and SK Telecom, I built large-scale data platforms along with search and AI services. Now I build the products and tools I use myself.',
  } satisfies L10n,
  headline: {
    ko: '대용량 분산 데이터 인프라와 LLM 기반 AI 서비스를 다뤄 온 개발자입니다.',
    en: 'A developer who works on large-scale distributed data infrastructure and LLM-based AI services.',
  } satisfies L10n,
  intro: {
    ko: '대규모 데이터를 안정적으로 모으고 처리하는 시스템을 오래 만들어 왔습니다. Spark 배치·스트리밍 파이프라인과 분산 데이터 플랫폼을 직접 설계하고 운영했고, 온프레미스 인프라를 Kubernetes 기반으로 옮겨 자원을 훨씬 효율적으로 쓸 수 있게 했습니다. 이후에는 LLM Gateway와 AI 검색 서비스의 백엔드를 설계하면서, 생성형 AI 서비스를 실제로 배포하고 운영하는 일을 이끌었습니다.',
    en: 'I have spent a long time building systems that collect and process data reliably at scale. I designed and ran Spark batch and streaming pipelines and distributed data platforms, and moved on-premises infrastructure onto Kubernetes so it could be used far more efficiently. Later I designed an LLM gateway and the backend of an AI search service, and led the work of shipping and running generative AI services in production.',
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
