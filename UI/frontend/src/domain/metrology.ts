import { PROCESSES, type CauseEntry, type ProcessId } from './causes';

/**
 * 공정별 계측지표.
 *
 * 출처: 팀이 정리한 "공정 × 측정지표 × 방법 × 반영 내용" 표를 그대로 옮긴 것.
 *
 * 이게 왜 필요한가: 원인 매트릭스(causes.ts)의 확인 항목은 대부분 설비 로그·이력 조회다.
 * 그건 "언제부터 이상했나"는 알려주지만 "지금 이 웨이퍼가 실제로 어떻게 됐나"는 못 알려준다.
 * 그걸 답하는 게 계측이고, 그래서 원인마다 "어떤 계측을 떠서 어떻게 나오면 이 원인이 맞는지"를
 * 붙여야 점검이 닫힌다.
 *
 * ⚠ 주의: 이 지표들은 **우리 8x8 결함 맵과는 다른 데이터**다.
 * 우리 맵은 die 단위 양/불만 보고, 여기 지표들은 두께·선폭·저항 같은 물리량이다.
 * UI가 "이 계측을 떠 보라"고 안내하는 것이지, 우리가 그 값을 가지고 있는 게 아니다.
 */

export type MetricId =
  // Diffusion
  | 'RS'
  | 'XJ'
  | 'VT'
  | 'TOX'
  // Deposition
  | 'THK'
  | 'RS_FILM'
  | 'STEP_COV'
  // Photo
  | 'CD_PHOTO'
  | 'OVERLAY'
  | 'PR_THK'
  // Etch
  | 'CD_ETCH'
  | 'REMAIN_THK'
  | 'PROFILE'
  // Cleaning
  | 'PARTICLE'
  | 'RS_CONTAM'
  | 'COLLAPSE'
  // CMP
  | 'CMP_THK_MAP'
  | 'SCRATCH_COUNT'
  | 'EPD';

/**
 * 측정 결과가 공간적으로 어떤 형태로 나오는가.
 * 이게 중요한 이유: 'map'으로 나오는 지표만 우리 8x8 결함 맵과 같은 좌표계에서 대조할 수 있다.
 * 'points'는 소수 지점 샘플링이라 결함 위치와 측정 지점이 어긋날 수 있고,
 * 'section'은 웨이퍼를 깨야 나온다.
 */
export type MetricForm = 'map' | 'points' | 'section' | 'signal';

export const METRIC_FORM_LABEL: Record<MetricForm, string> = {
  map: '전면 맵',
  points: '지점 샘플링',
  section: '단면 (파괴)',
  signal: '장비 신호',
};

export interface Metric {
  id: MetricId;
  process: ProcessId;
  label: string;
  /** 측정 방법 */
  method: string;
  /** 이 지표가 반영하는 것 */
  reflects: string;
  /** 해당 공정의 주 진단지표인가 */
  primary: boolean;
  form: MetricForm;
  /** 웨이퍼를 소모하는 검사인가 — 점검 순서를 뒤로 미루는 근거가 된다 */
  destructive: boolean;
  /** 적용 범위가 제한된 경우 */
  scope?: string;

  /* ── 측정 비용 ──
     이 프로젝트가 왜 소수 지점만 재는지의 근거다.
     지점형 계측은 지점 수에 비례해 시간이 늘고, 전면 검사형은 웨이퍼당 고정이다.
     ⚠ 아래 값은 장비·레시피에 따라 크게 달라지는 대표값이다. 실제 라인 수치로 교체할 것. */

  /** 지점당 측정 시간 (초). 전면 스캔형은 undefined */
  perPointSec?: number;
  /** 웨이퍼 1장 전면 스캔 시간 (초). 지점형은 undefined */
  perWaferSec?: number;

  /** 측정값 단위 */
  unit: string;
  /**
   * 스펙 판정 방식.
   *  'percent' — 중심값 ±N% (두께·선폭·저항처럼 목표치가 있는 지표)
   *  'upper'   — 상한만 (파티클·스크래치 개수처럼 적을수록 좋은 지표. defaultTarget이 상한값)
   * 개수형 지표에 ±N%를 쓰면 목표가 0이라 허용폭도 0이 되어 전부 불량이 된다.
   */
  specMode: 'percent' | 'upper';
  /** 스펙 중심값(percent) 또는 상한값(upper) 기본안 */
  defaultTarget: number;
  /** 허용 편차 기본안 (%) — 이 범위를 벗어난 지점을 불량으로 본다 */
  defaultTolerancePct: number;
}

