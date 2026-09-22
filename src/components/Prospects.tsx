import { useMemo, useState } from 'react';
import { useStore, backendConfigured } from '../store';
import { discoverProspectsNow, BackendError } from '../services/backendApi';
import { Badge, DataSourceBadge, Panel } from './ui';
import { ProspectDrawer } from './ProspectDrawer';
import type { Prospect, ProspectStatus } from '../types';

const PRIORITY_TONE: Record<Prospect['priority'], 'green' | 'blue' | 'amber' | 'gray'> = {
  HIGH: 'green',
  MEDIUM: 'blue',
  LOW: 'amber',
  DO_NOT_CONTACT: 'gray',
};

const STATUS_FILTERS: (ProspectStatus | 'ALL' | 'ACTIVE')[] = [
  'ALL',
  'ACTIVE',
  'DISCOVERED',
  'QUALIFIED',
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'PROPOSAL_SENT',
  'NEGOTIATING',
  'WON',
  'LOST',
  'NOT_INTERESTED',
];

const ACTIVE_STATUSES: ProspectStatus[] = [
  'DISCOVERED',
  'QUALIFIED',
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'PROPOSAL_SENT',
  'NEGOTIATING',
  'FOLLOW_UP',
];

export function Prospects() {
  const prospects = useStore((s) => s.prospects);
  const outreachMessages = useStore((s) => s.outreachMessages);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('ACTIVE');
  const [priorityFilter, setPriorityFilter] = useState<Prospect['priority'] | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('Zimbabwe');
  const [searchQuery, setSearchQuery] = useState('restaurant OR cafe OR hotel');
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverMessage, setDiscoverMessage] = useState<string | null>(null);

  const pipeline = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of prospects) counts[p.status] = (counts[p.status] ?? 0) + 1;
    return counts;
  }, [prospects]);

  const filtered = useMemo(() => {
    let list = prospects.filter((p) => {
      if (statusFilter === 'ACTIVE' && !ACTIVE_STATUSES.includes(p.status)) return false;
      if (statusFilter !== 'ALL' && statusFilter !== 'ACTIVE' && p.status !== statusFilter) return false;
      if (priorityFilter !== 'ALL' && p.priority !== priorityFilter) return false;
      if (q) {
        const hay = `${p.businessName} ${p.category} ${p.location} ${p.opportunityName}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => b.score.expectedValue - a.score.expectedValue);
  }, [prospects, statusFilter, priorityFilter, q]);

  const drawerProspect = drawerId ? prospects.find((p) => p.id === drawerId) ?? null : null;
  const syncFromBackend = useStore((s) => s.syncFromBackend);
  const discoverNow = async () => {
    setDiscoverBusy(true);
    setDiscoverMessage(null);
    try {
      const result = await discoverProspectsNow({
        region: region.trim() || 'Zimbabwe',
        searchQuery: searchQuery.trim() || undefined,
      });
      await syncFromBackend();
      setDiscoverMessage(`Found ${result.discovered} businesses; ${result.verified} passed identity/contact verification. ${result.rejectedUnverifiedOrConflicting} were rejected because the evidence was insufficient or conflicting.`);
    } catch (e) {
      setDiscoverMessage(e instanceof BackendError ? e.message : (e as Error).message || 'Business discovery failed.');
    } finally {
      setDiscoverBusy(false);
    }
  };

  const highPriority = prospects.filter((p) => p.priority === 'HIGH').length;
  const dueFollowUps = prospects.filter((p) => p.nextFollowUpAt && p.nextFollowUpAt <= Date.now()).length;

  return (
    <div className="view-enter">
      <div className="warn-banner">
        Prospects are real businesses surfaced by live web search — never fabricated. Survivor verifies identity and public contact evidence before adding a business to the CRM. Outreach messages are AI-drafted drafts for a human to review and send; SURVIVE AI
        never contacts anyone automatically.
      </div>

      <div className="panel" style={{ marginBottom: 14, padding: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Find real businesses now</div>
        <div className="faint small" style={{ marginBottom: 10 }}>
          Survivor searches live sources, then verifies the business identity and contact before adding it to the CRM.
          Unverified or conflicting contacts are rejected.
        </div>
        <div className="filter-bar" style={{ marginBottom: 8 }}>
          <input className="text-input" placeholder="Area, e.g. Harare" value={region} onChange={(e) => setRegion(e.target.value)} />
          <input className="text-input" placeholder="What businesses? e.g. hotels, restaurants" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          <button className="btn primary" disabled={!backendConfigured || discoverBusy} onClick={discoverNow}>
            {discoverBusy ? 'Searching & verifying…' : 'Find businesses now'}
          </button>
        </div>
        {discoverMessage && <div className="small" role="status">{discoverMessage}</div>}
        {!backendConfigured && <div className="faint small">Live backend is not configured.</div>}
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Panel tight>
          <div className="stat">
            <div className="stat-label">Prospects discovered</div>
            <div className="stat-value">{prospects.length}</div>
          </div>
        </Panel>
        <Panel tight>
          <div className="stat">
            <div className="stat-label">High priority</div>
            <div className="stat-value">{highPriority}</div>
          </div>
        </Panel>
        <Panel tight>
          <div className="stat">
            <div className="stat-label">Outreach drafted</div>
            <div className="stat-value">{outreachMessages.length}</div>
          </div>
        </Panel>
        <Panel tight>
          <div className="stat">
            <div className="stat-label">Follow-ups due</div>
            <div className="stat-value">{dueFollowUps}</div>
          </div>
        </Panel>
      </div>

      <div className="filter-bar">
        <input
          className="text-input"
          placeholder="Search business, category, location…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === 'ALL' ? 'Status: any' : s === 'ACTIVE' ? 'Status: active pipeline' : s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select className="select" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}>
          <option value="ALL">Priority: any</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
          <option value="DO_NOT_CONTACT">DO NOT CONTACT</option>
        </select>
      </div>

      <div className="faint small mono" style={{ marginBottom: 12 }}>
        {filtered.length} of {prospects.length} prospects · pipeline:{' '}
        {Object.entries(pipeline)
          .map(([k, v]) => `${k.replace('_', ' ')} ${v}`)
          .join(' · ') || 'empty'}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          {prospects.length === 0
            ? 'No prospects yet — use “Find businesses now” above to search live sources. Survivor will verify the business identity and public contact evidence before adding it.'
            : 'No prospects match these filters.'}
        </div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Priority</th>
              <th>Business</th>
              <th>Category / location</th>
              <th>Contact</th>
              <th>Website</th>
              <th>Lead score</th>
              <th>Expected value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => setDrawerId(p.id)}>
                <td>
                  <Badge tone={PRIORITY_TONE[p.priority]}>{p.priority}</Badge>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{p.businessName}</div>
                  <div className="faint small mono">for {p.opportunityName}</div>
                </td>
                <td className="small">
                  {p.category}
                  <div className="faint small mono">{p.location}</div>
                </td>
                <td className="small">
                  <div style={{ fontWeight: 600 }}>{p.verification?.verifiedContactValue ?? p.verification?.verifiedEmail ?? p.contactValue ?? 'Not found'}</div>
                  <div className="faint small mono">{p.verification?.status ?? 'UNVERIFIED'}{p.verification?.confidence ? ` · ${p.verification.confidence}%` : ''}</div>
                </td>
                <td className="small">{p.websiteUrl ? <a href={p.websiteUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open website</a> : p.websitePresence.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="num" style={{ fontWeight: 700 }}>{p.score.total}</td>
                <td className="num small">${p.score.expectedValue.toFixed(0)}</td>
                <td>
                  <span className="stage-badge lit small">{p.status.replace('_', ' ')}</span>
                  <DataSourceBadge source={p.dataSource} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {drawerProspect && <ProspectDrawer prospect={drawerProspect} onClose={() => setDrawerId(null)} />}
    </div>
  );
}
