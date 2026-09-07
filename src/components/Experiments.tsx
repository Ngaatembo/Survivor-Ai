import { useState } from 'react';
import { useStore } from '../store';
import { Panel, Badge } from './ui';
import { usd, dateTime, dayRange } from '../lib/format';
import type { Experiment } from '../types';

const outcomeTone = (o: Experiment['outcome']): 'green' | 'blue' | 'red' | 'amber' =>
  o === 'SUCCESS' ? 'green' : o === 'PARTIAL_SUCCESS' ? 'blue' : o === 'FAILED' ? 'red' : 'amber';

export function Experiments() {
  const experiments = useStore((s) => s.experiments);
  const opportunities = useStore((s) => s.opportunities);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="view-enter">
      <div className="info-banner">
        Every experiment is a <strong>simulation</strong>: budget is deducted from the simulated
        wallet, the engine models an outcome from probability/risk/memory, and results are written to
        memory. No real transaction ever occurs.
      </div>

      {experiments.length === 0 ? (
        <div className="empty">
          No experiments yet. Run a research cycle — the agent selects, budgets and simulates an
          experiment automatically — or launch one manually from the Decision Center.
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 12 }}>
          {experiments.map((e) => {
            const opp = opportunities.find((o) => o.id === e.opportunityId);
            const open = openId === e.id;
            return (
              <Panel key={e.id} tight>
                <div
                  style={{ display: 'flex', gap: 14, alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setOpenId(open ? null : e.id)}
                >
                  <Badge tone={outcomeTone(e.outcome)}>{e.outcome.replace('_', ' ')}</Badge>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{e.opportunityName}</div>
                    <div className="faint small mono">
                      {e.category} · {dateTime(e.createdAt)} · {e.durationDays}d simulated window
                      {e.cycleId ? ' · autonomous cycle' : ' · manual launch'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className={`num ${e.profitLoss >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 700 }}>
                      {e.profitLoss >= 0 ? '+' : ''}{usd(e.profitLoss)}
                    </div>
                    <div className="faint small mono">ROI {e.roi}%</div>
                  </div>
                  <span className="faint mono">{open ? '▲' : '▼'}</span>
                </div>

                {open && (
                  <div style={{ marginTop: 14, borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
                    <div className="grid cols-2" style={{ gap: 14 }}>
                      <div>
                        <div className="mono-label" style={{ marginBottom: 6 }}>Experiment plan</div>
                        <div className="kv">
                          <div className="k">Objective</div>
                          <div className="v small">{e.objective}</div>
                          <div className="k">Planned action</div>
                          <div className="v small">{e.plannedAction}</div>
                          <div className="k">Expected outcome</div>
                          <div className="v small">{e.expectedOutcome}</div>
                          <div className="k">Starting budget</div>
                          <div className="v num small">{usd(e.startingBudget)}</div>
                        </div>
                      </div>
                      <div>
                        <div className="mono-label" style={{ marginBottom: 6 }}>Measured result</div>
                        <div className="kv">
                          <div className="k">Actual cost</div>
                          <div className="v num small neg">-{usd(e.actualCost)}</div>
                          <div className="k">Actual revenue</div>
                          <div className="v num small pos">+{usd(e.actualRevenue)}</div>
                          <div className="k">Profit / loss</div>
                          <div className={`v num small ${e.profitLoss >= 0 ? 'pos' : 'neg'}`}>{e.profitLoss >= 0 ? '+' : ''}{usd(e.profitLoss)}</div>
                          <div className="k">ROI</div>
                          <div className={`v num small ${e.roi >= 0 ? 'pos' : 'neg'}`}>{e.roi}%</div>
                          <div className="k">Revenue window</div>
                          <div className="v small">{dayRange(Math.max(1, e.durationDays - 7), e.durationDays + 14)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="drawer-section" style={{ marginTop: 12 }}>
                      <h3>Lessons learned</h3>
                      <ul className="lesson-list">
                        {e.lessonsLearned.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="faint small mono" style={{ marginTop: 8 }}>
                      Evidence: {e.evidenceNote}
                      {opp && ` Model: ${opp.howMoneyMade}`}
                    </div>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
