import { GRID_COLS, GRID_ROWS, normalizedRadius } from '../config/hardware';
import { CELL_DEFECT, CELL_OUTSIDE } from '../config/model';
import type { WaferFeatures, WaferMap } from './types';

/**
 * 8x8 카테고리 맵에서 공간 통계를 뽑는다.
 *
 * 입력이 0/1/2 카테고리라 임계값이 여기엔 없다 — 불량 판정은 이미 앞단
 * (하드웨어 판독 → 카테고리 변환)에서 끝났다. 여기서는 "어디에 몰렸는가"만 본다.
 * 웨이퍼 밖(0) 칸은 분모에서 빠진다. 안 그러면 원형 웨이퍼의 모서리 12칸 때문에
 * 결함률이 실제보다 낮게 나온다.
 */

/** 반경 프로파일 구간 수. 8x8에서 반경 방향으로 의미 있게 쪼갤 수 있는 최대치. */
export const RADIAL_BINS = 4;

const idx = (row: number, col: number) => row * GRID_COLS + col;

/** 최외곽 링 (28칸) */
const isOuterRing = (row: number, col: number) =>
  row === 0 || col === 0 || row === GRID_ROWS - 1 || col === GRID_COLS - 1;

/** 내부 코어 4x4 (16칸) */
const isCore = (row: number, col: number) => row >= 2 && row <= 5 && col >= 2 && col <= 5;

/**
 * 셀의 방위를 시계 방향으로 환산한다 (노치를 6시로 놓는 관례).
 * 12시 = 위, 3시 = 오른쪽, 6시 = 아래, 9시 = 왼쪽.
 * 원본 원인 표의 "6시 하단 노치" 같은 방향성 서명과 직접 대조하기 위한 값이다.
 */
export function clockOf(row: number, col: number): number {
  const dx = col + 0.5 - GRID_COLS / 2;
  const dy = row + 0.5 - GRID_ROWS / 2;
  let theta = Math.atan2(dx, -dy);
  if (theta < 0) theta += Math.PI * 2;
  const h = Math.round((theta / (Math.PI * 2)) * 12);
  return h === 0 ? 12 : h;
}

export function extractFeatures(map: WaferMap): WaferFeatures {
  const inside: Array<{ row: number; col: number }> = [];
  const defects: Array<{ row: number; col: number; r: number }> = [];

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const v = map[idx(row, col)] ?? CELL_OUTSIDE;
      if (v === CELL_OUTSIDE) continue;
      inside.push({ row, col });
      if (v === CELL_DEFECT) defects.push({ row, col, r: normalizedRadius(row, col) });
    }
  }

  const waferCellCount = inside.length;
  const defectCount = defects.length;
  const defectRatio = waferCellCount ? defectCount / waferCellCount : 0;

  const radialCentroid = defectCount ? defects.reduce((s, d) => s + d.r, 0) / defectCount : 0;

  // 반경 구간별 밀도 (해당 구간 결함 수 / 해당 구간의 웨이퍼 안 셀 수)
  const binHit = new Array(RADIAL_BINS).fill(0);
  const binTotal = new Array(RADIAL_BINS).fill(0);
  for (const { row, col } of inside) {
    const r = Math.min(normalizedRadius(row, col), 0.999);
    const b = Math.min(RADIAL_BINS - 1, Math.floor(r * RADIAL_BINS));
    binTotal[b] += 1;
    if (map[idx(row, col)] === CELL_DEFECT) binHit[b] += 1;
  }
  const radialProfile = binHit.map((h, i) => (binTotal[i] ? h / binTotal[i] : 0));
  const peakRadialBin = radialProfile.reduce((best, v, i) => (v > radialProfile[best] ? i : best), 0);

  const edgeDefects = defects.filter((d) => isOuterRing(d.row, d.col));
  const edgeShare = defectCount ? edgeDefects.length / defectCount : 0;
  const coreShare = defectCount ? defects.filter((d) => isCore(d.row, d.col)).length / defectCount : 0;

  const { clusterCount, largest } = clusterStats(map);
  const largestClusterSize = largest.length;
  const largestClusterShare = defectCount ? largestClusterSize / defectCount : 0;

  return {
    defectCount,
    waferCellCount,
    defectRatio,
    radialCentroid,
    radialProfile,
    peakRadialBin,
    edgeShare,
    coreShare,
    clusterCount,
    largestClusterShare,
    largestClusterSize,
    edgeAngularSpread: angularSpread(edgeDefects),
    defectAngularSpread: angularSpread(defects),
    clusterAnisotropy: anisotropy(largest),
    largestClusterRadius: largest.length
      ? largest.reduce((s, c) => s + normalizedRadius(c.row, c.col), 0) / largest.length
      : 0,
    largestClusterClock: dominantClock(largest),
    edgeDominantClock: dominantClock(edgeDefects),
  };
}

