# carpenta.github.io

조일환(carpenta)의 프로필 사이트와 브라우저 도구 모음. https://carpenta.github.io

| 경로 | 내용 |
|---|---|
| `site/` | Astro 프로필 사이트 (한국어 `/`, 영어 `/en/`) |
| `tools/` | 빌드가 필요한 도구. 도구마다 독립 패키지 |
| `scripts/` | 빌드 결과물을 하나로 합치고 검증하는 스크립트 |
| `archive/jekyll-blog/` | 2015~2022년 Jekyll 블로그. 배포되지 않음 |

작업 규칙, 구조, 테스트 방법은 [AGENTS.md](AGENTS.md)에 있습니다.

## 실행

Node.js 22.12 이상이 필요합니다.

```sh
cd site
npm ci
npm run dev            # http://127.0.0.1:4321
```

배포되는 전체 결과물을 로컬에서 보려면:

```sh
(cd site && npm ci && npm run build)
(cd tools/folio && npm ci && npm run build)
node scripts/assemble.mjs
python3 -m http.server 4400 --directory dist
```

## 내용 수정

문구는 모두 `site/src/data/`에 한/영 쌍으로 있습니다.

| 파일 | 내용 |
|---|---|
| `profile.ts` | 이름, 소개, 연락처 |
| `experience.ts` | 경력 |
| `education.ts` | 학력, 자격증 |
| `skills.ts` | 기술 스택 |
| `projects.ts` | 프로젝트 |
| `highlights.ts` | 이력서의 Project Highlights |
| `tools.json` | 도구 등록부 |

## 이력서

이력서 페이지와 PDF는 배포하지 않는 로컬 전용 기능입니다.

```sh
cd site
npm run build && npm run resume    # PDF → site/dist/resume/
npm run preview                    # http://127.0.0.1:4321/resume/
```

## 도구 추가

서버 없이 브라우저에서만 동작하는 도구를 둡니다.

- **파일 하나짜리**: `site/public/tools/<slug>/index.html`을 추가합니다.
- **빌드가 필요한 것**: `tools/<slug>/`에 독립 패키지로 두고, 워크플로에 잡을 추가합니다.

어느 쪽이든 `site/src/data/tools.json`에 등록합니다.

```json
{
  "slug": "my-tool",
  "kind": "static",
  "title": { "ko": "도구 이름", "en": "Tool name" },
  "description": { "ko": "한 줄 설명", "en": "One-line description" },
  "tags": ["PDF"]
}
```

등록과 결과물이 어긋나면 배포가 중단됩니다. 자세한 절차는 [AGENTS.md](AGENTS.md#도구-추가)를 봅니다.

## 배포

`master`에 푸시하면 GitHub Actions가 테스트, 빌드, 합치기를 거쳐 GitHub Pages에 배포합니다. 어느 단계든 실패하면 배포하지 않습니다.
