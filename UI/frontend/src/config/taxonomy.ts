import type { DefectPatternId } from '../domain/causes';

/**
 * 두 층으로 된 분류 체계.
 *
 *  1층 — 계통 (Family). 모델이 실제로 내보내는 것.
 *        64칸에서 신뢰 가능하게 갈라지는 축(밀도 / 반경 편중 / 군집)만으로 정의했다.
 *  2층 — 세부 패턴 (DefectPatternId). 원인 지식베이스가 색인된 9종 표준 체계.
 *        모델이 직접 맞히지 않고, 계통 안에서 후보로 펼쳐 각각의 확률을 같이 보여준다.
 *
 * 이렇게 나눈 이유: 8x8에서 Donut과 Edge-Ring, Loc과 Scratch를 직접 가르려 들면
 * 오분류가 나고, 오분류된 라벨은 엔지니어를 엉뚱한 공정으로 보낸다.
 * 대신 "반경 방향 구조인 건 확실하고, 그 안에서 Center가 유력하되 Donut도 배제 못 한다"까지
 * 말하는 편이 실제 점검에는 더 쓸모 있다. 모델은 확신할 수 있는 만큼만 확신하고,
 * 나머지 불확실성은 숨기지 않고 후보 목록으로 넘긴다.
 */

export type FamilyId = 'NORMAL' | 'RADIAL_INNER' | 'RADIAL_OUTER' | 'LOCAL' | 'SCATTER' | 'GLOBAL';

export interface Family {
  id: FamilyId;
  label: string;
  short: string;
  /** 8x8에서 이 계통을 무엇으로 판별하는가 */
  discriminator: string;
  /** 엔지니어가 알아야 할 한 줄 */
  meaning: string;
  urgency: 'none' | 'watch' | 'investigate' | 'immediate';
  /**
   * 이 계통에 속하는 9클래스.
   * 각 클래스는 정확히 한 계통에만 속한다 — 계통 확률이 소속 클래스 확률의 합이어야
   * 하므로 겹치면 확률 합이 1을 넘는다. 실제 매핑은 config/model.ts의 PATTERN_FAMILY.
   */
  patterns: DefectPatternId[];
}

export const FAMILIES: Record<FamilyId, Family> = {
  NORMAL: {
    id: 'NORMAL',
    label: '정상',
    short: '정상',
    discriminator: '결함률이 배경 수준 이하',
    meaning: '이 해상도에서 잡히는 계통 패턴이 없음. 결함이 없다는 뜻은 아니다.',
    urgency: 'none',
    patterns: ['None'],
  },
  RADIAL_INNER: {
    id: 'RADIAL_INNER',
    label: '반경 구조 · 중심 편중',
    short: '중심계',
    discriminator: '결함 무게중심 반경이 안쪽으로 치우침',
    meaning: '회전 대칭 공정(연마·도포·가스 분배)의 중앙 조건 이탈.',
    urgency: 'investigate',
    patterns: ['Center', 'Donut'],
  },
  RADIAL_OUTER: {
    id: 'RADIAL_OUTER',
    label: '반경 구조 · 외곽 편중',
    short: '외곽계',
    discriminator: '결함 무게중심 반경이 바깥으로 치우침',
    meaning: '에지 소모품·척 접촉·에지 처리 레시피 쪽 신호.',
    urgency: 'investigate',
    patterns: ['Edge-Ring', 'Edge-Loc'],
  },
  LOCAL: {
    id: 'LOCAL',
    label: '국부 집중',
    short: '국부계',
    discriminator: '단일 연결 군집이 전체 결함의 대부분을 차지',
    meaning: '특정 챔버·특정 샷·고정 접촉점처럼 위치가 고정된 원인.',
    urgency: 'investigate',
    patterns: ['Loc', 'Scratch'],
  },
  SCATTER: {
    id: 'SCATTER',
    label: '산발',
    short: '산발계',
    discriminator: '결함은 있으나 반경 편중·군집 모두 약함',
    meaning: '특정 장비보다 환경·케미컬·파티클 쪽 유래 가능성이 높다.',
    urgency: 'watch',
    patterns: ['Random'],
  },
  GLOBAL: {
    id: 'GLOBAL',
    label: '전면 이상',
    short: '전면계',
    discriminator: '결함률이 임계 이상 — 공간 구조와 무관하게 우선',
    meaning: '공정 대형 이탈 또는 계측계 자체 고장. 원인 추적보다 확산 차단이 먼저.',
    urgency: 'immediate',
    patterns: ['Near-full'],
  },
};

