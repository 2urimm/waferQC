import { useEffect, useState } from 'react';
import {
  DISRUPTION_LABEL,
  FACTOR_META,
  PATTERN_LABEL,
  PROCESSES,
  type ProcessId,
} from '../domain/causes';
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
      sub={`연관도 순 · 총 예상 ${plan.totalEtaMin}분 · 지금 확인 가능 ${plan.immediateCount}건 / 이력 대조 필요 ${plan.historyCount}건`}
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
        <Badge>요인 축 {tab.factorSpread}종</Badge>
        <Badge>예상 {tab.totalEtaMin}분</Badge>
        <Badge color={cls === 'restricted' ? '--critical' : cls === 'confidential' ? '--warning' : undefined}>
          {CLASSIFICATION_META[cls].label}
        </Badge>
      </div>
      <p className="section-note" style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
        {tab.meta.character}
      </p>

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
              onAudit={() => onAudit(`${tab.meta.label} / ${c.equipment}`, tab.process)}
            />
          ))}
        </div>
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
  const doneCount = cause.actionable.checks.filter((_, i) => checked.includes(`${cause.id}#${i}`)).length;
  const allDone = doneCount === cause.actionable.checks.length && cause.actionable.checks.length > 0;

  return (
    <div className={`action${allDone ? ' done' : ''}`}>
      <div className="action-head">
        <span className="action-rank">{index}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="action-target">{cause.equipment}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{cause.cause}</div>

          <div className="action-meta">
            <Badge title={FACTOR_META[cause.factor].hint}>{FACTOR_META[cause.factor].label}</Badge>
            <Badge>
              {PATTERN_LABEL[cause.pattern]} {pct(cause.patternProbability)}
            </Badge>
            <Badge color={cause.actionable.disruption === 'high' ? '--warning' : undefined}>
              {DISRUPTION_LABEL[cause.actionable.disruption]} · {cause.actionable.etaMin}분
            </Badge>
            {cause.support === 'strong' && (
              <Badge color="--good" strong>
                ✔ 이번 측정이 지지
              </Badge>
            )}
            {cause.support === 'weak' && <Badge color="--serious">△ 측정과 불일치</Badge>}
            {cause.needsHistory && <Badge>⏱ 이력 대조 필요</Badge>}
          </div>
        </div>
      </div>

      <div className="action-rationale">
        <strong style={{ color: 'var(--text-muted)', fontWeight: 500 }}>기전</strong>
        {'  '}
        {cause.mechanism.join('  →  ')}
      </div>

      {cause.spatialSignature && (
        <div className="action-rationale" style={{ marginTop: 4 }}>
          <strong style={{ color: 'var(--text-muted)', fontWeight: 500 }}>방향성 서명</strong>
          {'  '}
          {cause.spatialSignature}
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
          <div style={{ marginTop: 10 }}>
            <div className="card-sub" style={{ marginBottom: 4 }}>
              확인 항목 {cause.actionable.checks.length > 0 && `(${doneCount}/${cause.actionable.checks.length})`}
            </div>
            <div className="stack" style={{ gap: 3 }}>
              {cause.actionable.checks.map((chk, i) => {
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
              개선안
              {cause.actionable.draft && (
                <span style={{ color: 'var(--serious)' }}> · 초안 (원본 표에 없어 이쪽에서 채운 것 — 검토 필요)</span>
              )}
            </div>
            <ul className="action-checks">
              {cause.actionable.remedy.map((r) => (
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

          {cause.note && (
            <div className="caveat" style={{ marginTop: 10 }}>
              <span className="caveat-icon" aria-hidden>?</span>
              <div>
                <strong>원본 표 확인 필요</strong> — {cause.note}
              </div>
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
