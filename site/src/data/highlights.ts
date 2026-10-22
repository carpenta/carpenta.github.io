import type { Highlight } from './types';

export const highlights: Highlight[] = [
  {
    id: 'ai-search',
    title: {
      ko: '대화형 AI 검색 - PaaS',
      en: 'Conversational AI search - PaaS',
    },
    tag: { ko: 'AI 검색 / LLM Gateway', en: 'AI search / LLM gateway' },
    period: '2023.01 ~ 2025.10',
    stack: ['Redis', 'Vector DB', 'Kafka', 'PySpark', 'SSE'],
    background: {
      ko: '질의 분석, 검색·수집, 랭킹, LLM 스트리밍을 직렬로 처리하는 AI 검색 백엔드였습니다. 모든 질의가 외부 검색 API와 실시간 웹 수집을 거쳐 비용이 커졌고, 피크 시간에는 응답이 3초를 넘었습니다. 수집이 허용되지 않는 사이트가 파이프라인 뒤쪽까지 흘러가 병목을 만들었고, 게이트웨이와 수집 엔진의 타임아웃이 맞지 않아 499·504 오류가 발생했습니다.',
      en: 'The AI search backend processed query analysis, retrieval and collection, ranking, and LLM streaming in series. Every query went through an external search API and live web collection, which drove cost up and pushed responses past three seconds at peak. Sites that could not be collected flowed deep into the pipeline and caused bottlenecks, and mismatched timeouts between the gateway and the collection engine produced 499 and 504 errors.',
    },
    decisions: [
      {
        ko: '수집 엔진 앞단에 Redis 2단계 캐시를 두어 반복되는 실시간 질의가 외부 API를 다시 호출하지 않도록 했습니다.',
        en: 'Placed a two-tier Redis cache in front of the collection engine so repeated real-time queries no longer hit the external API.',
      },
      {
        ko: '수집 불가 도메인 검증을 파이프라인 맨 앞으로 옮겨, 관리 콘솔의 정책으로 조기에 거부하고 도메인별 TPS를 제어했습니다.',
        en: 'Moved the check for non-collectable domains to the very front of the pipeline, rejecting them early from admin-console policy and controlling TPS per domain.',
      },
      {
        ko: '게이트웨이 타임아웃을 3.0초에서 4.5초로 조정하고 Exponential Backoff를 적용해 구간별 타임아웃 불일치를 없앴습니다.',
        en: 'Adjusted the gateway timeout from 3.0s to 4.5s and applied exponential backoff, removing the timeout mismatch between stages.',
      },
      {
        ko: '스트리밍 응답의 청크 버퍼를 조정하고 본문과 출처 메타데이터를 별도 패킷으로 분리해 토큰과 출처 유실을 막았습니다.',
        en: 'Tuned chunk buffering for streamed responses and separated body text from citation metadata into distinct packets, preventing lost tokens and citations.',
      },
    ],
    result: {
      ko: '외부 API 비용 81.6% 절감, 평균 응답 지연 3.2s → 850ms(73% 단축), P99 에러율 3.8% → 0.08% 이하.',
      en: 'External API cost down 81.6%, average response latency from 3.2s to 850ms (73% faster), P99 error rate from 3.8% to under 0.08%.',
    },
    diagram: {
      caption: { ko: 'AI 검색 요청 처리 흐름', en: 'AI search request flow' },
      rows: [
        [{ label: { ko: '사용자 질의', en: 'User query' } }],
        [{ label: { ko: '게이트웨이', en: 'Gateway' }, note: { ko: '타임아웃 4.5s · Exponential Backoff', en: '4.5s timeout · exponential backoff' }, changed: true }],
        [{ label: { ko: '수집 불가 도메인 검증', en: 'Non-collectable domain check' }, note: { ko: '관리 콘솔 정책으로 조기 거부 · 도메인별 TPS 제어', en: 'Early rejection by console policy · per-domain TPS' }, changed: true }],
        [{ label: { ko: '질의 분석', en: 'Query analysis' } }],
        [{ label: { ko: 'Redis 2단계 캐시', en: 'Two-tier Redis cache' }, note: { ko: '반복 질의는 여기서 응답', en: 'Repeated queries answered here' }, changed: true }, { label: { ko: '수집 엔진', en: 'Collection engine' }, note: { ko: '외부 검색 API · 실시간 웹 수집', en: 'External search API · live web collection' } }],
        [{ label: { ko: '랭킹', en: 'Ranking' } }],
        [{ label: { ko: '요약', en: 'Summarization' } }],
        [{ label: { ko: 'LLM 스트리밍 (SSE)', en: 'LLM streaming (SSE)' }, note: { ko: '본문과 출처 메타데이터를 별도 패킷으로', en: 'Body and citation metadata in separate packets' }, changed: true }],
      ],
    },
  },
  {
    id: 'data-platform',
    title: {
      ko: '검색 전용 데이터 플랫폼 - Shaker',
      en: 'Data platform for search - Shaker',
    },
    tag: { ko: '데이터 플랫폼', en: 'Data platform' },
    period: '2018.05 ~ 2021.12',
    stack: ['Spark', 'Kafka', 'HBase', 'Java', 'Spring Boot', 'OAuth2'],
    background: {
      ko: '사업부마다 데이터 형식과 저장소가 달라 새 검색·AI 서비스가 데이터를 연동하는 데 수 주가 걸렸습니다. 이를 하나의 카탈로그로 통합해 서빙하는 플랫폼을 만들었고, 누적 150억 건(300TB+)을 처리하는 단계에서 수집이 78 TPS에 묶이고 요청의 12.4%가 499 타임아웃으로 끝나는 병목을 만났습니다.',
      en: 'Each business unit kept data in its own format and store, so new search and AI services took weeks to integrate. I built a platform that unified this data into one catalog and served it. At a cumulative 15 billion records (300TB+), ingestion was stuck at 78 TPS and 12.4% of requests ended in 499 timeouts.',
    },
    decisions: [
      {
        ko: '대용량 기반 데이터는 Spark 배치로 정제해 벌크 적재하고, 실시간 데이터는 Structured Streaming으로 Kafka에서 바로 소비하는 하이브리드 파이프라인으로 구성했습니다.',
        en: 'Built a hybrid pipeline: large base datasets are refined with Spark batch and bulk-loaded, while real-time data is consumed straight from Kafka with Structured Streaming.',
      },
      {
        ko: 'HBase 카탈로그의 키를 도메인별로 파티셔닝해 핫스팟을 막고 동시 읽기 처리량을 확보했습니다.',
        en: 'Partitioned HBase catalog keys by domain to prevent hotspots and secure concurrent read throughput.',
      },
      {
        ko: '동기 쓰기 경로를 CompletableFuture 기반 비동기 아웃박스로 바꾸고 G1GC IHOP을 튜닝해 긴 정지를 없앴습니다.',
        en: 'Replaced the synchronous write path with a CompletableFuture-based asynchronous outbox and tuned G1GC IHOP to remove long pauses.',
      },
      {
        ko: '표준 REST 서빙 API와 CLI를 제공하고, OAuth2 기반 RBAC로 사업부별 접근을 제어했습니다.',
        en: 'Provided a standard REST serving API and a CLI, and controlled per-unit access with OAuth2-based RBAC.',
      },
    ],
    result: {
      ko: '수집 처리량 78 → 450+ TPS(5.7배), 499 타임아웃 99.8% 제거, G1GC 최대 정지 1.5s → 120ms(92% 단축). NUGU Conference 2019에서 구축 사례를 발표했습니다.',
      en: 'Ingest throughput from 78 to 450+ TPS (5.7x), 99.8% of 499 timeouts eliminated, G1GC maximum pause from 1.5s to 120ms (92% shorter). Presented the work at NUGU Conference 2019.',
    },
    diagram: {
      caption: { ko: '데이터 수집부터 서빙까지', en: 'From ingestion to serving' },
      rows: [
        [{ label: { ko: '사업부별 데이터 소스', en: 'Per-unit data sources' } }],
        [{ label: { ko: 'Spark 배치', en: 'Spark batch' }, note: { ko: '대용량 기반 데이터 정제 · 벌크 적재', en: 'Refine and bulk-load base data' }, changed: true }, { label: { ko: 'Structured Streaming', en: 'Structured Streaming' }, note: { ko: 'Kafka 실시간 데이터 소비', en: 'Consume real-time data from Kafka' }, changed: true }],
        [{ label: { ko: '비동기 아웃박스', en: 'Async outbox' }, note: { ko: 'CompletableFuture · G1GC IHOP 튜닝', en: 'CompletableFuture · G1GC IHOP tuning' }, changed: true }],
        [{ label: { ko: 'HBase 통합 카탈로그', en: 'Unified HBase catalog' }, note: { ko: '도메인별 키 파티셔닝', en: 'Keys partitioned by domain' }, changed: true }],
        [{ label: { ko: 'REST 서빙 API · CLI', en: 'REST serving API · CLI' }, note: { ko: 'OAuth2 기반 RBAC', en: 'OAuth2-based RBAC' }, changed: true }],
        [{ label: { ko: '검색·AI 서비스', en: 'Search and AI services' } }],
      ],
    },
  },
  {
    id: 'k8s-saas',
    title: {
      ko: 'Kubernetes 활용 SaaS - KIT',
      en: 'Kubernetes-based SaaS - KIT',
    },
    tag: { ko: '인프라 / 플랫폼', en: 'Infrastructure / platform' },
    period: '2020.01 ~ 2023.12',
    stack: ['Kubernetes', 'Custom Operator', 'etcd', 'Kafka', 'Redis Sentinel', 'ArgoCD', 'Helm'],
    background: {
      ko: '수십 개 개발팀이 Kafka와 Redis 같은 미들웨어를 요청했지만 배포는 인프라 엔지니어의 수작업에 의존해 신청부터 사용까지 48시간이 걸렸고, 서비스별로 흩어진 배포 탓에 클러스터 자원 활용률은 10% 수준이었습니다. 클러스터 객체가 늘면서 etcd P99 Write Latency가 45ms를 넘어 리더 재선출이 반복되고 API 서버가 응답하지 못하는 장애가 생겼습니다.',
      en: 'Dozens of teams requested middleware such as Kafka and Redis, but deployment depended on manual work by infrastructure engineers and took 48 hours from request to use. Fragmented per-service deployments left cluster utilization around 10%. As cluster objects grew, etcd P99 write latency exceeded 45ms, causing repeated leader elections and an unresponsive API server.',
    },
    decisions: [
      {
        ko: '개발자가 웹 포털에서 사양을 고르면 바로 배포되는 셀프서비스 SaaS를 만들고, 권한과 계정 생성을 자동화했습니다.',
        en: 'Built a self-service SaaS where developers pick a spec in a web portal and get it deployed immediately, with permissions and accounts created automatically.',
      },
      {
        ko: 'Kafka와 Redis Sentinel용 Custom Operator를 개발해 스케일링, 토픽 생성, 리밸런싱, 3초 이내 Failover를 자동화했습니다.',
        en: 'Developed custom operators for Kafka and Redis Sentinel to automate scaling, topic creation, rebalancing, and failover within three seconds.',
      },
      {
        ko: 'etcd를 3노드에서 5노드 쿼럼으로 무중단 확장하고 WAL과 데이터 디렉터리를 NVMe 전용 볼륨으로 분리했습니다.',
        en: 'Expanded etcd from a three-node to a five-node quorum without downtime and moved the WAL and data directories to dedicated NVMe volumes.',
      },
      {
        ko: '미들웨어 템플릿과 인프라 형상을 Git에 선언하고 ArgoCD와 Helm으로 자동 동기화했습니다.',
        en: 'Declared middleware templates and infrastructure state in Git and synchronized them automatically with ArgoCD and Helm.',
      },
    ],
    result: {
      ko: '프로비저닝 48시간 → 5분, etcd P99 Write Latency 45ms → 4ms(91% 단축), 클러스터 자원 활용률 10% → 52%.',
      en: 'Provisioning from 48 hours to 5 minutes, etcd P99 write latency from 45ms to 4ms (91% shorter), cluster utilization from 10% to 52%.',
    },
    diagram: {
      caption: { ko: '셀프서비스 미들웨어 배포 구조', en: 'Self-service middleware deployment' },
      rows: [
        [{ label: { ko: '개발자 웹 포털', en: 'Developer web portal' }, note: { ko: '사양 선택 · 권한과 계정 자동 생성', en: 'Pick a spec · permissions and accounts created' }, changed: true }],
        [{ label: { ko: 'ArgoCD · Helm', en: 'ArgoCD · Helm' }, note: { ko: 'Git에 선언한 템플릿·형상 자동 동기화', en: 'Sync templates and state declared in Git' }, changed: true }],
        [{ label: { ko: 'Custom Operator', en: 'Custom operators' }, note: { ko: '스케일링 · 토픽 · 리밸런싱 · 3초 이내 Failover', en: 'Scaling · topics · rebalancing · failover under 3s' }, changed: true }, { label: { ko: 'Kubernetes Control Plane', en: 'Kubernetes control plane' }, note: { ko: 'etcd 5노드 쿼럼 · NVMe 전용 볼륨', en: 'Five-node etcd quorum · dedicated NVMe' }, changed: true }],
        [{ label: { ko: 'Kafka', en: 'Kafka' } }, { label: { ko: 'Redis Sentinel', en: 'Redis Sentinel' } }],
      ],
    },
  },
];
