import { ADC_MAX, adcToCell, type ScanOrder, type TimingBudget } from '../config/hardware';
import { CELL_DEFECT, CELL_NORMAL, CELL_OUTSIDE, type CellState } from '../config/model';
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
  /** ADC 정규화값이 이 이상이면 불량 die로 판정 */
  defectCutoff: number;
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

      // 웨이퍼에 실제로 있는 상태를 센서 전압으로 되돌린 뒤, 그 전압을 다시 셀 상태로
      // 판정한다. 굳이 왕복시키는 이유는 그게 실제 경로이기 때문이다 —
      // 노이즈가 임계를 넘기면 판정이 뒤집히고, 그게 이 시스템의 실제 한계다.
      const i = step.row * 8 + step.col;
      const clean = CELL_LEVEL[truth[i] ?? CELL_OUTSIDE];
      const noisy = clamp01(clean + (Math.random() - 0.5) * 2 * opts.noise);
      raw[i] = Math.round(noisy * ADC_MAX);
      values[i] = raw[i] / ADC_MAX;
      cells[i] = adcToCell(values[i], opts.defectCutoff);

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
      values,
      raw,
      // 실제 보드가 걸릴 시간(타이밍 예산 기준 추정). 위의 배속은 시각화용일 뿐이다.
      elapsedMs: est.totalMs,
      source: 'mock',
      capturedAt: Date.now(),
    };
  }
}

/**
 * 셀 상태별 기대 센서 전압 (정규화).
 * 웨이퍼가 없는 칸은 거의 0, 정상 die는 중간, 불량 die는 높게 읽힌다고 가정했다.
 * ⚠ 실제 센서 특성이 나오면 이 값들을 실측으로 교체할 것.
 */
const CELL_LEVEL: Record<CellState, number> = {
  [CELL_OUTSIDE]: 0.03,
  [CELL_NORMAL]: 0.32,
  [CELL_DEFECT]: 0.86,
};

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

