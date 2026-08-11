/**
 * 결함 패턴 × 요인 유형 → 원인 공정 매트릭스.
 *
 * 출처: 프로젝트 팀이 정리한 원본 표. 아래 데이터는 그 표를 그대로 옮긴 것이고,
 * 원본에 비어 있던 5열 "핵심 제어 및 개선안 (Actionable)"만 초안으로 채웠다.
 * 초안 항목은 전부 `actionable.draft = true`로 표시해 UI에서 구분해 보여준다 —
 * 검토 전 내용을 확정된 것처럼 띄우면 안 되기 때문이다.
 *
 * 표에서 눈에 띈 점은 각 항목의 `note`에 남겼다 (중복 기재, 열 배치가 애매한 항목 등).
 */

/** 원본 표의 결함 패턴 (WM-811K 표준 체계) */
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

/** 원본 표의 열 = 요인 유형 */
export type FactorType = 'static' | 'aging' | 'spatial' | 'r2r';

export const FACTOR_ORDER: FactorType[] = ['static', 'aging', 'spatial', 'r2r'];

export const FACTOR_META: Record<FactorType, { label: string; short: string; hint: string }> = {
  static: {
    label: '정적 / 하드웨어 요인',
    short: '정적',
    hint: '설비 구조·설정 자체에서 오는 것. 같은 조건이면 항상 같은 모양으로 나온다.',
  },
  aging: {
    label: '경시 변화 (노후화·지연)',
    short: '경시',
    hint: '시간이 지나며 서서히 어긋나는 것. 마지막 정상 시점부터의 경과가 단서다.',
  },
  spatial: {
    label: '공간적 편향 (방향성 쏠림)',
    short: '방향성',
    hint: '웨이퍼의 특정 방위에 몰리는 것. 노치 기준 방향이 결정적 단서다.',
  },
  r2r: {
    label: '연속 공정 변동성 (동적 R2R)',
    short: 'R2R',
    hint: '앞 로트가 다음 로트에 남기는 영향. 로트 순번·챔버 유휴시간과 상관을 본다.',
  },
};

/**
 * 공정 단계 — 8대 공정 + CMP · 세정.
 *
 * 8대 공정(웨이퍼제조 → 산화 → 포토 → 식각 → 증착·이온주입 → 금속배선 → EDS → 패키징)을
 * step 1~8로 두고, 표에 등장하지만 8대 분류에 안 들어가는 CMP와 세정을 별도 단계로 붙였다.
 * COMMON은 공정이 아니라 여러 공정에 공통으로 걸리는 설비(ESC, 반송 로봇, 게이트 도어)용이며,
 * 원본 표의 "구분 X" 항목이 여기로 온다.
 */
export type ProcessId =
  | 'WAFER'
  | 'OXIDATION'
  | 'PHOTO'
  | 'ETCH'
  | 'DEPOSITION'
  | 'METAL'
  | 'EDS'
  | 'PACKAGING'
  | 'CMP'
  | 'CLEAN'
  | 'COMMON';

export interface ProcessMeta {
  id: ProcessId;
  /** 표시 순번. 1~8은 8대 공정, 9~10은 추가 공정, 0은 공정 순서 밖 */
  step: number;
  label: string;
  short: string;
  /** 8대 공정에 속하는지 */
  core: boolean;
  /** 이 공정이 웨이퍼에 남기는 결함의 성격 */
  character: string;
}

