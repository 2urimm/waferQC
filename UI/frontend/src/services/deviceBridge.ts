import { CELL_COUNT } from '../config/hardware';
import type { WaferMap } from '../domain/types';

/* ────────────────────────────────────────────────────────────────────────────
 * 아두이노 2대와의 연결 지점.
 *
 * 브라우저는 COM 포트를 직접 못 연다. backend/serial_bridge.py 가 그 자리를 맡고,
 * 이 파일은 그 브리지의 HTTP 계약만 감싼다. 펌웨어와 주고받는 문자열(D:/R:)은
 * 전부 브리지 안에서 끝나고, 여기로는 0/1/2 맵만 올라온다.
 *
 *   쓰기(출력) 아두이노 — 화면에 그린 패턴을 595 래치 + NeoPixel 로 내보낸다
 *   읽기(입력) 아두이노 — 그 보드를 4067로 스캔해 다시 올려 보낸다
 *
 * 두 대는 서로 반대 방향이라 한쪽만 붙어 있어도 그쪽 기능은 그대로 쓴다.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface LinkStatus {
  port: string | null;
  connected: boolean;
  error: string;
  ageMs: number | null;
}

export interface BridgeHealth {
  ok: true;
  invertRead: boolean;
  detectNote: string;
  ports: string[];
  read: LinkStatus & { frames: number };
  write: LinkStatus;
  seq: number;
  cells: number[] | null;
  sentBits: string;
  ack: string;
}

export interface ReadFrame {
  seq: number;
  changed: boolean;
  cells: number[] | null;
  at: number | null;
  connected: boolean;
}

/**
 * 브리지 주소.
 *
 * 모델 서버와 같은 이유로 분기한다 — 남이 터널 주소로 보고 있으면 그쪽의 127.0.0.1 에는
 * 브리지가 없다. 개발 서버의 /hw 프록시(vite.config.ts)를 타면 터널 하나로 같이 동작한다.
 */
function isLocalView(): boolean {
  if (typeof window === 'undefined') return true;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
}

export const DEFAULT_BRIDGE = isLocalView() ? 'http://127.0.0.1:8078' : '/hw';

/** 브리지 자체가 떠 있는지 + 양쪽 포트 상태 */
export async function probeBridge(baseUrl = DEFAULT_BRIDGE): Promise<BridgeHealth | { ok: false; detail: string }> {
  try {
    const res = await fetch(`${baseUrl}/health`);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return (await res.json()) as BridgeHealth;
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 읽기 아두이노가 올린 최신 맵.
 * `since` 에 지난 seq 를 주면 안 바뀌었을 때 cells 를 안 실어 보낸다 — 폴링 비용을 줄인다.
 */
export async function readFrame(since: number, baseUrl = DEFAULT_BRIDGE): Promise<ReadFrame | null> {
  try {
    const res = await fetch(`${baseUrl}/read?since=${since}`);
    if (!res.ok) return null;
    return (await res.json()) as ReadFrame;
  } catch {
    return null;
  }
}

/** 화면에 그린 맵을 쓰기 아두이노로 내보낸다 */
export async function writeMap(
  map: WaferMap,
  baseUrl = DEFAULT_BRIDGE,
): Promise<{ ok: boolean; error?: string; ack?: string }> {
  try {
    const res = await fetch(`${baseUrl}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cells: map }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; ack?: string };
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, ack: data.ack };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 포트 재탐지 — 시리얼 모니터를 닫은 뒤 등, 화면에서 다시 찾게 할 때 */
export async function reconnectBridge(baseUrl = DEFAULT_BRIDGE): Promise<BridgeHealth | { ok: false; detail: string }> {
  try {
    const res = await fetch(`${baseUrl}/reconnect`, { method: 'POST' });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return (await res.json()) as BridgeHealth;
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 보낸 맵과 되읽은 맵이 다른 칸 수.
 *
 * 0이면 왕복이 온전하다는 뜻이고, 0이 아니면 어디선가 비트가 샜다는 뜻이다.
 * 이 수치를 화면에 그대로 띄우는 이유는, 어긋나도 에러가 안 나기 때문이다 —
 * 맵이 조용히 뒤섞인 채로 판정까지 흘러가는 게 이 파이프라인에서 제일 위험하다.
 */
export function mismatchCount(sent: WaferMap, read: number[] | null): number | null {
  if (!read || read.length !== CELL_COUNT) return null;
  let n = 0;
  for (let i = 0; i < CELL_COUNT; i++) if (sent[i] !== read[i]) n++;
  return n;
}
