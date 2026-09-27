/* ============================================================================
 * Clients — the one screen for getting paying clients.
 * ----------------------------------------------------------------------------
 * Survivor finds businesses and writes the message; the operator sends it
 * from their own WhatsApp and records what happened. Every button here does
 * a real thing against the live backend (no decorative controls):
 *   Unlock        → /auth/login (8-hour session remembered on this phone)
 *   Find clients  → /prospects/discover (live web search, saves leads)
 *   WhatsApp      → wa.me link with the drafted message (you press send)
 *   Status buttons→ /prospects/status (CRM record)
 * ========================================================================== */

import { useEffect, useMemo, useState } from 'react';
import { useStore, backendConfigured } from '../store';
import {
  BackendError,
  discoverProspectsNow,
  getOperatorSession,
  loginOperatorWithSecret,
  logoutOperator,
  onOperatorSessionChange,
  updateProspectStatus,
} from '../services/backendApi';
import { CATEGORY_SEEDS, TARGET_TOWNS } from '../services/prospectDiscovery';
import {
  callLink,
  displayName,
  firstMessage,
  followUpMessage,
  priceDetailsMessage,
  prospectPageUrl,
  prospectPhone,
  prospectPrice,
  whatsappLink,
} from '../lib/whatsappOutreach';
import { CHECKED_ON, MARKET_SOURCES } from '../lib/zimWebsitePricing';
import type { Prospect, ProspectStatus } from '../types';
import type { View } from '../App';

/* ------------------------------ session hook ------------------------------ */

export function useOperatorSession() {
  const [session, setSession] = useState(getOperatorSession());
  useEffect(() => onOperatorSessionChange(() => setSession(getOperatorSession())), []);
  return session;
}

function errorText(e: unknown): string {
  return e instanceof BackendError ? e.message : (e as Error)?.message || 'Something went wrong.';
}

/* ------------------------------- unlock box ------------------------------- */

export function UnlockForm({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await loginOperatorWithSecret(secret);
      setSecret('');
      onDone?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="cl-unlock-form" onSubmit={submit}>
      {!compact && <label htmlFor="op-secret">Operator secret</label>}
      <div className="cl-row">
        <input
          id="op-secret"
          className="cl-input"
          type="password"
          autoComplete="current-password"
          placeholder="Your TRIGGER_SECRET"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <button className="btn primary big" type="submit" disabled={busy || !secret.trim()}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </div>
      {error && <div className="cl-error" role="alert">{error}</div>}
    </form>
  );
}