export const FAMILY_ORDER: FamilyId[] = ['NORMAL', 'RADIAL_INNER', 'RADIAL_OUTER', 'LOCAL', 'SCATTER', 'GLOBAL'];

/**
 * 이 해상도에서 직접 가르지 않기로 한 구분과 그 근거.
 * 못 하는 걸 못 한다고 말하는 것도 판정 결과의 일부라, UI에 그대로 노출한다.
 */
export interface UnresolvedPair {
  pair: [DefectPatternId, DefectPatternId];
  within: FamilyId;
  reason: string;
  /** 이 둘을 가르려면 무엇이 더 필요한가 */
  needs: string;
}

export const UNRESOLVED_PAIRS: UnresolvedPair[] = [
  {
    pair: ['Center', 'Donut'],
    within: 'RADIAL_INNER',
    reason:
      '반경 방향으로 쓸 수 있는 구간이 4개뿐이라, 중심 피크와 중간 반경 피크가 한 구간 차이다. 링의 안쪽 지름이 한 칸만 줄어도 Center로 읽힌다.',
    needs: '반경 구간이 최소 8개 이상 — 16×16 이상 해상도',
  },
  {
    pair: ['Donut', 'Edge-Ring'],
    within: 'RADIAL_OUTER',
    reason:
      '중간 반경 링과 외곽 링의 경계가 최외곽 한 칸 차이다. 원본 표에도 두 패턴의 기전이 "donut 유사"로 겹쳐 기재되어 있다.',
    needs: '반경 구간 세분, 또는 링 두께를 직접 재는 별도 계측',
  },
  {
    pair: ['Loc', 'Scratch'],
    within: 'LOCAL',
    reason:
      '8x8에서 선형성을 판정하려면 군집이 4~5칸 이상 일직선이어야 하는데, 그 길이면 이미 일반 국부 군집과 통계적으로 구분되지 않는다.',
    needs: '군집 장축/단축을 신뢰성 있게 잴 수 있는 해상도. 대신 이방성 수치를 근거로 같이 내보낸다.',
  },
  {
    pair: ['Edge-Loc', 'Edge-Ring'],
    within: 'RADIAL_OUTER',
    reason:
      '최외곽 링이 28칸뿐이라 "가장자리 일부"와 "가장자리 전체"의 경계가 몇 칸 차이로 뒤집힌다.',
    needs: '외곽 링의 각도 분해능. 대신 각도 분산과 우세 방위(시 방향)를 수치로 내보낸다.',
  },
];

export function unresolvedPairsFor(family: FamilyId): UnresolvedPair[] {
  return UNRESOLVED_PAIRS.filter((p) => p.within === family);
}

/** 판정 신뢰도 구간 */
export type ConfidenceBand = 'high' | 'medium' | 'low';

export function confidenceBand(top1: number, top2: number): ConfidenceBand {
  const margin = top1 - top2;
  if (top1 >= 0.6 && margin >= 0.25) return 'high';
  if (margin >= 0.12) return 'medium';
  return 'low';
}

export const CONFIDENCE_COPY: Record<ConfidenceBand, { label: string; note: string }> = {
  high: {
    label: '높음',
    note: '단일 계통으로 판정. 아래 공정 순서대로 진행하면 된다.',
  },
  medium: {
    label: '보통',
    note: '1순위 계통으로 시작하되, 2순위 계통의 첫 공정까지는 같이 확인할 것.',
  },
  low: {
    label: '낮음',
    note: '상위 2개 계통이 접해 있다. 단정하지 말고 두 계통의 첫 공정을 병렬로 확인할 것.',
  },
};
