/* ============================================================================
 * FRONTEND 2.0 — human-facing Command Center (Stage 1).
 * Presentation only. Every number is read from the existing store (which is
 * fed by GET /state); nothing is recomputed, ranked or invented here. The
 * action ranking is the backend's (economicEfficiency.humanActionQueue).
 * Write buttons reuse the existing store actions (POST /prospects/status,
 * POST /offers/status). Nothing is ever sent to a prospect from here.
 * ========================================================================== */
import { useState } from 'react';
import { useStore, useWalletTotals, backendConfigured } from '../store';
import { demoUrl } from '../services/backendApi';
import { usd, usdWhole, timeAgo } from '../lib/format';
import type { RecommendedAction } from '../types';
import type { View } from '../App';
import { DataStateBadge, type DataState } from './ui2';

const DAY = 24 * 60 * 60 * 1000;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const urgencyLabel = (n: number) => (n >= 4 ? 'High' : n === 3 ? 'Medium' : 'Low');
const effortLabel = (n: number) => (n <= 2 ? 'Low' : n === 3 ? 'Medium' : 'High');

function useLiveState(): DataState {
  const connected = useStore((s) => s.backend.connected);
  if (!backendConfigured) return 'SAMPLE';
  return connected ? 'LIVE' : 'UNAVAILABLE';
}

/** What has already been prepared for a prospect (all read from store). */
function usePrepared() {
  const intel = useStore((s) => s.prospectIntelligence);
  const offers = useStore((s) => s.offers);
  const demos = useStore((s) => s.prospectDemos);
  const msgs = useStore((s) => s.outreachMessages);
  return (prospectId?: string) => {
    if (!prospectId) return null;
    return {
      research: intel.some((i) => i.prospectId === prospectId),
      offer: offers.find((o) => o.prospectId === prospectId),
      demo: demos.some((d) => d.prospectId === prospectId),
      outreach: msgs.find((m) => m.prospectId === prospectId),
    };
  };
}

function Prepared({ prospectId }: { prospectId?: string }) {
  const prep = usePrepared()(prospectId);
  if (!prep) return null;
  const items: [string, boolean][] = [
    ['Research', prep.research],
    ['Offer', !!prep.offer],
    ['Demo', prep.demo],
    ['Outreach draft', !!prep.outreach],
  ];
  return (
    <div className="prep" aria-label="What is already prepared">
      {items.map(([label, ok]) => (
        <span key={label} className={ok ? 'ok' : 'no'}>
          {ok ? '✓' : '–'} {label}
        </span>
      ))}
    </div>
  );
}

