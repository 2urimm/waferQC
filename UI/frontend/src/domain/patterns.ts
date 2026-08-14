import { CELL_COUNT, GRID_COLS, GRID_ROWS, isInsideWafer, normalizedRadius } from '../config/hardware';
import { CELL_DEFECT, CELL_NORMAL, CELL_OUTSIDE, type CellState } from '../config/model';
import type { WaferMap } from './types';

/**
 * 데모·검증용 프리셋 패턴.
 *
 * 사용자가 직접 그린 임의 패턴이 파이프라인을 통과하는 게 이 프로젝트의 요점이므로,
 * 프리셋은 "정답을 외운 데모"가 아니라 비교 기준으로만 쓴다.
 * 특히 '선형 스크래치'는 일부러 넣었다 — 8x8에서 Loc과 얼마나 갈리는지(혹은 안 갈리는지)를
 * 사용자가 직접 눌러 확인할 수 있어야 한다.
 *
 * 모든 프리셋은 모델 입력 형태(0=웨이퍼 밖, 1=정상 die, 2=불량 die)로 만든다.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 웨이퍼 형상만 잡힌 빈 맵 — 원 안은 정상 die(1), 밖은 0 */
export function blankWafer(): WaferMap {
  const m: WaferMap = new Array(CELL_COUNT).fill(CELL_OUTSIDE);
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (isInsideWafer(r, c)) m[r * GRID_COLS + c] = CELL_NORMAL;
    }
  }
  return m;
}

/** 웨이퍼 안이면 불량으로 찍는다 (밖이면 무시) */
function mark(m: WaferMap, r: number, c: number) {
  if (r < 0 || c < 0 || r >= GRID_ROWS || c >= GRID_COLS) return;
  const i = r * GRID_COLS + c;
  if (m[i] !== CELL_OUTSIDE) m[i] = CELL_DEFECT;
}

/** 배경 불량 — 어느 공정에나 있는 산발 결함 */
function speckle(m: WaferMap, rng: () => number, rate: number) {
  for (let i = 0; i < m.length; i++) {
    if (m[i] === CELL_NORMAL && rng() < rate) m[i] = CELL_DEFECT;
  }
  return m;
}

export interface PatternPreset {
  id: string;
  label: string;
  /** 이 프리셋으로 뭘 확인하는지 */
  intent: string;
  build: (seed: number) => WaferMap;
}

export const PATTERN_PRESETS: PatternPreset[] = [
  {
    id: 'normal',
    label: '정상',
    intent: '배경 산발만. 계통 패턴이 안 잡히는지 확인.',
    build: (seed) => speckle(blankWafer(), mulberry32(seed), 0.02),
  },
  {
    id: 'center',
    label: '중심부 (Center)',
    intent: '반경 무게중심이 안쪽으로 들어가고 최내측 구간이 차 있는지.',
    build: (seed) => {
      const rng = mulberry32(seed);
      const m = blankWafer();
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const rad = normalizedRadius(r, c);
          if (rad < 0.45) mark(m, r, c);
          else if (rad < 0.62 && rng() > 0.55) mark(m, r, c);
        }
      }
      return m;
    },
  },
  {
    id: 'donut',
    label: '도넛 (Donut)',
    intent: '가운데가 비고 중간 반경만 찬 모양. Center와 얼마나 갈리는지 보는 자리.',
    build: () => {
      const m = blankWafer();
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const rad = normalizedRadius(r, c);
          if (rad >= 0.45 && rad <= 0.78) mark(m, r, c);
        }
      }
      return m;
    },
  },
  {
    id: 'edge-ring',
    label: '가장자리 링 (Edge-Ring)',
    intent: '외곽 각도 분산이 1에 가깝게 나오는지.',
    build: () => {
      const m = blankWafer();
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          if (normalizedRadius(r, c) > 0.82) mark(m, r, c);
        }
      }
      return m;
    },
  },
  {
    id: 'edge-loc',
    label: '가장자리 국부 (Edge-Loc)',
    intent: '외곽인데 한쪽에만 몰린 경우. 방위가 원인 표의 6시 서명과 맞는지 보는 자리.',
    build: () => {
      const m = blankWafer();
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          // 노치 기준 6시(아래쪽) 외곽에만
          if (normalizedRadius(r, c) > 0.78 && r >= 5) mark(m, r, c);
        }
      }
      return m;
    },
  },
  {
    id: 'loc',
    label: '국부 (Loc)',
    intent: '단일 군집 점유율이 지배적이고 이방성은 낮은지.',
    build: () => {
      const m = blankWafer();
      for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) mark(m, 3 + dr, 2 + dc);
      mark(m, 5, 3);
      return m;
    },
  },
  {
    id: 'scratch',
    label: '스크래치 (Scratch)',
    intent: '대각 선형. 8-연결로 한 덩어리가 되고 이방성이 1에 가까운지.',
    build: () => {
      const m = blankWafer();
      for (let i = 0; i < 5; i++) mark(m, 1 + i, 2 + i);
      return m;
    },
  },
  {
    id: 'random',
    label: '무작위 (Random)',
    intent: '구조 없이 흩어졌을 때 군집 수가 올라가는지.',
    build: (seed) => {
      const rng = mulberry32(seed);
      const m = blankWafer();
      let placed = 0;
      let guard = 0;
      while (placed < 9 && guard++ < 500) {
        const r = Math.floor(rng() * GRID_ROWS);
        const c = Math.floor(rng() * GRID_COLS);
        const i = r * GRID_COLS + c;
        if (m[i] !== CELL_NORMAL) continue;
        m[i] = CELL_DEFECT;
        placed++;
      }
      return m;
    },
  },
  {
    id: 'near-full',
    label: '전면 (Near-full)',
    intent: '밀도가 임계를 넘고 최내측까지 차면 Near-full이 잡히는지.',
    build: (seed) => {
      const rng = mulberry32(seed);
      const m = blankWafer();
      for (let i = 0; i < m.length; i++) {
        if (m[i] === CELL_NORMAL && rng() > 0.1) m[i] = CELL_DEFECT;
      }
      return m;
    },
  },
];

