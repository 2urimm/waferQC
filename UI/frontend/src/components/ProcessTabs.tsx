import { useEffect, useState } from 'react';
import { CASE_STATUS_SHORT, explainStatus } from '../domain/caseStatus';
import { PATTERN_LABEL, PROCESSES, type ProcessId } from '../domain/causes';
import { METRIC_FORM_LABEL, measurementSec, primaryMetricOf, verificationOf } from '../domain/metrology';
import type { DiagnosisPlan, RankedCause } from '../domain/plan';
import { manualsForCause } from '../services/manuals';
import {
  CLASSIFICATION_META,
  PROCESS_CLASSIFICATION,
  ROLE_META,
  canSeeCause,
  canSeeDetail,
  maskReason,
  type User,
} from '../services/security';
import { Badge, Card } from './ui';

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

interface Props {
  plan: DiagnosisPlan;
  user: User;
  checkedActions: string[];
  onToggle: (actionId: string) => void;
  onAudit: (target: string, process: ProcessId) => void;
}

/**
 * 공정별 원인 탭.
 *
 * "원인이 되는 공정만" 보여준다 — 이번 결함과 연관이 없는 공정은 탭에 없다.
 * 다만 매핑이 없는 공정도 하단에 이름은 남겨 둔다. 안 보이는 것과 "배제되었다"는 건
 * 다르고, 지식베이스가 아직 안 채워진 공정을 배제된 것으로 읽으면 위험하기 때문이다.
 */
