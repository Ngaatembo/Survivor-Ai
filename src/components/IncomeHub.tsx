import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  fetchFinivexStatus,
  fetchPaymentRequests,
  createPaymentRequest,
  approvePaymentRequest,
  cancelPaymentRequest,
  createApprovedFinivexLink,
  markPaymentRequestPaid,
  researchIncomeChannels as apiResearchIncomeChannels,
  fetchIncomeStrategy,
  type IncomeStrategyResponse,
  fetchWindsorIncomeSummary,
  type PaymentRequest,
  type WindsorIncomeSummary,
} from '../services/backendApi';
import { Panel, Badge } from './ui';

const CHANNELS = [
  ['nwt-dev','◆','NWT Dev services','Websites, business systems, automation and recurring client work.','ACTIVE','Qualify a real business and pursue the highest-value verified opportunity.','NWT_DEV_SERVICES'],
  ['websites','◫','Website builds','Evidence-backed website projects for businesses with weak or missing digital presence.','ACTIVE','Find one qualified prospect and build a focused demo.','WEBSITES'],
  ['whatsapp','◉','WhatsApp bots','Automate FAQs, lead capture, bookings and repetitive customer conversations.','BUILDING','Find a business with repeated WhatsApp questions and prototype the smallest useful bot.','WHATSAPP_BOTS'],
  ['automation','↻','Business automation','Reduce repetitive admin, follow-ups, data entry and workflow friction.','BUILDING','Identify one repetitive workflow from a real business.','AUTOMATION'],
  ['content','●','Content & social','Build useful content, measure distribution and test legitimate monetization.','BUILDING','Run a small content experiment and record actual results.','CONTENT_SOCIAL'],
  ['freelance','↗','Freelancing / remote work','Find legitimate technical work that matches current skills and can be delivered.','BUILDING','Find one legitimate matching brief and prepare an application.','FREELANCE_REMOTE'],
  ['products','▤','Digital products','Package repeated problems into templates, tools or other reusable products.','BUILDING','Identify a repeated client problem worth packaging.','DIGITAL_PRODUCTS'],
  ['education','◇','Education & tutoring','Tutoring, explanations, study support and learning materials.','BUILDING','Test a small tutoring/study-support offer with real demand.','EDUCATION_TUTORING'],
  ['affiliate','⌁','Affiliate / referral','Verify legitimate programs and recommend only relevant products or services.','BUILDING','Verify one legitimate program and its payout terms.','AFFILIATE_REFERRAL'],
  ['trading','△','Forex / trading research','Tembo-backed market research, backtesting and paper trading only.','RESEARCHING','Validate evidence before considering any capital decision.','TRADING_RESEARCH'],
  ['other','＋','Emerging opportunities','A controlled lane for new evidence-backed income ideas.','BUILDING','Research, classify and run the cheapest useful human-approved test.','OTHER'],
] as const;

