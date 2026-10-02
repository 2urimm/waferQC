import type { DefectPatternId } from '../domain/causes';

/**
 * 이 해상도에서 직접 가르지 않기로 한 구분과 그 근거.
 * 못 하는 걸 못 한다고 말하는 것도 판정 결과의 일부라, 보고서 "이 판정의 한계"에 그대로 싣는다.
 */
export interface UnresolvedPair {
  pair: [DefectPatternId, DefectPatternId];
  reason: string;
  /** 이 둘을 가르려면 무엇이 더 필요한가 */
  needs: string;
}

export const UNRESOLVED_PAIRS: UnresolvedPair[] = [
  {
    pair: ['Center', 'Donut'],
    reason:
      '반경 방향으로 쓸 수 있는 구간이 4개뿐이라, 중심 피크와 중간 반경 피크가 한 구간 차이다. 링의 안쪽 지름이 한 칸만 줄어도 Center로 읽힌다.',
    needs: '반경 구간이 최소 8개 이상 — 16×16 이상 해상도',
  },
  {
    pair: ['Donut', 'Edge-Ring'],
    reason:
      '중간 반경 링과 외곽 링의 경계가 최외곽 한 칸 차이다. 원본 표에도 두 패턴의 기전이 "donut 유사"로 겹쳐 기재되어 있다.',
    needs: '반경 구간 세분, 또는 링 두께를 직접 재는 별도 계측',
  },
  {
    pair: ['Loc', 'Scratch'],
    reason:
      '8x8에서 선형성을 판정하려면 군집이 4~5칸 이상 일직선이어야 하는데, 그 길이면 이미 일반 국부 군집과 통계적으로 구분되지 않는다.',
    needs: '군집 장축/단축을 신뢰성 있게 잴 수 있는 해상도. 대신 이방성 수치를 근거로 같이 내보낸다.',
  },
  {
    pair: ['Edge-Loc', 'Edge-Ring'],
    reason:
      '최외곽 링이 28칸뿐이라 "가장자리 일부"와 "가장자리 전체"의 경계가 몇 칸 차이로 뒤집힌다.',
    needs: '외곽 링의 각도 분해능. 대신 각도 분산과 우세 방위(시 방향)를 수치로 내보낸다.',
  },
];
