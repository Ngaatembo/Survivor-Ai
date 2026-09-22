import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { researchIncomeChannels, type IncomeChannelOpportunity } from '../services/backendApi';
import { Panel, Badge } from './ui';

type Draft = {
  id: string;
  platform: 'WhatsApp' | 'Facebook' | 'LinkedIn' | 'TikTok';
  purpose: 'AWARENESS' | 'PROOF' | 'LEAD' | 'MONETIZATION';
  hook: string;
  body: string;
  cta: string;
  sourceTitle: string;
  sourceUrl?: string;
  createdAt: number;
};

const PLATFORM_HINTS: Draft['platform'][] = ['WhatsApp', 'Facebook', 'LinkedIn', 'TikTok'];

function makeDraft(o: IncomeChannelOpportunity, platform: Draft['platform'], purpose: Draft['purpose']): Draft {
  const clean = o.description.replace(/\s+/g, ' ').trim();
  const topic = o.title.trim();
  const evidence = clean.length > 280 ? clean.slice(0, 277) + '…' : clean;
  const hooks: Record<Draft['purpose'], string> = {
    AWARENESS: `A practical question worth answering: ${topic}`,
    PROOF: `Here's what the research is showing about ${topic}.`,
    LEAD: `If you're dealing with ${topic.toLowerCase()}, this may help.`,
    MONETIZATION: `There's a real business question behind ${topic.toLowerCase()}.`,
  };
  const ctas: Record<Draft['purpose'], string> = {
    AWARENESS: 'Follow for practical business and technology research.',
    PROOF: 'If this is a problem in your business, message me and I can look at the specific case.',
    LEAD: 'If you want me to research your business specifically, send me the business name.',
    MONETIZATION: 'I only recommend a paid path after the demand and terms can be verified.',
  };
  const body = platform === 'TikTok'
    ? `Hook: ${hooks[purpose]}\n\nExplain: ${evidence}\n\nClose: ${ctas[purpose]}`
    : `${hooks[purpose]}\n\n${evidence}\n\nThe important part is to separate what the evidence actually shows from assumptions. Survivor uses this approach so content can lead to a real business action instead of chasing views alone.\n\n${ctas[purpose]}`;
  return { id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, platform, purpose, hook: hooks[purpose], body, cta: ctas[purpose], sourceTitle: o.title, sourceUrl: o.sourceUrls[0], createdAt: Date.now() };
}

