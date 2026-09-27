import { useEffect, useState } from 'react';
import { useStore, backendConfigured } from './store';
import { AgentStatusPill } from './components/AgentStatusPill';
import { CommandCenter } from './components/CommandCenter';
import { ResearchEngine } from './components/ResearchEngine';
import { OpportunityExplorer } from './components/OpportunityExplorer';
import { Prospects } from './components/Prospects';
import { Projects } from './components/Projects';
import { Analytics } from './components/Analytics';
import { EconomicEfficiency } from './components/EconomicEfficiency';
import { OutcomeIntelligence } from './components/OutcomeIntelligence';
import { IncomeHub } from './components/IncomeHub';
import { ContentHub } from './components/ContentHub';
import { DecisionCenter } from './components/DecisionCenter';
import { Experiments } from './components/Experiments';
import { MemoryView } from './components/MemoryView';
import { Wallet } from './components/Wallet';
import { Treasury } from './components/Treasury';
import { ActivityLog } from './components/ActivityLog';
import { Reports } from './components/Reports';
import { Architecture } from './components/Architecture';
import { OpportunityDrawer } from './components/OpportunityDrawer';
import { Clients, UnlockForm } from './components/Clients';
import { setOperatorSecretPrompt } from './services/backendApi';

export type View =
  | 'clients'
  | 'command'
  | 'research'
  | 'explorer'
  | 'prospects'
  | 'projects'
  | 'analytics'
  | 'economics'
  | 'outcomes'
  | 'income'
  | 'content'
  | 'decision'
  | 'experiments'
  | 'memory'
  | 'wallet'
  | 'treasury'
  | 'activity'
  | 'reports'
  | 'architecture';

const NAV: { id: View; label: string; icon: string; section: string }[] = [
  { id: 'clients', label: 'Get Clients', icon: '☎', section: 'CLIENTS' },
  { id: 'prospects', label: 'All leads (CRM)', icon: '▤', section: 'CLIENTS' },
  { id: 'projects', label: 'Delivery', icon: '🛠', section: 'CLIENTS' },
  { id: 'income', label: 'Income Hub', icon: '💰', section: 'CLIENTS' },
  { id: 'command', label: 'Command Center', icon: '▣', section: 'SURVIVOR' },
  { id: 'treasury', label: 'Treasury ($50)', icon: '₿', section: 'SURVIVOR' },
  { id: 'decision', label: 'Decisions', icon: '➤', section: 'SURVIVOR' },
  { id: 'activity', label: 'Activity Log', icon: '☰', section: 'SURVIVOR' },
  { id: 'research', label: 'Research Engine', icon: '◎', section: 'LAB' },
  { id: 'explorer', label: 'Opportunities', icon: '◇', section: 'LAB' },
  { id: 'content', label: 'Content Engine', icon: '●', section: 'LAB' },
  { id: 'reports', label: 'Reports', icon: '▦', section: 'LAB' },
  { id: 'memory', label: 'Memory', icon: '◉', section: 'LAB' },
  { id: 'experiments', label: 'Experiments (simulated)', icon: '▶', section: 'LAB' },
  { id: 'analytics', label: 'Performance', icon: '📊', section: 'LAB' },
  { id: 'economics', label: 'Economic Efficiency', icon: '⚖', section: 'LAB' },
  { id: 'outcomes', label: 'Outcome Intelligence', icon: '◈', section: 'LAB' },
  { id: 'wallet', label: 'Simulated Wallet', icon: '◌', section: 'LAB' },
  { id: 'architecture', label: 'Architecture & Safety', icon: '⬡', section: 'LAB' },
];

const NAV_SECTIONS = ['CLIENTS', 'SURVIVOR', 'LAB'] as const;

/** The app's own unlock dialog, used whenever a button needs the operator
 *  session (replaces the easily-dismissed browser prompt). */
