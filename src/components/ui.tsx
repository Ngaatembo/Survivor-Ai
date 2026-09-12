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

/* ------------------------------ sparkline ---------------------------------- */

export function Sparkline({
  values,
  width = 100,
  height = 32,
  positive,
}: {
  values: number[];
  width?: number;
  height?: number;
  positive: boolean;
}) {
  if (values.length < 2) {
    return <div className="faint small">Not enough history yet</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const color = positive ? 'var(--green)' : 'var(--red)';
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="sparkline">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------ bar chart ---------------------------------- */

export function BarChart({
  data,
}: {
  data: { label: string; value: number; color?: string }[];
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="chart-bars">
      {data.map((d) => (
        <div key={d.label} className="chart-bar-row">
          <div className="chart-bar-label">{d.label}</div>
          <div className="chart-bar-track">
            <div
              className="chart-bar-fill"
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                background: d.color ?? 'var(--blue)',
              }}
            />
          </div>
          <div className="chart-bar-val">{d.value}</div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- donut ------------------------------------ */

export function Donut({
  segments,
  size = 96,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  let acc = 0;
  const stops = segments.map((s) => {
    const start = total > 0 ? (acc / total) * 360 : 0;
    acc += s.value;
    const end = total > 0 ? (acc / total) * 360 : 0;
    return `${s.color} ${start}deg ${end}deg`;
  });
  const gradient = total > 0 ? `conic-gradient(${stops.join(', ')})` : 'conic-gradient(var(--border-strong) 0deg 360deg)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: gradient,
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: size * 0.22,
            borderRadius: '50%',
            background: 'var(--panel)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--mono)',
            fontSize: size * 0.16,
            fontWeight: 700,
          }}
        >
          {total}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span className="muted">{s.label}</span>
            <span className="mono" style={{ marginLeft: 'auto', fontWeight: 600 }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------- event type dot -------------------------------- */

const eventToneMap: Record<string, { color: string; label: string }> = {
  SYSTEM: { color: 'var(--gray)', label: 'System' },
  CYCLE: { color: 'var(--blue)', label: 'Cycle' },
  DISCOVERY: { color: 'var(--purple)', label: 'Discovery' },
  RESEARCH: { color: 'var(--blue)', label: 'Research' },
  VERIFY: { color: 'var(--amber)', label: 'Verify' },
  SCORE: { color: 'var(--amber)', label: 'Score' },
  DECISION: { color: 'var(--green)', label: 'Decision' },
  REJECTION: { color: 'var(--red)', label: 'Rejected' },
  EXPERIMENT: { color: 'var(--purple)', label: 'Experiment' },
  WALLET: { color: 'var(--green)', label: 'Wallet' },
  MEMORY: { color: 'var(--gray)', label: 'Memory' },
  WARNING: { color: 'var(--red)', label: 'Warning' },
};

export function EventTypeTag({ type }: { type: string }) {
  const meta = eventToneMap[type] ?? { color: 'var(--gray)', label: type };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 10.5,
        fontFamily: 'var(--mono)',
        color: meta.color,
        flexShrink: 0,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, display: 'inline-block' }} />
      {meta.label}
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
