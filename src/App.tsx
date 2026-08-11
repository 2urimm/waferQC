import { Dashboard } from './pages/Dashboard';
import { DeviceLab } from './pages/DeviceLab';
import { History } from './pages/History';
import { Inspect } from './pages/Inspect';
import { Badge } from './components/ui';
import { ROLE_META } from './services/security';
import { AppProvider, useApp, type TabId } from './state/AppStore';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'inspect', label: '검사' },
  { id: 'dashboard', label: '대시보드' },
  { id: 'history', label: '이력' },
  { id: 'device', label: '장비 · 권한' },
];

function Shell() {
  const { state, setTab } = useApp();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <strong>waferQC</strong>
          <span>저해상도 웨이퍼 결함 스크리닝 · 공정 원인 추적</span>
        </div>

        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="tab"
              aria-current={state.tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
          <Badge color={state.linkState === 'connected' ? '--good' : undefined}>
            {state.linkState === 'connected' ? `연결됨 · ${state.linkKind === 'mock' ? '가상' : '보드'}` : '장치 미연결'}
          </Badge>
          <Badge strong title={ROLE_META[state.user.role].description}>
            {state.user.name} · {ROLE_META[state.user.role].label}
          </Badge>
        </div>
      </header>

      <main className="main">
        {state.tab === 'inspect' && <Inspect />}
        {state.tab === 'dashboard' && <Dashboard />}
        {state.tab === 'history' && <History />}
        {state.tab === 'device' && <DeviceLab />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
