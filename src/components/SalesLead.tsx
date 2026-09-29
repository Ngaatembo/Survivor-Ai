/* ============================================================================
 * SalesLead — everything about ONE lead in one panel:
 *   sales card · manual-control buttons · brief · message · follow-up ·
 *   call prep · offer & proposal · activity timeline.
 * Survivor recommends; every send / stage change is a button YOU press.
 * ========================================================================== */

import { useCallback, useEffect, useState } from 'react';
import { Badge } from './ui';
import { FactList, Notice, Section, StageBadge, errText, fmtDate, fmtDateTime, fmtDue } from './salesUi';
import * as api from '../services/salesApi';
import type { LeadProfile } from '../services/salesApi';
import { validateOutreach } from '../sales/messages';
import {
  ANGLE_LABEL,
  ANGLE_LETTER,
  CHANNEL_LABEL,
  LOST_REASONS,
  OFFER_LABEL,
  OFFER_TYPES,
  STAGE_LABEL,
  type OfferType,
  type SalesMessage,
  type SalesStage,
} from '../sales/types';

export type LeadTab = 'brief' | 'message' | 'followup' | 'call' | 'offer' | 'timeline';
const TABS: { id: LeadTab; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'message', label: 'Message' },
  { id: 'followup', label: 'Follow-up' },
  { id: 'call', label: 'Call' },
  { id: 'offer', label: 'Offer' },
  { id: 'timeline', label: 'Timeline' },
];

type Panel = null | 'contact' | 'lost' | 'won' | 'meeting' | 'schedule';

const waLink = (digits: string | null | undefined, text: string) =>
  digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : undefined;

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

