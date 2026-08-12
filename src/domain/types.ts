import type { CellState, ReviewReason } from '../config/model';
import type { FamilyId } from '../config/taxonomy';
import type { DefectPatternId } from './causes';
import type { MetricId, SpecSetting } from './metrology';

/**
 * 64칸 웨이퍼 맵 — 모델이 먹는 형태.
 * 각 원소는 0(웨이퍼 밖) / 1(정상 die) / 2(불량 die).
 * 하드웨어가 읽는 아날로그 값은 ScanFrame.raw / .values에 따로 남는다.
 */
export type WaferMap = CellState[];

/** 스캔 한 스텝 = MUX 채널 하나를 열고 ADC 한 번 읽는 것 */
export interface ScanStep {
  index: number;
  row: number;
  col: number;
  /** 몇 번째 CD4067인가 */
  muxIndex: number;
  /** 그 MUX 안에서 S0~S3 주소 (0~15) */
  channel: number;
}

export type ScanPhase = 'idle' | 'latch' | 'scan' | 'transfer' | 'infer' | 'done' | 'error';

export interface ScanProgress {
  phase: ScanPhase;
  /** 지금까지 읽은 셀 수 */
  read: number;
  total: number;
  message: string;
}

/** 하드웨어에서 돌아온 원시 프레임 */
export interface ScanFrame {
  /** 모델 입력 — 0/1/2 카테고리 (측정값을 스펙과 대조해 판정한 결과) */
  cells: WaferMap;
  /**
   * 지점별 측정값 (선택한 지표의 단위). 웨이퍼 밖·미측정 지점은 null.
   * 이게 실제 계측이 내놓는 것이고, 셀 상태는 여기에 스펙을 적용해 나온다.
   */
  measurements: (number | null)[];
  /** 0~1로 정규화한 센서 전압 (raw / ADC_MAX) */
  values: number[];
  /** ADC 원시값 */
  raw: number[];
  /** 이 프레임을 만든 지표와 스펙 — 나중에 이력에서 다시 볼 때 필요하다 */
  metricId: MetricId;
  spec: SpecSetting;
  /** 실제 걸린 시간 (ms) */
  elapsedMs: number;
  /** Mock인지 실제 장비인지 */
  source: 'mock' | 'device';
  capturedAt: number;
}

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
  /** 보조 모델(V3) 결과 — 실제 모델 연결 시 채워진다 */
  auxiliary?: {
    used: boolean;
    binaryDefectScore: number | null;
    prediction: DefectPatternId | null;
    score: number | null;
  };
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
  lotId: string;
  waferNo: number;
  capturedAt: number;
  map: WaferMap;
  /** 지점별 측정값 — 없으면 구버전 기록 */
  measurements?: (number | null)[];
  metricId?: MetricId;
  spec?: SpecSetting;
  verdict: Verdict;
  elapsedMs: number;
  source: 'mock' | 'device';
  /** 엔지니어가 체크한 점검 항목 id들 */
  checkedActions: string[];
  /** 엔지니어가 남긴 결론 */
  resolution?: string;
}