export const PROCESSES: Record<ProcessId, ProcessMeta> = {
  WAFER: {
    id: 'WAFER',
    step: 1,
    label: '웨이퍼 제조',
    short: '웨이퍼',
    core: true,
    character: '잉곳 성장·슬라이싱 단계의 결정 결함. 로트 전체에 걸쳐 재현되는 게 특징이다.',
  },
  OXIDATION: {
    id: 'OXIDATION',
    step: 2,
    label: '산화 · 확산 (열처리)',
    short: '산화',
    core: true,
    character: '온도 구배가 그대로 공간 패턴이 된다. RTP 존 배치가 방사형 결함의 반경을 결정한다.',
  },
  PHOTO: {
    id: 'PHOTO',
    step: 3,
    label: '포토 (노광)',
    short: '포토',
    core: true,
    character: '스핀 코팅의 회전 대칭성과 EBR의 가장자리 처리가 패턴을 만든다.',
  },
  ETCH: {
    id: 'ETCH',
    step: 4,
    label: '식각',
    short: '식각',
    core: true,
    character: '플라즈마 밀도 분포와 소모품(포커스 링) 상태가 반경 방향 편차를 만든다.',
  },
  DEPOSITION: {
    id: 'DEPOSITION',
    step: 5,
    label: '증착 · 이온주입',
    short: '증착',
    core: true,
    character: '샤워헤드 가스 분배와 RF 매칭이 중심/외곽 균일도를 결정한다.',
  },
  METAL: {
    id: 'METAL',
    step: 6,
    label: '금속 배선',
    short: '금속',
    core: true,
    character: '스퍼터 타겟 침식 프로파일이 반경 방향 두께 분포로 나타난다.',
  },
  EDS: {
    id: 'EDS',
    step: 7,
    label: 'EDS (전기적 검사)',
    short: 'EDS',
    core: true,
    character: '공간 결함을 만들지는 않지만, 공간 패턴 없는 수율 손실이 여기서 드러난다.',
  },
  PACKAGING: {
    id: 'PACKAGING',
    step: 8,
    label: '패키징',
    short: '패키징',
    core: true,
    character: '웨이퍼 단계 이후라 웨이퍼맵 결함의 원인이 되지는 않는다.',
  },
  CMP: {
    id: 'CMP',
    step: 9,
    label: '평탄화 (CMP)',
    short: 'CMP',
    core: false,
    character: '헤드 압력 존과 패드 마모 형상이 제거율 프로파일을 만든다.',
  },
  CLEAN: {
    id: 'CLEAN',
    step: 10,
    label: '세정',
    short: '세정',
    core: false,
    character: '노즐 위치와 원심 건조가 잔류물의 공간 분포를 결정한다.',
  },
  COMMON: {
    id: 'COMMON',
    step: 0,
    label: '공통 설비 · 반송',
    short: '공통',
    core: false,
    character: '특정 공정이 아니라 여러 공정에 공통으로 걸리는 설비(ESC, 반송 로봇, 게이트 도어).',
  },
};

export const PROCESS_ORDER: ProcessId[] = [
  'WAFER',
  'OXIDATION',
  'PHOTO',
  'ETCH',
  'DEPOSITION',
  'METAL',
  'EDS',
  'PACKAGING',
  'CMP',
  'CLEAN',
  'COMMON',
];

export type Disruption = 'none' | 'low' | 'high';

export const DISRUPTION_LABEL: Record<Disruption, string> = {
  none: '무정지',
  low: '경미',
  high: '설비 정지',
};

export interface Actionable {
  /** 지금 열어볼 것 */
  checks: string[];
  /** 확인되면 할 것 */
  remedy: string[];
  etaMin: number;
  disruption: Disruption;
  /** 원본 표에 없어서 이쪽에서 채운 초안인지 */
  draft: boolean;
}

export interface CauseEntry {
  id: string;
  pattern: DefectPatternId;
  factor: FactorType;
  process: ProcessId;
  /** 세부 설비·부품 */
  equipment: string;
  /** 무엇이 어긋났는가 */
  cause: string;
  /** 원인 → 결함까지의 기전 체인 (원본 표의 → 표기를 그대로 단계로 쪼갬) */
  mechanism: string[];
  /** 방향성 정보 — 원본 표의 [6시 하단 노치] 같은 대괄호 표기 */
  spatialSignature?: string;
  actionable: Actionable;
  /** 원본 표를 옮기며 확인이 필요하다고 본 지점 */
  note?: string;
}

