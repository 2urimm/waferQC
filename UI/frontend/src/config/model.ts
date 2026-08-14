import type { DefectPatternId } from '../domain/causes';
import type { FamilyId } from './taxonomy';

/**
 * 모델 계약.
 *
 * 출처: ConvNeXt_CNN.ipynb 가 내보내는 `final_hardware_inference_policy.json`.
 * 이 파일은 그 정책을 코드로 옮긴 것이고, UI 전체가 여기 있는 값만 보고 움직인다.
 * 모델 쪽에서 정책이 바뀌면 이 파일 하나만 갈아끼우면 된다.
 *
 * ⚠ 정책 JSON과 이 파일이 어긋나면 판정이 조용히 틀어진다. 모델 담당자가 재학습하면
 *   policy JSON을 받아 아래 값들을 대조할 것.
 */

/* ── 입력 ────────────────────────────────────────────────────────────────── */

/** 셀 상태. 노트북의 wafer_to_categorical_grid 출력과 같다. */
export const CELL_OUTSIDE = 0;
export const CELL_NORMAL = 1;
export const CELL_DEFECT = 2;

export type CellState = typeof CELL_OUTSIDE | typeof CELL_NORMAL | typeof CELL_DEFECT;

export const CELL_LABEL: Record<CellState, string> = {
  0: '웨이퍼 밖',
  1: '정상 die',
  2: '불량 die',
};

/** 모델 입력 격자 (정책 JSON의 input.shape) */
export const MODEL_GRID = 8;

/**
 * 한 칸 안에서 불량 die 비율이 이 값을 넘으면 그 칸을 불량(2)으로 본다.
 * 정책 JSON의 input.conversion_defect_threshold. 노트북 최종값 0.05.
 * ⚠ 강도 임계값이 아니라 **비율** 임계값이다 — 칸 안 die 중 몇 %가 불량인가.
 */
export const CONVERSION_DEFECT_THRESHOLD = 0.05;

/**
 * 한 칸에서 웨이퍼가 차지하는 면적 비율이 이 값 미만이면 웨이퍼 밖(0)으로 본다.
 * 노트북의 WAFER_PRESENCE_THRESHOLD.
 */
export const WAFER_PRESENCE_THRESHOLD = 0.25;

/* ── 출력 ────────────────────────────────────────────────────────────────── */

/**
 * 9클래스. **순서가 곧 모델 출력 인덱스다** — 바꾸면 라벨이 통째로 어긋난다.
 * 노트북 CLASS_NAMES와 반드시 같아야 한다.
 */
export const CLASS_NAMES: DefectPatternId[] = [
  'Center',
  'Donut',
  'Edge-Loc',
  'Edge-Ring',
  'Loc',
  'Random',
  'Scratch',
  'Near-full',
  'None',
];

export const PRIMARY_MODEL = 'WaferCNNV2';
export const AUXILIARY_MODEL = 'WaferHierarchicalCNNV3';

/**
 * 9클래스 → 계통.
 *
 * 모델은 9클래스를 직접 낸다. UI는 그걸 계통으로 묶어 헤드라인을 만들고,
 * 그 아래에 세부 후보를 확률과 함께 편다. 묶는 이유는 8x8에서 인접 클래스의
 * 확률이 서로 새기 때문이다 — 계통 단위 확률이 개별 클래스 확률보다 훨씬 안정적이다.
 * 각 클래스는 정확히 한 계통에만 속한다 (확률 합이 보존되어야 하므로).
 */
export const PATTERN_FAMILY: Record<DefectPatternId, FamilyId> = {
  None: 'NORMAL',
  Center: 'RADIAL_INNER',
  Donut: 'RADIAL_INNER',
  'Edge-Ring': 'RADIAL_OUTER',
  'Edge-Loc': 'RADIAL_OUTER',
  Loc: 'LOCAL',
  Scratch: 'LOCAL',
  Random: 'SCATTER',
  'Near-full': 'GLOBAL',
};

/* ── 검토(review) 정책 ───────────────────────────────────────────────────── */

/** 1순위 확률이 이 값 미만이면 사람 검토. 노트북 predict_final_wafer의 low_score_threshold. */
export const LOW_PRIMARY_SCORE = 0.6;

