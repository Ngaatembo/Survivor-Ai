/* ============================================================================
 * SURVIVE AI — Experiment simulation engine
 * ----------------------------------------------------------------------------
 * ALL OUTPUTS ARE SIMULATED. No real transaction, trade or payment ever occurs.
 * The model turns an opportunity's scored attributes + the agent's memory
 * into a plausible first-attempt result, so the loop can learn.
 * ========================================================================== */

import type { ExperimentOutcome, MarketPriceResearch, MemoryEntry, Opportunity } from '../types';

export interface SimulationInput {
  opportunity: Opportunity;
  budget: number;
  memory?: MemoryEntry; // what the agent already learned about this opportunity
  marketPrice?: MarketPriceResearch; // real researched rate, when available
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

  const text = [o.name, o.description, o.howMoneyMade, ...(o.tags ?? [])].join(' ').toLowerCase();
  const isWebsite = /website|web design|web development|landing page|business site|web site|online presence|booking site|restaurant site|company site/.test(text);

  // A test budget is acquisition/validation spend, NOT the selling price.
  // A successful $5 test can therefore produce a $150+ service sale.
  // Prefer live market research when it exists.
  let priceMin = marketPrice?.priceMin ?? 0;
  let priceMax = marketPrice?.priceMax ?? 0;

  // Configured NWT Dev website pricing ladder. These are actual sell prices,
  // not a percentage of the experiment budget.
  if (priceMax <= 0 && isWebsite) {
    if (/e-?commerce|online store|shop|payment gateway|custom app|advanced booking|admin panel/.test(text)) {
      priceMin = 450; priceMax = 450;
    } else if (/booking|reservation|restaurant|hotel|guest house|car rental|multi-page|5-page|cms|dashboard/.test(text)) {
      priceMin = 350; priceMax = 350;
    } else if (/business|company|contractor|service|4-page|four-page|5-page/.test(text)) {
      priceMin = 250; priceMax = 250;
    } else {
      priceMin = 150; priceMax = 150;
    }
  }

  if (outcome === 'SUCCESS' && priceMax > 0) {
    actualRevenue = round2(rand(priceMin, Math.max(priceMin, priceMax)));
  } else if (outcome === 'PARTIAL_SUCCESS' && priceMax > 0) {
    // Partial success means a smaller paid job/deposit rather than inventing
    // a tiny $10–$15 revenue figure.
    actualRevenue = round2(rand(priceMin * 0.25, priceMax * 0.5));
  } else if (outcome === 'INCONCLUSIVE') {
    actualRevenue = 0;
  }

  // If there is no evidence-backed market price for a non-website model,
  // do not manufacture a fake revenue number from the monthly potential.
  // The next research cycle can obtain a real market range first.

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

/** Hard server-side cap: never allocate more than this fraction of balance
 *  to a single experiment. Enforced here AND re-checked by the caller
 *  immediately before the ledger write — see agentEngine.ts. */
export const MAX_EXPERIMENT_ALLOCATION_PCT = 0.18;

/**
 * Returns the experiment budget for one cycle, or 0 if the balance is too
 * small to fund anything within the 18% cap. IMPORTANT: unlike an earlier
 * version of this function, the 18% ceiling is a HARD cap — it is never
 * overridden by a "minimum viable experiment" floor. At low balances (e.g.
 * $5, where 18% is $0.90) that means no experiment runs this cycle; the
 * agent keeps researching instead of quietly overspending its cap.
 */
export function experimentBudget(o: Opportunity, balance: number): number {
  if (balance <= 0) return 0;
  const cap = Math.round(balance * MAX_EXPERIMENT_ALLOCATION_PCT * 100) / 100;
  if (cap < 1) return 0; // too little capital left to fund a meaningful, capped experiment
  // Within the cap, prefer the opportunity's own minimum requirement (never
  // exceed the cap to reach it), and always leave the survival threshold's
  // worth of headroom untouched where the balance allows.
  const desired = Math.max(1, o.capitalRequiredMin || 1);
  let budget = Math.min(desired, cap);
  budget = Math.min(budget, Math.max(0, balance - 0.5));
  return Math.round(Math.max(0, budget) * 100) / 100;
}
