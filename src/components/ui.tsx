import type { ReactNode } from 'react';
import type { AgentStatus, DataSource, EvidenceTier, Recommendation } from '../types';

/* ------------------------------- badges ----------------------------------- */

export function Badge({
  tone = 'gray',
  children,
}: {
  tone?: 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray';
  children: ReactNode;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function DataSourceBadge({ source }: { source: DataSource }) {
  return source === 'SAMPLE' ? (
    <span className="badge sample" title="Seeded development data — not live research">
      SAMPLE
    </span>
  ) : (
    <span className="badge live">LIVE</span>
  );
}

const evidenceTone: Record<EvidenceTier, 'green' | 'blue' | 'amber' | 'red'> = {
  VERIFIED: 'green',
  LIKELY: 'blue',
  UNCERTAIN: 'amber',
  UNVERIFIED: 'red',
};

export function EvidenceBadge({ tier }: { tier: EvidenceTier }) {
  return (
    <span className={`badge ${evidenceTone[tier]}`} title={`Evidence tier: ${tier}`}>
      {tier}
    </span>
  );
}

const recTone: Record<Recommendation, 'green' | 'blue' | 'amber' | 'purple' | 'gray'> = {
  'HIGH PRIORITY': 'green',
  RECOMMENDED: 'blue',
  WATCHLIST: 'amber',
  DEPRIORITIZE: 'gray',
  'RESEARCH ONLY': 'purple',
};

export function RecommendationBadge({ rec }: { rec: Recommendation }) {
  return <span className={`badge ${recTone[rec]}`}>{rec}</span>;
}

/* -------------------------------- panels ---------------------------------- */

export function Panel({
  title,
  right,
  children,
  tight,
  style,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  tight?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`panel ${tight ? 'tight' : ''}`} style={style}>
      {title && (
        <div className="panel-title">
          {title}
          {right && <span className="right">{right}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/* --------------------------------- stats ---------------------------------- */

export function Stat({
  label,
  value,
  sub,
  tone,
  small,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'pos' | 'neg' | 'neu';
  small?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${small ? 'small' : ''} ${tone ?? ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/* --------------------------------- bars ----------------------------------- */

export function Bar({
  label,
  value,
  max = 100,
  tone,
  suffix,
}: {
  label: string;
  value: number;
  max?: number;
  tone?: 'green' | 'amber' | 'red' | '';
  suffix?: string;
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="bar-row">
      <div className="bar-label">{label}</div>
      <div className="bar-track">
        <div className={`bar-fill ${tone ?? ''}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="bar-val">
        {Math.round(value)}
        {suffix ?? ''}
      </div>
    </div>
  );
}

/* ------------------------------- score ring ------------------------------- */

export function ScoreRing({ score, size = 46 }: { score: number; size?: number }) {
  const unscored = score < 0;
  const color = unscored
    ? 'var(--faint)'
    : score >= 78
      ? 'var(--green)'
      : score >= 65
        ? 'var(--blue)'
        : score >= 52
          ? 'var(--amber)'
          : 'var(--red)';
  return (
    <div
      className="score-ring"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.3,
        ['--pct' as string]: Math.max(0, score),
        ['--ring-color' as string]: color,
        color: unscored ? 'var(--faint)' : undefined,
      }}
      title={unscored ? 'Not yet scored — awaiting research' : `Opportunity score ${score}/100`}
    >
      {unscored ? '–' : score}
    </div>
  );
}

/* ----------------------------- status dot --------------------------------- */

export function StatusDot({ status, pulse }: { status: AgentStatus; pulse?: boolean }) {
  const color =
    status === 'ALIVE'
      ? 'green'
      : status === 'AT_RISK'
        ? 'amber'
        : status === 'DEAD'
          ? 'red'
          : status === 'RESEARCHING'
            ? 'blue'
            : status === 'EXECUTING'
              ? 'purple'
              : 'gray';
  return <span className={`dot ${color} ${pulse ? 'pulsing' : ''}`} />;
}

export function statusLabel(status: AgentStatus): string {
  return status.replace('_', ' ');
}

/* ------------------------------ field list -------------------------------- */

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </>
  );
}