export const CAUSE_MATRIX: CauseEntry[] = [
  /* ── Center ────────────────────────────────────────────────────────────── */
  {
    id: 'center-static-cmp',
    pattern: 'Center',
    factor: 'static',
    process: 'CMP',
    equipment: '캐리어 헤드 · 컨디셔너',
    cause: '캐리어 헤드 압력 설정 이탈, 컨디셔너 기어 불균형',
    mechanism: ['중심부 제거율이 주변부와 어긋남', '중심부 막질 두께 불균일'],
    actionable: {
      checks: [
        '헤드 존별 압력 설정값 vs 실측 로그 — 중앙 존 편차',
        '컨디셔너 스윕 궤적·체류 시간 프로파일',
        '직전 헤드/컨디셔너 정비 시점과 첫 불량 로트 시점 대조',
      ],
      remedy: ['중앙 존 압력 재캘리브레이션', '컨디셔너 기어 백래시 점검 후 교체'],
      etaMin: 15,
      disruption: 'none',
      draft: true,
    },
  },
  {
    id: 'center-static-cvd',
    pattern: 'Center',
    factor: 'static',
    process: 'DEPOSITION',
    equipment: '가스 주입부',
    cause: '중심부 가스 밀도 불균형 + 웨이퍼 중앙 직격',
    mechanism: ['중앙에 도달하는 반응물의 운동에너지·농도가 주변부보다 높음', '중심부 반응 과다'],
    actionable: {
      checks: [
        '중심/외곽 유량 분배(dual-zone) 설정값',
        '샤워헤드-웨이퍼 간격(gap) 실측',
        '중심 두께 프로파일 측정 포인트 트렌드',
      ],
      remedy: ['dual-zone 유량비 재설정', 'gap 재조정 후 균일도 재측정'],
      etaMin: 30,
      disruption: 'low',
      draft: true,
    },
  },
  {
    id: 'center-static-etch',
    pattern: 'Center',
    factor: 'static',
    process: 'ETCH',
    equipment: '플라즈마 챔버',
    cause: '중심부 반응시간 및 플라즈마 밀도 불균형',
    mechanism: ['중심부 Over-Etch 발생', '하부막 손상 및 프로파일 불량 가능성'],
    actionable: {
      checks: [
        '중심/외곽 식각률 프로파일 (CD 측정 포인트별)',
        'RF 파워·압력 설정과 실제 정합 상태',
        'OES 중심 채널 강도 트렌드',
        '하부막 손상 여부 — 단면 확인 필요성 판단',
      ],
      remedy: ['식각 시간 단축 후 재평가', '중심 플라즈마 밀도 완화 방향으로 압력·파워 재설정'],
      etaMin: 45,
      disruption: 'high',
      draft: true,
    },
  },
  {
    id: 'center-aging-pecvd',
    pattern: 'Center',
    factor: 'aging',
    process: 'DEPOSITION',
    equipment: 'PECVD 샤워헤드',
    cause: '샤워헤드 홀에 폴리머 찌꺼기 누적으로 막힘',
    mechanism: ['막힌 홀 주변의 가스 공급 저하', '가스 분배 프로파일이 중심 쪽으로 왜곡'],
    actionable: {
      checks: [
        '샤워헤드 누적 사용 시간 vs 교체 주기',
        '마지막 챔버 클리닝(세정 레시피) 이후 경과 매수',
        '균일도 악화가 매수에 따라 단조 증가하는지 — 경시 변화의 서명',
      ],
      remedy: ['챔버 인시츄 클리닝 주기 단축', '샤워헤드 교체 후 균일도 베이스라인 재취득'],
      etaMin: 40,
      disruption: 'high',
      draft: true,
    },
  },
  {
    id: 'center-aging-cmp',
    pattern: 'Center',
    factor: 'aging',
    process: 'CMP',
    equipment: '컨디셔너 조작 로봇',
    cause: '컨디셔너를 움직이는 로봇의 기어가 헐거워짐',
    mechanism: ['컨디셔닝 스윕이 패드 중앙부에만 오래 머무름', '패드가 Bowl형으로 과다 마모', '제거율 프로파일이 중심 편중으로 변형'],
    actionable: {
      checks: [
        '패드 프로파일 실측 — 중앙 함몰(Bowl) 형상 여부',
        '컨디셔너 암 백래시·엔코더 오차',
        '패드 교체 후 경과 시간에 따른 중심 편차 추이',
      ],
      remedy: ['컨디셔너 구동부 기어 교체', '패드 교체 및 브레이크인 레시피 재수행'],
      etaMin: 60,
      disruption: 'high',
      draft: true,
    },
  },
  {
    id: 'center-spatial-etch',
    pattern: 'Center',
    factor: 'spatial',
    process: 'ETCH',
    equipment: '챔버 기구물',
    cause: '챔버 기구가 한쪽으로 쏠려 설치됨',
    mechanism: ['가스 유동이 한쪽으로 치우침', '라디칼 농도 분포가 중심에서 편심'],
    spatialSignature: 'Center 치우침 (중심이 기하학적 중앙에서 벗어남)',
    actionable: {
      checks: [
        '결함 무게중심이 웨이퍼 기하 중심에서 얼마나·어느 방위로 벗어났는지',
        '챔버 기구물 설치 정렬 실측',
        '배기 포트 위치와 편심 방위의 상관',
      ],
      remedy: ['기구물 재정렬 후 균일도 재측정', '편심 방위가 배기 방향과 일치하면 배기 밸런스 조정'],
      etaMin: 50,
      disruption: 'high',
      draft: true,
    },
  },

  /* ── Donut ─────────────────────────────────────────────────────────────── */
  {
    id: 'donut-static-diffusion',
    pattern: 'Donut',
    factor: 'static',
    process: 'OXIDATION',
    equipment: 'RTP 램프 뱅크',
    cause: 'RTP 보상 가열 중 방사형 온도 구배 발생',
    mechanism: ['중간 반경에서 열 응력이 역전', '해당 반경 대역에만 결함이 링 형태로 남음'],
    actionable: {
      checks: [
        '존별 램프 파워 배분과 파이로미터 실측 프로파일',
        '보상 가열 구간의 승온 램프율',
        '결함 링의 반경이 어느 존 경계와 맞물리는지',
      ],
      remedy: ['중간 존 램프 파워 재배분', '승온 프로파일 완화로 열 응력 역전 구간 제거'],
      etaMin: 35,
      disruption: 'low',
      draft: true,
    },
  },
  {
    id: 'donut-static-clean',
    pattern: 'Donut',
    factor: 'static',
    process: 'CLEAN',
    equipment: 'Rinse 노즐',
    cause: 'Rinse 노즐 위치 및 분사 압력 불균형',
    mechanism: ['원심력으로 바깥까지 밀려나지 못한 잔류물', '중간 반경에 원형으로 residue 잔류'],
    actionable: {
      checks: ['노즐 위치·각도 실측', '분사 압력·유량 설정과 실측', '스핀 건조 RPM 프로파일'],
      remedy: ['노즐 스윕 범위 확장', '린스 압력 상향 후 잔류물 재확인'],
      etaMin: 20,
      disruption: 'low',
      draft: true,
    },
    note: '원본 표에서 정적 요인과 경시 변화 양쪽에 같은 내용으로 기재됨 — 어느 쪽이 맞는지 확인 필요.',
  },
  {
    id: 'donut-static-photo',
    pattern: 'Donut',
    factor: 'static',
    process: 'PHOTO',
    equipment: '스핀 코터',
    cause: '스핀 코터 RPM 이상',
    mechanism: ['PR이 균일하게 퍼지지 못함', '특정 반경 대역에 두께 이상이 링으로 남음'],
    actionable: {
      checks: ['스핀 RPM 설정 vs 실측 (모터 엔코더)', '가속 램프 프로파일', 'PR 두께 반경 방향 프로파일'],
      remedy: ['RPM 캘리브레이션', '스핀 프로파일 재설정 후 두께 균일도 재취득'],
      etaMin: 25,
      disruption: 'low',
      draft: true,
    },
    note: '원본 표에서 정적 요인과 경시 변화 양쪽에 같은 내용으로 기재됨 — 어느 쪽이 맞는지 확인 필요.',
  },
  {
    id: 'donut-aging-esc',
    pattern: 'Donut',
    factor: 'aging',
    process: 'COMMON',
    equipment: 'ESC O-ring',
    cause: 'ESC의 O-ring 부식으로 냉매 헬륨이 미세 누설',
    mechanism: ['O-ring 형상을 따라 냉각이 국부적으로 실패', '그 반경 대역의 온도가 상승', '식각 등 후속 공정에서 해당 링에 불량'],
    actionable: {
      checks: [
        'He leak rate 로그 — 규격 상한 접근 여부',
        '결함 링의 반경이 O-ring 배치 반경과 일치하는지',
        'ESC 온도 맵 (가능하면 존별 실측)',
      ],
      remedy: ['O-ring 교체 후 leak rate 재측정', '누설 확인 시 해당 챔버 통과 로트 전량 재검'],
      etaMin: 45,
      disruption: 'high',
      draft: true,
    },
    note: '원본 표에 "구분 X"로 기재 — 특정 공정이 아니라 여러 공정에 공통으로 걸리는 설비라 COMMON으로 분류했다.',
  },
  {
    id: 'donut-r2r-pecvd-fwe',
    pattern: 'Donut',
    factor: 'r2r',
    process: 'DEPOSITION',
    equipment: 'PECVD 샤워헤드',
    cause: '샤워헤드 첫 웨이퍼 효과(FWE)',
    mechanism: ['유휴 후 첫 웨이퍼에서 샤워헤드 방사율이 정상 상태와 다름', '중간 띠 반경에 열분해 효율 편차', '해당 반경에 링 형태 결함'],
    actionable: {
      checks: [
        '로트 내 첫 웨이퍼에만 나타나는지 — FWE의 결정적 서명',
        '챔버 유휴 시간과 결함 강도의 상관',
        '더미 웨이퍼(시즈닝) 수행 여부와 매수',
      ],
      remedy: ['시즈닝 더미 매수 상향', '유휴 시간 상한 설정 후 초과 시 자동 시즈닝'],
      etaMin: 25,
      disruption: 'none',
      draft: true,
    },
  },

  /* ── Edge-Ring ─────────────────────────────────────────────────────────── */
  {
    id: 'edgering-static-pecvd-flow',
    pattern: 'Edge-Ring',
    factor: 'static',
    process: 'DEPOSITION',
    equipment: '가스 주입구 · 배기 라인',
    cause: '외곽 가스 유량 불균형 — 챔버 내부 가스 주입구나 배기 라인의 비대칭성',
    mechanism: ['웨이퍼 중앙과 가장자리의 가스 밀도가 달라짐', '가장자리 반응 조건이 중앙과 어긋남'],
    actionable: {
      checks: ['가스 주입구·배기 포트 배치 대칭성', '외곽 존 유량 설정', '가장자리 두께 프로파일 (에지 3mm/5mm 포인트)'],
      remedy: ['외곽 존 유량 재배분', '배기 밸런스 조정 후 에지 균일도 재측정'],
      etaMin: 35,
      disruption: 'low',
      draft: true,
    },
    note: '원본 표에 "center 유사"로 기재 — 같은 기전이 어느 쪽으로 기우느냐의 차이라는 뜻으로 읽었다.',
  },
  {
    id: 'edgering-static-pecvd-rf',
    pattern: 'Edge-Ring',
    factor: 'static',
    process: 'DEPOSITION',
    equipment: 'RF 매칭 네트워크',
    cause: 'RF Power 매칭 불안정',
    mechanism: ['챔버 외곽으로 갈수록 플라즈마 밀도 저하 또는 에지 영역 임피던스 매칭 불량', '가장자리 부근에 결함 집중'],
    actionable: {
      checks: ['반사파(Reflected power) 로그 — 상승 추세 여부', '매칭 네트워크 튜닝 포지션 이력', '에지 영역 플라즈마 발광 균일도(OES/카메라)'],
      remedy: ['매칭 네트워크 재튜닝', '반사파 지속 시 RF 케이블·정합기 점검'],
      etaMin: 30,
      disruption: 'low',
      draft: true,
    },
  },
  {
    id: 'edgering-static-photo-ebr',
    pattern: 'Edge-Ring',
    factor: 'static',
    process: 'PHOTO',
    equipment: 'EBR 노즐',
    cause: 'EBR(Edge Bead Removal) 노즐 오정렬 또는 용액 유량 부족',
    mechanism: ['가장자리 PR이 깔끔하게 제거되지 않음', '후속 식각·증착 공정에서 에지 링 불량으로 발현'],
    actionable: {
      checks: ['EBR 폭 설정값 vs 실측 폭', '노즐 위치 캘리브레이션 이력', '용액 유량·토출 압력', '최근 EBR 레시피 변경 승인 기록'],
      remedy: ['노즐 재정렬 후 EBR 폭 실측 확인', '유량 상향 후 잔막 재확인'],
      etaMin: 20,
      disruption: 'none',
      draft: true,
    },
    note: '원심력을 이용하는 공정이라 결함이 가장자리에 집중된다는 점이 원본 표에 명시되어 있다.',
  },
  {
    id: 'edgering-aging-focusring',
    pattern: 'Edge-Ring',
    factor: 'aging',
    process: 'ETCH',
    equipment: '포커스 링',
    cause: 'RF 누적 인가에 따른 포커스 링 침식 (두께 얇아짐)',
    mechanism: ['웨이퍼 표면과 링 사이에 단차 발생', '플라즈마 Sheath가 가장자리에서 꺾임', '외곽 지역 플라즈마 밀도 변화'],
    actionable: {
      checks: [
        '링 누적 RF hour vs 교체 기준 도달 여부',
        '직전 교체 이후 처리 매수',
        '에지 CD가 매수에 따라 단조 이동하는지 — 경시 변화의 서명',
        '링 두께 실측 또는 육안 침식 기록',
      ],
      remedy: ['포커스 링 교체 후 에지 CD 베이스라인 재취득', '교체 주기를 RF hour 기준으로 재설정'],
      etaMin: 20,
      disruption: 'none',
      draft: true,
    },
  },
  {
    id: 'edgering-spatial-rtp',
    pattern: 'Edge-Ring',
    factor: 'spatial',
    process: 'OXIDATION',
    equipment: 'RTP 램프 뱅크',
    cause: 'RTP 보상 가열 중 방사형 온도 구배',
    mechanism: ['중간 반경에 열 응력 역전', '링 형태로 결함 형성'],
    actionable: {
      checks: ['존별 램프 파워와 파이로미터 프로파일', '결함 링 반경 vs 존 경계 위치'],
      remedy: ['외곽 존 파워 재배분', '승온 프로파일 완화'],
      etaMin: 35,
      disruption: 'low',
      draft: true,
    },
    note: '원본 표에 "donut 유사"로 기재 — 같은 기전이고 링의 반경이 어디에 서느냐의 차이다. 저해상도에서는 이 둘의 구분이 특히 어렵다.',
  },
  {
    id: 'edgering-r2r-fluorine',
    pattern: 'Edge-Ring',
    factor: 'r2r',
    process: 'ETCH',
    equipment: '챔버 벽면',
    cause: '이전 lot 공정으로 챔버 벽면에 불소 잔여물 누적',
    mechanism: ['다음 lot 공정 중 잔여물이 탈착', '벽면에 가까운 웨이퍼 가장자리에 집중 타격'],
    actionable: {
      checks: [
        '로트 순번에 따른 결함 강도 추이 — 후반 로트에서 심해지는지',
        '직전 로트의 공정 종류(불소계 화학 사용 여부)',
        '챔버 클리닝 이후 처리 매수',
      ],
      remedy: ['로트 간 챔버 클리닝 삽입', '클리닝 주기를 누적 매수 기준으로 단축'],
      etaMin: 30,
      disruption: 'low',
      draft: true,
    },
  },

  /* ── Edge-Loc ──────────────────────────────────────────────────────────── */
  {
    id: 'edgeloc-aging-esc-he',
    pattern: 'Edge-Loc',
    factor: 'aging',
    process: 'PHOTO',
    equipment: 'ESC 에지부',
    cause: 'ESC 엣지 부근 헬륨 누설로 냉각 실패',
    mechanism: ['누설 지점 주변의 국부 온도 상승', 'PR 붕괴'],
    actionable: {
      checks: [
        'He leak rate 로그와 누설 추정 위치',
        '결함 위치가 로트 간 동일한지 — 고정 누설점이면 위치가 재현된다',
        'ESC 표면 육안 검사 (에지 실링부)',
      ],
      remedy: ['ESC 실링부 보수 또는 교체', '누설 확인 시 해당 척 통과 웨이퍼 재검'],
      etaMin: 40,
      disruption: 'high',
      draft: true,
    },
  },
  {
    id: 'edgeloc-spatial-gatedoor',
    pattern: 'Edge-Loc',
    factor: 'spatial',
    process: 'COMMON',
    equipment: 'Gate door',
    cause: 'Gate door 부분에서 파티클 다량 유입',
    mechanism: ['게이트 개폐 시 발생한 파티클이 웨이퍼 하단부에 안착', '노치 기준 6시 방향에 국부 결함'],
    spatialSignature: '6시 하단 노치 방향',
    actionable: {
      checks: [
        '결함 방위가 노치 기준 6시에 고정되는지 — 이 서명이 맞으면 사실상 확정',
        '게이트 도어 실링·슬릿 밸브 파티클 검사',
        '게이트 개폐 횟수와 발생률 상관',
      ],
      remedy: ['슬릿 밸브 세정 및 실링 교체', '개폐 시퀀스 속도 완화로 파티클 발생 억제'],
      etaMin: 30,
      disruption: 'low',
      draft: true,
    },
  },

  /* ── Scratch ───────────────────────────────────────────────────────────── */
  {
    id: 'scratch-spatial-robotarm',
    pattern: 'Scratch',
    factor: 'spatial',
    process: 'COMMON',
    equipment: '반송 로봇 ARM',
    cause: 'Robot ARM 삽입 시 궤적 및 기울기 오차',
    mechanism: ['암이 웨이퍼 하단부를 스치며 접촉', '하단부에 선형 스크래치 다량 발생'],
    spatialSignature: '6시 방향 선형 긁힘',
    actionable: {
      checks: [
        '스크래치 방향이 암 삽입 궤적과 평행한지',
        '암 티칭 좌표·기울기(레벨링) 실측',
        'FOUP 슬롯 번호별 발생률 — 특정 슬롯 편중 여부',
        '엔드 이펙터 패드 마모 상태',
      ],
      remedy: ['암 재티칭 및 레벨링 보정', '엔드 이펙터 패드 교체'],
      etaMin: 35,
      disruption: 'low',
      draft: true,
    },
  },

  /* ── Near-full ─────────────────────────────────────────────────────────── */
  {
    id: 'nearfull-static-esc',
    pattern: 'Near-full',
    factor: 'static',
    process: 'COMMON',
    equipment: 'ESC 냉각계',
    cause: 'ESC 냉각 실패',
    mechanism: ['웨이퍼 전면 온도 급상승', 'PR 전면 붕괴'],
    actionable: {
      checks: [
        '척 냉각수 유량·온도 알람 이력',
        'He 백사이드 압력이 전 구간에서 무너졌는지',
        '해당 시각 설비 알람·인터록 로그',
        '계측계 오독 배제 — 표준 웨이퍼 재측정',
      ],
      remedy: ['후속 로트 즉시 홀드', '냉각계 복구 후 표준 웨이퍼로 검증하고 재가동'],
      etaMin: 15,
      disruption: 'high',
      draft: true,
    },
  },
  {
    id: 'nearfull-r2r-cmp-pad',
    pattern: 'Near-full',
    factor: 'r2r',
    process: 'CMP',
    equipment: '연마 패드',
    cause: '패드 표면 거칠기가 사용 시간에 따라 비단조로 변함',
    mechanism: [
      '초기에는 표면이 너무 부드러워 제거량 부족',
      '중반에 적정 거칠기 도달',
      '후반에 pore가 막히며 마모율 저하',
      '패드 수명 구간에 따라 전면 제거율이 흔들림',
    ],
    actionable: {
      checks: [
        '패드 사용 시간 대비 제거율 곡선 — U자/역U자 형태 확인',
        '현재 패드가 수명 곡선의 어느 구간에 있는지',
        '브레이크인(길들이기) 레시피 수행 여부',
        '컨디셔닝 강도와 pore 막힘의 상관',
      ],
      remedy: ['패드 수명 구간별 레시피 보정 테이블 적용', '브레이크인 매수 상향', '컨디셔닝 강도 재설정'],
      etaMin: 40,
      disruption: 'low',
      draft: true,
    },
    note: '원본 표에는 R2R 열에 있으나 내용은 패드 사용 시간에 따른 변화라 경시 변화 성격도 강하다. 열 배치 확인 필요.',
  },
];

