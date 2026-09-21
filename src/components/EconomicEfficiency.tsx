/* ============================================================================
 * ECONOMIC EFFICIENCY dashboard panel (Economic Survival Overhaul, Phase 15).
 * Server-computed only (worker GET /state economicEfficiency field) — this
 * component never recomputes search-cost numbers client-side, since the
 * search-budget/cache ledger lives in the backend's KV store, not the
 * browser. In local browser-demo mode (no backend configured) it shows an
 * honest "backend-only" note instead of a fabricated number.
 * ========================================================================== */
import { useStore } from '../store';
import { Badge, Panel } from './ui';

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n * 100)}%`;
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="faint small">{sub}</div>}
    </div>
  );
}

export function EconomicEfficiency() {
  const data = useStore((s) => s.economicEfficiency);
  const backendConnected = useStore((s) => s.backend.connected);

  if (!data) {
    return (
      <div className="view-enter">
        <div className="warn-banner">
          Search-cost economics (budget usage, cache hit rate, revenue funnel, search ROI) are computed by the
          deployed backend from its persisted search-budget ledger.{' '}
          {backendConnected
            ? 'Waiting for the next sync…'
            : 'Connect VITE_API_BASE_URL to a deployed Cloudflare Worker to see real numbers here — the local browser demo does not track this.'}
        </div>
      </div>
    );
  }

  const { searchEconomy, revenueFunnel, conversionByCategory, conversionByAcquisitionChannel, dealMetrics, searchROI, humanActionQueue, survivalStatus } = data;

  const survivalTone = survivalStatus === 'ALIVE' ? 'green' : survivalStatus === 'AT_RISK' ? 'amber' : survivalStatus === 'CRITICAL' ? 'red' : 'gray';

  return (
    <div className="view-enter">
      <div className="warn-banner">
        Every number below is computed server-side from the actual search-budget ledger and CRM/revenue data — no
        estimates, no simulated figures. Search spend is a call-count proxy (Brave/Tavily free-tier quota units),
        not a fabricated dollar cost — see docs/SURVIVAL_ECONOMICS_AUDIT.md for the exact assumption.
      </div>

      <Panel title="NEXT MONEY ACTION" right={<Badge tone={survivalTone}>{survivalStatus}</Badge>}>
        {humanActionQueue.topAction ? (
          <>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{humanActionQueue.topAction.title}</div>
            <div className="faint" style={{ marginBottom: 8 }}>{humanActionQueue.topAction.description}</div>
            <div className="grid cols-3">
              <Stat label="Expected value" value={`$${humanActionQueue.topAction.expectedValue.toFixed(2)}`} />
              <Stat label="Urgency" value={`${humanActionQueue.topAction.urgency}/5`} />
              <Stat label="Effort" value={`${humanActionQueue.topAction.effort}/5`} />
            </div>
          </>
        ) : (
          <div className="empty">No action required right now — nothing in the pipeline needs a human decision this moment.</div>
        )}
      </Panel>

      <Panel title="HUMAN ACTION QUEUE" style={{ marginTop: 14 }}>
        <div className="grid cols-4" style={{ marginBottom: 10 }}>
          <Stat label="Offers awaiting send" value={humanActionQueue.offersAwaitingSend} />
          <Stat label="Follow-ups due" value={humanActionQueue.followUpsDue} />
          <Stat label="Need status update" value={humanActionQueue.prospectsNeedingStatusUpdate} />
          <Stat label="Won, payment not recorded" value={humanActionQueue.wonWithoutRecordedPayment} />
        </div>
        {humanActionQueue.queue.length === 0 ? (
          <div className="empty">Queue is empty.</div>
        ) : (
          <table className="table">
            <thead><tr><th>#</th><th>Action</th><th>Expected value</th><th>Urgency</th></tr></thead>
            <tbody>
              {humanActionQueue.queue.slice(0, 8).map((a) => (
                <tr key={a.id}>
                  <td>{a.rank}</td>
                  <td>{a.title}</td>
                  <td>${a.expectedValue.toFixed(2)}</td>
                  <td>{a.urgency}/5</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="REVENUE FUNNEL" style={{ marginTop: 14 }}>
        <table className="table">
          <thead><tr><th>Stage</th><th>Count</th><th>Conversion from previous</th></tr></thead>
          <tbody>
            {revenueFunnel.stages.map((s) => (
              <tr key={s.stage}>
                <td>{s.stage}</td>
                <td>{s.count}</td>
                <td>{pct(s.conversionFromPrevious)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="faint small" style={{ marginTop: 6 }}>
          {revenueFunnel.droppedCount} dropped (LOST / NOT_INTERESTED, not attributed to a mid-funnel stage without evidence) ·
          Overall discovery→won conversion: {pct(revenueFunnel.overallConversionRate)}
        </div>
      </Panel>

      <div className="grid cols-2" style={{ marginTop: 14, gap: 14 }}>
        <Panel title="Search economics">
          <div className="grid cols-2" style={{ marginBottom: 8 }}>
            <Stat label="Searches today" value={searchEconomy.searchesToday} />
            <Stat label="Searches this month" value={searchEconomy.searchesThisMonth} />
            <Stat label="Cache hits today" value={searchEconomy.cacheHitsToday} />
            <Stat label="Cache hit rate" value={pct(searchEconomy.cacheHitRateToday)} />
          </div>
          <div className="faint small">By purpose today: {Object.entries(searchEconomy.byPurposeToday).map(([p, n]) => `${p}: ${n}`).join(' · ')}</div>
          <div className="faint small">By provider today: {Object.entries(searchEconomy.byProviderToday).map(([p, n]) => `${p}: ${n}`).join(' · ') || 'none'}</div>
        </Panel>

        <Panel title="Search ROI">
          <div className="grid cols-2">
            <Stat label="Search ROI" value={searchROI.searchROI} sub={`basis: ${searchROI.basis}`} />
            <Stat label="Revenue / 100 searches" value={`$${searchROI.revenuePer100Searches}`} />
            <Stat label="Prospects / 100 searches" value={searchROI.prospectsPer100Searches} />
            <Stat label="Proposals / 100 searches" value={searchROI.proposalsPer100Searches} />
          </div>
        </Panel>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14, gap: 14 }}>
        <Panel title="Deal metrics">
          <div className="grid cols-2">
            <Stat label="Avg deal size" value={dealMetrics.avgDealSize !== null ? `$${dealMetrics.avgDealSize}` : '—'} />
            <Stat label="Avg time to payment" value={dealMetrics.avgTimeToPaymentDays !== null ? `${dealMetrics.avgTimeToPaymentDays}d` : '—'} />
            <Stat label="Deals recorded" value={dealMetrics.dealCount} />
          </div>
        </Panel>
        <Panel title="Conversion by acquisition channel">
          {conversionByAcquisitionChannel.length === 0 ? (
            <div className="empty">No real revenue recorded yet.</div>
          ) : (
            <table className="table">
              <thead><tr><th>Channel</th><th>Deals</th><th>Revenue</th></tr></thead>
              <tbody>
                {conversionByAcquisitionChannel.map((c) => (
                  <tr key={c.channel}><td>{c.channel}</td><td>{c.dealCount}</td><td>${c.totalRevenue}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <Panel title="Conversion by category" style={{ marginTop: 14 }}>
        <table className="table">
          <thead><tr><th>Category</th><th>Discovered</th><th>Won</th><th>Lost</th><th>Conversion (decided)</th></tr></thead>
          <tbody>
            {conversionByCategory.map((c) => (
              <tr key={c.category}>
                <td>{c.category}</td><td>{c.discovered}</td><td>{c.won}</td><td>{c.lost}</td><td>{pct(c.conversionRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