export const METRICS: Record<MetricId, Metric> = {
  /* ── Diffusion (산화·확산) ── */
  RS: {
    id: 'RS',
    process: 'DIFFUSION',
    label: 'Sheet Resistance (Rs)',
    method: '4-Point Probe',
    reflects: '도핑 농도·활성화, Furnace 균일도',
    primary: true,
    form: 'points',
    destructive: false,
    perPointSec: 1.5,
    unit: 'Ω/sq',
    specMode: 'percent',
    defaultTarget: 85,
    defaultTolerancePct: 5,
  },
  XJ: {
    id: 'XJ',
    process: 'DIFFUSION',
    label: 'Junction Depth (Xj)',
    method: 'SIMS / SRP',
    reflects: 'Drive-in 시간·온도 산포',
    primary: false,
    form: 'section',
    destructive: true,
    perPointSec: 1800,
    unit: 'nm',
    specMode: 'percent',
    defaultTarget: 120,
    defaultTolerancePct: 8,
  },
  VT: {
    id: 'VT',
    process: 'DIFFUSION',
    label: 'Threshold Voltage (Vt)',
    method: 'PCM Test Pattern',
    reflects: 'Channel / Well 도핑 이상',
    primary: false,
    form: 'points',
    destructive: false,
    perWaferSec: 240,
    unit: 'V',
    specMode: 'percent',
    defaultTarget: 0.45,
    defaultTolerancePct: 6,
  },
  TOX: {
    id: 'TOX',
    process: 'DIFFUSION',
    label: 'Oxide Thickness (Tox)',
    method: 'Ellipsometry / OCD',
    reflects: 'Oxidation 균일도',
    primary: false,
    form: 'map',
    destructive: false,
    scope: 'Torch 관련 원인에 한정',
    perPointSec: 2,
    unit: 'Å',
    specMode: 'percent',
    defaultTarget: 45,
    defaultTolerancePct: 4,
  },

  /* ── Deposition (증착) ── */
  THK: {
    id: 'THK',
    process: 'DEPOSITION',
    label: 'Film Thickness (THK)',
    method: 'Ellipsometry / OCD',
    reflects: '증착 두께 균일도',
    primary: true,
    form: 'map',
    destructive: false,
    perPointSec: 2.5,
    unit: 'Å',
    specMode: 'percent',
    defaultTarget: 3000,
    defaultTolerancePct: 3,
  },
  RS_FILM: {
    id: 'RS_FILM',
    process: 'DEPOSITION',
    label: 'Sheet Resistance',
    method: '4-Point Probe',
    reflects: '도전막 두께·조성 균일도',
    primary: false,
    form: 'points',
    destructive: false,
    perPointSec: 1.5,
    unit: 'Ω/sq',
    specMode: 'percent',
    defaultTarget: 12,
    defaultTolerancePct: 5,
  },
  STEP_COV: {
    id: 'STEP_COV',
    process: 'DEPOSITION',
    label: 'Step Coverage',
    method: 'Cross-section SEM',
    reflects: 'Gap Fill 능력',
    primary: false,
    form: 'section',
    destructive: true,
    perPointSec: 5400,
    unit: '%',
    specMode: 'percent',
    defaultTarget: 85,
    defaultTolerancePct: 10,
  },

  /* ── Photo (노광) ── */
  CD_PHOTO: {
    id: 'CD_PHOTO',
    process: 'PHOTO',
    label: 'CD',
    method: 'CD-SEM (ADI / AFEI)',
    reflects: 'Dose / Focus 이상',
    primary: true,
    form: 'points',
    destructive: false,
    perPointSec: 8,
    unit: 'nm',
    specMode: 'percent',
    defaultTarget: 60,
    defaultTolerancePct: 5,
  },
  OVERLAY: {
    id: 'OVERLAY',
    process: 'PHOTO',
    label: 'Overlay (dx, dy)',
    method: 'IBO / DBO',
    reflects: '층간 정렬 오차',
    primary: false,
    form: 'points',
    destructive: false,
    perPointSec: 2,
    unit: 'nm',
    specMode: 'upper',
    defaultTarget: 8,
    defaultTolerancePct: 100,
  },
  PR_THK: {
    id: 'PR_THK',
    process: 'PHOTO',
    label: 'PR Thickness',
    method: 'Ellipsometry',
    reflects: 'Coating 균일도',
    primary: false,
    form: 'map',
    destructive: false,
    perPointSec: 2,
    unit: 'Å',
    specMode: 'percent',
    defaultTarget: 8000,
    defaultTolerancePct: 4,
  },

  /* ── Etch (식각) ── */
  CD_ETCH: {
    id: 'CD_ETCH',
    process: 'ETCH',
    label: 'CD (Etch Bias)',
    method: 'CD-SEM (DICD vs FICD)',
    reflects: '식각 후 선폭 변화 — 스펙보다 작으면 과식각, 크면 저식각(잔막)',
    primary: true,
    form: 'points',
    destructive: false,
    perPointSec: 9,
    unit: 'nm',
    specMode: 'percent',
    defaultTarget: 52,
    defaultTolerancePct: 5,
  },
  REMAIN_THK: {
    id: 'REMAIN_THK',
    process: 'ETCH',
    label: 'Remaining Thickness',
    method: 'EM Box',
    reflects: 'Blanket막 Etch Rate·Uniformity 산포',
    primary: false,
    form: 'map',
    destructive: false,
    scope: '패턴 CD가 없는 전면 식각 케이스',
    perPointSec: 2.5,
    unit: 'Å',
    specMode: 'percent',
    defaultTarget: 500,
    defaultTolerancePct: 8,
  },
  PROFILE: {
    id: 'PROFILE',
    process: 'ETCH',
    label: 'Profile',
    method: 'OCD / SEM 단면',
    reflects: 'Bowing · Undercut 등 형상 이상',
    primary: false,
    form: 'section',
    destructive: true,
    perPointSec: 5400,
    unit: '°',
    specMode: 'percent',
    defaultTarget: 88,
    defaultTolerancePct: 3,
  },

  /* ── Cleaning (세정) ── */
  PARTICLE: {
    id: 'PARTICLE',
    process: 'CLEANING',
    label: 'Particle / Defect Count',
    method: 'Macro / DF Inspection',
    reflects: '세정 후 잔류 파티클·잔류물 위치',
    primary: true,
    form: 'map',
    destructive: false,
    perWaferSec: 45,
    unit: 'ea',
    specMode: 'upper',
    defaultTarget: 5,
    defaultTolerancePct: 100,
  },
  RS_CONTAM: {
    id: 'RS_CONTAM',
    process: 'CLEANING',
    label: 'Sheet Resistance 변화',
    method: '4-Point Probe',
    reflects: '금속 오염 간접 반영',
    primary: false,
    form: 'points',
    destructive: false,
    perPointSec: 1.5,
    unit: 'Ω/sq',
    specMode: 'percent',
    defaultTarget: 85,
    defaultTolerancePct: 5,
  },
  COLLAPSE: {
    id: 'COLLAPSE',
    process: 'CLEANING',
    label: 'Pattern Collapse Rate',
    method: 'SEM',
    reflects: '건조(Marangoni) 실패 여부',
    primary: false,
    form: 'section',
    destructive: true,
    perPointSec: 3600,
    unit: '%',
    specMode: 'upper',
    defaultTarget: 1,
    defaultTolerancePct: 100,
  },

  /* ── CMP (평탄화) ── */
  CMP_THK_MAP: {
    id: 'CMP_THK_MAP',
    process: 'CMP',
    label: 'Remaining Thickness Map',
    method: 'Post-CMP 광학 두께측정',
    reflects: '연마량 균일도 — 스펙보다 낮으면 과연마, 높으면 저연마(잔막)',
    primary: true,
    form: 'map',
    destructive: false,
    perPointSec: 1.8,
    unit: 'Å',
    specMode: 'percent',
    defaultTarget: 2000,
    defaultTolerancePct: 4,
  },
  SCRATCH_COUNT: {
    id: 'SCRATCH_COUNT',
    process: 'CMP',
    label: 'Defect / Scratch Count',
    method: 'Inspection (DF)',
    reflects: 'Slurry / Pad Pore 부산물 기인 결함 (Scratch·Loc·Edge-Loc·Random 계열)',
    primary: false,
    form: 'map',
    destructive: false,
    perWaferSec: 60,
    unit: 'ea',
    specMode: 'upper',
    defaultTarget: 3,
    defaultTolerancePct: 100,
  },
  EPD: {
    id: 'EPD',
    process: 'CMP',
    label: 'EPD 신호 균일도',
    method: 'Polisher 광학 / 전류 센서',
    reflects: '연마 종료시점 산포 (간접 지표)',
    primary: false,
    form: 'signal',
    destructive: false,
    perWaferSec: 0,
    unit: 's',
    specMode: 'percent',
    defaultTarget: 62,
    defaultTolerancePct: 6,
  },
};

