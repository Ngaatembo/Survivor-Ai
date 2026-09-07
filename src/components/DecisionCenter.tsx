import { useMemo } from 'react';
import { useStore } from '../store';
import { Panel, Badge, DataSourceBadge, EvidenceBadge, ScoreRing, RecommendationBadge } from './ui';
import { capRange, dayRange, usd } from '../lib/format';
import { experimentBudget } from '../lib/simulation';
import { balanceFrom } from '../services/wallet';
import { decide } from '../services/ai';
import { rankOpportunities } from '../services/research';
import type { Opportunity } from '../types';

function OppMiniCard({ opp, rank }: { opp: Opportunity; rank: number }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <span className="faint mono" style={{ width: 18 }}>#{rank}</span>
      <ScoreRing score={opp.score?.total ?? 0} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12.5 }}>{opp.name}</div>
        <div className="faint small mono">
          {opp.category} · {capRange(opp.capitalRequiredMin, opp.capitalRequiredMax)} · {dayRange(opp.timeToRevenueDaysMin, opp.timeToRevenueDaysMax)}
        </div>
      </div>
      <EvidenceBadge tier={opp.evidenceTier} />
    </div>
  );
}

export function DecisionCenter() {
  const opportunities = useStore((s) => s.opportunities);
  const transactions = useStore((s) => s.transactions);
  const memory = useStore((s) => s.memory);
  const experiments = useStore((s) => s.experiments);
  const busy = useStore((s) => s.loop.busy);
  const dead = useStore((s) => s.agent.status === 'DEAD');
  const runManualExperiment = useStore((s) => s.runManualExperiment);
  const runNextCycle = useStore((s) => s.runNextCycle);
  const generateReportFor = useStore((s) => s.generateReportFor);

  const balance = balanceFrom(transactions);

  // Live decision — the exact service the autonomous engine calls each cycle.
  const { decision, livePick, alts, rejections, confidence } = useMemo(() => {
    const ranked = rankOpportunities(opportunities);
    const d = decide(ranked, memory, transactions);
    const pick = d.selected;
    return {
      decision: d,
      livePick: pick,
      alts: d.alternatives,
      rejections: d.rejections,
      confidence: d.confidence,
    };
  }, [opportunities, memory, transactions]);

  const plannedBudget = livePick ? experimentBudget(livePick, balance) : 0;
  const memForPick = livePick ? memory.find((m) => m.kind === 'opportunity' && m.refId === livePick.id) : undefined;

  return (
    <div className="view-enter">
      <div className="info-banner">
        <strong>What should I try next?</strong> The decision engine ranks scored, budget-compatible
        opportunities, excludes research-only finance models and AVOID-tagged memory, and selects the
        strongest candidate. Reasoning is rule-based in v1 (LLM connector not attached).
      </div>

      {dead && <div className="dead-banner">AGENT DEAD — decision execution locked. Reset the simulation to continue.</div>}

      {!livePick ? (
        <Panel>
          <div className="empty">
            No executable recommendation yet — run a research cycle to discover and score opportunities.
            <div style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={runNextCycle} disabled={busy}>
                ▶ Run research cycle
              </button>
            </div>
          </div>
        </Panel>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: '1.65fr 1fr', alignItems: 'start' }}>
          <div>
            <Panel
              title="Top opportunity"
              right={<DataSourceBadge source={livePick.dataSource} />}
            >
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <ScoreRing score={livePick.score?.total ?? 0} size={64} />
                <div style={{ flex: 1 }}>
                  <h2 style={{ fontSize: 17, lineHeight: 1.35 }}>{livePick.name}</h2>
                  <div className="faint small mono" style={{ marginTop: 4 }}>
                    {livePick.category} · {livePick.tags.join(' / ')}
                  </div>
                  <div style={{ display: 'flex', gap: 7, marginTop: 9, flexWrap: 'wrap' }}>
                    {livePick.score && <RecommendationBadge rec={livePick.score.recommendation} />}
                    <EvidenceBadge tier={livePick.evidenceTier} />
                    <Badge tone="gray">{livePick.riskLevel} risk</Badge>
                  </div>
                </div>
              </div>

              <div className="drawer-section" style={{ marginTop: 16 }}>
                <h3>Why it was selected</h3>
                <ul className="lesson-list">
                  {(decision?.reasons ?? [
                    `Composite score ${livePick.score!.total}/100 — highest among budget-compatible, non-blocked models.`,
                    `Capital ${capRange(livePick.capitalRequiredMin, livePick.capitalRequiredMax)} fits the $50 budget; first revenue in ${dayRange(livePick.timeToRevenueDaysMin, livePick.timeToRevenueDaysMax)}.`,
                    `Risk ${livePick.riskLevel}: maximum loss is capped at the small test budget.`,
                  ]).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>

              <div className="grid cols-2" style={{ marginTop: 14 }}>
                <Panel tight>
                  <div className="mono-label" style={{ marginBottom: 8 }}>Required resources</div>
                  <div className="small muted" style={{ lineHeight: 1.8 }}>
                    Budget: <strong className="num">{usd(plannedBudget)}</strong> simulated (≤18% of balance)<br />
                    Skills: {livePick.skills.slice(0, 3).join(', ')}<br />
                    Window: {dayRange(livePick.timeToRevenueDaysMin, livePick.timeToRevenueDaysMax)}
                  </div>
                </Panel>
                <Panel tight>
                  <div className="mono-label" style={{ marginBottom: 8 }}>Expected outcome</div>
                  <div className="small muted" style={{ lineHeight: 1.8 }}>
                    Cost: <strong className="num neg">-{usd(plannedBudget)}</strong> worst case<br />
                    Revenue range: <strong className="num">${Math.max(0, livePick.revenuePotentialMonthlyMin)}–${Math.max(0, livePick.revenuePotentialMonthlyMax)}</strong>/mo modeled<br />
                    First-attempt success prob: <strong className="num">{Math.round(livePick.successProbability * 100)}%</strong>
                  </div>
                </Panel>
              </div>

              <div className="drawer-section">
                <h3>Potential risks</h3>
                <ul className="lesson-list">
                  <li>{livePick.downsideNote}</li>
                  <li>Evidence limitation: {livePick.evidenceNotes}</li>
                  {memForPick && (
                    <li>
                      Memory: tested {memForPick.tests}× before — spent ${memForPick.spent.toFixed(2)}, returned ${memForPick.revenue.toFixed(2)} (conclusion {memForPick.conclusion}).
                    </li>
                  )}
                </ul>
              </div>

              <div style={{ display: 'flex', gap: 9, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className="btn primary"
                  disabled={dead || busy || livePick.executionBlocked}
                  onClick={() => runManualExperiment(livePick.id)}
                >
                  ▶ Simulate experiment — {usd(plannedBudget)} simulated
                </button>
                <button className="btn" onClick={() => generateReportFor(livePick.id)}>
                  Generate full report
                </button>
                <span className="faint small mono">SIMULATION ONLY — no real money moves.</span>
              </div>
            </Panel>
          </div>

          <div>
            <Panel title="Confidence" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="num" style={{ fontSize: 26, fontWeight: 700 }}>{Math.round(confidence * 100)}%</span>
                <span className="faint small">in this selection</span>
              </div>
              <div className="confidence-bar" style={{ marginTop: 8 }}>
                <div style={{ width: `${Math.round(confidence * 100)}%` }} />
              </div>
              <div className="faint small" style={{ marginTop: 8, lineHeight: 1.6 }}>
                Confidence rises with score, evidence tier and repeatable positive results in memory.
              </div>
            </Panel>

            <Panel title="Alternative opportunities" style={{ marginBottom: 14 }}>
              {alts.length === 0 ? (
                <div className="small faint">Alternatives appear after the first ranking cycle.</div>
              ) : (
                alts.slice(0, 3).map((o, i) => <OppMiniCard key={o.id} opp={o} rank={i + 2} />)
              )}
            </Panel>

            <Panel title="Rejected by safety / memory rules">
              {rejections.length === 0 ? (
                <div className="small faint">
                  Rejections (high-risk finance models, over-budget asks, AVOID memory) are logged here
                  each cycle.
                </div>
              ) : (
                rejections.slice(0, 5).map((r) => (
                  <div key={r.opportunity.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="small" style={{ fontWeight: 600 }}>{r.opportunity.name}</span>
                      {r.opportunity.executionBlocked ? <Badge tone="purple">BLOCKED</Badge> : <Badge tone="amber">SKIPPED</Badge>}
                    </div>
                    <div className="faint small" style={{ marginTop: 3, lineHeight: 1.5 }}>{r.reason}</div>
                  </div>
                ))
              )}
            </Panel>

            <Panel title="Track record" style={{ marginTop: 14 }}>
              <div className="small muted" style={{ lineHeight: 1.9 }}>
                Experiments run: <strong className="num">{experiments.length}</strong><br />
                Positive outcomes: <strong className="num pos">{experiments.filter((e) => e.outcome === 'SUCCESS' || e.outcome === 'PARTIAL_SUCCESS').length}</strong><br />
                Failed: <strong className="num neg">{experiments.filter((e) => e.outcome === 'FAILED').length}</strong><br />
                Inconclusive: <strong className="num">{experiments.filter((e) => e.outcome === 'INCONCLUSIVE').length}</strong>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
