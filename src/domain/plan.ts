import {
  CAUSE_MATRIX,
  EXCLUSION_NOTES,
  PATTERN_LABEL,
  PROCESSES,
  PROCESS_ORDER,
  type CauseEntry,
  type DefectPatternId,
  type ExclusionNote,
  type ProcessId,
  type ProcessMeta,
} from './causes';
import { causeStatus, type CauseStatus } from './caseStatus';
import type { PatternCandidate, Verdict, WaferFeatures } from './types';

/**
 * 판정 → 공정별 점검 계획.
 *
 * 이 파일이 UI가 담당하는 부분의 실질이다. 모델은 "반경 구조 · 외곽 편중"까지만 말한다.
 * 그건 라벨이지 조치가 아니다. 엔지니어에게 필요한 건 "그래서 어느 공정부터 열어보나"이고,
 * 그 사이를 메우는 게 여기다.
 *
 * 공정 순위는 네 가지를 같이 본다.
 *   1) 세부 패턴 후보의 확률 — 유력한 패턴의 원인 공정일수록 위로
 *   2) 엑셀의 불량 유형 ①/② — ①이 그 공정의 대표 유형이다
 *   3) 대응 Log의 재발 빈도 — 지난 12개월 실제로 자주 터진 원인일수록 위로
 *   4) 이번 측정의 방위가 그 원인의 방향성 서명과 맞는가
 * 3·4번 때문에 같은 패턴이라도 측정과 이력에 따라 순서가 바뀐다. 정적 조회표가 아니다.
 *
 * 그리고 중요한 구분 하나: 방향성이 `layout`인 원인(Lift Pin·RF Feedthrough·Retainer Ring
 * Joint 등)은 각도가 설비 배치에 달려 있어 웨이퍼 한 장의 방위만으로는 지지도 배제도 할 수
 * 없다. `needsLayout`으로 따로 표시해 "지금 방위로 가릴 수 있는 것"과 갈라 둔다.
 */

export type Support = 'strong' | 'weak' | 'neutral';

export interface RankedCause extends CauseEntry {
  /** 이 원인이 속한 세부 패턴의 확률 */
  patternProbability: number;
  /** 이번 측정의 방위가 이 원인을 지지하는가 */
  support: Support;
  /** 지지/불지지의 근거 — 실제 피처 값을 인용 */
  supportNote?: string;
  /** 방위만으로는 못 가린다 — 설비 배치 실측이 필요 */
  needsLayout: boolean;
  /** 대장이 기록한 대응 상태 (마지막 발생일·경과일 포함) */
  caseState: CauseStatus;
  score: number;
}

export interface ProcessTab {
  process: ProcessId;
  meta: ProcessMeta;
  rank: number;
  /** 이 공정과 이번 결함의 연관 강도 (0~1, 최상위 공정 기준 정규화) */
  relevance: number;
  causes: RankedCause[];
  /** 이 공정에서 계획에 든 원인들의 지난 12개월 총 발생 건수 */
  occurrences: number;
  /** 이번 측정 방위로 대조 가능한 원인 수 */
  directionalCount: number;
  /** 대장 기준 효과검증 중인 원인 수 */
  monitoringCount: number;
  /** 이번 측정이 지지하는 것 중 1순위 — "여기부터 보라" */
  firstToCheck?: RankedCause;
  /** 이 공정이 이번 후보 유형을 유발하지 않는다고 본 근거 */
  exclusions: ExclusionNote[];
}

