import { useState } from 'react';
import { useStore } from '../store';
import { Panel, Badge } from './ui';
import { clockTime, dateTime } from '../lib/format';
import type { EventType } from '../types';

const TYPE_TONE: Record<EventType, 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'gray'> = {
  SYSTEM: 'gray',
  CYCLE: 'blue',
  DISCOVERY: 'blue',
  RESEARCH: 'blue',
  VERIFY: 'blue',
  SCORE: 'purple',
  DECISION: 'green',
  REJECTION: 'amber',
  EXPERIMENT: 'purple',
  WALLET: 'green',
  MEMORY: 'blue',
  WARNING: 'red',
};

const FILTERS: ('ALL' | EventType)[] = [
  'ALL',
  'CYCLE',
  'DISCOVERY',
  'RESEARCH',
  'VERIFY',
  'SCORE',
  'DECISION',
  'REJECTION',
  'EXPERIMENT',
  'WALLET',
  'MEMORY',
  'WARNING',
  'SYSTEM',
];

export function ActivityLog() {
  const events = useStore((s) => s.events);
  const [filter, setFilter] = useState<'ALL' | EventType>('ALL');

  const shown = events.filter((e) => filter === 'ALL' || e.type === filter).slice().reverse();

  return (
    <div className="view-enter">
      <Panel
        title="Agent activity feed"
        right={
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FILTERS.map((f) => (
              <button
                key={f}
                className="btn small"
                style={filter === f ? { background: 'var(--panel-3)', color: 'var(--text)', borderColor: 'var(--border-strong)' } : undefined}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        }
      >
        <div className="feed">
          {shown.map((e) => (
            <div key={e.id} className="event">
              <span className="ev-time" title={dateTime(e.createdAt)}>{clockTime(e.createdAt)}</span>
              <span className="ev-type">
                <Badge tone={TYPE_TONE[e.type]}>{e.type}</Badge>
              </span>
              <span className="ev-msg">{e.message}</span>
            </div>
          ))}
          {shown.length === 0 && <div className="empty">No events of this type yet.</div>}
        </div>
      </Panel>
    </div>
  );
}