/* ── 조회 헬퍼 ───────────────────────────────────────────────────────────── */

export function causesForPattern(pattern: DefectPatternId): CauseEntry[] {
  return CAUSE_MATRIX.filter((c) => c.pattern === pattern);
}

/** 이 패턴의 원인이 되는 공정만, 연관 강도(원인 개수) 순으로 */
export interface ProcessRelevance {
  process: ProcessId;
  meta: ProcessMeta;
  entries: CauseEntry[];
  /** 요인 유형이 몇 종류나 걸려 있는지 — 여러 축에서 지목될수록 유력 */
  factorSpread: number;
}

export function processesForPattern(pattern: DefectPatternId): ProcessRelevance[] {
  const entries = causesForPattern(pattern);
  const byProcess = new Map<ProcessId, CauseEntry[]>();
  for (const e of entries) {
    const list = byProcess.get(e.process) ?? [];
    list.push(e);
    byProcess.set(e.process, list);
  }

  return [...byProcess.entries()]
    .map(([process, list]) => ({
      process,
      meta: PROCESSES[process],
      entries: list,
      factorSpread: new Set(list.map((e) => e.factor)).size,
    }))
    .sort(
      (a, b) =>
        b.entries.length - a.entries.length ||
        b.factorSpread - a.factorSpread ||
        a.meta.step - b.meta.step,
    );
}

/** 아직 원인 매핑이 없는 패턴 — 지식베이스의 빈칸을 숨기지 않고 드러낸다 */
export function patternsWithoutCauses(): DefectPatternId[] {
  return PATTERN_ORDER.filter((p) => p !== 'None' && causesForPattern(p).length === 0);
}

/** 원본 표를 옮기며 확인이 필요하다고 표시해 둔 항목들 */
export function entriesNeedingReview(): CauseEntry[] {
  return CAUSE_MATRIX.filter((c) => c.note);
}
