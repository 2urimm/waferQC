import { CELL_DEFECT, CLASS_NAMES, PATTERN_FAMILY, PRIMARY_MODEL } from '../config/model';
import { FAMILIES, FAMILY_ORDER, type FamilyId } from '../config/taxonomy';
import type { DefectPatternId } from './causes';
import { decideReview } from './review';
import type { FamilyScore, FeatureDriver, PatternCandidate, Verdict, WaferFeatures, WaferMap } from './types';

/**
 * 규칙 기반 대체 분류기.
 *
 * ⚠ 학습된 모델이 아니다. WaferCNNV2가 붙기 전까지 UI 전 구간을 동작시키기 위한
 * 대체물이며, `services/inference.ts`의 어댑터만 바꾸면 통째로 교체된다.
 *
 * 출력 형태는 실제 모델과 같게 맞췄다 — 9클래스 확률(합 1). 그래야 모델이 붙을 때
 * UI가 한 줄도 안 바뀐다.
 *
 * 내부적으로는 두 단계로 만든다.
 *   1) 계통 점수 — 64칸에서 신뢰 가능한 축(밀도 / 반경 편중 / 군집)만으로.
 *   2) 계통 확률을 소속 클래스에 배분 — 계통 안에서 어느 클래스가 유력한지의 상대 비중.
 * 이렇게 하는 이유는 8x8에서 개별 클래스를 직접 겨루게 하면 인접 클래스끼리
 * 확률이 마구 새기 때문이다. 계통은 안정적으로 갈리고, 그 안의 배분은 근거를 붙일 수 있다.
 */

export const RULE_ENGINE_VERSION = 'rule-mock/0.6';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 균일 분포일 때의 평균 정규화 반경. 이걸 기준으로 안쪽/바깥쪽을 가른다. */
const NEUTRAL_RADIUS = 0.66;

export function classify(map: WaferMap, f: WaferFeatures): Omit<Verdict, 'inferMs'> {
  const familyProb = softmax(scoreFamilies(f), 4.5);
  const patterns = distributeToPatterns(familyProb, f);

  const top = patterns[0];
  const familyScores = aggregateFamilies(patterns);

  return {
    top: top.id,
    topScore: top.probability,
    patterns,
    family: familyScores[0].id,
    familyScores,
    review: decideReview(top.id, top.probability, patterns, map, f),
    features: f,
    drivers: buildDrivers(familyScores[0].id, f),
    caveats: buildCaveats(f),
    engine: 'rule-mock',
    engineVersion: RULE_ENGINE_VERSION,
  };
}

/* ── 1단계: 계통 점수 ────────────────────────────────────────────────────── */

