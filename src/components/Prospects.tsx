import { useMemo, useState } from 'react';
import { useStore } from '../store';
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
  const highPriority = prospects.filter((p) => p.priority === 'HIGH').length;
  const dueFollowUps = prospects.filter((p) => p.nextFollowUpAt && p.nextFollowUpAt <= Date.now()).length;

  return (
    <div className="view-enter">
      <div className="warn-banner">
        Prospects are real businesses surfaced by live web search for a validated opportunity — never
        fabricated. Outreach messages are AI-drafted drafts for a human to review and send; SURVIVE AI
        never contacts anyone automatically.
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
            ? 'No prospects yet — these are discovered automatically once an opportunity in the Local / Real-World category has a business model and evidence of real demand. Connect a live search provider to enable discovery.'
            : 'No prospects match these filters.'}
        </div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Priority</th>
              <th>Business</th>
              <th>Category / location</th>
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
                <td className="small">{p.websitePresence.replace(/_/g, ' ').toLowerCase()}</td>
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
