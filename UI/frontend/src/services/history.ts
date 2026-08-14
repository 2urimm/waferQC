import type { DefectPatternId } from '../domain/causes';
import { classify } from '../domain/classify';
import { extractFeatures } from '../domain/features';
import { buildPreset } from '../domain/patterns';
import type { Inspection } from '../domain/types';
import { DEFECT_CASES } from './historySeed.generated';

/* ────────────────────────────────────────────────────────────────────────────
 * 검사 이력 저장소.
 * 지금은 브라우저 localStorage. 실제로는 MES/DB에 붙어야 하는 자리라
 * 함수 시그니처를 전부 Promise로 잡아 뒀다 — 나중에 fetch로 바꿔도 호출부가 안 바뀐다.
 *
 * 시드는 `불량 대응 log.xlsx`의 315건을 그대로 쓴다. 로트 번호·발생일자·담당팀·조치 결과가
 * 전부 실제 대장의 값이고, 지어낸 건 8×8 맵뿐이다 — 대장에는 웨이퍼맵이 없어서 기록된
 * 결함유형(Bin)에 해당하는 프리셋을 결정적으로 생성해 채운다.
 *
 * 이렇게 해야 이력 탭이 실제로 쓸모 있어진다. 같은 관리번호가 2~5회 반복되는 재발 이력이
 * 들어오므로 "이 원인이 지난 12개월 몇 번 터졌나"를 화면에서 직접 셀 수 있다.
 * ──────────────────────────────────────────────────────────────────────────── */

const KEY = 'waferqc.history.v2';

/** 대장의 결함유형(Bin) → 프리셋 id */
const PRESET_OF: Record<DefectPatternId, string> = {
  Center: 'center',
  Donut: 'donut',
  'Edge-Ring': 'edge-ring',
  'Edge-Loc': 'edge-loc',
  Loc: 'loc',
  Scratch: 'scratch',
  Random: 'random',
  'Near-full': 'near-full',
  None: 'normal',
};

function readRaw(): Inspection[] {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return [];
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as Inspection[]) : [];
  } catch {
    return [];
  }
}

function writeRaw(items: Inspection[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // 용량 초과 등은 프로토타입 범위에서 무시. 실제 저장소로 바뀌면 여기서 에러 처리.
  }
}

export async function loadHistory(): Promise<Inspection[]> {
  const items = readRaw();
  if (items.length) return items.sort((a, b) => b.capturedAt - a.capturedAt);
  const seeded = buildSeed();
  writeRaw(seeded);
  return seeded;
}

export async function saveInspection(item: Inspection): Promise<Inspection[]> {
  const items = [item, ...readRaw()].slice(0, 400);
  writeRaw(items);
  return items.sort((a, b) => b.capturedAt - a.capturedAt);
}

export async function updateInspection(id: string, patch: Partial<Inspection>): Promise<Inspection[]> {
  const items = readRaw().map((i) => (i.id === id ? { ...i, ...patch } : i));
  writeRaw(items);
  return items.sort((a, b) => b.capturedAt - a.capturedAt);
}

export async function resetHistory(): Promise<Inspection[]> {
  const seeded = buildSeed();
  writeRaw(seeded);
  return seeded;
}

/** '1 Lot(25매) 중 7매' / '1 Lot(25매) 전량' → 대표 웨이퍼 번호 */
function waferNoOf(affected: string, n: number): number {
  const m = /중 (\d+)매/.exec(affected);
  const count = m ? Number(m[1]) : 25;
  return 1 + (n % Math.max(1, count));
}

/**
 * 대응 Log 315건을 검사 이력으로 편다.
 *
 * 결정적으로 만든다 — 대시보드가 새로고침마다 흔들리면 읽을 수가 없다.
 * 대장의 조치 결과를 `resolution`에 그대로 넣고 해당 원인의 해결 항목을 완료 표시한다.
 * 종결/모니터링 판정은 여기서 안 한다 — 대장의 `상태` 열은 기준이 서 있지 않아서
 * domain/caseStatus.ts가 관찰기간 규칙으로 다시 판정한다.
 */
function buildSeed(): Inspection[] {
  return DEFECT_CASES.map((c, n) => {
    const presetId = PRESET_OF[c.pattern] ?? 'normal';
    const map = buildPreset(presetId, 1000 + n * 37);
    const features = extractFeatures(map);
    const verdict = classify(map, features);
    // 대장에는 날짜만 있고 시각이 없다. 같은 날 여러 건이 겹치므로 순번으로 흩뿌린다.
    const capturedAt = new Date(`${c.date}T09:00:00`).getTime() + (n % 8) * 2_400_000;

    return {
      id: `case-${c.caseId}-${c.lotId}`,
      caseId: c.caseId,
      causeId: c.causeId,
      lotId: c.lotId,
      waferNo: waferNoOf(c.affected, n),
      capturedAt,
      map,
      verdict: { ...verdict, inferMs: 0.4 + ((n % 7) * 0.05) },
      elapsedMs: 14.1,
      source: 'mock' as const,
      // 대장에 조치 결과가 항상 적혀 있으므로 그대로 결론으로 옮긴다.
      // 종결 여부는 여기서 정하지 않는다 — domain/caseStatus.ts가 관찰기간으로 판정한다.
      checkedActions: c.causeId ? [`${c.causeId}#0`] : [],
      resolution: c.outcome,
    };
  }).sort((a, b) => b.capturedAt - a.capturedAt);
}
