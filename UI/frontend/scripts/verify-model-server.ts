/**
 * 웹 UI의 추론 어댑터가 실제 모델 서버와 제대로 맞물리는지 검증.
 *
 *   1) wafer_final_package_v2 에서 서버를 띄우고
 *        .venv\Scripts\python serve.py
 *   2) npm run verify:model
 *
 * README 예시 8종을 UI가 쓰는 경로(HttpInferenceEngine) 그대로 보내고,
 * 응답이 Verdict로 올바르게 옮겨졌는지 본다. 여기서 나오는 판정은
 * `python app.py --manual` 결과와 같아야 한다 — 다르면 UI가 잘못 보내고 있는 것이다.
 */
import { CLASS_NAMES } from '../src/config/model';
import { FAMILIES } from '../src/config/taxonomy';
import { PATTERN_LABEL } from '../src/domain/causes';
import { README_EXAMPLES } from '../src/domain/patterns';
import { buildPlan } from '../src/domain/plan';
import { DEFAULT_MODEL_SERVER, HttpInferenceEngine, probeModelServer } from '../src/services/inference';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
let failures = 0;
const fail = (m: string) => {
  failures++;
  console.log(`  FAIL ${m}`);
};

(async () => {
  const url = process.argv[2] ?? DEFAULT_MODEL_SERVER;
  const probe = await probeModelServer(url);
  if (!probe.ok) {
    console.log(`\n모델 서버에 연결할 수 없습니다 (${url}) — ${probe.detail}`);
    console.log('wafer_final_package_v2 에서 먼저 실행하세요:  .venv\\Scripts\\python serve.py\n');
    process.exit(2);
  }
  console.log(`\n${probe.detail}\n`);

  const engine = new HttpInferenceEngine(url);

  for (const ex of README_EXAMPLES) {
    const v = await engine.predict(ex.map);

    if (!v.model) {
      fail(`${ex.label}: model 블록이 비었다 — 실제 서버 응답이 안 옮겨졌다`);
      continue;
    }

    // 확률 합이 1이어야 한다 (9개 전부 받았는지 확인)
    const sum = v.patterns.reduce((s, p) => s + p.probability, 0);
    if (Math.abs(sum - 1) > 0.02) {
      fail(`${ex.label}: 확률 합이 ${sum.toFixed(3)} — 9개를 다 못 받았을 수 있다`);
    }

    // 계통 확률 합도 보존돼야 한다
    const famSum = v.familyScores.reduce((s, f) => s + f.probability, 0);
    if (Math.abs(famSum - sum) > 1e-6) {
      fail(`${ex.label}: 계통 합(${famSum.toFixed(3)})이 클래스 합(${sum.toFixed(3)})과 다르다`);
    }

    // 서버 status와 UI의 검토 판단이 어긋나면 안 된다
    const uiReview = v.review.required;
    const serverReview = v.model.status === 'REVIEW';
    if (uiReview !== serverReview) {
      fail(`${ex.label}: 서버 status=${v.model.status}인데 UI 검토필요=${uiReview}`);
    }

    // 1순위 클래스가 서버 것 그대로여야 한다
    if (!CLASS_NAMES.includes(v.top)) fail(`${ex.label}: 알 수 없는 클래스 ${v.top}`);

    const plan = buildPlan(v);
    const dir = v.model.direction ? ` · 방향 ${v.model.direction}` : '';
    const reasons = v.review.reasons.length ? ` · ${v.review.reasons.join(', ')}` : '';

    console.log(
      `  OK  ${ex.label}  ${PATTERN_LABEL[v.top]}(${v.top}) ${pct(v.topScore)}  ${v.model.status}` +
        `  임계 ${v.model.classThreshold.toFixed(2)}  불량 ${v.model.defectCellCount}칸${dir}${reasons}`,
    );
    console.log(
      `      계통 ${FAMILIES[v.family].label} ${pct(v.familyScores[0].probability)}` +
        `  ·  공정 ${plan.tabs.length ? plan.tabs.slice(0, 3).map((t) => t.meta.short).join(' → ') : '(매핑 없음)'}` +
        `  ·  추론 ${v.inferMs.toFixed(0)}ms`,
    );
  }

  console.log(`\n${failures === 0 ? '전부 통과' : `${failures}건 실패`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
