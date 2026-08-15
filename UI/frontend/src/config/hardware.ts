/**
 * 웨이퍼 맵 격자 상수.
 *
 * 8×8(64칸)은 모델 패키지(backend/wafer_final_package)의 입력 형상이다 —
 * config/model.ts의 MODEL_GRID와 같은 값이어야 한다.
 */

/** 웨이퍼 맵 격자. 64칸 = 8 x 8 */
export const GRID_ROWS = 8;
export const GRID_COLS = 8;
export const CELL_COUNT = GRID_ROWS * GRID_COLS;

/** 셀 (row, col)의 정규화 반경 (0 = 중심, 1 = 웨이퍼 가장자리) */
export function normalizedRadius(row: number, col: number): number {
  const cx = GRID_COLS / 2;
  const cy = GRID_ROWS / 2;
  const dx = col + 0.5 - cx;
  const dy = row + 0.5 - cy;
  return Math.hypot(dx, dy) / (GRID_COLS / 2);
}

/** 원형 웨이퍼 안에 드는 셀인지 — 실제 웨이퍼는 원형이라 정사각 격자의 네 모서리는 밖이다 */
export function isInsideWafer(row: number, col: number): boolean {
  return normalizedRadius(row, col) <= 1;
}
