import { MUX_CHANNELS } from '../config/hardware';
import type { ScanProgress } from '../domain/types';

/**
 * UI → 하드웨어 → 모델 파이프라인 상태.
 *
 * 이 컴포넌트가 있는 이유: 사용자가 그 자리에서 만든 패턴이 왜곡 없이 전 구간을
 * 통과했다는 걸 스스로 확인할 수 있어야 하기 때문이다. 어느 단계에서 멈췄는지,
 * 지금 몇 번째 MUX의 몇 번 채널을 읽고 있는지가 보이면 "시연용 데모"와
 * "실제로 동작하는 시스템"의 차이가 화면에서 드러난다.
 */

const STEPS = [
  { key: 'latch', name: '① 패턴 래치', hw: '74HC595' },
  { key: 'scan', name: '② 채널 판독', hw: 'CD4067 → ADC' },
  { key: 'transfer', name: '③ 프레임 전송', hw: 'UART' },
  { key: 'infer', name: '④ 모델 추론', hw: '분류기' },
] as const;

const ORDER: Record<string, number> = { idle: -1, latch: 0, scan: 1, transfer: 2, infer: 3, done: 4, error: -1 };

export function ScanPipeline({ progress }: { progress: ScanProgress }) {
  const current = ORDER[progress.phase] ?? -1;
  const muxIndex = Math.floor(Math.max(0, progress.read - 1) / MUX_CHANNELS);
  const channel = Math.max(0, progress.read - 1) % MUX_CHANNELS;
  const ratio = progress.total ? progress.read / progress.total : 0;

  return (
    <div>
      <div className="pipeline">
        {STEPS.map((s, i) => {
          const state = current > i ? 'complete' : current === i ? 'active' : '';
          return (
            <div key={s.key} className={`pipe-step ${state}`}>
              <div className="pipe-name">
                {current > i && <span aria-hidden>✓</span>}
                {s.name}
              </div>
              <div className="pipe-detail">{s.hw}</div>
              {s.key === 'scan' && current >= 1 && (
                <div className="pipe-detail">
                  MUX #{muxIndex} · ch {channel} · {progress.read}/{progress.total}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="progress-track" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>

      <div className="pipe-detail" style={{ marginTop: 6 }}>
        {progress.phase === 'idle' ? '대기 — 패턴을 그리고 스캔을 실행하세요.' : progress.message}
      </div>
    </div>
  );
}