interface Props {
  prospectId: string;
  initialTab?: LeadTab;
  autoResearch?: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export function SalesLead({ prospectId, initialTab, autoResearch, onClose, onChanged }: Props) {
  const [p, setP] = useState<LeadProfile | null>(null);
  const [tab, setTab] = useState<LeadTab>(initialTab ?? 'brief');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  const refresh = useCallback(async () => {
    setP(await api.getLeadProfile(prospectId));
  }, [prospectId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (autoResearch) await api.runResearch(prospectId);
        const profile = await api.getLeadProfile(prospectId);
        if (alive) setP(profile);
        if (autoResearch) onChanged();
      } catch (e) {
        if (alive) setNotice({ tone: 'err', text: errText(e) });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospectId]);

  /** Run an action, then reload the profile and the pipeline behind it. */
  const run = async (label: string, fn: () => Promise<unknown>, okText?: string) => {
    setBusy(label);
    setNotice(null);
    try {
      const r: any = await fn();
      await refresh();
      onChanged();
      if (r?.stageNote) setNotice({ tone: 'warn', text: r.stageNote });
      else if (okText) setNotice({ tone: 'ok', text: okText });
      return true;
    } catch (e) {
      setNotice({ tone: 'err', text: errText(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (!p) {
    return (
      <div className="sl-overlay" role="dialog" aria-modal="true">
        <div className="sl-sheet">
          <div className="sl-head"><h2>Loading lead…</h2><button className="btn" onClick={onClose}>✕</button></div>
          {notice && <Notice tone={notice.tone === 'ok' ? 'ok' : 'err'}>{notice.text}</Notice>}
        </div>
      </div>
    );
  }

  const { lead, state, brief, contact } = p;
  const stage = state.stage;
  const can = (s: SalesStage) => state.allowedNext.includes(s);
  const closed = stage === 'WON' || stage === 'LOST' || stage === 'NOT_A_FIT';
  const noChannel = brief.channel.status === 'NO_DIRECT_CHANNEL';
  const move = (to: SalesStage, note?: string, extra: { messageId?: string } = {}) =>
    run(`stage:${to}`, () => api.changeStage(prospectId, to, { note, ...extra }), `Moved to ${STAGE_LABEL[to]}.`);

  const chosenMessage = p.messages.find((m) => m.kind === 'FIRST_CONTACT' && (m.status === 'SELECTED'))
    ?? p.messages.find((m) => m.kind === 'FIRST_CONTACT' && m.status === 'SENT');
  const nextFollowUp = p.followUps.filter((f) => f.status === 'PENDING').sort((a, b) => a.dueAt - b.dueAt)[0];

  return (
    <div className="sl-overlay" role="dialog" aria-modal="true" aria-label={lead.businessName}>
      <div className="sl-sheet">
        <div className="sl-head">
          <div>
            <h2>{lead.businessName}</h2>
            <div className="cl-facts">
              <StageBadge stage={stage} />
              <span className="cl-tag">Score {lead.score}</span>
              <span className={`cl-tag ${lead.verification === 'VERIFIED' ? 'ok' : lead.verification === 'PROVISIONAL' ? '' : 'warn'}`}>{lead.verification.toLowerCase()}</span>
              {lead.paused && <span className="cl-tag warn">Paused</span>}
            </div>
          </div>
          <button className="btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        {/* ------------------------------ sales card ------------------------------ */}
        <dl className="sl-card-grid">
          <Cell k="Contact person" v={contact.contactPerson ?? 'Unknown'} />
          <Cell k="Phone" v={contact.callNumber ?? contact.phone ?? '—'} />
          <Cell k="WhatsApp" v={contact.whatsappNumber ? `+${contact.whatsappNumber}` : contact.whatsapp ?? '—'} />
          <Cell k="Email" v={contact.email ?? '—'} />
          <Cell k="Social" v={contact.socialLinks.length ? contact.socialLinks.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">{u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 34)}</a>) : '—'} />
          <Cell k="Website" v={contact.website ? <a href={contact.website} target="_blank" rel="noreferrer">{contact.website.replace(/^https?:\/\//, '')}</a> : 'None found'} />
          <Cell k="Location" v={p.prospect.location || '—'} />
          <Cell k="Category" v={p.prospect.category || '—'} />
          <Cell k="Opportunity" v={brief.opportunity} wide />
          <Cell k="Recommended channel" v={noChannel ? 'NO_DIRECT_CHANNEL' : CHANNEL_LABEL[brief.channel.channel!]} />
          <Cell k="Approach" v={ANGLE_LABEL[brief.angle]} />
          <Cell k="Sales message" v={chosenMessage ? `${chosenMessage.variant.toLowerCase().replace(/_/g, ' ')} (${chosenMessage.status.toLowerCase()})` : 'Not chosen yet'} />
          <Cell k="Follow-up date" v={nextFollowUp ? `${fmtDate(nextFollowUp.dueAt)} (${fmtDue(nextFollowUp.dueAt)})` : '—'} />
          <Cell k="Last contact" v={fmtDate(state.lastContactAt)} />
          <Cell k="Next action" v={nextFollowUp?.note ?? lead.nextAction ?? '—'} wide />
          <Cell k="Demo" v={state.demoBuilt && state.demoStatus !== 'SENT' ? 'BUILT' : state.demoStatus} />
          <Cell k="Notes" v={p.notes.length ? `${p.notes.length} — latest: ${p.notes[0].body.slice(0, 60)}` : 'None'} wide />
        </dl>

        {/* ---------------------------- manual control ---------------------------- */}
        {panel === null && (
          <div className="sl-controls">
            {!closed && !state.researchedAt && <button className="btn primary big" disabled={!!busy} onClick={() => void run('research', () => api.runResearch(prospectId), 'Sales brief generated.')}>{busy === 'research' ? 'Working…' : 'Generate research'}</button>}
            {!closed && state.researchedAt && ['QUALIFIED', 'RESEARCHED', 'READY_TO_CONTACT'].includes(stage) && (
              <button className="btn primary big" onClick={() => setTab('message')}>{chosenMessage ? 'Edit message' : 'Generate message'}</button>
            )}
            {stage === 'READY_TO_CONTACT' && <button className="btn primary big" disabled={!!busy || noChannel} onClick={() => void move('CONTACTED', undefined, { messageId: chosenMessage?.id })}>✓ Mark as contacted</button>}
            {stage === 'CONTACTED' && <button className="btn big" disabled={!!busy} onClick={() => void move('FOLLOW_UP_1')}>↻ Follow-up 1 sent</button>}
            {stage === 'FOLLOW_UP_1' && <button className="btn big" disabled={!!busy} onClick={() => void move('FOLLOW_UP_2')}>↻ Follow-up 2 sent</button>}
            {can('REPLIED') && <button className="btn big" disabled={!!busy} onClick={() => void move('REPLIED', stage === 'DORMANT' ? 'Re-engaged' : undefined)}>💬 {stage === 'DORMANT' ? 'They replied again' : 'Mark replied'}</button>}
            {stage === 'REPLIED' && can('INTERESTED') && <button className="btn primary big" disabled={!!busy} onClick={() => void move('INTERESTED')}>👍 Mark interested</button>}
            {can('MEETING') && <button className="btn big" onClick={() => setPanel('meeting')}>📅 Book meeting</button>}
            {['REPLIED', 'INTERESTED', 'MEETING', 'PROPOSAL', 'NEGOTIATION'].includes(stage) && (
              <button className="btn big" disabled={!!busy} onClick={() => { setTab('offer'); }}>📝 Create proposal</button>
            )}
            {stage === 'PROPOSAL' && can('NEGOTIATION') && <button className="btn big" disabled={!!busy} onClick={() => void move('NEGOTIATION')}>🤝 Negotiating</button>}
            {can('WON') && <button className="btn primary big" onClick={() => setPanel('won')}>🎉 Mark won</button>}
            {!closed && <button className="btn big" onClick={() => setPanel('schedule')}>⏰ Schedule follow-up</button>}
            {can('LOST') && <button className="btn big" onClick={() => setPanel('lost')}>Mark lost</button>}
            {(stage === 'LOST' || stage === 'NOT_A_FIT') && can('QUALIFIED') && <button className="btn big" disabled={!!busy} onClick={() => void move('QUALIFIED', 'Reopened')}>↺ Reopen</button>}
            {stage === 'DORMANT' && can('READY_TO_CONTACT') && <button className="btn big" disabled={!!busy} onClick={() => void move('READY_TO_CONTACT', 'Re-engaging')}>↺ Re-engage</button>}
            {!closed && <button className="btn big" disabled={!!busy} onClick={() => void run('pause', () => api.pauseLead(prospectId, !state.paused), state.paused ? 'Lead resumed.' : 'Lead paused.')}>{state.paused ? '▶ Resume' : '⏸ Pause'}</button>}
            {can('NOT_A_FIT') && <button className="btn big" disabled={!!busy} onClick={() => { if (window.confirm('Disqualify this lead as NOT A FIT?')) void run('dq', () => api.disqualifyLead(prospectId, 'Disqualified by you'), 'Marked not a fit.'); }}>Disqualify</button>}
            <button className="btn big" onClick={() => setPanel('contact')}>✎ Edit contact</button>
          </div>
        )}

        {panel === 'contact' && <ContactForm p={p} busy={!!busy} onCancel={() => setPanel(null)} onSave={async (patch) => { if (await run('contact', () => api.updateLead(prospectId, patch), 'Contact details saved.')) setPanel(null); }} />}
        {panel === 'lost' && <LostForm busy={!!busy} onCancel={() => setPanel(null)} onSave={async (reason, notes) => { if (await run('lost', () => api.markLost(prospectId, reason, notes), 'Marked lost.')) setPanel(null); }} />}
        {panel === 'won' && <WonForm busy={!!busy} onCancel={() => setPanel(null)} onSave={async (v) => { if (await run('won', () => api.markWon(prospectId, v), 'Marked won — congratulations!')) setPanel(null); }} />}
        {panel === 'meeting' && <MeetingForm busy={!!busy} onCancel={() => setPanel(null)} onSave={async (at, kind, notes) => { if (await run('meeting', () => api.bookMeeting(prospectId, at, kind, notes), 'Meeting booked.')) { setPanel(null); setTab('call'); } }} />}
        {panel === 'schedule' && <ScheduleForm busy={!!busy} onCancel={() => setPanel(null)} onSave={async (a) => { if (await run('schedule', () => api.scheduleFollowUp(prospectId, a), 'Follow-up scheduled.')) setPanel(null); }} />}

        {/* --------------------------------- tabs --------------------------------- */}
        <div className="cl-tabs">
          {TABS.map((t) => <button key={t.id} className={`cl-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>

        {tab === 'brief' && <BriefTab p={p} busy={busy} onResearch={() => void run('research', () => api.runResearch(prospectId), 'Sales brief refreshed.')} />}
        {tab === 'message' && <MessageTab p={p} busy={busy} run={run} move={move} />}
        {tab === 'followup' && <FollowUpTab p={p} busy={busy} run={run} move={move} openSchedule={() => setPanel('schedule')} />}
        {tab === 'call' && <CallTab p={p} busy={busy} run={run} openMeeting={() => setPanel('meeting')} />}
        {tab === 'offer' && <OfferTab p={p} busy={busy} run={run} />}
        {tab === 'timeline' && <TimelineTab p={p} busy={busy} run={run} />}
      </div>
    </div>
  );
}

function Cell({ k, v, wide }: { k: string; v: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? 'wide' : ''}><dt>{k}</dt><dd>{v}</dd></div>;
}

/* ------------------------------- small forms ------------------------------- */

function FormShell({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="cl-card sl-formcard">
      <h2>{title}</h2>
      <div className="sl-form">{children}</div>
      <button className="link-btn" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function ContactForm({ p, busy, onSave, onCancel }: { p: LeadProfile; busy: boolean; onSave: (patch: { contactPerson?: string; phone?: string; whatsapp?: string; email?: string }) => void; onCancel: () => void }) {
  const [v, setV] = useState({ contactPerson: p.contact.contactPerson ?? '', phone: p.contact.phone ?? '', whatsapp: p.contact.whatsapp ?? '', email: p.contact.email ?? '' });
  const f = (k: keyof typeof v, label: string, ph: string) => (
    <label><span>{label}</span><input className="cl-input" placeholder={ph} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>
  );
  return (
    <FormShell title="Edit contact details" onCancel={onCancel}>
      {f('contactPerson', 'Contact person / decision-maker', 'e.g. Mr Moyo (owner)')}
      {f('phone', 'Phone', '0772 123 456')}
      {f('whatsapp', 'WhatsApp (if different)', '0772 123 456')}
      {f('email', 'Email', 'name@business.co.zw')}
      <button className="btn primary big wide" disabled={busy} onClick={() => onSave(v)}>{busy ? 'Saving…' : 'Save'}</button>
    </FormShell>
  );
}

function LostForm({ busy, onSave, onCancel }: { busy: boolean; onSave: (reason: string, notes?: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState<string>('NOT_INTERESTED');
  const [notes, setNotes] = useState('');
  return (
    <FormShell title="Why was this lead lost?" onCancel={onCancel}>
      <label className="wide"><span>Reason</span>
        <select className="cl-input" value={reason} onChange={(e) => setReason(e.target.value)}>
          {LOST_REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ').toLowerCase()}</option>)}
        </select>
      </label>
      <label className="wide"><span>Notes (optional)</span><textarea className="cl-msg" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <button className="btn danger big wide" disabled={busy} onClick={() => onSave(reason, notes || undefined)}>{busy ? 'Saving…' : 'Mark lost'}</button>
    </FormShell>
  );
}

function WonForm({ busy, onSave, onCancel }: { busy: boolean; onSave: (value?: number) => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  return (
    <FormShell title="Mark this lead won" onCancel={onCancel}>
      <label className="wide"><span>Agreed price in USD (optional)</span><input className="cl-input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      <p className="muted wide small">This records the deal in your pipeline. Verified payments are tracked separately in Real Revenue.</p>
      <button className="btn primary big wide" disabled={busy} onClick={() => onSave(value.trim() === '' ? undefined : Number(value))}>{busy ? 'Saving…' : 'Mark won'}</button>
    </FormShell>
  );
}

function MeetingForm({ busy, onSave, onCancel }: { busy: boolean; onSave: (at: string, kind: 'CALL' | 'VIDEO' | 'VISIT', notes?: string) => void; onCancel: () => void }) {
  const [at, setAt] = useState('');
  const [kind, setKind] = useState<'CALL' | 'VIDEO' | 'VISIT'>('CALL');
  const [notes, setNotes] = useState('');
  return (
    <FormShell title="Book a meeting" onCancel={onCancel}>
      <label><span>When</span><input className="cl-input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
      <label><span>Type</span>
        <select className="cl-input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="CALL">Phone call</option><option value="VIDEO">Video call</option><option value="VISIT">In-person visit</option>
        </select>
      </label>
      <label className="wide"><span>Notes</span><input className="cl-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <button className="btn primary big wide" disabled={busy || !at} onClick={() => onSave(new Date(at).toISOString(), kind, notes || undefined)}>{busy ? 'Saving…' : 'Book meeting'}</button>
    </FormShell>
  );
}

function ScheduleForm({ busy, onSave, onCancel }: { busy: boolean; onSave: (a: { inDays?: number; dueAt?: string; note?: string }) => void; onCancel: () => void }) {
  const [days, setDays] = useState('2');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  return (
    <FormShell title="Schedule a follow-up" onCancel={onCancel}>
      <label><span>In how many days</span><input className="cl-input" inputMode="numeric" value={days} onChange={(e) => { setDays(e.target.value); setDate(''); }} /></label>
      <label><span>…or pick a date</span><input className="cl-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="wide"><span>What to do</span><input className="cl-input" placeholder="e.g. Send the demo link" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button className="btn primary big wide" disabled={busy || (!date && !(Number(days) >= 0))} onClick={() => onSave(date ? { dueAt: new Date(`${date}T09:00:00`).toISOString(), note: note || undefined } : { inDays: Number(days), note: note || undefined })}>{busy ? 'Saving…' : 'Schedule'}</button>
    </FormShell>
  );
}

/* ---------------------------------- brief ---------------------------------- */

type RunFn = (label: string, fn: () => Promise<unknown>, okText?: string) => Promise<boolean>;
type MoveFn = (to: SalesStage, note?: string, extra?: { messageId?: string }) => Promise<boolean>;

function BriefTab({ p, busy, onResearch }: { p: LeadProfile; busy: string | null; onResearch: () => void }) {
  const b = p.brief;
  return (
    <div className="sl-tabbody">
      <button className="btn big" disabled={!!busy} onClick={onResearch}>{busy === 'research' ? 'Working…' : p.state.researchedAt ? '↻ Refresh research' : 'Generate research'}</button>

      <Section title="Business"><p>{b.business}{b.category ? ` — ${b.category}` : ''}{b.location ? `, ${b.location}` : ''}</p></Section>
      <Section title="Opportunity"><p>{b.opportunity}</p></Section>
      <Section title="Evidence"><FactList facts={b.evidence} /></Section>
      <Section title="Decision maker"><FactList facts={[b.decisionMaker]} /></Section>

      <Section title="Best contact channel">
        {b.channel.status === 'RECOMMENDED' ? (
          <>
            <p><strong>{CHANNEL_LABEL[b.channel.channel!]}</strong>{b.channel.target ? ` — ${b.channel.target}` : ''}</p>
            <p className="muted">{b.channel.reason}</p>
            {b.channel.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
            {b.channel.fallbacks.length > 0 && (
              <details className="cl-sources"><summary>Other options ({b.channel.fallbacks.length})</summary>
                <ul>{b.channel.fallbacks.map((f) => <li key={f.channel}><strong>{CHANNEL_LABEL[f.channel]}</strong>: {f.reason}</li>)}</ul>
              </details>
            )}
          </>
        ) : (
          <>
            <Notice tone="warn"><strong>STATUS: NO_DIRECT_CHANNEL</strong><br />{b.channel.reason}</Notice>
            <p>{b.channel.nextStep} Then use “Edit contact” above to add what you find.</p>
          </>
        )}
      </Section>

      <Section title="Approach angle">
        <p><Badge tone="blue">{ANGLE_LETTER[b.angle]}</Badge> <strong>{ANGLE_LABEL[b.angle]}</strong></p>
        <p className="muted">{b.angleReason}</p>
        <p>{b.approach}</p>
        {b.secondaryAngles.length > 0 && <p className="muted small">Also possible: {b.secondaryAngles.map((a) => ANGLE_LABEL[a]).join('; ')}.</p>}
      </Section>

      <Section title="Primary offer"><OfferSummary p={p} /></Section>
      <Section title="Why this business"><p>{b.whyThisBusiness}</p></Section>
      <Section title="Confidence">
        <p><Badge tone={b.confidence === 'HIGH' ? 'green' : b.confidence === 'MEDIUM' ? 'amber' : 'red'}>{b.confidence}</Badge></p>
        <ul className="sl-plain">{b.confidenceReasons.map((r) => <li key={r}>{r}</li>)}</ul>
        {!b.qualification.qualified && <Notice tone="warn">Not qualified yet: {b.qualification.blockers.join(' ')}</Notice>}
      </Section>
      <Section title="Demo recommendation"><DemoBlock p={p} /></Section>
      <Section title="Sales action plan">
        <ol className="sl-plan">{p.actionPlan.map((s) => <li key={s.when + s.action}><strong>{s.when}</strong>{s.condition ? <em> — if: {s.condition}</em> : null}<br />{s.action}</li>)}</ol>
      </Section>
    </div>
  );
}

function DemoBlock({ p }: { p: LeadProfile }) {
  const d = p.brief.demo;
  return (
    <>
      <p><Badge tone={d.recommended ? 'green' : 'gray'}>{d.recommended ? 'YES' : 'NO'}</Badge></p>
      <p className="muted">{d.reason}</p>
      {d.recommended && (
        <>
          <p><strong>Suggested demo:</strong> {d.suggestedDemo}</p>
          <p className="muted small">Sections: {d.suggestedSections.join(' · ')}</p>
        </>
      )}
      <p className="muted small">Demo status: {p.state.demoBuilt && p.state.demoStatus !== 'SENT' ? 'a demo has been built for this lead (Survivor → Delivery)' : p.state.demoStatus.toLowerCase()}.</p>
    </>
  );
}

function OfferSummary({ p }: { p: LeadProfile }) {
  const o = p.brief.offer;
  const q = o.quote;
  return (
    <>
      <p><strong>{OFFER_LABEL[o.offer]}</strong></p>
      <p><em>Why:</em> {o.whyThisOffer}</p>
      <p><em>Solves:</em> {o.problemSolved}</p>
      <div className="sl-two">
        <div><h5>Necessary</h5><ul className="sl-plain">{o.necessaryFeatures.map((f) => <li key={f}>{f}</li>)}</ul></div>
        <div><h5>Optional</h5><ul className="sl-plain">{o.optionalFeatures.map((f) => <li key={f}>{f}</li>)}</ul></div>
      </div>
      {o.lighterAlternative && <p className="muted small">Lighter alternative if budget is tight: {OFFER_LABEL[o.lighterAlternative]}.</p>}
      <QuoteBlock quote={q} />
    </>
  );
}

function QuoteBlock({ quote }: { quote: LeadProfile['brief']['offer']['quote'] }) {
  return (
    <div className="sl-quote">
      <p><Badge tone={quote.priceStatus === 'PRICED' ? 'green' : 'amber'}>{quote.priceStatus === 'PRICED' ? 'PRICED' : 'MANUAL_REVIEW_REQUIRED'}</Badge></p>
      <table className="data-table sl-table"><tbody>
        {quote.lines.map((l) => (
          <tr key={l.key + l.label}><td>{l.label}{l.optional ? <span className="muted"> (optional)</span> : null}</td>
            <td className="sl-num">{l.amount === null ? 'not set' : `$${l.amount}${l.recurring === 'MONTHLY' ? '/mo' : l.recurring === 'YEARLY' ? '/yr' : ''}`}</td></tr>
        ))}
      </tbody></table>
      {quote.priceStatus === 'PRICED' && <p><strong>Once-off ${quote.oneOffTotal}</strong>{quote.monthlyTotal ? ` + $${quote.monthlyTotal}/month` : ''}</p>}
      <p className="muted small">{quote.note}</p>
    </div>
  );
}

/* --------------------------------- message --------------------------------- */

function MessageTab({ p, busy, run, move }: { p: LeadProfile; busy: string | null; run: RunFn; move: MoveFn }) {
  const first = p.messages.filter((m) => m.kind === 'FIRST_CONTACT');
  const noChannel = p.brief.channel.status === 'NO_DIRECT_CHANNEL';
  const ch = p.brief.channel.channel;
  return (
    <div className="sl-tabbody">
      <Section title="Personalised first message">
        {noChannel ? (
          <Notice tone="warn"><strong>NO_DIRECT_CHANNEL.</strong> {p.brief.channel.nextStep} Add the contact details with “Edit contact”, then generate the message.</Notice>
        ) : (
          <p className="muted">Recommended channel: <strong>{CHANNEL_LABEL[ch!]}</strong>. Up to three approaches — pick one, edit it, and send it yourself. Nothing is sent automatically.</p>
        )}
        <button className="btn primary big" disabled={!!busy || noChannel} onClick={() => void run('gen', () => api.generateMessages(p.lead.prospectId), 'Messages generated — choose one.')}>{busy === 'gen' ? 'Writing…' : first.length ? '↻ Regenerate drafts' : 'Generate message'}</button>
      </Section>
      {first.map((m) => <MessageCard key={m.id + m.status} m={m} p={p} busy={busy} run={run} move={move} />)}
    </div>
  );
}

const VARIANT_LABEL: Record<string, string> = { DIRECT: 'Direct — short', CONSULTATIVE: 'Consultative — the problem & opportunity', DEMO_LED: 'Demo-led — offer to show an example' };

function MessageCard({ m, p, busy, run, move }: { m: SalesMessage; p: LeadProfile; busy: string | null; run: RunFn; move: MoveFn }) {
  const original = m.editedBody ?? m.body;
  const [text, setText] = useState(original);
  const [copied, setCopied] = useState(false);
  const warnings = validateOutreach(text, p.brief);
  const wa = waLink(p.contact.whatsappNumber, text);
  const page = p.contact.socialLinks[0];
  const stage = p.state.stage;

  return (
    <div className={`cl-card sl-msg ${m.status.toLowerCase()}`}>
      <div className="sl-msg-head">
        <strong>{VARIANT_LABEL[m.variant] ?? m.variant}</strong>
        <Badge tone={m.status === 'SENT' ? 'green' : m.status === 'SELECTED' ? 'blue' : 'gray'}>{m.status}</Badge>
      </div>
      <textarea className="cl-msg" rows={Math.min(14, Math.max(5, text.split('\n').length + 1))} value={text} onChange={(e) => setText(e.target.value)} readOnly={m.status === 'SENT'} />
      {warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
      {m.status !== 'SENT' && (
        <div className="cl-actions">
          <button className="btn" onClick={async () => { setCopied(await copyText(text)); setTimeout(() => setCopied(false), 1800); }}>{copied ? '✓ Copied' : 'Copy'}</button>
          {wa && <a className="btn cl-wa" href={wa} target="_blank" rel="noreferrer">Open in WhatsApp</a>}
          {!wa && p.brief.channel.channel === 'PHONE_CALL' && p.contact.callNumber && <a className="btn" href={`tel:${p.contact.callNumber}`}>Call</a>}
          {!wa && page && (p.brief.channel.channel === 'FACEBOOK_MESSENGER' || p.brief.channel.channel === 'INSTAGRAM_DM') && <a className="btn" href={page} target="_blank" rel="noreferrer">Open page</a>}
          <button className="btn primary" disabled={!!busy} onClick={() => void run('select', () => api.selectMessage(m.id, text !== m.body ? text : undefined), 'Message chosen.')}>{m.status === 'SELECTED' ? 'Save edit' : 'Use this one'}</button>
          {m.status === 'SELECTED' && stage === 'READY_TO_CONTACT' && (
            <button className="btn primary" disabled={!!busy} onClick={() => void move('CONTACTED', undefined, { messageId: m.id })}>✓ I sent it</button>
          )}
        </div>
      )}
      {m.status === 'SENT' && <p className="muted small">Sent {fmtDateTime(m.sentAt)}.</p>}
    </div>
  );
}

/* -------------------------------- follow-up -------------------------------- */

function defaultSituation(p: LeadProfile): string {
  const s = p.state;
  if (s.demoStatus === 'SENT' && ['INTERESTED', 'REPLIED', 'MEETING'].includes(s.stage)) return 'DEMO_SENT';
  switch (s.stage) {
    case 'CONTACTED': return 'NO_RESPONSE_1';
    case 'FOLLOW_UP_1': case 'FOLLOW_UP_2': return 'NO_RESPONSE_2';
    case 'REPLIED': return 'POSITIVE_REPLY';
    case 'INTERESTED': return 'INTERESTED_BUSY';
    case 'PROPOSAL': case 'NEGOTIATION': return 'PROPOSAL_SENT';
    default: return 'NO_RESPONSE_1';
  }
}

function FollowUpTab({ p, busy, run, move, openSchedule }: { p: LeadProfile; busy: string | null; run: RunFn; move: MoveFn; openSchedule: () => void }) {
  const [situation, setSituation] = useState(defaultSituation(p));
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.generateFollowUpMessage>> | null>(null);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const pending = p.followUps.filter((f) => f.status === 'PENDING').sort((a, b) => a.dueAt - b.dueAt);
  const stage = p.state.stage;
  const wa = waLink(p.contact.whatsappNumber, text);
  const showQuestions = ['REPLIED', 'INTERESTED', 'MEETING'].includes(stage);

  const generate = async () => {
    const ok = await run('fu', async () => {
      const r = await api.generateFollowUpMessage(p.lead.prospectId, situation);
      setResult(r);
      setText(r.followUp.message);
      return r;
    });
    void ok;
  };

  return (
    <div className="sl-tabbody">
      <Section title="Scheduled follow-ups" right={<button className="link-btn" onClick={openSchedule}>+ Schedule</button>}>
        {pending.length === 0 ? <p className="muted">Nothing scheduled.</p> : (
          <ul className="sl-plain">{pending.map((f) => (
            <li key={f.id} className="sl-fu">
              <span><strong>{fmtDate(f.dueAt)}</strong> ({fmtDue(f.dueAt)}) — {f.note}</span>
              <span className="sl-fu-btns">
                <button className="btn small" disabled={!!busy} onClick={() => void run('fu-done', () => api.finishFollowUp(f.id, 'DONE'))}>Done</button>
                <button className="btn small" disabled={!!busy} onClick={() => void run('fu-skip', () => api.finishFollowUp(f.id, 'SKIPPED'))}>Skip</button>
              </span>
            </li>
          ))}</ul>
        )}
      </Section>

      <Section title="Write a follow-up">
        <label className="wide"><span className="muted small">Situation</span>
          <select className="cl-input" value={situation} onChange={(e) => setSituation(e.target.value)}>
            {p.followUpSituations.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <button className="btn primary big" disabled={!!busy} onClick={() => void generate()}>{busy === 'fu' ? 'Writing…' : 'Generate follow-up'}</button>
      </Section>

      {result && (
        <div className="cl-card sl-msg">
          <div className="sl-msg-head"><strong>{result.followUp.title}</strong></div>
          <textarea className="cl-msg" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          {validateOutreach(text, p.brief).map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
          <div className="cl-actions">
            <button className="btn" onClick={async () => { setCopied(await copyText(text)); setTimeout(() => setCopied(false), 1800); }}>{copied ? '✓ Copied' : 'Copy'}</button>
            {wa && <a className="btn cl-wa" href={wa} target="_blank" rel="noreferrer">Open in WhatsApp</a>}
            {stage === 'CONTACTED' && <button className="btn primary" disabled={!!busy} onClick={() => void move('FOLLOW_UP_1', undefined, { messageId: result.message.id })}>✓ Follow-up 1 sent</button>}
            {stage === 'FOLLOW_UP_1' && <button className="btn primary" disabled={!!busy} onClick={() => void move('FOLLOW_UP_2', undefined, { messageId: result.message.id })}>✓ Follow-up 2 sent</button>}
          </div>
          {result.followUp.internalQuote && <Notice tone="info">{result.followUp.internalQuote}</Notice>}
          <ul className="sl-plain">{result.followUp.guidance.map((g) => <li key={g}>{g}</li>)}</ul>
          {result.followUp.questions.length > 0 && (
            <><h5>Questions to ask</h5><ol className="sl-plain">{result.followUp.questions.map((q) => <li key={q.text}>{q.text} <span className="muted small">— {q.why}</span></li>)}</ol></>
          )}
          {result.followUp.nextFollowUpInDays !== undefined && <p className="muted small">Suggested next follow-up: in {result.followUp.nextFollowUpInDays} day(s).</p>}
        </div>
      )}

      {showQuestions && (
        <Section title="Discovery questions — ask the most relevant few">
          <ol className="sl-plain">{p.discoveryQuestions.map((q) => <li key={q.text}>{q.text} <span className="muted small">— {q.why}</span></li>)}</ol>
        </Section>
      )}

      {p.messages.filter((m) => m.kind === 'FOLLOW_UP').length > 0 && (
        <details className="cl-sources"><summary>Earlier follow-up drafts</summary>
          <ul>{p.messages.filter((m) => m.kind === 'FOLLOW_UP').map((m) => <li key={m.id}><strong>{m.variant.replace(/_/g, ' ').toLowerCase()}</strong> ({m.status.toLowerCase()}, {fmtDate(m.createdAt)}): {m.body}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/* ----------------------------------- call ---------------------------------- */

function CallTab({ p, busy, run, openMeeting }: { p: LeadProfile; busy: string | null; run: RunFn; openMeeting: () => void }) {
  const c = p.callPrep;
  const [note, setNote] = useState('');
  const meetings = p.meetings.filter((m) => m.status === 'SCHEDULED');
  return (
    <div className="sl-tabbody">
      <div className="cl-actions">
        {p.contact.callNumber && <a className="btn primary" href={`tel:${p.contact.callNumber}`}>📞 Call {p.contact.callNumber}</a>}
        <button className="btn" onClick={openMeeting}>📅 Book meeting</button>
      </div>
      {meetings.length > 0 && (
        <Section title="Booked">
          <ul className="sl-plain">{meetings.map((m) => (
            <li key={m.id} className="sl-fu"><span><strong>{fmtDateTime(m.scheduledAt)}</strong> · {m.kind.toLowerCase()}{m.notes ? ` — ${m.notes}` : ''}</span>
              <span className="sl-fu-btns">
                <button className="btn small" disabled={!!busy} onClick={() => void run('m-done', () => api.updateMeeting(m.id, 'DONE'), 'Meeting marked done.')}>Done</button>
                <button className="btn small" disabled={!!busy} onClick={() => void run('m-x', () => api.updateMeeting(m.id, 'CANCELLED'))}>Cancel</button>
              </span></li>
          ))}</ul>
        </Section>
      )}

      <Section title="Prepare for call">
        <h5>Business summary</h5><FactList facts={c.businessSummary} />
        <h5>What they do</h5><FactList facts={[c.whatTheyDo]} />
        <h5>Likely need</h5><FactList facts={[c.likelyNeed]} />
        {c.knownProblems.length > 0 && <><h5>Known problems</h5><FactList facts={c.knownProblems} /></>}
        <h5>Why {p.brief.business} was contacted</h5><p>{c.whyWeContacted}</p>
        <h5>Proposed solution</h5><p>{c.proposedSolution}</p>
        <h5>Questions to ask</h5>
        <ol className="sl-plain">{c.questionsToAsk.map((q) => <li key={q.text}>{q.text}</li>)}</ol>
        <h5>Next step</h5><p>{c.nextStep}</p>
      </Section>

      <Section title="Possible objections — and how to respond">
        {c.objections.map((o) => (
          <details key={o.objection} className="cl-sources"><summary>“{o.objection}”</summary><p>{o.response}</p></details>
        ))}
      </Section>

      <Section title="Call guide (adapt it — don't read it out)">
        <ol className="sl-plan">{p.callGuide.map((s) => (
          <li key={s.step}><strong>{s.title}</strong> <span className="muted">— {s.goal}</span>
            <ul className="sl-plain">{s.talkingPoints.map((t, i) => <li key={i}>{t}</li>)}</ul></li>
        ))}</ol>
      </Section>

      <Section title="Log the call">
        <textarea className="cl-msg" rows={3} placeholder="What did they say? Any next step?" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn big" disabled={!!busy || !note.trim()} onClick={async () => { if (await run('call', () => api.logActivity(p.lead.prospectId, 'CALL', note.trim()), 'Call logged.')) setNote(''); }}>Save call note</button>
      </Section>
    </div>
  );
}

/* ------------------------------ offer / proposal --------------------------- */

function OfferTab({ p, busy, run }: { p: LeadProfile; busy: string | null; run: RunFn }) {
  const [offer, setOffer] = useState<OfferType>(p.brief.offer.offer);
  return (
    <div className="sl-tabbody">
      <Section title="Recommended offer"><OfferSummary p={p} /></Section>
      <Section title="Demo">
        <DemoBlock p={p} />
        {p.state.demoStatus !== 'SENT' && (
          <button className="btn big" disabled={!!busy} onClick={() => void run('demo', () => api.updateLead(p.lead.prospectId, { demoStatus: 'SENT' }), 'Demo marked as sent — a feedback follow-up is scheduled.')}>Mark demo as sent</button>
        )}
      </Section>

      <Section title="Create a proposal">
        <label className="wide"><span className="muted small">Offer</span>
          <select className="cl-input" value={offer} onChange={(e) => setOffer(e.target.value as OfferType)}>
            {OFFER_TYPES.map((o) => <option key={o} value={o}>{OFFER_LABEL[o]}{o === p.brief.offer.offer ? ' (recommended)' : ''}</option>)}
          </select>
        </label>
        <button className="btn primary big" disabled={!!busy || p.state.stage === 'WON' || p.state.stage === 'LOST' || p.state.stage === 'NOT_A_FIT'} onClick={() => void run('prop', () => api.createProposal(p.lead.prospectId, offer), 'Proposal drafted — review it below.')}>{busy === 'prop' ? 'Drafting…' : 'Create proposal'}</button>
      </Section>

      {p.proposals.map((pr) => <ProposalCard key={pr.id + pr.status + pr.updatedAt} pr={pr} busy={busy} run={run} />)}
    </div>
  );
}

function ProposalCard({ pr, busy, run }: { pr: LeadProfile['proposals'][number]; busy: string | null; run: RunFn }) {
  const [body, setBody] = useState(pr.body);
  const [copied, setCopied] = useState(false);
  const manual = pr.quote.priceStatus === 'MANUAL_REVIEW_REQUIRED';
  return (
    <div className="cl-card sl-msg">
      <div className="sl-msg-head"><strong>{OFFER_LABEL[pr.offerType]} proposal</strong><Badge tone={pr.status === 'ACCEPTED' ? 'green' : pr.status === 'REJECTED' ? 'red' : pr.status === 'SENT' ? 'blue' : 'gray'}>{pr.status}</Badge></div>
      <QuoteBlock quote={pr.quote} />
      <textarea className="cl-msg" rows={14} value={body} onChange={(e) => setBody(e.target.value)} readOnly={pr.status !== 'DRAFT'} />
      <div className="cl-actions">
        <button className="btn" onClick={async () => { setCopied(await copyText(body)); setTimeout(() => setCopied(false), 1800); }}>{copied ? '✓ Copied' : 'Copy'}</button>
        {pr.status === 'DRAFT' && (
          <button className="btn primary" disabled={!!busy} onClick={() => {
            if (manual && !window.confirm('Some prices are not set (MANUAL_REVIEW_REQUIRED). Only mark it sent if you have filled the prices in by hand. Continue?')) return;
            void run('prop-sent', () => api.setProposalStatus(pr.id, 'SENT', { body, acknowledgeManualPrice: manual }), 'Proposal marked as sent — a chase is scheduled.');
          }}>✓ I sent it</button>
        )}
        {pr.status === 'SENT' && <button className="btn primary" disabled={!!busy} onClick={() => void run('prop-acc', () => api.setProposalStatus(pr.id, 'ACCEPTED'), 'Accepted — now mark the lead won with the agreed value.')}>They accepted</button>}
        {pr.status === 'SENT' && <button className="btn" disabled={!!busy} onClick={() => void run('prop-rej', () => api.setProposalStatus(pr.id, 'REJECTED'))}>Rejected</button>}
      </div>
      {pr.sentAt && <p className="muted small">Sent {fmtDate(pr.sentAt)}.</p>}
    </div>
  );
}

/* -------------------------------- timeline --------------------------------- */

function TimelineTab({ p, busy, run }: { p: LeadProfile; busy: string | null; run: RunFn }) {
  const [note, setNote] = useState('');
  return (
    <div className="sl-tabbody">
      <Section title="Add a note">
        <textarea className="cl-msg" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth remembering about this lead" />
        <button className="btn big" disabled={!!busy || !note.trim()} onClick={async () => { if (await run('note', () => api.logActivity(p.lead.prospectId, 'NOTE', note.trim()), 'Note saved.')) setNote(''); }}>Save note</button>
        {(p.state.stage === 'CONTACTED' || p.state.stage.startsWith('FOLLOW_UP')) && (
          <button className="btn big" disabled={!!busy} onClick={() => void run('reply-note', () => api.logActivity(p.lead.prospectId, 'REPLY_RECEIVED', 'Reply received (logged as a note).'))}>Log “reply received” note</button>
        )}
      </Section>
      <Section title="Everything that has happened">
        <ol className="sl-timeline">
          {p.activities.map((a) => (
            <li key={a.id}><span className="sl-when">{fmtDate(a.createdAt)}</span> — {a.summary}</li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
