/* ============================================================================
 * SURVIVE AI — Revenue Funnel (Economic Survival Overhaul, Phase 6)
 * ----------------------------------------------------------------------------
 * DISCOVERED → QUALIFIED → CONTACTED → REPLIED → INTERESTED →
 * PROPOSAL_SENT → NEGOTIATING → WON → PAID
 *
 * Prospect.status (src/types.ts) already tracks the CRM pipeline through
 * WON; this module is the missing analytics layer on top of it — cumulative
 * stage counts + stage-to-stage conversion rates, plus breakdowns by
 * category and acquisition channel (Phase 6's explicit asks). PAID is
 * derived from RealRevenueEntry, the only ledger of actual money.
 *
 * Honesty note: Prospect.status is a single current value, not a full
 * history, so a prospect marked LOST or NOT_INTERESTED can't be
 * retroactively credited with every earlier stage it silently passed
 * through without guessing. This module counts LOST/NOT_INTERESTED
 * separately (`droppedCount`) rather than attributing them to stages it
 * cannot prove they reached — no fabricated funnel shape.
 * ========================================================================== */

import type { Offer, Opportunity, Prospect, ProspectStatus, RealRevenueEntry } from '../types';

export const FUNNEL_STAGES = [
  'DISCOVERED',
  'QUALIFIED',
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'PROPOSAL_SENT',
  'NEGOTIATING',
  'WON',
  'PAID',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

const STAGE_ORDER: Record<Exclude<FunnelStage, 'PAID'>, number> = {
  DISCOVERED: 0,
  QUALIFIED: 1,
  CONTACTED: 2,
  REPLIED: 3,
  INTERESTED: 4,
  PROPOSAL_SENT: 5,
  NEGOTIATING: 6,
  WON: 7,
};

/** FOLLOW_UP is a scheduling flag layered on top of an underlying stage, not
 *  its own funnel step — treat it as having reached at least CONTACTED. */
function reachedIndex(status: ProspectStatus): number | null {
  if (status === 'FOLLOW_UP') return STAGE_ORDER.CONTACTED;
  if (status === 'LOST' || status === 'NOT_INTERESTED') return null; // see honesty note above
  return STAGE_ORDER[status as Exclude<ProspectStatus, 'LOST' | 'NOT_INTERESTED' | 'FOLLOW_UP'>] ?? null;
}

export interface FunnelStageCount {
  stage: FunnelStage;
  count: number;
  /** Conversion rate from the previous stage to this one; null for the
   *  first stage (DISCOVERED) and whenever the previous stage's count is 0. */
  conversionFromPrevious: number | null;
}

export interface RevenueFunnel {
  stages: FunnelStageCount[];
  totalProspects: number;
  droppedCount: number; // LOST + NOT_INTERESTED
  overallConversionRate: number | null; // WON / total funnel-active prospects
  paidCount: number;
  paidRevenueTotal: number;
}

export function computeRevenueFunnel(
  prospects: Prospect[],
  realRevenue: RealRevenueEntry[],
): RevenueFunnel {
  const reached: Record<Exclude<FunnelStage, 'PAID'>, number> = {
    DISCOVERED: 0,
    QUALIFIED: 0,
    CONTACTED: 0,
    REPLIED: 0,
    INTERESTED: 0,
    PROPOSAL_SENT: 0,
    NEGOTIATING: 0,
    WON: 0,
  };
  let droppedCount = 0;

  for (const p of prospects) {
    const idx = reachedIndex(p.status);
    if (idx === null) {
      droppedCount += 1;
      continue;
    }
    for (const [stage, order] of Object.entries(STAGE_ORDER) as [Exclude<FunnelStage, 'PAID'>, number][]) {
      if (order <= idx) reached[stage] += 1;
    }
  }

  const paidProspectIds = new Set(realRevenue.filter((r) => r.amountReceived > 0).map((r) => r.prospectId));
  const paidCount = paidProspectIds.size;
  const paidRevenueTotal = Math.round(realRevenue.reduce((s, r) => s + r.amountReceived, 0) * 100) / 100;

  const orderedStages = [...FUNNEL_STAGES];
  const counts: number[] = orderedStages.map((s) => (s === 'PAID' ? paidCount : reached[s]));

  const stages: FunnelStageCount[] = orderedStages.map((stage, i) => ({
    stage,
    count: counts[i],
    conversionFromPrevious: i === 0 ? null : counts[i - 1] > 0 ? Math.round((counts[i] / counts[i - 1]) * 1000) / 1000 : null,
  }));

  return {
    stages,
    totalProspects: prospects.length,
    droppedCount,
    overallConversionRate: reached.DISCOVERED > 0 ? Math.round((reached.WON / reached.DISCOVERED) * 1000) / 1000 : null,
    paidCount,
    paidRevenueTotal,
  };
}

/* ---------------------------- category breakdown ---------------------------- */

export interface CategoryConversion {
  category: string;
  discovered: number;
  won: number;
  lost: number;
  conversionRate: number | null; // won / (won + lost) — decided prospects only
}

export function conversionByCategory(prospects: Prospect[], opportunities: Opportunity[]): CategoryConversion[] {
  const categoryOf = new Map(opportunities.map((o) => [o.id, o.category]));
  const byCategory = new Map<string, { discovered: number; won: number; lost: number }>();
  for (const p of prospects) {
    const category = categoryOf.get(p.opportunityId) ?? 'Unknown';
    const bucket = byCategory.get(category) ?? { discovered: 0, won: 0, lost: 0 };
    bucket.discovered += 1;
    if (p.status === 'WON') bucket.won += 1;
    if (p.status === 'LOST' || p.status === 'NOT_INTERESTED') bucket.lost += 1;
    byCategory.set(category, bucket);
  }
  return [...byCategory.entries()].map(([category, b]) => ({
    category,
    discovered: b.discovered,
    won: b.won,
    lost: b.lost,
    conversionRate: b.won + b.lost > 0 ? Math.round((b.won / (b.won + b.lost)) * 1000) / 1000 : null,
  }));
}

/* ------------------------- acquisition channel breakdown --------------------- */

export interface ChannelPerformance {
  channel: string;
  dealCount: number;
  totalRevenue: number;
  totalProfit: number;
  avgDealValue: number;
}

/** Real acquisition-channel performance — from the real-revenue ledger
 *  (RealRevenueEntry.acquisitionChannel), the only field that records how a
 *  paying customer actually found the business, as opposed to
 *  Prospect.contactChannel, which only records how to reach them. */
export function conversionByAcquisitionChannel(realRevenue: RealRevenueEntry[]): ChannelPerformance[] {
  const byChannel = new Map<string, { revenue: number; profit: number; count: number }>();
  for (const r of realRevenue) {
    const channel = r.acquisitionChannel || 'Unspecified';
    const bucket = byChannel.get(channel) ?? { revenue: 0, profit: 0, count: 0 };
    bucket.revenue += r.amountReceived;
    bucket.profit += r.profit;
    bucket.count += 1;
    byChannel.set(channel, bucket);
  }
  return [...byChannel.entries()]
    .map(([channel, b]) => ({
      channel,
      dealCount: b.count,
      totalRevenue: Math.round(b.revenue * 100) / 100,
      totalProfit: Math.round(b.profit * 100) / 100,
      avgDealValue: b.count > 0 ? Math.round((b.revenue / b.count) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

/* ------------------------------- deal metrics -------------------------------- */

export interface DealMetrics {
  avgDealSize: number | null;
  avgTimeToPaymentDays: number | null;
  dealCount: number;
}

export function computeDealMetrics(realRevenue: RealRevenueEntry[]): DealMetrics {
  if (realRevenue.length === 0) return { avgDealSize: null, avgTimeToPaymentDays: null, dealCount: 0 };
  const totalAmount = realRevenue.reduce((s, r) => s + r.amountReceived, 0);
  const totalDays = realRevenue.reduce((s, r) => s + r.daysFromDiscoveryToPayment, 0);
  return {
    avgDealSize: Math.round((totalAmount / realRevenue.length) * 100) / 100,
    avgTimeToPaymentDays: Math.round(totalDays / realRevenue.length),
    dealCount: realRevenue.length,
  };
}

/** Sum of expectedValue across every prospect still active in the funnel —
 *  used as the "expected revenue influenced" denominator for search ROI
 *  before any real revenue exists (services/searchEconomy.ts computeSearchROI). */
export function openPipelineExpectedValue(prospects: Prospect[]): number {
  const total = prospects
    .filter((p) => p.status !== 'WON' && p.status !== 'LOST' && p.status !== 'NOT_INTERESTED')
    .reduce((s, p) => s + (p.score?.expectedValue ?? 0), 0);
  return Math.round(total * 100) / 100;
}

/** Offers waiting on a human to send — the most common single blocker
 *  between "the agent did its job" and "a prospect can even say yes". */
export function offersAwaitingSend(offers: Offer[]): number {
  return offers.filter((o) => o.status === 'DRAFT').length;
}
