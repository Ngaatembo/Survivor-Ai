import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  fetchContentState,
  researchIncomeChannels,
  saveContentState,
  type ContentDraft,
  type IncomeChannelOpportunity,
} from '../services/backendApi';
import { Panel, Badge } from './ui';

const PLATFORMS: ContentDraft['platform'][] = ['WhatsApp', 'Facebook', 'LinkedIn', 'TikTok'];
const PURPOSES: ContentDraft['purpose'][] = ['AWARENESS', 'PROOF', 'LEAD', 'MONETIZATION'];
const EMPTY_METRICS = { reach: 0, impressions: 0, clicks: 0, leads: 0, revenue: 0 };

function makeDraft(o: IncomeChannelOpportunity, platform: ContentDraft['platform'], purpose: ContentDraft['purpose']): ContentDraft {
  const clean = o.description.replace(/\s+/g, ' ').trim();
  const topic = o.title.trim();
  const evidence = clean.length > 280 ? clean.slice(0, 277) + '…' : clean;
  const hooks: Record<ContentDraft['purpose'], string> = {
    AWARENESS: `A practical question worth answering: ${topic}`,
    PROOF: `Here's what the research is showing about ${topic}.`,
    LEAD: `If you're dealing with ${topic.toLowerCase()}, this may help.`,
    MONETIZATION: `There's a real business question behind ${topic.toLowerCase()}.`,
  };
  const ctas: Record<ContentDraft['purpose'], string> = {
    AWARENESS: 'Follow for practical business and technology research.',
    PROOF: 'If this is a problem in your business, message me and I can look at the specific case.',
    LEAD: 'If you want me to research your business specifically, send me the business name.',
    MONETIZATION: 'I only recommend a paid path after the demand and terms can be verified.',
  };
  const body = platform === 'TikTok'
    ? `Hook: ${hooks[purpose]}\n\nExplain: ${evidence}\n\nClose: ${ctas[purpose]}`
    : `${hooks[purpose]}\n\n${evidence}\n\nThe important part is to separate what the evidence actually shows from assumptions. Survivor uses this approach so content can lead to a real business action instead of chasing views alone.\n\n${ctas[purpose]}`;
  return {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    platform, purpose, hook: hooks[purpose], body, cta: ctas[purpose],
    sourceTitle: o.title, sourceUrl: o.sourceUrls[0], sourceId: o.id,
    createdAt: Date.now(), status: 'DRAFT', metrics: { ...EMPTY_METRICS },
  };
}

