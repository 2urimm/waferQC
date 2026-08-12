import {
  CAUSE_MATRIX,
  PATTERN_LABEL,
  PROCESSES,
  PROCESS_ORDER,
  type CauseEntry,
  type DefectPatternId,
  type Disruption,
  type ProcessId,
  type ProcessMeta,
} from './causes';
import type { PatternCandidate, Verdict, WaferFeatures } from './types';

/**
 * 판정 → 공정별 점검 계획.
 *
 * 이 파일이 UI가 담당하는 부분의 실질이다. 모델은 "반경 구조 · 외곽 편중"까지만 말한다.
 * 그건 라벨이지 조치가 아니다. 엔지니어에게 필요한 건 "그래서 어느 공정부터 열어보나"이고,
 * 그 사이를 메우는 게 여기다.
 *
 * 공정 순위는 세 가지를 같이 본다.
 *   1) 세부 패턴 후보의 확률 — 유력한 패턴의 원인 공정일수록 위로
 *   2) 요인 축의 폭 — 정적·경시·방향성·R2R 여러 축에서 지목될수록 유력
 *   3) 이번 측정의 피처가 실제로 그 원인을 지지하는가 — 특히 방향성 서명
 * 3번 때문에 같은 패턴이라도 측정에 따라 순서가 바뀐다. 정적 조회표가 아니다.
 *
 * 그리고 중요한 구분 하나: 경시 변화(aging)와 R2R 원인은 웨이퍼 한 장으로는 확인할 수 없다.
 * 이력 대조가 필요한 항목은 `needsHistory`로 표시해 "지금 볼 것"과 갈라 둔다.
 */

export type Support = 'strong' | 'weak' | 'neutral';

export interface RankedCause extends CauseEntry {
  /** 이 원인이 속한 세부 패턴의 확률 */
  patternProbability: number;
  /** 이번 측정의 피처가 이 원인을 지지하는가 */
  support: Support;
  /** 지지/불지지의 근거 — 실제 피처 값을 인용 */
  supportNote?: string;
  /** 웨이퍼 한 장으로는 확인 불가 (이력·로트 순번 대조 필요) */
  needsHistory: boolean;
  score: number;
}

export interface ProcessTab {
  process: ProcessId;
  meta: ProcessMeta;
  rank: number;
  /** 이 공정과 이번 결함의 연관 강도 (0~1, 최상위 공정 기준 정규화) */
  relevance: number;
  causes: RankedCause[];
  /** 걸려 있는 요인 축의 개수 */
  factorSpread: number;
  totalEtaMin: number;
  /** 이 공정에서 가장 먼저 할 수 있는 무정지 확인 */
  firstNoStopCheck?: RankedCause;
  minDisruption: Disruption;
}

export interface DiagnosisPlan {
  tabs: ProcessTab[];
  /** 원인 매핑이 하나도 없는 공정 — 배제된 게 아니라 지식베이스에 없는 것이다 */
  processesWithoutMapping: ProcessId[];
  /** 후보 패턴 중 원인 매핑이 비어 있는 것 */
  patternsWithoutMapping: DefectPatternId[];
  totalEtaMin: number;
  /** 지금 웨이퍼만으로 확인 가능한 항목 수 / 이력이 필요한 항목 수 */
  immediateCount: number;
  historyCount: number;
}

const DISRUPTION_RANK: Record<Disruption, number> = { none: 0, low: 1, high: 2 };

/** 요인 축별 기본 가중. 방향성은 이번 측정으로 바로 검증되므로 조금 높게 잡는다. */
const FACTOR_WEIGHT = { static: 1.0, spatial: 1.1, aging: 0.85, r2r: 0.8 } as const;

