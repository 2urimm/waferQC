import { useState } from 'react';
import { REVIEW_REASON_COPY, SHOW_REVIEW_STATUS } from '../config/model';
import { PATTERN_LABEL, type DefectPatternId } from '../domain/causes';
import type { Verdict } from '../domain/types';
import { Badge, Card } from './ui';

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

const URGENCY_COLOR: Record<string, string> = {
  none: '--good',
  watch: '--warning',
  investigate: '--serious',
  immediate: '--critical',
};

/** 1순위 클래스별 조치 수준 (예전 계통 기준 값을 클래스에 그대로 옮겼다) */
const CLASS_URGENCY: Record<DefectPatternId, string> = {
  None: 'none',
  Center: 'investigate',
  Donut: 'investigate',
  'Edge-Ring': 'investigate',
  'Edge-Loc': 'investigate',
  Loc: 'investigate',
  Scratch: 'investigate',
  Random: 'watch',
  'Near-full': 'immediate',
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
  const urgency = CLASS_URGENCY[verdict.top];

  const [driversOpen, setDriversOpen] = useState(false);

  /*
    검토 사유의 '설명'은 접어 둔다.

    사유를 지우는 게 아니라 무게를 줄이는 것이다. 사유 이름은 항상 보이고, 왜 그런지는
    누르면 나온다. 지금 임계 설정상 9클래스 중 6개가 확률로 넘을 수 없는 값(1.01)이라
    'below_class_threshold' 가 사실상 모든 불량 판정에 붙는데, 그 긴 설명이 매번 펼쳐져
    있으면 정작 드물게 뜨는 진짜 사유('판정이 갈림' 등)가 같은 크기로 묻힌다.
  */
  const [reviewOpen, setReviewOpen] = useState(false);

  return (
    <div className="stack">
      {/*
        검토 필요 여부를 판정보다 위에 둔다. "이 판정을 그대로 믿고 공정을 열어도 되는가"가
        클래스 이름보다 먼저 답해야 할 질문이기 때문이다. 검토가 필요한 판정을 확정처럼
        띄우면 엔지니어를 근거 없이 챔버 앞으로 보내게 된다.
      */}
      {SHOW_REVIEW_STATUS && verdict.review.required && (
        <div className="banner warn" role="alert">
          <span className="caveat-icon" aria-hidden>!</span>
          <div style={{ width: '100%' }}>
            <div className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span>
                <strong>사람 검토 필요</strong>
                <span style={{ color: 'var(--text-muted)' }}>
                  {' — '}
                  {verdict.review.reasons.map((r) => REVIEW_REASON_COPY[r].label).join(' · ')}
                </span>
              </span>
              <button
                className="btn btn-sm"
                onClick={() => setReviewOpen((v) => !v)}
                aria-expanded={reviewOpen}
              >
                {reviewOpen ? '접기' : '왜?'}
              </button>
            </div>

            {reviewOpen && (
              <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                <div style={{ color: 'var(--text-muted)' }}>
                  모델 정책이 이 판정을 자동 채택 대상에서 제외했다.
                </div>
                {verdict.review.reasons.map((r) => (
                  <div key={r}>
                    <strong style={{ fontWeight: 600 }}>{REVIEW_REASON_COPY[r].label}</strong>
                    <span style={{ color: 'var(--text-muted)' }}> — {REVIEW_REASON_COPY[r].detail}</span>
                  </div>
                ))}
                <div style={{ color: 'var(--text-muted)' }}>
                  아래 공정 순서는 참고용으로 남겨 둔다. 설비를 세우는 조치는 검토를 거친 뒤에 할 것.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Card
        title="판정"
        /*
          모델 이름은 빼고 추론 시간만 둔다. 어느 모델이 돌았는지는 위쪽 '판정 엔진' 카드와
          헤드바 배지가 이미 말하고 있고, 판정 카드에서 답해야 할 건 "이 웨이퍼가 무엇인가"다.
          규칙 대체판일 때만은 남긴다 — 학습된 모델의 결과가 아니라는 사실은 판정을 읽는
          방식을 바꾸므로 판정 옆에 있어야 한다.
        */
        sub={`${verdict.engine === 'rule-mock' ? '규칙 기반 대체 (학습 모델 미연결) · ' : ''}추론 ${verdict.inferMs.toFixed(1)} ms`}
      >
        {/*
          헤드라인은 모델 9클래스 1순위 그대로다. 계통(9클래스를 묶은 합산)은 1순위와 다른
          이름을 띄울 수 있어 혼동을 주므로 판정 카드에서 뺐다.
        */}
        <div className="verdict-head">
          <span className="verdict-class">{PATTERN_LABEL[verdict.top]}</span>
          <span className="verdict-prob">{pct(verdict.topScore)}</span>
          <Badge color={URGENCY_COLOR[urgency]} strong>
            {URGENCY_LABEL[urgency]}
          </Badge>
          {SHOW_REVIEW_STATUS &&
            (verdict.review.required ? (
              <Badge color="--warning" strong>검토 필요</Badge>
            ) : (
              <Badge color="--good">자동 채택 가능</Badge>
            ))}
        </div>

        {SHOW_REVIEW_STATUS && verdict.review.note && (
          <p className="section-note" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
            {verdict.review.note}
          </p>
        )}
      </Card>

      {verdict.model && (
        <Card title="모델 출력">
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            {SHOW_REVIEW_STATUS && (
              <Badge color={verdict.model.status === 'ACCEPT' ? '--good' : '--warning'} strong>
                {verdict.model.status}
              </Badge>
            )}
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
            {/*
              임계가 1을 넘는 건 이 판정이 위험하다는 뜻이 아니라 그 클래스가 설정상
              늘 검토로 분류된다는 뜻이다. 판정별 위험 신호처럼 붉게 세우면 안 된다 —
              확률 0.99 든 0.31 이든 똑같이 뜨는 문구라 판정에 대해 알려 주는 게 없다.
              사실은 남기되 색은 뺀다. (모델 담당자가 실제 값을 넣으면 이 문구는 사라진다.)
            */}
            <dt>클래스 임계</dt>
            <dd>
              {verdict.model.classThreshold.toFixed(2)}
              {SHOW_REVIEW_STATUS && verdict.model.classThreshold > 1 && (
                <span style={{ color: 'var(--text-muted)' }}>
                  {' '}
                  — 1을 넘는 값이라 이 클래스는 확률과 무관하게 항상 검토로 분류된다
                </span>
              )}
            </dd>
            {/*
              보조 모델(V3) 출력은 화면에 싣지 않는다 — 판정은 주 모델 하나로 읽는다.
              서버는 여전히 V3 를 돌려 review_reason 을 만들므로, 두 모델이 갈린 사실은
              위쪽 '사람 검토 필요' 사유에 그대로 남는다. 응답 필드도 파싱은 계속한다
              (services/inference.ts) — 다시 띄울 때 계약을 되살릴 필요가 없게.
            */}
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
            ? '모델 원본 확률의 상위 3순위.'
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
