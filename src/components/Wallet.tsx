import { useStore, useWalletTotals } from '../store';
import { Panel, Stat } from './ui';
import { SurvivalMeter } from './SurvivalMeter';
import { usd, dateTime } from '../lib/format';
import { autoSpentToday, DEFAULT_COST_POLICY } from '../lib/costMeter';

export function Wallet() {
  const transactions = useStore((s) => s.transactions);
  const experiments = useStore((s) => s.experiments);
  const { balance, revenue, expenses, profit } = useWalletTotals();

  return (
    <div className="view-enter">
      <div className="warn-banner">
        <strong>REAL TREASURY.</strong> A $50 operating budget from the owners pays for Survivor's own
        AI and search costs, capped at {usd(DEFAULT_COST_POLICY.dailyCapUsd)} a day. Only owner capital,
        actual running costs and verified revenue appear here — forecasts never touch the balance.
        Survivor never moves money itself. Today's automatic spend:{' '}
        <strong>${autoSpentToday(transactions).toFixed(4)}</strong> of {usd(DEFAULT_COST_POLICY.dailyCapUsd)}.
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Panel tight><Stat label="Balance" value={usd(balance)} /></Panel>
        <Panel tight><Stat label="Revenue" value={usd(revenue)} tone="pos" /></Panel>
        <Panel tight><Stat label="Expenses" value={usd(expenses)} tone="neg" /></Panel>
        <Panel tight><Stat label="Profit / loss" value={<span className={profit >= 0 ? 'pos' : 'neg'}>{usd(profit)}</span>} /></Panel>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1.6fr', alignItems: 'start' }}>
        <Panel title="Survival meter">
          <SurvivalMeter />
          <div className="faint small" style={{ marginTop: 14, lineHeight: 1.7 }}>
            Below $25 → <span className="badge amber">AT RISK</span>. Below $15 → CRITICAL.
            At or below {usd(DEFAULT_COST_POLICY.floorUsd)} → <span className="badge">DORMANT</span>: no paid AI or
            search, free work only; it wakes when revenue or a top-up lifts the balance.
          </div>
        </Panel>

        <Panel
          title="Transaction ledger"
          right={<span className="faint small mono">{transactions.length} records · immutable append-only</span>}
        >
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Balance after</th>
                <th>Experiment</th>
              </tr>
            </thead>
            <tbody>
              {[...transactions].reverse().map((t) => {
                const exp = experiments.find((e) => e.id === t.relatedExperimentId);
                return (
                  <tr key={t.id}>
                    <td className="faint small mono whitespace-nowrap">{dateTime(t.createdAt)}</td>
                    <td>
                      <span className={`badge ${t.amount >= 0 ? 'green' : 'red'}`}>{t.type}</span>
                    </td>
                    <td className="small">{t.description}</td>
                    <td className={`num ${t.amount >= 0 ? 'pos' : 'neg'}`} style={{ textAlign: 'right', fontWeight: 600 }}>
                      {t.amount >= 0 ? '+' : ''}{usd(t.amount)}
                    </td>
                    <td className="num small" style={{ textAlign: 'right' }}>{usd(t.balanceAfter)}</td>
                    <td className="faint small">{exp ? exp.outcome.replace('_', ' ') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
