# Lector — 문서 OCR & 텍스트 추출기

PDF 문서와 카메라 촬영 문서를 서버에 올리지 않고 브라우저에서 분석하고 텍스트 및 양식 데이터를 추출하는 정적 웹 도구입니다. TypeScript + Vite로 제작되었으며 백엔드 서버, 사용자 계정, 외부 추적 도구가 일절 없습니다.

## 실행

Node.js 22.12 이상이 필요합니다.

```sh
npm ci
npm run dev
```

배포 빌드 확인:

```sh
npm run build
npm run preview -- --port 4175 --strictPort
```

주소: http://127.0.0.1:4175

`npm run dev`와 `npm run build`는 `scripts/setup-assets.mjs`를 통해 Tesseract WASM 코어와 한/영 사전 데이터를 `public/tessdata/`로 자동 배치합니다. 이 데이터 파일들은 git에 커밋되지 않습니다.

## 기능과 제한

- **파일 선택 또는 끌어다 놓기**: PDF 문서(`*.pdf`) 및 이미지 파일(`*.png`, `*.jpg`, `*.jpeg`, `*.webp`)을 지원합니다.
- **스마트 PDF 추출**: 디지털 텍스트 레이어가 있는 전자 PDF는 OCR을 거치지 않고 0.05초 만에 원문 텍스트를 즉시 추출합니다. 스캔된 페이지만 고해상도 Canvas로 렌더링하여 OCR로 전달합니다.
- **카메라 원근 왜곡 보정**: 스마트폰으로 삐뚤어지게 촬영된 문서를 4점 조절 핀을 통해 반듯한 평면 직사각형으로 폅니다(순수 TS 호모그래피 투영 행렬 연산).
- **이미지 전처리 필터**: 흑백(Grayscale), 명암 대비 조절, 오츠(Otsu) 자동 임계값 이진화 필터를 제공하여 저화질 문서의 OCR 인식률을 향상시킵니다.
- **양식 템플릿(ROI) 추출**:
  - 문서 위에서 원하는 영역을 드래그하여 필드(예: 등록번호, 대표자, 합계금액)를 지정합니다.
  - 숫자 전용, 영문+숫자 등 필드별 화이트리스트 규칙을 적용하여 오인식을 최소화합니다.
  - 작성된 템플릿 좌표를 JSON으로 저장하거나 불러올 수 있습니다.
  - 추출된 표 데이터를 CSV 또는 JSON으로 내보낼 수 있습니다.

## 개인정보 경계

- **외부 전송 0건**: 모든 문서 렌더링과 OCR 추론은 사용자 기기의 브라우저 내부(WASM + Web Worker)에서만 수행됩니다.
- 엄격한 CSP(Content Security Policy) 메타 태그가 적용되어 있어 외부 네트워크로의 모든 요청이 차단됩니다.
- 사용자의 파일 및 추출 데이터는 `localStorage`, `sessionStorage`, `IndexedDB`에 영구 저장되지 않고 창을 닫으면 즉시 소멸합니다.

## 검증

단위 테스트:
```sh
npm test
```

E2E 브라우저 테스트 (Playwright Chromium 필요):
```sh
npm run test:e2e
```