function UnlockDialog() {
  const [pending, setPending] = useState<null | ((v: string | null) => void)>(null);
  useEffect(() => {
    setOperatorSecretPrompt(
      () =>
        new Promise<string | null>((resolve) => {
          setPending(() => resolve);
        }),
    );
    return () => setOperatorSecretPrompt(null);
  }, []);
  if (!pending) return null;
  const close = () => {
    pending(null);
    setPending(null);
  };
  return (
    <div className="unlock-backdrop" role="dialog" aria-modal="true" aria-labelledby="unlock-title" onClick={close}>
      <div className="unlock-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 id="unlock-title">Unlock Survivor</h2>
        <p className="muted small">This button changes real data. Enter your operator secret once — this phone stays unlocked for 8 hours.</p>
        <UnlockForm
          compact
          onDone={() => {
            // Already logged in by the form; hand back a non-empty value so the
            // waiting request continues without asking again.
            pending('__session__');
            setPending(null);
          }}
        />
        <button className="link-btn" onClick={close}>Cancel</button>
      </div>
    </div>
  );
}

const TITLES: Record<View, string> = {
  clients: 'Get Clients',
  command: 'Command Center',
  research: 'AI Research Engine',
  explorer: 'Opportunity Explorer',
  prospects: 'Prospects / CRM',
  projects: 'Delivery Projects',
  analytics: 'Simulation vs. Reality Analytics',
  economics: 'Economic Efficiency — Search Cost, Revenue Funnel, Next Money Action',
  outcomes: 'Outcome Intelligence — What Actually Produces Replies & Revenue',
  income: 'Income Hub — Multi-Channel Revenue & Money Actions',
  content: 'Content Income Engine — Research, Create, Measure, Monetize',
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
  const [view, setView] = useState<View>('clients');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const running = useStore((s) => s.loop.running);
  const busy = useStore((s) => s.loop.busy);
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
  const actionError = useStore((s) => s.actionError);
  const actionSuccess = useStore((s) => s.actionSuccess);

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
          {NAV_SECTIONS.map((section) => (
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
          <div className="sim-tag live">● SURVIVOR FINDS · YOU SEND &amp; CLOSE</div>
          <div>Never messages anyone or spends without you</div>
          {backendConfigured ? (
            <div>
              Live backend
              {backend.connected ? ' — connected' : backend.error ? ' — unreachable' : ' — connecting…'}
            </div>
          ) : (
            <div>Live backend required — no sample data</div>
          )}
        </div>
      </aside>

      <div className="main">
        {(actionError || actionSuccess) && (
          <div
            role="status"
            aria-live="polite"
            style={{
              margin: '10px 14px 0',
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: actionError ? 'rgba(220, 38, 38, 0.10)' : 'rgba(34, 197, 94, 0.10)',
              color: actionError ? 'var(--red)' : 'var(--green)',
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            <strong>{actionError ? 'Action failed' : 'Action completed'}</strong>
            <span style={{ marginLeft: 8 }}>{actionError ?? actionSuccess}</span>
          </div>
        )}
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
                className="badge-count live-badge"
                title="The autonomous loop runs on the Cloudflare Worker's cron (every 30 minutes) — this dashboard only observes it."
              >
                {backend.connected ? '● LIVE' : backend.error ? '○ offline' : '◌ …'}
              </span>
            ) : (
              <>
                <button className="btn primary" onClick={startLoop} disabled={running || busy} title="Run the autonomous loop continuously">
                  {running ? '◉ RUNNING' : '▶ START RESEARCH'}
                </button>
                <button className="btn warn" onClick={pauseLoop} disabled={!running}>
                  ❚❚ PAUSE AGENT
                </button>
                <button className="btn" onClick={runNextCycle} disabled={busy} title="Run one complete research → simulate → learn cycle">
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
          {view === 'clients' && <Clients go={setView} />}
          {view === 'command' && <CommandCenter go={setView} />}
          {view === 'research' && <ResearchEngine onOpenOpp={openOpp} />}
          {view === 'explorer' && <OpportunityExplorer onOpenProspects={() => setView('prospects')} />}
          {view === 'prospects' && <Prospects />}
          {view === 'projects' && <Projects />}
          {view === 'analytics' && <Analytics />}
          {view === 'economics' && <EconomicEfficiency />}
          {view === 'outcomes' && <OutcomeIntelligence />}
          {view === 'income' && <IncomeHub />}
          {view === 'content' && <ContentHub />}
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

      <UnlockDialog />
      {drawerOpp && <OpportunityDrawer opp={drawerOpp} onClose={() => setDrawerId(null)} onOpenProspects={() => { setDrawerId(null); setView('prospects'); }} />}
    </div>
  );
}