export interface DiagnosisPlan {
  tabs: ProcessTab[];
  /** 원인 매핑이 하나도 없는 공정 — 배제된 게 아니라 지식베이스에 없는 것이다 */
  processesWithoutMapping: ProcessId[];
  /** 후보 패턴 중 원인 매핑이 비어 있는 것 */
  patternsWithoutMapping: DefectPatternId[];
  /** 계획에 든 원인의 총 발생 이력 건수 */
  totalOccurrences: number;
  /** 이번 방위로 바로 가릴 수 있는 항목 수 / 설비 배치 실측이 필요한 항목 수 */
  immediateCount: number;
  layoutCount: number;
  /** 대장 기준 효과검증 중인 원인 수 */
  monitoringCount: number;
  /** 후보 유형을 "유발하지 않는다"고 근거를 남긴 공정×유형 */
  exclusions: ExclusionNote[];
}

/**
 * 엑셀 불량 유형 ①/② 가중.
 * ①은 그 공정에서 그 유형의 대표 원인으로 먼저 적힌 것이고, ②는 부수 케이스다.
 */
const VARIANT_WEIGHT: Record<1 | 2, number> = { 1: 1.0, 2: 0.85 };

/**
 * 재발 빈도 가중.
 *
 * 로그의 발생 건수를 그대로 곱하면 5회짜리가 2회짜리를 압도해 확률을 눌러 버린다.
 * 순위를 살짝 기울이는 정도로만 쓰려고 log를 씌워 1.0~1.3 범위에 가둔다.
 */
function recurrenceWeight(occurrences: number): number {
  if (occurrences <= 0) return 1;
  return 1 + Math.min(0.3, Math.log2(occurrences) * 0.12);
}

/**
 * 계획에 넣을 패턴을 고른다.
 *
 * 9클래스 softmax에서는 하위 클래스에도 2~3%씩 확률이 깔린다. 그걸 전부 계획에 넣으면
 * 공정 탭이 여섯 개, 항목이 수십 개짜리 목록이 나온다 — 우선순위를 좁히려고 만든
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

    ranked.push({
      ...entry,
      patternProbability: p,
      support,
      supportNote: note,
      needsLayout: entry.directional?.kind === 'layout',
      caseState: causeStatus(entry),
      score: p * VARIANT_WEIGHT[entry.variant] * recurrenceWeight(entry.occurrences) * supportMul,
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
        a.variant - b.variant ||
        b.occurrences - a.occurrences ||
        a.name.localeCompare(b.name),
    );
    const occurrences = causes.reduce((s, c) => s + c.occurrences, 0);
    // 이번 맵을 실제로 측정한 공정은 먼저 본다 — 그 공정의 지표가 이탈해서 이 맵이 나온
    // 것이므로, 원인이 다른 공정일 수는 있어도 출발점은 여기다.
    const measuredBoost = measuredProcess && process === measuredProcess ? 1.5 : 1;
    // 한 공정 안에서 여러 원인이 동시에 지목될수록 그 공정이 유력하다고 본다.
    const breadth = 1 + (causes.length - 1) * 0.08;
    const weight = causes.reduce((s, c) => s + c.score, 0) * breadth * measuredBoost;
    return { process, causes, occurrences, weight };
  });

  const maxWeight = Math.max(...rawTabs.map((t) => t.weight), 1e-9);
  const inPlay = [...probOf.keys()];

  const tabs: ProcessTab[] = rawTabs
    .sort((a, b) => b.weight - a.weight || PROCESSES[a.process].step - PROCESSES[b.process].step)
    .map((t, i) => ({
      process: t.process,
      meta: PROCESSES[t.process],
      rank: i + 1,
      relevance: t.weight / maxWeight,
      causes: t.causes,
      occurrences: t.occurrences,
      directionalCount: t.causes.filter((c) => c.directional && c.directional.kind !== 'layout').length,
      monitoringCount: t.causes.filter((c) => c.caseState.status === 'monitoring').length,
      firstToCheck: t.causes.find((c) => c.support === 'strong') ?? t.causes[0],
      exclusions: EXCLUSION_NOTES.filter((e) => e.process === t.process && inPlay.includes(e.pattern)),
    }));

  const covered = new Set(tabs.map((t) => t.process));
  // 계획에 든 후보 중 원인 매핑이 없는 것만 알린다 (바닥에 깔린 2% 후보까지 경고하면 소음이다)
  const patternsWithoutMapping = inPlay.filter(
    (id) => id !== 'None' && !CAUSE_MATRIX.some((c) => c.pattern === id),
  );

  return {
    tabs,
    processesWithoutMapping: PROCESS_ORDER.filter((p) => !covered.has(p)),
    patternsWithoutMapping,
    totalOccurrences: ranked.reduce((s, c) => s + c.occurrences, 0),
    immediateCount: ranked.filter((c) => !c.needsLayout).length,
    layoutCount: ranked.filter((c) => c.needsLayout).length,
    monitoringCount: ranked.filter((c) => c.caseState.status === 'monitoring').length,
    exclusions: EXCLUSION_NOTES.filter((e) => inPlay.includes(e.pattern)),
  };
}

/** 두 시 방향의 최소 간격 (0~6) */
function clockGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
}

