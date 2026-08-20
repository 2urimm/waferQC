import { useMemo } from 'react';
import { buildPlan } from '../domain/plan';
import { PATTERN_PRESETS, README_EXAMPLES } from '../domain/patterns';
import { ProcessTabs } from '../components/ProcessTabs';
import { ReportPanel } from '../components/ReportPanel';
import { VerdictPanel } from '../components/VerdictPanel';
import { WaferGrid, WaferLegend } from '../components/WaferGrid';
import { Badge, Banner, Card, Empty } from '../components/ui';
import { DEFAULT_MODEL_SERVER } from '../services/inference';
import { useApp } from '../state/AppStore';

export function Inspect() {
  const { state, patch, setCell, applyPreset, clearDraft, runInspection, toggleAction, useModelEngine, useRuleEngine } =
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
        sub="실제 학습 모델(WaferCNNV2 + V3) 서버에 붙이거나, 서버 없이 규칙 대체판으로 돌린다"
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

        {state.modelServerStatus === 'up' && (
          <div className="banner info" style={{ marginTop: 10 }}>
            <span className="caveat-icon" aria-hidden>i</span>
            <div>{state.modelServerDetail}</div>
          </div>
        )}
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

        <p className="section-note" style={{ marginTop: 10, color: 'var(--text-muted)' }}>
          규칙 대체판은 학습된 모델이 아니라 UI를 돌리기 위한 임시 판정기다. 실제 모델에 연결하면 클래스별 임계값·V3
          대조·사분면 방향 판정이 모델 정책 그대로 적용되고, 검토 필요 여부도 UI가 다시 계산하지 않고 서버 판단을
          그대로 쓴다.
        </p>
      </Card>

      <div className="grid-2">
        {/* ── 입력 ── */}
        <div className="stack">
          <Card title="패턴 입력" sub="드래그로 불량 die를 찍고, 우클릭(또는 Ctrl+클릭)으로 되돌린다.">
            <WaferGrid map={draft} editable={!running} onCell={setCell} />
            <WaferLegend />

            <div className="row" style={{ marginTop: 12, gap: 10 }}>
              <button className="btn btn-sm" onClick={clearDraft} disabled={running}>
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
          <Card
            title="판정 실행"
            sub="그린 맵을 그대로 판정 엔진에 넣는다"
            actions={
              <button className="btn btn-sm btn-primary" onClick={runInspection} disabled={running}>
                {running ? '판정 중…' : '판정하기'}
              </button>
            }
          >
            <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
              <div style={{ flex: '0 0 auto', width: 220 }}>
                <WaferGrid map={draft} size={220} />
                <WaferLegend />
              </div>

              <dl className="kv" style={{ flex: 1, minWidth: 180 }}>
                <dt>입력 격자</dt>
                <dd>8×8 (64칸)</dd>
                <dt>불량 die</dt>
                <dd>{draft.filter((c) => c === 2).length}칸</dd>
                <dt>판정 엔진</dt>
                <dd>{state.engineKind === 'model' ? '실제 모델 서버' : '규칙 대체판'}</dd>
                {current && (
                  <>
                    <dt>추론 시간</dt>
                    <dd>{current.elapsedMs.toFixed(1)} ms</dd>
                  </>
                )}
              </dl>
            </div>
          </Card>

          {verdict ? (
            <VerdictPanel verdict={verdict} />
          ) : (
            <Card title="판정">
              <Empty>판정을 실행하면 결과가 표시됩니다.</Empty>
            </Card>
          )}
        </div>
      </div>

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

      {verdict && plan && current && <ReportPanel inspection={current} plan={plan} />}
    </div>
  );
}
