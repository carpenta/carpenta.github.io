# Tabula — 데이터 파일 뷰어

Parquet, Arrow IPC, Avro 파일을 서버에 올리지 않고 브라우저에서 표로 열어 보는 정적 웹 앱입니다. 스키마와 메타데이터(row group, 컬럼 통계, 코덱)도 함께 보여 줍니다. TypeScript + Vite로 만들었고 백엔드·계정·분석 도구가 없습니다.

## 실행

Node.js 22.12 이상이 필요합니다. 테스트 파일을 만드는 스크립트는 zstd 압축 때문에 Node 22.15 이상이 필요합니다.

```sh
npm ci
npm run dev
```

배포 빌드 확인:

```sh
npm run build
npm run preview -- --port 4174 --strictPort
```

주소: http://127.0.0.1:4174

`npm run dev`와 `npm run build`는 먼저 `scripts/generate-sample.mjs`로 샘플 파일(`public/sample/sample.parquet`, 가짜 이벤트 5,000행)을 만듭니다. 이 파일은 커밋하지 않습니다.

## 기능과 제한

- 파일 선택 또는 끌어다 놓기로 엽니다. 형식은 확장자가 아니라 파일 앞의 매직 바이트로 판별하므로, 확장자가 없는 파일(예: Spark의 `part-…`)도 열 수 있습니다.
- 지원 형식
  - Parquet: 압축 UNCOMPRESSED, SNAPPY, GZIP, BROTLI, ZSTD, LZ4, LZ4_RAW
  - Arrow IPC: file 형식(`.arrow`, `.feather` v2)과 stream 형식. 버퍼 압축 LZ4_FRAME, ZSTD
  - Avro object container file: 코덱 null, deflate, snappy, zstandard
- 화면
  - 왼쪽: 컬럼 목록. 체크한 컬럼만 표에 나옵니다. struct는 펼쳐 하위 필드를 볼 수 있습니다.
  - 오른쪽: 한 번에 100행씩 보여 주는 표. 이전·다음 버튼과 행 번호로 이동합니다.
  - 셀을 누르면 전체 값을 보고 복사할 수 있습니다.
  - 현재 페이지를 CSV나 JSON으로 저장할 수 있습니다. CSV에서 NULL은 빈 칸, 빈 문자열은 `""`입니다. 64 KB가 넘는 바이너리 값은 앞 64 KB만 담습니다.
- 큰 파일
  - 파일 전체를 읽지 않고, 메타데이터와 보이는 페이지만 읽습니다.
  - 위쪽 막대의 "읽은 양"이 지금까지 파일에서 읽은 바이트입니다.
  - Parquet은 체크한 컬럼과 해당 row group만 읽고, 어느 행이든 바로 갑니다.
  - Avro는 블록 헤더만 읽으며 건너뜁니다.
  - 한 페이지를 읽는 데 512 MB가 넘게 필요하면 멈추고 컬럼을 줄이라고 알립니다.
- 값 표시
  - int64·uint64는 정밀도를 잃지 않고 그대로 보여 줍니다.
  - decimal은 스케일을 적용한 정확한 10진수로 보여 줍니다.
  - timestamp는 단위(ms·μs·ns)의 자릿수를 모두 보여 줍니다. 시간대가 있는 값은 UTC로 표시합니다.
  - NULL, 빈 문자열(`""`), 빈 리스트(`[]`)를 서로 다르게 보여 줍니다.
  - float32는 float64로 넓힐 때 생기는 꼬리 없이 보여 줍니다(`0.1`).
  - JSON 내보내기에서 int64와 decimal은 항상 문자열입니다.
  - Parquet 메타데이터의 decimal 컬럼 min/max는 비워 둡니다. 읽는 라이브러리가 통계를 정밀도 낮은 숫자로 바꿔 주기 때문입니다.
- 제한
  - ORC는 지원하지 않습니다.
  - SQL 질의, 파일 전체를 대상으로 한 정렬·필터는 없습니다. 둘러보기 전용입니다.
  - Arrow는 batch를 앞에서부터 차례로 읽습니다. 뒤로 가면 처음부터 다시 읽습니다. 페이지가 batch 경계에서 끝나면 다음 페이지를 요청할 때 끝인지 알게 됩니다.
  - Avro와 Arrow는 메타데이터에 행 수가 없습니다. "전체 행 수 세기"를 누르면 끝까지 훑어서 셉니다.
  - 여러 파일이나 폴더(파티션 디렉터리)를 한꺼번에 열 수 없고, URL이나 S3에서도 열 수 없습니다.
  - 화면 문구는 한국어만 있습니다.
- 최신 Chrome·Edge에서 검증했습니다.

## 개인정보 경계

파일은 File API로 읽어 Web Worker에 넘기고, worker는 `Blob.slice()`로 필요한 구간만 읽습니다. 파일 내용, 파일 이름, 열람 기록을 서버로 보내지 않습니다. localStorage, sessionStorage, IndexedDB, 쿠키에도 저장하지 않습니다.

CSP 메타 태그가 같은 출처 밖으로 나가는 요청을 막습니다. 압축 해제 라이브러리와 WASM은 모두 번들에 들어 있습니다. 파일을 닫거나 바꾸면 worker를 종료합니다. 브라우저·운영체제의 메모리나 캐시 동작까지 제어하는 보안 삭제 도구는 아닙니다.

## 검증

```sh
npm test
npx playwright install chromium
npm run test:e2e -- --workers=1
```

- 단위 테스트(Vitest)
  - 값 표시: 음수 epoch, 나노초, decimal, INT96, 2의 보수
  - 형식 판별과 읽은 바이트 계측
  - Avro 디코더: 모든 원시·복합·논리 타입, 코덱 4종, 블록 건너뛰기, 잘린 파일
  - Parquet reader: 코덱 5종, 중첩 타입, 컬럼 선택, row group 단위 접근, 예산
  - Arrow reader: file·stream 형식, ZSTD·LZ4 압축, batch 경계
  - LZ4 frame 해제
  - worker 프로토콜과 취소
  - CSV·JSON 내보내기
- e2e(Playwright Chromium)
  - 네 형식 열기, 페이지 이동, 컬럼 선택·검색
  - 셀 팝오버, 메타데이터 서랍
  - 큰 파일에서 읽은 양, 행 수 세기와 닫기
  - 손상·미지원 파일, 샘플, 내보내기
  - 외부 요청·저장소 사용 없음, 360px 폭에서 가로 스크롤 없음
- 테스트 파일은 `tests/generate-fixtures.mjs`가 결정적인 값으로 만듭니다(`tests/fixtures/generated/`, 커밋하지 않음). 개인 데이터를 넣지 않습니다.
- Parquet LZ4 계열과 INT96 컬럼은 Node용 작성 도구가 없어 파일 단위 테스트가 없습니다. INT96 값의 변환은 hyparquet에 맡기고, 통계(min/max)의 INT96 변환만 단위 테스트로 확인합니다.

## 배포

이 도구는 `carpenta.github.io` 저장소의 `tools/tabula/`에 있고, `https://carpenta.github.io/tools/tabula/`로 서비스됩니다. 저장소 루트의 `.github/workflows/pages.yml`이 테스트와 빌드를 실행한 뒤 사이트와 함께 배포합니다. `base: './'`이므로 하위 경로에서 그대로 동작합니다.

설계는 [docs/DESIGN.md](docs/DESIGN.md), 의존성 출처는 [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md)를 참조하세요.
