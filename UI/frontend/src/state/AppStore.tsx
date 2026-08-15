import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
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
  /** 그린 맵을 판정 엔진에 넣고 결과를 이력에 남긴다 */
  runInspection: () => Promise<void>;
  toggleAction: (inspectionId: string, actionId: string) => Promise<void>;
  setResolution: (inspectionId: string, text: string) => Promise<void>;
  reseedHistory: () => Promise<void>;
  /** 실제 모델 서버로 전환 (서버가 살아 있을 때만 성공) */
  useModelEngine: (url: string) => Promise<void>;
  useRuleEngine: () => void;
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

  const runInspection = useCallback(async () => {
    patch({ running: true, error: null, verdict: null });
    try {
      const map = state.draft;
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
      };

      const items = await saveInspection(inspection);
      dispatch({ type: 'done', verdict, inspectionId: inspection.id });
      dispatch({ type: 'history', items });
    } catch (e) {
      patch({ running: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, [state.draft, state.lotId, state.waferNo, patch]);

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
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
