import { useEffect, useState } from 'react';
import {
  fetchRevenueSummary,
  runRevenueLoop,
  revenueActionDecision,
  reportRevenueActionResult,
  type RevenueAction,
  type RevenueActionResult,
  type RevenueSummary,
} from '../services/backendApi';

const money = (n: number) => `$${n.toFixed(2)}`;
const RESULTS: RevenueActionResult[] = ['NO_RESPONSE', 'INTERESTED', 'NEGOTIATING', 'TRIAL', 'PRICE_REJECTED', 'LOST', 'PAID'];

/** Minimal revenue-first dashboard: money, mission, opportunity queue, and
 *  the human action queue. Survivor never sends anything itself. */
export function RevenueLoop() {
  const [data, setData] = useState<RevenueSummary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setData(await fetchRevenueSummary()); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true); setNotice('');
    try { await fn(); if (done) setNotice(done); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (error && !data) return <div className="banner banner-error">{error}</div>;
  if (!data) return <div className="card">Loading…</div>;

  return (
    <div className="stack">
      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="banner">{notice}</div>}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">MISSION</div>
            <h2>{data.mission}</h2>
          </div>
          <span className="badge-count">{data.killSwitchEngaged ? 'STOPPED' : data.status}</span>
        </div>
        <div className="metric-grid">
          <div><span>Balance</span><strong>{money(data.balance)}</strong></div>
          <div><span>Verified revenue</span><strong>{money(data.revenue)}</strong></div>
          <div><span>Expenses</span><strong>{money(data.expenses)}</strong></div>
          <div><span>Profit</span><strong>{money(data.profit)}</strong></div>
          <div><span>Risk capital</span><strong>{money(data.riskCapital)}</strong></div>
          <div><span>Waiting for you</span><strong>{data.counts.waitingForOperator}</strong></div>
        </div>
        <p className="muted">
          Opportunities: {['QUALIFIED', 'SELECTED', 'TESTING', 'ACTIVE', 'WON', 'LOST', 'ABANDONED'].map((s) => `${s} ${data.counts[s] ?? 0}`).join(' · ')}
          {data.calibration.resolvedActions > 0 && ` — predicted positive ${(100 * (data.calibration.meanPredictedPositive ?? 0)).toFixed(0)}% vs actual ${(100 * (data.calibration.actualPositiveRate ?? 0)).toFixed(0)}% over ${data.calibration.resolvedActions} results`}
        </p>
        <button className="btn primary" disabled={busy} onClick={() => void act(runRevenueLoop, 'Loop ran: opportunities rescored.')}>Run loop (free)</button>
      </div>

      <div className="card">
        <div className="card-head"><div><div className="eyebrow">REQUIRES HUMAN ACTION</div><h2>Action queue</h2></div></div>
        {data.actions.length === 0 ? <p className="muted">Nothing waiting. Run the loop.</p> :
          <div className="list">{data.actions.map((a) => <ActionRow key={a.id} a={a} busy={busy} act={act} />)}</div>}
      </div>

      <div className="card">
        <div className="card-head"><div><div className="eyebrow">RANKED BY VALUE × PROBABILITY ÷ RISK</div><h2>Opportunity queue</h2></div></div>
        <div className="list">{data.opportunities.map((o) => (
          <div className="list-row" key={o.id}>
            <div>
              <strong>{o.title} · {o.status}</strong>
              <div className="muted">{o.offer}</div>
              <div className="muted">{o.scoreExplanation}</div>
              {o.statusReason && o.status === 'DISCOVERED' && <div className="muted">Not qualified: {o.statusReason}</div>}
            </div>
            <strong>{o.score.toFixed(1)}</strong>
          </div>
        ))}</div>
      </div>
    </div>
  );
}

function ActionRow({ a, busy, act }: { a: RevenueAction; busy: boolean; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [result, setResult] = useState<RevenueActionResult>('INTERESTED');
  const [tx, setTx] = useState('');
  const [amount, setAmount] = useState(String(a.payload.suggestedDeposit ?? ''));
  const [currency, setCurrency] = useState('USD');
  const report = () => act(
    () => reportRevenueActionResult(a.id, result, undefined, result === 'PAID' ? { transactionId: tx.trim(), amount: Number(amount), currency } : undefined),
    result === 'PAID' ? 'Payment verified with Finivex and credited.' : `Recorded ${result}.`,
  );
  return (
    <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div>
        <strong>{a.title}</strong> <span className="muted">· {a.kind} · {a.status}</span>
        <div className="muted">{a.why}</div>
        <div className="muted">Predicted: {a.predictedOutcome} · cost {money(a.cost)}</div>
      </div>
      {typeof a.payload.message === 'string' && <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{a.payload.message}</pre>}
      <pre className="muted" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{a.instructions}</pre>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {a.status === 'WAITING_FOR_OPERATOR' && <>
          <button className="btn primary" disabled={busy} onClick={() => void act(() => revenueActionDecision('approve', a.id))}>Approve</button>
          <button className="btn" disabled={busy} onClick={() => void act(() => revenueActionDecision('reject', a.id))}>Reject</button>
        </>}
        {a.status === 'APPROVED' && typeof a.payload.whatsappUrl === 'string' &&
          <a className="btn" href={a.payload.whatsappUrl} target="_blank" rel="noreferrer">Open WhatsApp</a>}
        {a.status === 'APPROVED' && <button className="btn" disabled={busy} onClick={() => void act(() => revenueActionDecision('complete', a.id))}>Mark done</button>}
      </div>
      {(a.status === 'APPROVED' || a.status === 'COMPLETED') && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={result} onChange={(e) => setResult(e.target.value as RevenueActionResult)}>
            {RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {result === 'PAID' && <>
            <input placeholder="Finivex transactionId" value={tx} onChange={(e) => setTx(e.target.value)} />
            <input type="number" placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 90 }} />
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}><option>USD</option><option>ZWG</option></select>
          </>}
          <button className="btn primary" disabled={busy || (result === 'PAID' && !tx.trim())} onClick={() => void report()}>Report result</button>
        </div>
      )}
    </div>
  );
}
