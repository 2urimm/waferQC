import { ADC_MAX, type ScanOrder, type TimingBudget } from '../config/hardware';
import { CELL_DEFECT, CELL_NORMAL, CELL_OUTSIDE, type CellState } from '../config/model';
import { defaultSpec, specBounds, withinSpec, type Metric, type SpecSetting } from '../domain/metrology';
import { buildScanSequence, estimateTime } from '../domain/scan';
import type { ScanFrame, ScanProgress, WaferMap } from '../domain/types';

/* ────────────────────────────────────────────────────────────────────────────
 * ★ 실제 하드웨어 연결 지점 (1/2)
 *
 * 지금은 MockDeviceLink가 스캔을 흉내 낸다. 보드가 준비되면 아래 SerialDeviceLink를
 * 채우고 `createDeviceLink()`의 분기만 바꾸면 UI는 한 줄도 안 고쳐도 된다.
 * 프로토콜 초안은 이 파일 하단 WIRE_PROTOCOL에 문자열로 박아뒀다 — 펌웨어 담당과
 * 맞춰야 하는 계약이라 코드 옆에 두는 게 낫다고 판단했다.
 * ──────────────────────────────────────────────────────────────────────────── */

export type LinkState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ScanOptions {
  timing: TimingBudget;
  order: ScanOrder;
  circleMask: boolean;
  /** 관찰용 배속. 실제 스캔은 수십 ms라 눈으로 못 따라가므로 UI에서만 늘려 보여준다. */
  visualDurationMs: number;
  /**
   * 센서 노이즈 세기 (Mock 전용).
   * 0이 아니면 임계 근처 셀의 판정이 뒤집힐 수 있다 — 실제 계측이 무손실이 아니라는
   * 점을 그대로 보여주기 위해 일부러 남겨 둔 동작이다.
   */
  noise: number;
  /** 어떤 지표를 재는가 */
  metric: Metric;
  /** 양/불을 가르는 스펙 */
  spec: SpecSetting;
  onProgress?: (p: ScanProgress) => void;
  signal?: AbortSignal;
}

export interface DeviceLink {
  readonly kind: 'mock' | 'serial';
  readonly state: LinkState;
  readonly info: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /**
   * 패턴을 래치(74HC595)하고 전 채널을 훑어(CD4067) 프레임을 돌려준다.
   * `truth`는 Mock이 "웨이퍼에 실제로 있는 것"으로 삼을 패턴이다.
   * 실제 장비에서는 이 인자가 무시되고 센서가 읽은 값만 돌아온다.
   */
  scan(truth: WaferMap, opts: ScanOptions): Promise<ScanFrame>;
}

/* ── Mock ──────────────────────────────────────────────────────────────────── */

export class MockDeviceLink implements DeviceLink {
  readonly kind = 'mock' as const;
  state: LinkState = 'disconnected';
  info = '가상 장치 — 실제 보드 없이 스캔 시퀀스와 타이밍만 재현';

  async connect() {
    this.state = 'connecting';
    await delay(180);
    this.state = 'connected';
  }

  async disconnect() {
    this.state = 'disconnected';
  }

