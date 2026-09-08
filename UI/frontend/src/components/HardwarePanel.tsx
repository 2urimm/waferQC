import { useApp } from '../state/AppStore';
import { Badge, Banner, Card } from './ui';

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
 * 어긋난 칸 수를 항상 띄우는 이유가 이것이다. 그 수치와 판정 버튼은 '패턴 선택' 카드에
 * 있다(pages/Inspect.tsx). 이 카드는 연결과 송출만 맡는다 — 되읽은 맵 자체는 읽기 보드의
 * LED 매트릭스가 실물로 보여준다.
 */
export function HardwarePanel() {
  const { state, patch, pushToHardware, reconnectHardware } = useApp();
  const { hw, bridgeStatus, bridgeDetail, writeError } = state;

  const readOk = !!hw?.read.connected;
  const writeOk = !!hw?.write.connected;

  return (
    <Card
      title="하드웨어 연결"
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


    </Card>
  );
}
