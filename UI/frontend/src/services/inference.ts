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
 * 실제 추론 서버(wafer_final_package/serve.py)의 응답.
 * 필드명은 wafer_model.py의 `WaferInferenceSystem.predict()` 반환값 그대로다 —
 * 서버는 그걸 감싸기만 하고 이름을 바꾸지 않는다.
 */
export interface PredictResponse {
  prediction: DefectPatternId;
  score: number;
  status: 'ACCEPT' | 'REVIEW';
  review_reason: string[];
  class_threshold: number;
  none_review_threshold: number;
  top_predictions: Array<{ class: DefectPatternId; score: number }>;
  auxiliary_prediction: DefectPatternId | null;
  auxiliary_score: number | null;
  v3_defect_score: number | null;
  v3_binary_threshold: number | null;
  defect_cell_count: number;
  direction: string | null;
  direction_confidence: number | null;
  quadrant_counts: Record<string, number> | null;
  direction_method: string | null;
  /** serve.py가 덧붙이는 것 — 클래스 순서대로 정렬한 9개 확률 */
  probabilities?: number[];
  class_names?: string[];
  model?: string;
}

/**
 * 실제 모델 서버 어댑터.
 *
 *   POST {baseUrl}/predict
 *   요청  { "hardware_map": number[8][8] }   // 0(웨이퍼 밖) / 1(정상 die) / 2(불량 die)
 *   응답  PredictResponse
 *
 * 서버 띄우는 법은 wafer_final_package/serve.py 주석 참고.
 *
 * 판정·검토 여부는 전부 서버 값을 그대로 쓴다. UI가 다시 계산하지 않는다 —
 * 모델 정책(클래스별 임계, V3 대조)이 UI 규칙보다 정본이고, 두 곳에서 따로 계산하면
 * 언젠가 어긋난다. UI가 채우는 건 피처·근거·계통 집계처럼 맵에서 순수하게 나오는 것뿐이다.
 */
export class HttpInferenceEngine implements InferenceEngine {
  readonly kind = 'http' as const;
  readonly label: string;

  constructor(private baseUrl: string) {
    this.label = `실제 모델 서버 (${baseUrl})`;
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

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`모델 서버 응답 오류 ${res.status} ${res.statusText} ${detail}`.trim());
    }

    const data = (await res.json()) as PredictResponse;
    const features = extractFeatures(map);

    const verdict = verdictFromProbabilities(toProbabilityVector(data), map, features, {
      engineVersion: data.model || PRIMARY_MODEL,
    });

    return {
      ...verdict,
      // 서버 판정이 정본. 1순위 클래스도 서버가 고른 걸 그대로 쓴다.
      top: data.prediction,
      topScore: data.score,
      review: fromServerReasons(data.review_reason ?? []),
      model: {
        status: data.status,
        classThreshold: data.class_threshold,
        auxiliaryPrediction: data.auxiliary_prediction,
        auxiliaryScore: data.auxiliary_score,
        v3DefectScore: data.v3_defect_score,
        v3BinaryThreshold: data.v3_binary_threshold,
        defectCellCount: data.defect_cell_count,
        direction: data.direction,
        directionConfidence: data.direction_confidence,
        directionMethod: data.direction_method,
        quadrantCounts: data.quadrant_counts,
      },
      inferMs: performance.now() - t0,
    };
  }
}

/** 서버 응답을 9클래스 확률 벡터로 */
function toProbabilityVector(data: PredictResponse): number[] {
  if (data.probabilities?.length === CLASS_NAMES.length) return data.probabilities;

  // serve.py가 probabilities를 안 실어 준 경우의 폴백.
  // top_predictions만 있으면 빠진 클래스는 0이 되어 계통 합이 실제보다 낮아진다.
  const v = new Array(CLASS_NAMES.length).fill(0);
  for (const t of data.top_predictions ?? []) {
    const i = CLASS_NAMES.indexOf(t.class);
    if (i >= 0) v[i] = t.score;
  }
  const topIdx = CLASS_NAMES.indexOf(data.prediction);
  if (topIdx >= 0 && v[topIdx] === 0) v[topIdx] = data.score;
  return v;
}

/** 실제 모델 서버가 살아 있는지 */
export async function probeModelServer(baseUrl: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${baseUrl}/health`);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const j = (await res.json()) as { device?: string; model?: string; v3_binary_threshold?: number };
    return {
      ok: true,
      detail: `${j.model ?? '모델'} · device=${j.device ?? '?'} · V3 임계 ${j.v3_binary_threshold ?? '?'}`,
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export const DEFAULT_MODEL_SERVER = 'http://127.0.0.1:8077';

let active: InferenceEngine = new RuleInferenceEngine();

export function getInferenceEngine(): InferenceEngine {
  return active;
}

export function setInferenceEngine(engine: InferenceEngine) {
  active = engine;
}