export function ContentHub() {
  const backendConnected = useStore((s) => s.backend.connected);
  const realRevenue = useStore((s) => s.realRevenue);
  const [research, setResearch] = useState<IncomeChannelOpportunity[]>([]);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [researchedAt, setResearchedAt] = useState<number | null>(null);
  const [selectedSource, setSelectedSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const persist = async (nextResearch: IncomeChannelOpportunity[], nextDrafts: ContentDraft[], nextResearchedAt = researchedAt) => {
    if (!backendConnected) return;
    setSaving(true);
    try {
      await saveContentState({ researchedAt: nextResearchedAt, research: nextResearch, drafts: nextDrafts });
    } catch (e) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  };

  useEffect(() => {
    if (!backendConnected) return;
    void fetchContentState().then(({ state }) => {
      setResearch(state.research ?? []);
      setDrafts(state.drafts ?? []);
      setResearchedAt(state.researchedAt ?? null);
      if (state.research?.[0]) setSelectedSource(state.research[0].id);
    }).catch((e) => setError((e as Error).message));
  }, [backendConnected]);

  const researchNow = async () => {
    if (!backendConnected || busy) return;
    setBusy(true); setError('');
    try {
      const result = await researchIncomeChannels('CONTENT_SOCIAL');
      const nextResearch = result.opportunities.filter((o) => o.channel === 'CONTENT_SOCIAL');
      const at = Date.now();
      setResearch(nextResearch);
      setResearchedAt(at);
      setSelectedSource(nextResearch[0]?.id ?? '');
      await persist(nextResearch, drafts, at);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const generate = (platform: ContentDraft['platform'], purpose: ContentDraft['purpose']) => {
    const source = research.find((r) => r.id === selectedSource);
    if (!source) { setError('Select a research signal first. Survivor will not generate a research-backed draft without evidence.'); return; }
    const draft = makeDraft(source, platform, purpose);
    const next = [draft, ...drafts].slice(0, 100);
    setDrafts(next);
    void persist(research, next);
  };

  const updateDraft = (id: string, patch: Partial<ContentDraft>) => {
    const next = drafts.map((d) => d.id === id ? { ...d, ...patch } : d);
    setDrafts(next);
    void persist(research, next);
  };

  const recordMetrics = (draft: ContentDraft) => {
    const input = window.prompt('Enter metrics as reach,impressions,clicks,leads,revenue (e.g. 500,700,20,3,50):', [
      draft.metrics.reach, draft.metrics.impressions, draft.metrics.clicks, draft.metrics.leads, draft.metrics.revenue,
    ].join(','));
    if (input === null) return;
    const parts = input.split(',').map((v) => Number(v.trim()));
    if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
      setError('Metrics must be five non-negative numbers: reach, impressions, clicks, leads, revenue.');
      return;
    }
    updateDraft(draft.id, { metrics: { reach: parts[0], impressions: parts[1], clicks: parts[2], leads: parts[3], revenue: parts[4] } });
  };

  const contentRevenue = useMemo(() => {
    const tracked = drafts.reduce((sum, d) => sum + d.metrics.revenue, 0);
    const recorded = realRevenue.filter((r) => /content|social|creator|affiliate/i.test(r.acquisitionChannel || '')).reduce((sum, r) => sum + r.amountReceived, 0);
    return { tracked, recorded };
  }, [drafts, realRevenue]);

  const funnel = useMemo(() => ({
    published: drafts.filter((d) => d.status === 'PUBLISHED').length,
    leads: drafts.reduce((sum, d) => sum + d.metrics.leads, 0),
    clicks: drafts.reduce((sum, d) => sum + d.metrics.clicks, 0),
  }), [drafts]);

  return <div className="view-enter">
    <div className="info-banner"><strong>Content Income Engine.</strong> Research demand → create → human publishes → measure → monetize → record real revenue. Drafts and measurements persist in the live backend; publishing remains manual.</div>
    {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

    <div className="grid cols-4" style={{ marginBottom: 14 }}>
      <Panel tight><div className="stat-label">RESEARCH SIGNALS</div><div className="stat-value">{research.length}</div><div className="faint small">{researchedAt ? `updated ${new Date(researchedAt).toLocaleString()}` : 'not researched'}</div></Panel>
      <Panel tight><div className="stat-label">PUBLISHED</div><div className="stat-value">{funnel.published}</div><div className="faint small">manual publishing only</div></Panel>
      <Panel tight><div className="stat-label">LEADS / CLICKS</div><div className="stat-value">{funnel.leads} / {funnel.clicks}</div><div className="faint small">recorded per draft</div></Panel>
      <Panel tight><div className="stat-label">REVENUE</div><div className="stat-value">{contentRevenue.recorded.toFixed(2)} USD</div><div className="faint small">real recorded revenue</div></Panel>
    </div>

    <Panel title="1. RESEARCH DEMAND" right={<button className="btn primary small" disabled={!backendConnected || busy || saving} onClick={() => void researchNow()}>{busy ? 'Researching…' : saving ? 'Saving…' : 'Research content demand'}</button>}>
      {research.length === 0 ? <div className="empty">No fresh content signals yet. Use live research before creating a draft.</div> :
        <div className="feed" style={{ maxHeight: 340, overflowY: 'auto' }}>{research.map((o) =>
          <div className="event" key={o.id} style={{ display: 'block', marginBottom: 8, cursor: 'pointer', outline: selectedSource === o.id ? '1px solid var(--accent)' : undefined }} onClick={() => setSelectedSource(o.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{o.title}</strong><Badge tone={selectedSource === o.id ? 'green' : 'blue'}>{selectedSource === o.id ? 'SELECTED' : 'CONTENT_SOCIAL'}</Badge></div>
            <div className="muted small" style={{ marginTop: 5, lineHeight: 1.5 }}>{o.description}</div>
            <div className="faint small" style={{ marginTop: 5 }}>Evidence: {o.evidence}</div>
            {o.sourceUrls[0] && <a className="faint small" href={o.sourceUrls[0]} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open source ↗</a>}
          </div>
        )}</div>}
    </Panel>

    <Panel title="2. CREATE A DRAFT">
      <div className="grid cols-2">
        <label className="small muted">Research signal<select value={selectedSource} onChange={(e) => setSelectedSource(e.target.value)}>{research.map((o) => <option key={o.id} value={o.id}>{o.title.slice(0, 90)}</option>)}</select></label>
        <div className="faint small" style={{ display: 'flex', alignItems: 'end' }}>{selectedSource ? 'Selected evidence will be attached to the draft.' : 'Select a research signal first.'}</div>
      </div>
      <div className="grid cols-4" style={{ marginTop: 10 }}>
        {PLATFORMS.map((p) => <button key={p} className="btn" disabled={!selectedSource} onClick={() => generate(p, 'LEAD')}>Draft for {p}</button>)}
      </div>
      <div className="grid cols-4" style={{ marginTop: 8 }}>
        {PURPOSES.map((p) => <button key={p} className="btn small" disabled={!selectedSource} onClick={() => generate('WhatsApp', p)}>WhatsApp · {p}</button>)}
      </div>
    </Panel>

    <Panel title="3. DRAFT / PUBLISHING QUEUE" right={<span className="faint small mono">{saving ? 'SAVING…' : 'HUMAN APPROVAL'}</span>}>
      {drafts.length === 0 ? <div className="empty">Generated drafts will appear here.</div> :
        drafts.map((d) => <div key={d.id} className="event" style={{ display: 'block', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{d.hook}</strong><Badge tone={d.status === 'PUBLISHED' ? 'green' : d.status === 'READY' ? 'amber' : 'blue'}>{d.platform} · {d.status}</Badge></div>
          <div className="faint small" style={{ marginTop: 5 }}>Purpose: {d.purpose} · Source: {d.sourceTitle}</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55, margin: '10px 0' }}>{d.body}</pre>
          <div className="grid cols-3">
            <label className="small muted">Campaign<input value={d.campaign ?? ''} onChange={(e) => updateDraft(d.id, { campaign: e.target.value })} placeholder="e.g. Website leads Sep" /></label>
            <label className="small muted">Offer / destination<input value={d.offer ?? ''} onChange={(e) => updateDraft(d.id, { offer: e.target.value })} placeholder="e.g. NWT Dev website audit" /></label>
            <div className="small muted">Actions
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                {d.status === 'DRAFT' && <button className="btn small" onClick={() => updateDraft(d.id, { status: 'READY' })}>Mark ready</button>}
                {d.status === 'READY' && <button className="btn small primary" onClick={() => updateDraft(d.id, { status: 'PUBLISHED', publishedAt: Date.now() })}>Mark published</button>}
                {d.status === 'PUBLISHED' && <button className="btn small" onClick={() => recordMetrics(d)}>Record metrics</button>}
                {d.status !== 'ARCHIVED' && <button className="btn small danger" onClick={() => updateDraft(d.id, { status: 'ARCHIVED' })}>Archive</button>}
              </div>
            </div>
          </div>
          <div className="faint small" style={{ marginTop: 7 }}>
            Metrics: reach {d.metrics.reach} · impressions {d.metrics.impressions} · clicks {d.metrics.clicks} · leads {d.metrics.leads} · tracked revenue {d.metrics.revenue.toFixed(2)}
          </div>
        </div>)}
    </Panel>

    <Panel title="4. CONTENT → AUDIENCE → OFFER → REVENUE → LEARNING">
      <div className="grid cols-4">
        <div className="event"><strong>Audience</strong><div className="faint small">Record reach/impressions after human publication.</div></div>
        <div className="event"><strong>Offer</strong><div className="faint small">Attach the destination or commercial offer used.</div></div>
        <div className="event"><strong>Revenue</strong><div className="faint small">Tracked content revenue: {contentRevenue.tracked.toFixed(2)}; real recorded revenue: {contentRevenue.recorded.toFixed(2)} USD.</div></div>
        <div className="event"><strong>Learning</strong><div className="faint small">Compare platform, purpose, topic, clicks, leads and revenue before deciding what to repeat.</div></div>
      </div>
    </Panel>
  </div>;
}