/**
 * 계획에 넣을 패턴을 고른다.
 *
 * 9클래스 softmax에서는 하위 클래스에도 2~3%씩 확률이 깔린다. 그걸 전부 계획에 넣으면
 * 공정 탭이 일곱 개, 총 소요가 여덟 시간짜리 목록이 나온다 — 우선순위를 좁히려고 만든
 * 화면이 오히려 아무것도 안 좁혀 주는 셈이다.
 *
 * 그래서 두 조건으로 자른다.
 *   - 누적 확률이 90%에 닿을 때까지만 (실질적으로 유력한 후보들)
 *   - 개별 확률 5% 미만은 제외 (softmax 바닥에 깔린 잡음)
 * 잘린 후보는 사라지는 게 아니라 판정 화면의 9클래스 확률에 그대로 남아 있다.
 */
const PLAN_MIN_PROBABILITY = 0.05;
const PLAN_CUMULATIVE_TARGET = 0.9;

function patternsInPlay(patterns: Verdict['patterns']): Map<DefectPatternId, number> {
  const out = new Map<DefectPatternId, number>();
  let cum = 0;
  for (const p of [...patterns].sort((a, b) => b.probability - a.probability)) {
    if (p.probability < PLAN_MIN_PROBABILITY) break;
    out.set(p.id, p.probability);
    cum += p.probability;
    if (cum >= PLAN_CUMULATIVE_TARGET) break;
  }
  // 전부 잘려 나가면 1순위만이라도 남긴다 (확률이 고루 낮게 퍼진 경우)
  if (out.size === 0 && patterns.length) out.set(patterns[0].id, patterns[0].probability);
  return out;
}

export function buildPlan(verdict: Verdict, measuredProcess?: ProcessId): DiagnosisPlan {
  const { patterns, features } = verdict;
  const probOf = patternsInPlay(patterns);

  const ranked: RankedCause[] = [];
  for (const entry of CAUSE_MATRIX) {
    const p = probOf.get(entry.pattern);
    if (p === undefined) continue;

    const { support, note } = evaluateSupport(entry, features);
    const supportMul = support === 'strong' ? 1.6 : support === 'weak' ? 0.6 : 1;
    const needsHistory = entry.factor === 'aging' || entry.factor === 'r2r';

    ranked.push({
      ...entry,
      patternProbability: p,
      support,
      supportNote: note,
      needsHistory,
      score: p * FACTOR_WEIGHT[entry.factor] * supportMul,
    });
  }

  // 공정별로 묶는다
  const byProcess = new Map<ProcessId, RankedCause[]>();
  for (const c of ranked) {
    const list = byProcess.get(c.process) ?? [];
    list.push(c);
    byProcess.set(c.process, list);
  }

  const rawTabs = [...byProcess.entries()].map(([process, causes]) => {
    causes.sort(
      (a, b) =>
        b.score - a.score ||
        DISRUPTION_RANK[a.actionable.disruption] - DISRUPTION_RANK[b.actionable.disruption] ||
        a.actionable.etaMin - b.actionable.etaMin,
    );
    const factorSpread = new Set(causes.map((c) => c.factor)).size;
    // 여러 요인 축에서 지목될수록 연관이 강하다고 본다.
    // 그리고 이번 맵을 실제로 측정한 공정은 먼저 본다 — 그 공정의 지표가 이탈해서
    // 이 맵이 나온 것이므로, 원인이 다른 공정일 수는 있어도 출발점은 여기다.
    const measuredBoost = measuredProcess && process === measuredProcess ? 1.5 : 1;
    const weight =
      causes.reduce((s, c) => s + c.score, 0) * (1 + (factorSpread - 1) * 0.15) * measuredBoost;
    return { process, causes, factorSpread, weight };
  });

  const maxWeight = Math.max(...rawTabs.map((t) => t.weight), 1e-9);

  const tabs: ProcessTab[] = rawTabs
    .sort((a, b) => b.weight - a.weight || PROCESSES[a.process].step - PROCESSES[b.process].step)
    .map((t, i) => ({
      process: t.process,
      meta: PROCESSES[t.process],
      rank: i + 1,
      relevance: t.weight / maxWeight,
      causes: t.causes,
      factorSpread: t.factorSpread,
      totalEtaMin: t.causes.reduce((s, c) => s + c.actionable.etaMin, 0),
      firstNoStopCheck: t.causes.find((c) => c.actionable.disruption === 'none'),
      minDisruption: t.causes.reduce<Disruption>(
        (best, c) => (DISRUPTION_RANK[c.actionable.disruption] < DISRUPTION_RANK[best] ? c.actionable.disruption : best),
        'high',
      ),
    }));

  const covered = new Set(tabs.map((t) => t.process));
  // 계획에 든 후보 중 원인 매핑이 없는 것만 알린다 (바닥에 깔린 2% 후보까지 경고하면 소음이다)
  const patternsWithoutMapping = [...probOf.keys()].filter(
    (id) => id !== 'None' && !CAUSE_MATRIX.some((c) => c.pattern === id),
  );

  return {
    tabs,
    processesWithoutMapping: PROCESS_ORDER.filter((p) => !covered.has(p)),
    patternsWithoutMapping,
    totalEtaMin: tabs.reduce((s, t) => s + t.totalEtaMin, 0),
    immediateCount: ranked.filter((c) => !c.needsHistory).length,
    historyCount: ranked.filter((c) => c.needsHistory).length,
  };
}