/** 규칙은 전부 여기 모여 있어 감사(audit)가 가능하다. */
function scoreFamilies(f: WaferFeatures): Record<FamilyId, number> {
  const { defectRatio, defectCount, radialCentroid, edgeShare, coreShare, clusterCount, largestClusterShare } = f;

  const sparse = clamp01((0.08 - defectRatio) / 0.08);
  const centerness = clamp01((NEUTRAL_RADIUS - radialCentroid) / 0.28);
  const edgeness = clamp01((radialCentroid - NEUTRAL_RADIUS) / 0.3);
  const fragmentation = defectCount ? clamp01(clusterCount / Math.max(2, defectCount * 0.6)) : 0;
  const concentration = clamp01((largestClusterShare - 0.45) / 0.45);

  /*
   * Near-full을 밀도만으로 잡으면 안 된다.
   * 8x8에서 최외곽 링은 그 자체로 웨이퍼 안 칸의 절반 가까이를 차지한다. 즉 정상적인
   * Edge-Ring 결함도 "밀도 40% 초과"를 그냥 넘어버려 전면으로 오분류된다.
   * 전면의 진짜 서명은 밀도가 아니라 "안쪽까지 다 찼는가"다 —
   * 링은 최내측 구간이 비어 있고, 전면은 거기까지 차 있다.
   */
  const innerFill = clamp01((f.radialProfile[0] ?? 0) / 0.6);
  const globalDensity = clamp01((defectRatio - 0.35) / 0.35);

  /*
   * 반경 편중 계통은 결함이 중심을 "둘러싸야" 성립한다.
   * 반경만 보면 중심 근처에 놓인 국소 덩어리도 중심 편중으로 읽히므로,
   * 각도 분산으로 둘을 가른다. 한 방향에만 몰려 있으면 반경 구조가 아니라 국부다.
   */
  const radialSymmetry = 0.25 + 0.75 * f.defectAngularSpread;

  // 정말 전면일 때만 다른 계통을 깎는다 (안쪽이 빈 링은 깎지 않는다)
  const globalPenalty = 1 - globalDensity * 0.5 * innerFill;

  /*
   * 링(Donut)은 무게중심으로 절대 못 잡는다.
   * 링의 평균 반경은 정의상 중간값이라 균일 분포와 똑같은 값이 나온다 —
   * 실제로 Donut 프리셋의 무게중심은 0.65로 중립값(0.66)과 사실상 같다.
   * 링의 서명은 위치가 아니라 **반경 프로파일의 모양**이다:
   *   한 반경 구간이 거의 꽉 차 있고(peakVal), 그 구간에만 몰려 있고(집중도),
   *   최내측은 비어 있고(hollow), 중심을 빙 둘러싼다(around).
   * 네 조건을 다 요구해야 무작위 산포가 링으로 오인되지 않는다 —
   * 산포도 우연히 최내측이 빌 수 있지만, 한 구간이 꽉 차지는 않는다.
   */
  const peakVal = f.radialProfile[f.peakRadialBin] ?? 0;
  const profileSum = f.radialProfile.reduce((a, b) => a + b, 0) || 1;
  const bandConcentration = clamp01((peakVal / profileSum - 0.35) / 0.4);
  const bandFull = clamp01((peakVal - 0.5) / 0.35);
  const hollow = peakVal > 0.01 ? clamp01((peakVal - (f.radialProfile[0] ?? 0)) / peakVal) : 0;
  const ringness = bandConcentration * bandFull * hollow * f.defectAngularSpread;

  // 링이 어느 반경에 섰는지로 소속 계통이 갈린다. 최외측이면 Edge-Ring, 아니면 Donut.
  // 외측(구간 2)은 둘 사이라 양쪽에 나눠 준다 — 문서화된 미분리 쌍이다.
  const ringInner = f.peakRadialBin <= 2 ? ringness : 0;
  const ringOuter = f.peakRadialBin === 3 ? ringness : f.peakRadialBin === 2 ? ringness * 0.45 : 0;

  // 외곽 링에 붙은 군집은 위치가 고정된 국부 결함이 아니라 에지 구조다.
  // Scratch를 깎을 때와 같은 근거 — 링의 한 변은 격자 기하 때문에 저절로 그렇게 보인다.
  const clusterOnEdge = clamp01((f.largestClusterRadius - 0.8) / 0.2);

  return {
    GLOBAL: globalDensity * (0.35 + 0.65 * innerFill) * (defectRatio >= 0.55 ? 1.35 : 1),
    NORMAL: sparse * 0.95 + (defectCount === 0 ? 0.3 : 0),
    LOCAL:
      concentration *
      (1 - sparse) *
      globalPenalty *
      (largestClusterShare >= 0.5 ? 1 : 0.5) *
      (1 - f.defectAngularSpread * 0.35) *
      (1 - clusterOnEdge * 0.45),
    RADIAL_INNER:
      Math.max(centerness * (0.55 + coreShare * 0.45) * radialSymmetry, ringInner) * (1 - sparse) * globalPenalty,
    RADIAL_OUTER:
      Math.max(edgeness * (0.55 + edgeShare * 0.45) * (0.55 + 0.45 * radialSymmetry), ringOuter) *
      (1 - sparse) *
      globalPenalty,
    SCATTER:
      (1 - Math.max(centerness, edgeness, ringness)) *
      (1 - concentration) *
      fragmentation *
      (1 - sparse) *
      globalPenalty,
  };
}

