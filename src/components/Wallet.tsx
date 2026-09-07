import { useStore, useWalletTotals } from '../store';
import { Panel, Stat } from './ui';
import { SurvivalMeter } from './SurvivalMeter';
import { usd, dateTime } from '../lib/format';

export function Wallet() {
  const transactions = useStore((s) => s.transactions);
  const experiments = useStore((s) => s.experiments);
  const { balance, revenue, expenses, profit } = useWalletTotals();

  return (
    <div className="view-enter">
      <div className="warn-banner">
        <strong>SIMULATED WALLET.</strong> Balance is derived solely from the transaction ledger —
        no entry ever mutates the balance directly. No bank, crypto, payment or trading account is
        connected; 100% of these figures are model outputs.
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
            Balance below the survival threshold ($5.00) → agent status <span className="badge amber">AT RISK</span>.
            Balance at $0.00 → <span className="badge red">DEAD</span>: experiments lock and the agent
            enters read-only mode.
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
