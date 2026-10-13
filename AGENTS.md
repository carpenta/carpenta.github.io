# AGENTS.md

이 저장소에서 작업하는 코딩 에이전트를 위한 안내입니다. 사람용 개요는 `README.md`에 있습니다.

## 이 저장소가 하는 일

`https://carpenta.github.io`로 배포되는 개인 프로필 사이트와 브라우저 도구 모음입니다. 실명으로 공개되는 사이트이고 저장소도 공개입니다.

| 경로 | 내용 |
|---|---|
| `site/` | Astro 정적 사이트. 한국어 `/`, 영어 `/en/`, 도구 목록 `/tools/` |
| `tools/<slug>/` | 빌드가 필요한 도구. 도구마다 독립 패키지 (현재 `folio`) |
| `scripts/assemble.mjs` | `site/dist`와 `tools/*/dist`를 루트 `dist/`로 합치고 검증 |
| `.github/workflows/pages.yml` | 테스트 → 빌드 → 합치기 → GitHub Pages 배포 |
| `archive/jekyll-blog/` | 예전 블로그. 배포되지 않음. 수정하지 않는다 |

`site/`와 `tools/*`는 각자 `package.json`과 lockfile을 갖습니다. 루트에 `package.json`이나 npm workspaces를 만들지 않습니다.

## 반드시 지킬 것

- **`master` 푸시는 곧 실서비스 배포입니다.** 브랜치에서 작업하고 PR로 올립니다. 푸시, PR 병합, 저장소 설정 변경은 사용자 확인 없이 하지 않습니다.
- **공개하면 안 되는 것을 커밋하지 않습니다.**
  - 전화번호. `site/tests/unit/data.test.ts`가 데이터에 전화번호 형태의 문자열이 있으면 실패합니다.
  - 이전·현재 직장의 내부 시스템명, 코드명, 호스트명, 파트너명. 현 직장은 회사명·역할·기간·한 줄 요약만 씁니다.
  - `site/tests/unit/forbidden.local.json`. git이 무시하는 로컬 전용 목록입니다. 열어서 내용을 출력하거나, 다른 파일·커밋 메시지·로그에 옮겨 적지 않습니다. 해시 같은 파생값도 커밋하지 않습니다.
  - `docs/superpowers/`의 설계·계획 문서. git이 무시합니다.
- **이력서는 로컬 전용 기능입니다.** `/resume/` 페이지와 PDF는 공개 사이트에서 링크하지 않고 배포하지 않습니다. `assemble.mjs`의 `PRIVATE`가 결과물에서 지우고, 남아 있으면 검증이 실패합니다. CI는 아티팩트 업로드 전에 이 경로를 삭제합니다. 이 장치들을 제거하지 않습니다.
- **모든 표시 문구는 `site/src/data/`에서 옵니다.** 컴포넌트에 본문을 직접 쓰지 않습니다. 문자열은 `{ ko, en }` 쌍(`L10n`)이고 둘 다 채워야 합니다.
- **도구는 사이트에 의존하지 않습니다.** 사이트의 레이아웃·스타일·스크립트를 가져다 쓰지 않고, 서버나 저장소 없이 브라우저에서만 동작해야 합니다.
- 외부 CDN을 쓰지 않습니다. 글꼴은 `site/public/fonts/`의 Pretendard Variable 하나입니다.

## 명령

Node.js 22.12 이상. CI는 Node 24를 씁니다.

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

순서가 중요합니다. `build`가 `site/dist`를 비우므로 `test:pdf`와 `test:e2e`는 항상 `build` → `resume` 뒤에 실행합니다. e2e는 4321 포트의 미리보기 서버를 쓰고 로컬에서는 떠 있는 서버를 재사용하므로, 실행 전에 포트가 비어 있어야 합니다.

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
node scripts/assemble.mjs          # → dist/
python3 -m http.server 4400 --directory dist
```

`node --test scripts/`처럼 디렉터리를 넘기면 동작하지 않습니다. 파일을 지정합니다.

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

### 도구 추가

- 파일 하나짜리: `site/public/tools/<slug>/index.html` + `tools.json` 항목(`kind: "static"`).
- 빌드가 필요한 것: `tools/<slug>/` 독립 패키지. `npm ci && npm run build`가 상대 경로 기준(`base: './'`)의 `dist/index.html`을 만들어야 합니다. `tools.json` 항목(`kind: "built"`)을 추가하고, 워크플로에서 `folio` 잡을 복사해 잡 이름·`working-directory`·`cache-dependency-path`·아티팩트 `name`/`path`를 바꾸고, `assemble` 잡의 `needs`와 `download-artifact` 단계에 추가합니다.
- 모든 도구는 사이트로 돌아가는 링크(`../../`)를 모든 화면 폭에서 보여야 합니다.

## 테스트 작성 규칙

- 동작을 바꾸면 실패하는 테스트를 먼저 씁니다.
- 글꼴 로드 확인에 `document.fonts.check()`를 쓰지 않습니다. 글꼴이 없어도 참을 돌려줍니다. `document.fonts.ready` 뒤에 `[...document.fonts].some(f => f.family.replace(/["']/g, '') === 'Pretendard Variable' && f.status === 'loaded')`를 씁니다.
- 새 페이지에는 360px 폭에서 가로 스크롤이 없는지 확인하는 테스트를 넣습니다.
- PDF 텍스트 비교는 공백을 모두 지우고 합니다. 추출 결과의 공백 위치가 원문과 다릅니다.
- 이력서 CSS에 `font-variant-numeric: tabular-nums`를 쓰지 않습니다. PDF에서 숫자가 텍스트로 추출되지 않습니다.
- 한국어 문단에는 `word-break: keep-all`이 걸려 있습니다(`html:lang(ko) body`). 새 스타일시트를 만들면 같은 규칙을 넣습니다.

## 워크플로

- 최상위 권한은 `contents: read`입니다. `pages: write`와 `id-token: write`는 `deploy` 잡에만 있습니다. 넓히지 않습니다.
- `deploy`는 `master`의 push와 수동 실행에서만 돕니다. PR에서는 빌드·테스트·합치기까지만 실행됩니다.
- 어느 잡이든 실패하면 배포하지 않습니다. 한 도구의 테스트 실패가 사이트 배포를 막는 것은 의도된 동작입니다.
- 루트의 `.nojekyll`은 GitHub의 기존 Pages 빌드(`pages build and deployment`)가 Jekyll을 돌리다 실패하지 않게 하려고 둔 파일입니다. Pages 소스가 "Deploy from a branch"인 동안에는 그 빌드가 저장소 루트를 그대로 먼저 배포하고, 이 워크플로의 배포가 뒤이어 덮어씁니다. 소스를 "GitHub Actions"로 바꾸면 이 파일은 필요 없습니다.

## 커밋

- 메시지는 `ADD:`, `UPD:`, `DEL:`, `FIX:` 접두사로 시작합니다.
- `git status --short`로 확인한 뒤 경로를 지정해 스테이징합니다. `node_modules/`, `dist/`, `.astro/`, `test-results/`, `playwright-report/`, `.superpowers/`, `.omc/`는 커밋하지 않습니다.
- `tools/folio/`는 별도 앱을 옮겨 온 것입니다. 요청받은 변경 외에는 손대지 않고, CSP 메타 태그를 바꾸지 않습니다.
