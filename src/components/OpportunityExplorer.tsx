import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Badge, DataSourceBadge, EvidenceBadge, RecommendationBadge, ScoreRing } from './ui';
import { capRange, dayRange } from '../lib/format';
import type { Category, OpportunityLifecycleState } from '../types';
import { OpportunityDrawer } from './OpportunityDrawer';
import { featureFlags } from '../config/env';

type SortKey = 'score' | 'capital' | 'speed' | 'risk' | 'potential' | 'evidence';

const LIFECYCLE_STATES: (OpportunityLifecycleState | 'ALL')[] = ['ALL', 'DISCOVERED', 'VALIDATING', 'PROVEN', 'SCALING', 'FAILED', 'ARCHIVED'];
const LIFECYCLE_TONE: Record<OpportunityLifecycleState, 'green' | 'blue' | 'amber' | 'red' | 'gray' | 'purple'> = {
  DISCOVERED: 'gray', VALIDATING: 'blue', PROVEN: 'green', SCALING: 'purple', FAILED: 'red', ARCHIVED: 'gray',
};

const CATEGORIES: (Category | 'All')[] = [
  'All',
  'Digital Business',
  'Content',
  'E-Commerce',
  'Services',
  'Finance',
  'Local / Real-World',
];

export function OpportunityExplorer() {
  const opportunities = useStore((s) => s.opportunities);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
  const [maxCapital, setMaxCapital] = useState(50);
  const [riskOnly, setRiskOnly] = useState(false);
  const [evidence, setEvidence] = useState('ALL');
  const [aiSuitableOnly, setAiSuitableOnly] = useState(false);
  const [discoveredOnly, setDiscoveredOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('score');
  const [lifecycle, setLifecycle] = useState<OpportunityLifecycleState | 'ALL'>('ALL');

  const filtered = useMemo(() => {
    let list = opportunities.filter((o) => {
      if (discoveredOnly && o.researchStage === 'UNDISCOVERED') return false;
      if (lifecycle !== 'ALL' && o.lifecycleState !== lifecycle) return false;
      if (category !== 'All' && o.category !== category) return false;
      if (o.capitalRequiredMin > maxCapital) return false;
      if (riskOnly && o.risk <= 3) return false;
      if (evidence !== 'ALL' && o.evidenceTier !== evidence) return false;
      if (aiSuitableOnly && !(o.score?.aiSuitable)) return false;
      if (q) {
        const hay = `${o.name} ${o.description} ${o.tags.join(' ')} ${o.category}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      const sa = a.score?.total ?? -1;
      const sb = b.score?.total ?? -1;
      switch (sort) {
        case 'capital':
          return a.capitalRequiredMin - b.capitalRequiredMin || sb - sa;
        case 'speed':
          return a.timeToRevenueDaysMax - b.timeToRevenueDaysMax || sb - sa;
        case 'risk':
          return a.risk - b.risk || sb - sa;
        case 'potential':
          return b.revenuePotentialMonthlyMax - a.revenuePotentialMonthlyMax;
        case 'evidence':
          return (
            (b.score?.factors.find((f) => f.key === 'evidence')?.raw ?? -1) -
            (a.score?.factors.find((f) => f.key === 'evidence')?.raw ?? -1)
          );
        default:
          return sb - sa;
      }
    });
    return list;
  }, [opportunities, q, category, maxCapital, riskOnly, evidence, aiSuitableOnly, discoveredOnly, sort, lifecycle]);

  const drawerOpp = drawerId ? opportunities.find((o) => o.id === drawerId) ?? null : null;
  const liveCount = opportunities.filter((o) => o.dataSource === 'LIVE').length;
  const lifecycleCounts = LIFECYCLE_STATES.slice(1).reduce((acc, state) => {
    acc[state] = opportunities.filter((o) => o.lifecycleState === state).length;
    return acc;
  }, {} as Record<OpportunityLifecycleState, number>);

  return (
    <div className="view-enter">
      <div className="warn-banner">
        {featureFlags.backend ? (
          liveCount > 0 ? (
            <>
              {liveCount} of {opportunities.length} opportunities below are <strong>LIVE</strong> — discovered via
              your connected search provider. The rest are SAMPLE seed data, tagged accordingly. Scores are
              computed by the local engine; evidence tiers express confidence, not guarantees.
            </>
          ) : (
            <>
              Connected to the live backend, but no opportunities are tagged <strong>LIVE</strong> yet — all{' '}
              {opportunities.length} below are SAMPLE seed data. Scores are computed by the local engine;
              evidence tiers express confidence, not guarantees.
            </>
          )
        ) : (
          <>
            All records below are <strong>SAMPLE seed data</strong> unless tagged LIVE (no live research
            connector is attached in this standalone demo). Scores are computed by the local engine; evidence
            tiers express confidence, not guarantees.
          </>
        )}
      </div>

      <div className="filter-bar">
        <input
          className="text-input"
          placeholder="Search opportunities, tags, models…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select className="select" value={lifecycle} onChange={(e) => setLifecycle(e.target.value as typeof lifecycle)}>
          {LIFECYCLE_STATES.map((state) => (
            <option key={state} value={state}>
              {state === 'ALL' ? 'Portfolio: all states' : `Portfolio: ${state} (${lifecycleCounts[state]})`}
            </option>
          ))}
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="score">Sort: Highest score</option>
          <option value="capital">Sort: Lowest capital</option>
          <option value="speed">Sort: Fastest revenue</option>
          <option value="risk">Sort: Lowest risk</option>
          <option value="potential">Sort: Highest potential</option>
          <option value="evidence">Sort: Strongest evidence</option>
        </select>
        <select className="select" value={evidence} onChange={(e) => setEvidence(e.target.value)}>
          <option value="ALL">Evidence: any</option>
          <option value="VERIFIED">VERIFIED</option>
          <option value="LIKELY">LIKELY</option>
          <option value="UNCERTAIN">UNCERTAIN</option>
          <option value="UNVERIFIED">UNVERIFIED</option>
        </select>
        <label className="check">
          Max capital ${maxCapital}
          <input
            type="range"
            min={0}
            max={500}
            step={10}
            value={maxCapital}
            onChange={(e) => setMaxCapital(Number(e.target.value))}
            style={{ width: 110 }}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={discoveredOnly} onChange={(e) => setDiscoveredOnly(e.target.checked)} />
          discovered only
        </label>
        <label className="check">
          <input type="checkbox" checked={aiSuitableOnly} onChange={(e) => setAiSuitableOnly(e.target.checked)} />
          AI-suitable for $50
        </label>
        <label className="check">
          <input type="checkbox" checked={riskOnly} onChange={(e) => setRiskOnly(e.target.checked)} />
          high-risk only
        </label>
      </div>

      <div className="chip-list" style={{ marginBottom: 12 }}>
        {LIFECYCLE_STATES.slice(1).map((state) => (
          <button
            key={state}
            className="btn small"
            onClick={() => setLifecycle(lifecycle === state ? 'ALL' : state)}
            title={`Show ${state.toLowerCase()} opportunities`}
          >
            {state} {lifecycleCounts[state]}
          </button>
        ))}
      </div>

      <div className="faint small mono" style={{ marginBottom: 12 }}>
        {filtered.length} of {opportunities.length} opportunities
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No opportunities match these filters.</div>
      ) : (
        <div className="opp-grid">
          {filtered.map((o) => (
            <div key={o.id} className="opp-card" onClick={() => setDrawerId(o.id)}>
              <div className="opp-head">
                <div>
                  <div className="opp-name">{o.name}</div>
                  <div className="faint small mono" style={{ marginTop: 3 }}>
                    {o.category}
                  </div>
                </div>
                {o.score && o.researchStage !== 'UNDISCOVERED' ? (
                  <ScoreRing score={o.score.total} />
                ) : (
                  <ScoreRing score={-1} />
                )}
              </div>
              <div className="opp-desc">{o.description}</div>
              <div className="opp-meta">
                <DataSourceBadge source={o.dataSource} />
                <EvidenceBadge tier={o.evidenceTier} />
                {o.executionBlocked && <Badge tone="purple">RESEARCH ONLY</Badge>}
                <Badge tone={LIFECYCLE_TONE[o.lifecycleState]}>{o.lifecycleState}</Badge>
                {o.researchStage === 'UNDISCOVERED' && <Badge tone="gray">UNDISCOVERED</Badge>}
              </div>
              <div className="opp-foot">
                <div className="small mono">
                  <span className="muted">capital </span>
                  <strong>{capRange(o.capitalRequiredMin, o.capitalRequiredMax)}</strong>
                  <span className="faint"> · </span>
                  <span className="muted">rev </span>
                  <strong>{dayRange(o.timeToRevenueDaysMin, o.timeToRevenueDaysMax)}</strong>
                </div>
                {o.score && <RecommendationBadge rec={o.score.recommendation} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {drawerOpp && <OpportunityDrawer opp={drawerOpp} onClose={() => setDrawerId(null)} />}
    </div>
  );
}
