import { useStore } from '../store';
import { StatusDot, statusLabel } from './ui';

export function AgentStatusPill() {
  const status = useStore((s) => s.agent.status);
  const activity = useStore((s) => s.loop.activity);
  const busy = status === 'RESEARCHING' || status === 'EXECUTING';

  return (
    <div className={`status-pill status-${status}`}>
      <StatusDot status={status} pulse={busy} />
      <span>{statusLabel(status)}</span>
      <span className="activity" title={activity}>
        {activity}
      </span>
    </div>
  );
}