export function IncomeHub() {
  const prospects = useStore((s) => s.prospects);
  const offers = useStore((s) => s.offers);
  const projects = useStore((s) => s.projects);
  const realRevenue = useStore((s) => s.realRevenue);
  const actions = useStore((s) => s.actions);
  const backendConnected = useStore((s) => s.backend.connected);
  const economicEfficiency = useStore((s) => s.economicEfficiency);
  const incomeIntelligence = useStore((s) => s.incomeIntelligence);
  const researchIncomeChannels = useStore((s) => s.researchIncomeChannels);
  const backendSyncing = useStore((s) => s.backend.syncing);
  const [finivex, setFinivex] = useState<{ configured: boolean; canCreatePaymentLinks: boolean; note: string } | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [paymentForm, setPaymentForm] = useState({ clientName: '', amount: '', description: '', paymentMethod: 'OTHER' as PaymentRequest['payment_method'] });
  const [channelBusy, setChannelBusy] = useState<string | null>(null);
  const [windsor, setWindsor] = useState<WindsorIncomeSummary | null>(null);
  const [windsorBusy, setWindsorBusy] = useState(false);
  const [channelResults, setChannelResults] = useState<Record<string, typeof incomeIntelligence>>({});
  const [strategy, setStrategy] = useState<IncomeStrategyResponse | null>(null);
  const [strategyBusy, setStrategyBusy] = useState(false);
  const [selectedPlanKind, setSelectedPlanKind] = useState<string | null>(null);
  const runChannelResearch = async (channel: string) => {
    if (!backendConnected || channelBusy) return;
    setChannelBusy(channel);
    try {
      const result = await apiResearchIncomeChannels(channel);
      setChannelResults((current) => ({ ...current, [channel]: result.opportunities.filter((o) => o.channel === channel).slice(0, 8) }));
    } catch (e) {
      setPaymentError((e as Error).message);
    } finally {
      setChannelBusy(null);
    }
  };

  const runChannelStrategy = async (kind: string) => {
    if (!backendConnected || strategyBusy) return;
    setStrategyBusy(true);
    try {
      const result = await fetchIncomeStrategy(kind);
      setSelectedPlanKind(kind);
      setStrategy((current) => {
        if (!current) return result;
        const next = [...current.strategies];
        for (const item of result.strategies) {
          const index = next.findIndex((s) => s.kind === item.kind);
          if (index >= 0) next[index] = item;
          else next.push(item);
        }
        return { ...current, generatedAt: result.generatedAt, strategies: next, evidence: [...current.evidence, ...result.evidence], forex: result.forex, channelPlans: result.channelPlans };
      });
    } catch (e) { setPaymentError((e as Error).message); }
    finally { setStrategyBusy(false); }
  };

  const refreshStrategy = async () => {
    if (!backendConnected) return;
    setStrategyBusy(true);
    try { setStrategy(await fetchIncomeStrategy()); }
    catch (e) { setPaymentError((e as Error).message); }
    finally { setStrategyBusy(false); }
  };

  const refreshPayments = async () => {
    if (!backendConnected) return;
    try {
      const [status, requests] = await Promise.all([fetchFinivexStatus(), fetchPaymentRequests()]);
      setFinivex(status.payment);
      setPaymentRequests(requests.requests);
      setPaymentError('');
    } catch (e) {
      setPaymentError((e as Error).message);
    }
  };

  const refreshWindsor = async () => {
    if (!backendConnected) return;
    setWindsorBusy(true);
    try {
      const result = await fetchWindsorIncomeSummary();
      setWindsor(result);
    } catch (e) {
      setPaymentError((e as Error).message);
    } finally {
      setWindsorBusy(false);
    }
  };

  useEffect(() => {
    void refreshPayments();
    void refreshWindsor();
    void refreshStrategy();
  }, [backendConnected]);

  const money = useMemo(() => ({
    received: realRevenue.reduce((sum, r) => sum + r.amountReceived, 0),
    costs: realRevenue.reduce((sum, r) => sum + r.costs, 0),
    profit: realRevenue.reduce((sum, r) => sum + r.profit, 0),
    wonWithoutPayment: prospects.filter((p) => p.status === 'WON' && p.actualRevenue <= 0).length,
    activeProjects: projects.filter((p) => p.status === 'ACTIVE').length,
    offersToSend: offers.filter((o) => o.status === 'DRAFT').length,
  }), [prospects, offers, projects, realRevenue]);

  const channelRevenue = useMemo(() => {
    const totals = new Map<string, number>();
    realRevenue.forEach((r) => {
      const key = (r.acquisitionChannel || 'other').toLowerCase();
      totals.set(key, (totals.get(key) ?? 0) + r.amountReceived);
    });
    return totals;
  }, [realRevenue]);

  const topActions = economicEfficiency?.humanActionQueue.queue.slice(0, 3) ?? actions.slice(0, 3);
  const tone = (s: string) => s === 'ACTIVE' ? 'green' : 'amber';

  return <div className="view-enter">
    <div className="info-banner"><strong>Multi-income control room.</strong> Survivor now treats NWT Dev, content, freelancing, digital products, referrals and future income sources as one opportunity portfolio. It researches and prepares; you approve the real-world action.</div>

    <div className="grid cols-4" style={{ marginBottom: 14 }}>
      <Panel tight><div className="stat-label">REAL REVENUE RECEIVED</div><div className="stat-value">{money.received.toFixed(2)} USD</div><div className="faint small">human-recorded revenue only</div></Panel>
      <Panel tight><div className="stat-label">REAL PROFIT</div><div className="stat-value">{money.profit.toFixed(2)} USD</div><div className="faint small">after recorded costs</div></Panel>
      <Panel tight><div className="stat-label">OFFERS READY</div><div className="stat-value">{money.offersToSend}</div><div className="faint small">awaiting human send</div></Panel>
      <Panel tight><div className="stat-label">PAYMENT FOLLOW-UP</div><div className="stat-value">{money.wonWithoutPayment}</div><div className="faint small">won but no revenue recorded</div></Panel>
    </div>

    <Panel title="LIVE INCOME INTELLIGENCE" right={<button className="btn small" disabled={!backendConnected || backendSyncing} onClick={() => void researchIncomeChannels()}>{backendSyncing ? 'Researching…' : 'Research channels'}</button>}>
      {incomeIntelligence.length === 0 ? <div className="empty">No channel opportunities researched yet. Run live research to find evidence-backed opportunities across the additional income channels.</div> :
        <div className="feed" style={{ maxHeight: 360, overflowY: 'auto' }}>{incomeIntelligence.slice(0, 12).map((o) =>
          <div key={o.id} className="event" style={{ display: 'block', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><strong>{o.title}</strong><Badge tone="blue">{o.channel}</Badge></div>
            <div className="muted small" style={{ marginTop: 4, lineHeight: 1.5 }}>{o.description}</div>
            <div className="faint small mono" style={{ marginTop: 5 }}>{o.evidence}</div>
            {o.sourceUrls[0] && <a className="faint small" href={o.sourceUrls[0]} target="_blank" rel="noreferrer">Open source ↗</a>}
          </div>
        )}</div>}
    </Panel>


    <Panel title="CONNECTED LIVE DATA" right={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Badge tone={windsor?.configured ? 'green' : 'amber'}>{windsor?.configured ? 'WINDSOR CONNECTED' : 'API KEY NEEDED'}</Badge><button className="btn small" disabled={windsorBusy || !backendConnected} onClick={() => void refreshWindsor()}>{windsorBusy ? 'Syncing…' : 'Sync now'}</button></div>}>
      <div className="small muted" style={{ lineHeight: 1.7 }}>
        Survivor reads connected Google and social performance through Windsor.ai. It does not publish, message, spend money or change connected accounts.
      </div>
      {!windsor?.configured ? <div className="warn-banner" style={{ marginTop: 10, marginBottom: 0 }}>
        Add the Worker secret <span className="mono">WINDSOR_API_KEY</span> to enable live data retrieval. The key stays server-side and is never sent to the browser.
      </div> : <>
        <div className="grid cols-4" style={{ marginTop: 12 }}>
          {[
            ['Google Search', windsor.data.searchConsole.length],
            ['Google Analytics', windsor.data.analytics.length],
            ['Facebook', windsor.data.facebook.length],
            ['Instagram', windsor.data.instagram.length],
            ['YouTube', windsor.data.youtube.length],
            ['LinkedIn', windsor.data.linkedin.length],
          ].map(([name, count]) => <div key={String(name)} className="event"><strong>{name}</strong><div className="stat-value" style={{ fontSize: 20 }}>{String(count)}</div><div className="faint small">rows / last 30d</div></div>)}
        </div>
        {Object.entries(windsor.errors).some(([, v]) => v.startsWith('RATE_LIMITED:')) && <div className="warn-banner" style={{ marginTop: 10, marginBottom: 0 }}>
          One connected source is temporarily rate-limited. Survivor keeps the other sources running and will not aggressively retry the limited source.
        </div>}
        <div className="grid cols-2" style={{ marginTop: 10 }}>
          <div className="event" style={{ display: 'block' }}>
            <strong>Search opportunity signals</strong>
            {windsor.data.searchConsole.slice(0, 5).map((r, i) => <div key={i} className="faint small" style={{ marginTop: 6 }}>{String(r.query ?? 'Search query')} · {String(r.clicks ?? 0)} clicks · {String(r.impressions ?? 0)} impressions · pos {String(r.position ?? '—')}</div>)}
            {windsor.data.searchConsole.length === 0 && <div className="faint small" style={{ marginTop: 6 }}>No Search Console rows returned yet.</div>}
          </div>
          <div className="event" style={{ display: 'block' }}>
            <strong>Traffic / social signals</strong>
            <div className="faint small" style={{ marginTop: 6 }}>GA4 rows: {windsor.data.analytics.length} · Instagram: {windsor.data.instagram.length} · TikTok: {windsor.data.tiktok.length} · YouTube: {windsor.data.youtube.length} · LinkedIn: {windsor.data.linkedin.length}</div>
            {Object.entries(windsor.errors).map(([k, v]) => <div key={k} className="faint small" style={{ marginTop: 5 }}>{k}: {v}</div>)}
          </div>
        </div>
        <div className="faint small" style={{ marginTop: 8 }}>Last sync: {windsor.generatedAt ? new Date(windsor.generatedAt).toLocaleString() : '—'} · Source window: {windsor.datePreset}</div>
      </>}
    </Panel>

    <Panel title="FINIVEX PAYMENTS" right={<Badge tone={finivex?.configured ? 'green' : 'amber'}>{finivex?.configured ? 'CONNECTED' : 'NOT CONFIGURED'}</Badge>}>
      <div className="small muted" style={{ lineHeight: 1.8 }}>
        <strong>Role:</strong> NWT Dev's payment collection rail. Survivor does not hold your wallet or move your money.<br/>
        <strong>Flow:</strong> create approved payment link → customer pays on Finivex → Survivor verifies status → real revenue is recorded.<br/>
        <strong>Methods:</strong> EcoCash, OneMoney, InnBucks, O'mari, Visa, Mastercard, ZIPIT and Zimswitch, subject to your merchant account's active methods.
      </div>
      <div className={finivex?.configured ? 'info-banner' : 'warn-banner'} style={{ marginTop: 12, marginBottom: 0 }}>{finivex?.note ?? 'Backend status unavailable. Configure the Finivex merchant credentials as Worker secrets after merchant approval.'}</div>
      <div className="faint small" style={{ marginTop: 8 }}>No payment is initiated from this panel. Payment-link creation is kept behind the human approval path.</div>
    </Panel>

    <Panel title="CLIENT PAYMENT CONTROL" right={<span className="faint small mono">HUMAN CONTROLLED</span>}>
      {paymentError && <div className="banner banner-error" style={{ marginBottom: 10 }}>{paymentError}</div>}
      <div className="small muted" style={{ lineHeight: 1.7, marginBottom: 12 }}>
        Create a payment request for a real client invoice. Survivor does not require Finivex: choose the payment method the client actually agreed to.
        Finivex is only used when you explicitly approve that request and create its hosted payment link.
      </div>
      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <input placeholder="Client / business" value={paymentForm.clientName} onChange={e => setPaymentForm(v => ({ ...v, clientName: e.target.value }))} />
        <input placeholder="Amount" type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm(v => ({ ...v, amount: e.target.value }))} />
        <input placeholder="What are they paying for?" value={paymentForm.description} onChange={e => setPaymentForm(v => ({ ...v, description: e.target.value }))} />
        <select value={paymentForm.paymentMethod} onChange={e => setPaymentForm(v => ({ ...v, paymentMethod: e.target.value as PaymentRequest['payment_method'] }))}>
          <option value="OTHER">Other</option>
          <option value="FINIVEX">Finivex</option>
          <option value="ECOCASH">EcoCash</option>
          <option value="BANK">Bank</option>
          <option value="CASH">Cash</option>
        </select>
      </div>
      <button className="btn primary" disabled={paymentBusy || !paymentForm.clientName || !paymentForm.amount || !paymentForm.description} onClick={async () => {
        setPaymentBusy(true);
        try {
          await createPaymentRequest({ clientName: paymentForm.clientName, amount: Number(paymentForm.amount), currency: 'USD', description: paymentForm.description, paymentMethod: paymentForm.paymentMethod });
          setPaymentForm(v => ({ ...v, amount: '', description: '' }));
          await refreshPayments();
        } catch (e) { setPaymentError((e as Error).message); }
        finally { setPaymentBusy(false); }
      }}>Create payment request</button>

      <div className="feed" style={{ marginTop: 14, maxHeight: 360, overflowY: 'auto' }}>
        {paymentRequests.length === 0 ? <div className="empty">No client payment requests yet.</div> :
          paymentRequests.map((r) => <div key={r.id} className="event" style={{ display: 'block', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{r.client_name} · {r.amount.toFixed(2)} {r.currency}</strong>
              <Badge tone={r.status === 'PAID' ? 'green' : r.status === 'FAILED' ? 'red' : 'amber'}>{r.status}</Badge>
            </div>
            <div className="muted small" style={{ marginTop: 4 }}>{r.description} · {r.payment_method}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
              {r.status === 'PENDING' && <button className="btn small" disabled={paymentBusy} onClick={async () => { setPaymentBusy(true); try { await approvePaymentRequest(r.id); await refreshPayments(); } catch (e) { setPaymentError((e as Error).message); } finally { setPaymentBusy(false); } }}>Approve</button>}
              {r.status === 'PENDING' && <button className="btn small danger" disabled={paymentBusy} onClick={async () => { setPaymentBusy(true); try { await cancelPaymentRequest(r.id); await refreshPayments(); } catch (e) { setPaymentError((e as Error).message); } finally { setPaymentBusy(false); } }}>Cancel</button>}
              {r.status === 'APPROVED' && r.payment_method === 'FINIVEX' && <button className="btn small primary" disabled={paymentBusy || !finivex?.configured} onClick={async () => { setPaymentBusy(true); try { const result = await createApprovedFinivexLink({ requestId: r.id }); if (result.paymentLink) window.open(result.paymentLink, '_blank', 'noopener,noreferrer'); await refreshPayments(); } catch (e) { setPaymentError((e as Error).message); } finally { setPaymentBusy(false); } }}>{finivex?.configured ? 'Create Finivex link' : 'Finivex not configured'}</button>}
              {r.status === 'APPROVED' && r.payment_method !== 'FINIVEX' && <button className="btn small primary" disabled={paymentBusy} onClick={async () => { setPaymentBusy(true); try { await markPaymentRequestPaid(r.id); await refreshPayments(); } catch (e) { setPaymentError((e as Error).message); } finally { setPaymentBusy(false); } }}>Confirm client paid</button>}
              {r.status === 'LINK_CREATED' && r.payment_link && <><button className="btn small" onClick={() => window.open(r.payment_link!, '_blank', 'noopener,noreferrer')}>Open payment link</button><button className="btn small" onClick={() => navigator.clipboard?.writeText(r.payment_link!)}>Copy link</button></>}
            </div>
          </div>)}
      </div>
      <div className="faint small" style={{ marginTop: 8 }}>For Finivex, Survivor marks the request paid only after the server verifies the provider status. A client payment never gives Survivor control of the funds.</div>
    </Panel>

    <Panel title="INCOME STRATEGY BRAIN" right={<button className="btn small" disabled={!backendConnected || strategyBusy} onClick={() => void refreshStrategy()}>{strategyBusy ? 'Researching…' : 'Run strategy research'}</button>}>
      <div className="small muted" style={{ lineHeight: 1.7 }}>
        Survivor now evaluates services, WhatsApp bots, websites, automation, content, freelancing, digital products, tutoring, referrals and a separate forex research lane. It chooses experiments from evidence; it does not automatically publish, contact, trade or spend.
      </div>
      {strategy && <div className="grid cols-2" style={{ marginTop: 12 }}>
        {strategy.strategies.map((s) => <div key={s.kind} className="event" style={{ display:'block' }}>
          <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}><strong>{s.name}</strong><Badge tone={s.risk === 'VERY_HIGH' ? 'red' : s.lifecycle === 'PROVEN' ? 'green' : 'blue'}>{s.lifecycle}</Badge></div>
          <div className="faint small" style={{ marginTop:5 }}>{s.category} · risk {s.risk} · test cost {s.testCost} · evidence {s.searchResultCount} result(s)</div>
          <div className="muted small" style={{ marginTop:6 }}>{s.nextExperiment}</div>
        </div>)}
      </div>}
      {strategy && (() => {
        const plans = strategy.channelPlans ?? [];
        return plans.length > 0 && <Panel title="EXECUTION PLANS" style={{ marginTop: 12 }}>
        <div className="grid cols-2">
          {plans.map((item) => <div key={item.kind} className="event" style={{ display:'block' }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}><strong>{strategy.strategies.find((s) => s.kind === item.kind)?.name ?? item.kind}</strong><Badge tone={item.decision.lifecycle === 'PROVEN' ? 'green' : item.kind === 'TRADING_RESEARCH' ? 'red' : 'blue'}>{item.decision.lifecycle}</Badge></div>
            <div className="muted small" style={{ marginTop:6 }}>{item.plan.objective}</div>
            <div className="faint small" style={{ marginTop:6 }}><strong>Steps:</strong> {item.plan.steps.join(' → ')}</div>
            <div className="faint small" style={{ marginTop:6 }}><strong>Human:</strong> {item.plan.humanActions.join(' · ')}</div>
            <div className="faint small" style={{ marginTop:6 }}><strong>Success:</strong> {item.plan.successMetrics.join(' · ')}</div>
            <div className="faint small" style={{ marginTop:6 }}><strong>Stop:</strong> {item.plan.stopConditions.join(' · ')}</div>
            <div className="faint small mono" style={{ marginTop:6 }}>Observed: {item.plan.currentEvidence.realSales} sale(s) · {item.plan.currentEvidence.realRevenue.toFixed(2)} USD · data {item.plan.currentEvidence.dataQuality}</div>
          </div>)}
        </div>
      </Panel>}

      {strategy?.forex && <div className="event" style={{ display:'block', marginTop:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}><strong>Forex research: {strategy.forex.target}</strong><Badge tone={strategy.forex.status === 'FOUND' ? 'blue' : 'amber'}>{strategy.forex.status}</Badge></div>
        <div className="muted small" style={{ marginTop:6 }}>{strategy.forex.verificationNotes[0]}</div>
        <div className="faint small" style={{ marginTop:6 }}>{strategy.forex.nextStep}</div>
        {strategy.forex.findings.slice(0,5).map((f,i) => <div key={i} className="faint small" style={{ marginTop:5 }}><strong>{f.title}</strong> · {f.sourceType} · <a href={f.sourceUrl} target="_blank" rel="noreferrer">source ↗</a></div>)}
      </div>}
    </Panel>

    {strategy && selectedPlanKind && (() => {
      const selected = strategy.channelPlans.find((p) => p.kind === selectedPlanKind);
      if (!selected) return null;
      const strategyMeta = strategy.strategies.find((s) => s.kind === selectedPlanKind);
      return <Panel title={`CHANNEL EXECUTION PLAN — ${strategyMeta?.name ?? selectedPlanKind}`} style={{ marginTop: 14 }}>
        <div className="info-banner"><strong>Objective:</strong> {selected.plan.objective}</div>
        <div className="grid cols-2" style={{ marginTop: 10 }}>
          <div className="event" style={{ display: 'block' }}><strong>Execution steps</strong>{selected.plan.steps.map((step, i) => <div key={step} className="faint small" style={{ marginTop: 7 }}>{i + 1}. {step}</div>)}</div>
          <div className="event" style={{ display: 'block' }}><strong>What you must do</strong>{selected.plan.humanActions.map((action) => <div key={action} className="faint small" style={{ marginTop: 7 }}>• {action}</div>)}</div>
        </div>
        <div className="grid cols-3" style={{ marginTop: 10 }}>
          <div className="event"><strong>Real sales</strong><div className="stat-value" style={{ fontSize: 20 }}>{selected.decision.realSales}</div></div>
          <div className="event"><strong>Real revenue</strong><div className="stat-value" style={{ fontSize: 20 }}>{selected.decision.realRevenue.toFixed(2)}</div></div>
          <div className="event"><strong>Data quality</strong><div className="stat-value" style={{ fontSize: 20 }}>{selected.plan.currentEvidence.dataQuality}</div></div>
        </div>
        <div className="grid cols-2" style={{ marginTop: 10 }}>
          <div className="event" style={{ display: 'block' }}><strong>Evidence required</strong>{selected.plan.evidenceToCollect.map((x) => <div key={x} className="faint small" style={{ marginTop: 6 }}>• {x}</div>)}</div>
          <div className="event" style={{ display: 'block' }}><strong>Stop conditions</strong>{selected.plan.stopConditions.map((x) => <div key={x} className="faint small" style={{ marginTop: 6 }}>• {x}</div>)}</div>
        </div>
        <div className="faint small" style={{ marginTop: 10 }}>Success is measured from observed customer responses, actual payments, delivery cost and time-to-payment — not forecasts.</div>
      </Panel>;
    })()}

    <Panel title="INCOME CHANNELS" right={<span className="faint small mono">{backendConnected ? 'LIVE EVIDENCE READY' : 'BACKEND REQUIRED'}</span>}>
      <div className="grid cols-2">{CHANNELS.map(([id, icon, name, desc, status, next, kind]) => {
        const decision = strategy?.strategies.find((s) => s.kind === kind);
        const decisionTone = decision?.lifecycle === 'PROVEN' ? 'green' : decision?.lifecycle === 'TESTING' ? 'blue' : decision?.lifecycle === 'FAILED' ? 'red' : 'amber';
        return <div key={id} className="opp-card" style={{ cursor: 'default' }}>
          <div className="opp-head">
            <div><div style={{ fontSize: 14, fontWeight: 700 }}>{icon} {name}</div><div className="faint small" style={{ marginTop: 6, lineHeight: 1.5 }}>{desc}</div></div>
            <Badge tone={decision ? decisionTone : tone(status)}>{decision?.lifecycle ?? status}</Badge>
          </div>
          <div className="opp-foot" style={{ display: 'block' }}>
            {decision ? <>
              <div className="faint small">Evidence: {decision.searchResultCount} result(s) · real sales: {decision.decision.realSales} · revenue: {decision.decision.realRevenue.toFixed(2)}</div>
              <div className="muted small" style={{ marginTop: 6 }}>Next: {decision.decision.nextExperiment}</div>
              <div className="faint small" style={{ marginTop: 6 }}>{decision.decision.reasons[0]}</div>
              {decision.kind === 'TRADING_RESEARCH' && <div className="warn-banner" style={{ marginTop: 8, marginBottom: 0 }}>Research / paper trading only. Survivor cannot place live trades.</div>}
            </> : <div className="faint small" style={{ marginBottom: 8 }}>Next: {next}</div>}
            <button className="btn small primary" style={{ marginTop: 9 }} disabled={!backendConnected || strategyBusy} onClick={() => void runChannelStrategy(kind)}>{strategyBusy ? 'Researching…' : decision ? 'Refresh evidence' : 'Research this channel'}</button>
          </div>
        </div>;
      })}</div>
    </Panel>

    <div className="grid cols-2" style={{ marginTop: 14 }}>
      <Panel title="MONEY ACTIONS — WHAT YOU ACTUALLY DO">
        {topActions.length === 0 ? <div className="empty">No human money action is currently ready. Survivor needs live opportunities and evidence before recommending one.</div> :
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{topActions.map((a, i) =>
            <div key={a.id} className="event" style={{ display: 'block' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><strong>#{i + 1} {a.title}</strong><span className="num">{Number(a.expectedValue ?? 0).toFixed(0)} EV</span></div><div className="muted small" style={{ marginTop: 4 }}>{a.description}</div></div>
          )}</div>}
      </Panel>
      <Panel title="GETTING PAID">
        <div className="small muted" style={{ lineHeight: 1.9 }}><strong>1. Approve</strong> the opportunity and offer.<br/><strong>2. Request payment</strong> using the agreed invoice/payment method.<br/><strong>3. Confirm</strong> the real payment yourself or through a supported read-only payment status integration.<br/><strong>4. Record revenue</strong> in Survivor with amount, currency, costs and channel.<br/><strong>5. Learn</strong> — the result feeds future pricing, channel and opportunity decisions.</div>
        <div className="warn-banner" style={{ marginTop: 12, marginBottom: 0 }}>Survivor does not autonomously transfer, withdraw or spend your real money. Payment execution remains under your control.</div>
      </Panel>
    </div>

    <Panel title="CONNECTED ACCOUNT ROADMAP" style={{ marginTop: 14 }}>
      <div className="grid cols-3">{[
        ['Facebook / Instagram', Boolean(windsor?.data.facebook.length || windsor?.data.instagram.length)],
        ['TikTok', Boolean(windsor?.data.tiktok.length)],
        ['YouTube', Boolean(windsor?.data.youtube.length)],
        ['LinkedIn', Boolean(windsor?.data.linkedin.length)],
        ['Freelance platforms', false],
        ['Analytics / Search', Boolean(windsor?.data.analytics.length || windsor?.data.searchConsole.length)],
      ].map(([name, connected]) =>
        <div key={String(name)} className="event" style={{ display: 'block' }}><div style={{ fontWeight: 600 }}>{String(name)}</div><div className="faint small" style={{ marginTop: 4 }}>Live data → opportunity detection → human approval before publishing or submitting.</div><Badge tone={connected ? 'green' : 'gray'}>{connected ? 'LIVE DATA' : 'NOT CONNECTED'}</Badge></div>
      )}</div>
      <div className="faint small" style={{ marginTop: 10 }}>Survivor only marks a provider live when its backend successfully receives data. If LinkedIn is rate-limited or unavailable, the other connected sources continue syncing independently. Write actions remain outside the automatic research path.</div>
    </Panel>

    <Panel title="REVENUE BY RECORDED ACQUISITION CHANNEL" style={{ marginTop: 14 }}>
      {channelRevenue.size === 0 ? <div className="empty">No real revenue has been recorded yet. This is intentionally blank rather than showing simulated earnings.</div> :
        <table className="data"><thead><tr><th>Channel</th><th>Revenue received</th></tr></thead><tbody>{[...channelRevenue.entries()].sort((a,b) => b[1]-a[1]).map(([channel, amount]) => <tr key={channel}><td>{channel}</td><td className="num">{amount.toFixed(2)} USD</td></tr>)}</tbody></table>}
    </Panel>
    <div className="faint small mono" style={{ marginTop: 12 }}>Active delivery projects: {money.activeProjects} · Recorded costs: {money.costs.toFixed(2)} USD · Real revenue entries: {realRevenue.length}</div>
  </div>;
}
