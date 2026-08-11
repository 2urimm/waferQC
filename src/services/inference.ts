import { CLASS_NAMES, PRIMARY_MODEL } from '../config/model';
import { classify, verdictFromProbabilities } from '../domain/classify';
import type { DefectPatternId } from '../domain/causes';
import { extractFeatures } from '../domain/features';
import { fromServerReasons } from '../domain/review';
import type { Verdict, WaferMap } from '../domain/types';

/* ────────────────────────────────────────────────────────────────────────────
 * ★ 실제 모델 연결 지점
 *
 * 지금은 RuleEngine이 규칙으로 판정한다. 학습된 WaferCNNV2가 서빙되면
 * HttpInferenceEngine을 채우고 `setInferenceEngine()`으로 바꿔 끼우면 UI는 그대로다.
 *
 * 인터페이스가 Verdict를 통째로 돌려주게 되어 있는 건 의도적이다.
 * 확률만 받아오면 "왜 그렇게 판정했는지"를 UI가 다시 지어내야 하는데, 그러면 모델과
 * 설명이 어긋난다. 다만 근거(drivers)·한계(caveats)·계통 집계는 순수하게 피처에서
 * 나오는 것이라 UI 쪽에서 계산해도 모델과 어긋나지 않는다 — 그래서
 * `verdictFromProbabilities()`가 9클래스 확률만 받아 나머지를 채운다.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface InferenceEngine {
  readonly kind: 'rule' | 'http';
  readonly label: string;
  predict(map: WaferMap): Promise<Verdict>;
}

export class RuleInferenceEngine implements InferenceEngine {
  readonly kind = 'rule' as const;
  readonly label = '규칙 기반 대체 판정 (학습 모델 미연결)';

  async predict(map: WaferMap): Promise<Verdict> {
    const t0 = performance.now();
    const features = extractFeatures(map);
    return { ...classify(map, features), inferMs: performance.now() - t0 };
  }
}

/**
 * 노트북 `predict_final_wafer()`의 응답 형태.
 * 서버는 이 함수를 그대로 감싸 내보내면 된다 — 필드명을 노트북과 같게 맞춰 뒀다.
 */
export interface PredictResponse {
  /** 9클래스 확률. CLASS_NAMES와 같은 순서여야 한다. */
  probabilities?: number[];
  final_prediction: DefectPatternId;
  final_score: number;
  primary_model: string;
  v2_top_predictions?: Array<{ class: DefectPatternId; score: number }>;
  auxiliary_used?: boolean;
  v3_binary_defect_score?: number | null;
  v3_auxiliary_prediction?: DefectPatternId | null;
  v3_auxiliary_score?: number | null;
  needs_review?: boolean;
  review_reasons?: string[];
  defect_cell_count?: number;
}

/**
 * 모델 서버 어댑터.
 *
 * 기대 계약:
 *   POST {baseUrl}/predict
 *   요청  { "hardware_map": number[8][8] }   // 값은 0(웨이퍼 밖) / 1(정상 die) / 2(불량 die)
 *   응답  PredictResponse (위 인터페이스)
 *
 * 서버가 `probabilities`를 주면 그대로 쓰고, `v2_top_predictions`만 주면 상위 k개로
 * 성긴 분포를 만들어 쓴다. 후자의 경우 나머지 클래스 확률은 0으로 두므로 계통 합이
 * 실제보다 낮게 나올 수 있다 — 가능하면 서버가 9개 전부를 내려주게 할 것.
 */
export class HttpInferenceEngine implements InferenceEngine {
  readonly kind = 'http' as const;
  readonly label: string;

  constructor(private baseUrl: string) {
    this.label = `모델 서버 (${baseUrl})`;
  }

  async predict(map: WaferMap): Promise<Verdict> {
    const t0 = performance.now();

    const grid: number[][] = [];
    for (let r = 0; r < 8; r++) grid.push(map.slice(r * 8, r * 8 + 8));

    const res = await fetch(`${this.baseUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hardware_map: grid }),
    });

    if (!res.ok) throw new Error(`모델 서버 응답 오류 ${res.status} ${res.statusText}`);

    const data = (await res.json()) as PredictResponse;
    const probabilities = toProbabilityVector(data);
    const features = extractFeatures(map);

    const verdict = verdictFromProbabilities(probabilities, map, features, {
      engineVersion: data.primary_model || PRIMARY_MODEL,
    });

    return {
      ...verdict,
      // 서버가 검토 판단을 내려주면 그쪽이 정본이다. UI 규칙은 서버가 없을 때만 쓴다.
      review: data.review_reasons ? fromServerReasons(data.review_reasons) : verdict.review,
      auxiliary: data.auxiliary_used
        ? {
            used: true,
            binaryDefectScore: data.v3_binary_defect_score ?? null,
            prediction: data.v3_auxiliary_prediction ?? null,
            score: data.v3_auxiliary_score ?? null,
          }
        : undefined,
      inferMs: performance.now() - t0,
    };
  }
}

/** 서버 응답을 9클래스 확률 벡터로 */
function toProbabilityVector(data: PredictResponse): number[] {
  if (data.probabilities?.length === CLASS_NAMES.length) return data.probabilities;

  const v = new Array(CLASS_NAMES.length).fill(0);
  for (const t of data.v2_top_predictions ?? []) {
    const i = CLASS_NAMES.indexOf(t.class);
    if (i >= 0) v[i] = t.score;
  }
  // top-k만 온 경우 1순위라도 확실히 반영한다
  const topIdx = CLASS_NAMES.indexOf(data.final_prediction);
  if (topIdx >= 0 && v[topIdx] === 0) v[topIdx] = data.final_score;
  return v;
}

let active: InferenceEngine = new RuleInferenceEngine();

export function getInferenceEngine(): InferenceEngine {
  return active;
}

export function setInferenceEngine(engine: InferenceEngine) {
  active = engine;
}
