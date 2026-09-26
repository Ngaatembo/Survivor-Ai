import { useStore, useWalletTotals } from '../store';
import { usd } from '../lib/format';
import { currentMission } from '../lib/missions';
import { evaluateFirstDollarChallenge } from '../lib/firstDollar';

export function SurvivalMeter() {
  const { balance } = useWalletTotals();
  const threshold = useStore((s) => s.agent.survivalThreshold);
  const starting = useStore((s) => s.agent.startingCapital);
  const experiments = useStore((s) => s.experiments);
  const cycles = useStore((s) => s.agent.totalCyclesRun);
  const status = useStore((s) => s.agent.status);
  const missions = useStore((s) => s.missions);
  const realRevenue = useStore((s) => s.realRevenue);
  const mission = currentMission(missions);
  const firstDollar = evaluateFirstDollarChallenge(realRevenue);

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
  const tone = balance <= 0 ? 'dead' : status === 'CRITICAL' ? 'dead' : status === 'AT_RISK' ? 'warn' : '';

  return (
    <div>
      {mission && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div className="mono-label">Current mission</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{mission.objective}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="mono-label">Target</div>
            <div className="num" style={{ fontSize: 15, marginTop: 2 }}>{usd(mission.targetBalance)}</div>
          </div>
        </div>
      )}
      <div style={{
        marginBottom: 12,
        padding: '10px 12px',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: firstDollar.reached ? 'rgba(34, 197, 94, 0.08)' : 'rgba(255, 255, 255, 0.02)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <div>
            <div className="mono-label">REAL-WORLD CHALLENGE</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
              {firstDollar.reached ? '✓ First dollar reached' : 'Earn the first real dollar'}
            </div>
          </div>
          <div className="num" style={{ fontSize: 15 }}>
            {'        <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
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
}{firstDollar.recordedRevenue.toFixed(2)} / {'        <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
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
}{firstDollar.target.toFixed(2)}
          </div>
        </div>
        <div className="small muted" style={{ marginTop: 5 }}>
          {firstDollar.reached
            ? 'Recorded in the authenticated real-revenue ledger. Simulation money does not count.'
            : firstDollar.remaining > 0
              ? {'        <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
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
}{firstDollar.remaining.toFixed(2)} remaining. Only recorded real transactions count.
              : 'Ready for the first recorded transaction.'}
        </div>
      </div>
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
