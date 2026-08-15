/**
 * 공정 × 결함유형 → 원인 · 해결 · 개선 매트릭스.
 *
 * 출처: `반도체 불량 분석 개선안.xlsx` (원인/해결/개선) + `불량 대응 log.xlsx` (방향성·재발 이력).
 * 두 엑셀이 **소스 오브 트루스**다. 이 파일은 타입과 조회 헬퍼만 갖고 있고, 실제 데이터는
 * `scripts/gen_from_xlsx.py`가 엑셀에서 뽑아 `causeMatrix.generated.ts`에 넣는다.
 * 내용이 틀렸으면 코드가 아니라 엑셀을 고치고 스크립트를 다시 돌릴 것.
 *
 * 엑셀이 세 칸으로 나뉘어 있다는 게 이 화면의 골격이다.
 *   원인 — 무엇이 어긋났는가 (기전 + 웨이퍼맵에 어떻게 보이는가)
 *   해결 — 지금 이 로트에 할 것 (즉시 대응)
 *   개선 — 재발을 막기 위해 설비·주기를 어떻게 바꿀 것인가 (장기)
 * 앞의 둘은 오늘 당직이 하는 일이고 마지막은 공정 담당이 계획을 잡는 일이라, 화면에서도
 * 섞지 않고 갈라 둔다.
 */

export type DefectPatternId =
  | 'Center'
  | 'Donut'
  | 'Edge-Ring'
  | 'Edge-Loc'
  | 'Loc'
  | 'Scratch'
  | 'Random'
  | 'Near-full'
  | 'None';

/**
 * 모델 출력 순서(9클래스). 엑셀 열 순서(… Loc, Random, Scratch, Near-full)와 다르므로
 * 엑셀을 읽을 때는 절대 열 위치로 매핑하지 말고 헤더 문자열로 매핑할 것.
 * (생성 스크립트는 헤더 문자열로 찾는다.)
 */
export const PATTERN_ORDER: DefectPatternId[] = [
  'Center',
  'Donut',
  'Edge-Ring',
  'Edge-Loc',
  'Loc',
  'Scratch',
  'Random',
  'Near-full',
  'None',
];

export const PATTERN_LABEL: Record<DefectPatternId, string> = {
  Center: '중심부',
  Donut: '도넛',
  'Edge-Ring': '가장자리 링',
  'Edge-Loc': '가장자리 국부',
  Loc: '국부',
  Scratch: '스크래치',
  Random: '무작위',
  'Near-full': '전면',
  None: '정상',
};

/**
 * 공정 6종.
 *
 * 팀 결정: 측정지표를 공정별로 통일하려다 보니 6개로 통합하는 게 맞다고 판단했다.
 * (8대 공정에서 웨이퍼제조·금속배선·EDS·패키징을 빼고, 산화를 Diffusion으로 묶음)
 * 공정별 확인 계측은 대응 Log의 `계측 방법` 열에서 온다 — CauseEntry.metrology.
 *
 * 엑셀 개선안과 대응 Log가 똑같이 이 6개로 되어 있고 담당팀도 6개라, 여기에 공통 설비용
 * 가상 공정을 더 두지 않는다. 반송 로봇·Slit Valve처럼 여러 공정에 공통인 설비는 엑셀에서
 * 이미 각 공정 밑에 따로 적혀 있다 (예: Robot ARM Scratch가 Diffusion·Deposition·Photo·Etch에 각각).
 */
export type ProcessId = 'DIFFUSION' | 'DEPOSITION' | 'PHOTO' | 'ETCH' | 'CLEANING' | 'CMP';

export interface ProcessMeta {
  id: ProcessId;
  /** 표시 순번 */
  step: number;
  label: string;
  short: string;
  /** 이 공정이 웨이퍼에 남기는 결함의 성격 */
  character: string;
}

export const PROCESSES: Record<ProcessId, ProcessMeta> = {
  DIFFUSION: {
    id: 'DIFFUSION',
    step: 1,
    label: '확산 (Diffusion)',
    short: '확산',
    character:
      'Tube 이중구조와 Boat 회전이 원래 중심-외곽을 균일화하는 설계라, 결함은 주로 반경 방향 농도·온도 구배와 Boat 접촉에서 나온다.',
  },
  DEPOSITION: {
    id: 'DEPOSITION',
    step: 2,
    label: '증착 (Deposition)',
    short: '증착',
    character: '샤워헤드 가스 분배와 RF 정재파가 중심/외곽 두께를 가르고, 챔버 내벽 누적막이 파티클을 만든다.',
  },
  PHOTO: {
    id: 'PHOTO',
    step: 3,
    label: '노광 (Photo)',
    short: '포토',
    character:
      '스핀 코팅의 회전 대칭성과 EBR/WEE의 가장자리 처리가 패턴을 만든다. Scanner는 Reticle Field 단위라 웨이퍼 전면 규모의 편차만 만든다.',
  },
  ETCH: {
    id: 'ETCH',
    step: 4,
    label: '식각 (Etch)',
    short: '식각',
    character: '플라즈마 밀도 분포와 소모품(Focus Ring) 마모가 반경 방향 CD 편차를 만든다.',
  },
  CLEANING: {
    id: 'CLEANING',
    step: 5,
    label: '세정 (Cleaning)',
    short: '세정',
    character: '노즐 스윕 속도와 원심 건조가 잔류물의 공간 분포를 결정한다.',
  },
  CMP: {
    id: 'CMP',
    step: 6,
    label: '평탄화 (CMP)',
    short: 'CMP',
    character: '헤드 압력 존과 Retainer Ring·패드 마모 형상이 제거율 프로파일을 만든다.',
  },
};

