import { useMemo } from 'react';
import { useStore } from '../store';
import { Badge, Panel, KV, Sparkline } from './ui';
import { comparePredictionToActual, aggregateRealityComparison, predictionErrorTrend, computeCategoryRealWorldStats } from '../lib/realRevenue';

function DeltaBadge({ pct }: { pct?: number }) {
  if (pct === undefined) return <span className="faint small">no data yet</span>;
  const tone = pct >= 15 ? 'green' : pct <= -15 ? 'red' : 'blue';
  return <Badge tone={tone}>{pct > 0 ? '+' : ''}{pct}%</Badge>;
}

export function Analytics() {
  const opportunities = useStore((s) => s.opportunities);
  const businessModels = useStore((s) => s.businessModels);
  const realRevenue = useStore((s) => s.realRevenue);
  const learningEvents = useStore((s) => s.learningEvents);
  const prospects = useStore((s) => s.prospects);

  const strategyStats = useMemo(
    () =>
      computeCategoryRealWorldStats(opportunities, prospects, realRevenue)
        .filter((s) => s.decidedCount > 0 || s.entryCount > 0)
        .sort((a, b) => b.totalProfit - a.totalProfit),
    [opportunities, prospects, realRevenue],
  );

  const comparisons = useMemo(
    () =>
      opportunities
        .filter((o) => o.researchStage !== 'UNDISCOVERED')
        .map((o) => comparePredictionToActual(o, businessModels.find((m) => m.opportunityId === o.id), realRevenue))
        .sort((a, b) => b.realRevenueTotal - a.realRevenueTotal),
    [opportunities, businessModels, realRevenue],
  );

  const withData = comparisons.filter((c) => c.realEntryCount > 0);
  const aggregate = useMemo(() => aggregateRealityComparison(comparisons), [comparisons]);

  const errorTrend = useMemo(() => predictionErrorTrend(learningEvents), [learningEvents]);

  return (
    <div className="view-enter">
      <div className="warn-banner">
        This view compares what the simulation predicted against what actually happened — built to degrade
        gracefully. Until real revenue is recorded, it shows an honest empty state rather than a fabricated
        number.
      </div>

      {aggregate.opportunitiesWithRealData === 0 ? (
        <div className="empty">
          No real revenue recorded yet. Once a delivery project's payment is recorded (from the Delivery
          Projects view), simulation-vs-reality comparisons will appear here automatically.
        </div>
      ) : (
        <>
          <div className="grid cols-4" style={{ marginBottom: 14 }}>
            <Panel tight>
              <div className="stat">
                <div className="stat-label">Opportunities with real data</div>
                <div className="stat-value">{aggregate.opportunitiesWithRealData}</div>
              </div>
            </Panel>
            <Panel tight>
              <div className="stat">
                <div className="stat-label">Total real revenue</div>
                <div className="stat-value">${aggregate.totalRealRevenue.toFixed(2)}</div>
              </div>
            </Panel>
            <Panel tight>
              <div className="stat">
                <div className="stat-label">Total real profit</div>
                <div className="stat-value">${aggregate.totalRealProfit.toFixed(2)}</div>
              </div>
            </Panel>
            <Panel tight>
              <div className="stat">
                <div className="stat-label">Avg price prediction error</div>
                <div className="stat-value">
                  <DeltaBadge pct={aggregate.avgPriceDeltaPct} />
                </div>
              </div>
            </Panel>
          </div>

          {errorTrend.length > 0 && (
            <Panel tight style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>Prediction error over time (Phase 5 §22)</div>
                  <div className="faint small">
                    Rolling average |price prediction error| across recorded outcomes, oldest to newest. A
                    falling line means predictions are getting closer to reality.
                  </div>
                </div>
                <div className="stat-value" style={{ fontSize: 20 }}>{errorTrend[errorTrend.length - 1]}%</div>
              </div>
              <Sparkline values={errorTrend} width={280} height={48} positive={errorTrend[errorTrend.length - 1] <= errorTrend[0]} />
            </Panel>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {withData.map((c) => (
              <Panel key={c.opportunityId} tight>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{c.opportunityName}</div>
                <div className="kv">
                  <KV k="Predicted price" v={c.predictedPrice !== undefined ? `$${c.predictedPrice}` : 'no model yet'} />
                  <KV k="Actual avg price" v={c.realAvgPrice !== undefined ? `$${c.realAvgPrice}` : '—'} />
                  <KV k="Price prediction error" v={<DeltaBadge pct={c.priceDeltaPct} />} />
                  <KV k="Predicted time-to-revenue" v={`~${c.predictedTimeToRevenueDays}d`} />
                  <KV k="Actual avg time-to-payment" v={c.realAvgTimeToPaymentDays !== undefined ? `${c.realAvgTimeToPaymentDays}d` : '—'} />
                  <KV k="Time prediction error" v={<DeltaBadge pct={c.timeDeltaPct} />} />
                  <KV k="Real entries" v={c.realEntryCount} />
                  <KV k="Real revenue / profit" v={`$${c.realRevenueTotal.toFixed(2)} / $${c.realProfitTotal.toFixed(2)}`} />
                </div>
              </Panel>
            ))}
          </div>
        </>
      )}

      <h3 style={{ marginBottom: 10 }}>Strategy performance</h3>
      {strategyStats.length === 0 ? (
        <div className="empty">
          No strategy (category) has any decided prospects or recorded revenue yet — this table populates
          once at least one prospect is marked WON/LOST or a payment is recorded.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: 20 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Strategy (category)</th>
                <th>Attempts</th>
                <th>Won</th>
                <th>Lost</th>
                <th>Success rate</th>
                <th>Revenue</th>
                <th>Profit</th>
                <th>Avg time to revenue</th>
                <th>Avg deal value</th>
              </tr>
            </thead>
            <tbody>
              {strategyStats.map((s) => (
                <tr key={s.category}>
                  <td>{s.category}</td>
                  <td>{s.decidedCount}</td>
                  <td>{s.wonCount}</td>
                  <td>{s.lostCount}</td>
                  <td>
                    {s.decidedCount > 0 ? (
                      <Badge tone={s.realCloseRate >= 0.3 ? 'green' : s.realCloseRate > 0 ? 'blue' : 'red'}>
                        {Math.round(s.realCloseRate * 100)}%
                      </Badge>
                    ) : (
                      <span className="faint small">—</span>
                    )}
                  </td>
                  <td>${s.totalRevenue.toFixed(2)}</td>
                  <td>${s.totalProfit.toFixed(2)}</td>
                  <td>{s.avgRealTimeToRevenueDays !== undefined ? `${s.avgRealTimeToRevenueDays}d` : '—'}</td>
                  <td>{s.avgDealValue !== undefined ? `$${s.avgDealValue.toFixed(2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginBottom: 10 }}>Learning events</h3>
      {learningEvents.length === 0 ? (
        <div className="empty">
          No learning events yet — one is generated automatically every time real revenue is recorded,
          comparing what was predicted to what actually happened.
        </div>
      ) : (
        <div className="feed">
          {learningEvents.slice(0, 30).map((e) => (
            <div key={e.id} className="event">
              <span className="ev-time">{e.category}</span>
              <span className="ev-msg">{e.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