function SessionBar() {
  const session = useOperatorSession();
  if (!backendConfigured) return null;
  if (session) {
    const until = new Date(session.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return (
      <div className="cl-session ok">
        <span>🔓 Unlocked on this phone until {until}</span>
        <button className="link-btn" onClick={logoutOperator}>Lock</button>
      </div>
    );
  }
  return (
    <section className="cl-card cl-locked">
      <h2>Unlock to use the buttons</h2>
      <p className="muted">
        Finding clients and recording contacts change real data, so they need your operator secret once. This phone stays
        unlocked for 8 hours.
      </p>
      <UnlockForm />
    </section>
  );
}

/* ----------------------------- find new clients ---------------------------- */

function FindClients() {
  const syncFromBackend = useStore((s) => s.syncFromBackend);
  const [town, setTown] = useState<string>(TARGET_TOWNS[0]);
  const [kind, setKind] = useState<string>(CATEGORY_SEEDS[0].label);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    const seed = CATEGORY_SEEDS.find((c) => c.label === kind);
    const searchQuery = kind === '__custom' ? custom.trim() : seed?.terms;
    if (!searchQuery) {
      setBusy(false);
      setResult({ tone: 'warn', text: 'Type what kind of business to look for.' });
      return;
    }
    try {
      const r = await discoverProspectsNow({ region: `${town}, Zimbabwe`, searchQuery });
      await syncFromBackend();
      const saved = r.saved ?? r.prospects.length;
      if (saved > 0) {
        setResult({ tone: 'ok', text: `Found ${saved} new business${saved === 1 ? '' : 'es'} in ${town}. They're in your “To contact” list above.` });
      } else if (r.budgetExceeded) {
        setResult({ tone: 'warn', text: "Today's search allowance is used up. Survivor keeps searching automatically; try again tomorrow." });
      } else {
        setResult({
          tone: 'warn',
          text: `No new businesses without a website this time (${r.discovered} checked${r.rejectedNotABusiness ? `, ${r.rejectedNotABusiness} were articles/directories or already have a site` : ''}). Try another town or business type.`,
        });
      }
    } catch (e) {
      setResult({ tone: 'err', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cl-card">
      <h2>Find new clients</h2>
      <p className="muted">Searches the live web for real businesses with only a Facebook page or WhatsApp — no website.</p>
      <div className="cl-find">
        <label>
          <span>Town</span>
          <select className="cl-input" value={town} onChange={(e) => setTown(e.target.value)}>
            {TARGET_TOWNS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Business type</span>
          <select className="cl-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {CATEGORY_SEEDS.map((c) => (
              <option key={c.label} value={c.label}>{c.label.replace(/\s*\((food)\)/, '')}</option>
            ))}
            <option value="__custom">Something else…</option>
          </select>
        </label>
        {kind === '__custom' && (
          <label className="cl-span">
            <span>What to look for</span>
            <input className="cl-input" placeholder="e.g. car wash, butchery, pre-school" value={custom} onChange={(e) => setCustom(e.target.value)} />
          </label>
        )}
        <button className="btn primary big cl-span" disabled={busy || !backendConfigured} onClick={() => void run()}>
          {busy ? 'Searching the web… (up to a minute)' : '🔎 Find clients'}
        </button>
      </div>
      {result && <div className={`cl-result ${result.tone}`} role="status">{result.text}</div>}
    </section>
  );
}

/* --------------------------------- leads ---------------------------------- */

type Tab = 'todo' | 'followup' | 'talking' | 'won' | 'closed';

const TAB_LABEL: Record<Tab, string> = {
  todo: 'To contact',
  followup: 'Follow up',
  talking: 'Talking',
  won: 'Won',
  closed: 'Closed',
};

function tabFor(p: Prospect): Tab | null {
  if (p.priority === 'DO_NOT_CONTACT' || p.websitePresence === 'ADEQUATE') return null;
  switch (p.status) {
    case 'DISCOVERED':
    case 'QUALIFIED':
      return 'todo';
    case 'CONTACTED':
    case 'FOLLOW_UP':
      return 'followup';
    case 'REPLIED':
    case 'INTERESTED':
    case 'PROPOSAL_SENT':
    case 'NEGOTIATING':
      return 'talking';
    case 'WON':
      return 'won';
    default:
      return 'closed';
  }
}

const PRIORITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, DO_NOT_CONTACT: 3 };

function StatusButtons({ p, onChange }: { p: Prospect; onChange: (s: ProspectStatus, reason?: string) => Promise<void> }) {
  const [busy, setBusy] = useState<ProspectStatus | null>(null);
  const act = (s: ProspectStatus, reason?: string) => async () => {
    setBusy(s);
    try { await onChange(s, reason); } finally { setBusy(null); }
  };
  const b = (s: ProspectStatus, label: string, primary = false, reason?: string) => (
    <button key={s} className={`btn big${primary ? ' primary' : ''}`} disabled={busy !== null} onClick={act(s, reason)}>
      {busy === s ? 'Saving…' : label}
    </button>
  );
  switch (p.status) {
    case 'DISCOVERED':
    case 'QUALIFIED':
      return <div className="cl-status">{b('CONTACTED', '✓ I sent it', true)}{b('NOT_INTERESTED', 'Skip lead', false, 'Skipped by operator')}</div>;
    case 'CONTACTED':
    case 'FOLLOW_UP':
      return <div className="cl-status">{b('REPLIED', '💬 They replied', true)}{b('FOLLOW_UP', '↻ Sent follow-up')}{b('NOT_INTERESTED', 'No answer / no', false, 'No response')}</div>;
    case 'REPLIED':
      return <div className="cl-status">{b('INTERESTED', '👍 Interested', true)}{b('NOT_INTERESTED', 'Not interested', false, 'Declined after reply')}</div>;
    case 'INTERESTED':
    case 'PROPOSAL_SENT':
    case 'NEGOTIATING':
      return <div className="cl-status">{b('WON', '🎉 They paid / agreed', true)}{b('LOST', 'Lost', false, 'Lost after interest')}</div>;
    default:
      return null;
  }
}

