export interface Point {
  x: number;
  y: number;
}

/** 4개의 모서리 점: [Top-Left, Top-Right, Bottom-Right, Bottom-Left] */
export type QuadPoints = [Point, Point, Point, Point];

export interface FilterOptions {
  grayscale?: boolean;
  contrast?: number; // 1.0 = normal, >1.0 = higher contrast
  binarize?: boolean;
  threshold?: number; // 0 - 255
}
