import { useStore } from '../store';
import { Panel, Badge } from './ui';
import { usd, timeAgo } from '../lib/format';
import type { MemoryEntry } from '../types';

function conclusionBadge(c: MemoryEntry['conclusion']) {
  const tone =
    c === 'VIABLE' || c === 'PROMISING' ? 'green' : c === 'MIXED' || c === 'WATCH' ? 'amber' : c === 'AVOID' ? 'red' : 'gray';
  return <Badge tone={tone}>{c}</Badge>;
}

export function MemoryView() {
  const memory = useStore((s) => s.memory);
  const opportunities = useStore((s) => s.opportunities);

  const opps = memory.filter((m) => m.kind === 'opportunity').sort((a, b) => b.updatedAt - a.updatedAt);
  const cats = memory.filter((m) => m.kind === 'category').sort((a, b) => b.revenue - a.revenue);
  const lessons = memory.filter((m) => m.kind === 'lesson').slice(0, 12);

  const totalTests = opps.reduce((s, m) => s + m.tests, 0);
  const totalSpent = opps.reduce((s, m) => s + m.spent, 0);
  const totalReturned = opps.reduce((s, m) => s + m.revenue, 0);

  return (
    <div className="view-enter">
      <div className="info-banner">
        Memory directly influences decisions: opportunities concluded <strong>AVOID</strong> are never
        re-selected, <strong>PROMISING/VIABLE</strong> models get confidence boosts, and strategy
        shifts between explore and exploit based on what worked.
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Panel tight>
          <div className="stat">
            <div className="stat-label">Models tested</div>
            <div className="stat-value small">{totalTests}</div>
          </div>
        </Panel>
        <Panel tight>
          <div className="stat">
            <div className="stat-label">Total spent (sim)</div>
            <div className="stat-value small neg">{usd(totalSpent)}</div>
          </div>
        </Panel>
        <Panel tight>
          <div className="stat">
            <div className="stat-label">Revenue generated (sim)</div>
            <div className="stat-value small pos">{usd(totalReturned)}</div>
          </div>
        </Panel>
        <Panel tight>
          <div className="stat">
            <div className="stat-label">Memory records</div>
            <div className="stat-value small">{memory.length}</div>
          </div>
        </Panel>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
        <Panel title="Opportunity memory">
          {opps.length === 0 ? (
            <div className="empty">No opportunity memory yet — it builds as experiments complete.</div>
          ) : (
            opps.map((m) => {
              const opp = opportunities.find((o) => o.id === m.refId);
              return (
                <div key={m.id} style={{ padding: '11px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>{m.title}</div>
                    {conclusionBadge(m.conclusion)}
                  </div>
                  <div className="small mono faint" style={{ margin: '4px 0' }}>
                    tested {m.tests}× · spent {usd(m.spent)} · returned {usd(m.revenue)} · net{' '}
                    <span className={m.revenue - m.spent >= 0 ? 'pos' : 'neg'}>
                      {m.revenue - m.spent >= 0 ? '+' : ''}{usd(m.revenue - m.spent)}
                    </span>
                    {' '}· {timeAgo(m.updatedAt)}
                  </div>
                  {m.notes.slice(0, 3).map((n, i) => (
                    <div key={i} className="small" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
                      {n}
                    </div>
                  ))}
                  {opp?.executionBlocked && <div className="small" style={{ color: 'var(--purple)', marginTop: 3 }}>Research-only category — never auto-executed.</div>}
                </div>
              );
            })
          )}
        </Panel>

        <div>
          <Panel title="Category performance" style={{ marginBottom: 14 }}>
            {cats.length === 0 ? (
              <div className="small faint">Category rollups appear after experiments.</div>
            ) : (
              cats.map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{m.title}</div>
                    <div className="small mono faint">{m.tests} tests · {usd(m.spent)} in · {usd(m.revenue)} out</div>
                  </div>
                  {conclusionBadge(m.conclusion)}
                </div>
              ))
            )}
          </Panel>

          <Panel title="Distilled lessons & assumptions">
            {lessons.length === 0 ? (
              <div className="small faint">Lessons are distilled from every experiment result.</div>
            ) : (
              lessons.map((m) => (
                <div key={m.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <div className="small" style={{ lineHeight: 1.55 }}>{m.title}</div>
                  <div className="faint small mono" style={{ marginTop: 2 }}>{timeAgo(m.updatedAt)}</div>
                </div>
              ))
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