export const PROCESS_ORDER: ProcessId[] = ['DIFFUSION', 'DEPOSITION', 'PHOTO', 'ETCH', 'CLEANING', 'CMP'];

/**
 * 방향성 서명.
 *
 * 출처는 대응 Log의 `방향성 여부` 열이고, 로그 머리말의 시계방향 규약을 따른다 —
 * Notch=6시를 지도 datum으로 두고, 로봇 반입축은 9시(문/로봇쪽)↔3시(선단)로 별개 축이다.
 *
 *  - `fixed`  반입 기하로 방향까지 근거가 있는 것 (Slit Valve 9시, Robot ARM 3시 등)
 *  - `vector` 상대운동 방향을 갖는 것 (CMP Head-Platen 3시→9시)
 *  - `layout` 방향이 설비 배치에 달려 있어 실측 wafer map 없이는 각도를 못 박는 것
 *             (Lift Pin, RF Feedthrough, Retainer Ring Joint, WEE 스캔 기준점 등)
 *
 * `layout`을 숫자로 채우지 않은 건 의도적이다. 근거 없는 각도를 UI가 확정처럼 띄우면
 * 엔지니어를 엉뚱한 방위로 보낸다.
 */
export interface Directional {
  kind: 'fixed' | 'vector' | 'layout';
  /** kind='fixed'일 때의 시 방향 (1~12) */
  clock?: number;
  /** kind='vector'일 때의 시작/끝 방위 */
  from?: number;
  to?: number;
  /** 로그에 적힌 원문 표기 */
  label: string;
}

export interface CauseEntry {
  id: string;
  process: ProcessId;
  pattern: DefectPatternId;
  /** 엑셀의 불량 유형 ①/② — ①이 그 공정의 대표 유형이다 */
  variant: 1 | 2;
  /** 엑셀 '명칭' */
  name: string;
  /** 엑셀 '상세 설명' — 원인에서 결함까지의 기전 체인 */
  mechanism: string[];
  /** 엑셀 '웨이퍼맵 형태' — 이 원인이면 맵이 어떻게 보이는가 */
  waferMap: string;
  /** 엑셀 '해결' — 지금 이 로트에 할 즉시 대응 */
  resolution: string[];
  /** 엑셀 '개선' — 재발방지를 위한 장기 조치 */
  improvement: string[];
  directional?: Directional;
  /** 이 원인으로 기록된 대응 Log 관리번호 */
  logIds: string[];
  /** 지난 12개월 기록된 발생 건수 (재발 포함) */
  occurrences: number;
  /** 로그에서 이 원인을 확인할 때 쓴 계측 */
  metrology?: string;
  /** 이 원인의 마지막 발생일 (YYYY-MM-DD) — 상태 판정의 입력 */
  lastSeen?: string;
  /** 대장 '상태' 열 — 효과검증이 아직 안 끝난 건이 있으면 true */
  openCase?: boolean;
}

/** 해당 공정이 이 결함유형을 유발하지 않는다고 본 근거 */
export interface ExclusionNote {
  process: ProcessId;
  pattern: DefectPatternId;
  reason: string;
}

export { CAUSE_MATRIX, EXCLUSION_NOTES, LOG_CUTOFF } from './causeMatrix.generated';

import { CAUSE_MATRIX, EXCLUSION_NOTES } from './causeMatrix.generated';


/* ── 조회 헬퍼 ───────────────────────────────────────────────────────────── */

export function causesForPattern(pattern: DefectPatternId): CauseEntry[] {
  return CAUSE_MATRIX.filter((c) => c.pattern === pattern);
}

export function causeById(id: string): CauseEntry | undefined {
  return CAUSE_MATRIX.find((c) => c.id === id);
}

/** 이 공정 × 이 결함유형을 유발하지 않는다고 본 근거 (없으면 undefined) */
export function exclusionFor(process: ProcessId, pattern: DefectPatternId): ExclusionNote | undefined {
  return EXCLUSION_NOTES.find((e) => e.process === process && e.pattern === pattern);
}

export interface ProcessRelevance {
  process: ProcessId;
  meta: ProcessMeta;
  entries: CauseEntry[];
  /** 이 공정에서 이 유형으로 기록된 총 발생 건수 */
  occurrences: number;
}

export function processesForPattern(pattern: DefectPatternId): ProcessRelevance[] {
  const byProcess = new Map<ProcessId, CauseEntry[]>();
  for (const e of causesForPattern(pattern)) {
    const list = byProcess.get(e.process) ?? [];
    list.push(e);
    byProcess.set(e.process, list);
  }

  return [...byProcess.entries()]
    .map(([process, entries]) => ({
      process,
      meta: PROCESSES[process],
      entries,
      occurrences: entries.reduce((s, e) => s + e.occurrences, 0),
    }))
    .sort(
      (a, b) =>
        b.entries.length - a.entries.length ||
        b.occurrences - a.occurrences ||
        a.meta.step - b.meta.step,
    );
}

/** 아직 원인 매핑이 없는 패턴 — 지식베이스의 빈칸을 숨기지 않고 드러낸다 */
export function patternsWithoutCauses(): DefectPatternId[] {
  return PATTERN_ORDER.filter((p) => p !== 'None' && causesForPattern(p).length === 0);
}

/** 효과검증이 아직 안 끝난 원인 — 대장의 '상태' 열 그대로 */
export function monitoringCauses(): CauseEntry[] {
  return CAUSE_MATRIX.filter((c) => c.openCase);
}

/** 방향성이 설비 배치에 달려 있어 실측 wafer map이 있어야 각도를 박을 수 있는 항목 */
export function layoutDependentCauses(): CauseEntry[] {
  return CAUSE_MATRIX.filter((c) => c.directional?.kind === 'layout');
}