function softmax(scores: Record<FamilyId, number>, k: number): Record<FamilyId, number> {
  const exps = {} as Record<FamilyId, number>;
  let sum = 0;
  for (const id of FAMILY_ORDER) {
    const e = Math.exp(k * scores[id]);
    exps[id] = e;
    sum += e;
  }
  for (const id of FAMILY_ORDER) exps[id] /= sum;
  return exps;
}

/* ── 2단계: 계통 확률을 9클래스로 배분 ───────────────────────────────────── */

const num = (x: number, d = 2) => x.toFixed(d);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

/** 반경 프로파일이 얼마나 "속이 빈" 모양인지. 0 = Center 성격, 1 = Donut 성격. */
function hollowness(f: WaferFeatures): number {
  const peak = f.radialProfile[f.peakRadialBin] ?? 0;
  if (peak <= 0.01) return 0;
  return clamp01((peak - (f.radialProfile[0] ?? 0)) / peak);
}

function distributeToPatterns(familyProb: Record<FamilyId, number>, f: WaferFeatures): PatternCandidate[] {
  const out: PatternCandidate[] = [];

  for (const family of FAMILY_ORDER) {
    const members = FAMILIES[family].patterns;
    const weights = withinFamilyWeights(family, f);
    const total = members.reduce((s, id) => s + (weights[id]?.weight ?? 0), 0) || 1;

    for (const id of members) {
      const w = weights[id] ?? { weight: 1 / members.length, reason: '' };
      const within = w.weight / total;
      out.push({
        id,
        probability: familyProb[family] * within,
        withinFamily: within,
        reason: w.reason,
      });
    }
  }

  // 모델 출력 순서와 무관하게 확률 내림차순으로 준다 (UI가 그대로 그린다)
  return out.sort((a, b) => b.probability - a.probability);
}

type WeightMap = Partial<Record<DefectPatternId, { weight: number; reason: string }>>;

