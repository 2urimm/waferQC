import { REVIEW_REASON_COPY } from '../config/model';
import { CONFIDENCE_COPY, FAMILIES, confidenceBand, unresolvedPairsFor } from '../config/taxonomy';
import { PATTERN_LABEL } from '../domain/causes';
import type { Verdict } from '../domain/types';
import { ProbabilityBars } from './charts';
import { Badge, Card } from './ui';

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

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

export function VerdictPanel({ verdict }: { verdict: Verdict }) {
  const family = FAMILIES[verdict.family];
  const top = verdict.familyScores[0];
  const second = verdict.familyScores[1];
  const band = confidenceBand(top.probability, second?.probability ?? 0);
  const pairs = unresolvedPairsFor(verdict.family);

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
          모델 1순위: {PATTERN_LABEL[verdict.top]} ({verdict.top}) {pct(verdict.topScore)}
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
          rows={verdict.familyScores.map((s) => ({
            id: s.id,
            label: FAMILIES[s.id].short,
            probability: s.probability,
          }))}
          topId={verdict.family}
        />

        <div className="banner info" style={{ marginTop: 12 }}>
          <span className="caveat-icon" aria-hidden>i</span>
          <div>{CONFIDENCE_COPY[band].note}</div>
        </div>
      </Card>

      <Card
        title="9클래스 확률"
        sub="모델이 내는 원본 확률. 위의 계통 확률은 이걸 묶은 것이라 합이 보존된다."
      >
        <div className="stack" style={{ gap: 10 }}>
          {verdict.patterns.map((p) => (
            <div key={p.id}>
              <div className="row" style={{ gap: 8 }}>
                <strong style={{ fontSize: 13.5 }}>{PATTERN_LABEL[p.id]}</strong>
                <span className="mono" style={{ color: 'var(--text-muted)' }}>{p.id}</span>
                <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
                  {pct(p.probability)}
                </span>
              </div>
              <div className="prob-track" style={{ height: 8, marginTop: 3 }}>
                <div
                  className="prob-fill top"
                  style={{ width: `${Math.max(1, p.withinFamily * 100)}%`, opacity: 0.35 + p.withinFamily * 0.65 }}
                />
              </div>
              <p className="section-note" style={{ marginTop: 5, color: 'var(--text-muted)' }}>
                {p.reason}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="판정 근거" sub="★는 이번 판정을 직접 민 피처">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>피처</th>
                <th>값</th>
                <th style={{ whiteSpace: 'normal' }}>설명</th>
              </tr>
            </thead>
            <tbody>
              {verdict.drivers.map((d) => (
                <tr key={d.feature}>
                  <td style={{ fontWeight: d.effect === 'supports' ? 600 : 400 }}>
                    {d.effect === 'supports' && <span aria-label="판정 근거">★ </span>}
                    {d.label}
                  </td>
                  <td className="mono">{d.value}</td>
                  <td style={{ whiteSpace: 'normal', color: 'var(--text-muted)', minWidth: 260 }}>{d.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {(verdict.caveats.length > 0 || pairs.length > 0) && (
        <Card title="이 판정의 한계" sub="못 하는 걸 못 한다고 말하는 것도 판정 결과의 일부다">
          <div className="stack" style={{ gap: 8 }}>
            {verdict.caveats.map((c) => (
              <div className="caveat" key={c}>
                <span className="caveat-icon" aria-hidden>!</span>
                <div>{c}</div>
              </div>
            ))}
            {pairs.map((p) => (
              <div className="caveat" key={p.pair.join('-')}>
                <span className="caveat-icon" aria-hidden>≈</span>
                <div>
                  <strong>
                    {p.pair[0]} ↔ {p.pair[1]} 미분리
                  </strong>
                  <div style={{ marginTop: 2 }}>{p.reason}</div>
                  <div style={{ marginTop: 2, color: 'var(--text-muted)' }}>가르려면: {p.needs}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