/**
 * 8-연결 성분 분석. 최대 군집의 셀 목록까지 돌려준다 (이방성·방위 계산에 필요).
 *
 * 4-연결이 아니라 8-연결인 이유: 스크래치는 대개 비스듬하게 난다. 대각으로 이어진
 * 결함을 4-연결로 세면 한 줄짜리 긁힘이 낱개 군집 5개로 쪼개져, 군집 기반 판별이
 * 통째로 무너진다. 웨이퍼맵 군집 분석에서 8-연결을 쓰는 게 표준인 이유가 이거다.
 */
function clusterStats(map: WaferMap) {
  const seen = new Set<number>();
  let clusterCount = 0;
  let largest: Array<{ row: number; col: number }> = [];

  const passable = (r: number, c: number) =>
    r >= 0 && c >= 0 && r < GRID_ROWS && c < GRID_COLS && map[idx(r, c)] === CELL_DEFECT;

  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (!passable(r, c) || seen.has(idx(r, c))) continue;
      clusterCount += 1;
      const members: Array<{ row: number; col: number }> = [];
      const stack = [[r, c]];
      seen.add(idx(r, c));
      while (stack.length) {
        const [cr, cc] = stack.pop()!;
        members.push({ row: cr, col: cc });
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = cr + dr;
            const nc = cc + dc;
            if (passable(nr, nc) && !seen.has(idx(nr, nc))) {
              seen.add(idx(nr, nc));
              stack.push([nr, nc]);
            }
          }
        }
      }
      if (members.length > largest.length) largest = members;
    }
  }

  return { clusterCount, largest };
}

/**
 * 각도 분산 (원형 분산).
 * 0 = 한 방향에 몰려 있음, 1 = 중심을 빙 둘러쌈.
 * Edge-Loc/Edge-Ring을 클래스로 가르는 대신 수치로 내보내 엔지니어가 직접 읽게 한다.
 */
function angularSpread(cells: Array<{ row: number; col: number }>): number {
  if (cells.length < 2) return 0;
  const cx = GRID_COLS / 2;
  const cy = GRID_ROWS / 2;
  let sx = 0;
  let sy = 0;
  for (const d of cells) {
    const a = Math.atan2(d.row + 0.5 - cy, d.col + 0.5 - cx);
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  return 1 - Math.hypot(sx, sy) / cells.length;
}

/** 셀 무리의 평균 방위를 시 방향으로 (원형 평균이라 12시 근처에서 안 튄다) */
function dominantClock(cells: Array<{ row: number; col: number }>): number {
  if (!cells.length) return 0;
  let sx = 0;
  let sy = 0;
  for (const c of cells) {
    const theta = ((clockOf(c.row, c.col) % 12) / 12) * Math.PI * 2;
    sx += Math.cos(theta);
    sy += Math.sin(theta);
  }
  if (Math.hypot(sx, sy) < 1e-9) return 0;
  let theta = Math.atan2(sy, sx);
  if (theta < 0) theta += Math.PI * 2;
  const h = Math.round((theta / (Math.PI * 2)) * 12);
  return h === 0 ? 12 : h;
}

/**
 * 군집의 이방성 — 공분산 행렬 고유값 비.
 * 0 = 등방(덩어리), 1 = 완전 직선. Scratch와 Loc을 가르는 대신 내보내는 수치다.
 * 4칸 미만이면 방향을 논할 수 없어 0으로 둔다.
 */
function anisotropy(cells: Array<{ row: number; col: number }>): number {
  if (cells.length < 4) return 0;
  const n = cells.length;
  const mx = cells.reduce((s, c) => s + c.col, 0) / n;
  const my = cells.reduce((s, c) => s + c.row, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const c of cells) {
    const dx = c.col - mx;
    const dy = c.row - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n;
  syy /= n;
  sxy /= n;

  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  if (l1 <= 1e-9) return 0;
  return Math.max(0, Math.min(1, 1 - Math.max(0, l2) / l1));
}
