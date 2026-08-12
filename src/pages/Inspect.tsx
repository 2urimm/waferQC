import { useMemo } from 'react';
import { CELL_COUNT } from '../config/hardware';
import { PROCESSES, PROCESS_ORDER, type ProcessId } from '../domain/causes';
import {
  METRICS,
  METRIC_FORM_LABEL,
  deviationPct,
  formatSpec,
  formatValue,
  measurementSec,
  metricsOf,
  specSide,
  type MetricId,
} from '../domain/metrology';
import { buildPlan } from '../domain/plan';
import { PATTERN_PRESETS, README_EXAMPLES } from '../domain/patterns';
import { currentEstimate } from '../domain/scan';
import { ProcessTabs } from '../components/ProcessTabs';
import { ReportPanel } from '../components/ReportPanel';
import { ScanPipeline } from '../components/ScanPipeline';
import { VerdictPanel } from '../components/VerdictPanel';
import { WaferGrid, WaferLegend } from '../components/WaferGrid';
import { Badge, Banner, Card, Empty } from '../components/ui';
import { PROCESS_CLASSIFICATION } from '../services/security';
import { useApp } from '../state/AppStore';

/** 초 단위를 사람이 읽는 단위로 */
function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(0)}초`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 ${Math.round(sec % 60)}초`;
  return `${(sec / 3600).toFixed(1)}시간`;
}

export function Inspect() {
  const {
    state,
    patch,
    setCell,
    applyPreset,
    clearDraft,
    runScan,
    cancelScan,
    scanning,
    toggleAction,
    logAudit,
    setProcess,
    setMetric,
  } = useApp();
  const { draft, frame, verdict, progress, circleMask, linkState, linkError } = state;
  const metric = METRICS[state.metricId];

  const plan = useMemo(() => (verdict ? buildPlan(verdict, state.process) : null), [verdict, state.process]);

  // 지점별 측정값을 툴팁 문구로 — 어느 지점이 스펙 어디를 벗어났는지 바로 읽히게
  const cellDetail = useMemo(() => {
    if (!frame?.measurements) return undefined;
    return frame.measurements.map((m) => {
      if (m === null) return null;
      const side = specSide(m, metric, frame.spec);
      const dev = deviationPct(m, metric, frame.spec);
      const tag = side === 'in' ? '스펙 내' : side === 'low' ? '스펙 하한 미달' : '스펙 상한 초과';
      return `${formatValue(m, metric)} (${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%, ${tag})`;
    });
  }, [frame, metric]);
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

            <div className="divider" style={{ margin: '12px 0' }} />

            <div className="card-sub" style={{ marginBottom: 6 }}>
              모델 패키지 예시 입력 (README)
            </div>
            <div className="row" style={{ gap: 5 }}>
              {README_EXAMPLES.map((ex) => (
                <button
                  key={ex.id}
                  className="btn btn-sm"
                  disabled={scanning}
                  onClick={() => applyPreset(ex.id)}
                  title={`README의 ${ex.label} — 불량 ${ex.defectCells}칸. python app.py --manual 과 같은 입력이다.`}
                >
                  {ex.label}
                </button>
              ))}
            </div>
            <p className="section-note" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
              팀이 실제 모델을 검증할 때 쓰는 입력을 값 그대로 옮겨 왔다. 실제 모델 서버에 연결한 뒤 이걸 돌리면
              <code className="mono"> python app.py --manual</code> 과 같은 판정이 나와야 한다 — 다르면 UI가 뭔가 잘못
              보내고 있다는 뜻이다.
            </p>
          </Card>

          <Card
            title="측정 설정"
            sub="공정마다 재는 지표가 다르다. 그 지표의 스펙을 벗어난 지점이 불량 die가 된다."
          >
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <label className="field" style={{ flex: 1, minWidth: 150 }}>
                <span>공정</span>
                <select
                  value={state.process}
                  onChange={(e) => setProcess(e.target.value as ProcessId)}
                  disabled={scanning}
                >
                  {PROCESS_ORDER.filter((p) => p !== 'COMMON').map((p) => (
                    <option key={p} value={p}>
                      {PROCESSES[p].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ flex: 1, minWidth: 170 }}>
                <span>측정 지표</span>
                <select
                  value={state.metricId}
                  onChange={(e) => setMetric(e.target.value as MetricId)}
                  disabled={scanning}
                >
                  {metricsOf(state.process).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.primary ? ' ★ 주 진단지표' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <Badge>{metric.method}</Badge>
              <Badge>{METRIC_FORM_LABEL[metric.form]}</Badge>
              {metric.destructive && (
                <Badge color="--critical" strong>
                  웨이퍼 소모
                </Badge>
              )}
              <Badge>
                {metric.perWaferSec !== undefined
                  ? `웨이퍼당 ${metric.perWaferSec}초`
                  : `지점당 ${metric.perPointSec}초`}
              </Badge>
            </div>
            <p className="section-note" style={{ marginTop: 6, color: 'var(--text-muted)' }}>
              {metric.reflects}
              {metric.scope && ` · 적용 범위: ${metric.scope}`}
            </p>

            <div className="divider" style={{ margin: '12px 0' }} />

            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <label className="field" style={{ flex: 1 }}>
                <span>{metric.specMode === 'upper' ? `상한값 (${metric.unit})` : `목표값 (${metric.unit})`}</span>
                <input
                  type="number"
                  value={state.spec.target}
                  step="any"
                  disabled={scanning}
                  onChange={(e) => patch({ spec: { ...state.spec, target: Number(e.target.value) } })}
                />
              </label>
              {metric.specMode === 'percent' && (
                <label className="field" style={{ flex: 1 }}>
                  <span>허용 편차 (±%)</span>
                  <input
                    type="number"
                    value={state.spec.tolerancePct}
                    min={0.1}
                    step={0.1}
                    disabled={scanning}
                    onChange={(e) => patch({ spec: { ...state.spec, tolerancePct: Number(e.target.value) } })}
                  />
                </label>
              )}
            </div>
            <p className="section-note" style={{ marginTop: 6 }}>
              판정 기준 <strong>{formatSpec(metric, state.spec)}</strong>
              {metric.specMode === 'percent' && ' — 이 범위를 벗어난 지점이 불량 die다.'}
            </p>

            <div className="banner info" style={{ marginTop: 10 }}>
              <span className="caveat-icon" aria-hidden>i</span>
              <div>
                64지점을 이 방법으로 재면 웨이퍼 한 장에 <strong>{fmtDuration(measurementSec(metric, 64))}</strong>,
                로트 25장이면 {fmtDuration(measurementSec(metric, 64) * 25)} 걸린다. 실제 fab이 전면을 다 재지 않고
                몇 군데만 재는 이유가 이 숫자다.
                {metric.destructive && ' 게다가 이 방법은 웨이퍼를 소모하므로 전수 측정 자체가 불가능하다.'}
              </div>
            </div>
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
                  detail={cellDetail}
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
