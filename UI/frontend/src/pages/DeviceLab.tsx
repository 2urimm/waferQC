import { useMemo } from 'react';
import {
  ADC_BITS,
  CELL_COUNT,
  CIRCLE_MASK_CELL_COUNT,
  MUX_CHANNELS,
  MUX_COUNT,
  SHIFT_REGISTER_BITS,
  type ScanOrder,
} from '../config/hardware';
import { currentEstimate, tradeoffCurve } from '../domain/scan';
import { LineChart } from '../components/charts';
import { Badge, Banner, Card, Stat } from '../components/ui';
import { WIRE_PROTOCOL, serialSupported } from '../services/deviceLink';
import { DEFAULT_MODEL_SERVER } from '../services/inference';
import {
  AUDIT_ACTION_LABEL,
  CLASSIFICATION_META,
  DEMO_USERS,
  PROCESS_CLASSIFICATION,
  ROLE_META,
} from '../services/security';
import { PROCESSES, PROCESS_ORDER } from '../domain/causes';
import { useApp } from '../state/AppStore';

export function DeviceLab() {
  const { state, patch, connect, disconnect, setUser, useModelEngine, useRuleEngine } = useApp();
  const { timing, circleMask, noise, visualDurationMs, scanOrder, linkState, linkKind } = state;

  const est = useMemo(() => currentEstimate(timing, circleMask), [timing, circleMask]);
  const curve = useMemo(() => tradeoffCurve(timing), [timing]);

  const points = curve.map((p, i) => ({
    label: p.label,
    x: i,
    y: p.totalMs,
    emphasis: p.current,
    detail: `${p.cellCount}칸 · CD4067 ${p.muxCount}개 · ${p.fps.toFixed(1)} fps`,
  }));

  return (
    <div className="stack">
      <div className="grid-2">
        <Card
          title="장치 연결"
          sub="실제 보드가 없어도 가상 장치로 전 구간이 동작한다"
          actions={
            <Badge color={linkState === 'connected' ? '--good' : linkState === 'error' ? '--critical' : undefined}>
              {linkState === 'connected' ? '연결됨' : linkState === 'connecting' ? '연결 중' : linkState === 'error' ? '오류' : '미연결'}
            </Badge>
          }
        >
          <div className="row" style={{ gap: 10 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>연결 방식</span>
              <select
                value={linkKind}
                onChange={(e) => patch({ linkKind: e.target.value as 'mock' | 'serial' })}
                disabled={linkState === 'connected'}
              >
                <option value="mock">가상 장치 (Mock)</option>
                <option value="serial">실제 보드 (Web Serial) — 미구현</option>
              </select>
            </label>
            {linkState === 'connected' ? (
              <button className="btn" onClick={disconnect} style={{ alignSelf: 'flex-end' }}>
                연결 해제
              </button>
            ) : (
              <button className="btn btn-primary" onClick={connect} style={{ alignSelf: 'flex-end' }}>
                연결
              </button>
            )}
          </div>

          {linkKind === 'serial' && (
            <Banner kind="warn">
              시리얼 연결은 아직 구현되지 않았습니다. 브라우저 Web Serial 지원: {serialSupported() ? '있음' : '없음'}.
              구현 자리는 <code className="mono">services/deviceLink.ts</code>의 <code className="mono">SerialDeviceLink</code>입니다.
            </Banner>
          )}

          <div className="divider" style={{ margin: '14px 0' }} />

          <div className="grid-3" style={{ gap: 12 }}>
            <Stat label="측정 셀" value={`${est.cellCount}칸`} note={`CD4067 ${est.muxCount}개`} />
            <Stat label="프레임 시간" value={`${est.totalMs.toFixed(1)} ms`} note={`${est.fps.toFixed(0)} fps`} />
            <Stat label="셀당 판독" value={`${est.perCellUs.toFixed(0)} µs`} note="주소+정착+ADC+오버헤드" />
          </div>

          <div className="divider" style={{ margin: '14px 0' }} />

          <dl className="kv">
            <dt>MUX 채널</dt>
            <dd>CD4067 · {MUX_CHANNELS}채널 (S0~S3)</dd>
            <dt>시프트 레지스터</dt>
            <dd>74HC595 · {SHIFT_REGISTER_BITS}bit × {est.shiftRegisterCount}개</dd>
            <dt>ADC</dt>
            <dd>{ADC_BITS}bit</dd>
            <dt>스캔 분해</dt>
            <dd>
              스캔 {est.scanMs.toFixed(1)} ms · 래치 {est.latchMs.toFixed(2)} ms · 전송 {est.transferMs.toFixed(1)} ms
            </dd>
          </dl>
        </Card>

        <Card
          title="판정 엔진"
          sub="규칙 대체판과 실제 학습 모델 중 무엇으로 판정할지"
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
                <code className="mono">wafer_final_package</code> 폴더에서 서버를 먼저 띄우세요:
                <br />
                <code className="mono">.venv\Scripts\python serve.py</code>
              </div>
            </Banner>
          )}

          <p className="section-note" style={{ marginTop: 10, color: 'var(--text-muted)' }}>
            규칙 대체판은 학습된 모델이 아니라 UI를 돌리기 위한 임시 판정기다. 실제 모델(WaferCNNV2 + V3)에
            연결하면 클래스별 임계값·V3 대조·사분면 방향 판정이 모델 정책 그대로 적용된다. 특히 검토 필요 여부는
            UI가 다시 계산하지 않고 서버 판단을 그대로 쓴다.
          </p>
        </Card>

        <Card title="측정 파라미터">
          <div className="stack" style={{ gap: 12 }}>
            <div className="banner info">
              <span className="caveat-icon" aria-hidden>i</span>
              <div>
                양/불 판정 기준(공정·지표·스펙)은 <strong>검사</strong> 탭에서 설정한다. 웨이퍼 맵은 공정마다
                재는 지표가 다르고, 그 지표의 스펙을 벗어난 지점이 불량 die가 되기 때문이다.
              </div>
            </div>

            <label className="field">
              <span>센서 노이즈 (가상 장치) — {noise.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={0.3}
                step={0.01}
                value={noise}
                onChange={(e) => patch({ noise: Number(e.target.value) })}
              />
            </label>

            <label className="field">
              <span>관찰용 스캔 배속 — {(visualDurationMs / 1000).toFixed(1)}초</span>
              <input
                type="range"
                min={400}
                max={6000}
                step={100}
                value={visualDurationMs}
                onChange={(e) => patch({ visualDurationMs: Number(e.target.value) })}
              />
            </label>
            <p className="section-note" style={{ color: 'var(--text-muted)', marginTop: -6 }}>
              실제 스캔은 {est.totalMs.toFixed(1)} ms라 눈으로 따라갈 수 없어 화면에서만 늘려 보여준다. 판정과 기록에는
              실제 예상 시간이 쓰인다.
            </p>

            <label className="field">
              <span>스캔 순서</span>
              <select value={scanOrder} onChange={(e) => patch({ scanOrder: e.target.value as ScanOrder })}>
                <option value="bank">뱅크 순 (CD4067 단위로 순차 — 실제 배선 순서)</option>
                <option value="raster">래스터 순 (행 우선 — 디버깅용)</option>
              </select>
            </label>

            <label className="check">
              <input type="checkbox" checked={circleMask} onChange={(e) => patch({ circleMask: e.target.checked })} />
              <span>
                원형 마스크 적용 ({CIRCLE_MASK_CELL_COUNT} / {CELL_COUNT}칸)
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  실제 웨이퍼는 원형이라 정사각 격자의 네 모서리는 웨이퍼 밖이다. 켜면 {CELL_COUNT - CIRCLE_MASK_CELL_COUNT}
                  칸이 빠지고, 그만큼 MUX 채널이 노는 셈이 된다 — 원형 웨이퍼를 정사각 어레이로 덮을 때 생기는 실제 손실이다.
                </div>
              </span>
            </label>
          </div>
        </Card>
      </div>

      <Card
        title="해상도 – 측정시간 트레이드오프"
        sub={`CD4067은 한 번에 한 채널만 연다. 셀이 늘면 ADC 변환도 그대로 늘어난다. 표는 정사각 N×N 기준이라 8×8 행은 64칸이고, 현재 운전점은 원형 마스크로 ${est.cellCount}칸이라 ${est.totalMs.toFixed(1)} ms다.`}
      >
        <LineChart
          points={points}
          height={210}
          logX
          yFormat={(v) => (v >= 100 ? `${v.toFixed(0)}ms` : `${v.toFixed(1)}ms`)}
          labelLast={false}
          ariaLabel="격자 해상도별 프레임 측정 시간"
          tableHead={['격자', '프레임 시간']}
        />

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data">
            <thead>
              <tr>
                <th>격자</th>
                <th className="num">셀</th>
                <th className="num">CD4067</th>
                <th className="num">스캔</th>
                <th className="num">전송</th>
                <th className="num">프레임</th>
                <th className="num">fps</th>
              </tr>
            </thead>
            <tbody>
              {curve.map((p) => (
                <tr key={p.label} style={{ fontWeight: p.current ? 600 : 400 }}>
                  <td>
                    {p.label}
                    {p.current && (
                      <span style={{ color: 'var(--series-1)' }}>
                        {' '}
                        ← 현재{circleMask ? ` (마스크 적용 시 ${est.cellCount}칸 · ${est.totalMs.toFixed(1)} ms)` : ''}
                      </span>
                    )}
                  </td>
                  <td className="num">{p.cellCount}</td>
                  <td className="num">{p.muxCount}</td>
                  <td className="num">{p.scanMs.toFixed(1)} ms</td>
                  <td className="num">{p.transferMs.toFixed(1)} ms</td>
                  <td className="num">{p.totalMs.toFixed(1)} ms</td>
                  <td className="num">{p.fps.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="section-note" style={{ marginTop: 10 }}>
          현재 구성은 측정 셀 {est.cellCount}칸에 프레임당 {est.totalMs.toFixed(1)} ms, CD4067 {MUX_COUNT}개다. 흔히 쓰는
          52×52 웨이퍼맵 해상도로 가면 같은 방식으로 CD4067이 {curve[curve.length - 1].muxCount}개 필요하고, 정사각 기준
          8×8 대비 프레임이 {(curve[curve.length - 1].totalMs / curve[1].totalMs).toFixed(0)}배로 늘어난다. 해상도와 측정
          시간이 트레이드오프 관계라는 게 이 표의 숫자다 — 저해상도 선택은 성능 타협이 아니라 "빠른 1차 스크리닝"이라는
          목적에 맞춘 설계다.
        </p>
      </Card>

      <div className="grid-2">
        <Card title="타이밍 예산" sub="⚠ 실제 보드에서 오실로스코프로 측정한 값으로 교체할 것 (현재는 데이터시트 기준 추정치)">
          <div className="stack" style={{ gap: 10 }}>
            {(
              [
                ['addressSetUs', 'MUX 주소 세팅 (µs)', 1, 40],
                ['settleUs', '스위치 · RC 정착 (µs)', 1, 60],
                ['adcConvertUs', 'ADC 변환 (µs)', 5, 300],
                ['loopOverheadUs', '루프 오버헤드 (µs)', 0, 100],
              ] as const
            ).map(([key, label, min, max]) => (
              <label className="field" key={key}>
                <span>
                  {label} — {timing[key]}
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={1}
                  value={timing[key]}
                  onChange={(e) => patch({ timing: { ...timing, [key]: Number(e.target.value) } })}
                />
              </label>
            ))}
            <label className="field">
              <span>시리얼 속도 (bps)</span>
              <select
                value={timing.baudRate}
                onChange={(e) => patch({ timing: { ...timing, baudRate: Number(e.target.value) } })}
              >
                {[9600, 57600, 115200, 230400, 460800, 921600].map((b) => (
                  <option key={b} value={b}>
                    {b.toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>

        <Card title="시리얼 프로토콜 초안" sub="펌웨어 담당과 맞춰야 하는 계약">
          <pre className="protocol">{WIRE_PROTOCOL}</pre>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="열람 권한" sub="역할을 바꾸면 원인 상세의 마스킹이 달라진다">
          <label className="field" style={{ marginBottom: 12 }}>
            <span>역할 (데모 계정)</span>
            <select
              value={state.user.id}
              onChange={(e) => {
                const u = DEMO_USERS.find((x) => x.id === e.target.value);
                if (u) setUser(u);
              }}
            >
              {DEMO_USERS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {ROLE_META[u.role].label}
                </option>
              ))}
            </select>
          </label>
          <p className="section-note" style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
            {ROLE_META[state.user.role].description}
            {state.user.ownedProcesses.length > 0 &&
              ` 담당 공정: ${state.user.ownedProcesses.map((p) => PROCESSES[p].short).join(', ')}.`}
          </p>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>공정</th>
                  <th>기밀 등급</th>
                </tr>
              </thead>
              <tbody>
                {PROCESS_ORDER.map((p) => {
                  const c = PROCESS_CLASSIFICATION[p];
                  return (
                    <tr key={p}>
                      <td>{PROCESSES[p].label}</td>
                      <td>
                        <Badge color={c === 'restricted' ? '--critical' : c === 'confidential' ? '--warning' : undefined}>
                          {CLASSIFICATION_META[c].label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Banner kind="warn">
            <strong>프로토타입 한계</strong> — 지금 마스킹은 화면 표시 제어일 뿐입니다. 원인 지식베이스가 프론트엔드
            번들에 그대로 들어 있어 개발자 도구로는 전부 보입니다. 실제 배포에서는 서버가 세션 역할에 따라 데이터를
            필터링해 내려줘야 하고, 감사 로그도 서버에 남아야 합니다.
          </Banner>
        </Card>

        <Card title="열람 감사 로그" sub={`최근 ${state.auditLog.length}건 · 브라우저 로컬 (실제로는 서버 기록)`}>
          {state.auditLog.length === 0 ? (
            <div className="empty">기록이 없습니다.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>시각</th>
                    <th>사용자</th>
                    <th>동작</th>
                    <th>대상</th>
                  </tr>
                </thead>
                <tbody>
                  {state.auditLog.slice(0, 60).map((e, i) => (
                    <tr key={`${e.at}-${i}`}>
                      <td>{new Date(e.at).toLocaleTimeString('ko-KR')}</td>
                      <td>{e.userName}</td>
                      <td>{AUDIT_ACTION_LABEL[e.action]}</td>
                      <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>{e.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
