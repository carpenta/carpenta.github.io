# AGENTS.md

이 저장소에서 작업하는 코딩 에이전트(Claude Code, Codex, Antigravity 등)를 위한 안내입니다. 사람용 개요는 `README.md`에 있습니다. 어느 에이전트가 이어받아도 같은 방식으로 일하도록, 특정 에이전트의 기능(스킬, 플러그인, 메모리)에 기대지 않고 이 파일과 저장소 안의 파일만으로 작업할 수 있게 적었습니다.

## 이 저장소가 하는 일

`https://carpenta.github.io`로 배포되는 개인 프로필 사이트와 브라우저 도구 모음입니다. 실명으로 공개되는 사이트이고 저장소도 공개입니다.

| 경로 | 내용 |
|---|---|
| `site/` | Astro 정적 사이트. 한국어 `/`, 영어 `/en/`, 도구 목록 `/tools/` |
| `tools/<slug>/` | 빌드가 필요한 도구. 도구마다 독립 패키지 (현재 `folio`) |
| `scripts/assemble.mjs` | `site/dist`와 `tools/*/dist`를 루트 `dist/`로 합치고 검증 |
| `.github/workflows/pages.yml` | 테스트 → 빌드 → 합치기 → GitHub Pages 배포 |
| `archive/jekyll-blog/` | 예전 블로그. 배포되지 않음. 수정하지 않는다 |
| `docs/superpowers/` | 설계·계획 문서. git이 무시하는 로컬 전용 폴더 ([작업 문서](#작업-문서)) |

`site/`와 `tools/*`는 각자 `package.json`과 lockfile을 갖습니다. 루트에 `package.json`이나 npm workspaces를 만들지 않습니다.

## 반드시 지킬 것

- **`master` 푸시는 곧 실서비스 배포입니다.** 브랜치에서 작업하고 PR로 올립니다. 푸시, PR 생성·병합, 저장소 설정 변경은 사용자 확인 없이 하지 않습니다.
- **공개하면 안 되는 것을 커밋하지 않습니다.**
  - 전화번호. `site/tests/unit/data.test.ts`가 데이터에 전화번호 형태의 문자열이 있으면 실패합니다.
  - 이전·현재 직장의 내부 시스템명, 코드명, 호스트명, 파트너명. 현 직장은 회사명·역할·기간·한 줄 요약만 씁니다.
  - `site/tests/unit/forbidden.local.json`. git이 무시하는 로컬 전용 목록입니다. 열어서 내용을 출력하거나, 다른 파일·커밋 메시지·PR 본문·로그에 옮겨 적지 않습니다. 해시 같은 파생값도 커밋하지 않습니다.
  - `docs/superpowers/`의 설계·계획 문서. 내부 정보가 들어 있을 수 있으므로 내용을 커밋·PR 본문으로 옮기지 않습니다.
- **이력서는 로컬 전용 기능입니다.** `/resume/` 페이지와 PDF는 공개 사이트에서 링크하지 않고 배포하지 않습니다. `assemble.mjs`의 `PRIVATE`가 결과물에서 지우고, 남아 있으면 검증이 실패합니다. CI는 아티팩트 업로드 전에 이 경로를 삭제합니다. 이 장치들을 제거하지 않습니다.
- **모든 표시 문구는 `site/src/data/`에서 옵니다.** 컴포넌트에 본문을 직접 쓰지 않습니다. 문자열은 `{ ko, en }` 쌍(`L10n`)이고 둘 다 채워야 합니다.
- **도구는 사이트에 의존하지 않습니다.** 사이트의 레이아웃·스타일·스크립트를 가져다 쓰지 않고, 서버나 저장소 없이 브라우저에서만 동작해야 합니다.
- 외부 CDN을 쓰지 않습니다. 사이트 글꼴은 `site/public/fonts/`의 Pretendard Variable 하나입니다.
- 테스트를 건너뛰거나(`.skip`, `.only`) 기대값을 느슨하게 바꿔서 통과시키지 않습니다. 실패를 고칠 수 없으면 그대로 보고합니다.

## 작업 순서

### 시작할 때

1. `git status --short --branch`로 현재 브랜치와 변경 사항을 확인합니다. 다른 에이전트가 남긴 커밋되지 않은 변경이 있으면 지우거나 덮어쓰지 말고 사용자에게 알립니다.
2. `git fetch origin` 후 `gh pr list`로 열린 PR을 확인합니다. 이어서 할 작업이 이미 브랜치·PR로 있으면 그 브랜치에서 계속합니다.
3. 브랜치 이름과 같은 `<topic>`의 계획 문서(`docs/superpowers/plans/*-<topic>.md`)가 있으면 읽고 [작업 문서](#작업-문서)의 방식대로 이어서 진행합니다. 브랜치는 있는데 계획 문서가 없으면(다른 컴퓨터·클라우드에서 일하는 경우) [작업 문서](#작업-문서)의 "계획 문서가 없을 때"를 따릅니다.
4. 새 작업이면 최신 `master`에서 브랜치를 만듭니다. 이름은 내용을 나타내는 kebab-case이고, 설계·계획 문서의 `<topic>`과 같게 짓습니다(예: `portfolio-site`, `add-nojekyll`, `docs-agents-readme`).

### 규모별 진행

- **작은 수정**(문구, 한 파일 버그, 설정 한 줄): 바로 고치고 [완료 기준](#완료-기준)의 검사를 돌립니다.
- **새 도구, 새 페이지, 구조 변경**: 코드를 쓰기 전에 설계 문서와 계획 문서를 만들고 사용자 승인을 받습니다. 승인된 계획을 단계별로 실행합니다.

### 끝낼 때

1. [완료 기준](#완료-기준)의 검사를 모두 돌리고, 실행한 명령과 결과를 보고에 적습니다.
2. 계획 문서의 완료한 단계를 체크합니다.
3. 커밋합니다([커밋](#커밋)). 푸시와 PR은 사용자 확인 후에 합니다([PR](#pr)).
4. 사용자에게 무엇을 했는지, 어디에 있는지(브랜치·커밋·PR), 남은 일과 다음 명령을 알립니다.

## 작업 문서

설계·계획 문서는 `docs/superpowers/` 아래에 둡니다. 폴더 이름은 처음 쓴 도구에서 왔지만 어느 에이전트든 같은 위치를 씁니다. git이 무시하므로 커밋되지 않고, 같은 컴퓨터에서 일하는 에이전트끼리만 공유됩니다.

| 경로 | 내용 |
|---|---|
| `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` | 설계. 무엇을 왜 만드는지, 제약, 범위 밖인 것 |
| `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` | 구현 계획. 단계마다 `- [ ]` 체크박스 |

- **계획 문서가 진행 기록입니다.** 단계를 끝내면 `- [x]`로 바꿉니다. 이어받는 에이전트는 처음 나오는 `- [ ]`부터 진행합니다. 체크박스가 실제 상태와 다르면(예: 커밋은 있는데 체크가 안 됨) `git log`와 파일을 대조해 바로잡고 시작합니다.
- 계획 문서 머리말이 특정 에이전트의 스킬(예: `superpowers:executing-plans`)을 요구해도, 그 스킬이 없으면 단계를 순서대로 직접 실행하면 됩니다.
- 계획과 다르게 구현해야 하면 계획 문서를 먼저 고치고 이유를 한 줄 남깁니다.
- 에이전트별 상태 폴더(`.superpowers/`, `.omc/`, `.omx/`)는 그 에이전트 전용입니다. 다른 에이전트에게 넘길 내용은 거기가 아니라 계획 문서에 적습니다.

**계획 문서가 없을 때.** 다른 컴퓨터나 클라우드에서 일하는 에이전트는 `docs/superpowers/`를 볼 수 없습니다. 이때는 진행 상태를 브랜치의 커밋 기록과 PR 본문의 `## Test plan` 체크박스로 판단합니다. 그것만으로 무엇을 할지 정해지지 않으면 추측하지 말고 사용자에게 계획을 요청합니다.

**공개 문서로 옮길 때.** 도구의 `docs/DESIGN.md`처럼 커밋되는 문서는 설계 문서를 그대로 복사하지 않고, 공개해도 되는 내용(약속, 구조, 검증)만 새로 씁니다. 내부 이름이나 로컬 경로를 옮기지 않습니다.

## 명령

Node.js 22.12 이상. CI는 Node 24를 씁니다. 이력서 PDF와 모든 e2e는 Playwright Chromium이 필요합니다. 처음 한 번 해당 패키지 폴더에서 `npx playwright install chromium`을 실행합니다(CI는 `--with-deps`).

e2e는 각자 정해진 포트에 미리보기 서버를 띄우고, 로컬에서는 이미 떠 있는 서버를 재사용합니다(`reuseExistingServer: !process.env.CI`). 예전 빌드를 띄운 서버가 남아 있으면 그 결과로 테스트하므로, 실행 전에 해당 포트가 비어 있는지 확인합니다.

### 사이트 (`site/`)

```sh
npm ci
npm run dev          # http://127.0.0.1:4321
npm test             # 단위 테스트 (데이터 무결성)
npm run build        # astro check + astro build → site/dist
npm run resume       # 이력서 PDF → site/dist/resume/ (Playwright Chromium 필요)
npm run test:pdf     # PDF 내용 검사
npm run test:e2e     # Playwright
```

순서가 중요합니다. `build`가 `site/dist`를 비우므로 `test:pdf`와 `test:e2e`는 항상 `build` → `resume` 뒤에 실행합니다. e2e는 4321 포트를 씁니다.

### Folio (`tools/folio/`)

```sh
npm ci
npm test
npm run test:e2e -- --workers=1   # 스스로 빌드하고 4173 포트에서 미리보기
npm run build
```

### 합치기 (루트)

```sh
node --test scripts/assemble.test.mjs
node scripts/assemble.mjs          # → dist/ (site와 각 도구를 먼저 빌드해야 함)
python3 -m http.server 4400 --directory dist
```

`node --test scripts/`처럼 디렉터리를 넘기면 동작하지 않습니다. 파일을 지정합니다.

## 완료 기준

바꾼 경로에 해당하는 검사를 모두 통과해야 끝난 것입니다. 여러 줄에 해당하면 모두 돌립니다.

| 바꾼 곳 | 돌릴 검사 |
|---|---|
| `site/` (`src/data/tools.json` 포함) | `site/`에서 `npm test` → `npm run build` → `npm run resume` → `npm run test:pdf` → `npm run test:e2e` |
| `tools/<slug>/` | 그 폴더에서 `npm test` → `npm run build` → `npm run test:e2e -- --workers=1` |
| `scripts/`, `tools.json`, 도구 추가·삭제 | 위 빌드를 모두 마친 뒤 루트에서 `node --test scripts/assemble.test.mjs` → `node scripts/assemble.mjs` |
| `.github/workflows/` | 위 검사 전부. 워크플로 자체는 PR을 올려야 CI에서 확인됩니다 |
| `AGENTS.md`, `README.md`만 | 문서에 적은 경로·명령이 실제와 맞는지 확인 |

## 구조

### 사이트

- `src/data/` — 콘텐츠. `types.ts`에 타입, `ui.ts`에 UI 문구, `tools.json`이 도구 등록부(`tools.ts`가 타입을 붙여 다시 내보냄).
- `src/lib/paths.ts` — `Locale`, `localePath(locale, path)`, `altLocale(locale)`.
- `src/components/Head.astro` — 모든 페이지의 `<head>`. canonical, hreflang, Open Graph를 여기서만 만듭니다. `noindex`를 주면 canonical·alternate·`og:url`을 빼고 robots 메타를 넣습니다.
- `src/layouts/` — `SiteLayout`(다크, `global.css`), `ResumeLayout`(인쇄용 라이트, `resume.css`, 항상 `noindex`).
- `src/views/` — 페이지 본체. `src/pages/`의 파일은 `locale`만 넘기는 얇은 껍데기입니다. 새 페이지는 한국어와 `/en/` 양쪽에 만듭니다.
- 모든 내부 링크는 `/`로 끝납니다(`trailingSlash: 'always'`). 로케일 경로는 `localePath`로 만듭니다.
- 도구 링크는 두 언어 모두 `/tools/<slug>/`입니다. 도구 페이지는 하나뿐입니다.

### 합치기와 검증

`assemble`은 `site/dist`를 `dist/`로 복사하고, `PRIVATE` 경로를 지우고, `tools/<slug>/dist`를 `dist/tools/<slug>/`로 복사합니다. `verify`는 다음 중 하나라도 해당하면 실패합니다.

- `REQUIRED` 파일이 없다
- 등록부에 있는 도구의 `index.html`이 없다
- `dist/tools/` 아래에 등록되지 않은 폴더가 있다
- `PRIVATE` 경로가 남아 있다
- 도구 페이지가 사이트 루트 기준 경로(`src="/…"`, `<link href="/…">`)로 자산을 불러온다

자주 만나는 실패:

- `tool folder is not registered`: `assemble`은 `index.html`이 있는 `tools/*/dist`를 등록 여부와 상관없이 복사합니다. 등록하지 않은 도구의 로컬 빌드가 남아 있으면 그 `dist/`를 지웁니다.
- `registered tool has no output`: CI에서는 보통 `assemble` 잡에 그 도구의 `download-artifact` 단계를 빠뜨린 경우입니다. 로컬에서는 도구를 빌드하지 않은 경우입니다.
- `collides with a static tool`: 같은 slug가 `site/public/tools/`와 `tools/`에 모두 있습니다.

## 도구 추가

모든 도구의 공통 조건:

- 서버, 계정, 분석 도구 없이 브라우저에서만 동작합니다. 사용자 파일을 네트워크로 보내지 않습니다.
- 사이트로 돌아가는 링크(`../../`)를 모든 화면 폭에서 보여 줍니다.
- 런타임에 외부 주소로 요청하지 않습니다. 라이브러리와 WASM은 같은 출처에서 내려받도록 번들에 넣습니다. `index.html`에 CSP 메타 태그를 두어 이를 강제합니다. folio의 CSP(`tools/folio/index.html`)에서 시작해 그 도구에 필요 없는 허용 항목은 뺍니다.
- 사이트의 글꼴·스타일을 `../../`로 불러오지 않습니다. 시스템 글꼴을 쓰거나(folio 방식), 필요하면 글꼴 파일을 도구 안에 넣습니다.
- 한국어 문구가 있는 도구의 스타일시트에도 `html:lang(ko) body { word-break: keep-all }`을 넣습니다. folio는 옮겨 온 앱이라 예외로 그대로 둡니다.

`tools.json` 항목은 `site/src/data/types.ts`의 `Tool` 타입을 따릅니다.

```json
{
  "slug": "my-tool",
  "kind": "built",
  "title": { "ko": "도구 이름", "en": "Tool name" },
  "description": { "ko": "한 줄 설명", "en": "One-line description" },
  "tags": ["CSV", "Parquet"]
}
```

- `slug`는 `^[a-z0-9]+(-[a-z0-9]+)*$`를 만족하고, 빌드 도구면 `tools/<slug>/` 폴더 이름과 같아야 합니다.
- `title`·`description`은 한/영 모두 채웁니다. `tags`는 언어 구분 없는 문자열 배열입니다(형식명 등).

### 파일 하나짜리 (`kind: "static"`)

1. `site/public/tools/<slug>/index.html`을 만듭니다. 자산은 상대 경로로 불러옵니다.
2. `site/src/data/tools.json`에 항목을 추가합니다.
3. 사이트의 [완료 기준](#완료-기준)과 합치기 검사를 돌립니다.

### 빌드가 필요한 것 (`kind: "built"`)

`tools/folio/`가 기준 구현입니다. 아래에 따로 적은 것 외에는 구조와 스크립트 이름을 그대로 따릅니다.

1. `tools/<slug>/`에 독립 패키지를 만듭니다. `package.json`에 `test`, `test:e2e`, `build` 스크립트를 두고 lockfile을 커밋합니다. `tools/folio/.gitignore`를 복사해 둡니다.
2. `npm ci && npm run build`가 상대 경로 기준(`base: './'`)의 `dist/index.html`을 만들어야 합니다.
3. Playwright `webServer`는 다른 도구·사이트와 겹치지 않는 포트를 씁니다(사이트 4321, folio 4173, 합친 결과 4400은 사용 중).
4. e2e에 최소한 다음을 넣습니다.
   - 기본 동작
   - `../../` 링크가 보임
   - 360px 폭에서 가로 스크롤 없음. folio는 390px로 검사하지만 새 도구는 360px로 합니다.
   - 외부 주소로 나가는 요청 없음, 사용자 파일을 localStorage·sessionStorage·쿠키·IndexedDB에 남기지 않음. `tools/folio/tests/e2e.spec.ts` 첫 테스트의 방식을 그대로 씁니다.
5. 테스트용 파일은 `tests/generate-fixtures.mjs` 같은 스크립트로 `tests/fixtures/generated/`(git 무시)에 만들고, e2e의 `beforeAll`에서 생성합니다. folio와 같은 방식입니다.
6. 문서를 둡니다. folio의 같은 파일을 형식 참고로 씁니다.
   - `README.md`(한국어): 실행 / 기능과 제한 / 개인정보 경계 / 검증 / 배포
   - `docs/DESIGN.md`(영어): Contract / Architecture / UI / Verification. [공개 문서로 옮길 때](#작업-문서)의 규칙을 따릅니다.
   - `docs/DEPENDENCIES.md`: 런타임 의존성의 버전·라이선스·출처
7. `site/src/data/tools.json`에 항목(`kind: "built"`)을 추가합니다.
8. `.github/workflows/pages.yml`에서 `folio` 잡을 복사해 잡 이름·`working-directory`·`cache-dependency-path`·아티팩트 `name`/`path`를 바꾸고, `assemble` 잡의 `needs`와 `download-artifact` 단계에 추가합니다.
9. [완료 기준](#완료-기준)의 사이트·도구·합치기 검사를 모두 돌립니다.

## 테스트 작성 규칙

- 동작을 바꾸면 실패하는 테스트를 먼저 씁니다.
- 글꼴 로드 확인에 `document.fonts.check()`를 쓰지 않습니다. 글꼴이 없어도 참을 돌려줍니다. `document.fonts.ready` 뒤에 `[...document.fonts].some(f => f.family.replace(/["']/g, '') === 'Pretendard Variable' && f.status === 'loaded')`를 씁니다.
- 새 페이지에는 360px 폭에서 가로 스크롤이 없는지 확인하는 테스트를 넣습니다.
- PDF 텍스트 비교는 공백을 모두 지우고 합니다. 추출 결과의 공백 위치가 원문과 다릅니다.
- 이력서 CSS에 `font-variant-numeric: tabular-nums`를 쓰지 않습니다. PDF에서 숫자가 텍스트로 추출되지 않습니다.
- 한국어 문단에는 `word-break: keep-all`이 걸려 있습니다(`html:lang(ko) body`). 새 스타일시트를 만들면 같은 규칙을 넣습니다.
- 테스트용 문서·데이터는 스크립트로 생성합니다(folio의 `tests/generate-fixtures.mjs`). 개인 문서를 넣지 않습니다.

## 워크플로

- 최상위 권한은 `contents: read`입니다. `pages: write`와 `id-token: write`는 `deploy` 잡에만 있습니다. 넓히지 않습니다.
- `deploy`는 `master`의 push와 수동 실행에서만 돕니다. PR에서는 빌드·테스트·합치기까지만 실행됩니다.
- 어느 잡이든 실패하면 배포하지 않습니다. 한 도구의 테스트 실패가 사이트 배포를 막는 것은 의도된 동작입니다.
- 루트의 `.nojekyll`은 GitHub의 기존 Pages 빌드(`pages build and deployment`)가 Jekyll을 돌리다 실패하지 않게 하려고 둔 파일입니다. Pages 소스가 "Deploy from a branch"인 동안에는 그 빌드가 저장소 루트를 그대로 먼저 배포하고, 이 워크플로의 배포가 뒤이어 덮어씁니다. 소스를 "GitHub Actions"로 바꾸면 이 파일은 필요 없습니다.

## 커밋

- 메시지는 `ADD:`, `UPD:`, `DEL:`, `FIX:` 접두사 뒤에 영어로 무엇을 왜 바꿨는지 씁니다(예: `ADD: .nojekyll so the legacy pages build stops failing on astro files`).
- 한 커밋에는 한 가지 변경을 담습니다. 도구 추가처럼 큰 작업은 계획 문서의 단계 단위로 나눕니다.
- `git status --short`로 확인한 뒤 경로를 지정해 스테이징합니다(`git add -A`, `git add .` 금지). `node_modules/`, `dist/`, `.astro/`, `test-results/`, `playwright-report/`, `tests/fixtures/generated/`, `.superpowers/`, `.omc/`, `.omx/`, `docs/superpowers/`는 커밋하지 않습니다.
- `tools/folio/`는 별도 앱을 옮겨 온 것입니다. 요청받은 변경 외에는 손대지 않고, CSP 메타 태그를 바꾸지 않습니다.

## PR

- 사용자 확인을 받은 뒤 `gh pr create --base master`로 올립니다.
- 제목은 영어로 변경 내용을 한 줄로 씁니다(접두사 없음).
- 본문은 영어로 다음 순서로 씁니다.
  - `## Summary`: 무엇을 왜 바꿨는지
  - `## Before merging`(필요할 때): 병합 전에 사용자가 해야 할 설정 변경 등
  - `## Trade-off`(필요할 때)
  - `## Test plan`: 실행한 검사와 병합 후 확인할 것을 체크박스로
- CI가 통과해야 병합합니다. 병합은 사용자가 합니다.