export function ContentHub() {
  const backendConnected = useStore((s) => s.backend.connected);
  const realRevenue = useStore((s) => s.realRevenue);
  const [research, setResearch] = useState<IncomeChannelOpportunity[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [platform, setPlatform] = useState<Draft['platform']>('WhatsApp');
  const [purpose, setPurpose] = useState<Draft['purpose']>('LEAD');

  const researchNow = async () => {
    if (!backendConnected || busy) return;
    setBusy(true); setError('');
    try {
      const result = await researchIncomeChannels('CONTENT_SOCIAL');
      setResearch(result.opportunities.filter((o) => o.channel === 'CONTENT_SOCIAL'));
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const generate = () => {
    const source = research[0];
    if (!source) { setError('Research content demand first. Survivor will not generate a research-backed draft without evidence.'); return; }
    setDrafts((d) => [makeDraft(source, platform, purpose), ...d].slice(0, 30));
  };

  const revenue = useMemo(() => realRevenue
    .filter((r) => /content|social|creator|affiliate/i.test(r.acquisitionChannel || ''))
    .reduce((sum, r) => sum + r.amountReceived, 0), [realRevenue]);

  return <div className="view-enter">
    <div className="info-banner"><strong>Content Income Engine.</strong> Survivor treats content as an economic channel: research demand → create → human publishes → measure → monetize → record real revenue. It does not auto-publish.</div>
    {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

    <div className="grid cols-4" style={{ marginBottom: 14 }}>
      <Panel tight><div className="stat-label">RESEARCH SIGNALS</div><div className="stat-value">{research.length}</div><div className="faint small">live evidence items</div></Panel>
      <Panel tight><div className="stat-label">DRAFTS</div><div className="stat-value">{drafts.length}</div><div className="faint small">human review required</div></Panel>
      <Panel tight><div className="stat-label">REAL CONTENT REVENUE</div><div className="stat-value">{revenue.toFixed(2)} USD</div><div className="faint small">recorded revenue only</div></Panel>
      <Panel tight><div className="stat-label">PUBLISHING</div><div className="stat-value">MANUAL</div><div className="faint small">no autonomous posting</div></Panel>
    </div>

    <Panel title="1. RESEARCH WHAT PEOPLE MAY CARE ABOUT" right={<button className="btn primary small" disabled={!backendConnected || busy} onClick={() => void researchNow()}>{busy ? 'Researching…' : 'Research content demand'}</button>}>
      {research.length === 0 ? <div className="empty">No fresh content signals yet. Research uses the same live search/evidence pipeline as Survivor's income intelligence.</div> :
        <div className="feed" style={{ maxHeight: 340, overflowY: 'auto' }}>{research.map((o) =>
          <div className="event" key={o.id} style={{ display: 'block', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{o.title}</strong><Badge tone="blue">CONTENT_SOCIAL</Badge></div>
            <div className="muted small" style={{ marginTop: 5, lineHeight: 1.5 }}>{o.description}</div>
            <div className="faint small" style={{ marginTop: 5 }}>Evidence: {o.evidence}</div>
            {o.sourceUrls[0] && <a className="faint small" href={o.sourceUrls[0]} target="_blank" rel="noreferrer">Open source ↗</a>}
          </div>
        )}</div>}
    </Panel>

    <Panel title="2. CREATE A CONTENT EXPERIMENT">
      <div className="grid cols-3">
        <label className="small muted">Platform<select value={platform} onChange={(e) => setPlatform(e.target.value as Draft['platform'])}>{PLATFORM_HINTS.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label className="small muted">Purpose<select value={purpose} onChange={(e) => setPurpose(e.target.value as Draft['purpose'])}>{['AWARENESS','PROOF','LEAD','MONETIZATION'].map((p) => <option key={p}>{p}</option>)}</select></label>
        <div style={{ display: 'flex', alignItems: 'end' }}><button className="btn" onClick={generate}>Generate evidence-backed draft</button></div>
      </div>
      <div className="faint small" style={{ marginTop: 10 }}>The draft is grounded in a live research signal. Review every claim before publishing; no post is automatically sent.</div>
    </Panel>

    <Panel title="3. DRAFT QUEUE" right={<span className="faint small mono">HUMAN APPROVAL</span>}>
      {drafts.length === 0 ? <div className="empty">Generated drafts will appear here.</div> :
        drafts.map((d) => <div key={d.id} className="event" style={{ display: 'block', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{d.hook}</strong><Badge tone="amber">{d.platform} · {d.purpose}</Badge></div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55, margin: '10px 0' }}>{d.body}</pre>
          <div className="faint small">Source: {d.sourceTitle} {d.sourceUrl ? '· evidence linked above' : ''}</div>
        </div>)}
    </Panel>

    <Panel title="4. CONTENT → AUDIENCE → OFFER → REVENUE">
      <div className="small muted" style={{ lineHeight: 1.8 }}>
        Survivor should not optimize this channel for views alone. Record the content, distribution result, lead/click outcome, monetization terms and actual payment so the economic brain can learn which content produces useful business outcomes.
      </div>
      <div className="grid cols-4" style={{ marginTop: 12 }}>
        <div className="event"><strong>Audience</strong><div className="faint small">Use connected platform analytics when available.</div></div>
        <div className="event"><strong>Offer</strong><div className="faint small">Link content to NWT Dev, products, referrals or another verified offer.</div></div>
        <div className="event"><strong>Revenue</strong><div className="faint small">Only human-recorded real revenue counts.</div></div>
        <div className="event"><strong>Learning</strong><div className="faint small">Compare topic/platform/action with actual outcomes.</div></div>
      </div>
    </Panel>
  </div>;
}
