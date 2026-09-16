/* ============================================================================
 * SURVIVE AI — Real revenue analytics + feedback learning (Phase 4)
 * ----------------------------------------------------------------------------
 * Pure functions, same shape as the rest of src/lib. Two jobs:
 *   1. Simulation-vs-reality comparison (§16) — per-opportunity and
 *      aggregate, degrading gracefully to an honest empty state.
 *   2. Feedback learning (§17) — turn one real_revenue entry into a
 *      LearningEvent, fold it into agent_memory as a note (never mutating
 *      the simulated tests/spent/revenue/conclusion fields — real money
 *      and simulated money are never mixed), and a small, explainable
 *      rule-based scoring adjustment. This is explicitly v1: no black-box
 *      model, every number traces to a `factors`-style explanation.
 * ========================================================================== */

import type {
  BusinessModel,
  LearningEvent,
  MemoryEntry,
  Opportunity,
  Prospect,
  RealRevenueEntry,
} from '../types';
import { uid } from './format';

/* ------------------------------- profit calc ------------------------------- */

export function computeProfit(amountReceived: number, costs: number): number {
  return Math.round((amountReceived - costs) * 100) / 100;
}

/* ---------------------------- feedback learning ---------------------------- */

function pctDelta(predicted: number, actual: number): number | undefined {
  if (!predicted || predicted === 0) return undefined;
  return Math.round(((actual - predicted) / predicted) * 1000) / 10; // one decimal %
}

/** Turn one real_revenue entry into a learning event comparing the
 *  opportunity/business-model's predicted price and time-to-revenue
 *  against what actually happened. Never fabricates a comparison field
 *  that has no predicted counterpart. */
export function generateLearningEvent(
  entry: RealRevenueEntry,
  opp: Opportunity,
  model: BusinessModel | undefined,
  now: number = Date.now(),
): LearningEvent {
  const predictedPrice = model?.suggestedPrice;
  const predictedDays = (opp.timeToRevenueDaysMin + opp.timeToRevenueDaysMax) / 2;

  const priceDelta = predictedPrice !== undefined ? pctDelta(predictedPrice, entry.amountReceived) : undefined;
  const timeDelta = pctDelta(predictedDays, entry.daysFromDiscoveryToPayment);

  const parts: string[] = [];
  if (predictedPrice !== undefined) {
    parts.push(
      `predicted price $${predictedPrice} vs actual $${entry.amountReceived}` +
        (priceDelta !== undefined ? ` (${priceDelta > 0 ? '+' : ''}${priceDelta}%)` : ''),
    );
  }
  parts.push(
    `predicted time-to-revenue ~${Math.round(predictedDays)}d vs actual ${entry.daysFromDiscoveryToPayment}d` +
      (timeDelta !== undefined ? ` (${timeDelta > 0 ? '+' : ''}${timeDelta}%)` : ''),
  );

  return {
    id: uid('learn'),
    kind: 'PREDICTION_VS_ACTUAL',
    opportunityId: opp.id,
    category: opp.category,
    refId: entry.id,
    summary: `${opp.name}: ${parts.join('; ')}. Profit $${entry.profit.toFixed(2)} on $${entry.amountReceived.toFixed(2)} received.`,
    predictedValue: predictedPrice,
    actualValue: entry.amountReceived,
    deltaPct: priceDelta,
    createdAt: now,
  };
}

/** Fold a real_revenue entry into the EXISTING per-opportunity and
 *  per-category memory entries as a note — never touching the
 *  tests/spent/revenue/conclusion fields, which are simulated-economics
 *  only (mixing real dollars into those would corrupt wallet/experiment
 *  bookkeeping the rest of the app relies on). Creates the memory entries
 *  if they don't exist yet, same shape as services/memory.ts. */
