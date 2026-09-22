import { useEffect, useState } from 'react';
import {
  fetchTreasury,
  createTreasurySpendRequest,
  approveTreasurySpendRequest,
  rejectTreasurySpendRequest,
  recordConfirmedTreasuryExpense,
  recordTreasuryCapital,
  type TreasuryResponse,
  type TreasurySpendRequest,
} from '../services/backendApi';

const money = (n: number) => `${n.toFixed(2)}`;

export function Treasury() {
  const [data, setData] = useState<TreasuryResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [vendor, setVendor] = useState('OpenAI');
  const [amount, setAmount] = useState('1');
  const [purpose, setPurpose] = useState('API usage');
  const [category, setCategory] = useState('api');
  const [capitalAmount, setCapitalAmount] = useState('');
  const [capitalDescription, setCapitalDescription] = useState('Operating budget allocated to Survivor');

  const load = async () => {
    try { setData(await fetchTreasury()); setError(''); }
    catch (e) { setError((e as Error).message); }
  };

  useEffect(() => { void load(); }, []);

  const requestSpend = async () => {
    setBusy(true);
    try {
      await createTreasurySpendRequest({ vendor, amount: Number(amount), purpose, category, evidence: 'Human-created request from Survivor Treasury.' });
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const addCapital = async () => {
    const value = Number(capitalAmount);
    if (!Number.isFinite(value) || value <= 0) return;
    setBusy(true);
    try {
      await recordTreasuryCapital({ amount: value, description: capitalDescription });
      setCapitalAmount('');
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const review = async (request: TreasurySpendRequest, action: 'approve' | 'reject') => {
    setBusy(true);
    try {
      if (action === 'approve') await approveTreasurySpendRequest(request.id);
      else await rejectTreasurySpendRequest(request.id);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const recordPaid = async (request: TreasurySpendRequest) => {
    setBusy(true);
    try {
      await recordConfirmedTreasuryExpense(request.id);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (error && !data) return <div className="banner banner-error">{error}</div>;
  if (!data) return <div className="card">Loading Treasury…</div>;

  const t = data.treasury;
  const p = t.policy;
  const pending = data.spendRequests.filter((r) => r.status === 'PENDING');
  const approved = data.spendRequests.filter((r) => r.status === 'APPROVED');

  return (
    <div className="stack">
      {error && <div className="banner banner-error">{error}</div>}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">REAL-MONEY CONTROL PLANE</div>
            <h2>Survivor Treasury</h2>
            <p className="muted">A budget and accounting layer — not a bank wallet. Survivor never sends, transfers or withdraws money.</p>
          </div>
          <span className="badge-count">HUMAN APPROVAL ONLY</span>
        </div>
        <div className="metric-grid">
          <div><span>Operating balance</span><strong>{money(t.balance)}</strong></div>
          <div><span>Protected reserve</span><strong>{money(t.protectedReserve)}</strong></div>
          <div><span>Available</span><strong>{money(t.availableToSpend)}</strong></div>
          <div><span>Revenue recorded</span><strong>{money(t.revenue)}</strong></div>
          <div><span>Expenses recorded</span><strong>{money(t.expenses)}</strong></div>
          <div><span>Profit recorded</span><strong>{money(t.profit)}</strong></div>
        </div>
        <p className="muted">The balance is an accounting figure. Add only money you have actually allocated to Survivor or revenue you have actually received.</p>
      </div>

      <div className="card">
        <div className="card-head">
          <div><div className="eyebrow">OPERATING BUDGET</div><h2>Allocate money to Survivor</h2></div>
          <span className="muted">No transfer is initiated</span>
        </div>
        <div className="form-grid">
          <label>Amount (USD)<input type="number" min="0.01" step="0.01" value={capitalAmount} onChange={e => setCapitalAmount(e.target.value)} placeholder="50" /></label>
          <label>Description<input value={capitalDescription} onChange={e => setCapitalDescription(e.target.value)} /></label>
        </div>
        <button className="btn primary" onClick={() => void addCapital()} disabled={busy || !capitalAmount}>Record allocated budget</button>
        <p className="muted">This records an amount you have already set aside for Survivor. It does not move money from your bank, EcoCash or Finivex account.</p>
      </div>

      <div className="card">
        <div className="card-head">
          <div><div className="eyebrow">SPEND GATE</div><h2>Request an operating expense</h2></div>
          <span className="muted">Approval required before payment</span>
        </div>
        <div className="form-grid">
          <label>Vendor<input value={vendor} onChange={e => setVendor(e.target.value)} /></label>
          <label>Amount (USD)<input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label>Purpose<input value={purpose} onChange={e => setPurpose(e.target.value)} /></label>
          <label>Category<input value={category} onChange={e => setCategory(e.target.value)} /></label>
        </div>
        <button className="btn primary" onClick={() => void requestSpend()} disabled={busy}>Create spend request</button>
        <p className="muted">Current limit: {money(p.approvalPerTransactionLimit)} per request. Survivor does not execute the payment.</p>
      </div>

      <div className="card">
        <div className="card-head"><div><div className="eyebrow">HUMAN ACTION QUEUE</div><h2>Requests awaiting your decision</h2></div></div>
        {pending.length === 0 ? <p className="muted">No pending spend requests.</p> :
          <div className="list">{pending.slice().reverse().map((r) => (
            <div className="list-row" key={r.id}>
              <div>
                <strong>{r.vendor} · {money(r.amount)}</strong>
                <div className="muted">{r.purpose} · {r.category}</div>
                {r.evidence && <div className="muted">{r.evidence}</div>}
              </div>
              <div className="controls">
                <button className="btn primary" disabled={busy} onClick={() => void review(r, 'approve')}>Approve</button>
                <button className="btn danger" disabled={busy} onClick={() => void review(r, 'reject')}>Reject</button>
              </div>
            </div>
          ))}</div>}
      </div>

      <div className="card">
        <div className="card-head"><div><div className="eyebrow">PAYMENT CONFIRMATION</div><h2>Record expenses you actually paid</h2></div></div>
        {approved.length === 0 ? <p className="muted">No approved expenses waiting for payment confirmation.</p> :
          <div className="list">{approved.slice().reverse().map((r) => (
            <div className="list-row" key={r.id}>
              <div><strong>{r.vendor} · {money(r.amount)}</strong><div className="muted">{r.purpose} · approved {r.reviewedAt ? new Date(r.reviewedAt).toLocaleString() : ''}</div></div>
              <button className="btn primary" disabled={busy} onClick={() => void recordPaid(r)}>I paid this — record expense</button>
            </div>
          ))}</div>}
        <p className="muted">Only press the confirmation after you have actually paid the provider through its official payment method.</p>
      </div>

      <div className="card">
        <div className="card-head"><div><div className="eyebrow">AUDIT TRAIL</div><h2>Recent Treasury requests</h2></div></div>
        {data.spendRequests.length === 0 ? <p className="muted">No Treasury spend requests yet.</p> :
          <div className="list">{data.spendRequests.slice().reverse().map((r) => (
            <div className="list-row" key={r.id}>
              <div><strong>{r.vendor}</strong><div className="muted">{r.purpose} · {new Date(r.createdAt).toLocaleString()}</div></div>
              <div><strong>{money(r.amount)}</strong><div className="muted">{r.decision} · {r.status}</div></div>
            </div>
          ))}</div>}
      </div>
    </div>
  );
}
