import { useState } from 'react';
import { useStore } from './store';
import { AgentStatusPill } from './components/AgentStatusPill';
import { CommandCenter } from './components/CommandCenter';
import { ResearchEngine } from './components/ResearchEngine';
import { OpportunityExplorer } from './components/OpportunityExplorer';
import { DecisionCenter } from './components/DecisionCenter';
import { Experiments } from './components/Experiments';
import { MemoryView } from './components/MemoryView';
import { Wallet } from './components/Wallet';
import { ActivityLog } from './components/ActivityLog';
import { Reports } from './components/Reports';
import { Architecture } from './components/Architecture';
import { OpportunityDrawer } from './components/OpportunityDrawer';

export type View =
  | 'command'
  | 'research'
  | 'explorer'
  | 'decision'
  | 'experiments'
  | 'memory'
  | 'wallet'
  | 'activity'
  | 'reports'
  | 'architecture';

const NAV: { id: View; label: string; icon: string; section: string }[] = [
  { id: 'command', label: 'Command Center', icon: '▣', section: 'OVERVIEW' },
  { id: 'research', label: 'Research Engine', icon: '◎', section: 'OVERVIEW' },
  { id: 'explorer', label: 'Opportunity Explorer', icon: '▤', section: 'DISCOVERY' },
  { id: 'decision', label: 'Decision Center', icon: '➤', section: 'DISCOVERY' },
  { id: 'reports', label: 'Research Reports', icon: '▦', section: 'DISCOVERY' },
  { id: 'experiments', label: 'Experiments', icon: '▶', section: 'OPERATIONS' },
  { id: 'memory', label: 'Memory', icon: '◉', section: 'OPERATIONS' },
  { id: 'wallet', label: 'Simulated Wallet', icon: '◇', section: 'OPERATIONS' },
  { id: 'activity', label: 'Activity Log', icon: '☰', section: 'SYSTEM' },
  { id: 'architecture', label: 'Architecture & Safety', icon: '⬡', section: 'SYSTEM' },
];

const TITLES: Record<View, string> = {
  command: 'Command Center',
  research: 'AI Research Engine',
  explorer: 'Opportunity Explorer',
  decision: 'AI Decision Center',
  experiments: 'Experiment System',
  memory: 'Agent Memory',
  wallet: 'Simulated Wallet',
  activity: 'Activity Log',
  reports: 'Research Reports',
  architecture: 'Architecture & Safety',
};

export function App() {
  const [view, setView] = useState<View>('command');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const running = useStore((s) => s.loop.running);
  const busy = useStore((s) => s.loop.busy);
  const dead = useStore((s) => s.agent.status === 'DEAD');
  const startLoop = useStore((s) => s.startLoop);
  const pauseLoop = useStore((s) => s.pauseLoop);
  const runNextCycle = useStore((s) => s.runNextCycle);
  const resetSimulation = useStore((s) => s.resetSimulation);
  const opportunities = useStore((s) => s.opportunities);
  const experiments = useStore((s) => s.experiments);
  const events = useStore((s) => s.events);

  const drawerOpp = drawerId ? opportunities.find((o) => o.id === drawerId) ?? null : null;

  const openOpp = (id: string) => setDrawerId(id);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">
            <span className="tick">▮</span> SURVIVE AI
          </div>
          <div className="brand-sub">autonomous economic lab · v0.1</div>
        </div>
        <nav className="nav">
          {(['OVERVIEW', 'DISCOVERY', 'OPERATIONS', 'SYSTEM'] as const).map((section) => (
            <div key={section}>
              <div className="nav-section">{section}</div>
              {NAV.filter((n) => n.section === section).map((n) => (
                <button
                  key={n.id}
                  className={`nav-item ${view === n.id ? 'active' : ''}`}
                  onClick={() => setView(n.id)}
                >
                  <span className="icon">{n.icon}</span>
                  {n.label}
                  {n.id === 'explorer' && (
                    <span className="badge-count">{opportunities.filter((o) => o.researchStage !== 'UNDISCOVERED').length}</span>
                  )}
                  {n.id === 'experiments' && experiments.length > 0 && (
                    <span className="badge-count">{experiments.length}</span>
                  )}
                  {n.id === 'activity' && <span className="badge-count">{events.length}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sim-tag">● SIMULATION ENVIRONMENT</div>
          <div>No real money · No live APIs</div>
          <div>Data: SAMPLE seed + localStorage</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="view-title">
            <span className="crumb">SURVIVE-01</span>
            {TITLES[view]}
          </div>
          <div className="topbar-spacer" />
          <div className="controls">
            <AgentStatusPill />
            <button className="btn primary" onClick={startLoop} disabled={running || busy || dead} title="Run the autonomous loop continuously">
              {running ? '◉ RUNNING' : '▶ START RESEARCH'}
            </button>
            <button className="btn warn" onClick={pauseLoop} disabled={!running}>
              ❚❚ PAUSE AGENT
            </button>
            <button className="btn" onClick={runNextCycle} disabled={busy || dead} title="Run one complete research → simulate → learn cycle">
              ⏭ RUN NEXT CYCLE
            </button>
            {confirmReset ? (
              <>
                <button
                  className="btn danger"
                  onClick={() => {
                    resetSimulation();
                    setConfirmReset(false);
                    setView('command');
                  }}
                >
                  CONFIRM RESET
                </button>
                <button className="btn" onClick={() => setConfirmReset(false)}>
                  CANCEL
                </button>
              </>
            ) : (
              <button className="btn danger" onClick={() => setConfirmReset(true)} title="Wipe state and start a fresh $50 simulation">
                ↺ RESET
              </button>
            )}
          </div>
        </header>

        <main className="content">
          {view === 'command' && <CommandCenter go={setView} />}
          {view === 'research' && <ResearchEngine onOpenOpp={openOpp} />}
          {view === 'explorer' && <OpportunityExplorer />}
          {view === 'decision' && <DecisionCenter />}
          {view === 'experiments' && <Experiments />}
          {view === 'memory' && <MemoryView />}
          {view === 'wallet' && <Wallet />}
          {view === 'activity' && <ActivityLog />}
          {view === 'reports' && <Reports />}
          {view === 'architecture' && <Architecture />}
        </main>
      </div>

      {drawerOpp && <OpportunityDrawer opp={drawerOpp} onClose={() => setDrawerId(null)} />}
    </div>
  );
}
