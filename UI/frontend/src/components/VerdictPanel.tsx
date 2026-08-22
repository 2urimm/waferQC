import { useState } from 'react';
import { REVIEW_REASON_COPY } from '../config/model';
import { CONFIDENCE_COPY, FAMILIES, confidenceBand } from '../config/taxonomy';
import { PATTERN_LABEL } from '../domain/causes';
import type { Verdict } from '../domain/types';
import { ProbabilityBars } from './charts';
import { Badge, Card } from './ui';

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

/** 이 값 미만인 계통은 막대에서 접는다 (1위는 예외로 항상 표시) */
const FAMILY_FLOOR_PCT = 5;

const URGENCY_COLOR: Record<string, string> = {
  none: '--good',
  watch: '--warning',
  investigate: '--serious',
  immediate: '--critical',
};

const URGENCY_LABEL: Record<string, string> = {
  none: '조치 불요',
  watch: '모니터링',
  investigate: '원인 추적',
  immediate: '즉시 대응',
};

/*
  모델 패키지 v2가 내는 방향 판정 근거. 기준은 패키지 README.txt 9-1절 그대로다 —
  "가장 많은 영역의 defect 개수 - 나머지 3개 영역 평균 >= 2" 일 때만 방향으로 인정하고,
  차이가 그보다 작거나 최다 영역이 공동 1등이면 방향성 불명확으로 처리한다.
  문구도 패키지가 쓰는 용어("방향성 불명확")를 그대로 따른다.
*/
const DIRECTION_METHOD_LABEL: Record<string, string> = {
  max_vs_other_mean: '최다 사분면 — 나머지 세 영역 평균보다 2개 이상 많음',
  below_min_gap: '나머지 세 영역 평균과 차이가 2개 미만 — 방향성 불명확',
  max_tie: '최다 사분면이 공동 1등 — 방향성 불명확',
  no_defect: '불량 칸 없음',
};

