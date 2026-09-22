import type { Prospect, Transaction } from '../types';
import { computeSurvivalStatus } from '../engine/seed';

export interface SurvivalScore {
  score: number;
  status: 'ALIVE' | 'AT_RISK' | 'CRITICAL' | 'DEAD';
  components: { cash: number; revenue: number; pipeline: number; resilience: number };
  runwayTransactions: number;
  explanation: string[];
  calculatedAt: number;
}

/** Explainable 0–100 operating-survival score from persisted business data. */
export function computeSurvivalScore(
  balance: number,
  startingCapital: number,
  prospects: Prospect[],
  transactions: Transaction[],
  now = Date.now(),
): SurvivalScore {
  const status = computeSurvivalStatus(balance);
  const cash = Math.max(0, Math.min(100, startingCapital > 0 ? (balance / startingCapital) * 100 : 0));
  const realizedRevenue = transactions
    .filter((t) => t.type === 'REVENUE')
    .reduce((s, t) => s + Math.max(0, t.amount), 0);
  const revenue = Math.min(100, realizedRevenue / Math.max(1, startingCapital) * 100);

  const active = prospects.filter((p) => !['WON', 'LOST', 'NOT_INTERESTED'].includes(p.status));
  const qualified = active.filter((p) =>
    ['QUALIFIED', 'CONTACTED', 'REPLIED', 'INTERESTED', 'PROPOSAL_SENT', 'NEGOTIATING', 'FOLLOW_UP'].includes(p.status),
  );
  const expectedPipeline = qualified.reduce((s, p) => s + Math.max(0, p.score?.expectedValue ?? 0), 0);
  const pipeline = Math.min(100, expectedPipeline / Math.max(1, startingCapital) * 100);

  const categories = new Set(active.map((p) => p.category).filter(Boolean)).size;
  const contactable = active.filter((p) => Boolean(p.contactValue)).length;
  const resilience = Math.min(100, categories * 20 + Math.min(5, contactable) * 8);
  const score = Math.round(Math.max(0, Math.min(100, cash * 0.5 + revenue * 0.2 + pipeline * 0.2 + resilience * 0.1)));
  const runwayTransactions = transactions.filter((t) => t.amount < 0).length;

  const explanation: string[] = [];
  if (status === 'DEAD') explanation.push('Balance is at or below zero; autonomous experiments remain stopped.');
  else if (balance < 5) explanation.push('Cash is below the normal survival threshold; fast, low-cost actions should dominate.');
  else explanation.push('Cash remains above the survival threshold.');
  if (realizedRevenue > 0) explanation.push('Recorded revenue is $' + realizedRevenue.toFixed(2) + '.');
  else explanation.push('No realized revenue has been recorded yet.');
  if (expectedPipeline > 0) explanation.push('Open qualified pipeline carries $' + expectedPipeline.toFixed(2) + ' of modeled expected value.');
  else explanation.push('There is no qualified open pipeline yet.');
  if (categories > 1) explanation.push('Pipeline spans ' + categories + ' business categories.');
  else explanation.push('Pipeline concentration is currently high.');

  return {
    score,
    status,
    components: { cash: Math.round(cash), revenue: Math.round(revenue), pipeline: Math.round(pipeline), resilience: Math.round(resilience) },
    runwayTransactions,
    explanation,
    calculatedAt: now,
  };
}
