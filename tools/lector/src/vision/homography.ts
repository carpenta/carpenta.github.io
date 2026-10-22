import type { Point, QuadPoints } from './types';

/** 3x3 변환 행렬 (행 우선 1차원 배열 9개 요소) */
export type Matrix3x3 = [
  number, number, number,
  number, number, number,
  number, number, number
];

/**
 * 4개의 원본 좌표와 4개의 대상 좌표 사이의 3x3 호모그래피(원근 투영) 행렬을 계산합니다.
 * 대상 좌표(u, v)에 호모그래피 역행렬을 곱하면 원본 좌표(x, y)를 얻습니다.
 */
export function findHomography(src: QuadPoints, dst: QuadPoints): Matrix3x3 | null {
  // 8x8 선형 방정식 시스템: A * h = b
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }

  // Gaussian elimination with partial pivoting
  const n = 8;
  for (let i = 0; i < n; i++) {
    // 피벗 선택
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
        maxRow = k;
      }
    }

    if (Math.abs(A[maxRow][i]) < 1e-10) {
      return null; // 특이 행렬
    }

    // 행 교환
    const tempA = A[i];
    A[i] = A[maxRow];
    A[maxRow] = tempA;

    const tempB = b[i];
    b[i] = b[maxRow];
    b[maxRow] = tempB;

    // 소거
    for (let k = i + 1; k < n; k++) {
      const factor = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) {
        A[k][j] -= factor * A[i][j];
      }
      b[k] -= factor * b[i];
    }
  }

  // 후진 대입 (Back substitution)
  const h = new Array(8).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) {
      sum -= A[i][j] * h[j];
    }
    h[i] = sum / A[i][i];
  }

  return [
    h[0], h[1], h[2],
    h[3], h[4], h[5],
    h[6], h[7], 1.0
  ];
}

/** 3x3 행렬의 역행렬을 구합니다. */
export function invertMatrix3x3(m: Matrix3x3): Matrix3x3 | null {
  const [
    a, b, c,
    d, e, f,
    g, h, i
  ] = m;

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) {
    return null; // 역행렬 없음
  }

  const invDet = 1.0 / det;

  return [
    A * invDet,
    -(b * i - c * h) * invDet,
    (b * f - c * e) * invDet,

    B * invDet,
    (a * i - c * g) * invDet,
    -(a * f - c * d) * invDet,

    C * invDet,
    -(a * h - b * g) * invDet,
    (a * e - b * d) * invDet
  ];
}

/** 3x3 변환 행렬을 점에 적용합니다. */
export function transformPoint(m: Matrix3x3, p: Point): Point {
  const x = p.x;
  const y = p.y;
  const w = m[6] * x + m[7] * y + m[8];
  if (Math.abs(w) < 1e-12) {
    return { x: 0, y: 0 };
  }
  return {
    x: (m[0] * x + m[1] * y + m[2]) / w,
    y: (m[3] * x + m[4] * y + m[5]) / w,
  };
}
