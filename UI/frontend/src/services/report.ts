import { REVIEW_REASON_COPY } from '../config/model';
import { CONFIDENCE_COPY, FAMILIES, confidenceBand, unresolvedPairsFor } from '../config/taxonomy';
import { CASE_STATUS_LABEL, explainStatus } from '../domain/caseStatus';
import { PATTERN_LABEL } from '../domain/causes';
import type { DiagnosisPlan } from '../domain/plan';
import type { Inspection } from '../domain/types';

/**
 * 점검 보고서 생성.
 *
 * 받아 보는 사람이 그대로 실행할 수 있어야 한다 — 무엇을, 어느 순서로.
 *
 * 판정 근거와 한계를 반드시 같이 싣는다. 결론만 실린 보고서는 받는 쪽에서 검증할 수 없고,
 * 저해상도 스크리닝 결과를 확정 진단처럼 읽게 만든다.
 */

export interface ReportOptions {
  inspection: Inspection;
  plan: DiagnosisPlan;
  /** 상위 몇 개 공정까지 실을지 */
  processLimit?: number;
}

export interface GeneratedReport {
  markdown: string;
  title: string;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const dt = (t: number) =>
  new Date(t).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

export function generateReport({ inspection, plan, processLimit = 4 }: ReportOptions): GeneratedReport {
  const { verdict } = inspection;
  const family = FAMILIES[verdict.family];
  const top = verdict.familyScores[0];
  const second = verdict.familyScores[1];
  const band = confidenceBand(top.probability, second?.probability ?? 0);

  const tabs = plan.tabs.slice(0, processLimit);

  const L: string[] = [];

  L.push(`# 웨이퍼 결함 스크리닝 점검 보고서`);
  L.push('');
  L.push(`| 항목 | 내용 |`);
  L.push(`| --- | --- |`);
  L.push(`| 로트 · 웨이퍼 | ${inspection.lotId} · #${inspection.waferNo} |`);
  L.push(`| 측정 시각 | ${dt(inspection.capturedAt)} |`);
  L.push(`| 검사 해상도 | 8×8 (64칸) — 저해상도 1차 스크리닝 |`);
  L.push(`| 판정 엔진 | ${verdict.engineVersion}${verdict.engine === 'rule-mock' ? ' (규칙 기반 대체 — 학습 모델 미연결)' : ''} |`);
  L.push(`| 추론 시간 | ${inspection.elapsedMs.toFixed(1)} ms |`);
  L.push(`| 작성 시각 | ${dt(Date.now())} |`);
  L.push('');

  /* ── 검토 필요 여부 (판정보다 먼저) ── */
  if (verdict.review.required) {
    L.push(`> ## ⚠ 사람 검토 필요`);
    L.push(`>`);
    L.push(`> 모델 정책이 이 판정을 자동 채택 대상에서 제외했다. 아래 공정 순서는 참고용이며,`);
    L.push(`> 설비를 세우는 조치는 검토를 거친 뒤에 할 것.`);
    L.push(`>`);
    for (const r of verdict.review.reasons) {
      L.push(`> - **${REVIEW_REASON_COPY[r].label}** — ${REVIEW_REASON_COPY[r].detail}`);
    }
    L.push('');
  }

  /* ── 판정 ── */
  L.push(`## 1. 판정`);
  L.push('');
  L.push(`**${family.label}** — 확률 ${pct(top.probability)}, 신뢰도 ${CONFIDENCE_COPY[band].label}`);
  L.push('');
  L.push(
    `모델 1순위 클래스: ${PATTERN_LABEL[verdict.top]} (${verdict.top}) ${pct(verdict.topScore)}` +
      (verdict.review.required ? ' · **검토 필요**' : ' · 자동 채택 가능'),
  );
  L.push('');
  L.push(`- 판별 근거: ${family.discriminator}`);
  L.push(`- 의미: ${family.meaning}`);
  L.push(`- ${CONFIDENCE_COPY[band].note}`);
  L.push('');

  L.push(`### 계통별 확률`);
  L.push('');
  L.push(`| 계통 | 확률 |`);
  L.push(`| --- | ---: |`);
  for (const s of verdict.familyScores) {
    L.push(`| ${FAMILIES[s.id].label} | ${pct(s.probability)} |`);
  }
  L.push('');

  /* ── 9클래스 확률 ── */
  L.push(`### 9클래스 확률`);
  L.push('');
  L.push(
    `모델이 내는 원본 확률이다. 위의 계통 확률은 이걸 묶은 것이라 합이 보존된다. ` +
      `8×8 해상도에서는 인접 클래스끼리 확률이 새므로, 세부 클래스는 확정이 아니라 점검 범위를 좁히는 순위로 읽을 것.`,
  );
  L.push('');
  L.push(`| 패턴 | 확률 | 근거 |`);
  L.push(`| --- | ---: | --- |`);
  for (const p of verdict.patterns) {
    L.push(`| ${PATTERN_LABEL[p.id]} (${p.id}) | ${pct(p.probability)} | ${p.reason} |`);
  }
  L.push('');

  /* ── 판정 근거 ── */
  L.push(`## 2. 판정 근거 (측정 피처)`);
  L.push('');
  L.push(`| 피처 | 값 | 설명 |`);
  L.push(`| --- | --- | --- |`);
  for (const d of verdict.drivers) {
    L.push(`| ${d.label}${d.effect === 'supports' ? ' ★' : ''} | ${d.value} | ${d.note} |`);
  }
  L.push('');
  L.push(`★ 표시는 이번 판정을 직접 민 피처.`);
  L.push('');

  /* ── 한계 ── */
  const pairs = unresolvedPairsFor(verdict.family);
  if (verdict.caveats.length || pairs.length) {
    L.push(`## 3. 이 판정의 한계`);
    L.push('');
    for (const c of verdict.caveats) L.push(`- ${c}`);
    for (const p of pairs) {
      L.push(
        `- **${p.pair[0]} ↔ ${p.pair[1]} 미분리**: ${p.reason} (가르려면: ${p.needs})`,
      );
    }
    L.push('');
  }

  /* ── 공정별 점검 계획 ── */
  L.push(`## 4. 공정별 점검 순서`);
  L.push('');
  L.push(
    `연관도 순이다. 같은 공정 안에서는 엑셀 개선안의 대표 유형(①)과 지난 12개월 재발 빈도를 앞에 두었다. ` +
      `지난 12개월 발생 ${plan.totalOccurrences}건, 이번 방위로 대조 가능 ${plan.immediateCount}건 · 설비 배치 실측 필요 ${plan.layoutCount}건.`,
  );
  L.push('');

  for (const tab of tabs) {
    L.push(`### ${tab.rank}순위 · ${tab.meta.label}`);
    L.push('');
    L.push(`연관도 ${pct(tab.relevance)} · 원인 ${tab.causes.length}건 · 지난 12개월 ${tab.occurrences}건 발생`);
    L.push('');

    for (const c of tab.causes) {
      L.push(`#### ${c.name}`);
      L.push('');
      L.push(
        `- 불량 유형 ${c.variant === 1 ? '①' : '②'} · 대상 패턴: ${PATTERN_LABEL[c.pattern]} (${pct(c.patternProbability)})`,
      );
      L.push(`- 기전: ${c.mechanism.join(' → ')}`);
      L.push(`- 웨이퍼맵 형태: ${c.waferMap}`);
      if (c.directional) L.push(`- 방향성: ${c.directional.label}`);
      if (c.supportNote) {
        const mark = c.support === 'strong' ? '✔ 이번 측정이 지지' : c.support === 'weak' ? '△ 이번 측정과 불일치' : 'ℹ';
        L.push(`- ${mark}: ${c.supportNote}`);
      }
      if (c.needsLayout) L.push(`- ⚙ 방위만으로는 확인 불가 — 각도가 설비 배치에 달려 있어 실측 wafer map 대조 필요`);
      if (c.metrology) L.push(`- 계측 방법: ${c.metrology} (대응 Log 기록)`);
      if (c.logIds.length) {
        L.push(`- 대응 이력: ${c.logIds.join(', ')} · 지난 12개월 ${c.occurrences}회 · 마지막 ${c.lastSeen ?? '—'}`);
        L.push(`- 상태: ${CASE_STATUS_LABEL[c.caseState.status]} — ${explainStatus(c.caseState)}`);
      }
      L.push('');

      L.push(`**해결 · 즉시 대응**`);
      L.push('');
      for (const chk of c.resolution) L.push(`- [ ] ${chk}`);
      L.push('');
      L.push(`**개선 · 재발방지** *(공정 담당 계획 사항)*`);
      L.push('');
      for (const r of c.improvement) L.push(`- ${r}`);
      L.push('');
    }
  }

  /* ── 지식베이스 공백 ── */
  if (plan.patternsWithoutMapping.length) {
    L.push(`## 5. 지식베이스 공백`);
    L.push('');
    L.push(
      `후보에 올랐으나 원인 매핑이 아직 없는 패턴: ${plan.patternsWithoutMapping
        .map((p) => `${PATTERN_LABEL[p]} (${p})`)
        .join(', ')}. 원인이 없다는 뜻이 아니라 표가 아직 안 채워진 것이므로, 해당 패턴이 유력하면 수동 분석이 필요하다.`,
    );
    L.push('');
  }

  /* ── 푸터 ── */
  L.push(`---`);
  L.push('');
  L.push(
    `*이 보고서는 8×8(64칸) 저해상도 1차 스크리닝 결과입니다. 확정 진단이 아니라 점검 우선순위를 좁히기 위한 것이며, ` +
      `개선안 항목은 검토 전 초안을 포함합니다.*`,
  );

  return {
    markdown: L.join('\n'),
    title: `${inspection.lotId}_W${inspection.waferNo}_${family.short}_점검보고서`,
  };
}
