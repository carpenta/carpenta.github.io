# carpenta.github.io

조일환(carpenta)의 프로필·포트폴리오 사이트와 도구 모음.

| 경로 | 내용 |
|---|---|
| `site/` | Astro 프로필 사이트 (한국어 `/`, 영어 `/en/`) |
| `tools/` | 빌드가 필요한 도구. 도구마다 독립 패키지 |
| `scripts/` | 빌드 결과물을 하나로 합치는 스크립트 |
| `archive/jekyll-blog/` | 2015~2022년 Jekyll 블로그. 배포되지 않음 |

## 로컬 실행

Node.js 22.12 이상이 필요합니다.

```sh
cd site
npm ci
npm run dev            # http://127.0.0.1:4321
```

전체 결과물을 만들어 확인하려면:

```sh
(cd site && npm ci && npm run build)
(cd tools/folio && npm ci && npm run build)
# 이력서는 합치기 단계에서 제외되므로 npm run resume이 필요 없습니다
node scripts/assemble.mjs
python3 -m http.server 4400 --directory dist
```

## 테스트

사이트(`site/`)는 아래 순서로 실행합니다. 이력서 페이지와 PDF는 배포되지 않지만 테스트 대상입니다. `npm run build`가 `dist`를 비우기 때문에, 이력서 PDF가 필요한 `test:pdf`와 `test:e2e`는 반드시 `npm run resume` 뒤에 실행해야 합니다.

```sh
cd site
npm test               # 단위 테스트
npm run build
npm run resume         # 이력서 PDF 생성(로컬 전용)
npm run test:pdf
npm run test:e2e
```

e2e는 포트 4321에 미리보기 서버를 띄웁니다. 로컬에서는 이미 떠 있는 서버를 그대로 재사용하므로, 실행 전에 4321 포트가 비어 있어야 오래된 서버가 결과를 가리지 않습니다.

Folio(`tools/folio/`):

```sh
cd tools/folio
npm test
npm run test:e2e -- --workers=1
```

선택 사항으로 `site/tests/unit/forbidden.local.json`(문자열 배열, git이 무시함)을 두면 단위 테스트가 그 문자열이 공개 데이터에 하나도 없는지 검사합니다. 이 파일이 없으면 검사는 건너뛰므로 CI에서는 실행되지 않습니다.

합치기 스크립트는 저장소 루트에서 `node --test scripts/assemble.test.mjs`로 검사합니다.

## 내용 수정

모든 문구는 `site/src/data/`에 한/영 쌍으로 있습니다. 여기만 고치면 홈과 로컬 이력서 페이지·PDF가 함께 바뀝니다.

| 파일 | 내용 |
|---|---|
| `profile.ts` | 이름, 소개, 연락처 |
| `experience.ts` | 경력 |
| `education.ts` | 학력, 자격증 |
| `skills.ts` | 기술 스택 |
| `projects.ts` | 프로젝트 |
| `highlights.ts` | 로컬 이력서의 Project Highlights |
| `tools.json` | 도구 등록부 |

## 이력서

이력서 페이지(`/resume/`, `/en/resume/`)와 PDF는 배포하지 않고, 공개 사이트 어디에서도 링크하지 않습니다. 합치기 스크립트(`scripts/assemble.mjs`)가 결과물에서 이 경로를 지우고, 남아 있으면 검증이 실패합니다.

로컬에서 만들려면 `site/`에서 `npm run build`와 `npm run resume`을 실행합니다. PDF는 `site/dist/resume/`에 생기고, `npm run preview`를 실행하면 `http://127.0.0.1:4321/resume/`에서 페이지를 볼 수 있습니다.

## 도구 추가

도구는 서버나 저장소를 쓰지 않는 stateless 웹 도구입니다. 사이트의 레이아웃과 스타일에 의존하지 않습니다.

**파일 하나짜리 도구**

1. `site/public/tools/<slug>/index.html`을 추가합니다.
2. `site/src/data/tools.json`에 항목을 추가합니다. `kind`는 `"static"`입니다.

**빌드가 필요한 도구**

1. `tools/<slug>/`에 독립 패키지로 둡니다. `npm ci && npm run build`가 `dist/index.html`을 만들어야 하고, 자산 경로는 상대 경로여야 합니다(Vite라면 `base: './'`).
2. `site/src/data/tools.json`에 항목을 추가합니다. `kind`는 `"built"`입니다.
3. `.github/workflows/pages.yml`에서 `folio` 잡을 복사해 `<slug>` 잡을 만들고 다음을 고칩니다.
   - `folio` 잡: 잡 이름, `working-directory`, `cache-dependency-path`, 아티팩트의 `name`과 `path`
   - 테스트가 없는 도구라면 복사한 잡에서 `npm test`와 e2e 단계를 뺍니다.
   - `assemble` 잡: `needs` 목록에 새 잡을 추가하고, `path`가 `tools/<slug>/dist`인 `download-artifact` 단계를 하나 더 추가

등록부 항목:

```json
{
  "slug": "my-tool",
  "kind": "static",
  "title": { "ko": "도구 이름", "en": "Tool name" },
  "description": { "ko": "한 줄 설명", "en": "One-line description" },
  "tags": ["PDF"]
}
```

등록했는데 결과물이 없거나, 결과물은 있는데 등록하지 않으면 `scripts/assemble.mjs`가 실패해 배포가 중단됩니다.

## 배포

`master`에 푸시하면 GitHub Actions가 테스트, 빌드, 합치기를 거쳐 GitHub Pages에 배포합니다. 어느 단계든 실패하면 배포하지 않습니다.