/**
 * 모델 패키지 README의 예시 입력 8종.
 *
 * 팀이 실제 모델을 검증할 때 쓰는 입력이라 값을 한 칸도 바꾸지 않고 그대로 옮겼다.
 * 이걸로 웹 UI의 판정이 `python app.py --manual`과 같은 결과를 내는지 대조할 수 있다.
 * 두 경로가 다른 답을 내면 UI 쪽이 뭔가 잘못 보내고 있다는 뜻이다.
 *
 * 웨이퍼 형상(0의 배치)도 우리 원형 마스크와 같은 52칸이라 그대로 들어맞는다.
 */
const README_GRIDS: Array<[string, number[][]]> = [
  ['예시 1', [[0,0,1,1,1,1,0,0],[0,2,2,1,1,1,1,0],[1,1,2,2,1,1,1,1],[1,1,1,2,1,1,1,1],[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1],[0,1,1,1,1,1,1,0],[0,0,1,1,1,1,0,0]]],
  ['예시 2', [[0,0,1,1,1,1,0,0],[0,1,1,1,1,1,1,0],[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1],[1,1,1,1,1,2,2,1],[1,1,1,1,2,2,2,1],[0,1,1,1,2,2,2,0],[0,0,1,1,1,2,0,0]]],
  ['예시 3', [[0,0,1,1,1,2,0,0],[0,1,1,1,1,2,2,0],[1,1,1,1,1,1,2,2],[1,1,1,1,1,1,2,2],[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1],[0,1,1,1,1,1,1,0],[0,0,1,1,1,1,0,0]]],
  ['예시 4', [[0,0,1,1,1,1,0,0],[0,1,1,1,1,1,1,0],[1,1,1,1,1,1,1,1],[1,1,1,2,2,1,1,1],[1,1,1,2,2,1,1,1],[1,1,1,1,1,1,1,1],[0,1,1,1,1,1,1,0],[0,0,1,1,1,1,0,0]]],
  ['예시 5', [[0,0,2,2,2,2,0,0],[0,2,1,1,1,1,2,0],[2,1,1,1,1,1,1,2],[2,1,1,1,1,1,1,2],[2,1,1,1,1,1,1,2],[2,1,1,1,1,1,1,2],[0,2,1,1,1,1,2,0],[0,0,2,2,2,2,0,0]]],
  ['예시 6', [[0,0,2,1,1,2,0,0],[0,1,1,2,1,1,1,0],[1,2,1,1,1,2,1,1],[1,1,2,1,2,1,1,2],[2,1,1,2,1,1,2,1],[1,2,1,1,1,2,1,1],[0,1,2,1,2,1,1,0],[0,0,1,2,1,1,0,0]]],
  ['예시 7', [[0,0,2,2,2,2,0,0],[0,2,2,2,2,2,2,0],[2,2,2,2,2,2,2,2],[2,2,2,2,2,2,2,2],[2,2,2,2,2,2,2,2],[2,2,2,2,2,2,2,2],[0,2,2,2,2,2,2,0],[0,0,2,2,2,2,0,0]]],
  ['예시 8', [[0,0,1,1,1,1,0,0],[0,1,1,1,1,1,1,0],[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1],[0,1,1,1,1,1,1,0],[0,0,1,1,1,1,0,0]]],
];

export interface ReadmeExample {
  id: string;
  label: string;
  map: WaferMap;
  defectCells: number;
}

export const README_EXAMPLES: ReadmeExample[] = README_GRIDS.map(([label, grid], i) => {
  const map = grid.flat() as WaferMap;
  return {
    id: `readme-${i + 1}`,
    label,
    map,
    defectCells: map.filter((c) => c === CELL_DEFECT).length,
  };
});

export function buildPreset(id: string, seed = 4242): WaferMap {
  const readme = README_EXAMPLES.find((x) => x.id === id);
  if (readme) return readme.map.slice() as WaferMap;

  const p = PATTERN_PRESETS.find((x) => x.id === id);
  return p ? p.build(seed) : blankWafer();
}

/** 셀 상태를 다음 상태로 순환 (UI 클릭용). 웨이퍼 밖 칸은 건드리지 않는다. */
export function cycleCell(v: CellState): CellState {
  return v === CELL_NORMAL ? CELL_DEFECT : v === CELL_DEFECT ? CELL_NORMAL : CELL_OUTSIDE;
}