function withinFamilyWeights(family: FamilyId, f: WaferFeatures): WeightMap {
  const hollow = hollowness(f);
  const binLabel = ['최내측', '내측', '외측', '최외측'][f.peakRadialBin] ?? '?';

  switch (family) {
    case 'NORMAL':
      return {
        None: {
          weight: 1,
          reason: `웨이퍼 안 ${f.waferCellCount}칸 중 불량 ${f.defectCount}칸 (${pct(f.defectRatio)}). 이 해상도에서 구조를 논할 근거가 없다.`,
        },
      };

    case 'GLOBAL':
      return {
        'Near-full': {
          weight: 1,
          reason: `웨이퍼 안 칸의 ${pct(f.defectRatio)}가 불량이고 최내측 구간까지 차 있다. 밀도가 임계를 넘어 공간 구조 추정 자체가 의미를 잃는 구간이다.`,
        },
      };

    case 'SCATTER':
      return {
        Random: {
          weight: 1,
          reason: `불량이 ${f.clusterCount}개 덩어리로 흩어져 있고 반경 편중(무게중심 ${num(f.radialCentroid)})도 약하다.`,
        },
      };

    case 'RADIAL_INNER':
      return {
        Center: {
          weight: 0.15 + (1 - hollow) * 0.85,
          reason: `반경 피크가 ${binLabel} 구간이고 최내측 밀도가 ${num(f.radialProfile[0] ?? 0)}로 살아 있다. 속이 찬 중심 편중.`,
        },
        Donut: {
          weight: 0.1 + hollow * 0.7,
          reason:
            hollow > 0.4
              ? `최내측 밀도(${num(f.radialProfile[0] ?? 0)})가 피크(${num(f.radialProfile[f.peakRadialBin] ?? 0)})보다 낮아 가운데가 빈 모양이다. 다만 반경 구간이 4개뿐이라 Center와 한 구간 차이다.`
              : '가운데가 빈 징후는 약하지만, 반경 분해능이 4구간뿐이라 배제하지 못한다.',
        },
      };

    case 'RADIAL_OUTER': {
      const spread = clamp01((f.edgeAngularSpread - 0.3) / 0.4);
      return {
        'Edge-Ring': {
          weight: 0.1 + spread * 0.9,
          reason: `외곽 불량의 각도 분산이 ${num(f.edgeAngularSpread)}로 링 전체에 ${spread > 0.5 ? '고르게 퍼져' : '다소 치우쳐'} 있다.`,
        },
        'Edge-Loc': {
          weight: 0.1 + (1 - spread) * 0.8,
          reason: `외곽 불량이 ${f.edgeDominantClock}시 방향에 몰려 있다 (각도 분산 ${num(f.edgeAngularSpread)}).${
            f.edgeDominantClock >= 5 && f.edgeDominantClock <= 7
              ? ' 6시 부근은 원인 표의 게이트 도어 파티클 서명과 일치하는 방위다.'
              : ''
          }`,
        },
      };
    }

    case 'LOCAL': {
      // 외곽 링에 붙은 군집은 격자 구조상 자동으로 일직선이 된다 (링의 한 변이 곧 직선이다).
      // 그래서 이방성만 보면 가장자리 호를 전부 Scratch로 읽어버린다. 군집이 링에 붙어
      // 있을수록 선형성의 증거 능력을 깎는다 — 이건 8x8 격자의 기하 때문에 생기는
      // 계통 오차이지 데이터가 말해 주는 게 아니다.
      const onEdgeRing = clamp01((f.largestClusterRadius - 0.8) / 0.2);
      const rawScratch = f.largestClusterSize >= 4 ? clamp01((f.clusterAnisotropy - 0.5) / 0.35) : 0;
      const scratchness = rawScratch * (1 - onEdgeRing * 0.8);
      return {
        Loc: {
          weight: 0.2 + (1 - scratchness) * 0.8,
          reason: `최대 군집 ${f.largestClusterSize}칸이 전체 불량의 ${pct(f.largestClusterShare)}를 차지하고, 형상은 ${
            f.clusterAnisotropy < 0.5 ? '덩어리에 가깝다' : '다소 길쭉하다'
          } (이방성 ${num(f.clusterAnisotropy)}, 방위 ${f.largestClusterClock}시).`,
        },
        Scratch: {
          weight: 0.05 + scratchness * 0.8,
          reason:
            f.largestClusterSize < 4
              ? `군집이 ${f.largestClusterSize}칸뿐이라 8x8에서 선형성을 판정할 수 없다.`
              : onEdgeRing > 0.4
                ? `군집 이방성은 ${num(f.clusterAnisotropy)}로 높지만 군집이 외곽 링에 붙어 있다 (무게중심 반경 ${num(f.largestClusterRadius)}). 링의 한 변은 격자 구조상 그냥 직선이라 이 이방성은 스크래치의 증거가 되지 못해 순위를 낮췄다.`
                : `군집 이방성 ${num(f.clusterAnisotropy)} — ${
                    scratchness > 0.5 ? '직선에 가깝다' : '직선이라 하기엔 약하다'
                  }. 방위 ${f.largestClusterClock}시.${
                    f.largestClusterClock >= 5 && f.largestClusterClock <= 7
                      ? ' 6시 부근은 원인 표의 반송 암 서명과 일치하는 방위다.'
                      : ''
                  }`,
        },
      };
    }

    default:
      return {};
  }
}