/** 이 클래스로 판정되면 확률과 무관하게 항상 검토. 노트북 ALWAYS_REVIEW_CLASSES. */
export const ALWAYS_REVIEW_CLASSES: DefectPatternId[] = ['Random', 'Near-full'];

/** 불량 칸이 이 개수 이상이면 검토 (64칸 중). 노트북 HIGH_DEFECT_CELL_THRESHOLD. */
export const HIGH_DEFECT_CELL_THRESHOLD = 50;

/** 'None' 판정인데 결함 근거가 있을 때의 검토 임계. 노트북 BALANCED_NONE_REVIEW_THRESHOLD. */
export const NONE_REVIEW_THRESHOLD = 0.5;

/** V3 보조 모델의 이진(정상/불량) 임계 */
export const V3_BINARY_THRESHOLD = 0.5;

/**
 * 노트북이 내보내는 review_reasons 코드와 그 뜻.
 * 코드만 화면에 띄우면 엔지니어가 읽을 수 없으므로 조치까지 같이 적었다.
 */
export type ReviewReason =
  | 'low_primary_score'
  | 'below_class_threshold'
  | 'suspicious_none_prediction'
  | 'none_defect_disagreement'
  | 'v2_none_but_v3_defect'
  | 'v2_defect_but_v3_none'
  | 'v2_v3_disagreement'
  | 'defect_class_disagreement'
  | 'v3_low_defect_score'
  | 'structurally_ambiguous_class'
  | 'extreme_defect_density';

export const REVIEW_REASON_COPY: Record<ReviewReason, { label: string; detail: string }> = {
  low_primary_score: {
    label: '1순위 확률 부족',
    detail: `주 모델의 최고 확률이 ${LOW_PRIMARY_SCORE * 100}% 미만이다. 어느 클래스도 확신하지 못한 상태이므로 판정을 그대로 쓰면 안 된다.`,
  },
  below_class_threshold: {
    label: '클래스별 임계 미달',
    detail: '이 클래스는 오분류가 잦아 별도 임계를 두는데, 그 임계를 넘지 못했다.',
  },
  suspicious_none_prediction: {
    label: '정상 판정이 의심스러움',
    detail: '정상으로 판정했지만 불량 근거가 함께 잡혔다. 놓친 결함일 수 있어 재확인이 필요하다.',
  },
  none_defect_disagreement: {
    label: '정상/불량 판단 불일치',
    detail: '정상 여부에 대해 모델 내부 판단이 갈렸다.',
  },
  v2_none_but_v3_defect: {
    label: '주 모델 정상 · 보조 모델 불량',
    detail: '주 모델은 정상이라 했지만 보조 모델은 불량이라 본다. 놓친 결함 쪽이 위험이 크므로 사람이 봐야 한다.',
  },
  v2_defect_but_v3_none: {
    label: '주 모델 불량 · 보조 모델 정상',
    detail: '주 모델은 불량이라 했지만 보조 모델은 정상이라 본다. 오탐일 수 있으니 확인 후 조치할 것.',
  },
  v2_v3_disagreement: {
    label: '주·보조 모델 판정 불일치',
    detail: '두 모델이 다른 클래스를 지목했다. 어느 쪽 원인 공정을 볼지 사람이 정해야 한다.',
  },
  defect_class_disagreement: {
    label: '불량 클래스 불일치',
    detail: '불량이라는 데는 두 모델이 동의하지만 어떤 불량인지가 갈렸다. 공정 후보를 좁히려면 확인이 필요하다.',
  },
  v3_low_defect_score: {
    label: '보조 모델 불량 점수 낮음',
    detail: '보조 모델의 불량 확신도가 임계 아래다.',
  },
  structurally_ambiguous_class: {
    label: '구조적으로 모호한 클래스',
    detail: '8×8 해상도에서 인접 클래스와 갈리지 않는 구간이다. 계통까지만 신뢰하고 세부 클래스는 후보로 볼 것.',
  },
  extreme_defect_density: {
    label: '불량 밀도 극단',
    detail: `불량 칸이 ${HIGH_DEFECT_CELL_THRESHOLD}칸 이상이다. 실제 전면 불량일 수도 있지만 계측계 고장도 같은 모양이므로 계측부터 배제할 것.`,
  },
};