/**
 * 이번 측정이 이 원인을 지지하는가.
 *
 * 가장 강한 신호는 방향성 서명이다. 대응 Log에서 방향이 확정된 원인 — Slit Valve 파티클(9시),
 * Boat 지지핀(6시), Robot ARM 스크래치(3시) — 은 결함 방위가 실제로 그 방향이면 사실상
 * 확정에 가깝고, 방위가 다르면 반대로 강하게 배제된다. 이게 이 UI가 라벨 이상을 하는 지점이다.
 *
 * 어느 방위를 볼지는 결함 유형에 따라 다르다. 국부성 결함은 최대 군집의 방위가,
 * 외곽 결함은 외곽 링에서 가장 몰린 방위가 그 원인이 남긴 자리다.
 */
function measuredClock(pattern: DefectPatternId, f: WaferFeatures): number {
  const localised = pattern === 'Scratch' || pattern === 'Loc' || pattern === 'Edge-Loc';
  return localised ? f.largestClusterClock : f.edgeDominantClock;
}

function evaluateSupport(entry: CauseEntry, f: WaferFeatures): { support: Support; note?: string } {
  const d = entry.directional;
  if (!d) return { support: 'neutral' };

  if (d.kind === 'layout') {
    return {
      support: 'neutral',
      note: `방향성은 있으나 각도가 설비 배치에 달려 있다(${d.label}). 웨이퍼 한 장의 방위만으로는 지지도 배제도 못 하고, 해당 설비의 실제 배치와 대조해야 확인된다.`,
    };
  }

  const clock = measuredClock(entry.pattern, f);
  if (!clock) return { support: 'neutral' };

  if (d.kind === 'vector') {
    const near = Math.min(clockGap(clock, d.from ?? 0), clockGap(clock, d.to ?? 0));
    if (near <= 1) {
      return {
        support: 'strong',
        note: `측정된 결함 방위가 ${clock}시로, 이 원인의 상대운동 벡터(${d.label})와 같은 축에 놓인다.`,
      };
    }
    return {
      support: 'weak',
      note: `이 원인은 ${d.label} 축을 따라 나타나는데 측정된 결함 방위는 ${clock}시다. 축이 어긋나므로 우선순위를 낮췄다.`,
    };
  }

  const target = d.clock ?? 0;
  const gap = clockGap(clock, target);
  if (gap <= 1) {
    return {
      support: 'strong',
      note: `측정된 결함 방위가 ${clock}시로, 이 원인의 방향성 서명(${d.label})과 일치한다. 방위가 맞으면 이 항목은 사실상 확정에 가깝다.`,
    };
  }
  return {
    support: 'weak',
    note: `이 원인은 ${d.label} 서명을 갖는데 측정된 결함 방위는 ${clock}시다. 방위가 어긋나므로 우선순위를 낮췄다 — 다만 결함이 여러 방위에 걸쳐 있으면 대표 방위가 흐려질 수 있으니 완전히 배제하지는 않았다.`,
  };
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
