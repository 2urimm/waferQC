import type { CellState, ReviewReason } from '../config/model';
import type { FamilyId } from '../config/taxonomy';
import type { DefectPatternId } from './causes';

/**
 * 64칸 웨이퍼 맵 — 모델이 먹는 형태.
 * 각 원소는 0(웨이퍼 밖) / 1(정상 die) / 2(불량 die).
 */
export type WaferMap = CellState[];

/** 8x8에서 뽑아내는 공간 통계. 판정 근거로 그대로 UI에 노출된다. */
export interface WaferFeatures {
  /** 불량(2)으로 표시된 칸 수 */
  defectCount: number;
  /** 웨이퍼 안(1 또는 2) 칸 수 */
  waferCellCount: number;
  /** 웨이퍼 안 칸 대비 불량 비율 */
  defectRatio: number;
  /** 결함 무게중심의 정규화 반경 (0=중심, 1=가장자리) */
  radialCentroid: number;
  /** 반경 4구간별 결함 밀도 */
  radialProfile: number[];
  /** 반경 프로파일의 최대 구간 인덱스 (0=최내측, 3=최외측) */
  peakRadialBin: number;
  /** 외곽 링 결함 / 전체 결함 */
  edgeShare: number;
  /** 내부 코어 결함 / 전체 결함 */
  coreShare: number;
  /** 8-연결 군집 개수 */
  clusterCount: number;
  /** 최대 군집 크기 / 전체 결함 */
  largestClusterShare: number;
  /** 최대 군집 크기 (셀) */
  largestClusterSize: number;
  /** 외곽 결함의 각도 분산 (0=한쪽에 몰림, 1=링 전체에 고름) */
  edgeAngularSpread: number;
  /** 전체 결함의 각도 분산 (0=한 방향에 몰림, 1=중심을 빙 둘러쌈) */
  defectAngularSpread: number;
  /** 최대 군집의 이방성 (0=덩어리, 1=완전 직선) */
  clusterAnisotropy: number;
  /** 최대 군집 무게중심의 정규화 반경 */
  largestClusterRadius: number;
  /** 최대 군집이 놓인 방위 (시 방향, 1~12). 노치를 6시로 놓은 기준. */
  largestClusterClock: number;
  /** 외곽 결함이 가장 몰린 방위 (시 방향, 1~12) */
  edgeDominantClock: number;
}

export interface FamilyScore {
  id: FamilyId;
  /** 이 계통에 속한 클래스 확률의 합 */
  probability: number;
}

/** 모델이 내는 9클래스 중 하나 */
export interface PatternCandidate {
  id: DefectPatternId;
  /** 모델 확률 (9클래스 softmax) */
  probability: number;
  /** 소속 계통 안에서의 상대 비중 */
  withinFamily: number;
  /** 왜 이 순위인지 — 실제 피처 값을 인용한다 */
  reason: string;
}

/** 사람 검토가 필요한가 — 모델 정책이 내는 판단 */
export interface ReviewDecision {
  required: boolean;
  reasons: ReviewReason[];
  /** 검토가 필요 없을 때의 근거 한 줄 */
  note?: string;
}

export interface Verdict {
  /** 모델의 9클래스 1순위 */
  top: DefectPatternId;
  topScore: number;
  /** 9클래스 전체 확률 */
  patterns: PatternCandidate[];
  /** 계통으로 묶은 확률 (UI 헤드라인) */
  family: FamilyId;
  familyScores: FamilyScore[];
  /** 사람 검토 여부 */
  review: ReviewDecision;
  features: WaferFeatures;
  /** 어떤 피처가 판정을 밀었는지 */
  drivers: FeatureDriver[];
  /** 판정을 신뢰하기 어려운 조건들 */
  caveats: string[];
  /** 어디서 나온 판정인가 */
  engine: 'rule-mock' | 'model';
  engineVersion: string;
  inferMs: number;
  /** 실제 모델(WaferCNNV2 + V3)이 낸 값 — 규칙 대체판에는 없다 */
  model?: ModelOutput;
}

/**
 * 실제 모델 서버가 돌려주는 것들.
 * 규칙 대체판이 흉내 낼 수 없는 값이라 별도 블록으로 둔다 — 있으면 실제 모델,
 * 없으면 대체판이라는 게 타입만 봐도 드러나야 한다.
 */
export interface ModelOutput {
  /** 모델 정책의 최종 판단 */
  status: 'ACCEPT' | 'REVIEW';
  /** 1순위 클래스에 적용된 임계값. 1.01이면 확률이 넘을 수 없어 항상 REVIEW다. */
  classThreshold: number;
  /** 보조 모델 V3 */
  auxiliaryPrediction: DefectPatternId | null;
  auxiliaryScore: number | null;
  v3DefectScore: number | null;
  v3BinaryThreshold: number | null;
  /** 불량으로 판정된 칸 수 (모델이 직접 센 값) */
  defectCellCount: number;
  /**
   * 사분면 방향 — Scratch / Loc / Edge-Loc 에만 나온다.
   * row 0 = 위, col 0 = 왼쪽 기준이며, 하드웨어 배선이 반전돼 있으면 반대로 나온다.
   */
  direction: string | null;
  directionConfidence: number | null;
  directionMethod: string | null;
  quadrantCounts: Record<string, number> | null;
}

export interface FeatureDriver {
  feature: keyof WaferFeatures;
  label: string;
  value: string;
  effect: 'supports' | 'against' | 'neutral';
  note: string;
}

/** 한 번의 검사 기록 */
export interface Inspection {
  id: string;
  /** 불량 대응 Log의 관리번호 — 대장에서 온 시드 기록에만 있다 */
  caseId?: string;
  /** 대장이 지목한 원인 (CAUSE_MATRIX id) */
  causeId?: string;
  lotId: string;
  waferNo: number;
  capturedAt: number;
  map: WaferMap;
  verdict: Verdict;
  /** 추론에 걸린 시간 (ms) */
  elapsedMs: number;
  /** 엔지니어가 체크한 점검 항목 id들 */
  checkedActions: string[];
  /** 엔지니어가 남긴 결론 */
  resolution?: string;
}
