import { useStore, backendConfigured } from '../store';
import { Badge, Bar, DataSourceBadge, EvidenceBadge, KV, RecommendationBadge } from './ui';
import { capRange, dayRange, dateTime } from '../lib/format';
import { FACTOR_LABELS } from '../lib/scoring';
import type { Opportunity, ProspectStatus, ScoreFactorKey } from '../types';

function FactorBar({ factor }: { factor: { key: ScoreFactorKey; raw: number; weight: number } }) {
  const tone = factor.raw >= 70 ? 'green' : factor.raw >= 45 ? 'amber' : 'red';
  return (
    <Bar
      label={`${FACTOR_LABELS[factor.key]} (w${factor.weight})`}
      value={factor.raw}
      tone={tone as 'green' | 'amber' | 'red'}
    />
  );
}

export function OpportunityDrawer({ opp, onClose, onOpenProspects }: { opp: Opportunity; onClose: () => void; onOpenProspects: () => void }) {
  const runManualExperiment = useStore((s) => s.runManualExperiment);
  const generateReportFor = useStore((s) => s.generateReportFor);
  const reports = useStore((s) => s.reports);
  const busy = useStore((s) => s.loop.busy);
  const dead = useStore((s) => s.agent.status === 'DEAD');
  const memory = useStore((s) => s.memory.find((m) => m.kind === 'opportunity' && m.refId === opp.id));
  const businessModel = useStore((s) => s.businessModels.find((m) => m.opportunityId === opp.id));
  const prospects = useStore((s) => s.prospects.filter((p) => p.opportunityId === opp.id));
  const offers = useStore((s) => s.offers.filter((o) => o.opportunityId === opp.id));
  const projects = useStore((s) => s.projects.filter((p) => p.opportunityId === opp.id));
  const realRevenue = useStore((s) => s.realRevenue.filter((r) => r.opportunityId === opp.id));
  const prospectIntelligence = useStore((s) => s.prospectIntelligence.filter((i) => prospects.some((p) => p.id === i.prospectId)));
  const marketPriceResearch = useStore((s) => s.marketPriceResearch.find((m) => m.opportunityId === opp.id));
  const prospectDemos = useStore((s) => s.prospectDemos.filter((d) => prospects.some((p) => p.id === d.prospectId)));
  const updateProspectStatus = useStore((s) => s.updateProspectStatus);
  const hasReport = reports.some((r) => r.opportunityId === opp.id);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <div style={{ display: 'flex', gap: 7, marginBottom: 8, flexWrap: 'wrap' }}>
              <DataSourceBadge source={opp.dataSource} />
              <EvidenceBadge tier={opp.evidenceTier} />
              {opp.executionBlocked ? (
                <Badge tone="purple">RESEARCH ONLY</Badge>
              ) : (
                opp.score && <RecommendationBadge rec={opp.score.recommendation} />
              )}
              <span className="stage-badge lit">{opp.researchStage}</span>
            </div>
            <h2>{opp.name}</h2>
            <div className="faint small mono" style={{ marginTop: 4 }}>
              {opp.category} · {opp.tags.join(' / ')}
            </div>
          </div>
          <button className="close" onClick={onClose}>
            ✕
          </button>
        </div>

        {opp.executionBlocked && (
          <div className="warn-banner" style={{ marginTop: 14 }}>
            <strong>Autonomous execution blocked.</strong> {opp.blockReason}
          </div>
        )}

        <div className="drawer-section">
          <h3>Description</h3>
          <p>{opp.description}</p>
          <p style={{ marginTop: 8 }}>
            <span className="mono-label">How money is generated — </span>
            {opp.howMoneyMade}
          </p>
        </div>

        {opp.score && (
          <div className="drawer-section">
            <h3>Score breakdown — {opp.score.total}/100</h3>
            {opp.score.factors.map((f) => (
              <FactorBar key={f.key} factor={f} />
            ))}
            <div className="small faint" style={{ marginTop: 8 }}>
              Budget fit ($50): {opp.score.budgetFit ? 'YES' : 'NO'} · AI-suitable:{' '}
              {opp.score.aiSuitable ? 'YES' : 'NO'} · scored {dateTime(opp.score.scoredAt)}
            </div>
          </div>
        )}

        <div className="drawer-section">
          <h3>Commercial model</h3>
          {businessModel ? (
            <>
              <div className="kv">
                <KV k="Target customer" v={businessModel.targetCustomer} />
                <KV k="Problem" v={businessModel.problem} />
                <KV k="Offer" v={businessModel.offer} />
                <KV k="Suggested price" v={`${businessModel.suggestedPrice}`} />
                <KV k="Price basis" v={businessModel.priceRationale} />
                <KV k="Acquisition" v={businessModel.acquisitionChannel} />
                <KV k="First-sale window" v={`${businessModel.timeToFirstSaleDaysEstimate} days`} />
                <KV k="Expected first-deal profit" v={`${businessModel.expectedProfitFirstDeal.toFixed(2)}`} />
              </div>
              <div style={{ marginTop: 10 }}>
                <div className="mono-label" style={{ marginBottom: 5 }}>Sales message</div>
                <p className="small">{businessModel.salesMessage}</p>
              </div>
              <div style={{ marginTop: 10 }}>
                <div className="mono-label" style={{ marginBottom: 5 }}>Next action</div>
                <p className="small">{businessModel.nextAction}</p>
              </div>
            </>
          ) : (
            <div className="empty">No commercial model has been generated for this opportunity yet.</div>
          )}
        </div>

        <div className="drawer-section">
          <h3>Sales readiness</h3>
          {prospects.length === 0 ? (
            <div>
              <div className="empty">No real prospects are linked to this opportunity yet.</div>
              <button className="btn primary small" style={{ marginTop: 9 }} onClick={onOpenProspects}>🔎 Find real prospects →</button>
            </div>
          ) : (
            <div className="small">
              {prospects.map((prospect) => {
                const verified = prospect.verification?.status === 'VERIFIED' || prospect.verification?.status === 'PROVISIONAL';
                const intelligence = prospectIntelligence.some((i) => i.prospectId === prospect.id);
                const offer = offers.find((o) => o.prospectId === prospect.id);
                const demo = prospectDemos.some((d) => d.prospectId === prospect.id);
                const checks = [
                  ['Identity/contact checked', verified],
                  ['Business research gathered', intelligence],
                  ['Market pricing researched', Boolean(marketPriceResearch && marketPriceResearch.sources.length)],
                  ['Commercial model exists', Boolean(businessModel)],
                  ['Offer drafted', Boolean(offer)],
                  ['Prospect demo exists', demo],
                ] as const;
                return (
                  <div key={prospect.id} className="source-item" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
                    <span className="src-kind">{prospect.status}</span>
                    <div style={{ flex: 1 }}>
                      <strong>{prospect.businessName}</strong>
                      <div className="faint small" style={{ marginTop: 5 }}>
                        {checks.map(([label, done]) => <div key={label}>{done ? '✓' : '○'} {label}</div>)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="faint small mono" style={{ marginTop: 8 }}>
            Readiness is evidence-based. A missing check means Survivor does not yet have enough stored evidence for that step.
          </div>
        </div>
        <div className="drawer-section">
          <h3>Sales execution</h3>
          {prospects.length === 0 ? (
            <div className="empty">No real prospects are linked to this opportunity yet.</div>
          ) : (
            prospects.map((prospect) => {
              const offer = offers.find((o) => o.prospectId === prospect.id);
              const project = projects.find((p) => p.prospectId === prospect.id);
              const revenue = realRevenue.filter((r) => r.prospectId === prospect.id).reduce((sum, r) => sum + r.amountReceived, 0);
              const nextStatus: ProspectStatus | null = prospect.status === 'DISCOVERED'
                ? 'QUALIFIED'
                : prospect.status === 'QUALIFIED'
                  ? 'CONTACTED'
                  : prospect.status === 'CONTACTED'
                    ? 'REPLIED'
                    : prospect.status === 'REPLIED'
                      ? 'INTERESTED'
                      : prospect.status === 'INTERESTED'
                        ? 'PROPOSAL_SENT'
                        : prospect.status === 'PROPOSAL_SENT'
                          ? 'NEGOTIATING'
                          : null;
              return (
                <div key={prospect.id} className="source-item" style={{ alignItems: 'flex-start' }}>
                  <span className="src-kind">{prospect.status}</span>
                  <div style={{ flex: 1 }}>
                    <strong>{prospect.businessName}</strong>
                    <div className="faint small">{prospect.location}</div>
                    <div className="small" style={{ marginTop: 5 }}>
                      {offer ? 'Offer: ' + offer.price.toFixed(2) + ' · ' + offer.status : 'Offer not drafted'}
                      {project ? ' · Project: ' + project.status : ''}
                      {revenue > 0 ? ' · Received: ' + revenue.toFixed(2) : ''}
                    </div>
                    {nextStatus && (
                      <button
                        className="btn small"
                        style={{ marginTop: 7 }}
                        onClick={() => void updateProspectStatus(prospect.id, nextStatus)}
                      >
                        Mark {nextStatus.replace('_', ' ').toLowerCase()}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div className="faint small mono" style={{ marginTop: 8 }}>
            Human-controlled pipeline. Survivor prepares and records the next step; it never contacts a prospect automatically.
          </div>
        </div>
        <div className="drawer-section">
          <h3>Economics</h3>
          <div className="kv">
            <KV k="Starting capital" v={capRange(opp.capitalRequiredMin, opp.capitalRequiredMax)} />
            <KV k="Time to first revenue" v={dayRange(opp.timeToRevenueDaysMin, opp.timeToRevenueDaysMax)} />
            <KV
              k="Monthly potential"
              v={
                <span className="num">
                  ${Math.max(0, opp.revenuePotentialMonthlyMin)}–${Math.max(0, opp.revenuePotentialMonthlyMax)}
                  <span className="faint"> (modeled ramp)</span>
                </span>
              }
            />
            <KV k="Operating costs" v={opp.operatingCostsNote} />
            <KV k="Risk" v={`${opp.riskLevel} (${opp.risk}/5)`} />
            <KV k="Difficulty" v={`${opp.difficulty}/5`} />
            <KV k="Competition" v={`${opp.competition}/5`} />
            <KV k="Scalability" v={`${opp.scalability}/5`} />
            <KV k="Est. success probability" v={`${Math.round(opp.successProbability * 100)}% for a first $50-budget attempt`} />
          </div>
        </div>

        <div className="drawer-section">
          <h3>Requirements & geography</h3>
          <div className="chip-list" style={{ marginBottom: 10 }}>
            {opp.skills.map((s) => (
              <span key={s} className="badge gray">{s}</span>
            ))}
          </div>
          <div className="chip-list">
            {opp.geographicRelevance.map((g) => (
              <span key={g} className="badge blue">{g}</span>
            ))}
          </div>
        </div>

        <div className="drawer-section">
          <h3>Upside & downside</h3>
          <p>
            <span className="pos">▲ Upside: </span>
            {opp.upsideNote}
          </p>
          <p style={{ marginTop: 6 }}>
            <span className="neg">▼ Downside: </span>
            {opp.downsideNote}
          </p>
        </div>

        <div className="drawer-section">
          <h3>Evidence</h3>
          <p className="small" style={{ marginBottom: 8 }}>
            <EvidenceBadge tier={opp.evidenceTier} /> <span style={{ marginLeft: 8 }}>{opp.evidenceNotes}</span>
          </p>
          <div className="faint small mono" style={{ marginBottom: 6 }}>
            Date researched: {opp.dateResearched ? dateTime(opp.dateResearched) : 'not yet researched'}
          </div>
          {opp.examples.length > 0 && (
            <p className="small muted" style={{ marginBottom: 8 }}>
              Example models: {opp.examples.join(' · ')}
            </p>
          )}
          {opp.sources.map((s) => (
            <div className="source-item" key={s.id}>
              <span className="src-kind">{s.kind}</span>
              <div>
                <div>{s.title}</div>
                {s.note && <div className="faint small">{s.note}</div>}
                {s.url && <div className="small mono" style={{ color: 'var(--blue)' }}>{s.url}</div>}
              </div>
            </div>
          ))}
        </div>

        {memory && (
          <div className="drawer-section">
            <h3>Agent memory for this model</h3>
            <div className="kv">
              <KV k="Tests run" v={`${memory.tests}`} />
              <KV k="Total spent" v={`$${memory.spent.toFixed(2)}`} />
              <KV k="Total returned" v={`$${memory.revenue.toFixed(2)}`} />
              <KV k="Conclusion" v={<span className={`memory-conclusion-${memory.conclusion}`}>{memory.conclusion}</span>} />
            </div>
          </div>
        )}

        <div className="drawer-section" style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {!backendConfigured && (
            <button
              className="btn primary"
              disabled={dead || busy || opp.executionBlocked}
              onClick={() => {
                runManualExperiment(opp.id);
                onClose();
              }}
              title={opp.executionBlocked ? opp.blockReason : 'Runs a SIMULATED experiment — no real money'}
            >
              ▶ Simulate experiment (simulated $)
            </button>
          )}
          {!backendConfigured && (
            <button
              className="btn"
              onClick={() => generateReportFor(opp.id)}
              disabled={hasReport}
            >
              {hasReport ? '✓ Report generated' : 'Generate research report'}
            </button>
          )}
          {backendConfigured && (
            <span className="faint small">
              Live mode: simulation/report generation is handled by the backend cycle. This dashboard is read-only for those actions.
            </span>
          )}
        </div>
        <div className="faint small mono" style={{ marginTop: 10 }}>
          All experiments are simulations. No real transactions, accounts or APIs are connected.
        </div>
      </div>
    </>
  );
}
