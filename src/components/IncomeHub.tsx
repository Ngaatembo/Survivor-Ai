import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { fetchFinivexStatus } from '../services/backendApi';
import { Panel, Badge } from './ui';

const CHANNELS = [
  ['nwt-dev','◆','NWT Dev clients','Verified businesses, offers, outreach, delivery and recurring maintenance.','ACTIVE','Review the highest-value verified prospect.'],
  ['content','◉','Content & social','Content performance, lead generation, platform monetization and sponsorship opportunities.','BUILDING','Connect read-only analytics before Survivor evaluates content revenue.'],
  ['freelance','↗','Freelancing / remote work','Find legitimate projects that match your skills, prepare applications and track outcomes.','BUILDING','Add supported opportunity sources and application tracking.'],
  ['products','▤','Digital products','Identify reusable products you can build once and sell repeatedly.','BUILDING','Turn repeated client problems into product opportunities.'],
  ['affiliate','⌁','Affiliate / referral','Research legitimate programs and match them to relevant audiences or client workflows.','BUILDING','Research programs only where evidence of fit and payout exists.'],
  ['other','＋','Other opportunities','A catch-all for new legitimate income channels Survivor discovers.','BUILDING','Let the opportunity engine classify new opportunities by channel.'],
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
  useEffect(() => { if (backendConnected) void fetchFinivexStatus().then((r) => setFinivex(r.payment)).catch(() => setFinivex(null)); }, [backendConnected]);

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


    <Panel title="FINIVEX PAYMENTS" right={<Badge tone={finivex?.configured ? 'green' : 'amber'}>{finivex?.configured ? 'CONNECTED' : 'NOT CONFIGURED'}</Badge>}>
      <div className="small muted" style={{ lineHeight: 1.8 }}>
        <strong>Role:</strong> NWT Dev's payment collection rail. Survivor does not hold your wallet or move your money.<br/>
        <strong>Flow:</strong> create approved payment link → customer pays on Finivex → Survivor verifies status → real revenue is recorded.<br/>
        <strong>Methods:</strong> EcoCash, OneMoney, InnBucks, O'mari, Visa, Mastercard, ZIPIT and Zimswitch, subject to your merchant account's active methods.
      </div>
      <div className={finivex?.configured ? 'info-banner' : 'warn-banner'} style={{ marginTop: 12, marginBottom: 0 }}>{finivex?.note ?? 'Backend status unavailable. Configure the Finivex merchant credentials as Worker secrets after merchant approval.'}</div>
      <div className="faint small" style={{ marginTop: 8 }}>No payment is initiated from this panel. Payment-link creation is kept behind the human approval path.</div>
    </Panel>

    <Panel title="INCOME CHANNELS" right={<span className="faint small mono">{backendConnected ? 'LIVE DATA' : 'BACKEND REQUIRED'}</span>}>
      <div className="grid cols-2">{CHANNELS.map(([id, icon, name, desc, status, next]) =>
        <div key={id} className="opp-card" style={{ cursor: 'default' }}>
          <div className="opp-head"><div><div style={{ fontSize: 14, fontWeight: 700 }}>{icon} {name}</div><div className="faint small" style={{ marginTop: 6, lineHeight: 1.5 }}>{desc}</div></div><Badge tone={tone(status)}>{status}</Badge></div>
          <div className="opp-foot"><span className="faint small">Next: {next}</span></div>
        </div>
      )}</div>
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
      <div className="grid cols-3">{['Facebook / Instagram','TikTok','YouTube','LinkedIn','Freelance platforms','Analytics / storefronts'].map((name) =>
        <div key={name} className="event" style={{ display: 'block' }}><div style={{ fontWeight: 600 }}>{name}</div><div className="faint small" style={{ marginTop: 4 }}>Read-only analytics → opportunity detection → human approval before publishing or submitting.</div><Badge tone="gray">NOT CONNECTED</Badge></div>
      )}</div>
      <div className="faint small" style={{ marginTop: 10 }}>Connection work will be added one provider at a time. Survivor will never claim an account is connected until the integration actually returns data.</div>
    </Panel>

    <Panel title="REVENUE BY RECORDED ACQUISITION CHANNEL" style={{ marginTop: 14 }}>
      {channelRevenue.size === 0 ? <div className="empty">No real revenue has been recorded yet. This is intentionally blank rather than showing simulated earnings.</div> :
        <table className="data"><thead><tr><th>Channel</th><th>Revenue received</th></tr></thead><tbody>{[...channelRevenue.entries()].sort((a,b) => b[1]-a[1]).map(([channel, amount]) => <tr key={channel}><td>{channel}</td><td className="num">{amount.toFixed(2)} USD</td></tr>)}</tbody></table>}
    </Panel>
    <div className="faint small mono" style={{ marginTop: 12 }}>Active delivery projects: {money.activeProjects} · Recorded costs: {money.costs.toFixed(2)} USD · Real revenue entries: {realRevenue.length}</div>
  </div>;
}