  async scan(truth: WaferMap, opts: ScanOptions): Promise<ScanFrame> {
    if (this.state !== 'connected') throw new Error('장치가 연결되지 않았습니다.');

    const seq = buildScanSequence(opts.order, opts.circleMask);
    const est = estimateTime(seq.length, opts.timing);
    const raw = new Array(truth.length).fill(0);
    const values = new Array<number>(truth.length).fill(0);
    const cells = new Array<CellState>(truth.length).fill(CELL_OUTSIDE);
    const measurements = new Array<number | null>(truth.length).fill(null);
    /*
     * 물리량은 지표의 **기본 스펙**을 기준으로 만들고, 판정은 **사용자가 설정한 스펙**으로 한다.
     * 둘을 같은 걸로 쓰면 안 된다 — 그러면 스펙을 조여도 측정값이 같이 따라 움직여서
     * 판정이 절대 안 바뀐다. 실제로는 웨이퍼의 물리량이 먼저 있고 스펙이 나중에 그걸
     * 판정하는 것이므로, 스펙을 조이면 경계에 있던 지점이 불량으로 넘어가야 맞다.
     */
    const gen = specBounds(opts.metric, defaultSpec(opts.metric));
    // 센서 전압을 물리량으로 환산할 때 쓰는 눈금. 기본 스펙 폭의 6배를 전 구간으로 잡는다.
    const span = gen.mode === 'upper' ? Math.max(gen.hi, 1) * 6 : Math.max(gen.hi - (gen.lo ?? 0), 1e-9) * 6;
    const floor = gen.mode === 'upper' ? 0 : opts.metric.defaultTarget - span / 2;

    const report = (phase: ScanProgress['phase'], read: number, message: string) =>
      opts.onProgress?.({ phase, read, total: seq.length, message });

    // 1) 74HC595 래치 — 셀 수와 무관하게 바이트 단위
    report('latch', 0, '74HC595에 패턴 시프트 후 래치');
    await delay(Math.max(120, opts.visualDurationMs * 0.08), opts.signal);

    // 2) CD4067 채널 순차 판독 — 여기가 셀 수에 비례하는 구간
    const perStepMs = (opts.visualDurationMs * 0.72) / Math.max(1, seq.length);
    let lastPaint = performance.now();

    for (const step of seq) {
      if (opts.signal?.aborted) throw new DOMException('스캔이 취소되었습니다.', 'AbortError');

      /*
       * 실제 경로를 그대로 왕복시킨다.
       *   웨이퍼의 실제 상태 → 그 지점의 물리량(두께·선폭 등) → 센서 전압 → 물리량 환산
       *   → 스펙 대조 → 양품(1) / 불량(2)
       * 굳이 전압을 거치는 이유는 그게 실제 측정 경로이기 때문이다. 노이즈가 스펙 경계를
       * 넘기면 판정이 뒤집히는데, 그게 이 시스템의 실제 한계이고 숨기면 안 되는 부분이다.
       */
      const i = step.row * 8 + step.col;
      const state = truth[i] ?? CELL_OUTSIDE;

      if (state === CELL_OUTSIDE) {
        raw[i] = 0;
        values[i] = 0;
        cells[i] = CELL_OUTSIDE;
      } else {
        const ideal = idealValue(state, defaultSpec(opts.metric), gen);
        // 물리량 → 전압 (0~1 눈금) → 노이즈 → 다시 물리량
        const v = clamp01((ideal - floor) / span);
        const noisy = clamp01(v + (Math.random() - 0.5) * 2 * opts.noise * 0.25);
        raw[i] = Math.round(noisy * ADC_MAX);
        values[i] = raw[i] / ADC_MAX;
        const measured = floor + values[i] * span;
        measurements[i] = measured;
        cells[i] = withinSpec(measured, opts.metric, opts.spec) ? CELL_NORMAL : CELL_DEFECT;
      }

      // 매 스텝 리렌더는 낭비라 ~16ms 간격으로만 올린다.
      // 진행 보고와 양보는 전부 타이머로만 한다 — requestAnimationFrame은 탭이 화면에
      // 없으면 콜백이 아예 안 와서 스캔이 그대로 멈춰버린다. 사용자가 스캔 중에 다른
      // 탭으로 옮기는 건 흔한 일이라, 여기서 rAF에 기대면 안 된다.
      const now = performance.now();
      if (now - lastPaint > 16 || step.index === seq.length - 1) {
        lastPaint = now;
        report('scan', step.index + 1, `MUX #${step.muxIndex} · 채널 ${step.channel} 판독`);
      }
      if (perStepMs > 0.5) await delay(perStepMs, opts.signal);
      else if ((step.index & 7) === 7) await delay(0, opts.signal);
    }

    // 3) 호스트 전송
    report('transfer', seq.length, `프레임 ${seq.length}샘플 전송`);
    await delay(Math.max(120, opts.visualDurationMs * 0.12), opts.signal);

    return {
      cells,
      measurements,
      values,
      raw,
      metricId: opts.metric.id,
      spec: opts.spec,
      // 실제 보드가 걸릴 시간(타이밍 예산 기준 추정). 위의 배속은 시각화용일 뿐이다.
      elapsedMs: est.totalMs,
      source: 'mock',
      capturedAt: Date.now(),
    };
  }
}

