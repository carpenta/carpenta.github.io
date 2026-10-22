/**
 * 사용자가 바로 테스트해 볼 수 있는 로컬 표준 거래명세표 샘플 캔버스를 생성합니다.
 * 외부 네트워크 호출 없이 100% 브라우저 메모리 상에서 벡터 캔버스로 그려집니다.
 */
export function createSampleDocumentCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  // 고해상도 A4 비율 (가로 1240, 세로 1754)
  canvas.width = 1240;
  canvas.height = 1754;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // 배경
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 문서 외곽 테두리 (약간의 여백)
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 3;
  ctx.strokeRect(60, 60, canvas.width - 120, canvas.height - 120);

  // 제목
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('거 래 명 세 표 (INVOICE)', canvas.width / 2, 140);

  ctx.textAlign = 'left';
  ctx.font = '22px sans-serif';
  ctx.fillText('문서번호: INV-2026-1022', 80, 210);
  ctx.fillText('발행일자: 2026-10-22', 80, 245);

  // 공급자 정보 박스
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(80, 280, canvas.width - 160, 160);

  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(81, 281, 180, 158);
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('공 급 자', 170, 365);

  ctx.textAlign = 'left';
  ctx.font = '22px sans-serif';
  ctx.fillText('등록번호: 123-45-67890', 290, 325);
  ctx.fillText('상    호: 호랑이얼굴 (Tigerface)', 290, 365);
  ctx.fillText('대 표 자: 조일환 (Il-hwan Cho)', 290, 405);
  ctx.fillText('업    태: 서비스 / 소프트웨어', 750, 325);
  ctx.fillText('소 재 지: 서울특별시 종로구', 750, 365);

  // 품목 테이블 헤더
  const tableY = 490;
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(80, tableY, canvas.width - 160, 45);
  ctx.strokeRect(80, tableY, canvas.width - 160, 45);

  ctx.fillStyle = '#111827';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('품목명 (Description)', 110, tableY + 30);
  ctx.fillText('수량 (Qty)', 600, tableY + 30);
  ctx.fillText('단가 (Unit Price)', 750, tableY + 30);
  ctx.fillText('금액 (Amount)', 950, tableY + 30);

  // 품목 행들
  const items = [
    { name: '브라우저 OCR 엔진 개발 컨설팅', qty: '1', price: '1,000,000', sum: '1,000,000' },
    { name: 'WASM 성능 최적화 워크숍', qty: '1', price: '350,000', sum: '350,000' },
    { name: '양식 템플릿(ROI) 규칙 설계', qty: '1', price: '150,000', sum: '150,000' },
  ];

  let currentY = tableY + 45;
  ctx.font = '20px sans-serif';

  for (const it of items) {
    ctx.strokeRect(80, currentY, canvas.width - 160, 50);
    ctx.fillText(it.name, 110, currentY + 32);
    ctx.fillText(it.qty, 630, currentY + 32);
    ctx.fillText(it.price, 750, currentY + 32);
    ctx.fillText(it.sum, 950, currentY + 32);
    currentY += 50;
  }

  // 합계 행
  ctx.fillStyle = '#f9fafb';
  ctx.fillRect(80, currentY, canvas.width - 160, 55);
  ctx.strokeRect(80, currentY, canvas.width - 160, 55);

  ctx.fillStyle = '#111827';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('합 계 금 액 (TOTAL)', 110, currentY + 36);
  ctx.fillStyle = '#b7791f';
  ctx.fillText('KRW 1,500,000 원정', 920, currentY + 36);

  // 비고 안내
  ctx.fillStyle = '#6b7280';
  ctx.font = '18px sans-serif';
  ctx.fillText('* 위 금액을 정히 영수(청구)합니다.', 80, currentY + 110);
  ctx.fillText('* Lector 로컬 브라우저 OCR 테스트용 자동 생성 샘플 문서입니다.', 80, currentY + 145);

  return canvas;
}
