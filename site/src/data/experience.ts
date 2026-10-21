import type { Experience } from './types';

export const experience: Experience[] = [
  {
    id: 'tigerface',
    company: { ko: '호랑이얼굴', en: 'Tigerface' },
    role: { ko: '플랫폼 리드', en: 'Platform Lead' },
    period: { ko: '2025 ~ 현재', en: '2025 – Present' },
    summary: {
      ko: 'AI를 활용한 물류 자동화 플랫폼 개발을 이끌고 있습니다.',
      en: 'Leading development of an AI-powered logistics automation platform.',
    },
    stack: [],
    achievements: [],
  },
  {
    id: 'skt',
    company: { ko: 'SK텔레콤', en: 'SK Telecom' },
    team: { ko: '검색인프라팀 / PaaS TF', en: 'Search Infrastructure Team / PaaS Task Force' },
    role: { ko: '데이터 플랫폼 아키텍트', en: 'Data Platform Architect' },
    period: { ko: '2018.05 ~ 2025.10', en: 'May 2018 – Oct 2025' },
    summary: {
      ko: '데이터 플랫폼 아키텍처 설계와 AI 검색 서비스 인프라 고도화를 맡았습니다.',
      en: 'Designed data platform architecture and advanced the infrastructure behind an AI search service.',
    },
    stack: ['Kubernetes', 'Kafka', 'HBase', 'Redis', 'Spark', 'Hadoop', 'Java', 'Kotlin', 'Python'],
    achievements: [
      {
        title: {
          ko: '대화형 AI 검색 서비스 PaaS와 LLM Gateway 아키텍처 구축',
          en: 'Built the PaaS and LLM gateway architecture for a conversational AI search service',
        },
        detail: {
          ko: '외부 웹 크롤링 지연(3.2s+)과 P99 타임아웃(3.8%)을 줄이기 위해 수집 엔진 앞단에 Redis 2단계 캐시와 게이트웨이 사전 검증을 적용했습니다. 외부 API 비용을 81.6% 절감하고 평균 응답 지연을 3.2s에서 850ms로(73% 단축), P99 에러율을 0.08% 이하로 낮췄습니다.',
          en: 'To cut external web-crawl latency (3.2s+) and P99 timeouts (3.8%), added a two-tier Redis cache in front of the collection engine and pre-validation at the gateway. Reduced external API cost by 81.6%, average response latency from 3.2s to 850ms (73% faster), and the P99 error rate to under 0.08%.',
        },
      },
      {
        title: {
          ko: '초대용량 비정형 데이터 실시간 ETL 플랫폼의 병목 해소와 아키텍처 개편',
          en: 'Removed bottlenecks in and re-architected a very large real-time ETL platform for unstructured data',
        },
        detail: {
          ko: '150억 건(300TB+) 규모의 데이터를 Spark 배치와 Structured Streaming 하이브리드 파이프라인으로 처리하면서 생긴 78 TPS 병목과 499 타임아웃(12.4%)을 CompletableFuture 기반 비동기 아웃박스와 G1GC IHOP 튜닝으로 해결했습니다. 수집 처리량을 78에서 450+ TPS로(5.7배) 늘리고 499 타임아웃 장애를 99.8% 제거했으며, G1GC 최대 정지 시간을 1.5s에서 120ms로(92% 단축) 줄였습니다.',
          en: 'Resolved a 78 TPS bottleneck and 499 timeouts (12.4%) that occurred while processing 15 billion records (300TB+) with Spark batch and Structured Streaming hybrid pipelines, using a CompletableFuture-based asynchronous outbox and G1GC IHOP tuning. Raised ingest throughput from 78 to 450+ TPS (5.7x), eliminated 99.8% of 499 timeout failures, and cut the G1GC maximum pause from 1.5s to 120ms (92% shorter).',
        },
      },
      {
        title: {
          ko: 'Kubernetes 미들웨어 자동 프로비저닝 SaaS 구축과 Control Plane 5노드 쿼럼 확장',
          en: 'Built a self-service SaaS for provisioning Kubernetes middleware and expanded the control plane to a five-node quorum',
        },
        detail: {
          ko: 'etcd I/O 지연(45ms)으로 인한 Control Plane 마비를 etcd 5노드 쿼럼 증설과 NVMe 이관으로 해결해 P99 Write Latency를 45ms에서 4ms로(91% 단축) 낮췄습니다. Kafka와 Redis를 5분 안에 배포하는 온프레미스 SaaS를 만들어 프로비저닝 시간을 48시간에서 5분으로 줄이고, 클러스터 자원 활용률을 10%에서 52%로 높였습니다.',
          en: 'Fixed control-plane stalls caused by etcd I/O latency (45ms) by expanding etcd to a five-node quorum and moving it to NVMe, lowering P99 write latency from 45ms to 4ms (91% shorter). Built an on-premises SaaS that deploys Kafka and Redis within five minutes, cutting provisioning time from 48 hours to 5 minutes and raising cluster resource utilization from 10% to 52%.',
        },
      },
    ],
  },
  {
    id: 'kakaopay',
    company: { ko: '카카오페이', en: 'KakaoPay' },
    team: { ko: '페이먼트팀', en: 'Payment Team' },
    role: { ko: '백엔드 개발자', en: 'Backend Developer' },
    period: { ko: '2017.06 ~ 2018.05', en: 'Jun 2017 – May 2018' },
    summary: {
      ko: '결제 시스템 백엔드 개발과 데이터 정산 안정화를 맡았습니다.',
      en: 'Developed the payment system backend and stabilized settlement data.',
    },
    stack: [],
    achievements: [
      {
        title: { ko: '대규모 결제 트래픽 처리', en: 'Handling large-scale payment traffic' },
        detail: {
          ko: '고가용성·저지연 결제 승인 백엔드를 개발하고 Circuit Breaker와 Failover로 장애를 격리하는 파이프라인을 구축했습니다.',
          en: 'Developed a highly available, low-latency payment authorization backend and built a pipeline that isolates failures with circuit breakers and failover.',
        },
      },
      {
        title: { ko: '데이터 정산 시스템 고도화', en: 'Improving the settlement system' },
        detail: {
          ko: '수백만 건의 결제 로그를 자동 대사(Reconciliation)하는 파이프라인을 개선해 정산 오류율 0%를 달성했습니다.',
          en: 'Improved the pipeline that automatically reconciles millions of payment logs, bringing the settlement error rate to 0%.',
        },
      },
    ],
  },
  {
    id: 'kakao',
    company: { ko: '카카오', en: 'Kakao' },
    team: { ko: '검색팀 검색스팸셀', en: 'Search Team, Search Spam Cell' },
    role: { ko: '소프트웨어 개발자', en: 'Software Developer' },
    period: { ko: '2012.10 ~ 2017.06', en: 'Oct 2012 – Jun 2017' },
    summary: {
      ko: '검색 품질을 높이기 위한 스팸 감지 시스템과 데이터 분석 플랫폼을 개발했습니다.',
      en: 'Developed spam detection systems and a data analysis platform to improve search quality.',
    },
    stack: ['HBase', 'Hadoop', 'Spark'],
    achievements: [
      {
        title: { ko: 'Anti-Spam 시스템 개발', en: 'Anti-spam system' },
        detail: {
          ko: '실시간으로 들어오는 대규모 검색 노출·클릭 데이터에서 어뷰징 매크로와 스팸 트래픽을 걸러내는 핑거프린트 엔진을 구축했습니다.',
          en: 'Built a fingerprint engine that filters abusive macros and spam traffic out of large volumes of real-time search impression and click data.',
        },
      },
      {
        title: { ko: 'Hadoop/Spark 기반 대용량 로그 DW 인프라 구축과 운영', en: 'Hadoop/Spark-based large-scale log data warehouse infrastructure' },
        detail: {
          ko: 'HBase와 Hadoop(HDFS/MapReduce), Spark 기반의 스팸 패턴 분석 DW를 구축하고 일 수억 건 규모의 검색 노출·클릭 로그 분석 파이프라인을 운영했습니다.',
          en: 'Built a spam-pattern analysis data warehouse on HBase, Hadoop (HDFS/MapReduce), and Spark, operating large-scale log analysis pipelines for hundreds of millions of daily search impression and click events.',
        },
      },
    ],
  },
  {
    id: 'ensalt',
    company: { ko: '(주)enSalt', en: 'enSalt' },
    role: { ko: 'Co-Founder · 서버 사이드 개발', en: 'Co-Founder · Server-side Developer' },
    period: { ko: '2010.09 ~ 2011.10', en: 'Sep 2010 – Oct 2011' },
    summary: {
      ko: '초기 스타트업 멤버로 웹 서비스 아키텍처 설계와 핵심 엔진 개발을 이끌었습니다.',
      en: 'As an early startup member, led web service architecture design and core engine development.',
    },
    stack: [],
    achievements: [
      {
        title: { ko: '미디어아트 프로젝트 소프트웨어 개발', en: 'Software for media art projects' },
        detail: {
          ko: '“LifeCycle”, “하나은행 Flagship Store”, “엄지투표”, “있잖아요”, “Social Pixel” 등의 미디어아트 프로젝트에서 임베디드 프로세서를 활용한 소프트웨어와 이에 연동되는 소셜 네트워크 서비스를 구현했습니다.',
          en: 'For media art projects including “LifeCycle”, “Hana Bank Flagship Store”, “Thumb Vote”, “You Know What” and “Social Pixel”, implemented software running on embedded processors and the social network services connected to it.',
        },
      },
    ],
  },
];
