import { useMemo } from 'react';
import { CELL_COUNT } from '../config/hardware';
import { buildPlan } from '../domain/plan';
import { PATTERN_PRESETS } from '../domain/patterns';
import { currentEstimate } from '../domain/scan';
import { ProcessTabs } from '../components/ProcessTabs';
import { ReportPanel } from '../components/ReportPanel';
import { ScanPipeline } from '../components/ScanPipeline';
import { VerdictPanel } from '../components/VerdictPanel';
import { WaferGrid, WaferLegend } from '../components/WaferGrid';
import { Badge, Banner, Card, Empty } from '../components/ui';
import { PROCESS_CLASSIFICATION } from '../services/security';
import { useApp } from '../state/AppStore';

export function Inspect() {
  const { state, patch, setCell, applyPreset, clearDraft, runScan, cancelScan, scanning, toggleAction, logAudit } =
    useApp();
  const { draft, frame, verdict, progress, circleMask, linkState, linkError } = state;

  const plan = useMemo(() => (verdict ? buildPlan(verdict) : null), [verdict]);
  const est = useMemo(() => currentEstimate(state.timing, circleMask), [state.timing, circleMask]);

  const current = state.history.find((i) => i.id === state.selectedInspectionId) ?? null;
  const shown = frame?.cells ?? draft;
  const connected = linkState === 'connected';

  return (
    <div className="stack">
      {linkError && <Banner kind="warn">{linkError}</Banner>}

      <div className="grid-2">
        {/* ── 입력 ── */}
        <div className="stack">
          <Card
            title="패턴 입력"
            sub="드래그로 불량 die를 찍고, 우클릭(또는 Ctrl+클릭)으로 되돌린다. 이 패턴이 하드웨어에 래치된다."
          >
            <WaferGrid map={draft} editable={!scanning} onCell={setCell} />
            <WaferLegend />

            <div className="row" style={{ marginTop: 12, gap: 10 }}>
              <button className="btn btn-sm" onClick={clearDraft} disabled={scanning}>
                전체 지우기
              </button>
              <span className="section-note" style={{ color: 'var(--text-muted)' }}>
                웨이퍼 밖 {64 - draft.filter((c) => c !== 0).length}칸은 원형 웨이퍼 밖이라 편집되지 않는다.
              </span>
            </div>

            <div className="divider" style={{ margin: '12px 0' }} />

            <div className="card-sub" style={{ marginBottom: 6 }}>프리셋 (비교 기준용)</div>
            <div className="row" style={{ gap: 5 }}>
              {PATTERN_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className="btn btn-sm"
                  disabled={scanning}
                  onClick={() => applyPreset(p.id)}
                  title={p.intent}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="section-note" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
              프리셋은 정답을 외운 데모가 아니라 비교 기준이다. 직접 그린 임의 패턴도 같은 경로로 처리된다 —
              그게 이 시스템이 실제로 동작한다는 증거다.
            </p>
          </Card>

          <Card title="로트 정보">
            <div className="row" style={{ gap: 10 }}>
              <label className="field" style={{ flex: 1 }}>
                <span>로트 ID</span>
                <input
                  type="text"
                  value={state.lotId}
                  onChange={(e) => patch({ lotId: e.target.value })}
                  disabled={scanning}
                />
              </label>
              <label className="field" style={{ width: 100 }}>
                <span>웨이퍼 #</span>
                <input
                  type="number"
                  min={1}
                  value={state.waferNo}
                  onChange={(e) => patch({ waferNo: Number(e.target.value) })}
                  disabled={scanning}
                />
              </label>
            </div>
          </Card>
        </div>

        {/* ── 스캔 / 결과 ── */}
        <div className="stack">
          <Card
            title="스캔 파이프라인"
            sub={`74HC595 래치 → CD4067 ${CELL_COUNT}채널 순차 판독 → UART → 분류기`}
            actions={
              <>
                <Badge color={connected ? '--good' : '--critical'}>
                  {connected ? '연결됨' : linkState === 'connecting' ? '연결 중' : '미연결'}
                </Badge>
                {scanning ? (
                  <button className="btn btn-sm" onClick={cancelScan}>
                    취소
                  </button>
                ) : (
                  <button className="btn btn-sm btn-primary" onClick={runScan} disabled={!connected}>
                    스캔 실행
                  </button>
                )}
              </>
            }
          >
            {!connected && (
              <Banner kind="warn">
                장비 탭에서 장치를 연결하면 스캔할 수 있습니다. 실제 보드가 없어도 가상 장치로 전 구간이 동작합니다.
              </Banner>
            )}

            <div style={{ marginTop: connected ? 0 : 12 }}>
              <ScanPipeline progress={progress} />
            </div>

            <div className="divider" style={{ margin: '14px 0' }} />

            <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
              <div style={{ flex: '0 0 auto', width: 220 }}>
                <WaferGrid
                  map={shown}
                  values={frame?.values}
                  readCount={scanning && progress.phase === 'scan' ? progress.read : undefined}
                  activeIndex={scanning && progress.phase === 'scan' ? progress.read - 1 : undefined}
                  size={220}
                />
                <WaferLegend />
              </div>

              <dl className="kv" style={{ flex: 1, minWidth: 180 }}>
                <dt>측정 셀</dt>
                <dd>{est.cellCount}칸 · CD4067 {est.muxCount}개</dd>
                <dt>셀당 판독</dt>
                <dd>{est.perCellUs.toFixed(0)} µs</dd>
                <dt>프레임 예상</dt>
                <dd>{est.totalMs.toFixed(1)} ms ({est.fps.toFixed(0)} fps)</dd>
                {frame && (
                  <>
                    <dt>실제 프레임</dt>
                    <dd>{frame.elapsedMs.toFixed(1)} ms</dd>
                    <dt>측정 경로</dt>
                    <dd>{frame.source === 'mock' ? '가상 장치' : '실제 보드'}</dd>
                  </>
                )}
              </dl>
            </div>

            {scanning && (
              <p className="section-note" style={{ marginTop: 10, color: 'var(--text-muted)' }}>
                화면의 스캔 속도는 관찰용으로 늘린 것이다. 실제 보드 기준 예상 시간은 위의 {est.totalMs.toFixed(1)} ms다.
              </p>
            )}
          </Card>

          {verdict ? <VerdictPanel verdict={verdict} /> : <Card title="판정"><Empty>스캔을 실행하면 판정이 표시됩니다.</Empty></Card>}
        </div>
      </div>

      {/* ── 원인 추적 ── */}
      {verdict && plan && (
        <ProcessTabs
          plan={plan}
          user={state.user}
          checkedActions={current?.checkedActions ?? []}
          onToggle={(actionId) => {
            if (state.selectedInspectionId) toggleAction(state.selectedInspectionId, actionId);
          }}
          onAudit={(target, process) => logAudit('view-detail', target, PROCESS_CLASSIFICATION[process])}
        />
      )}

      {verdict && plan && current && (
        <ReportPanel
          inspection={current}
          plan={plan}
          user={state.user}
          onAudit={(action, target, classification) => logAudit(action, target, classification)}
        />
      )}
    </div>
  );
}
