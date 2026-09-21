import { useState } from 'react';
import { useStore, backendConfigured } from './store';
import { AgentStatusPill } from './components/AgentStatusPill';
import { CommandCenter } from './components/CommandCenter';
import { ResearchEngine } from './components/ResearchEngine';
import { OpportunityExplorer } from './components/OpportunityExplorer';
import { Prospects } from './components/Prospects';
import { Projects } from './components/Projects';
import { Analytics } from './components/Analytics';
import { EconomicEfficiency } from './components/EconomicEfficiency';
import { DecisionCenter } from './components/DecisionCenter';
import { Experiments } from './components/Experiments';
import { MemoryView } from './components/MemoryView';
import { Wallet } from './components/Wallet';
import { Treasury } from './components/Treasury';
import { ActivityLog } from './components/ActivityLog';
import { Reports } from './components/Reports';
import { Architecture } from './components/Architecture';
import { OpportunityDrawer } from './components/OpportunityDrawer';

export type View =
  | 'command'
  | 'research'
  | 'explorer'
  | 'prospects'
  | 'projects'
  | 'analytics'
  | 'economics'
  | 'decision'
  | 'experiments'
  | 'memory'
  | 'wallet'
  | 'activity'
  | 'reports'
  | 'architecture';

const NAV: { id: View; label: string; icon: string; section: string }[] = [
  { id: 'command', label: 'Command Center', icon: '▣', section: 'HOME' },
  { id: 'research', label: 'Research Engine', icon: '◎', section: 'DISCOVER' },
  { id: 'explorer', label: 'Opportunities', icon: '▤', section: 'DISCOVER' },
  { id: 'prospects', label: 'Prospects', icon: '☎', section: 'REVENUE' },
  { id: 'projects', label: 'Delivery', icon: '🛠', section: 'REVENUE' },
  { id: 'decision', label: 'Decisions', icon: '➤', section: 'INTELLIGENCE' },
  { id: 'reports', label: 'Reports', icon: '▦', section: 'INTELLIGENCE' },
  { id: 'memory', label: 'Memory', icon: '◉', section: 'INTELLIGENCE' },
  { id: 'experiments', label: 'Experiments', icon: '▶', section: 'INTELLIGENCE' },
  { id: 'analytics', label: 'Performance', icon: '📊', section: 'ANALYTICS' },
  { id: 'economics', label: 'Economic Efficiency', icon: '⚖', section: 'ANALYTICS' },
  { id: 'wallet', label: 'Simulated Wallet', icon: '◇', section: 'ANALYTICS' },
  { id: 'treasury', label: 'Treasury', icon: '₿', section: 'ANALYTICS' },
  { id: 'activity', label: 'Activity Log', icon: '☰', section: 'SYSTEM' },
  { id: 'architecture', label: 'Architecture & Safety', icon: '⬡', section: 'SYSTEM' },
];

const TITLES: Record<View, string> = {
  command: 'Command Center',
  research: 'AI Research Engine',
  explorer: 'Opportunity Explorer',
  prospects: 'Prospects / CRM',
  projects: 'Delivery Projects',
  analytics: 'Simulation vs. Reality Analytics',
  economics: 'Economic Efficiency — Search Cost, Revenue Funnel, Next Money Action',
  decision: 'AI Decision Center',
  experiments: 'Experiment System',
  memory: 'Agent Memory',
  wallet: 'Simulated Wallet',
  treasury: 'Survivor Treasury',
  activity: 'Activity Log',
  reports: 'Research Reports',
  architecture: 'Architecture & Safety',
};

export function App() {
  const [view, setView] = useState<View>('command');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

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
  const prospects = useStore((s) => s.prospects);
  const projects = useStore((s) => s.projects);
  const backend = useStore((s) => s.backend);

  const drawerOpp = drawerId ? opportunities.find((o) => o.id === drawerId) ?? null : null;

  const openOpp = (id: string) => setDrawerId(id);

  return (
    <div className="app">
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-name">
            <span className="tick">▮</span> SURVIVE AI
          </div>
          <div className="brand-sub">economic intelligence & action center</div>
          <button className="sidebar-close" onClick={() => setNavOpen(false)} aria-label="Close menu">
            ✕
          </button>
        </div>
        <nav className="nav">
          {(['HOME', 'DISCOVER', 'REVENUE', 'INTELLIGENCE', 'ANALYTICS', 'SYSTEM'] as const).map((section) => (
            <div key={section}>
              <div className="nav-section">{section}</div>
              {NAV.filter((n) => n.section === section).map((n) => (
                <button
                  key={n.id}
                  className={`nav-item ${view === n.id ? 'active' : ''}`}
                  onClick={() => {
                    setView(n.id);
                    setNavOpen(false);
                  }}
                >
                  <span className="icon">{n.icon}</span>
                  {n.label}
                  {n.id === 'explorer' && (
                    <span className="badge-count">{opportunities.filter((o) => o.researchStage !== 'UNDISCOVERED').length}</span>
                  )}
                  {n.id === 'prospects' && prospects.length > 0 && (
                    <span className="badge-count">{prospects.length}</span>
                  )}
                  {n.id === 'projects' && projects.filter((p) => p.status === 'ACTIVE').length > 0 && (
                    <span className="badge-count">{projects.filter((p) => p.status === 'ACTIVE').length}</span>
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
          <div>No real money · No live trading/payments</div>
          {backendConfigured ? (
            <div>
              Data: LIVE backend
              {backend.connected ? ' — connected' : backend.error ? ' — unreachable' : ' — connecting…'}
            </div>
          ) : (
            <div>Data: LIVE backend required — no sample data</div>
          )}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-toggle" onClick={() => setNavOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <div className="view-title">
            <span className="crumb">SURVIVE-01</span>
            {TITLES[view]}
          </div>
          <div className="topbar-spacer" />
          <div className="controls">
            <AgentStatusPill />
            {backendConfigured ? (
              <span
                className="badge-count"
                title="The autonomous loop runs on the Cloudflare Worker's cron (every 30 minutes) — this dashboard only observes it."
              >
                {backend.connected ? '● LIVE — cron-driven' : backend.error ? '○ backend unreachable' : '◌ connecting…'}
              </span>
            ) : (
              <>
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
              </>
            )}
          </div>
        </header>

        <main className="content">
          {backendConfigured && !backend.connected && (
            <div className={`banner ${backend.error ? 'banner-error' : 'banner-info'}`}>
              {backend.error
                ? `Backend unreachable: ${backend.error}. Showing the last data this dashboard received (or nothing, on first load) — nothing here is invented to fill the gap.`
                : 'Connecting to the live backend…'}
            </div>
          )}
          {view === 'command' && <CommandCenter go={setView} />}
          {view === 'research' && <ResearchEngine onOpenOpp={openOpp} />}
          {view === 'explorer' && <OpportunityExplorer />}
          {view === 'prospects' && <Prospects />}
          {view === 'projects' && <Projects />}
          {view === 'analytics' && <Analytics />}
          {view === 'economics' && <EconomicEfficiency />}
          {view === 'decision' && <DecisionCenter />}
          {view === 'experiments' && <Experiments />}
          {view === 'memory' && <MemoryView />}
          {view === 'wallet' && <Wallet />}
          {view === 'treasury' && <Treasury />}
          {view === 'activity' && <ActivityLog />}
          {view === 'reports' && <Reports />}
          {view === 'architecture' && <Architecture />}
        </main>
      </div>

      {drawerOpp && <OpportunityDrawer opp={drawerOpp} onClose={() => setDrawerId(null)} />}
    </div>
  );
}
