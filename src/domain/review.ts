import {
  ALWAYS_REVIEW_CLASSES,
  CELL_DEFECT,
  HIGH_DEFECT_CELL_THRESHOLD,
  LOW_PRIMARY_SCORE,
  NONE_REVIEW_THRESHOLD,
  type ReviewReason,
} from '../config/model';
import type { DefectPatternId } from './causes';
import type { PatternCandidate, ReviewDecision, WaferFeatures, WaferMap } from './types';

/**
 * 사람 검토가 필요한지 판단한다.
 *
 * 노트북의 검토 정책(predict_final_wafer + balanced_mode)을 UI 쪽으로 옮긴 것이다.
 * 실제 모델 서버가 붙으면 서버가 review_reasons를 직접 내려주므로 이 함수 대신
 * 그 값을 쓰면 된다 (`fromServerReasons` 참고). 그때까지는 같은 규칙을 여기서 돌린다.
 *
 * 이게 UI에서 중요한 이유: "이 판정을 그대로 믿고 공정을 열어도 되는가"가
 * 클래스 이름보다 먼저 답해야 할 질문이기 때문이다. 검토가 필요한 판정을
 * 확정처럼 띄우면, 엔지니어를 근거 없이 챔버 앞으로 보내게 된다.
 */
export function decideReview(
  top: DefectPatternId,
  topScore: number,
  patterns: PatternCandidate[],
  map: WaferMap,
  f: WaferFeatures,
): ReviewDecision {
  const reasons: ReviewReason[] = [];

  if (topScore < LOW_PRIMARY_SCORE) reasons.push('low_primary_score');

  if (ALWAYS_REVIEW_CLASSES.includes(top)) reasons.push('below_class_threshold');

  const defectCells = map.filter((c) => c === CELL_DEFECT).length;
  if (defectCells >= HIGH_DEFECT_CELL_THRESHOLD) reasons.push('extreme_defect_density');

  // 정상이라 했는데 불량 근거가 남아 있는 경우 — 놓친 결함 쪽이 위험이 크다
  if (top === 'None') {
    const defectMass = patterns.filter((p) => p.id !== 'None').reduce((s, p) => s + p.probability, 0);
    if (defectMass >= NONE_REVIEW_THRESHOLD || f.defectCount >= 3) {
      reasons.push('suspicious_none_prediction');
    }
  }

  // 8x8에서 구조적으로 갈리지 않는 쌍이 접해 있으면 세부 클래스를 확정하지 않는다
  if (isStructurallyAmbiguous(patterns)) reasons.push('structurally_ambiguous_class');

  const unique = [...new Set(reasons)];

  return {
    required: unique.length > 0,
    reasons: unique,
    note: unique.length === 0 ? `1순위 확률 ${(topScore * 100).toFixed(0)}%로 정책 임계를 모두 통과했다.` : undefined,
  };
}

/** 저해상도에서 서로 새는 쌍. config/taxonomy.ts의 UNRESOLVED_PAIRS와 같은 근거다. */
const AMBIGUOUS_PAIRS: Array<[DefectPatternId, DefectPatternId]> = [
  ['Center', 'Donut'],
  ['Donut', 'Edge-Ring'],
  ['Loc', 'Scratch'],
  ['Edge-Loc', 'Edge-Ring'],
];

function isStructurallyAmbiguous(patterns: PatternCandidate[]): boolean {
  const byId = new Map(patterns.map((p) => [p.id, p.probability]));
  const sorted = [...patterns].sort((a, b) => b.probability - a.probability);
  const [first, second] = sorted;
  if (!first || !second) return false;

  const contested = AMBIGUOUS_PAIRS.some(
    ([a, b]) =>
      (first.id === a && second.id === b) || (first.id === b && second.id === a),
  );
  if (!contested) return false;

  // 두 클래스가 실제로 접해 있을 때만 (한쪽이 압도적이면 모호하지 않다)
  const gap = (byId.get(first.id) ?? 0) - (byId.get(second.id) ?? 0);
  return gap < 0.25;
}

/** 모델 서버가 review_reasons를 직접 내려줄 때 쓴다 */
export function fromServerReasons(reasons: string[]): ReviewDecision {
  const known = reasons.filter((r): r is ReviewReason => r in REVIEW_REASON_SET);
  return {
    required: reasons.length > 0,
    reasons: known,
    note: reasons.length === 0 ? '모델 정책의 검토 임계를 모두 통과했다.' : undefined,
  };
}

const REVIEW_REASON_SET: Record<ReviewReason, true> = {
  low_primary_score: true,
  below_class_threshold: true,
  suspicious_none_prediction: true,
  none_defect_disagreement: true,
  v2_none_but_v3_defect: true,
  v2_defect_but_v3_none: true,
  v2_v3_disagreement: true,
  defect_class_disagreement: true,
  v3_low_defect_score: true,
  structurally_ambiguous_class: true,
  extreme_defect_density: true,
};
