import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import type { CellState } from '../config/model';
import { blankWafer, buildPreset } from '../domain/patterns';
import type { Inspection, Verdict, WaferMap } from '../domain/types';
import {
  DEFAULT_MODEL_SERVER,
  HttpInferenceEngine,
  RuleInferenceEngine,
  getInferenceEngine,
  probeModelServer,
  setInferenceEngine,
} from '../services/inference';
import { probeBridge, readFrame, reconnectBridge, writeMap, type BridgeHealth } from '../services/deviceBridge';
import { loadHistory, resetHistory, saveInspection, updateInspection } from '../services/history';

export type TabId = 'inspect' | 'history';

interface State {
  tab: TabId;

  /** 사용자가 그리는 패턴 = 이 웨이퍼의 결함 맵 */
  draft: WaferMap;

  /** 판정 진행 중인가 */
  running: boolean;
  error: string | null;
  verdict: Verdict | null;

  lotId: string;
  waferNo: number;

  history: Inspection[];
  historyLoaded: boolean;
  selectedInspectionId: string | null;

  /** 'rule' = 규칙 대체판, 'model' = 실제 WaferCNNV2 서버 */
  engineKind: 'rule' | 'model';
  modelServerUrl: string;
  modelServerStatus: 'unknown' | 'checking' | 'up' | 'down';
  modelServerDetail: string;

  /* ── 아두이노 (backend/serial_bridge.py) ── */
  /** 브리지 프로세스 자체가 떠 있는가 */
  bridgeStatus: 'unknown' | 'checking' | 'up' | 'down';
  bridgeDetail: string;
  /** 브리지가 보고한 양쪽 포트 상태 */
  hw: BridgeHealth | null;
  /**
   * 읽기 아두이노가 마지막으로 올린 맵.
   * **판정에 들어가는 건 이것뿐이다** — 화면에서 그린 맵은 쓰기 아두이노로 내보내는
   * 출력이지 판정 입력이 아니다. 실제로 스캔된 값만 모델에 넣는다.
   */
  hwMap: WaferMap | null;
  hwSeq: number;
  hwAt: number | null;
  /** 그린 맵을 바꿀 때마다 쓰기 아두이노로 자동 송출할지 */
  autoWrite: boolean;
  /** 마지막 송출이 실패했을 때의 사유 */
  writeError: string | null;
}

const initialState: State = {
  tab: 'inspect',
  draft: blankWafer(),
  running: false,
  error: null,
  verdict: null,
  lotId: 'L26C-0119',
  waferNo: 7,
  history: [],
  historyLoaded: false,
  selectedInspectionId: null,
  engineKind: 'rule',
  modelServerUrl: DEFAULT_MODEL_SERVER,
  modelServerStatus: 'unknown',
  modelServerDetail: '',
  bridgeStatus: 'unknown',
  bridgeDetail: '',
  hw: null,
  hwMap: null,
  hwSeq: -1,
  hwAt: null,
  autoWrite: true,
  writeError: null,
};

type Action =
  | { type: 'setTab'; tab: TabId }
  | { type: 'patch'; patch: Partial<State> }
  | { type: 'setCell'; index: number; value: CellState }
  | { type: 'setDraft'; map: WaferMap }
  | { type: 'clearDraft' }
  | { type: 'done'; verdict: Verdict; inspectionId: string }
  | { type: 'history'; items: Inspection[] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setTab':
      return { ...state, tab: action.tab };
    case 'patch':
      return { ...state, ...action.patch };
    case 'setCell': {
      const draft = state.draft.slice();
      draft[action.index] = action.value;
      return { ...state, draft };
    }
    case 'setDraft':
      return { ...state, draft: action.map, verdict: null };
    case 'clearDraft':
      return { ...state, draft: blankWafer(), verdict: null };
    case 'done':
      return {
        ...state,
        running: false,
        verdict: action.verdict,
        selectedInspectionId: action.inspectionId,
        waferNo: state.waferNo + 1,
      };
    case 'history':
      return { ...state, history: action.items, historyLoaded: true };
    default:
      return state;
  }
}

interface Store {
  state: State;
  setTab: (tab: TabId) => void;
  patch: (patch: Partial<State>) => void;
  setCell: (index: number, value: CellState) => void;
  applyPreset: (presetId: string) => void;
  clearDraft: () => void;
  /**
   * 맵을 판정 엔진에 넣고 결과를 이력에 남긴다.
   *
   * 기본은 'hardware' — 읽기 아두이노가 스캔해 올린 맵이다.
   * 'draw' 는 하드웨어가 없을 때 쓰는 **명시적** 우회로다. 자동으로 여기로 떨어지는 일은
   * 없다. 사용자가 그렇게 적힌 버튼을 직접 눌러야 하고, 기록에도 'draw' 로 남는다 —
   * 하드웨어를 거친 판정과 섞이면 안 되기 때문이다.
   */
  runInspection: (source?: 'hardware' | 'draw') => Promise<void>;
  toggleAction: (inspectionId: string, actionId: string) => Promise<void>;
  setResolution: (inspectionId: string, text: string) => Promise<void>;
  reseedHistory: () => Promise<void>;
  /** 실제 모델 서버로 전환 (서버가 살아 있을 때만 성공) */
  useModelEngine: (url: string) => Promise<void>;
  useRuleEngine: () => void;
  /** 지금 그려진 맵을 쓰기 아두이노로 즉시 내보낸다 */
  pushToHardware: () => Promise<void>;
  /** 브리지에 포트 재탐지를 시킨다 (시리얼 모니터를 닫은 뒤 등) */
  reconnectHardware: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    loadHistory().then((items) => dispatch({ type: 'history', items }));

