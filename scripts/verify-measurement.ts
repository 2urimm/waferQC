/**
 * 측정 → 스펙 판정 경로 검증.
 *
 *   npm run verify:measure
 *
 * 확인하는 것:
 *   1) 양품으로 그린 지점의 측정값이 실제로 스펙 안에 드는가
 *   2) 불량으로 그린 지점의 측정값이 실제로 스펙 밖으로 나가는가
 *   3) 웨이퍼 밖 지점은 측정값이 없는가 (null)
 *   4) 스펙을 조이면 불량이 늘어나는가 — 스펙이 판정을 실제로 지배하는지
 */
import { DEFAULT_TIMING } from '../src/config/hardware';
import { CELL_DEFECT, CELL_NORMAL, CELL_OUTSIDE } from '../src/config/model';
import {
  METRICS,
  defaultSpec,
  formatSpec,
  formatValue,
  measurementSec,
  specSide,
  withinSpec,
  type MetricId,
  type SpecSetting,
} from '../src/domain/metrology';
import { buildPreset } from '../src/domain/patterns';
import { MockDeviceLink } from '../src/services/deviceLink';

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};

async function run(metricId: MetricId, presetId: string, spec?: SpecSetting) {
  // 기본 스펙일 때만 "그린 대로 판정되는가"를 강제한다.
  // 스펙을 바꾸면 판정이 달라지는 게 정상이고, 그게 이 기능의 요점이다.
  const strict = spec === undefined;
  const metric = METRICS[metricId];
  const s = spec ?? defaultSpec(metric);
  const truth = buildPreset(presetId, 4242);

  const link = new MockDeviceLink();
  await link.connect();
  const frame = await link.scan(truth, {
    timing: DEFAULT_TIMING,
    order: 'bank',
    circleMask: true,
    visualDurationMs: 0,
    noise: 0,
    metric,
    spec: s,
  });

  let goodIn = 0;
  let goodOut = 0;
  let badIn = 0;
  let badOut = 0;
  let outsideWithValue = 0;

  for (let i = 0; i < truth.length; i++) {
    const t = truth[i];
    const m = frame.measurements[i];

    if (t === CELL_OUTSIDE) {
      if (m !== null) outsideWithValue++;
      if (frame.cells[i] !== CELL_OUTSIDE) fail(`웨이퍼 밖 지점 ${i}이 셀 상태 ${frame.cells[i]}로 나왔다`);
      continue;
    }
    if (m === null) {
      fail(`웨이퍼 안 지점 ${i}에 측정값이 없다`);
      continue;
    }

    const inSpec = withinSpec(m, metric, s);
    if (t === CELL_NORMAL) inSpec ? goodIn++ : goodOut++;
    else inSpec ? badIn++ : badOut++;

    // 셀 상태는 반드시 스펙 판정과 일치해야 한다
    const expected = inSpec ? CELL_NORMAL : CELL_DEFECT;
    if (frame.cells[i] !== expected) fail(`지점 ${i}: 측정 ${formatValue(m, metric)}인데 셀 상태가 어긋났다`);
  }

  if (outsideWithValue) fail(`웨이퍼 밖인데 측정값이 있는 지점 ${outsideWithValue}개`);
  if (strict && goodOut) fail(`양품으로 그렸는데 스펙을 벗어난 지점 ${goodOut}개 (기본 스펙·노이즈 0인데 나오면 안 된다)`);
  if (strict && badIn) fail(`불량으로 그렸는데 스펙 안에 든 지점 ${badIn}개 (기본 스펙·노이즈 0인데 나오면 안 된다)`);

  const defects = frame.cells.filter((c) => c === CELL_DEFECT).length;
  const sample = frame.measurements
    .map((m, i) => ({ m, i }))
    .filter((x) => x.m !== null)
    .slice(0, 2)
    .map((x) => `${formatValue(x.m!, metric)}(${specSide(x.m!, metric, s)})`)
    .join(', ');

  console.log(
    `  OK  ${metric.label.padEnd(24)} ${presetId.padEnd(10)} 스펙 ${formatSpec(metric, s)}\n` +
      `      양품 ${goodIn}지점 스펙내 · 불량 ${badOut}지점 스펙밖 · 셀 불량 ${defects}칸 · 예시 ${sample}\n` +
      `      64지점 측정 ${(measurementSec(metric, 64) / 60).toFixed(1)}분`,
  );

  return defects;
}

(async () => {
  console.log('\n측정 → 스펙 판정 경로\n');

  await run('CD_ETCH', 'center');
  await run('THK', 'edge-ring');
  await run('CMP_THK_MAP', 'loc');
  await run('PARTICLE', 'random'); // 상한형 지표
  await run('RS', 'donut');

  // 스펙을 조이면 불량이 늘어야 한다 — 스펙이 판정을 실제로 지배하는지
  console.log('\n스펙 민감도 (THK, 같은 패턴에서 허용 편차만 조임)\n');
  const loose = await run('THK', 'center', { target: 3000, tolerancePct: 3 });
  const tight = await run('THK', 'center', { target: 3000, tolerancePct: 0.5 });
  if (tight < loose) fail(`스펙을 조였는데 불량이 줄었다 (${loose} → ${tight})`);
  else console.log(`\n  OK  허용 편차 3% → 0.5%로 조이니 불량 ${loose}칸 → ${tight}칸`);

  console.log(`\n${failures === 0 ? '전부 통과' : `${failures}건 실패`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
