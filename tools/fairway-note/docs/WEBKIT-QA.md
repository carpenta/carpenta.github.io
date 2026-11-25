# iPhone(WebKit) e2e 점검

대부분의 사용자가 iPhone Safari나 홈 화면 앱으로 씁니다. 그런데 e2e는 Chromium에서만 돌고 있었습니다. 그래서 같은 테스트를 WebKit과 iPhone 프로필로 돌려 깨지는 곳을 찾고, 실패마다 원인이 앱인지 테스트인지 가렸습니다.

- 기준: `fairway-note-entry-v2`의 v10(커밋 `296c774`). `src/`, `index.html`, `tests/e2e.spec.ts`는 바꾸지 않았습니다.
- 도구: Playwright 1.64.0, WebKit 27.2(Playwright 빌드 v2370, macOS arm64)
- 실행: 처음 한 번 `bunx playwright install webkit`, 그다음 `bun run test:e2e:webkit --workers=1`
- 설정 `playwright.webkit.config.ts`는 기본 설정을 가져와 프로젝트만 바꿉니다.
  - `devices['iPhone 13']`: 390×664, `isMobile`, `hasTouch`, 배율 3, iPhone Safari UA
  - 포트 4185(`--strictPort`)를 쓰고, 이미 떠 있는 서버를 재사용하지 않습니다.
  - 결과는 `test-results/webkit/`, 보고서는 `playwright-report/webkit/`에 따로 남깁니다.
  - 실패 스크린샷을 끄고 trace(`retain-on-failure`)를 남깁니다. 이유는 [하네스 문제](#해결함-playwright-스크린샷이-csp-오류를-남김)에 있습니다.

## 결과

전체 67개 가운데 **63개 통과, 4개 실패**입니다. 첫 실행에서는 5개가 실패했는데, 그중 1개는 Playwright 쪽 문제여서 설정에서 해결했습니다.

엔진 탓인지 화면 크기 탓인지 가리려고, 같은 iPhone 13 프로필을 Chromium에도 돌려 대조했습니다. 거기서는 1개(깃발)만 실패했습니다.

| # | 테스트 (`tests/e2e.spec.ts`) | 분류 | 원인 한 줄 | 심각도 |
|---|---|---|---|---|
| 1 | `:1001` 375×553에서 기록 화면 전체(상세) | **앱 결함 (WebKit 글자 폭)** | WebKit에서 글자가 넓어져 상세 모드의 홀 스위처가 점수 배지 밑으로 4px 들어감 | 중간 |
| 2 | `:1755` 375×553 지난 라운드 → 백업과 복원 | **앱 결함 (WebKit 글자 폭 + iPhone 전용 버튼)** | 안내 문단이 한 줄 늘어 저장 버튼이 화면 밖으로 0.98px 나감. "백업 파일 공유"는 통째로 화면 밖 | 중간 |
| 3 | `:360` 홀 그림의 깃발 | 테스트 가정 (뷰포트) + 결정 필요 | 390×664에서는 깃발 띠가 24px이라 깃발을 안 그림(30px 미만). Chromium도 같은 크기에서 같음 | 낮음 |
| 4 | `:1192` 결과 복사 | 테스트 가정 (Chromium 전용 API) | WebKit은 `clipboard-read`/`clipboard-write` 권한 부여를 지원하지 않음. 앱의 복사는 정상 | 낮음 (앱 영향 없음) |
| – | `:1553` 백업 저장·복원 (+ 실패한 테스트마다 CSP 오류) | 하네스 (해결함) | Playwright 스크린샷이 넣는 `<style>`을 WebKit이 페이지 CSP로 막음 | 없음 |

화면 크기 375×553은 iPhone SE(2·3세대) Safari에서 툴바가 보일 때의 크기와 같습니다. 1과 2는 모두 이 크기에서만 실패하고, 375×667·360×640에서는 통과합니다.

## 1. 상세 모드에서 홀 스위처가 점수 배지와 겹침 (375×553)

- 증상: 상세 모드를 켜면 `.switcher`의 오른쪽 끝(다음 홀 버튼)이 `#badge` 왼쪽으로 4.05px 들어갑니다. 테스트는 두 상자가 떨어져 있어야 합니다.
- 측정(같은 375×553·배율 2·터치 프로필)

  | | Chromium | WebKit |
  |---|---|---|
  | `.top` 열 | `48px 213.05px 61.95px` | `48px 223.05px 51.95px` |
  | `.switcher` 오른쪽 끝 / `#badge` 왼쪽 | 287.05 / 293 (6px 남음) | 297.05 / 293 (4px 겹침) |
  | `#hole-sub` "Par 4 · 376m" 폭 | 71.05px | 81.05px |
  | `#hole-title` "2번 홀" 폭 | 45.33px | 48.55px |

- 원인: 같은 Mac, 같은 `-apple-system` 글꼴 목록인데도 WebKit(`lang="ko"`)이 라틴 글자와 숫자를 더 넓게 그립니다. 원래 여유가 6px뿐이어서 WebKit에서는 넘칩니다. `style.css`의 `.ticks` 주석에도 "더 넓은 스위처는 짧은 화면에서 배지와 부딪힌다"고 적혀 있습니다. 실제 iPhone은 WebKit이므로 WebKit 쪽 측정이 기기에 더 가깝습니다.
- 제안: `src/main.ts`의 `fitMeta()`처럼 스위처도 맞춥니다(예: `fitSwitcher()`). 상세 모드에서 `.switcher`의 오른쪽 끝이 `#badge` 왼쪽에서 6px 안으로 들어오면 `#hole-sub`에서 거리를 빼고 Par만 남깁니다. 거리는 홀 안내에 남아 있습니다. "HDCP 다음 거리 순으로 비킨다"는 기존 규칙과 같은 방식입니다. CSS만으로 하려면 `#entry[data-mode='detail'] .hole-sub`에 `max-width`와 `text-overflow: ellipsis`를 줍니다.

## 2. 백업과 복원의 버튼이 화면 밖으로 밀림 (375×553)

- 증상: 메뉴에서 "백업과 복원"을 열면 "백업 파일 저장"과 "가져오기"의 아래 끝이 553.98px입니다(화면은 553px). iPhone에만 보이는 "백업 파일 공유"는 y=562에 있어 통째로 화면 밖입니다. 메뉴 시트는 스크롤 0에 머뭅니다.
- 측정

  | | Chromium | WebKit |
  |---|---|---|
  | 안내 문단 | 4줄, 75.4px | 5줄, 94.2px |
  | 저장·가져오기 줄의 위 / 아래 | 475.6 / 535.1 | 494.5 / 554.0 |
  | `#backup-share` | 숨김(Web Share 없음) | 보임, y=562 |
  | 메뉴 `scrollHeight` / 보이는 높이 | 764 / 487 | 839 / 487 |

- 원인
  - 1번과 같은 글자 폭 차이로 문단이 한 줄 늘었습니다. WebKit에서 `canShare`를 없애 공유 버튼을 숨겨도 저장 버튼 아래 끝은 553.98px 그대로입니다.
  - iPhone은 파일 공유를 지원하므로(`canShareFiles()`가 참) 버튼이 하나 더 생깁니다. Chromium 테스트에는 이 버튼이 나오지 않습니다.
  - 메뉴는 펼친 패널을 화면 안으로 스크롤하지 않습니다.
- 영향: iPhone SE에서는 iOS다운 백업 경로인 공유 시트("파일에 저장", 메신저)가 스크롤해야 보입니다. 백업은 7일 규칙(아래)을 막는 유일한 수단입니다.
- 제안
  - `src/main.ts`의 메뉴 펼치기(`openItem()`): 패널을 연 뒤 `panel.scrollIntoView({ block: 'nearest' })`로 보이게 합니다. 줄인 움직임 설정이면 즉시 이동합니다.
  - `src/backup-view.ts`: 안내 문단을 줄이거나 버튼 아래로 옮깁니다.
  - 공유가 되는 기기(iPhone)에서는 "백업 파일 공유"를 앞에 둘지 정합니다. 결정이 필요합니다.

## 3. 홀 그림에 깃발이 없음 (390×664)

- 증상: `#course .flag`가 0개입니다.
- 측정: 390×664에서는 `#hole-info` 아래 끝이 106, `#sheet` 위 끝이 136이라 띠가 30 − 6 = 24px입니다. `courseShape()`(`src/course-art.ts`)는 띠가 30px 이상일 때만 깃발을 그립니다(`pin: band >= 30 ? … : null`).
- 원인: 이 테스트는 기본 프로젝트의 Desktop Chrome 1280×720에서만 깃발이 나옵니다. 같은 iPhone 13 프로필을 Chromium에 돌려도 똑같이 실패합니다(그 대조 실행의 유일한 실패). WebKit 문제가 아닙니다.
- 영향: iPhone Safari 높이(iPhone 13·14 664px, SE 553px)에서는 깃발이 그려지지 않습니다. 그린은 그대로 보입니다.
- 제안: 결정이 필요합니다.
  - 휴대폰에서도 깃발을 보이게 하려면 `courseShape()`의 기준을 낮춥니다(예: 띠 22px부터 기둥 18px).
  - 지금 동작이 의도라면, 테스트가 뷰포트를 직접 정해서(`test.use({ viewport })`) 프로젝트 기본값에 기대지 않게 합니다.

## 4. 결과 복사 테스트가 시작하자마자 실패

- 증상: `browserContext.grantPermissions: Unknown permission: clipboard-write`
- 확인
  - WebKit에서 공유를 지우고 "결과 복사"를 누르면 "결과를 복사했습니다…"가 나옵니다. 앱의 복사는 동작합니다.
  - 다만 `page.evaluate`에서 `navigator.clipboard.readText()`를 부르면 WebKit이 `NotAllowedError`로 거절합니다. 사용자 동작이 아니기 때문입니다.
  - 실제 iPhone에는 `navigator.share`가 있어서 버튼이 "공유하기"이고, 복사는 대체 경로입니다.
- 원인: 테스트가 Chromium 전용 권한과 읽기 방식에 기댑니다.
- 제안(테스트, `tests/e2e.spec.ts`)
  - 권한 부여는 `browserName === 'chromium'`일 때만 합니다.
  - 복사한 글은 `readText()` 대신, init script에서 `navigator.clipboard.writeText`를 감싸 기록한 다음 원래 함수를 부르는 방식으로 확인합니다. 두 엔진에서 같게 동작합니다.

## 해결함: Playwright 스크린샷이 CSP 오류를 남김

- 증상: 첫 실행에서 실패한 테스트마다 콘솔에 `Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive…`가 찍혔습니다. `afterEach`의 콘솔 오류 검사가 이를 앱 오류로 잡았습니다. `:1553` 백업 테스트는 다른 검사가 모두 통과했는데도 실패했습니다.
- 원인
  - Playwright는 스크린샷 때 커서를 숨기려고 `<style>`을 넣습니다. WebKit은 이것에도 페이지 CSP(`style-src 'self'`)를 적용해 막고 오류를 남깁니다. Chromium에서는 이 오류가 나지 않습니다.
  - 실패 스크린샷은 `afterEach`보다 먼저 찍힙니다. 테스트 중에 닫는 컨텍스트(`fresh.close()`)도 미리 찍어 두므로, 백업 테스트는 늘 실패했습니다.
  - trace에서 보면 오류는 `fresh.close()`와 "After Hooks" 시작 시점에만 납니다.
- 확인: 스크린샷만 끄고 다시 돌리면 `:1553`이 통과하고 CSP 오류가 사라집니다.
- 조치: `playwright.webkit.config.ts`에서 `screenshot: 'off'`, `trace: 'retain-on-failure'`로 설정했습니다. 앱의 CSP는 그대로 둡니다.

## WebKit에서 통과한 것

63개가 통과했습니다. 그중 iOS에서 특히 걱정했던 것은 다음과 같습니다.

- 서비스 워커: 오프라인 재실행, 새 버전 알림과 다시 열기
- 백업 파일: 다운로드(`<a download>` + blob)와 파일 선택으로 가져오기
- `<dialog>`(`showModal`) 시트, 홀 안내, `confirm()` 확인
- 날짜: `page.clock`으로 자정이 지나는 경우
- 360px 폭에서 가로 스크롤 없음, `tap()` 동작
- 외부 요청 없음, 다른 저장소 안 씀

## 테스트로 볼 수 없는 iOS 위험 (실기기 확인 필요)

Playwright WebKit은 iOS Safari와 엔진은 같지만 macOS 빌드입니다. 다음은 흉내 내지 못합니다.

- 안전 영역: `env(safe-area-inset-*)`가 늘 0입니다.
- 실제 터치 이동: `tap()`만 있고, 스와이프·길게 누르기 테스트는 마우스 포인터로 돕니다. `navigator.maxTouchPoints`도 0입니다.
- 홈 화면 모드, 7일 저장소 규칙, Wake Lock의 실제 동작

| 항목 | 지금 앱 | 위험 | 제안 | 심각도 |
|---|---|---|---|---|
| 7일 저장소 삭제 (Safari 탭) | 모든 기록이 localStorage에 있음. `navigator.storage.persist()`를 부르지 않음(WebKit에 함수는 있고 `persisted()`는 false). 홈 화면 카드(`#home-card`)가 7일 규칙을 설명하고, v10에 백업 알림이 있음 | 한 달에 한두 번 치는 골퍼가 Safari 탭으로만 쓰면 지난 라운드가 지워질 수 있음 | 첫 라운드를 보관할 때 `persist()`를 요청하고 결과를 남김. 다만 이것이 7일 규칙까지 피하는지는 확실하지 않으니, 확실한 방법은 홈 화면 추가. 메뉴에 "마지막 백업 N일 전"을 보이고, Safari 탭(standalone 아님)에서는 홈 화면 안내를 더 일찍 | 높음 |
| 진동 | `navigator.vibrate`가 없음(WebKit에서 undefined 확인). 앱은 `navigator.vibrate?.()`로 불러 오류는 없음 | iPhone에서는 탭할 때 햅틱이 없음 | 지금의 시각 피드백(숫자 강조, 배지 애니메이션)으로 충분. 비표준 햅틱 우회는 권하지 않음 | 낮음 |
| 화면 꺼짐 방지 | `navigator.wakeLock`이 있음. `keepScreenOn()`(`src/wake.ts`)은 실패하면 조용히 넘어가고 화면이 다시 보이면 다시 요청 | iOS 18.4 전의 홈 화면 앱에서는 Wake Lock이 동작하지 않았고(18.4에서 수정), 저전력 모드에서도 막힘. 라운드 중 화면이 꺼질 수 있음 | 요청이 실패하면 한 번만 "설정 › 디스플레이 및 밝기 › 자동 잠금" 안내. iOS 18.4 이후의 홈 화면 앱과 Safari에서 확인 | 중간 |
| 스와이프·길게 누르기 | `#entry`에 `touch-action: pan-y pinch-zoom`. pointer 이벤트와 `pointercancel` 처리. `.pill`에 `-webkit-touch-callout: none` | 실제 터치에서 좌우 스와이프로 홀 이동, 500ms 길게 눌러 숫자 고르기, 확대경·복사 메뉴가 안 뜨는지는 기기에서만 확인 가능 | iPhone에서 직접 확인 | 중간 (확인 필요) |
| 안전 영역·상태 막대 | `viewport-fit=cover`와 `env(safe-area-inset-*)`. `apple-mobile-web-app-status-bar-style`은 없음 | 홈 화면 모드의 상태 막대가 기본(불투명)이라 초록 머리와 색이 다를 수 있음. 노치·홈 표시줄 여백은 기기에서만 보임 | 기기에서 본 뒤 `black-translucent`를 검토(`index.html`) | 낮음 |
| 백업 파일 저장 (홈 화면 모드) | `<a download>` + blob | Safari 탭에서는 다운로드를 확인한 뒤 파일 앱 › 다운로드에 저장됨. 홈 화면 모드에서는 다르게 동작할 수 있음 | 기기에서 확인하고, iPhone에서는 공유 시트를 먼저 보이게 함(2번) | 중간 |

## 실기기 시험: 홈 화면 앱의 기록이 7일 넘게 남는가 (v43)

Playwright로는 볼 수 없어 iPhone에서 직접 합니다. 결과는 이 문서에 날짜와 함께 적습니다.

1. iPhone Safari에서 앱을 열고 공유 › 홈 화면에 추가.
2. 홈 화면 아이콘으로 열어 라운드 하나를 기록하고 지난 라운드에 보관. 백업은 하지 **않음**.
3. 메뉴 › 백업과 복원을 열어 아래 작은 글(브라우저가 저장소를 지우지 않기로 했는지)을 적어 둠.
4. 그 뒤 **8일 이상** 홈 화면 앱도 Safari 탭도 열지 않음(다른 웹사이트는 평소대로 써도 됨).
5. 8일 뒤 홈 화면 아이콘으로 열어: 지난 라운드에 라운드가 있으면 "남음", "저장된 기록을 찾지 못했어요"가 뜨면 "지워짐".
6. 같은 시험을 Safari 탭(홈 화면 추가 없이)으로 한 번 더 하면 비교가 됨.

| 날짜 | iOS | 방식 | 3의 문구 | 결과 |
|---|---|---|---|---|
| (기록 전) | | 홈 화면 | | |

## 다음 순서 제안

1. 2번: 백업 패널을 화면 안으로 스크롤하고 문구를 줄이고 iPhone 공유 버튼 자리를 정하기(`src/main.ts` `openItem()`, `src/backup-view.ts`)
2. 1번: 상세 모드에서 스위처가 배지를 넘으면 거리를 빼기(`src/main.ts`)
3. 7일 규칙: `persist()` 요청과 마지막 백업 표시(실기기 확인과 함께)
4. 4번 테스트를 엔진에 상관없이 돌게 고치기, 3번 깃발 정책 결정
5. 위 항목이 고쳐지면, CI(`.github/workflows/pages.yml`)에 WebKit 실행을 넣을지 정하기. 지금 그대로 넣으면 4건 때문에 배포가 막힙니다.