function LeadCard({ p, go }: { p: Prospect; go: (v: View) => void }) {
  const syncFromBackend = useStore((s) => s.syncFromBackend);
  const session = useOperatorSession();
  const phone = prospectPhone(p);
  const page = prospectPageUrl(p);
  const price = prospectPrice(p);
  const isNew = p.status === 'DISCOVERED' || p.status === 'QUALIFIED';
  const isTalking = ['REPLIED', 'INTERESTED', 'PROPOSAL_SENT', 'NEGOTIATING'].includes(p.status);
  const defaultMessage = isNew ? firstMessage(p) : isTalking ? priceDetailsMessage(p) : followUpMessage(p);
  const [message, setMessage] = useState(defaultMessage);
  const [showMsg, setShowMsg] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => setMessage(defaultMessage), [defaultMessage]);

  const changeStatus = async (status: ProspectStatus, reason?: string) => {
    setError(null);
    try {
      await updateProspectStatus(p.id, status, reason);
      await syncFromBackend();
      setOpened(false);
      if (status === 'WON') go('projects');
    } catch (e) {
      setError(errorText(e));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowMsg(true);
    }
  };

  const verified = p.verification?.status === 'VERIFIED' || p.verification?.status === 'PROVISIONAL';
  const followDue = p.nextFollowUpAt && p.nextFollowUpAt <= Date.now() && (p.status === 'CONTACTED' || p.status === 'FOLLOW_UP');
  const presence =
    p.websitePresence === 'SOCIAL_ONLY'
      ? /whatsapp/i.test(p.evidenceNotes) ? 'WhatsApp only · no website' : /instagram/i.test(p.evidenceNotes) ? 'Instagram only · no website' : 'Facebook only · no website'
      : p.websitePresence === 'WEAK_OR_OUTDATED' ? 'Weak / outdated website' : 'No website found';

  return (
    <article className={`cl-lead${followDue ? ' due' : ''}`}>
      <header className="cl-lead-head">
        <div>
          <h3>{displayName(p)}</h3>
          <div className="cl-meta">
            {p.location && p.location !== 'Zimbabwe' ? `${p.location} · ` : ''}{p.category.replace(/\s*\((food)\)/, '')}
          </div>
        </div>
        {p.priority === 'HIGH' && <span className="cl-tag hot">Hot lead</span>}
      </header>

      <div className="cl-facts">
        <span className="cl-tag">{presence}</span>
        {verified ? <span className="cl-tag ok">✓ Checked</span> : <span className="cl-tag">Check the page first</span>}
        {followDue && <span className="cl-tag warn">Follow-up due</span>}
        {p.messagesSentCount > 0 && <span className="cl-tag">{p.messagesSentCount} message{p.messagesSentCount === 1 ? '' : 's'} sent</span>}
      </div>

      <div className="cl-price">
        <div>
          <div className="cl-price-main">${price.quote}</div>
          <div className="cl-price-sub">{price.label} · +${price.monthlyCare}/mo care optional</div>
        </div>
        <div className="cl-price-market">
          Zim market
          <strong>${price.marketMin}–${price.marketMax}</strong>
        </div>
      </div>

      {p.status !== 'WON' && p.status !== 'LOST' && p.status !== 'NOT_INTERESTED' && (
        <>
          <div className="cl-actions">
            {phone?.isMobile ? (
              <a
                className="btn big cl-wa"
                href={whatsappLink(phone, message)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpened(true)}
              >
                WhatsApp {phone.display}
              </a>
            ) : (
              <button className="btn big" onClick={copy}>{copied ? 'Copied ✓' : 'Copy message'}</button>
            )}
            {phone && (
              <a className="btn big" href={callLink(phone)}>📞 Call</a>
            )}
            {page && (
              <a className="btn big" href={page} target="_blank" rel="noopener noreferrer">Their page</a>
            )}
            {phone?.isMobile && (
              <button className="btn big" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
            )}
          </div>
          {!phone && <div className="muted small">No phone number on record yet — message them from their page, then record it below.</div>}

          <button className="link-btn" onClick={() => setShowMsg(!showMsg)}>
            {showMsg ? 'Hide message' : isNew ? 'Read / edit the message' : isTalking ? 'Read / edit the price details' : 'Read / edit the follow-up'}
          </button>
          {showMsg && (
            <textarea className="cl-msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={12} />
          )}

          {opened && isNew && <div className="cl-hint">Sent it on WhatsApp? Tap <strong>✓ I sent it</strong> so Survivor reminds you to follow up in 3 days.</div>}
          {session ? (
            <StatusButtons p={p} onChange={changeStatus} />
          ) : (
            <div className="muted small">Unlock (top of this page) to record what happened.</div>
          )}
        </>
      )}
      {p.status === 'WON' && (
        <div className="cl-status"><button className="btn big primary" onClick={() => go('projects')}>Open delivery →</button></div>
      )}
      {error && <div className="cl-error" role="alert">{error}</div>}
    </article>
  );
}

