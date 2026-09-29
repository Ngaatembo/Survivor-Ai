/* ============================================================================
 * Sales — the daily cockpit.
 * ----------------------------------------------------------------------------
 * Answers, every day: WHO to contact, WHY, HOW, WHAT to say, and what to do
 * next. Survivor recommends; you decide and send. Tabs:
 *   Today · Pipeline (kanban) · Analytics · Settings
 * ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from './ui';
import { UnlockForm, useOperatorSession } from './Clients';
import { SalesLead, type LeadTab } from './SalesLead';
import { SalesAnalyticsView, SalesSettingsView } from './SalesInsights';
import { Notice, StageBadge, errText, fmtDate, fmtDateTime, fmtDue } from './salesUi';
import { getPipeline, type LeadSummary, type PipelineResponse } from '../services/salesApi';
import { backendConfigured } from '../store';
import { CHANNEL_LABEL, SALES_STAGES, STAGE_LABEL, type SalesAction, type SalesStage } from '../sales/types';

type Tab = 'today' | 'pipeline' | 'analytics' | 'settings';
const TAB_LABEL: Record<Tab, string> = { today: 'Today', pipeline: 'Pipeline', analytics: 'Analytics', settings: 'Settings' };

const CTA_LABEL: Record<SalesAction['cta'], string> = {
  GENERATE_MESSAGE: 'Generate message',
  VIEW_MESSAGE: 'View message',
  FOLLOW_UP: 'Open follow-up',
  PREPARE_CALL: 'Prepare for call',
  OPEN_LEAD: 'Open lead',
  RESEARCH: 'Generate research',
};
const CTA_TAB: Record<SalesAction['cta'], LeadTab> = {
  GENERATE_MESSAGE: 'message', VIEW_MESSAGE: 'message', FOLLOW_UP: 'followup', PREPARE_CALL: 'call', OPEN_LEAD: 'brief', RESEARCH: 'brief',
};
const PRIORITY_TONE = { HIGH: 'red', MEDIUM: 'amber', LOW: 'gray' } as const;

interface Open { id: string; tab?: LeadTab; autoResearch?: boolean }

export function Sales() {
  const session = useOperatorSession();
  const [tab, setTab] = useState<Tab>('today');
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Open | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getPipeline());
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  if (!backendConfigured) {
    return <div className="cl sl"><div className="cl-card"><h2>Sales cockpit</h2><p className="muted">The live backend is not configured, so there are no leads to work.</p></div></div>;
  }

  if (!session) {
    return (
      <div className="cl sl">
        <section className="cl-card cl-locked">
          <h2>Unlock your sales cockpit</h2>
          <p className="muted">Your leads, contact details and prices are private. Enter your operator secret to open them.</p>
          <UnlockForm />
        </section>
      </div>
    );
  }

  const counts = data?.counts;
  const stats: { label: string; value: number; onClick?: () => void }[] = counts
    ? [
        { label: 'Qualified leads', value: counts.totalQualified },
        { label: 'Ready to contact', value: counts.readyToContact },
        { label: 'Contacted', value: counts.contacted },
        { label: 'Awaiting reply', value: counts.awaitingResponse },
        { label: 'Replied', value: counts.replied },
        { label: 'Interested', value: counts.interested },
        { label: 'Meetings', value: counts.meetings },
        { label: 'Proposals', value: counts.proposals },
        { label: 'Won', value: counts.won },
        { label: 'Lost', value: counts.lost },
        { label: 'Dormant', value: counts.dormant },
      ]
    : [];

  return (
    <div className="cl sl">
      {error && <Notice tone="err">{error}</Notice>}

      <div className="sl-stats">
        {stats.map((s) => (
          <div key={s.label} className={`cl-stat${s.value > 0 && ['Won'].includes(s.label) ? ' on' : ''}`}>
            <strong>{s.value}</strong>
            <span>{s.label}</span>
          </div>
        ))}
        {!counts && <div className="cl-empty" style={{ gridColumn: '1 / -1' }}>{loading ? 'Loading your pipeline…' : 'No data yet.'}</div>}
      </div>

      <div className="cl-tabs">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button key={t} className={`cl-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
            {t === 'today' && data ? <span>{data.today.actions.length}</span> : null}
          </button>
        ))}
        <button className="cl-tab" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh'}</button>
      </div>

      {tab === 'today' && data && <TodayView data={data} onOpen={setOpen} />}
      {tab === 'pipeline' && data && <PipelineBoard leads={data.leads} onOpen={(id) => setOpen({ id })} />}
      {tab === 'analytics' && <SalesAnalyticsView />}
      {tab === 'settings' && <SalesSettingsView />}

      {open && (
        <SalesLead
          key={open.id}
          prospectId={open.id}
          initialTab={open.tab}
          autoResearch={open.autoResearch}
          onClose={() => setOpen(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

/* --------------------------------- today ---------------------------------- */

