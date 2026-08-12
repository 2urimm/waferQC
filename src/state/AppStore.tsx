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
import { CELL_COUNT, DEFAULT_TIMING, type ScanOrder, type TimingBudget } from '../config/hardware';
import { METRICS, defaultSpec, primaryMetricOf, type MetricId, type SpecSetting } from '../domain/metrology';
import type { ProcessId } from '../domain/causes';
import type { CellState } from '../config/model';
import { blankWafer, buildPreset } from '../domain/patterns';
import type { Inspection, ScanFrame, ScanProgress, Verdict, WaferMap } from '../domain/types';
import { createDeviceLink, type DeviceLink, type LinkState } from '../services/deviceLink';
import {
  DEFAULT_MODEL_SERVER,
  HttpInferenceEngine,
  RuleInferenceEngine,
  getInferenceEngine,
  probeModelServer,
  setInferenceEngine,
} from '../services/inference';
import { loadHistory, resetHistory, saveInspection, updateInspection } from '../services/history';
import { DEMO_USERS, readAudit, recordAudit, type AuditEvent, type AuditAction, type Classification, type User } from '../services/security';

export type TabId = 'inspect' | 'dashboard' | 'history' | 'device';

interface State {
  tab: TabId;

  linkKind: 'mock' | 'serial';
  linkState: LinkState;
  linkError: string | null;

  timing: TimingBudget;
  scanOrder: ScanOrder;
  circleMask: boolean;
  /** 어느 공정의 웨이퍼 맵인가 — 공정마다 재는 지표가 다르다 */
  process: ProcessId;
  /** 그 공정에서 무엇을 재는가 */
  metricId: MetricId;
  /** 양/불을 가르는 스펙 */
  spec: SpecSetting;
  noise: number;
  visualDurationMs: number;

  /** 사용자가 그리는 패턴 = "웨이퍼에 실제로 있는 것" */
  draft: WaferMap;

  progress: ScanProgress;
  frame: ScanFrame | null;
  verdict: Verdict | null;

  lotId: string;
  waferNo: number;

  history: Inspection[];
  historyLoaded: boolean;
  selectedInspectionId: string | null;

  user: User;
  auditLog: AuditEvent[];

  /** 'rule' = 규칙 대체판, 'model' = 실제 WaferCNNV2 서버 */
  engineKind: 'rule' | 'model';
  modelServerUrl: string;
  modelServerStatus: 'unknown' | 'checking' | 'up' | 'down';
  modelServerDetail: string;
}

const idleProgress: ScanProgress = { phase: 'idle', read: 0, total: CELL_COUNT, message: '대기' };

