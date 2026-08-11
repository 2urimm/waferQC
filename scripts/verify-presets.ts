/**
 * 프리셋 9종을 파이프라인에 그대로 통과시켜 판정·후보·공정 순위를 찍어 본다.
 * 규칙을 손댈 때마다 이걸 돌려서 다른 패턴이 망가지지 않았는지 본다.
 *
 *   npm run verify
 *
 * EXPECTED는 회귀 기준선이다. 규칙을 고쳐서 여기가 깨지면, 고친 게 맞는지
 * 기준선이 틀렸는지를 먼저 판단하고 나서 둘 중 하나를 고칠 것.
 */
import { REVIEW_REASON_COPY } from '../src/config/model';
import { FAMILIES } from '../src/config/taxonomy';
import { classify } from '../src/domain/classify';
import { PATTERN_LABEL, PROCESSES } from '../src/domain/causes';
import { extractFeatures } from '../src/domain/features';
import { PATTERN_PRESETS } from '../src/domain/patterns';
import { buildPlan } from '../src/domain/plan';

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

let failures = 0;

/** 프리셋별로 기대하는 계통 / 1순위 클래스 */
const EXPECTED: Record<string, { family: string[]; top?: string[] }> = {
  normal: { family: ['NORMAL'], top: ['None'] },
  center: { family: ['RADIAL_INNER'], top: ['Center'] },
  donut: { family: ['RADIAL_INNER', 'RADIAL_OUTER'], top: ['Donut', 'Center', 'Edge-Ring'] },
  'edge-ring': { family: ['RADIAL_OUTER'], top: ['Edge-Ring'] },
  'edge-loc': { family: ['RADIAL_OUTER', 'LOCAL'], top: ['Edge-Loc', 'Loc'] },
  loc: { family: ['LOCAL'], top: ['Loc'] },
  scratch: { family: ['LOCAL'], top: ['Scratch', 'Loc'] },
  random: { family: ['SCATTER'], top: ['Random'] },
  'near-full': { family: ['GLOBAL'], top: ['Near-full'] },
};

for (const preset of PATTERN_PRESETS) {
  const map = preset.build(4242);
  const f = extractFeatures(map);
  const v = { ...classify(map, f), inferMs: 0 };
  const plan = buildPlan(v);

  const exp = EXPECTED[preset.id];
  const famOk = !exp || exp.family.includes(v.family);
  const topOk = !exp?.top || exp.top.includes(v.top);
  const ok = famOk && topOk;
  if (!ok) failures++;

  console.log(`\n${ok ? '  OK ' : 'FAIL '}${preset.label}  (${preset.id})`);
  console.log(
    `      계통  ${FAMILIES[v.family].label} ${pct(v.familyScores[0].probability)}` +
      `   (2위 ${FAMILIES[v.familyScores[1].id].short} ${pct(v.familyScores[1].probability)})`,
  );
  console.log(`      1순위 ${PATTERN_LABEL[v.top]} (${v.top}) ${pct(v.topScore)}`);
  if (!ok) {
    if (!famOk) console.log(`      기대 계통  ${exp!.family.join(' 또는 ')}`);
    if (!topOk) console.log(`      기대 1순위 ${exp!.top!.join(' 또는 ')}`);
  }
  console.log(
    `      상위3 ${v.patterns
      .slice(0, 3)
      .map((p) => `${p.id} ${pct(p.probability)}`)
      .join(' · ')}`,
  );
  console.log(
    `      피처  웨이퍼안 ${f.waferCellCount}칸 · 불량 ${f.defectCount}칸(${pct(f.defectRatio)})` +
      ` · 반경 ${f.radialCentroid.toFixed(2)} · 군집 ${f.clusterCount}개(최대 ${f.largestClusterSize})` +
      ` · 이방성 ${f.clusterAnisotropy.toFixed(2)} · 방위 ${f.largestClusterClock}시`,
  );
  console.log(
    `      분산  전체 ${f.defectAngularSpread.toFixed(2)} / 외곽 ${f.edgeAngularSpread.toFixed(2)}` +
      ` · 반경프로파일 ${f.radialProfile.map((x) => x.toFixed(1)).join('/')}`,
  );
  console.log(
    `      검토  ${
      v.review.required
        ? v.review.reasons.map((r) => REVIEW_REASON_COPY[r].label).join(', ')
        : '불필요'
    }`,
  );
  console.log(
    `      공정  ${
      plan.tabs.length
        ? plan.tabs.map((t) => `${t.rank}.${PROCESSES[t.process].short} ${pct(t.relevance)}`).join(' · ')
        : '(원인 매핑 없음)'
    }`,
  );
  const strong = plan.tabs.flatMap((t) => t.causes).filter((c) => c.support === 'strong');
  if (strong.length) console.log(`      지지  ${strong.map((c) => c.equipment).join(', ')}`);
}

console.log(`\n${failures === 0 ? '전부 통과' : `${failures}건 실패`}\n`);
process.exit(failures === 0 ? 0 : 1);