/** 9클래스 확률을 계통으로 되묶는다 (합이 보존된다) */
function aggregateFamilies(patterns: PatternCandidate[]): FamilyScore[] {
  const sums = Object.fromEntries(FAMILY_ORDER.map((f) => [f, 0])) as Record<FamilyId, number>;
  for (const p of patterns) sums[PATTERN_FAMILY[p.id]] += p.probability;
  return FAMILY_ORDER.map((id) => ({ id, probability: sums[id] })).sort((a, b) => b.probability - a.probability);
}

/**
 * 모델 서버가 9클래스 확률만 내려줄 때 UI 쪽에서 Verdict를 완성한다.
 * 실제 모델이 붙어도 근거(drivers)·한계(caveats)·계통 집계는 여기 로직을 그대로 쓴다.
 */
export function verdictFromProbabilities(
  probabilities: number[],
  map: WaferMap,
  f: WaferFeatures,
  meta: { engineVersion: string },
): Omit<Verdict, 'inferMs'> {
  const weightsCache = new Map<FamilyId, WeightMap>();
  const patterns: PatternCandidate[] = CLASS_NAMES.map((id, i) => {
    const family = PATTERN_FAMILY[id];
    if (!weightsCache.has(family)) weightsCache.set(family, withinFamilyWeights(family, f));
    const reason = weightsCache.get(family)![id]?.reason ?? '';
    return { id, probability: probabilities[i] ?? 0, withinFamily: 0, reason };
  }).sort((a, b) => b.probability - a.probability);

  const familyScores = aggregateFamilies(patterns);
  const famTotal = Object.fromEntries(familyScores.map((s) => [s.id, s.probability])) as Record<FamilyId, number>;
  for (const p of patterns) {
    const t = famTotal[PATTERN_FAMILY[p.id]];
    p.withinFamily = t > 0 ? p.probability / t : 0;
  }

  const top = patterns[0];

  return {
    top: top.id,
    topScore: top.probability,
    patterns,
    family: familyScores[0].id,
    familyScores,
    review: decideReview(top.id, top.probability, patterns, map, f),
    features: f,
    drivers: buildDrivers(familyScores[0].id, f),
    caveats: buildCaveats(f),
    engine: 'model',
    engineVersion: meta.engineVersion || PRIMARY_MODEL,
  };
}

/* ── 판정 근거 & 한계 ────────────────────────────────────────────────────── */