export function ProcessTabs({ plan, user, checkedActions, onToggle, onAudit }: Props) {
  const [active, setActive] = useState<ProcessId | null>(plan.tabs[0]?.process ?? null);

  // 판정이 바뀌면 1순위 공정으로 되돌린다
  useEffect(() => {
    setActive(plan.tabs[0]?.process ?? null);
  }, [plan]);

  if (!plan.tabs.length) {
    return (
      <Card title="공정별 원인">
        <div className="empty">
          이번 판정의 후보 패턴에 연결된 원인 매핑이 아직 없습니다.
          <br />
          원인이 없다는 뜻이 아니라 지식베이스가 채워지지 않은 것이므로, 수동 분석이 필요합니다.
        </div>
      </Card>
    );
  }

  const tab = plan.tabs.find((t) => t.process === active) ?? plan.tabs[0];
  const cls = PROCESS_CLASSIFICATION[tab.process];
  const seeCause = canSeeCause(user, tab.process);
  const seeDetail = canSeeDetail(user, tab.process);

  return (
    <Card
      title="공정별 원인 추적"
      sub={`연관도 순 · 지난 12개월 발생 ${plan.totalOccurrences}건 · 이번 방위로 대조 가능 ${plan.immediateCount}건 / 설비 배치 실측 필요 ${plan.layoutCount}건`}
    >
      {/* 탭 스트립 */}
      <div className="row" style={{ gap: 6, marginBottom: 14 }} role="tablist" aria-label="원인 공정">
        {plan.tabs.map((t) => {
          const c = PROCESS_CLASSIFICATION[t.process];
          const on = t.process === tab.process;
          return (
            <button
              key={t.process}
              role="tab"
              aria-selected={on}
              className="btn btn-sm"
              onClick={() => setActive(t.process)}
              style={{
                borderColor: on ? 'var(--series-1)' : 'var(--border-strong)',
                background: on ? 'var(--surface-sunken)' : 'var(--surface-raised)',
                fontWeight: on ? 600 : 400,
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{t.rank}</span>
              {t.meta.label}
              <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{pct(t.relevance)}</span>
              {c !== 'internal' && (
                <span style={{ color: 'var(--text-muted)' }} title={CLASSIFICATION_META[c].label}>
                  🔒
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 선택된 공정 */}
      <div className="row" style={{ gap: 8, marginBottom: 6 }}>
        <h3 style={{ fontSize: 15 }}>
          {tab.rank}순위 · {tab.meta.label}
        </h3>
        <Badge>연관도 {pct(tab.relevance)}</Badge>
        <Badge>원인 {tab.causes.length}건</Badge>
        <Badge title="이 공정의 해당 원인들이 지난 12개월 대응 Log에 기록된 총 발생 건수">
          이력 {tab.occurrences}건
        </Badge>
        {tab.monitoringCount > 0 && (
          <Badge color="--warning" title="대응 Log에 '모니터링 중 (효과검증 진행)'으로 기록된 원인">
            효과검증 중 {tab.monitoringCount}건
          </Badge>
        )}
        <Badge color={cls === 'restricted' ? '--critical' : cls === 'confidential' ? '--warning' : undefined}>
          {CLASSIFICATION_META[cls].label}
        </Badge>
      </div>
      <p className="section-note" style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
        {tab.meta.character}
      </p>
      {(() => {
        const pm = primaryMetricOf(tab.process);
        if (!pm) return null;
        return (
          <p className="section-note" style={{ marginBottom: 12 }}>
            <strong style={{ fontWeight: 600 }}>주 진단지표</strong> {pm.label} · {pm.method} —{' '}
            <span style={{ color: 'var(--text-muted)' }}>{pm.reflects}</span>
          </p>
        );
      })()}

      {!seeCause ? (
        <div className="banner warn">
          <span className="caveat-icon" aria-hidden>🔒</span>
          <div>
            <strong>열람 제한</strong>
            <div style={{ marginTop: 3 }}>{maskReason(user, tab.process)}</div>
            <div style={{ marginTop: 3, color: 'var(--text-muted)' }}>
              현재 역할: {ROLE_META[user.role].label} · 이 공정의 원인 {tab.causes.length}건이 가려졌습니다.
            </div>
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {tab.causes.map((c, i) => (
            <CauseCard
              key={c.id}
              cause={c}
              index={i + 1}
              seeDetail={seeDetail}
              maskNote={maskReason(user, tab.process)}
              checked={checkedActions}
              onToggle={onToggle}
              onAudit={() => onAudit(`${tab.meta.label} / ${c.name}`, tab.process)}
            />
          ))}
        </div>
      )}

      {tab.exclusions.length > 0 && (
        <>
          <div className="divider" style={{ margin: '16px 0 10px' }} />
          <div className="card-sub" style={{ marginBottom: 6 }}>
            이 공정이 이번 후보 유형을 유발하지 않는다고 본 근거
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {tab.exclusions.map((e) => (
              <div key={e.pattern} className="section-note" style={{ color: 'var(--text-muted)' }}>
                <strong style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{PATTERN_LABEL[e.pattern]}</strong>{' '}
                {e.reason}
              </div>
            ))}
          </div>
        </>
      )}

      {plan.processesWithoutMapping.length > 0 && (
        <>
          <div className="divider" style={{ margin: '16px 0 10px' }} />
          <div className="card-sub" style={{ marginBottom: 6 }}>이번 결함과 매핑된 원인이 없는 공정</div>
          <div className="row" style={{ gap: 6 }}>
            {plan.processesWithoutMapping.map((p) => (
              <Badge key={p}>{PROCESSES[p].short}</Badge>
            ))}
          </div>
          <p className="section-note" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
            배제되었다는 뜻이 아니라 원인 매트릭스에 해당 항목이 아직 없다는 뜻이다. 위 공정들에서 답이 안 나오면 여기부터 수동으로
            채워 나가야 한다.
          </p>
        </>
      )}
    </Card>
  );
}

function CauseCard({
  cause,
  index,
  seeDetail,
  maskNote,
  checked,
  onToggle,
  onAudit,
}: {
  cause: RankedCause;
  index: number;
  seeDetail: boolean;
  maskNote: string;
  checked: string[];
  onToggle: (id: string) => void;
  onAudit: () => void;
}) {
  const manuals = manualsForCause(cause.id);
  const verification = verificationOf(cause);
  const doneCount = cause.resolution.filter((_, i) => checked.includes(`${cause.id}#${i}`)).length;
  const allDone = doneCount === cause.resolution.length && cause.resolution.length > 0;

  return (
    <div className={`action${allDone ? ' done' : ''}`}>
      <div className="action-head">
        <span className="action-rank">{index}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="action-target">{cause.name}</div>

          <div className="action-meta">
            <Badge title="엑셀 개선안의 불량 유형 번호 — ①이 그 공정의 대표 유형이다">
              유형 {cause.variant === 1 ? '①' : '②'}
            </Badge>
            <Badge>
              {PATTERN_LABEL[cause.pattern]} {pct(cause.patternProbability)}
            </Badge>
            {cause.occurrences > 0 && (
              <Badge title={`대응 Log 관리번호 ${cause.logIds.join(', ')}`}>
                12개월 {cause.occurrences}회
              </Badge>
            )}
            {cause.support === 'strong' && (
              <Badge color="--good" strong>
                ✔ 이번 측정이 지지
              </Badge>
            )}
            {cause.support === 'weak' && <Badge color="--serious">△ 측정과 불일치</Badge>}
            {cause.needsLayout && <Badge>⚙ 설비 배치 실측 필요</Badge>}
            {cause.caseState.status === 'monitoring' && <Badge color="--warning">효과검증 중</Badge>}
          </div>
        </div>
      </div>

      <div className="action-rationale">
        <strong style={{ color: 'var(--text-muted)', fontWeight: 500 }}>기전</strong>
        {'  '}
        {cause.mechanism.join('  →  ')}
      </div>

      <div className="action-rationale" style={{ marginTop: 4 }}>
        <strong style={{ color: 'var(--text-muted)', fontWeight: 500 }}>웨이퍼맵 형태</strong>
        {'  '}
        {cause.waferMap}
      </div>

      {cause.directional && (
        <div className="action-rationale" style={{ marginTop: 4 }}>
          <strong style={{ color: 'var(--text-muted)', fontWeight: 500 }}>방향성</strong>
          {'  '}
          {cause.directional.label}
          {cause.directional.kind === 'layout' && (
            <span style={{ color: 'var(--text-muted)' }}>
              {'  '}— 각도가 설비 배치에 달려 있어 실측 wafer map 없이는 방위를 못 박는다
            </span>
          )}
        </div>
      )}

      {cause.supportNote && (
        <div className="reorder-note" style={{ borderLeftColor: cause.support === 'strong' ? 'var(--good)' : cause.support === 'weak' ? 'var(--serious)' : 'var(--series-1)' }}>
          {cause.supportNote}
        </div>
      )}

      {!seeDetail ? (
        <div className="caveat" style={{ marginTop: 10, borderLeftColor: 'var(--critical)' }}>
          <span className="caveat-icon" aria-hidden>🔒</span>
          <div>확인 항목과 개선안은 가려졌습니다. {maskNote}</div>
        </div>
      ) : (
        <>
          {verification && (
            <div
              style={{
                marginTop: 10,
                padding: '9px 11px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-sunken)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>확인 계측</span>
                <Badge strong>{verification.metric.label}</Badge>
                <Badge>{verification.metric.method}</Badge>
                <Badge>{METRIC_FORM_LABEL[verification.metric.form]}</Badge>
                {verification.metric.destructive && (
                  <Badge color="--critical" strong>
                    웨이퍼 소모
                  </Badge>
                )}
                <Badge>
                  {verification.metric.perWaferSec !== undefined
                    ? `웨이퍼당 ${verification.metric.perWaferSec}초`
                    : `64지점 ${Math.round(measurementSec(verification.metric, 64) / 60)}분`}
                </Badge>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {verification.expect}
              </div>
              {verification.note && (
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{verification.note}</div>
              )}
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <div className="card-sub" style={{ marginBottom: 4 }}>
              해결 · 즉시 대응 {cause.resolution.length > 0 && `(${doneCount}/${cause.resolution.length})`}
            </div>
            <div className="stack" style={{ gap: 3 }}>
              {cause.resolution.map((chk, i) => {
                const id = `${cause.id}#${i}`;
                return (
                  <label className="check" key={id}>
                    <input
                      type="checkbox"
                      checked={checked.includes(id)}
                      onChange={() => {
                        onToggle(id);
                        onAudit();
                      }}
                    />
                    <span style={{ color: checked.includes(id) ? 'var(--text-muted)' : undefined }}>{chk}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div className="card-sub" style={{ marginBottom: 4 }}>
              개선 · 재발방지
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                {' '}
                — 오늘 하는 일이 아니라 공정 담당이 계획을 잡을 것
              </span>
            </div>
            <ul className="action-checks">
              {cause.improvement.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>

          {manuals.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="card-sub" style={{ marginBottom: 4 }}>참조 매뉴얼</div>
              <div className="stack" style={{ gap: 5 }}>
                {manuals.map((m) => (
                  <ManualRow key={m.id} title={m.title} revision={m.revision} section={m.section} path={m.path} url={m.url} />
                ))}
              </div>
            </div>
          )}

          {cause.logIds.length > 0 && (
            <div className="section-note" style={{ marginTop: 10, color: 'var(--text-muted)' }}>
              대응 Log {cause.logIds.join(', ')} · 지난 12개월 {cause.occurrences}회 기록
              {cause.metrology && ` · 확인 계측 ${cause.metrology}`}
              {cause.lastSeen && ` · 마지막 ${cause.lastSeen}`} · 상태{' '}
              {CASE_STATUS_SHORT[cause.caseState.status]}
              <div style={{ marginTop: 3 }}>{explainStatus(cause.caseState)}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ManualRow({
  title,
  revision,
  section,
  path,
  url,
}: {
  title: string;
  revision: string;
  section?: string;
  path: string;
  url?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div style={{ fontSize: 12.5 }}>
      <div className="row" style={{ gap: 6 }}>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--series-1)' }}>
            {title}
          </a>
        ) : (
          <span>{title}</span>
        )}
        <Badge>{revision}</Badge>
        {section && <span style={{ color: 'var(--text-muted)' }}>{section}</span>}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 2 }}>
        <code className="mono" style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>
          {path}
        </code>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            navigator.clipboard?.writeText(path).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              },
              () => setCopied(false),
            );
          }}
          title="브라우저는 보안상 사내 파일 경로를 직접 열 수 없어 경로를 복사한다"
        >
          {copied ? '복사됨' : '경로 복사'}
        </button>
      </div>
    </div>
  );
}