export const METRIC_ORDER: MetricId[] = Object.keys(METRICS) as MetricId[];

/** 해당 공정의 주 진단지표 */
export function primaryMetricOf(process: ProcessId): Metric | undefined {
  return METRIC_ORDER.map((id) => METRICS[id]).find((m) => m.process === process && m.primary);
}

export function metricsOf(process: ProcessId): Metric[] {
  return METRIC_ORDER.map((id) => METRICS[id]).filter((m) => m.process === process);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 원인 → 확인 계측.
 *
 * causes.ts의 원인 id를 키로 둔다. 원본 표(causes.ts)는 팀이 준 그대로 두고,
 * 계측 연결은 여기에만 둬서 둘을 섞지 않는다.
 *
 * `expect`는 "이 원인이 맞다면 그 계측이 어떻게 나오는가"다. 이게 있어야
 * 엔지니어가 계측을 뜨고 나서 판단할 수 있다 — 숫자만 보고는 확정도 배제도 못 한다.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface Verification {
  metric: MetricId;
  expect: string;
  /** 이 원인의 소속 공정과 계측 공정이 다른 경우의 설명 (공통 설비 등) */
  note?: string;
}

/** 확인 계측 — 지표 id를 실제 Metric으로 풀어서 돌려준다 */
export interface ResolvedVerification extends Omit<Verification, 'metric'> {
  metricId: MetricId;
  metric: Metric;
}

/** 공백·대소문자를 지워 로그 표기와 METRICS.method를 견주기 좋게 만든다 */
function normMethod(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

function findByMethod(method: string, process?: ProcessId): Metric | undefined {
  const want = normMethod(method);
  const pool = METRIC_ORDER.map((id) => METRICS[id]).filter((m) => !process || m.process === process);
  return pool.find((m) => {
    const have = normMethod(m.method);
    return have === want || have.includes(want) || want.includes(have);
  });
}

/**
 * 원인 → 확인 계측.
 *
 * 예전에는 원인 id마다 손으로 적은 표를 뒀는데, 그 표의 "이 원인이면 계측이 이렇게 나온다"는
 * 문장은 우리가 지어낸 것이었다. 지금은 그럴 필요가 없다 — 엑셀 개선안의 **웨이퍼맵 형태**가
 * 정확히 그 문장이고(예: "중심부의 박막 두께(THK)가 Spec보다 커서 불량으로 분류된 형태"),
 * 어떤 계측으로 확인했는지는 대응 Log의 **계측 방법**에 실제 기록이 있다.
 * 그래서 둘을 그대로 쓰고, 이 함수는 로그의 계측 방법 문자열을 METRICS의 지표로 풀어주기만 한다.
 *
 * 푸는 순서:
 *   1) 같은 공정 안에서 method가 일치하는 지표
 *   2) 다른 공정의 지표라도 method가 일치하면 그걸 빌려 쓴다 (파티클 검사처럼 공정 전용
 *      지표가 없는 경우 — 예: Diffusion의 DF Inspection은 세정 공정의 Particle 지표로 본다)
 *   3) 검사 계열 키워드로 넘겨받기
 *   4) 그래도 없으면 해당 공정의 주 진단지표
 */
export function verificationOf(cause: CauseEntry): ResolvedVerification | undefined {
  const expect = cause.waferMap;
  if (!expect) return undefined;

  const logged = cause.metrology;
  let metric: Metric | undefined;
  let note: string | undefined;

  if (logged) {
    metric = findByMethod(logged, cause.process);
    if (!metric) {
      metric = findByMethod(logged);
      if (metric) {
        note = `이 공정에는 ${logged}에 대응하는 전용 지표가 없어 ${PROCESSES[metric.process].label}의 ${metric.label}를 빌려 쓴다.`;
      }
    }
    if (!metric && /inspection/i.test(logged)) {
      metric = METRICS.PARTICLE;
      note = `대응 Log의 계측은 ${logged}다. 결함 계수 계열이라 세정 공정의 ${METRICS.PARTICLE.label}로 본다.`;
    }
  }

  if (!metric) {
    metric = primaryMetricOf(cause.process);
    if (metric) {
      note = logged
        ? `대응 Log에는 ${logged}로 확인했다고 되어 있으나 대응하는 지표가 정의되어 있지 않아 주 진단지표로 대신한다.`
        : '대응 Log에 계측 방법 기록이 없어 주 진단지표로 대신한다.';
    }
  }

  if (!metric) return undefined;
  return { metricId: metric.id, metric, expect, note };
}

/**
 * 측정 지점 수에 따른 계측 소요 시간 (초).
 *
 * 이 숫자가 이 프로젝트의 근거다 — 왜 웨이퍼 전면을 다 재지 않고 몇 군데만 재는가.
 * 예를 들어 CD-SEM은 지점당 9초라, 64지점을 재면 웨이퍼 한 장에 10분 가까이 걸린다.
 * 로트 25장이면 4시간이다. 그래서 실제로는 5점·9점 같은 소수 지점만 재고 통계로 본다.
 */
export function measurementSec(metric: Metric, points: number): number {
  if (metric.perWaferSec !== undefined) return metric.perWaferSec;
  return (metric.perPointSec ?? 0) * points;
}

/** fab에서 흔히 쓰는 샘플링 지점 수 — 트레이드오프 비교용 */
export const TYPICAL_SAMPLING_POINTS = [5, 9, 13, 25, 49, 64];

/* ── 스펙 판정 ───────────────────────────────────────────────────────────────
 * 웨이퍼 맵의 die 하나하나는 "그 지점 측정값이 스펙 안에 드는가"로 갈린다.
 * 예: 막 두께 목표 10nm에 허용 ±10%면 9nm 미만이거나 11nm 초과면 그 die는 불량.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SpecSetting {
  /** percent 모드면 중심값, upper 모드면 상한값 */
  target: number;
  /** percent 모드에서의 허용 편차 (%) */
  tolerancePct: number;
}

export function defaultSpec(metric: Metric): SpecSetting {
  return { target: metric.defaultTarget, tolerancePct: metric.defaultTolerancePct };
}

export interface SpecBounds {
  mode: 'percent' | 'upper';
  lo?: number;
  hi: number;
}

export function specBounds(metric: Metric, spec: SpecSetting): SpecBounds {
  if (metric.specMode === 'upper') return { mode: 'upper', hi: spec.target };
  const d = Math.abs(spec.target) * (spec.tolerancePct / 100);
  return { mode: 'percent', lo: spec.target - d, hi: spec.target + d };
}

export function withinSpec(value: number, metric: Metric, spec: SpecSetting): boolean {
  const b = specBounds(metric, spec);
  if (b.mode === 'upper') return value <= b.hi;
  return value >= (b.lo ?? -Infinity) && value <= b.hi;
}

/** 스펙 중심 대비 편차 (%). upper 모드는 상한 대비 비율. */
export function deviationPct(value: number, metric: Metric, spec: SpecSetting): number {
  if (metric.specMode === 'upper') return spec.target === 0 ? 0 : ((value - spec.target) / spec.target) * 100;
  return spec.target === 0 ? 0 : ((value - spec.target) / spec.target) * 100;
}

/** 스펙을 벗어난 방향 — 어느 쪽으로 벗어났는지가 원인을 가른다 (과식각/저식각, 과연마/저연마) */
export function specSide(value: number, metric: Metric, spec: SpecSetting): 'low' | 'high' | 'in' {
  if (withinSpec(value, metric, spec)) return 'in';
  const b = specBounds(metric, spec);
  if (b.mode === 'upper') return 'high';
  return value < (b.lo ?? 0) ? 'low' : 'high';
}

export function formatSpec(metric: Metric, spec: SpecSetting): string {
  if (metric.specMode === 'upper') return `≤ ${spec.target} ${metric.unit}`;
  const b = specBounds(metric, spec);
  return `${spec.target} ${metric.unit} ±${spec.tolerancePct}% (${round(b.lo ?? 0)} ~ ${round(b.hi)})`;
}

function round(v: number): number {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return Number(v.toFixed(digits));
}

export function formatValue(value: number, metric: Metric): string {
  return `${round(value)} ${metric.unit}`;
}
