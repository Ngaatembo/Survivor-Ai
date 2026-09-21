import { useEffect, useState } from 'react';
import {
  fetchTreasury,
  createTreasurySpendRequest,
  type TreasuryResponse,
  type TreasurySpendRequest,
} from '../services/backendApi';

const money = (n: number) => `$${n.toFixed(2)}`;

export function Treasury() {
  const [data, setData] = useState<TreasuryResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [vendor, setVendor] = useState('OpenAI');
  const [amount, setAmount] = useState('1');
  const [purpose, setPurpose] = useState('API usage');
  const [category, setCategory] = useState('api');

  const load = async () => {
    try { setData(await fetchTreasury()); setError(''); }
    catch (e) { setError((e as Error).message); }
  };

  useEffect(() => { void load(); }, []);

  const requestSpend = async () => {
    setBusy(true);
    try {
      await createTreasurySpendRequest({
        vendor,
        amount: Number(amount),
        purpose,
        category,
        evidence: 'Operator-created Treasury v1 test request',
      });
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (error && !data) return <div className="banner banner-error">{error}</div>;
  if (!data) return <div className="card">Loading Treasury…</div>;

  const t = data.treasury;
  const p = t.policy;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">REAL-MONEY CONTROL PLANE</div>
            <h2>Survivor Treasury</h2>
            <p className="muted">EcoCash is the real-money rail. Survivor currently controls accounting and authorization only.</p>
          </div>
          <span className="badge-count">{p.realMoneyExecutionEnabled ? 'LIVE' : 'SHADOW MODE'}</span>
        </div>
        <div className="metric-grid">
          <div><span>Balance</span><strong>{money(t.balance)}</strong></div>
          <div><span>Protected reserve</span><strong>{money(t.protectedReserve)}</strong></div>
          <div><span>Available</span><strong>{money(t.availableToSpend)}</strong></div>
          <div><span>Revenue</span><strong>{money(t.revenue)}</strong></div>
          <div><span>Expenses</span><strong>{money(t.expenses)}</strong></div>
          <div><span>Profit</span><strong>{money(t.profit)}</strong></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><div className="eyebrow">SPEND GATE</div><h2>Test a spend request</h2></div>
          <span className="muted">No payment is sent</span>
        </div>
        <div className="form-grid">
          <label>Vendor<input value={vendor} onChange={e => setVendor(e.target.value)} /></label>
          <label>Amount (USD)<input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label>Purpose<input value={purpose} onChange={e => setPurpose(e.target.value)} /></label>
          <label>Category<input value={category} onChange={e => setCategory(e.target.value)} /></label>
        </div>
        <button className="btn primary" onClick={() => void requestSpend()} disabled={busy}>Create spend request</button>
        <p className="muted">Current policy: autonomous {money(p.autonomousPerTransactionLimit)}/transaction, {money(p.autonomousDailyLimit)}/day, reserve {money(p.protectedReserve)}. Real execution remains OFF.</p>
      </div>

      <div className="card">
        <div className="card-head"><div><div className="eyebrow">AUDIT TRAIL</div><h2>Spend requests</h2></div></div>
        {data.spendRequests.length === 0 ? <p className="muted">No Treasury spend requests yet.</p> :
          <div className="list">{data.spendRequests.slice().reverse().map((r: TreasurySpendRequest) => (
            <div className="list-row" key={r.id}>
              <div><strong>{r.vendor}</strong><div className="muted">{r.purpose} · {new Date(r.createdAt).toLocaleString()}</div></div>
              <div><strong>{money(r.amount)}</strong><div className="muted">{r.decision} · {r.status}</div></div>
            </div>
          ))}</div>}
      </div>
    </div>
  );
}
