import { History } from './pages/History';
import { Inspect } from './pages/Inspect';
import { Report } from './pages/Report';
import { Badge } from './components/ui';
import { AppProvider, useApp, type TabId } from './state/AppStore';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'inspect', label: '검사' },
  { id: 'history', label: '이력' },
  { id: 'report', label: '보고서' },
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
          <Badge color={state.engineKind === 'model' ? '--good' : '--warning'} strong>
            {state.engineKind === 'model' ? '실제 모델' : '규칙 대체판'}
          </Badge>
        </div>
      </header>

      <main className="main">
        {state.tab === 'inspect' && <Inspect />}
        {state.tab === 'history' && <History />}
        {state.tab === 'report' && <Report />}
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