const initialState: State = {
  tab: 'inspect',
  linkKind: 'mock',
  linkState: 'disconnected',
  linkError: null,
  timing: DEFAULT_TIMING,
  scanOrder: 'bank',
  // 원형 마스크는 이제 선택이 아니다 — 모델 입력의 0(웨이퍼 밖)이 곧 이 형상이다.
  circleMask: true,
  process: 'DEPOSITION',
  metricId: 'THK',
  spec: defaultSpec(METRICS.THK),
  noise: 0.05,
  visualDurationMs: 2200,
  draft: blankWafer(),
  progress: idleProgress,
  frame: null,
  verdict: null,
  lotId: 'L26C-0119',
  waferNo: 7,
  history: [],
  historyLoaded: false,
  selectedInspectionId: null,
  user: DEMO_USERS[0],
  auditLog: [],
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
  | { type: 'progress'; progress: ScanProgress }
  | { type: 'scanDone'; frame: ScanFrame; verdict: Verdict; inspectionId: string }
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
      return { ...state, draft: action.map, frame: null, verdict: null, progress: idleProgress };
    case 'clearDraft':
      return { ...state, draft: blankWafer(), frame: null, verdict: null, progress: idleProgress };
    case 'progress':
      return { ...state, progress: action.progress };
    case 'scanDone':
      return {
        ...state,
        frame: action.frame,
        verdict: action.verdict,
        progress: { ...state.progress, phase: 'done', message: '판정 완료' },
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
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  runScan: () => Promise<void>;
  cancelScan: () => void;
  toggleAction: (inspectionId: string, actionId: string) => Promise<void>;
  setResolution: (inspectionId: string, text: string) => Promise<void>;
  reseedHistory: () => Promise<void>;
  scanning: boolean;
  setUser: (user: User) => void;
  logAudit: (action: AuditAction, target: string, classification?: Classification) => void;
  /** 공정을 바꾸면 그 공정의 주 진단지표와 기본 스펙으로 같이 옮겨간다 */
  setProcess: (process: ProcessId) => void;
  setMetric: (metricId: MetricId) => void;
  /** 실제 모델 서버로 전환 (서버가 살아 있을 때만 성공) */
  useModelEngine: (url: string) => Promise<void>;
  useRuleEngine: () => void;
}

const Ctx = createContext<Store | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const linkRef = useRef<DeviceLink | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    loadHistory().then((items) => dispatch({ type: 'history', items }));
    dispatch({ type: 'patch', patch: { auditLog: readAudit() } });
  }, []);

  const patch = useCallback((p: Partial<State>) => dispatch({ type: 'patch', patch: p }), []);
  const setTab = useCallback((tab: TabId) => dispatch({ type: 'setTab', tab }), []);
  const setCell = useCallback((index: number, value: CellState) => dispatch({ type: 'setCell', index, value }), []);
  const clearDraft = useCallback(() => dispatch({ type: 'clearDraft' }), []);
  const applyPreset = useCallback(
    (presetId: string) => dispatch({ type: 'setDraft', map: buildPreset(presetId) }),
    [],
  );

  const connect = useCallback(async () => {
    const link = createDeviceLink(state.linkKind);
    linkRef.current = link;
    patch({ linkState: 'connecting', linkError: null });
    try {
      await link.connect();
      patch({ linkState: link.state });
    } catch (e) {
      linkRef.current = null;
      patch({ linkState: 'error', linkError: e instanceof Error ? e.message : String(e) });
    }
  }, [state.linkKind, patch]);

  const disconnect = useCallback(async () => {
    await linkRef.current?.disconnect();
    linkRef.current = null;
    patch({ linkState: 'disconnected', linkError: null });
  }, [patch]);

  const cancelScan = useCallback(() => abortRef.current?.abort(), []);

  // 공정을 고르면 그 공정의 주 진단지표가 기본값이 된다. 공정마다 무엇을 재는지가
  // 정해져 있으므로, 사용자가 지표를 매번 다시 고르게 하면 안 된다.
  const setProcess = useCallback(
    (process: ProcessId) => {
      const m = primaryMetricOf(process);
      patch(m ? { process, metricId: m.id, spec: defaultSpec(m), frame: null, verdict: null } : { process });
    },
    [patch],
  );

  // 실제 모델 서버로 갈아탄다. 살아 있는지 먼저 확인하고 바꾼다 —
  // 죽은 서버로 바꿔 놓으면 스캔할 때마다 실패하고 원인을 찾기 어렵다.
  const useModelEngine = useCallback(
    async (url: string) => {
      patch({ modelServerStatus: 'checking', modelServerUrl: url, linkError: null });
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

  const setMetric = useCallback(
    (metricId: MetricId) => patch({ metricId, spec: defaultSpec(METRICS[metricId]), frame: null, verdict: null }),
    [patch],
  );

  const runScan = useCallback(async () => {
    const link = linkRef.current;
    if (!link || link.state !== 'connected') {
      patch({ linkError: '먼저 장치를 연결하세요.' });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    patch({ linkError: null, frame: null, verdict: null });

    try {
      const frame = await link.scan(state.draft, {
        timing: state.timing,
        order: state.scanOrder,
        circleMask: state.circleMask,
        visualDurationMs: state.visualDurationMs,
        noise: state.noise,
        metric: METRICS[state.metricId],
        spec: state.spec,
        signal: controller.signal,
        onProgress: (p) => dispatch({ type: 'progress', progress: p }),
      });

      dispatch({
        type: 'progress',
        progress: { phase: 'infer', read: frame.cells.length, total: frame.cells.length, message: '모델 추론' },
      });

      const verdict = await getInferenceEngine().predict(frame.cells);

      const inspection: Inspection = {
        id: `insp-${Date.now().toString(36)}`,
        lotId: state.lotId,
        waferNo: state.waferNo,
        capturedAt: frame.capturedAt,
        map: frame.cells,
        measurements: frame.measurements,
        metricId: frame.metricId,
        spec: frame.spec,
        verdict,
        elapsedMs: frame.elapsedMs,
        source: frame.source,
        checkedActions: [],
      };

      const items = await saveInspection(inspection);
      dispatch({ type: 'scanDone', frame, verdict, inspectionId: inspection.id });
      dispatch({ type: 'history', items });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        dispatch({ type: 'progress', progress: { ...idleProgress, message: '취소됨' } });
        return;
      }
      dispatch({ type: 'progress', progress: { ...idleProgress, phase: 'error', message: '스캔 실패' } });
      patch({ linkError: e instanceof Error ? e.message : String(e) });
    } finally {
      abortRef.current = null;
    }
  }, [state, patch]);

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

  const logAudit = useCallback(
    (action: AuditAction, target: string, classification?: Classification) => {
      const next = recordAudit({
        userId: state.user.id,
        userName: state.user.name,
        role: state.user.role,
        action,
        target,
        classification,
      });
      dispatch({ type: 'patch', patch: { auditLog: next } });
    },
    [state.user],
  );

  const setUser = useCallback(
    (user: User) => {
      const next = recordAudit({
        userId: user.id,
        userName: user.name,
        role: user.role,
        action: 'role-switch',
        target: `${state.user.name} → ${user.name}`,
      });
      dispatch({ type: 'patch', patch: { user, auditLog: next } });
    },
    [state.user],
  );

  const scanning = state.progress.phase !== 'idle' && !['done', 'error'].includes(state.progress.phase);

  const value = useMemo<Store>(
    () => ({
      state,
      setTab,
      patch,
      setCell,
      applyPreset,
      clearDraft,
      connect,
      disconnect,
      runScan,
      cancelScan,
      toggleAction,
      setResolution,
      reseedHistory,
      scanning,
      setUser,
      logAudit,
      setProcess,
      setMetric,
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
      connect,
      disconnect,
      runScan,
      cancelScan,
      toggleAction,
      setResolution,
      reseedHistory,
      scanning,
      setUser,
      logAudit,
      setProcess,
      setMetric,
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