function buildDrivers(family: FamilyId, f: WaferFeatures): FeatureDriver[] {
  const all: FeatureDriver[] = [
    {
      feature: 'defectRatio',
      label: '불량 비율',
      value: `${pct(f.defectRatio)} (${f.defectCount} / 웨이퍼 안 ${f.waferCellCount}칸)`,
      effect: 'neutral',
      note: '웨이퍼 밖(0) 칸은 분모에서 뺐다. 안 그러면 원형 웨이퍼의 모서리 때문에 비율이 낮게 나온다.',
    },
    {
      feature: 'radialCentroid',
      label: '결함 무게중심 반경',
      value: num(f.radialCentroid),
      effect: 'neutral',
      note: `0=중심, 1=가장자리. 균일 분포면 약 ${NEUTRAL_RADIUS} 부근에 온다.`,
    },
    {
      feature: 'peakRadialBin',
      label: '반경 피크 구간',
      value: `${['최내측', '내측', '외측', '최외측'][f.peakRadialBin]} (${f.radialProfile.map((v) => num(v, 1)).join(' / ')})`,
      effect: 'neutral',
      note: '반경을 4구간으로 나눈 밀도. Center·Donut·Edge-Ring을 가르는 축이지만 구간이 4개뿐이라 인접 클래스가 겹친다.',
    },
    {
      feature: 'largestClusterShare',
      label: '최대 군집 점유율',
      value: `${pct(f.largestClusterShare)} (${f.largestClusterSize}칸 / 군집 ${f.clusterCount}개)`,
      effect: 'neutral',
      note: '한 덩어리가 전체 불량에서 차지하는 비율. 8-연결 기준이라 대각 스크래치도 한 덩어리로 센다.',
    },
    {
      feature: 'clusterAnisotropy',
      label: '군집 이방성',
      value: num(f.clusterAnisotropy),
      effect: 'neutral',
      note: '0=덩어리, 1=직선. Loc과 Scratch를 클래스로 가르는 대신 내보내는 수치다.',
    },
    {
      feature: 'defectAngularSpread',
      label: '결함 각도 분산',
      value: num(f.defectAngularSpread),
      effect: 'neutral',
      note: '0=한 방향에 몰림, 1=중심을 빙 둘러쌈. 반경 편중 계통은 중심을 둘러싸야 성립하므로, 이 값이 낮으면 반경 구조가 아니라 국부다.',
    },
    {
      feature: 'edgeAngularSpread',
      label: '외곽 각도 분산',
      value: num(f.edgeAngularSpread),
      effect: 'neutral',
      note: '0=가장자리 한쪽에 몰림, 1=링 전체에 고름. Edge-Loc과 Edge-Ring을 가르는 대신 내보낸다.',
    },
    {
      feature: 'largestClusterClock',
      label: '군집 방위 (노치=6시)',
      value: f.largestClusterSize ? `${f.largestClusterClock}시` : '—',
      effect: 'neutral',
      note: '원인 표의 "6시 하단 노치" 같은 방향성 서명과 직접 대조하는 값. 6시 부근이면 게이트 도어·반송 암이 유력해진다.',
    },
    {
      feature: 'edgeShare',
      label: '외곽 링 점유율',
      value: pct(f.edgeShare),
      effect: 'neutral',
      note: '최외곽 링에 들어간 불량의 비율.',
    },
  ];

  const supporting: Record<FamilyId, Array<keyof WaferFeatures>> = {
    GLOBAL: ['defectRatio', 'peakRadialBin'],
    NORMAL: ['defectRatio'],
    RADIAL_INNER: ['radialCentroid', 'peakRadialBin', 'defectAngularSpread'],
    RADIAL_OUTER: ['radialCentroid', 'edgeShare', 'edgeAngularSpread', 'peakRadialBin', 'defectAngularSpread'],
    LOCAL: ['largestClusterShare', 'clusterAnisotropy', 'largestClusterClock', 'defectAngularSpread'],
    SCATTER: ['largestClusterShare', 'radialCentroid', 'defectRatio'],
  };

  const keys = supporting[family] ?? [];
  return all
    .map((d) => (keys.includes(d.feature) ? { ...d, effect: 'supports' as const } : d))
    .sort((a, b) => (a.effect === 'supports' ? -1 : 0) - (b.effect === 'supports' ? -1 : 0));
}

function buildCaveats(f: WaferFeatures): string[] {
  const out: string[] = [];

  if (f.defectCount > 0 && f.defectCount <= 3) {
    out.push(
      `불량 칸이 ${f.defectCount}칸뿐이다. 64칸 해상도에서 3칸 이하는 공간 구조를 논하기에 표본이 부족하니, 계통 판정보다 재측정이 먼저다.`,
    );
  }

  if (f.defectRatio >= 0.75) {
    out.push(
      '불량 비율이 75%를 넘는다. 실제 전면 불량일 수도 있지만 계측계(MUX·ADC·기준전압) 고장도 같은 모양으로 나타난다. 표준 웨이퍼 재측정으로 계측계부터 배제할 것.',
    );
  }

  if (f.largestClusterSize > 0 && f.largestClusterSize < 4 && f.largestClusterShare > 0.5) {
    out.push(
      `최대 군집이 ${f.largestClusterSize}칸이라 형상(직선 여부)을 판정할 수 없다. Scratch 후보의 순위는 참고만 하고, 결함 위치가 로트 간 재현되는지를 대신 확인할 것.`,
    );
  }

  return out;
}

/** 불량 칸 수 — 검토 정책과 표시에 쓴다 */
export function countDefectCells(map: WaferMap): number {
  return map.filter((c) => c === CELL_DEFECT).length;
}