/**
 * 이번 측정이 이 원인을 지지하는가.
 *
 * 가장 강한 신호는 방향성 서명이다. 원본 표의 "6시 하단 노치"(게이트 도어 파티클),
 * "6시 선형 긁힘"(반송 암) 같은 항목은 결함 방위가 실제로 6시면 사실상 확정에 가깝고,
 * 방위가 다르면 반대로 강하게 배제된다. 이게 이 UI가 라벨 이상을 하는 지점이다.
 */
function evaluateSupport(entry: CauseEntry, f: WaferFeatures): { support: Support; note?: string } {
  if (entry.spatialSignature?.includes('6시')) {
    const clock = entry.pattern === 'Scratch' || entry.pattern === 'Edge-Loc' ? f.largestClusterClock : f.edgeDominantClock;
    if (!clock) return { support: 'neutral' };
    if (clock >= 5 && clock <= 7) {
      return {
        support: 'strong',
        note: `측정된 결함 방위가 ${clock}시로, 이 원인의 방향성 서명(6시)과 일치한다. 방위가 맞으면 이 항목은 사실상 확정에 가깝다.`,
      };
    }
    return {
      support: 'weak',
      note: `이 원인은 6시 방향 서명을 갖는데 측정된 결함 방위는 ${clock}시다. 방위가 어긋나므로 우선순위를 낮췄다 — 다만 결함이 여러 방위에 걸쳐 있으면 대표 방위가 흐려질 수 있으니 완전히 배제하지는 않았다.`,
    };
  }

  if (entry.spatialSignature?.includes('Center 치우침')) {
    const off = Math.abs(f.radialCentroid);
    if (f.largestClusterSize >= 3 && off > 0.15) {
      return {
        support: 'strong',
        note: `결함 무게중심이 기하 중심에서 ${off.toFixed(2)}만큼 벗어나 있어 편심 서명과 맞는다.`,
      };
    }
    return { support: 'neutral' };
  }

  // 경시·R2R은 웨이퍼 한 장으로 지지/불지지를 판단할 수 없다. 중립으로 두고 needsHistory로 표시한다.
  if (entry.factor === 'aging' || entry.factor === 'r2r') {
    return {
      support: 'neutral',
      note: '단일 웨이퍼로는 판단 불가. 마지막 정상 시점부터의 경과나 로트 순번과 대조해야 확인된다.',
    };
  }

  return { support: 'neutral' };
}

/** 보고서·요약용 — 상위 N개 공정 이름 */
export function topProcessNames(plan: DiagnosisPlan, n = 3): string[] {
  return plan.tabs.slice(0, n).map((t) => t.meta.label);
}

/** 후보 패턴을 사람이 읽는 문장으로 */
export function describeCandidates(patterns: PatternCandidate[], limit = 3): string {
  return patterns
    .filter((p) => p.probability > 0.02)
    .slice(0, limit)
    .map((p) => `${PATTERN_LABEL[p.id]}(${p.id}) ${(p.probability * 100).toFixed(0)}%`)
    .join(', ');
}
