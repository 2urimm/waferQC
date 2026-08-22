import { useMemo } from 'react';
import { buildPlan } from '../domain/plan';
import { ReportPanel } from '../components/ReportPanel';
import { Card, Empty } from '../components/ui';
import { useApp } from '../state/AppStore';

/**
 * 보고서 탭.
 *
 * 검사 탭에서 방금 낸 판정을 그대로 받아 한 장짜리 점검 보고서로 만든다.
 * 판정을 먼저 실행해야 내용이 생기므로, 없을 때는 어디로 가야 하는지만 알려 준다.
 */
export function Report() {
  const { state, setTab } = useApp();
  const current = state.history.find((i) => i.id === state.selectedInspectionId) ?? null;
  const plan = useMemo(() => (current ? buildPlan(current.verdict) : null), [current]);

  if (!current || !plan) {
    return (
      <Card title="점검 보고서">
        <Empty>
          아직 보고서로 만들 판정이 없습니다.
          <div style={{ marginTop: 6 }}>
            검사 탭에서 패턴을 그리고 <strong>판정하기</strong>를 누르면 그 결과가 여기 보고서가 됩니다.
            <br />
            이력 탭에서 지난 건을 골라도 됩니다.
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-sm btn-primary" onClick={() => setTab('inspect')}>
              검사 탭으로 가기
            </button>
          </div>
        </Empty>
      </Card>
    );
  }

  return (
    <div className="stack">
      <ReportPanel inspection={current} plan={plan} />
      <p className="section-note" style={{ color: 'var(--text-muted)' }}>
        검사 탭에서 판정을 다시 실행하거나 이력 탭에서 다른 건을 고르면 이 보고서가 그 결과로 바뀐다.
      </p>
    </div>
  );
}