export function foldRealRevenueIntoMemory(
  memory: MemoryEntry[],
  entry: RealRevenueEntry,
  opp: Opportunity,
  categoryStats?: CategoryRealWorldStats,
  now: number = Date.now(),
): MemoryEntry[] {
  const next = [...memory];
  const note = `[REAL] $${entry.amountReceived.toFixed(2)} received (profit $${entry.profit.toFixed(2)}) from ${entry.prospectName} via ${entry.acquisitionChannel}, ${entry.daysFromDiscoveryToPayment}d discovery-to-payment.${entry.notes ? ` Notes/objections: ${entry.notes}` : ''}`;
  // Phase 5 §19 — once this category has a real conversion-rate track
  // record, note it directly so a future decision/memory read doesn't
  // have to recompute it: "this type of opportunity repeatedly converts
  // in reality" (or doesn't) is exactly the sentence the spec asks for.
  const conversionNote =
    categoryStats && categoryStats.decidedCount >= 3
      ? `[REAL] Category "${opp.category}" real close rate: ${Math.round(categoryStats.realCloseRate * 100)}% across ${categoryStats.decidedCount} decided prospect(s).`
      : undefined;

  for (const [kind, refId, title] of [
    ['opportunity', opp.id, opp.name],
    ['category', opp.category, opp.category],
  ] as const) {
    let mem = next.find((m) => m.kind === kind && m.refId === refId);
    if (!mem) {
      mem = {
        id: uid('mem'),
        kind,
        refId,
        title,
        tests: 0,
        spent: 0,
        revenue: 0,
        conclusion: 'UNTESTED',
        notes: [],
        updatedAt: now,
      };
      next.push(mem);
    }
    const idx = next.findIndex((m) => m.kind === kind && m.refId === refId);
    const newNotes = conversionNote ? [conversionNote, note, ...mem.notes] : [note, ...mem.notes];
    next[idx] = { ...mem, notes: newNotes.slice(0, 12), updatedAt: now };
  }
  return next;
}

/** A small, explainable rule-based adjustment (§17 — explicitly v1, not a
 *  model): if a category's real conversions are running meaningfully
 *  below what was priced/predicted, nudge future scoring down for that
 *  category; if consistently above, nudge it up. Requires at least 2 real
 *  data points before adjusting anything — one data point is not a
 *  pattern. Returns a multiplier (1.0 = no adjustment) plus the factor
 *  string explaining why. */
export function realWorldScoreAdjustment(
  category: string,
  learningEvents: LearningEvent[],
): { multiplier: number; factor?: string } {
  const relevant = learningEvents.filter(
    (e) => e.category === category && e.kind === 'PREDICTION_VS_ACTUAL' && e.deltaPct !== undefined,
  );
  if (relevant.length < 2) return { multiplier: 1 };

  const avgDelta = relevant.reduce((s, e) => s + (e.deltaPct ?? 0), 0) / relevant.length;

  if (avgDelta <= -30) {
    return {
      multiplier: 0.7,
      factor: `Real-world results for "${category}" run ${Math.round(avgDelta)}% below prediction on average across ${relevant.length} recorded outcome(s) — priority reduced.`,
    };
  }
  if (avgDelta >= 30) {
    return {
      multiplier: 1.2,
      factor: `Real-world results for "${category}" run ${Math.round(avgDelta)}% above prediction on average across ${relevant.length} recorded outcome(s) — priority increased.`,
    };
  }
  return { multiplier: 1 };
}

/* --------------------------- simulation vs reality -------------------------- */

export interface OpportunityRealityComparison {
  opportunityId: string;
  opportunityName: string;
  category: string;
  predictedPrice?: number;
  predictedTimeToRevenueDays: number;
  predictedSuccessProbability: number;
  realEntryCount: number;
  realRevenueTotal: number;
  realProfitTotal: number;
  realAvgPrice?: number;
  realAvgTimeToPaymentDays?: number;
  priceDeltaPct?: number;
  timeDeltaPct?: number;
}

/** Per-opportunity prediction-vs-actual — degrades gracefully to an
 *  honest "no real data yet" shape (realEntryCount === 0) rather than
 *  fabricating a comparison. */
export function comparePredictionToActual(
  opp: Opportunity,
  model: BusinessModel | undefined,
  entries: RealRevenueEntry[],
): OpportunityRealityComparison {
  const own = entries.filter((e) => e.opportunityId === opp.id);
  const realRevenueTotal = Math.round(own.reduce((s, e) => s + e.amountReceived, 0) * 100) / 100;
  const realProfitTotal = Math.round(own.reduce((s, e) => s + e.profit, 0) * 100) / 100;
  const realAvgPrice = own.length ? Math.round((realRevenueTotal / own.length) * 100) / 100 : undefined;
  const realAvgTimeToPaymentDays = own.length
    ? Math.round(own.reduce((s, e) => s + e.daysFromDiscoveryToPayment, 0) / own.length)
    : undefined;

  const predictedPrice = model?.suggestedPrice;
  const predictedTimeToRevenueDays = Math.round((opp.timeToRevenueDaysMin + opp.timeToRevenueDaysMax) / 2);

  return {
    opportunityId: opp.id,
    opportunityName: opp.name,
    category: opp.category,
    predictedPrice,
    predictedTimeToRevenueDays,
    predictedSuccessProbability: opp.successProbability,
    realEntryCount: own.length,
    realRevenueTotal,
    realProfitTotal,
    realAvgPrice,
    realAvgTimeToPaymentDays,
    priceDeltaPct: predictedPrice !== undefined && realAvgPrice !== undefined ? pctDelta(predictedPrice, realAvgPrice) : undefined,
    timeDeltaPct: realAvgTimeToPaymentDays !== undefined ? pctDelta(predictedTimeToRevenueDays, realAvgTimeToPaymentDays) : undefined,
  };
}