export function VerdictPanel({ verdict }: { verdict: Verdict }) {
  const family = FAMILIES[verdict.family];
  const top = verdict.familyScores[0];
  const second = verdict.familyScores[1];
  const band = confidenceBand(top.probability, second?.probability ?? 0);

  /*
    계통 확률은 합이 1이라 50% 넘는 계통이 구조적으로 하나뿐이다 — 그 컷은 판정 헤드라인을
    반복할 뿐이다. 실측(이력 316건)에서 눈에 걸리는 0~2% 잡음은 3위 아래에 몰려 있고,
    2위는 20~35%까지 올라간다(Edge-Loc ↔ Loc처럼 8×8에서 안 갈리는 쌍). 그래서 순위가 아니라
    5% 바닥으로 자른다. 1위는 값에 상관없이 항상 남긴다.
  */
  const [driversOpen, setDriversOpen] = useState(false);

  const shownFamilies = verdict.familyScores.filter((s, i) => i === 0 || s.probability >= FAMILY_FLOOR_PCT / 100);
  const hiddenFamilies = verdict.familyScores.length - shownFamilies.length;

  return (
    <div className="stack">
      {/*
        검토 필요 여부를 판정보다 위에 둔다. "이 판정을 그대로 믿고 공정을 열어도 되는가"가
        클래스 이름보다 먼저 답해야 할 질문이기 때문이다. 검토가 필요한 판정을 확정처럼
        띄우면 엔지니어를 근거 없이 챔버 앞으로 보내게 된다.
      */}
      {verdict.review.required && (
        <div className="banner warn" role="alert">
          <span className="caveat-icon" aria-hidden>!</span>
          <div>
            <strong>사람 검토 필요</strong> — 모델 정책이 이 판정을 자동 채택 대상에서 제외했다.
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {verdict.review.reasons.map((r) => (
                <div key={r}>
                  <strong style={{ fontWeight: 600 }}>{REVIEW_REASON_COPY[r].label}</strong>
                  <span style={{ color: 'var(--text-muted)' }}> — {REVIEW_REASON_COPY[r].detail}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, color: 'var(--text-muted)' }}>
              아래 공정 순서는 참고용으로 남겨 둔다. 설비를 세우는 조치는 검토를 거친 뒤에 할 것.
            </div>
          </div>
        </div>
      )}

      <Card
        title="판정"
        sub={`${verdict.engineVersion}${verdict.engine === 'rule-mock' ? ' · 규칙 기반 대체 (학습 모델 미연결)' : ''} · 추론 ${verdict.inferMs.toFixed(1)} ms`}
      >
        <div className="verdict-head">
          <span className="verdict-class">{family.label}</span>
          <span className="verdict-prob">{pct(top.probability)}</span>
          <Badge color={URGENCY_COLOR[family.urgency]} strong>
            {URGENCY_LABEL[family.urgency]}
          </Badge>
          <Badge>신뢰도 {CONFIDENCE_COPY[band].label}</Badge>
          {verdict.review.required ? (
            <Badge color="--warning" strong>검토 필요</Badge>
          ) : (
            <Badge color="--good">자동 채택 가능</Badge>
          )}
        </div>

        <p className="section-note" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
          모델 1순위: {PATTERN_LABEL[verdict.top]} {pct(verdict.topScore)}
          {verdict.review.note && ` · ${verdict.review.note}`}
        </p>

        <p className="section-note" style={{ marginTop: 8 }}>
          {family.meaning}
        </p>
        <p className="section-note" style={{ marginTop: 4, color: 'var(--text-muted)' }}>
          판별 근거: {family.discriminator}
        </p>

        <div className="divider" style={{ margin: '12px 0' }} />

        <div className="card-sub" style={{ marginBottom: 6 }}>계통별 확률</div>
        <ProbabilityBars
          rows={shownFamilies.map((s) => ({
            id: s.id,
            label: FAMILIES[s.id].short,
            probability: s.probability,
          }))}
          topId={verdict.family}
        />
        {hiddenFamilies > 0 && (
          <p className="section-note" style={{ marginTop: 6, color: 'var(--text-muted)' }}>
            나머지 {hiddenFamilies}계통은 {FAMILY_FLOOR_PCT}% 미만이라 접었다. 계통 확률은 9클래스를 묶은 값이라 보이는
            막대만 더하면 100%가 되지 않는다.
          </p>
        )}

        <div className="banner info" style={{ marginTop: 12 }}>
          <span className="caveat-icon" aria-hidden>i</span>
          <div>{CONFIDENCE_COPY[band].note}</div>
        </div>
      </Card>

      {verdict.model && (
        <Card
          title="모델 출력"
          sub="실제 WaferCNNV2 + V3가 낸 값. UI가 다시 계산하지 않고 그대로 표시한다."
        >
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <Badge color={verdict.model.status === 'ACCEPT' ? '--good' : '--warning'} strong>
              {verdict.model.status}
            </Badge>
            <Badge>불량 {verdict.model.defectCellCount}칸</Badge>
            {verdict.model.direction && (
              <Badge strong>
                방향 {verdict.model.direction}
                {verdict.model.directionConfidence !== null &&
                  ` ${(verdict.model.directionConfidence * 100).toFixed(0)}%`}
              </Badge>
            )}
            {/*
              quadrantCounts가 있다는 건 모델이 방향 판정 대상(Scratch/Loc/Edge-Loc)으로
              봤다는 뜻이다. 그런데도 방향이 비어 있으면 패키지가 "방향성 불명확"으로
              처리한 것이므로, 방향 칸이 그냥 사라진 것처럼 보이지 않게 그대로 밝힌다.
            */}
            {!verdict.model.direction && verdict.model.quadrantCounts && <Badge>방향성 불명확</Badge>}
          </div>

          <dl className="kv">
            <dt>클래스 임계</dt>
            <dd>
              {verdict.model.classThreshold.toFixed(2)}
              {verdict.model.classThreshold > 1 && (
                <span style={{ color: 'var(--serious)' }}>
                  {' '}
                  — 확률이 넘을 수 없는 값이라 이 클래스는 항상 검토 대상이다
                </span>
              )}
            </dd>
            {verdict.model.auxiliaryPrediction && (
              <>
                <dt>보조 모델 V3</dt>
                <dd>
                  {PATTERN_LABEL[verdict.model.auxiliaryPrediction]}
                  {verdict.model.auxiliaryScore !== null && ` ${pct(verdict.model.auxiliaryScore)}`}
                  {verdict.model.auxiliaryPrediction !== verdict.top && (
                    <span style={{ color: 'var(--serious)' }}> — 주 모델과 다름</span>
                  )}
                </dd>
              </>
            )}
            {verdict.model.v3DefectScore !== null && (
              <>
                <dt>V3 불량 점수</dt>
                <dd>
                  {verdict.model.v3DefectScore.toFixed(3)}
                  {verdict.model.v3BinaryThreshold !== null && ` / 임계 ${verdict.model.v3BinaryThreshold.toFixed(2)}`}
                </dd>
              </>
            )}
          </dl>

          {verdict.model.quadrantCounts && (
            <>
              <div className="divider" style={{ margin: '12px 0' }} />
              <div className="card-sub" style={{ marginBottom: 6 }}>
                사분면 불량 분포 —{' '}
                {(verdict.model.directionMethod && DIRECTION_METHOD_LABEL[verdict.model.directionMethod]) ??
                  '최다 사분면'}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 4,
                  maxWidth: 220,
                  fontSize: 12.5,
                }}
              >
                {(
                  [
                    ['top_left', '왼쪽 위'],
                    ['top_right', '오른쪽 위'],
                    ['bottom_left', '왼쪽 아래'],
                    ['bottom_right', '오른쪽 아래'],
                  ] as const
                ).map(([key, label]) => {
                  const n = verdict.model!.quadrantCounts![key] ?? 0;
                  const isMax = n > 0 && n === Math.max(...Object.values(verdict.model!.quadrantCounts!));
                  return (
                    <div
                      key={key}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        background: isMax ? 'var(--series-1)' : 'var(--surface-sunken)',
                        color: isMax ? '#fff' : 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div style={{ fontSize: 11, opacity: 0.85 }}>{label}</div>
                      <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{n}칸</div>
                    </div>
                  );
                })}
              </div>
              <p className="section-note" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
                row 0 = 위, col 0 = 왼쪽 기준이다. 하드웨어 배선이 상하/좌우 반전돼 있으면 방향도 반대로 나오므로,
                조립 후 한 모서리에만 불량을 넣어 좌표 방향을 한 번 검증할 것.
              </p>
            </>
          )}
        </Card>
      )}

      {/*
        9클래스 전부를 늘어놓으면 확률 0%인 후보가 화면 대부분을 차지한다.
        patterns는 확률 내림차순이라 앞의 세 개가 곧 1~3순위다.
      */}
      <Card
        title="불량 유형 확률"
        sub={
          verdict.model
            ? '모델 원본 확률의 상위 3순위. 위의 계통 확률은 9클래스 전체를 묶은 것이라 합이 보존된다.'
            : '규칙 대체판이 만든 확률의 상위 3순위. 학습된 모델이 아니라 UI를 돌리기 위한 임시 값이다.'
        }
      >
        <div className="stack" style={{ gap: 10 }}>
          {verdict.patterns.slice(0, 3).map((p) => (
            <div key={p.id}>
              <div className="row" style={{ gap: 8 }}>
                <strong className="mono" style={{ fontSize: 13.5 }}>{PATTERN_LABEL[p.id]}</strong>
                <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
                  {pct(p.probability)}
                </span>
              </div>
              {/*
                막대 길이는 전체 100% 중 이 클래스가 차지하는 몫이다.
                계통 안에서의 몫(withinFamily)으로 그리면 10%짜리가 꽉 찬 막대로 보여
                옆의 숫자와 어긋난다.
              */}
              <div className="prob-track" style={{ height: 8, marginTop: 3 }}>
                <div
                  className="prob-fill top"
                  style={{ width: `${Math.max(1, p.probability * 100)}%`, opacity: 0.35 + p.probability * 0.65 }}
                />
              </div>
              <p className="section-note" style={{ marginTop: 5, color: 'var(--text-muted)' }}>
                {p.reason}
              </p>
            </div>
          ))}
        </div>
        <p className="section-note" style={{ marginTop: 10, color: 'var(--text-muted)' }}>
          나머지 {Math.max(0, verdict.patterns.length - 3)}개 클래스는 확률이 3순위보다 낮아 접었다.
        </p>
      </Card>

      {/*
        판정 근거는 매 판정마다 펼쳐 볼 성질이 아니다 — 결론이 미심쩍을 때 여는 자리다.
        기본은 접어 두고, 피처 설명은 열마다 깔지 않고 이름에 붙여 둔다.
      */}
      <Card
        title="판정 근거"
        sub="공간 통계 실제 값 · ★는 이번 판정을 직접 민 피처"
        actions={
          <button className="btn btn-sm" onClick={() => setDriversOpen((v) => !v)}>
            {driversOpen ? '접기' : `펼치기 (${verdict.drivers.length})`}
          </button>
        }
      >
        {driversOpen ? (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>피처</th>
                    <th>값</th>
                  </tr>
                </thead>
                <tbody>
                  {verdict.drivers.map((d) => (
                    <tr key={d.feature}>
                      <td style={{ fontWeight: d.effect === 'supports' ? 600 : 400 }}>
                        {d.effect === 'supports' && <span aria-label="판정 근거">★ </span>}
                        <span className="has-note" title={d.note}>
                          {d.label}
                        </span>
                      </td>
                      <td className="mono">{d.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="section-note" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
              피처 이름에 커서를 올리면 그 값이 무엇을 재는지 설명이 뜬다.
            </p>
          </>
        ) : (
          <p className="section-note" style={{ color: 'var(--text-muted)' }}>
            판정이 미심쩍을 때 열어 볼 것. 반경 · 군집 · 이방성 · 방위 등 {verdict.drivers.length}개 값이 들어 있다.
          </p>
        )}
      </Card>

    </div>
  );
}