/* --------------------------------- screen --------------------------------- */

export function Clients({ go }: { go: (v: View) => void }) {
  const prospects = useStore((s) => s.prospects);
  const realRevenue = useStore((s) => s.realRevenue);
  const [tab, setTab] = useState<Tab>('todo');
  const now = Date.now();

  const byTab = useMemo(() => {
    const groups: Record<Tab, Prospect[]> = { todo: [], followup: [], talking: [], won: [], closed: [] };
    for (const p of prospects) {
      const t = tabFor(p);
      if (t) groups[t].push(p);
    }
    groups.todo.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || b.dateDiscovered - a.dateDiscovered);
    groups.followup.sort((a, b) => (a.nextFollowUpAt ?? 0) - (b.nextFollowUpAt ?? 0));
    groups.talking.sort((a, b) => b.updatedAt - a.updatedAt);
    groups.won.sort((a, b) => b.updatedAt - a.updatedAt);
    groups.closed.sort((a, b) => b.updatedAt - a.updatedAt);
    return groups;
  }, [prospects, now]);

  const earned = (realRevenue ?? []).reduce((sum, r) => sum + (Number(r.amountReceived) || 0), 0);
  const dueCount = byTab.followup.filter((p) => p.nextFollowUpAt && p.nextFollowUpAt <= now).length;
  const list = byTab[tab];

  return (
    <div className="view-enter cl">
      <SessionBar />

      <section className="cl-stats">
        <button className={`cl-stat${tab === 'todo' ? ' on' : ''}`} onClick={() => setTab('todo')}>
          <strong>{byTab.todo.length}</strong><span>to contact</span>
        </button>
        <button className={`cl-stat${tab === 'followup' ? ' on' : ''}`} onClick={() => setTab('followup')}>
          <strong>{byTab.followup.length}</strong><span>{dueCount ? `${dueCount} due` : 'waiting'}</span>
        </button>
        <button className={`cl-stat${tab === 'talking' ? ' on' : ''}`} onClick={() => setTab('talking')}>
          <strong>{byTab.talking.length}</strong><span>talking</span>
        </button>
        <button className={`cl-stat${tab === 'won' ? ' on' : ''}`} onClick={() => setTab('won')}>
          <strong>${earned.toFixed(0)}</strong><span>earned</span>
        </button>
      </section>

      <div className="cl-tabs" role="tablist">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`cl-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]} <span>{byTab[t].length}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="cl-empty">
          {tab === 'todo'
            ? 'No leads waiting. Use “Find clients” below — Survivor also searches a new town and business type on its own every half hour.'
            : tab === 'followup'
              ? 'Nobody to follow up yet. Leads move here after you tap “✓ I sent it”.'
              : tab === 'talking'
                ? 'When a business replies, tap “💬 They replied” and it moves here.'
                : tab === 'won'
                  ? 'Your first win will show here.'
                  : 'Skipped and lost leads show here.'}
        </div>
      ) : (
        <div className="cl-list">
          {list.map((p) => (
            <LeadCard key={p.id} p={p} go={go} />
          ))}
        </div>
      )}

      <FindClients />

      <details className="cl-card cl-sources">
        <summary>Where the prices come from</summary>
        <p className="muted small">Published Zimbabwe web-design prices, checked {CHECKED_ON}. Quotes sit in the lower-middle of the market.</p>
        <ul>
          {MARKET_SOURCES.map((s) => (
            <li key={s.name}>
              {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a> : <strong>{s.name}</strong>}: {s.prices}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
