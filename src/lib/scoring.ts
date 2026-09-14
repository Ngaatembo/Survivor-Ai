/* ============================================================================
 * SURVIVE AI — Opportunity scoring engine
 * ----------------------------------------------------------------------------
 * Deterministic, transparent 0–100 scoring. Every factor is normalized to
 * 0–100, weighted, and exposed in a breakdown so decisions are auditable.
 * This is a local rule engine today; an LLM provider can later override or
 * augment scores via services/ai.ts without touching this interface.
 * ========================================================================== */

import type { Opportunity, ScoreBreakdown, ScoreFactor, ScoreFactorKey } from '../types';
import { blendWithReal, statsForCategory, type CategoryRealWorldStats } from './realRevenue';

export const STARTING_BUDGET = 50;

export const FACTOR_WEIGHTS: Record<ScoreFactorKey, number> = {
  capitalFit: 16, // affordable on a $50 budget
  speedToRevenue: 12, // how fast first cash arrives
  successProbability: 14, // estimated chance of a winning first attempt
  profitPotential: 10, // upside ceiling
  scalability: 8,
  competition: 8, // less competition scores higher
  difficulty: 10, // easier execution scores higher
  risk: 12, // lower risk scores higher
  evidence: 10, // strength of supporting evidence
};

export const FACTOR_LABELS: Record<ScoreFactorKey, string> = {
  capitalFit: 'Capital fit ($50 budget)',
  speedToRevenue: 'Speed to first revenue',
  successProbability: 'Probability of success',
  profitPotential: 'Profit potential',
  scalability: 'Scalability',
  competition: 'Competition (lower is better)',
  difficulty: 'Execution ease (lower is better)',
  risk: 'Risk profile (lower is better)',
  evidence: 'Evidence quality',
};

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

function normalizeCapitalFit(o: Opportunity): number {
  // $0 capital -> 100; $50 -> ~17; above $50 -> near 0.
  const min = o.capitalRequiredMin;
  if (min <= 0) return 100;
  return clamp(100 - (min / STARTING_BUDGET) * 100 + (min <= 10 ? 8 : 0));
}

function normalizeProfit(o: Opportunity): number {
  const max = Math.max(0, o.revenuePotentialMonthlyMax);
  // Log scale: $100 ≈ 37, $500 ≈ 50, $2000 ≈ 61, $5000 ≈ 68.
  return clamp((Math.log10(max + 1) / Math.log10(5000)) * 100 + 20);
}

const tierScore: Record<Opportunity['evidenceTier'], number> = {
  VERIFIED: 100,
  LIKELY: 78,
  UNCERTAIN: 48,
  UNVERIFIED: 18,
};

export function scoreOpportunity(o: Opportunity, categoryStats: CategoryRealWorldStats[] = []): ScoreBreakdown {
  // Phase 5 §18 — once a category has a real-world track record (3+
  // decided prospects), blend it into the two factors that a track record
  // actually speaks to: how often this category really closes, and how
  // long it really takes to get paid. Below that sample size, or for a
  // category with no real data yet, this is a no-op — the modeled
  // estimate is used exactly as before.
  const stats = statsForCategory(categoryStats, o.category);
  const blendedSuccessProbability = blendWithReal(o.successProbability, stats?.realCloseRate, stats?.decidedCount ?? 0);
  const modeledAvgDays = (o.timeToRevenueDaysMin + o.timeToRevenueDaysMax) / 2;
  const blendedAvgDays = blendWithReal(modeledAvgDays, stats?.avgRealTimeToRevenueDays, stats?.decidedCount ?? 0);

  const raw: Record<ScoreFactorKey, number> = {
    capitalFit: normalizeCapitalFit(o),
    speedToRevenue: clamp(105 - blendedAvgDays * 0.75),
    successProbability: clamp(blendedSuccessProbability * 100),
    profitPotential: normalizeProfit(o),
    scalability: (o.scalability / 5) * 100,
    competition: ((5 - o.competition) / 4) * 100,
    difficulty: ((5 - o.difficulty) / 4) * 100,
    risk: ((5 - o.risk) / 4) * 100,
    evidence: tierScore[o.evidenceTier],
  };

  const factors: ScoreFactor[] = (Object.keys(FACTOR_WEIGHTS) as ScoreFactorKey[]).map((key) => ({
    key,
    label: FACTOR_LABELS[key],
    weight: FACTOR_WEIGHTS[key],
    raw: Math.round(raw[key]),
    weighted: Math.round(raw[key] * FACTOR_WEIGHTS[key]) / 100,
    direction:
      key === 'competition' || key === 'difficulty' || key === 'risk'
        ? 'lower-better'
        : 'higher-better',
  }));

  const total = Math.round(factors.reduce((sum, f) => sum + f.weighted, 0));

  let recommendation: ScoreBreakdown['recommendation'];
  if (o.executionBlocked) recommendation = 'RESEARCH ONLY';
  else if (total >= 78) recommendation = 'HIGH PRIORITY';
  else if (total >= 65) recommendation = 'RECOMMENDED';
  else if (total >= 52) recommendation = 'WATCHLIST';
  else recommendation = 'DEPRIORITIZE';

  const budgetFit = o.capitalRequiredMin <= STARTING_BUDGET;
  const aiSuitable =
    budgetFit &&
    !o.executionBlocked &&
    o.risk <= 3 &&
    raw.capitalFit >= 55 &&
    o.timeToRevenueDaysMax <= 120;

  return {
    total,
    factors,
    recommendation,
    budgetFit,
    aiSuitable,
    scoredAt: Date.now(),
  };
}

export function scoreColor(total: number): string {
  if (total >= 78) return 'var(--green)';
  if (total >= 65) return 'var(--blue)';
  if (total >= 52) return 'var(--amber)';
  return 'var(--red)';
}

export function recommendationColor(rec: string): string {
  switch (rec) {
    case 'HIGH PRIORITY':
      return 'var(--green)';
    case 'RECOMMENDED':
      return 'var(--blue)';
    case 'WATCHLIST':
      return 'var(--amber)';
    case 'RESEARCH ONLY':
      return 'var(--purple)';
    default:
      return 'var(--faint)';
  }
}
