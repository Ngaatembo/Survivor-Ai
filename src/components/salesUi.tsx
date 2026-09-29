import type { ReactNode } from 'react';
import { BackendError } from '../services/backendApi';
import { Badge } from './ui';
import { STAGE_LABEL, type Fact, type SalesStage } from '../sales/types';

export const fmtDate = (ms?: number | null): string =>
  ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';

export const fmtDateTime = (ms?: number | null): string =>
  ms ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export function fmtDue(ms?: number | null, now = Date.now()): string {
  if (!ms) return '—';
  const days = Math.round((ms - now) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days < 0 ? `${-days} days overdue` : `in ${days} days`;
}

export const errText = (e: unknown): string =>
  e instanceof BackendError ? e.message : (e as Error)?.message || 'Something went wrong.';

export function stageTone(stage: SalesStage): 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray' {
  switch (stage) {
    case 'WON': return 'green';
    case 'LOST': case 'NOT_A_FIT': return 'red';
    case 'DORMANT': return 'gray';
    case 'REPLIED': case 'INTERESTED': case 'MEETING': case 'PROPOSAL': case 'NEGOTIATION': return 'purple';
    case 'CONTACTED': case 'FOLLOW_UP_1': case 'FOLLOW_UP_2': return 'amber';
    default: return 'blue';
  }
}

export function StageBadge({ stage }: { stage: SalesStage }) {
  return <Badge tone={stageTone(stage)}>{STAGE_LABEL[stage]}</Badge>;
}

const FACT_TONE = { VERIFIED: 'green', INFERENCE: 'amber', UNKNOWN: 'gray' } as const;
const FACT_HINT = {
  VERIFIED: 'Read directly from a stored record, audit or something you entered.',
  INFERENCE: 'A reasoned guess — check it before relying on it.',
  UNKNOWN: 'Not known yet — find out when you speak to them.',
} as const;

export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <ul className="sl-facts">
      {facts.map((f, i) => (
        <li key={i}>
          <span title={FACT_HINT[f.kind]}><Badge tone={FACT_TONE[f.kind]}>{f.kind}</Badge></span>
          <span className="sl-fact-text">{f.text}{f.source ? <span className="muted"> · {f.source}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="sl-section">
      <div className="sl-section-head"><h4>{title}</h4>{right}</div>
      {children}
    </section>
  );
}

export function Notice({ tone, children }: { tone: 'ok' | 'warn' | 'err' | 'info'; children: ReactNode }) {
  return <div className={`cl-result sl-notice ${tone}`} role="status">{children}</div>;
}
