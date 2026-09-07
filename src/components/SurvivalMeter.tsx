import { useStore, useWalletTotals } from '../store';
import { usd } from '../lib/format';

export function SurvivalMeter() {
  const { balance } = useWalletTotals();
  const threshold = useStore((s) => s.agent.survivalThreshold);
  const starting = useStore((s) => s.agent.startingCapital);
  const experiments = useStore((s) => s.experiments);
  const cycles = useStore((s) => s.agent.totalCyclesRun);

  // Runway: average simulated expense per completed cycle, assume ~7 days/cycle.
  const avgBurn =
    experiments.length > 0
      ? experiments.reduce((s, e) => s + e.actualCost, 0) / Math.max(1, cycles)
      : 0;
  const runwayCycles = avgBurn > 0 ? balance / avgBurn : null;
  const runwayDays = runwayCycles !== null ? Math.round(runwayCycles * 7) : null;

  const scaleMax = Math.max(starting, balance, threshold * 2);
  const pct = Math.max(0, Math.min(100, (balance / scaleMax) * 100));
  const markerPct = (threshold / scaleMax) * 100;
  const tone = balance <= 0 ? 'dead' : balance < threshold ? 'warn' : '';

  return (
    <div>
      <div className="meter">
        <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
        <div className="meter-marker" style={{ left: `${markerPct}%` }} title={`Survival threshold $${threshold}`} />
      </div>
      <div className="meter-labels">
        <span>$0.00</span>
        <span style={{ color: 'var(--amber)' }}>threshold {usd(threshold)}</span>
        <span>{usd(balance)}</span>
      </div>
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div className="mono-label">Estimated runway</div>
          <div className="num" style={{ fontSize: 15, marginTop: 2 }}>
            {balance <= 0
              ? '—'
              : runwayDays === null
                ? 'no burn yet'
                : runwayDays < 7
                  ? `< 7 days`
                  : `~${runwayDays} days`}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono-label">Burn / cycle (avg)</div>
          <div className="num" style={{ fontSize: 15, marginTop: 2 }}>
            {avgBurn > 0 ? usd(avgBurn) : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