export interface RealityAggregate {
  opportunitiesWithRealData: number;
  totalRealRevenue: number;
  totalRealProfit: number;
  totalEntries: number;
  avgPriceDeltaPct?: number;
  avgTimeDeltaPct?: number;
}

/** Aggregate across every opportunity — the "in aggregate" half of §16. */
export function aggregateRealityComparison(comparisons: OpportunityRealityComparison[]): RealityAggregate {
  const withData = comparisons.filter((c) => c.realEntryCount > 0);
  const priceDeltas = withData.map((c) => c.priceDeltaPct).filter((d): d is number => d !== undefined);
  const timeDeltas = withData.map((c) => c.timeDeltaPct).filter((d): d is number => d !== undefined);

  return {
    opportunitiesWithRealData: withData.length,
    totalRealRevenue: Math.round(withData.reduce((s, c) => s + c.realRevenueTotal, 0) * 100) / 100,
    totalRealProfit: Math.round(withData.reduce((s, c) => s + c.realProfitTotal, 0) * 100) / 100,
    totalEntries: withData.reduce((s, c) => s + c.realEntryCount, 0),
    avgPriceDeltaPct: priceDeltas.length ? Math.round((priceDeltas.reduce((s, d) => s + d, 0) / priceDeltas.length) * 10) / 10 : undefined,
    avgTimeDeltaPct: timeDeltas.length ? Math.round((timeDeltas.reduce((s, d) => s + d, 0) / timeDeltas.length) * 10) / 10 : undefined,
  };
}

/* ============================================================================
 * PHASE 5 — Intelligence
 * ----------------------------------------------------------------------------
 * Everything below improves logic that already exists, using the real-world
 * data Phase 4 collects. No new subsystem, no black-box model — every
 * adjustment is a small, explainable blend between the modeled estimate and
 * the real-world track record, and only ever kicks in once enough real data
 * exists to be more than noise (see MIN_SAMPLE_FOR_BLEND).
 * ========================================================================== */

/** Below this many decided real-world data points, the modeled estimate is
 *  used as-is — one or two outcomes is not a track record. */
const MIN_SAMPLE_FOR_BLEND = 3;
/** Real-world weight in the blend never exceeds this, however much data
 *  accumulates — the model always keeps some say, and this stays an
 *  explainable blend rather than a full real-data takeover. */
const MAX_REAL_WEIGHT = 0.6;
/** Each additional decided data point past MIN_SAMPLE_FOR_BLEND adds this
 *  much real-world weight, up to MAX_REAL_WEIGHT. */
const WEIGHT_STEP_PER_SAMPLE = 0.15;

/** Blend a modeled estimate with a real-world track record. Returns the
 *  modeled value unchanged below MIN_SAMPLE_FOR_BLEND. Generic so it can
 *  blend a probability, a day-count, or any other single modeled number. */
export function blendWithReal(modeled: number, real: number | undefined, sampleSize: number): number {
  if (real === undefined || sampleSize < MIN_SAMPLE_FOR_BLEND) return modeled;
  const weight = Math.min(MAX_REAL_WEIGHT, (sampleSize - MIN_SAMPLE_FOR_BLEND + 1) * WEIGHT_STEP_PER_SAMPLE);
  return modeled * (1 - weight) + real * weight;
}

/** How much real-world weight a given sample size currently carries in the
 *  blend — used to build explainable factor strings without duplicating
 *  the weight formula. Returns 0 below MIN_SAMPLE_FOR_BLEND. */
export function realWorldBlendWeight(sampleSize: number): number {
  if (sampleSize < MIN_SAMPLE_FOR_BLEND) return 0;
  return Math.round(Math.min(MAX_REAL_WEIGHT, (sampleSize - MIN_SAMPLE_FOR_BLEND + 1) * WEIGHT_STEP_PER_SAMPLE) * 100) / 100;
}

