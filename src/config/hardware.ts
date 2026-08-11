/**
 * 하드웨어 구성 상수.
 *
 * 이 프로젝트의 전제: 결함 데이터의 "저장(write)"과 "판독(read)"이 물리적으로 분리되어 있다.
 *   - 74HC595 (시프트 레지스터) : 패턴을 래치해 두는 쪽. 8비트 단위로 밀어넣고 한 번에 래치 → 쓰기는 빠름.
 *   - CD4067  (16채널 아날로그 MUX) : 읽는 쪽. S0~S3로 한 번에 딱 한 채널만 COMMON에 연결 →
 *                                     판독은 원리적으로 셀 개수에 비례하는 직렬 동작.
 *
 * 즉 해상도를 올리면 스캔 횟수가 그대로 따라 올라간다. 이 파일의 타이밍 상수가
 * `domain/scan.ts`의 측정시간 계산에 들어가고, 그 결과가 DeviceLab의 트레이드오프 차트가 된다.
 *
 * ⚠ 실제 보드에서 오실로스코프로 측정한 값으로 교체할 것. 현재 값은 데이터시트 + Arduino Uno 기준 추정치.
 */

/** CD4067 채널 수 (S0~S3 = 4비트 주소) */
export const MUX_CHANNELS = 16;

/** 74HC595 1개당 출력 비트 수 */
export const SHIFT_REGISTER_BITS = 8;

/** 웨이퍼 맵 격자. 64칸 = 8 x 8 */
export const GRID_ROWS = 8;
export const GRID_COLS = 8;
export const CELL_COUNT = GRID_ROWS * GRID_COLS;

/** ADC 분해능 (Arduino Uno 10bit) */
export const ADC_BITS = 10;
export const ADC_MAX = (1 << ADC_BITS) - 1;

/**
 * ADC 정규화값(0~1) → 셀 상태.
 *
 * ⚠ 노트북의 CONVERSION_DEFECT_THRESHOLD(0.05) / WAFER_PRESENCE_THRESHOLD(0.25)와
 *   **다른 것**이다. 그쪽은 고해상도 WM-811K 맵을 8x8로 줄일 때 "한 칸 안의 die 중
 *   몇 %가 불량인가"를 보는 면적 비율 임계다. 반면 우리 하드웨어는 8x8을 직접 재므로
 *   한 칸이 곧 센서 하나이고, 여기서 필요한 건 "이 센서 전압이 불량인가"를 가르는
 *   전압 임계다. 둘을 같은 값으로 두면 안 된다.
 *
 * ⚠ 아래 값은 임시다. 실제 보드가 나오면 알려진 정상/불량 웨이퍼로 히스토그램을 떠서
 *   두 분포가 갈리는 지점으로 잡아야 하고, 그 결과가 모델 학습 분포와 맞는지도 봐야 한다.
 *   여기가 틀어지면 모델이 아무리 좋아도 판정이 통째로 어긋난다.
 */
export const ADC_PRESENCE_CUTOFF = 0.15;
export const ADC_DEFECT_CUTOFF = 0.55;

/**
 * 타이밍 예산 (마이크로초).
 * 한 셀을 읽는 데 드는 시간 = 주소 세팅 + 스위치/RC 정착 + ADC 변환 + 루프 오버헤드
 */
export interface TimingBudget {
  /** S0~S3 주소 write + 디코딩 (µs) */
  addressSetUs: number;
  /** MUX 스위치 on-resistance + 배선 용량 RC 정착 (µs) */
  settleUs: number;
  /** ADC 1회 변환 (µs). Uno @ prescaler 128 ≈ 104µs */
  adcConvertUs: number;
  /** 펌웨어 루프 / 버퍼 쓰기 오버헤드 (µs) */
  loopOverheadUs: number;
  /** 74HC595 한 프레임 래치 (µs) — 쓰기 쪽. 셀 수와 무관하게 바이트 단위 */
  latchUs: number;
  /** 호스트 전송 속도 (bps) */
  baudRate: number;
}

export const DEFAULT_TIMING: TimingBudget = {
  addressSetUs: 4,
  settleUs: 6,
  adcConvertUs: 104,
  loopOverheadUs: 18,
  latchUs: 12,
  baudRate: 115200,
};

/**
 * 스캔 순서.
 * MUX는 한 번에 한 채널만 열리므로 셀을 어떤 순서로 도는지가 실제 배선/코드에 대응한다.
 *  - 'bank'  : CD4067 뱅크 단위(16채널씩)로 순차. 실제 4개 MUX를 순서대로 도는 방식.
 *  - 'raster': 행 우선. 디버깅할 때 눈으로 따라가기 쉬움.
 */
export type ScanOrder = 'bank' | 'raster';

/** 64칸을 16채널 MUX로 덮는 데 필요한 CD4067 개수 */
export const MUX_COUNT = Math.ceil(CELL_COUNT / MUX_CHANNELS);

/**
 * 원형 마스크.
 * 실제 웨이퍼는 원형이라 정사각 8x8 격자의 네 모서리는 웨이퍼 밖이다.
 * 셀 중심 기준으로 반경 안에 드는 칸만 세면 64칸 중 52칸.
 * → 원형 웨이퍼를 정사각 MUX 어레이로 덮으면 채널의 약 19%가 노는데,
 *   이건 DeviceLab에서 보여주는 하드웨어 설계상의 실제 손실이다.
 * 기본값은 하드웨어 스펙 그대로(64칸 전부 사용) OFF.
 */
export const DEFAULT_CIRCLE_MASK = false;

/** 측정 전압(정규화) 한 개를 셀 상태로 */
export function adcToCell(normalized: number, defectCutoff = ADC_DEFECT_CUTOFF): 0 | 1 | 2 {
  if (normalized < ADC_PRESENCE_CUTOFF) return 0;
  return normalized >= defectCutoff ? 2 : 1;
}

/** 셀 (row, col)의 정규화 반경 (0 = 중심, 1 = 웨이퍼 가장자리) */
export function normalizedRadius(row: number, col: number): number {
  const cx = GRID_COLS / 2;
  const cy = GRID_ROWS / 2;
  const dx = col + 0.5 - cx;
  const dy = row + 0.5 - cy;
  return Math.hypot(dx, dy) / (GRID_COLS / 2);
}

/** 원형 마스크 적용 시 유효 셀인지 */
export function isInsideWafer(row: number, col: number): boolean {
  return normalizedRadius(row, col) <= 1;
}

/** 원형 마스크에서 살아남는 셀 수 (52) */
export const CIRCLE_MASK_CELL_COUNT = (() => {
  let n = 0;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) if (isInsideWafer(r, c)) n++;
  }
  return n;
})();
