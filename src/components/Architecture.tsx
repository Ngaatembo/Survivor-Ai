import { getConnectors } from '../services/connectors';
import { browserConnections, useStore } from '../store';
import { Panel, Badge } from './ui';
import { computeDataQualityIssues, type DataQualitySeverity } from '../lib/dataQuality';

const TABLES: { name: string; purpose: string; relations: string }[] = [
  { name: 'agents', purpose: 'Agent identity, status, capital, threshold, strategy pointer', relations: '1 → many cycles, strategies' },
  { name: 'opportunities', purpose: 'Discovered money-making models + full research attributes', relations: 'many → 1 categories; many → many sources' },
  { name: 'research_sources', purpose: 'Sources per opportunity with evidence kind/URL/verification state', relations: 'many → many opportunities' },
  { name: 'research_reports', purpose: 'Structured generated reports (rule engine now, LLM later)', relations: 'many → 1 opportunities, agents' },
  { name: 'experiments', purpose: 'Experiment plan: objective, budget, action, expected outcome', relations: 'many → 1 opportunities, agents, cycles' },
  { name: 'experiment_results', purpose: 'Measured outcome: cost, revenue, ROI, lessons, evidence', relations: '1 → 1 experiments' },
  { name: 'agent_memory', purpose: 'Opportunity/category/lesson memory that biases future decisions', relations: 'many → 1 agents; nullable opp/category refs' },
  { name: 'transactions', purpose: 'Append-only ledger; balance is derived, never stored', relations: 'many → 1 agents; nullable experiments' },
  { name: 'agent_events', purpose: 'Immutable activity feed (cycle, decision, wallet, warnings)', relations: 'many → 1 agents' },
  { name: 'strategies', purpose: 'Strategy history with active flag and rationale', relations: 'many → 1 agents' },
  { name: 'agent_cycles', purpose: 'Autonomous loop runs with per-step status and timings', relations: 'many → 1 agents; has many experiments' },
];

const SAFETY = [
  'No real trades, bank accounts, wallets, payment or financial APIs are connected.',
  'All capital, revenue and expenses are simulated ledger entries.',
  'Finance categories (forex, crypto, prediction markets) are research-only: blocked from autonomous execution.',
  'Every experiment is capped at ≤18% of simulated balance and cannot spend below survival floor.',
  'At $0 balance the agent becomes DEAD: read-only, no new budgets or experiments.',
  'Future real-money mode is designed behind explicit per-action authorization, hard spending limits, approval gates and full audit logs.',
];

const SEVERITY_TONE: Record<DataQualitySeverity, 'red' | 'amber' | 'blue'> = {
  HIGH: 'red',
  MEDIUM: 'amber',
  LOW: 'blue',
};

export function Architecture() {
  const connectors = getConnectors(browserConnections);
  const prospects = useStore((s) => s.prospects);
  const offers = useStore((s) => s.offers);
  const projects = useStore((s) => s.projects);
  const realRevenue = useStore((s) => s.realRevenue);
  const issues = computeDataQualityIssues({ prospects, offers, projects, realRevenue });
  return (
    <div className="view-enter">
      <div className="grid cols-2" style={{ marginBottom: 14, gridTemplateColumns: '1fr 1fr' }}>
        <Panel title="Service connectors (API layer)">
          {connectors.map((c) => (
            <div className="connector-row" key={c.id}>
              <span className={`dot ${c.connected ? 'green' : 'gray'}`} />
              <div style={{ flex: 1 }}>
                <div className="connector-name">
                  {c.name}
                  {c.safetyGated && <span className="badge red" style={{ marginLeft: 8 }}>SAFETY GATED</span>}
                </div>
                <div className="connector-purpose">{c.purpose}</div>
                <div className="connector-fallback">current fallback: {c.currentFallback}</div>
              </div>
              <Badge tone={c.connected ? 'green' : 'gray'}>
                {c.connected ? 'CONNECTED' : 'NOT CONNECTED'}
              </Badge>
            </div>
          ))}
        </Panel>

        <Panel title="Safety & financial controls">
          <ul className="lesson-list">
            {SAFETY.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <div className="faint small mono" style={{ marginTop: 12, lineHeight: 1.7 }}>
            Architecture principle: capabilities are hidden behind service interfaces
            (services/research.ts, ai.ts, wallet.ts…). Attaching a real API means implementing the
            same interface and flipping the connector flag — no UI or decision-logic changes.
          </div>
        </Panel>
      </div>

      <Panel
        title="Database architecture — prepared for Supabase (Postgres)"
        right={<span className="faint small mono">DDL: /supabase/schema.sql · current runtime: localStorage adapter</span>}
      >
        <table className="data">
          <thead>
            <tr>
              <th>Table</th>
              <th>Purpose</th>
              <th>Key relationships</th>
            </tr>
          </thead>
          <tbody>
            {TABLES.map((t) => (
              <tr key={t.name}>
                <td className="mono" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{t.name}</td>
                <td className="small muted">{t.purpose}</td>
                <td className="small faint mono">{t.relations}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="faint small" style={{ marginTop: 12, lineHeight: 1.7 }}>
          Normalized design — no catch-all table. Money lives only in <span className="mono">transactions</span>;
          experiment results are immutable in <span className="mono">experiment_results</span>;
          reasoning traces land in <span className="mono">agent_events</span> and <span className="mono">agent_memory</span>.
          Row-Level Security policies and an audit trail are specified in the schema file.
        </div>
      </Panel>

      <Panel
        title="Data quality"
        right={<span className="faint small mono">{issues.length} issue(s) found</span>}
        style={{ marginTop: 14 }}
      >
        {issues.length === 0 ? (
          <div className="empty">No data quality issues found in the current dataset.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {issues.map((issue) => (
              <div key={issue.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
                <div>
                  <div className="small" style={{ fontWeight: 600 }}>{issue.category}</div>
                  <div className="small muted">{issue.message}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="faint small mono" style={{ marginTop: 12, lineHeight: 1.7 }}>
          Computed live from the current dashboard data — orphaned records, duplicate prospects, and
          known-risky sources (e.g. a prospect discovered from a Facebook group, where the group's name
          isn't a business and posted content may belong to an unrelated member).
        </div>
      </Panel>
    </div>
  );
}