function TodayView({ data, onOpen }: { data: PipelineResponse; onOpen: (o: Open) => void }) {
  const t = data.today;
  const empty = t.actions.length === 0;
  const launch = (a: SalesAction) => onOpen({ id: a.prospectId, tab: CTA_TAB[a.cta], autoResearch: a.cta === 'RESEARCH' });

  return (
    <>
      <section className="cl-card">
        <h2>Today's sales actions</h2>
        <p className="muted">Who to contact, why, and what to do next — most important first.</p>
      </section>

      {empty && (
        <div className="cl-empty">
          Nothing is due today. {data.counts.total === 0
            ? 'There are no leads yet — use “Find clients” to discover some, then come back here.'
            : 'New leads appear here once they are qualified, and follow-ups appear the day they are due.'}
        </div>
      )}

      <div className="cl-list">
        {t.actions.map((a, i) => (
          <div key={`${a.prospectId}:${a.kind}`} className={`cl-lead sl-action ${a.priority.toLowerCase()}${a.overdue ? ' due' : ''}`}>
            <div className="cl-lead-head">
              <div>
                <h3>{i + 1}. {a.businessName}</h3>
                <div className="cl-meta">{a.title}</div>
              </div>
              <Badge tone={PRIORITY_TONE[a.priority]}>{a.priority}</Badge>
            </div>
            <p className="sl-reason"><strong>Why:</strong> {a.reason}</p>
            <div className="cl-facts">
              <StageBadge stage={a.stage} />
              {a.channel && <span className="cl-tag">{CHANNEL_LABEL[a.channel]}</span>}
              {a.dueAt && <span className={`cl-tag${a.overdue ? ' warn' : ''}`}>Due {fmtDue(a.dueAt)}</span>}
            </div>
            <button className="btn primary big" onClick={() => launch(a)}>{CTA_LABEL[a.cta]}</button>
          </div>
        ))}
      </div>

      {t.overdueFollowUps.length > 0 && (
        <MiniList title={`Overdue follow-ups (${t.overdueFollowUps.length})`}>
          {t.overdueFollowUps.map((a) => (
            <Row key={a.prospectId} name={a.businessName} sub={`${a.title} — due ${fmtDue(a.dueAt)}`} onClick={() => launch(a)} />
          ))}
        </MiniList>
      )}

      {t.manualResearch.length > 0 && (
        <MiniList title={`Need manual research (${t.manualResearch.length})`} note="No direct contact channel is on record — find the decision-maker or a phone/WhatsApp number, then add it to the lead.">
          {t.manualResearch.map((a) => (
            <Row key={a.prospectId} name={a.businessName} sub="NO_DIRECT_CHANNEL" onClick={() => onOpen({ id: a.prospectId, tab: 'brief' })} />
          ))}
        </MiniList>
      )}

      {t.upcomingMeetings.length > 0 && (
        <MiniList title={`Meetings coming up (${t.upcomingMeetings.length})`}>
          {t.upcomingMeetings.map((m, i) => (
            <Row key={m.prospectId + i} name={m.businessName} sub={`${m.kind.toLowerCase()} · ${fmtDateTime(m.scheduledAt)}`} onClick={() => onOpen({ id: m.prospectId, tab: 'call' })} />
          ))}
        </MiniList>
      )}

      {t.awaitingReply.length > 0 && (
        <MiniList title={`Waiting for a reply (${t.awaitingReply.length})`}>
          {t.awaitingReply.map((l) => (
            <Row key={l.prospectId} name={l.businessName} sub={`${STAGE_LABEL[l.stage]} · ${l.daysWaiting} day(s) waiting${l.nextDueAt ? ` · next step ${fmtDue(l.nextDueAt)}` : ''}`} onClick={() => onOpen({ id: l.prospectId, tab: 'followup' })} />
          ))}
        </MiniList>
      )}

      {t.proposalsAwaiting.length > 0 && (
        <MiniList title={`Proposals awaiting response (${t.proposalsAwaiting.length})`}>
          {t.proposalsAwaiting.map((p) => (
            <Row key={p.prospectId} name={p.businessName} sub={`Sent ${fmtDate(p.sentAt)} · ${p.daysWaiting} day(s) ago${p.total ? ` · $${p.total}` : ''}`} onClick={() => onOpen({ id: p.prospectId, tab: 'offer' })} />
          ))}
        </MiniList>
      )}
    </>
  );
}

