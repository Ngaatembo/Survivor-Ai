/* ============================================================================
 * SURVIVE AI — Experiment simulation engine
 * ----------------------------------------------------------------------------
 * ALL OUTPUTS ARE SIMULATED. No real transaction, trade or payment ever occurs.
 * The model turns an opportunity's scored attributes + the agent's memory
 * into a plausible first-attempt result, so the loop can learn.
 * ========================================================================== */

import type { ExperimentOutcome, MemoryEntry, Opportunity } from '../types';

export interface SimulationInput {
  opportunity: Opportunity;
  budget: number;
  memory?: MemoryEntry; // what the agent already learned about this opportunity
}

export interface SimulationResult {
  outcome: ExperimentOutcome;
  actualCost: number;
  actualRevenue: number;
  durationDays: number;
  roll: number;
  adjustedProbability: number;
  lessons: string[];
  evidenceNote: string;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function simulateExperiment({ opportunity: o, budget, memory }: SimulationInput): SimulationResult {
  const actualCost = round2(budget);

  // --- Adjust base success probability -------------------------------------
  let p = o.successProbability;
  const adjustments: string[] = [];

  // Adequate capital slightly improves odds; underfunding hurts.
  if (budget >= o.capitalRequiredMin && o.capitalRequiredMin > 0) {
    p += 0.05;
    adjustments.push('Budget met the stated capital requirement (+confidence).');
  } else if (o.capitalRequiredMin > budget + 5) {
    p -= 0.1;
    adjustments.push('Budget was below the capital requirement; underfunded attempt (-confidence).');
  }

  // Learning from memory: prior wins teach what works; repeated failures warn.
  if (memory) {
    if (memory.tests >= 2 && memory.conclusion === 'AVOID') {
      p -= 0.15;
      adjustments.push('Memory flagged this model as repeatedly failing; outcome weighted down.');
    }
    if (memory.conclusion === 'PROMISING' && memory.tests >= 1) {
      p += 0.08;
      adjustments.push('Memory shows a prior promising attempt; refined approach (+confidence).');
    }
  }
  p = Math.max(0.03, Math.min(0.92, p));

  const roll = Math.random();
  let outcome: ExperimentOutcome;
  if (roll < p * 0.55) outcome = 'SUCCESS';
  else if (roll < p * 0.9) outcome = 'PARTIAL_SUCCESS';
  else if (Math.random() < 0.06) outcome = 'INCONCLUSIVE';
  else outcome = 'FAILED';

  // --- Revenue model --------------------------------------------------------
  const timeMid = (o.timeToRevenueDaysMin + o.timeToRevenueDaysMax) / 2;
  const durationDays = Math.round(
    rand(o.timeToRevenueDaysMin, Math.min(o.timeToRevenueDaysMax, o.timeToRevenueDaysMin + timeMid)),
  );

  let actualRevenue = 0;
  const revMax = Math.max(0, o.revenuePotentialMonthlyMax);
  const revMin = Math.max(0, o.revenuePotentialMonthlyMin);

  // First experiments capture only a small slice of modeled monthly potential —
  // revenue scales with budget adequacy, and stays modest for tiny tests.
  const budgetFactor = 0.6 + 0.4 * Math.min(1, budget / Math.max(5, o.capitalRequiredMin || 5));

  if (outcome === 'SUCCESS') {
    const ceiling = Math.min(Math.max(10, revMax * 0.12), 65);
    actualRevenue = round2(rand(4, ceiling) * budgetFactor);
  } else if (outcome === 'PARTIAL_SUCCESS') {
    actualRevenue = round2(rand(0, Math.min(Math.max(3, revMin * 0.2), 14)) * budgetFactor);
  } else if (outcome === 'INCONCLUSIVE') {
    actualRevenue = round2(Math.random() < 0.4 ? rand(0, 3) : 0);
  }

  // Slow-ramp models realistically return nothing on a first short experiment.
  if (o.timeToRevenueDaysMin >= 45 && outcome !== 'SUCCESS') actualRevenue = 0;

  // --- Lessons --------------------------------------------------------------
  const lessons: string[] = [];
  if (outcome === 'SUCCESS') {
    lessons.push(`First simulated revenue achieved (${actualRevenue > 0 ? 'cash collected' : 'pipeline built'}) — repeat and systematize the outreach/delivery pattern.`);
    lessons.push(`Cost $${actualCost.toFixed(2)} returned $${actualRevenue.toFixed(2)}; test whether the result is repeatable before scaling budget.`);
  } else if (outcome === 'PARTIAL_SUCCESS') {
    lessons.push('Partial traction: some signal but no reliable conversion. Change one variable (offer, channel, price) and retest.');
  } else if (outcome === 'FAILED') {
    lessons.push(`No revenue against $${actualCost.toFixed(2)} spent. Diagnose the bottleneck: distribution, offer, or price.`);
    lessons.push(o.competition >= 4 ? 'High competition likely raised customer-acquisition cost.' : 'Execution or channel choice is the likely failure point.');
  } else {
    lessons.push('Inconclusive within the test window — insufficient evidence; extend duration or narrow the offer before judging.');
  }
  adjustments.forEach((a) => lessons.push(a));

  return {
    outcome,
    actualCost,
    actualRevenue: round2(actualRevenue),
    durationDays,
    roll: Math.round(roll * 100) / 100,
    adjustedProbability: Math.round(p * 100) / 100,
    lessons,
    evidenceNote: `SIMULATED result (rule engine, p=${Math.round(p * 100)}%, roll=${Math.round(roll * 100)}). Not a real transaction; figures are model outputs.`,
  };
}

export function experimentBudget(o: Opportunity, balance: number): number {
  // Never risk more than ~18% of remaining capital in one experiment, and
  // always keep clear of the survival threshold.
  const pct = Math.floor(balance * 0.18);
  let budget = Math.min(Math.max(o.capitalRequiredMin, 2), Math.max(2, pct));
  budget = Math.min(budget, Math.max(2, balance - 0.5));
  return Math.round(Math.max(2, budget) * 100) / 100;
}
