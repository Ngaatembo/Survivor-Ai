import { useStore } from '../store';
import { Panel, Badge, EvidenceBadge, RecommendationBadge } from './ui';
import { LoopPipeline } from './LoopPipeline';
import { getConnectors } from '../services/connectors';
import { browserConnections, backendConfigured } from '../store';
import { capRange, dayRange, timeAgo } from '../lib/format';
import type { Opportunity } from '../types';

const STAGES: { key: Opportunity['researchStage']; label: string }[] = [
  { key: 'UNDISCOVERED', label: 'Undiscovered' },
  { key: 'DISCOVERED', label: 'Discovered' },
  { key: 'RESEARCHED', label: 'Researched' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'SCORED', label: 'Scored' },
  { key: 'RANKED', label: 'Ranked' },
];

const STAGE_ORDER: Record<Opportunity['researchStage'], number> = {
  UNDISCOVERED: 0,
  DISCOVERED: 1,
  RESEARCHED: 2,
  VERIFIED: 3,
  SCORED: 4,
  RANKED: 5,
};

export function ResearchEngine({ onOpenOpp }: { onOpenOpp: (id: string) => void }) {
  const opportunities = useStore((s) => s.opportunities);
  const busy = useStore((s) => s.loop.busy);
  const runNextCycle = useStore((s) => s.runNextCycle);

  const active = opportunities
    .filter((o) => o.researchStage !== 'UNDISCOVERED')
    .sort((a, b) => STAGE_ORDER[b.researchStage] - STAGE_ORDER[a.researchStage] || (b.score?.total ?? 0) - (a.score?.total ?? 0));
  const undiscovered = opportunities.filter((o) => o.researchStage === 'UNDISCOVERED').length;

  const stageCounts = STAGES.map((s) => ({
    ...s,
    count: opportunities.filter((o) => o.researchStage === s.key).length,
  }));

  return (
    <div className="view-enter">
      <div className="info-banner">
        <strong>Research process:</strong> DISCOVER → RESEARCH → VERIFY → ANALYZE → SCORE → RANK → RECOMMEND.
        Every claim carries an evidence tier. Production mode uses live backend research when the configured
        search provider is available; it never promotes legacy SAMPLE data to live fact.
      </div>

      <Panel title="Live pipeline — current cycle" style={{ marginBottom: 14 }}>
        <LoopPipeline />
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          {backendConfigured ? (
            <span className="faint small">Live mode: research cycles are run by the backend scheduler; this dashboard observes the results.</span>
          ) : (
            <button className="btn primary" disabled={busy} onClick={runNextCycle}>
              ▶ Advance research cycle
            </button>
          )}
          {!backendConfigured && (
            <span className="faint small">or use START RESEARCH in the top bar for continuous autonomous looping.</span>
          )}
        </div>
      </Panel>

      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        {stageCounts.map((s) => (
          <Panel tight key={s.key}>
            <div className="stat">
              <div className="stat-label">{s.label}</div>
              <div className="stat-value small">{s.count}</div>
            </div>
          </Panel>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.7fr 1fr', alignItems: 'start' }}>
        <Panel
          title="Research workspace"
          right={<span className="faint small mono">{active.length} active · {undiscovered} awaiting discovery</span>}
        >
          {active.length === 0 ? (
            <div className="empty">Run a research cycle to discover opportunities.</div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Opportunity</th>
                  <th>Score</th>
                  <th>Evidence</th>
                  <th>Capital</th>
                  <th>Researched</th>
                </tr>
              </thead>
              <tbody>
                {active.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => onOpenOpp(o.id)}>
                    <td>
                      <span className={`stage-badge ${o.researchStage === 'RANKED' || o.researchStage === 'SCORED' ? 'lit' : ''}`}>
                        {o.researchStage}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                        {o.name}
                        {o.executionBlocked && <Badge tone="purple">RESEARCH ONLY</Badge>}
                      </div>
                      <div className="faint small mono">{o.category}</div>
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>{o.score ? o.score.total : '—'}</td>
                    <td><EvidenceBadge tier={o.evidenceTier} /></td>
                    <td className="num small">{capRange(o.capitalRequiredMin, o.capitalRequiredMax)}</td>
                    <td className="faint small mono">{o.dateResearched ? timeAgo(o.dateResearched) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <div>
          <Panel title="Evidence framework" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {(['VERIFIED', 'LIKELY', 'UNCERTAIN', 'UNVERIFIED'] as const).map((tier) => (
                <div key={tier} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <EvidenceBadge tier={tier} />
                  <span className="small muted" style={{ lineHeight: 1.5 }}>
                    {tier === 'VERIFIED' && 'Model and payouts corroborated by verifiable platform/regulator data.'}
                    {tier === 'LIKELY' && 'Model is well documented and plausible; local conversion figures remain estimates.'}
                    {tier === 'UNCERTAIN' && 'Real but highly variable outcomes; key numbers not verifiable from available sources.'}
                    {tier === 'UNVERIFIED' && 'No credible evidence yet — treated as hypothesis, never a recommendation.'}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Research connectors">
            <div className="faint small" style={{ marginBottom: 8, lineHeight: 1.6 }}>
              Live research providers for the discovery/verification stages:
            </div>
            {['search', 'claude', 'openai', 'browser', 'market-data'].map((id) => {
              const c = getConnectors(browserConnections).find((x) => x.id === id)!;
              return (
                <div className="connector-row" key={c.id} style={{ alignItems: 'flex-start' }}>
                  <span className={`dot ${c.connected ? 'green' : 'gray'}`} style={{ marginTop: 5 }} />
                  <div style={{ flex: 1 }}>
                    <div className="connector-name">{c.name}</div>
                    <div className="connector-purpose">{c.purpose}</div>
                    <div className="connector-fallback">{c.connected ? 'connected — live mode' : `fallback: ${c.currentFallback}`}</div>
                  </div>
                  <Badge tone={c.connected ? 'green' : 'gray'}>{c.connected ? 'CONNECTED' : 'NOT CONNECTED'}</Badge>
                </div>
              );
            })}
          </Panel>

          <Panel title="Scoring output" style={{ marginTop: 14 }}>
            <div className="small muted" style={{ lineHeight: 1.7 }}>
              Opportunities are scored 0–100 across 9 weighted factors (capital fit, speed to revenue,
              success probability, profit potential, scalability, competition, difficulty, risk,
              evidence). Scores feed ranking and the AI decision center.
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <RecommendationBadge rec="HIGH PRIORITY" />
              <RecommendationBadge rec="RECOMMENDED" />
              <RecommendationBadge rec="WATCHLIST" />
              <RecommendationBadge rec="RESEARCH ONLY" />
            </div>
            <div className="faint small mono" style={{ marginTop: 10 }}>
              first-revenue window example: {dayRange(1, 14)} for top service models
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