/**
 * 그 지점이 양품/불량일 때 물리량이 대략 어디쯤 나오는가.
 * 양품은 스펙 안쪽에, 불량은 스펙 밖으로 떨어뜨리되 어느 쪽으로 벗어날지는 무작위다 —
 * 두께가 얇아도 두꺼워도 불량이고, 어느 쪽이냐가 원인을 가르기 때문이다
 * (과식각 vs 저식각, 과연마 vs 저연마).
 */
function idealValue(
  state: CellState,
  spec: SpecSetting,
  b: { mode: 'percent' | 'upper'; lo?: number; hi: number },
): number {
  const good = state === CELL_NORMAL;

  if (b.mode === 'upper') {
    // 개수형 지표 — 적을수록 좋다
    return good ? Math.random() * b.hi * 0.55 : b.hi * (1.4 + Math.random() * 1.6);
  }

  const lo = b.lo ?? 0;
  const half = (b.hi - lo) / 2;
  const center = spec.target;

  if (good) {
    // 스펙 폭의 안쪽 60% 안에서
    return center + (Math.random() - 0.5) * 2 * half * 0.6;
  }
  // 스펙 밖으로 1.3~2.4배
  const side = Math.random() < 0.5 ? -1 : 1;
  return center + side * half * (1.3 + Math.random() * 1.1);
}

/* ── 실제 보드 (미구현) ─────────────────────────────────────────────────────── */

/**
 * Web Serial API 기반 구현 자리.
 * Chrome/Edge에서 secure context(localhost 포함)면 동작한다. `navigator.serial.requestPort()`는
 * 사용자 제스처(버튼 클릭) 안에서 호출해야 한다 — 연결 버튼 핸들러에서 부르면 된다.
 */
export class SerialDeviceLink implements DeviceLink {
  readonly kind = 'serial' as const;
  state: LinkState = 'disconnected';
  info = '실제 보드 — 미구현 (services/deviceLink.ts의 SerialDeviceLink를 채울 것)';

  async connect(): Promise<void> {
    this.state = 'error';
    throw new Error(
      '시리얼 연결은 아직 구현되지 않았습니다. services/deviceLink.ts의 SerialDeviceLink와 WIRE_PROTOCOL을 참고해 채우세요.',
    );
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected';
  }

  async scan(): Promise<ScanFrame> {
    throw new Error('시리얼 스캔 미구현');
  }
}

/**
 * 펌웨어와 맞춰야 하는 계약 초안.
 * 라인 단위 ASCII로 잡아 뒀다 — 시리얼 모니터로 직접 두드려 볼 수 있어야 디버깅이 산다.
 */
export const WIRE_PROTOCOL = `
호스트 → 보드
  V\\n                     펌웨어 버전 질의
  W <hex...>\\n            패턴 래치. 셀당 1바이트(0x00~0xFF)를 hex로. 64칸이면 128자.
  P <addrUs> <settleUs>\\n MUX 주소 세팅/정착 대기 시간 설정
  S\\n                     1프레임 스캔 요청

보드 → 호스트
  VER <문자열>
  OK
  FRAME <n> <v0> <v1> ... <v_{n-1}>   ADC 원시값. 0~1023, 스캔 순서대로.
  ERR <메시지>

주의
  - FRAME의 순서는 UI의 buildScanSequence(order, circleMask)와 같아야 한다.
    보드가 뱅크 순서로 보내는데 UI가 래스터로 읽으면 맵이 뒤섞인다.
  - 원형 마스크를 쓰면 n이 64가 아니라 52다. 보드가 어떤 걸 보내는지 먼저 합의할 것.
`.trim();

/* ── 팩토리 ────────────────────────────────────────────────────────────────── */

export function createDeviceLink(kind: 'mock' | 'serial'): DeviceLink {
  return kind === 'serial' ? new SerialDeviceLink() : new MockDeviceLink();
}

/** 브라우저가 Web Serial을 지원하는지 — 연결 버튼 활성화 판단용 */
export function serialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/* ── util ──────────────────────────────────────────────────────────────────── */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('취소됨', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('취소됨', 'AbortError'));
      },
      { once: true },
    );
  });
}

