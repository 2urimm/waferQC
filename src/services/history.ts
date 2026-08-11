import { classify } from '../domain/classify';
import { extractFeatures } from '../domain/features';
import { buildPreset } from '../domain/patterns';
import type { Inspection } from '../domain/types';

/* ────────────────────────────────────────────────────────────────────────────
 * 검사 이력 저장소.
 * 지금은 브라우저 localStorage. 실제로는 MES/DB에 붙어야 하는 자리라
 * 함수 시그니처를 전부 Promise로 잡아 뒀다 — 나중에 fetch로 바꿔도 호출부가 안 바뀐다.
 * ──────────────────────────────────────────────────────────────────────────── */

const KEY = 'waferqc.history.v1';

/** 시드 데이터가 부팅될 때 쓰는 로트 목록 */
const SEED_LOTS = ['L26A-0412', 'L26A-0418', 'L26B-0031', 'L26B-0044', 'L26C-0107', 'L26C-0119'];

/** 시드용 패턴 배분 — 현실적으로 정상이 대부분이고 이상이 섞인다 */
const SEED_MIX = [
  'normal', 'normal', 'normal', 'normal', 'normal', 'normal',
  'edge-ring', 'edge-ring', 'edge-loc',
  'center', 'donut',
  'loc', 'scratch',
  'random', 'random',
  'near-full',
];

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

/**
 * 최근 14일치 시드 이력.
 * 결정적으로 만든다 — 대시보드가 새로고침마다 흔들리면 읽을 수가 없다.
 */
function buildSeed(): Inspection[] {
  const out: Inspection[] = [];
  const now = Date.now();
  const DAY = 86_400_000;

  let n = 0;
  for (let day = 13; day >= 0; day--) {
    const perDay = 3 + ((day * 7) % 3); // 3~5건
    for (let k = 0; k < perDay; k++) {
      const presetId = SEED_MIX[(n * 5 + day * 3) % SEED_MIX.length];
      const seed = 1000 + n * 37;
      const map = buildPreset(presetId, seed);
      const features = extractFeatures(map);
      const verdict = classify(map, features);
      const capturedAt = now - day * DAY + k * 2_400_000;

      out.push({
        id: `seed-${n}`,
        lotId: SEED_LOTS[(n + day) % SEED_LOTS.length],
        waferNo: 1 + (n % 25),
        capturedAt,
        map,
        verdict: { ...verdict, inferMs: 0.4 + ((n % 7) * 0.05) },
        elapsedMs: 14.1,
        source: 'mock',
        checkedActions: [],
      });
      n++;
    }
  }

  return out.sort((a, b) => b.capturedAt - a.capturedAt);
}
