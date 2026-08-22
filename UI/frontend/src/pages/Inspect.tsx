import { useMemo } from 'react';
import { buildPlan } from '../domain/plan';
import { PATTERN_PRESETS, README_EXAMPLES } from '../domain/patterns';
import { ProcessTabs } from '../components/ProcessTabs';
import { ReportPngButton } from '../components/ReportPngButton';
import { VerdictPanel } from '../components/VerdictPanel';
import { WaferGrid, WaferLegend } from '../components/WaferGrid';
import { Badge, Banner, Card, Empty } from '../components/ui';
import { DEFAULT_MODEL_SERVER } from '../services/inference';
import { useApp } from '../state/AppStore';

export function Inspect() {
  const { state, patch, setCell, applyPreset, clearDraft, runInspection, setTab, toggleAction, useModelEngine, useRuleEngine } =
    useApp();
  const { draft, verdict, error, running } = state;

  const plan = useMemo(() => (verdict ? buildPlan(verdict) : null), [verdict]);
  const current = state.history.find((i) => i.id === state.selectedInspectionId) ?? null;

  return (
    <div className="stack">
      {error && <Banner kind="warn">{error}</Banner>}

      {/* ── 판정 엔진 (backend/wafer_final_package_v2) ── */}
      <Card
        title="판정 엔진"
        actions={
          <Badge color={state.engineKind === 'model' ? '--good' : '--warning'} strong>
            {state.engineKind === 'model' ? '실제 모델' : '규칙 대체판'}
          </Badge>
        }
      >
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: 1 }}>
            <span>모델 서버 주소</span>
            <input
              type="text"
              value={state.modelServerUrl}
              onChange={(e) => patch({ modelServerUrl: e.target.value })}
              placeholder={DEFAULT_MODEL_SERVER}
            />
          </label>
          <button
            className="btn btn-primary"
            disabled={state.modelServerStatus === 'checking'}
            onClick={() => useModelEngine(state.modelServerUrl)}
          >
            {state.modelServerStatus === 'checking' ? '확인 중…' : '실제 모델 연결'}
          </button>
          <button className="btn" onClick={useRuleEngine} disabled={state.engineKind === 'rule'}>
            규칙 대체판으로
          </button>
        </div>

        {state.modelServerStatus === 'down' && (
          <Banner kind="warn">
            모델 서버에 연결하지 못했습니다 — {state.modelServerDetail}
            <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>
              <code className="mono">UI/backend/wafer_final_package_v2</code> 폴더에서 서버를 먼저 띄우세요:
              <br />
              <code className="mono">.venv\Scripts\python serve.py</code>
            </div>
          </Banner>
        )}
      </Card>

      <div className="grid-2">
        {/* ── 입력 ── */}
        <div className="stack">
          <Card
            title="패턴 입력"
            sub="드래그로 불량 die를 찍고, 우클릭(또는 Ctrl+클릭)으로 되돌린다."
            actions={
              <button className="btn btn-sm btn-primary" onClick={runInspection} disabled={running}>
                {running ? '판정 중…' : '판정하기'}
              </button>
            }
          >
            <WaferGrid map={draft} editable={!running} onCell={setCell} />
            <WaferLegend />

            <div className="row" style={{ marginTop: 12, gap: 10 }}>
              <button className="btn btn-sm" onClick={clearDraft} disabled={running}>
                전체 지우기
              </button>
              <span className="section-note" style={{ color: 'var(--text-muted)' }}>
                불량 die {draft.filter((c) => c === 2).length}칸 · 웨이퍼 밖{' '}
                {64 - draft.filter((c) => c !== 0).length}칸은 편집되지 않는다.
              </span>
            </div>

            <div className="divider" style={{ margin: '12px 0' }} />

            <div className="card-sub" style={{ marginBottom: 6 }}>프리셋 (비교 기준용)</div>
            <div className="row" style={{ gap: 5 }}>
              {PATTERN_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className="btn btn-sm"
                  disabled={running}
                  onClick={() => applyPreset(p.id)}
                  title={p.intent}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="section-note" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
              프리셋은 정답을 외운 데모가 아니라 비교 기준이다. 직접 그린 임의 패턴도 같은 경로로 처리된다.
            </p>

            <div className="divider" style={{ margin: '12px 0' }} />

            <div className="card-sub" style={{ marginBottom: 6 }}>모델 패키지 예시 입력 (README)</div>
            <div className="row" style={{ gap: 5 }}>
              {README_EXAMPLES.map((ex) => (
                <button
                  key={ex.id}
                  className="btn btn-sm"
                  disabled={running}
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

          <Card title="로트 정보">
            <div className="row" style={{ gap: 10 }}>
              <label className="field" style={{ flex: 1 }}>
                <span>로트 ID</span>
                <input
                  type="text"
                  value={state.lotId}
                  onChange={(e) => patch({ lotId: e.target.value })}
                  disabled={running}
                />
              </label>
              <label className="field" style={{ width: 100 }}>
                <span>웨이퍼 #</span>
                <input
                  type="number"
                  min={1}
                  value={state.waferNo}
                  onChange={(e) => patch({ waferNo: Number(e.target.value) })}
                  disabled={running}
                />
              </label>
            </div>
          </Card>
        </div>

        {/* ── 판정 ── */}
        <div className="stack">
          {verdict ? (
            <VerdictPanel verdict={verdict} />
          ) : (
            <Card title="판정">
              <Empty>판정을 실행하면 결과가 표시됩니다.</Empty>
            </Card>
          )}
        </div>
      </div>

      {/*
        보고서는 상단 탭으로 빠져 있다. 판정할 때마다 그 탭의 대상이 방금 판정으로 갈아끼워지는데,
        탭을 옮기면 맥락이 끊기므로 여기서 바로 건너갈 수 있게 한다.
      */}
      {verdict && plan && current && (
        <Card
          title="점검 보고서"
          sub={`이 판정(${current.lotId} · 웨이퍼 ${current.waferNo})이 보고서 탭의 대상이다`}
          actions={
            <>
              <ReportPngButton inspection={current} plan={plan} />
              <button className="btn btn-sm" onClick={() => setTab('report')}>
                보고서 탭에서 열기 →
              </button>
            </>
          }
        >
          <p className="section-note" style={{ color: 'var(--text-muted)' }}>
            판정하고 바로 한 장 뽑을 때는 여기서 끝내면 된다. 미리보기 · 복사 · <code className="mono">.md</code> 저장은
            보고서 탭에 있다. 판정을 다시 실행하면 보고서도 그 결과로 바뀌므로 따로 만들 필요는 없다.
          </p>
        </Card>
      )}

      {/* ── 원인 추적 (반도체 불량 분석 개선안.xlsx) ── */}
      {verdict && plan && (
        <ProcessTabs
          plan={plan}
          checkedActions={current?.checkedActions ?? []}
          onToggle={(actionId) => {
            if (state.selectedInspectionId) toggleAction(state.selectedInspectionId, actionId);
          }}
        />
      )}
    </div>
  );
}