    // 모델 서버가 떠 있으면 알아서 붙는다. 안 떠 있으면 규칙 대체판 그대로 두고
    // 검사 탭에 띄우는 법을 안내한다 — 매번 버튼을 누르게 할 이유가 없다.
    dispatch({ type: 'patch', patch: { modelServerStatus: 'checking' } });
    probeModelServer(DEFAULT_MODEL_SERVER).then((probe) => {
      if (!probe.ok) {
        dispatch({ type: 'patch', patch: { modelServerStatus: 'down', modelServerDetail: probe.detail } });
        return;
      }
      setInferenceEngine(new HttpInferenceEngine(DEFAULT_MODEL_SERVER));
      dispatch({
        type: 'patch',
        patch: { engineKind: 'model', modelServerStatus: 'up', modelServerDetail: probe.detail },
      });
    });
  }, []);

  const patch = useCallback((p: Partial<State>) => dispatch({ type: 'patch', patch: p }), []);

  /* ── 아두이노 ──────────────────────────────────────────────────────────────
   *
   * 브리지가 안 떠 있어도 화면은 그대로 돌아간다 — 하드웨어는 입출력을 실물로 옮기는
   * 경로일 뿐이고, 판정 경로는 하드웨어 없이도 완결이다. 그래서 여기서 실패해도
   * 배너 한 줄로 알리고 끝낸다.
   * ────────────────────────────────────────────────────────────────────────── */

  // 읽기 폴링용. seq 를 ref 로도 들고 있는 이유는 폴링 루프가 최신 state 를 못 보기 때문이다.
  const hwSeqRef = useRef(-1);
  // 쓰기 단일 비행(single-flight). 드래그로 칸을 칠하는 동안 요청이 쌓이면
  // 아두이노가 스캔에 100ms 씩 쓰느라 밀린다 — 마지막 것만 보낸다.
  const writeRef = useRef<{ busy: boolean; pending: WaferMap | null }>({ busy: false, pending: null });

  const flushWrite = useCallback(async () => {
    if (writeRef.current.busy) return;
    const map = writeRef.current.pending;
    if (!map) return;
    writeRef.current.pending = null;
    writeRef.current.busy = true;
    const res = await writeMap(map);
    writeRef.current.busy = false;
    dispatch({ type: 'patch', patch: { writeError: res.ok ? null : (res.error ?? '송출 실패') } });
    if (writeRef.current.pending) void flushWrite();
  }, []);

  const queueWrite = useCallback(
    (map: WaferMap) => {
      writeRef.current.pending = map;
      void flushWrite();
    },
    [flushWrite],
  );

  // 브리지 상태 확인 + 읽기 아두이노 폴링.
  // 읽기 아두이노는 값이 바뀔 때만 D: 를 올리므로 폴링이 잦아도 대부분 빈 응답이다.
  useEffect(() => {
    let alive = true;

    const refreshHealth = async () => {
      const h = await probeBridge();
      if (!alive) return;
      if ('ok' in h && h.ok === false) {
        dispatch({ type: 'patch', patch: { bridgeStatus: 'down', bridgeDetail: h.detail, hw: null } });
        return;
      }
      dispatch({ type: 'patch', patch: { bridgeStatus: 'up', bridgeDetail: '', hw: h as BridgeHealth } });
    };

    const poll = async () => {
      const f = await readFrame(hwSeqRef.current);
      if (!alive || !f) return;
      if (f.changed && f.cells) {
        hwSeqRef.current = f.seq;
        dispatch({
          type: 'patch',
          patch: { hwMap: f.cells as WaferMap, hwSeq: f.seq, hwAt: f.at },
        });
      }
    };

    dispatch({ type: 'patch', patch: { bridgeStatus: 'checking' } });
    void refreshHealth();

    const healthTimer = setInterval(refreshHealth, 4000);
    const readTimer = setInterval(poll, 500);
    return () => {
      alive = false;
      clearInterval(healthTimer);
      clearInterval(readTimer);
    };
  }, []);

  // 그린 맵이 바뀌면 쓰기 아두이노로 내보낸다.
  // 화면의 칸을 누르는 것과 실물 LED 가 켜지는 것이 같은 동작이어야 하므로 자동이 기본이다.
  useEffect(() => {
    if (!state.autoWrite) return;
    if (state.bridgeStatus !== 'up' || !state.hw?.write.connected) return;
    queueWrite(state.draft);
  }, [state.draft, state.autoWrite, state.bridgeStatus, state.hw?.write.connected, queueWrite]);
  const setTab = useCallback((tab: TabId) => dispatch({ type: 'setTab', tab }), []);
  const setCell = useCallback((index: number, value: CellState) => dispatch({ type: 'setCell', index, value }), []);
  const clearDraft = useCallback(() => dispatch({ type: 'clearDraft' }), []);
  const applyPreset = useCallback(
    (presetId: string) => dispatch({ type: 'setDraft', map: buildPreset(presetId) }),
    [],
  );

  // 실제 모델 서버로 갈아탄다. 살아 있는지 먼저 확인하고 바꾼다 —
  // 죽은 서버로 바꿔 놓으면 판정할 때마다 실패하고 원인을 찾기 어렵다.
  const useModelEngine = useCallback(
    async (url: string) => {
      patch({ modelServerStatus: 'checking', modelServerUrl: url, error: null });
      const probe = await probeModelServer(url);
      if (!probe.ok) {
        patch({ modelServerStatus: 'down', modelServerDetail: probe.detail });
        return;
      }
      setInferenceEngine(new HttpInferenceEngine(url));
      patch({ engineKind: 'model', modelServerStatus: 'up', modelServerDetail: probe.detail });
    },
    [patch],
  );

  const useRuleEngine = useCallback(() => {
    setInferenceEngine(new RuleInferenceEngine());
    patch({ engineKind: 'rule' });
  }, [patch]);

  const pushToHardware = useCallback(async () => {
    patch({ writeError: null });
    const res = await writeMap(state.draft);
    if (!res.ok) patch({ writeError: res.error ?? '송출 실패' });
  }, [state.draft, patch]);

  const reconnectHardware = useCallback(async () => {
    patch({ bridgeStatus: 'checking', writeError: null });
    const h = await reconnectBridge();
    if ('ok' in h && h.ok === false) {
      patch({ bridgeStatus: 'down', bridgeDetail: h.detail, hw: null });
      return;
    }
    patch({ bridgeStatus: 'up', bridgeDetail: '', hw: h as BridgeHealth });
  }, [patch]);

  const runInspection = useCallback(
    async (source: 'hardware' | 'draw' = 'hardware') => {
    patch({ running: true, error: null, verdict: null });
    try {
      // 하드웨어 판정이 기본이다. 그린 맵으로 **조용히** 떨어지는 경로는 없다 —
      // 하드웨어를 거쳤다고 표시된 결과가 실은 화면에서 나온 것이면 그 사실이 어디에도
      // 안 남는다. 우회로를 쓰려면 호출부가 'draw' 를 명시해야 하고, 기록에도 그렇게 남는다.
      const map = source === 'hardware' ? state.hwMap : state.draft;
      if (!map) {
        patch({
          running: false,
          error:
            '읽기 보드가 아직 맵을 올리지 않았습니다. 하드웨어 연결 카드에서 "재연결"로 보드를 다시 ' +
            '읽으세요. 하드웨어 없이 확인만 하려면 "하드웨어 없이 이 패턴으로 판정"을 쓰세요.',
        });
        return;
      }
      const startedAt = performance.now();
      const verdict = await getInferenceEngine().predict(map);

      const inspection: Inspection = {
        id: `insp-${Date.now().toString(36)}`,
        lotId: state.lotId,
        waferNo: state.waferNo,
        capturedAt: Date.now(),
        map,
        verdict,
        elapsedMs: performance.now() - startedAt,
        checkedActions: [],
        mapSource: source,
      };

      const items = await saveInspection(inspection);
      dispatch({ type: 'done', verdict, inspectionId: inspection.id });
      dispatch({ type: 'history', items });
    } catch (e) {
      patch({ running: false, error: e instanceof Error ? e.message : String(e) });
    }
    },
    [state.hwMap, state.draft, state.lotId, state.waferNo, patch],
  );

  const toggleAction = useCallback(async (inspectionId: string, actionId: string) => {
    const items = await loadHistory();
    const target = items.find((i) => i.id === inspectionId);
    if (!target) return;
    const checked = target.checkedActions.includes(actionId)
      ? target.checkedActions.filter((a) => a !== actionId)
      : [...target.checkedActions, actionId];
    const next = await updateInspection(inspectionId, { checkedActions: checked });
    dispatch({ type: 'history', items: next });
  }, []);

  const setResolution = useCallback(async (inspectionId: string, text: string) => {
    const next = await updateInspection(inspectionId, { resolution: text });
    dispatch({ type: 'history', items: next });
  }, []);

  const reseedHistory = useCallback(async () => {
    const items = await resetHistory();
    dispatch({ type: 'history', items });
  }, []);

  const value = useMemo<Store>(
    () => ({
      state,
      setTab,
      patch,
      setCell,
      applyPreset,
      clearDraft,
      runInspection,
      toggleAction,
      setResolution,
      reseedHistory,
      useModelEngine,
      useRuleEngine,
      pushToHardware,
      reconnectHardware,
    }),
    [
      state,
      setTab,
      patch,
      setCell,
      applyPreset,
      clearDraft,
      runInspection,
      toggleAction,
      setResolution,
      reseedHistory,
      useModelEngine,
      useRuleEngine,
      pushToHardware,
      reconnectHardware,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