function MiniList({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="cl-card sl-mini">
      <h2>{title}</h2>
      {note && <p className="muted">{note}</p>}
      <div className="sl-rows">{children}</div>
    </section>
  );
}

function Row({ name, sub, onClick }: { name: string; sub: string; onClick: () => void }) {
  return (
    <button className="sl-row" onClick={onClick}>
      <strong>{name}</strong>
      <span>{sub}</span>
    </button>
  );
}

/* -------------------------------- pipeline -------------------------------- */

const MAX_PER_COLUMN = 30;

function PipelineBoard({ leads, onOpen }: { leads: LeadSummary[]; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<SalesStage>>(new Set());

  const byStage = useMemo(() => {
    const q = query.trim().toLowerCase();
    const m = new Map<SalesStage, LeadSummary[]>();
    for (const s of SALES_STAGES) m.set(s, []);
    for (const l of leads) {
      if (q && !`${l.businessName} ${l.category} ${l.location}`.toLowerCase().includes(q)) continue;
      m.get(l.stage)!.push(l);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.score - a.score);
    return m;
  }, [leads, query]);

  return (
    <>
      <input className="cl-input" placeholder="Search leads by name, type or town" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="sl-board">
        {SALES_STAGES.map((stage) => {
          const items = byStage.get(stage)!;
          const shown = expanded.has(stage) ? items : items.slice(0, MAX_PER_COLUMN);
          return (
            <div key={stage} className="sl-col">
              <div className="sl-col-head"><strong>{STAGE_LABEL[stage]}</strong><span>{items.length}</span></div>
              {items.length === 0 && <div className="sl-col-empty">—</div>}
              {shown.map((l) => (
                <button key={l.prospectId} className={`sl-card${l.paused ? ' paused' : ''}`} onClick={() => onOpen(l.prospectId)}>
                  <strong>{l.businessName}</strong>
                  <span className="sl-card-sub">{[l.category, l.location].filter(Boolean).join(' · ')}</span>
                  <span className="cl-facts">
                    <span className="cl-tag">Score {l.score}</span>
                    {l.channel && <span className="cl-tag">{CHANNEL_LABEL[l.channel]}</span>}
                    {l.channelStatus === 'NO_DIRECT_CHANNEL' && <span className="cl-tag warn">No channel</span>}
                    {l.paused && <span className="cl-tag">Paused</span>}
                  </span>
                  {l.nextActionAt && <span className="sl-card-sub">Next: {fmtDue(l.nextActionAt)}</span>}
                </button>
              ))}
              {items.length > shown.length && (
                <button className="link-btn" onClick={() => setExpanded(new Set(expanded).add(stage))}>Show {items.length - shown.length} more</button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