function ActionButtons({ a, go, compact }: { a: RecommendedAction; go: (v: View) => void; compact?: boolean }) {
  const prospects = useStore((s) => s.prospects);
  const updateProspectStatus = useStore((s) => s.updateProspectStatus);
  const updateOfferStatus = useStore((s) => s.updateOfferStatus);
  const prep = usePrepared()(a.prospectId);
  const [confirm, setConfirm] = useState<null | 'contacted' | 'sent'>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const prospect = a.prospectId ? prospects.find((p) => p.id === a.prospectId) : undefined;
  const canMarkContacted = !compact && !!prospect && (prospect.status === 'DISCOVERED' || prospect.status === 'QUALIFIED');
  const canMarkSent = !compact && !!prep?.offer && prep.offer.status === 'DRAFT';

  // Safe navigation only: the prospect drawer lives inside the Prospects view.
  const target: View = a.prospectId ? 'prospects' : a.kind === 'ADVANCE_PROJECT' ? 'projects' : 'explorer';
  const openLabel = a.prospectId ? 'Open prospects' : a.kind === 'ADVANCE_PROJECT' ? 'Open delivery' : 'Open opportunities';

  const copyMessage = async () => {
    if (!prep?.outreach) return;
    try {
      await navigator.clipboard.writeText(prep.outreach.whatsapp);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — leave the button as is */
    }
  };

  const doConfirm = async () => {
    setBusy(true);
    try {
      if (confirm === 'contacted' && prospect) await updateProspectStatus(prospect.id, 'CONTACTED');
      if (confirm === 'sent' && prep?.offer) await updateOfferStatus(prep.offer.id, 'SENT');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (confirm) {
    return (
      <div className="confirm-row">
        <span>
          {confirm === 'contacted' ? `Mark ${prospect?.businessName ?? 'this prospect'} as contacted?` : 'Mark this offer as sent?'}{' '}
          This only updates your records. Nothing is sent for you.
        </span>
        <div className="act-row">
          <button className="btn primary big" disabled={busy} onClick={doConfirm}>
            {busy ? 'Saving…' : 'Yes, confirm'}
          </button>
          <button className="btn big" disabled={busy} onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="act-row">
      <button className="btn big" onClick={() => go(target)}>
        {openLabel}
      </button>
      {prep?.demo && backendConfigured && a.prospectId && (
        <a className="btn big" href={demoUrl(a.prospectId)} target="_blank" rel="noopener noreferrer">
          View demo
        </a>
      )}
      {prep?.outreach && (
        <button className="btn big" onClick={copyMessage}>
          {copied ? 'Copied' : 'Copy message'}
        </button>
      )}
      {canMarkContacted && (
        <button className="btn primary big" onClick={() => setConfirm('contacted')}>
          Mark contacted
        </button>
      )}
      {canMarkSent && (
        <button className="btn primary big" onClick={() => setConfirm('sent')}>
          Mark offer sent
        </button>
      )}
    </div>
  );
}

function NextMoneyAction({ go }: { go: (v: View) => void }) {
  const q = useStore((s) => s.economicEfficiency?.humanActionQueue);
  const a = q?.topAction ?? null;
  const live = useLiveState();

  if (!q) {
    return (
      <section className="money-card muted-card">
        <div className="card-head">
          <h2>Next money action</h2>
          <DataStateBadge state="UNAVAILABLE" />
        </div>
        <p className="muted">
          The action queue is calculated by the live backend. It will appear here after the next sync — nothing is shown in
          its place until then.
        </p>
      </section>
    );
  }
  if (!a) {
    return (
      <section className="money-card muted-card">
        <div className="card-head">
          <h2>Next money action</h2>
          <DataStateBadge state={live} />
        </div>
        <p className="muted">Nothing needs you right now. Survivor will surface the next action when there is one.</p>
      </section>
    );
  }

  const who = a.prospectName ?? a.opportunityName;
  return (
    <section className="money-card">
      <div className="card-head">
        <h2>Next money action</h2>
        <DataStateBadge state={live} />
      </div>
      <div className="money-main">
        <div>
          <div className="money-title">{a.title}</div>
          {who && <div className="muted">{who}</div>}
        </div>
        <div className="money-value" title="Modeled expected value, not a promise of revenue">
          {usd(a.expectedValue)}
          <small>expected value</small>
        </div>
      </div>
      <p className="money-why">{a.description}</p>
      <div className="money-meta">
        <span>
          <small>Urgency</small> {urgencyLabel(a.urgency)}
        </span>
        <span>
          <small>Effort</small> {effortLabel(a.effort)}
        </span>
      </div>
      <Prepared prospectId={a.prospectId} />
      <ActionButtons a={a} go={go} />
    </section>
  );
}

function ActionCards({ go }: { go: (v: View) => void }) {
  const q = useStore((s) => s.economicEfficiency?.humanActionQueue);
  if (!q) return null;
  // Order is the backend's ranking; we only drop the one already shown above.
  const rest = q.queue.filter((x) => x.id !== q.topAction?.id).slice(0, 5);
  if (rest.length === 0) return null;
  return (
    <section className="block">
      <div className="card-head">
        <h2>Also waiting for you</h2>
        <span className="faint small">ranked by the backend</span>
      </div>
      <div className="action-list">
        {rest.map((a) => (
          <div key={a.id} className="action-card">
            <div className="action-top">
              <span className="rank">#{a.rank}</span>
              <div className="action-title">{a.title}</div>
              <div className="action-ev">{usd(a.expectedValue)}</div>
            </div>
            <div className="muted small clamp">{a.description}</div>
            <div className="money-meta small">
              <span>
                <small>Urgency</small> {urgencyLabel(a.urgency)}
              </span>
              <span>
                <small>Effort</small> {effortLabel(a.effort)}
              </span>
            </div>
            <Prepared prospectId={a.prospectId} />
            <ActionButtons a={a} go={go} compact />
          </div>
        ))}
      </div>
    </section>
  );
}

function SinceAway() {
  const cycles = useStore((s) => s.cycles);
  const prospects = useStore((s) => s.prospects);
  const offers = useStore((s) => s.offers);
  const ee = useStore((s) => s.economicEfficiency);
  const live = useLiveState();

  const cutoff = Date.now() - DAY;
  const recent = cycles.filter((c) => (c.completedAt ?? 0) > cutoff);
  const discovered = recent.reduce((n, c) => n + c.discoveredIds.length, 0);
  const updated = prospects.filter((p) => p.updatedAt > cutoff).length;
  const drafted = offers.filter((o) => o.generatedAt > cutoff).length;

  const lines: string[] = [];
  if (recent.length) lines.push(`Completed ${plural(recent.length, 'autonomous cycle')}`);
  if (discovered) lines.push(`Discovered ${plural(discovered, 'opportunity record')}`);
  if (updated) lines.push(`Updated ${plural(updated, 'prospect record')}`);
  if (drafted) lines.push(`Drafted ${plural(drafted, 'offer')}`);
  if (ee) {
    const s = ee.searchEconomy;
    lines.push(`Search: ${plural(s.searchesToday, 'call')} today, ${s.cacheHitsToday} answered from cache`);
    if (ee.humanActionQueue.followUpsDue) lines.push(`${plural(ee.humanActionQueue.followUpsDue, 'follow-up')} due`);
  }

  return (
    <section className="block">
      <div className="card-head">
        <h2>Last 24 hours</h2>
        <DataStateBadge state={live} />
      </div>
      {lines.length === 0 ? (
        <p className="muted">No new activity recorded in the last 24 hours.</p>
      ) : (
        <ul className="away-list">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Pulse({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="pulse-item">
      <div className="pulse-value">{value}</div>
      <div className="pulse-label">{label}</div>
      {sub && <div className="faint small">{sub}</div>}
    </div>
  );
}

function BusinessPulse() {
  const opportunities = useStore((s) => s.opportunities);
  const prospects = useStore((s) => s.prospects);
  const offers = useStore((s) => s.offers);
  const experiments = useStore((s) => s.experiments);
  const ee = useStore((s) => s.economicEfficiency);
  const { profit } = useWalletTotals();
  const live = useLiveState();

  const discovered = opportunities.filter((o) => o.researchStage !== 'UNDISCOVERED').length;
  const qualified = prospects.filter((p) => p.status === 'QUALIFIED').length;
  const sent = offers.filter((o) => o.status !== 'DRAFT').length;
  const paid = ee?.revenueFunnel.paidRevenueTotal;

  return (
    <section className="block">
      <div className="card-head">
        <h2>Business pulse</h2>
      </div>

      <div className="pulse-group">
        <div className="pulse-group-head">
          <span>Real pipeline and customer revenue</span>
          <DataStateBadge state={live} />
        </div>
        <div className="pulse-grid">
          <Pulse label="Opportunities" value={discovered} />
          <Pulse label="Prospects" value={prospects.length} />
          <Pulse label="Qualified" value={qualified} />
          <Pulse label="Offers" value={offers.length} sub={`${sent} sent`} />
          <Pulse label="Customer revenue" value={paid === undefined ? '—' : usdWhole(paid)} sub="recorded payments only" />
        </div>
      </div>

      <div className="pulse-group sim">
        <div className="pulse-group-head">
          <span>Simulated economic experiments</span>
          <DataStateBadge state="SIMULATED" />
        </div>
        <div className="pulse-grid">
          <Pulse label="Experiments" value={experiments.length} />
          <Pulse label="Simulated profit / loss" value={usd(profit)} sub="practice money, not customer revenue" />
        </div>
      </div>
    </section>
  );
}

function Header() {
  const backend = useStore((s) => s.backend);
  const agent = useStore((s) => s.agent);
  const cycles = useStore((s) => s.cycles);
  const ee = useStore((s) => s.economicEfficiency);
  const q = ee?.humanActionQueue;

  const lastCycle = cycles.reduce((t, c) => Math.max(t, c.completedAt ?? 0), 0);
  const cutoff = Date.now() - DAY;
  const recent = cycles.filter((c) => (c.completedAt ?? 0) > cutoff);
  const discovered = recent.reduce((n, c) => n + c.discoveredIds.length, 0);
  const attention = q ? q.offersAwaitingSend + q.followUpsDue + q.prospectsNeedingStatusUpdate + q.wonWithoutRecordedPayment : null;

  let status: string;
  if (!backendConfigured) status = '◇ Demo mode — sample data kept in this browser';
  else if (backend.connected) status = `● Connected to the live backend${backend.lastSyncedAt ? ` · synced ${timeAgo(backend.lastSyncedAt)}` : ''}`;
  else if (backend.error) status = '⚠ Backend unreachable — showing the last data received';
  else status = '… Connecting to the backend';

  return (
    <header className="home-head">
      <h1 className="home-title">Survive AI</h1>
      <div className="home-sub">Economic intelligence and action center</div>
      <div className="home-status">
        <span>{status}</span>
        <span>Survival status: {agent.status.replace('_', ' ').toLowerCase()}</span>
        <span>{lastCycle ? `Last cycle ${timeAgo(lastCycle)}` : 'No completed cycle recorded yet'}</span>
      </div>
      <p className="home-summary">
        In the last 24 hours Survivor completed {plural(recent.length, 'cycle')} and discovered{' '}
        {plural(discovered, 'opportunity record')}.
        {attention !== null && ` ${attention === 0 ? 'Nothing is waiting on you.' : `${plural(attention, 'prospect item')} need you.`}`}
      </p>
    </header>
  );
}

export function HumanHome({ go }: { go: (v: View) => void }) {
  return (
    <div className="human-home">
      <Header />
      <NextMoneyAction go={go} />
      <ActionCards go={go} />
      <SinceAway />
      <BusinessPulse />
    </div>
  );
}
