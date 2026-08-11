import { useMemo, useState } from 'react';
import { FAMILIES, FAMILY_ORDER, type FamilyId } from '../config/taxonomy';
import { PATTERN_LABEL } from '../domain/causes';
import { buildPlan } from '../domain/plan';
import { ProcessTabs } from '../components/ProcessTabs';
import { ReportPanel } from '../components/ReportPanel';
import { VerdictPanel } from '../components/VerdictPanel';
import { WaferGrid, WaferLegend } from '../components/WaferGrid';
import { Badge, Card, Empty } from '../components/ui';
import { useApp } from '../state/AppStore';

export function History() {
  const { state, patch, toggleAction, setResolution, reseedHistory, logAudit } = useApp();
  const [filter, setFilter] = useState<FamilyId | 'ALL'>('ALL');
  const [lotQuery, setLotQuery] = useState('');

  const rows = useMemo(
    () =>
      state.history.filter(
        (h) =>
          (filter === 'ALL' || h.verdict.family === filter) &&
          (lotQuery.trim() === '' || h.lotId.toLowerCase().includes(lotQuery.trim().toLowerCase())),
      ),
    [state.history, filter, lotQuery],
  );

  const selected = state.history.find((h) => h.id === state.selectedInspectionId) ?? null;
  const plan = useMemo(() => (selected ? buildPlan(selected.verdict) : null), [selected]);

  return (
    <div className="stack">
      <Card
        title="검사 이력"
        sub={`${rows.length}건 / 전체 ${state.history.length}건 · 브라우저 로컬 저장 (실제로는 MES·DB에 붙어야 하는 자리)`}
        actions={
          <button className="btn btn-sm" onClick={reseedHistory} title="가상 이력을 다시 생성한다">
            시드 재생성
          </button>
        }
      >
        {/* 필터는 한 줄에 모아 둔다 — 카드마다 흩어 놓지 않는다 */}
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <label className="field" style={{ width: 180 }}>
            <span>계통</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value as FamilyId | 'ALL')}>
              <option value="ALL">전체</option>
              {FAMILY_ORDER.map((f) => (
                <option key={f} value={f}>
                  {FAMILIES[f].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ width: 200 }}>
            <span>로트 검색</span>
            <input type="text" value={lotQuery} onChange={(e) => setLotQuery(e.target.value)} placeholder="L26C" />
          </label>
        </div>

        {rows.length === 0 ? (
          <Empty>조건에 맞는 이력이 없습니다.</Empty>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>로트</th>
                  <th className="num">W#</th>
                  <th>계통</th>
                  <th>최유력 패턴</th>
                  <th className="num">확률</th>
                  <th className="num">점검</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 120).map((h) => {
                  const top = h.verdict.patterns[0];
                  const on = h.id === state.selectedInspectionId;
                  return (
                    <tr
                      key={h.id}
                      className="clickable"
                      onClick={() => patch({ selectedInspectionId: h.id })}
                      style={{ background: on ? 'var(--surface-sunken)' : undefined }}
                    >
                      <td>{new Date(h.capturedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>{h.lotId}</td>
                      <td className="num">{h.waferNo}</td>
                      <td style={{ fontWeight: h.verdict.family === 'NORMAL' ? 400 : 600 }}>
                        {FAMILIES[h.verdict.family].short}
                      </td>
                      <td>{top ? PATTERN_LABEL[top.id] : '—'}</td>
                      <td className="num">{top ? `${(top.probability * 100).toFixed(0)}%` : '—'}</td>
                      <td className="num">{h.checkedActions.length || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && plan && (
        <>
          <div className="grid-2">
            <Card
              title={`${selected.lotId} · #${selected.waferNo}`}
              sub={new Date(selected.capturedAt).toLocaleString('ko-KR')}
            >
              <WaferGrid map={selected.map} />
              <WaferLegend />
              <div className="row" style={{ marginTop: 10, gap: 6 }}>
                <Badge>{selected.source === 'mock' ? '가상 장치' : '실제 보드'}</Badge>
                <Badge>프레임 {selected.elapsedMs.toFixed(1)} ms</Badge>
                <Badge>{selected.verdict.engineVersion}</Badge>
              </div>

              <div className="divider" style={{ margin: '14px 0' }} />

              <label className="field">
                <span>조치 결론 (엔지니어 기록)</span>
                <textarea
                  value={selected.resolution ?? ''}
                  placeholder="확인 결과와 조치 내용을 남기세요. 다음에 같은 패턴이 나왔을 때 이 기록이 첫 단서가 됩니다."
                  onChange={(e) => setResolution(selected.id, e.target.value)}
                />
              </label>
            </Card>

            <VerdictPanel verdict={selected.verdict} />
          </div>

          <ProcessTabs
            plan={plan}
            user={state.user}
            checkedActions={selected.checkedActions}
            onToggle={(actionId) => toggleAction(selected.id, actionId)}
            onAudit={(target) => logAudit('view-detail', target)}
          />

          <ReportPanel
            inspection={selected}
            plan={plan}
            user={state.user}
            onAudit={(action, target, classification) => logAudit(action, target, classification)}
          />
        </>
      )}
    </div>
  );
}
