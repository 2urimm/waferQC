import { CELL_DEFECT } from '../config/model';
import { mismatchCount } from '../services/deviceBridge';
import { useApp } from '../state/AppStore';
import { WaferGrid } from './WaferGrid';
import { Badge, Banner, Card, Empty } from './ui';

/**
 * 아두이노 2대 패널.
 *
 *   화면에 그린 맵 ──▶ 쓰기(출력) 아두이노 ──▶ 74HC595 래치
 *                                                   │ (실물 보드)
 *                        읽기(입력) 아두이노 ◀──────┘ 4067 스캔
 *                                ├──▶ NeoPixel 8x8 (읽어낸 값을 실물로 표시)
 *                                ▼  되읽은 맵 = 판정에 들어가는 유일한 입력
 *
 * 두 아두이노 사이에는 전선만 있고 통신이 없다. 읽기 쪽은 4067의 COMMON 을 읽기만 하므로
 * 이쪽에서 저쪽으로 정보가 흐를 길 자체가 없다(read_arduino.ino 의 정보 격벽).
 * 그래서 "보낸 것"과 "되읽은 것"이 다를 수 있고, 그 차이는 에러로 안 뜬다 —
 * 어긋난 칸 수를 항상 띄우는 이유가 이것이다.
 */
export function HardwarePanel() {
  const { state, patch, pushToHardware, reconnectHardware, runInspection } = useApp();
  const { hw, hwMap, bridgeStatus, bridgeDetail, writeError, draft, running } = state;

  const readOk = !!hw?.read.connected;
  const writeOk = !!hw?.write.connected;
  const mismatch = mismatchCount(draft, hwMap);
  const readDefects = hwMap?.filter((c) => c === CELL_DEFECT).length ?? 0;

  return (
    <Card
      title="아두이노 연결"
      sub="화면에 찍은 불량이 쓰기 아두이노로 나가고, 읽기 아두이노가 그 보드를 스캔해 되돌려 준다."
      actions={
        <>
          <Badge color={writeOk ? '--good' : '--warning'} strong title={hw?.write.error || undefined}>
            출력 {hw?.write.port ?? '—'}
          </Badge>
          <Badge color={readOk ? '--good' : '--warning'} strong title={hw?.read.error || undefined}>
            입력 {hw?.read.port ?? '—'}
          </Badge>
        </>
      }
    >
      {bridgeStatus === 'down' && (
        <Banner kind="warn">
          시리얼 브리지가 떠 있지 않습니다 — {bridgeDetail}
          <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>
            <code className="mono">UI/backend</code> 폴더에서 브리지를 먼저 띄우세요:
            <br />
            <code className="mono">wafer_final_package_v2\.venv\Scripts\python.exe serial_bridge.py</code>
            <br />
            (<code className="mono">UI/start.bat</code>은 세 번째 창으로 같이 띄웁니다.) 띄운 뒤 <strong>재연결</strong>을
            누르면 새로고침 없이 붙습니다.
          </div>
        </Banner>
      )}

      {bridgeStatus === 'up' && (!readOk || !writeOk) && (
        <Banner kind="warn">
          {!readOk && !writeOk
            ? '아두이노 두 대 모두 연결되지 않았습니다.'
            : !writeOk
              ? '출력(쓰기) 아두이노가 연결되지 않았습니다.'
              : '입력(읽기) 아두이노가 연결되지 않았습니다.'}
          <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>
            {hw?.detectNote}
            <br />
            가장 흔한 원인은 <strong>Arduino IDE의 시리얼 모니터</strong>가 포트를 잡고 있는 것입니다. 모니터 창을 닫고
            <strong>재연결</strong>을 누르세요.
          </div>
        </Banner>
      )}

      {writeError && <Banner kind="warn">출력 송출 실패 — {writeError}</Banner>}

      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={state.autoWrite}
            onChange={(e) => patch({ autoWrite: e.target.checked })}
          />
          <span>칸을 찍을 때마다 자동 송출</span>
        </label>
        <button className="btn btn-sm" onClick={pushToHardware} disabled={!writeOk}>
          지금 보내기
        </button>
        {/*
          브리지가 죽어 있을 때야말로 이걸 누를 사람이 있다 — 방금 브리지를 띄운 사람.
          잠가 두면 새로고침 말고는 붙일 방법이 없어진다. 그래서 항상 눌린다.
        */}
        <button className="btn btn-sm" onClick={reconnectHardware} disabled={bridgeStatus === 'checking'}>
          {bridgeStatus === 'checking' ? '확인 중…' : '재연결'}
        </button>
      </div>

      <div className="divider" style={{ margin: '12px 0' }} />

      <div className="card-sub" style={{ marginBottom: 6 }}>
        읽기 아두이노가 되읽은 맵 — <strong>판정에 들어가는 건 이 맵이다</strong>
      </div>
      {hwMap ? (
        <>
          <WaferGrid map={hwMap} />
          <div className="row" style={{ marginTop: 8, gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* onClick={runInspection} 로 넘기면 클릭 이벤트가 source 인자로 들어가 'draw' 로 샌다 */}
            <button className="btn btn-sm btn-primary" onClick={() => runInspection('hardware')} disabled={running}>
              {running ? '판정 중…' : '이 맵으로 판정하기'}
            </button>
            <span className="section-note" style={{ color: 'var(--text-muted)' }}>
              불량 {readDefects}칸 · 프레임 {hw?.read.frames ?? 0}개
              {state.hwAt ? ` · ${new Date(state.hwAt).toLocaleTimeString('ko-KR')}` : ''}
            </span>
          </div>

          {mismatch !== null && (
            <p className="section-note" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
              {mismatch === 0 ? (
                <>보낸 맵과 되읽은 맵이 <strong>전부 일치</strong>한다 — 왕복이 온전하다.</>
              ) : (
                <>
                  보낸 맵과 <strong>{mismatch}칸</strong>이 다르다. 맵이 어긋나도 에러는 안 나므로 이 수치로만 알 수
                  있다. 전부 다르게 나오면 읽기 쪽 HIGH/LOW가 뒤집힌 것이니 브리지를{' '}
                  <code className="mono">--invert-read</code> 로 띄워 볼 것.
                </>
              )}
            </p>
          )}
        </>
      ) : (
        <Empty>
          {readOk
            ? '읽기 아두이노가 아직 맵을 올리지 않았습니다. 값이 바뀔 때만 보내므로, 위쪽 패턴을 한 번 바꿔 보내거나 재연결로 보드를 다시 읽으세요.'
            : bridgeStatus === 'up'
              ? '읽기 아두이노가 연결되지 않았습니다.'
              : '시리얼 브리지가 떠 있지 않습니다.'}
        </Empty>
      )}

      <p className="section-note" style={{ marginTop: 10, color: 'var(--text-muted)' }}>
        판정은 <strong>실제로 스캔된 이 맵으로</strong> 한다. 되읽는 과정에서 비트가 새면 판정도 같이 달라져야 하고,
        그게 이 경로를 거치는 이유다. 화면에서 그린 맵으로 <strong>자동으로 대체되는 일은 없다.</strong>
      </p>

      {/*
        하드웨어가 없을 때의 우회로.
        이게 없으면 배선이 끊긴 동안 화면이 통째로 막힌다 — 판정 버튼이 아예 안 뜬다.
        조용한 대체가 아니라 사용자가 직접 누르는 버튼이고, 기록에도 'draw' 로 남는다.
      */}
      {!hwMap && (
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-sm" onClick={() => runInspection('draw')} disabled={running}>
            {running ? '판정 중…' : '하드웨어 없이 화면 맵으로 판정'}
          </button>
          <p className="section-note" style={{ marginTop: 6, color: 'var(--text-muted)' }}>
            위쪽 <strong>패턴 선택</strong>에 그린 맵을 그대로 모델에 넣는다. 하드웨어를 거치지 않았으므로 되읽기
            검증이 빠진 판정이고, 이력에 그렇게 남는다.
          </p>
        </div>
      )}
    </Card>
  );
}