export interface CategoryRealWorldStats {
  category: string;
  decidedCount: number; // WON + LOST prospects in this category
  wonCount: number;
  lostCount: number;
  realCloseRate: number; // wonCount / decidedCount
  avgRealTimeToRevenueDays?: number; // avg daysFromDiscoveryToPayment, this category's real_revenue entries
  avgDealValue?: number; // avg amountReceived, this category's real_revenue entries
  totalRevenue: number; // sum of amountReceived, this category's real_revenue entries
  totalProfit: number; // sum of profit, this category's real_revenue entries
  entryCount: number; // number of real_revenue entries (distinct from decidedCount — a WON prospect may have 0 or several payments)
}

/** Real-world track record per opportunity category — the input every
 *  Phase 5 blending function below takes. Computed fresh each time from
 *  prospects + real_revenue (no separate cache/table: it's cheap to
 *  recompute and this keeps it always current). */
export function computeCategoryRealWorldStats(
  opportunities: Opportunity[],
  prospects: Prospect[],
  realRevenue: RealRevenueEntry[],
): CategoryRealWorldStats[] {
  const categoryOf = new Map(opportunities.map((o) => [o.id, o.category]));
  const byCategory = new Map<string, { won: number; lost: number; days: number[]; deals: number[]; profits: number[] }>();

  for (const p of prospects) {
    if (p.status !== 'WON' && p.status !== 'LOST') continue;
    const category = categoryOf.get(p.opportunityId);
    if (!category) continue;
    const bucket = byCategory.get(category) ?? { won: 0, lost: 0, days: [], deals: [], profits: [] };
    if (p.status === 'WON') bucket.won++;
    else bucket.lost++;
    byCategory.set(category, bucket);
  }
  for (const r of realRevenue) {
    const category = categoryOf.get(r.opportunityId);
    if (!category) continue;
    const bucket = byCategory.get(category) ?? { won: 0, lost: 0, days: [], deals: [], profits: [] };
    bucket.days.push(r.daysFromDiscoveryToPayment);
    bucket.deals.push(r.amountReceived);
    bucket.profits.push(r.profit);
    byCategory.set(category, bucket);
  }

  return [...byCategory.entries()].map(([category, b]) => {
    const decidedCount = b.won + b.lost;
    return {
      category,
      decidedCount,
      wonCount: b.won,
      lostCount: b.lost,
      realCloseRate: decidedCount > 0 ? Math.round((b.won / decidedCount) * 1000) / 1000 : 0,
      avgRealTimeToRevenueDays: b.days.length ? Math.round(b.days.reduce((s, d) => s + d, 0) / b.days.length) : undefined,
      avgDealValue: b.deals.length ? Math.round((b.deals.reduce((s, d) => s + d, 0) / b.deals.length) * 100) / 100 : undefined,
      totalRevenue: Math.round(b.deals.reduce((s, d) => s + d, 0) * 100) / 100,
      totalProfit: Math.round(b.profits.reduce((s, p) => s + p, 0) * 100) / 100,
      entryCount: b.deals.length,
    };
  });
}

export function statsForCategory(stats: CategoryRealWorldStats[], category: string): CategoryRealWorldStats | undefined {
  return stats.find((s) => s.category === category);
}

/** Phase 5 §22 — the overarching goal made visible: is prediction error
 *  shrinking over time? Returns a chronological (oldest-first) rolling
 *  average of |deltaPct| across PREDICTION_VS_ACTUAL learning events,
 *  optionally scoped to one category. A window smooths single-entry
 *  noise without hiding a genuine trend. Empty/undersized input returns
 *  an empty array — an honest "not enough history yet", never a
 *  fabricated trend line. */
export function predictionErrorTrend(learningEvents: LearningEvent[], category?: string, window = 3): number[] {
  const relevant = learningEvents
    .filter((e) => e.kind === 'PREDICTION_VS_ACTUAL' && e.deltaPct !== undefined && (!category || e.category === category))
    .sort((a, b) => a.createdAt - b.createdAt);
  if (relevant.length < 2) return [];

  const errors = relevant.map((e) => Math.abs(e.deltaPct as number));
  return errors.map((_, i) => {
    const slice = errors.slice(Math.max(0, i - window + 1), i + 1);
    return Math.round((slice.reduce((s, v) => s + v, 0) / slice.length) * 10) / 10;
  });
}
