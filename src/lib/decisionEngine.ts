/* ============================================================================
 * SURVIVE AI — KILL / ITERATE / SCALE decision engine + opportunity lifecycle
 * ----------------------------------------------------------------------------
 * Evidence-driven, explainable, and deliberately conservative: no opportunity
 * is ever promoted to PROVEN/SCALING off a single lucky result (PROOF_TESTS
 * gates every promotion), and a conclusively KILLed/ARCHIVED idea is never
 * re-litigated automatically — it stays parked unless new evidence arrives.
 *
 * Every call returns a fully-reasoned OpportunityDecision record so the
 * dashboard (and the audit log) can always answer "why did the agent do
 * that?" — see agent_actions / opportunity_decisions in schema.d1.sql.
 * ========================================================================== */

import type {
  DecisionAction,
  Experiment,
  LearningEvent,
  MemoryEntry,
  Opportunity,
  OpportunityDecision,
  OpportunityLifecycleState,
} from '../types';
import { uid } from './format';
import { realWorldScoreAdjustment } from './realRevenue';

/** Minimum composite score to leave pure research (DISCOVERED) and start
 *  spending simulated capital to test the idea for real (VALIDATING). */
export const VALIDATION_SCORE_THRESHOLD = 50;

/** Experiments required before a PROVEN/FAILED verdict may be reached —
 *  the guard against one lucky (or unlucky) result deciding everything. */
export const PROOF_TESTS = 3;

/** Additional confirming test required, on top of PROOF_TESTS, before a
 *  PROVEN opportunity may be promoted to SCALING. */
export const SCALE_TESTS = PROOF_TESTS + 1;

const EVIDENCE_WEIGHT: Record<Opportunity['evidenceTier'], number> = {
  VERIFIED: 1,
  LIKELY: 0.8,
  UNCERTAIN: 0.55,
  UNVERIFIED: 0.3,
};

/**
 * EXPECTED REAL REVENUE — the practical ranking score from build-spec §19:
 *   profit potential × probability of success × evidence quality
 *   × speed to revenue × repeatability ÷ complexity
 * A high simulated-ROI idea that can't realistically be sold or delivered
 * should rank below a lower-ROI idea that can produce real cash quickly.
 * Fully explainable — every factor is a plain field on the opportunity.
 */
export function realRevenueScore(opp: Opportunity, memory: MemoryEntry[], learningEvents: LearningEvent[] = []): number {
  const profitPotential = Math.max(0, (opp.revenuePotentialMonthlyMin + opp.revenuePotentialMonthlyMax) / 2);
  const evidenceQuality = EVIDENCE_WEIGHT[opp.evidenceTier];
  const avgDays = Math.max(1, (opp.timeToRevenueDaysMin + opp.timeToRevenueDaysMax) / 2);
  const speedToRevenue = 14 / avgDays; // normalized so ~2 weeks = 1.0
  const repeatability = opp.scalability / 5;
  const complexity = Math.max(1, opp.difficulty);

  let score = (profitPotential * opp.successProbability * evidenceQuality * speedToRevenue * repeatability) / complexity;

  const mem = memory.find((m) => m.kind === 'opportunity' && m.refId === opp.id);
  if (mem) {
    if (mem.conclusion === 'VIABLE' || mem.conclusion === 'PROMISING') score *= 1.4;
    else if (mem.conclusion === 'MIXED') score *= 0.8;
    else if (mem.conclusion === 'AVOID') score *= 0.05;
  }

  // Phase 4 §17 — a small, explainable real-world adjustment once at least
  // 2 real outcomes exist for this category. Never applied on a single
  // data point; see realWorldScoreAdjustment for the exact rule.
  score *= realWorldScoreAdjustment(opp.category, learningEvents).multiplier;

  return Math.round(score * 100) / 100;
}

interface EvidenceSnapshot {
  tests: number;
  successes: number;
  failures: number;
  spent: number;
  revenue: number;
}

function gatherEvidence(opp: Opportunity, memory: MemoryEntry[], experiments: Experiment[]): EvidenceSnapshot {
  const mem = memory.find((m) => m.kind === 'opportunity' && m.refId === opp.id);
  const relevant = experiments.filter((e) => e.opportunityId === opp.id);
  const successes = relevant.filter((e) => e.outcome === 'SUCCESS' || e.outcome === 'PARTIAL_SUCCESS').length;
  const failures = relevant.filter((e) => e.outcome === 'FAILED').length;
  return {
    tests: mem?.tests ?? relevant.length,
    successes,
    failures,
    spent: mem?.spent ?? relevant.reduce((s, e) => s + e.actualCost, 0),
    revenue: mem?.revenue ?? relevant.reduce((s, e) => s + e.actualRevenue, 0),
  };
}

export interface EvaluationResult {
  decision: OpportunityDecision;
  newLifecycleState: OpportunityLifecycleState;
}

/**
 * Evaluate one opportunity against its accumulated evidence and produce a
 * fully-reasoned KILL/ITERATE/SCALE/CONTINUE decision plus the resulting
 * lifecycle state. Pure function — callers persist the result.
 */
export function evaluateOpportunity(
  opp: Opportunity,
  memory: MemoryEntry[],
  experiments: Experiment[],
  learningEvents: LearningEvent[] = [],
  now: number = Date.now(),
): EvaluationResult {
  const ev = gatherEvidence(opp, memory, experiments);
  const score = realRevenueScore(opp, memory, learningEvents);
  const prev = opp.lifecycleState ?? 'DISCOVERED';

  let action: DecisionAction = 'CONTINUE';
  let next: OpportunityLifecycleState = prev;
  let reasoning: string;
  let nextAction: string;

  if (opp.executionBlocked) {
    next = prev === 'ARCHIVED' ? 'ARCHIVED' : 'DISCOVERED';
    action = 'CONTINUE';
    reasoning = `Execution-blocked category (${opp.blockReason ?? 'research-only'}) — research continues, but this category is never tested or scaled.`;
    nextAction = 'Continue research only; no experiment will ever be authorized for this category.';
  } else if (prev === 'FAILED' || prev === 'ARCHIVED') {
    next = prev;
    action = 'KILL';
    reasoning = `Already marked ${prev} after ${ev.tests} test(s) (${ev.successes} positive, ${ev.failures} failed, $${ev.revenue.toFixed(2)} returned on $${ev.spent.toFixed(2)} spent). No new evidence has arrived to justify reopening it.`;
    nextAction = 'Leave archived — only reopen if a materially new variant (price, channel, offer) is proposed.';
  } else if (prev === 'DISCOVERED') {
    if (opp.score && opp.score.total >= VALIDATION_SCORE_THRESHOLD) {
      next = 'VALIDATING';
      action = 'ITERATE';
      reasoning = `Score ${opp.score.total}/100 clears the ${VALIDATION_SCORE_THRESHOLD}-point validation threshold — moving from pure research into active testing.`;
      nextAction = `Run a first small, time-boxed experiment for "${opp.name}".`;
    } else {
      next = 'DISCOVERED';
      action = 'CONTINUE';
      reasoning = opp.score
        ? `Score ${opp.score.total}/100 is below the ${VALIDATION_SCORE_THRESHOLD}-point validation threshold.`
        : 'Not yet scored — research continues.';
      nextAction = 'Continue research and scoring.';
    }
  } else if (prev === 'VALIDATING') {
    if (ev.tests >= PROOF_TESTS && ev.failures === 0 && ev.successes >= 2 && ev.revenue > ev.spent) {
      next = 'PROVEN';
      action = 'SCALE';
      reasoning = `${ev.tests} experiments run, ${ev.successes} positive and 0 failed, $${ev.revenue.toFixed(2)} returned on $${ev.spent.toFixed(2)} spent — repeated evidence, not a single lucky result. Promoting to PROVEN.`;
      nextAction = `Generate/refresh the business model and begin real-world outreach for "${opp.name}".`;
    } else if (ev.tests >= PROOF_TESTS && ev.successes === 0) {
      next = 'FAILED';
      action = 'KILL';
      reasoning = `${ev.tests} experiments run with zero successes ($${ev.spent.toFixed(2)} spent, $${ev.revenue.toFixed(2)} returned). Evidence contradicts the original hypothesis.`;
      nextAction = 'Stop testing this opportunity; capital is better spent elsewhere.';
    } else if (ev.tests >= PROOF_TESTS && ev.failures > 0 && ev.successes > 0) {
      next = 'VALIDATING';
      action = 'ITERATE';
      reasoning = `Mixed evidence after ${ev.tests} tests (${ev.successes} positive, ${ev.failures} failed) — the underlying problem looks real but the offer, price, channel or delivery needs a real change before judging it further.`;
      nextAction = 'Change one meaningful variable (price, channel, offer) and test again — do not repeat the same experiment unchanged.';
    } else {
      next = 'VALIDATING';
      action = 'CONTINUE';
      reasoning = `${ev.tests}/${PROOF_TESTS} proof experiments run so far (${ev.successes} positive, ${ev.failures} failed) — not enough evidence yet for a verdict.`;
      nextAction = 'Run another experiment to build evidence before a KILL/SCALE decision.';
    }
  } else if (prev === 'PROVEN') {
    if (ev.failures > 0) {
      next = 'VALIDATING';
      action = 'ITERATE';
      reasoning = `New evidence contradicts a prior PROVEN verdict (a failed result appeared after promotion) — demoting back to VALIDATING pending a re-test.`;
      nextAction = 'Re-run the experiment or adjust the offer before trusting this opportunity again.';
    } else if (ev.tests >= SCALE_TESTS && opp.scalability >= 4 && ev.revenue > ev.spent * 3) {
      next = 'SCALING';
      action = 'SCALE';
      reasoning = `${ev.tests} tests, all non-failing, revenue ${(ev.revenue / Math.max(0.01, ev.spent)).toFixed(1)}x spend, scalability ${opp.scalability}/5 — economics, demand and repeatability all support scaling.`;
      nextAction = `Increase experiment frequency/budget for "${opp.name}" and prioritize real customer acquisition.`;
    } else {
      next = 'PROVEN';
      action = 'CONTINUE';
      reasoning = `Proven (${ev.tests} tests, ${ev.successes} positive) but not yet meeting the scale bar (needs ${SCALE_TESTS}+ tests, scalability ≥4/5, revenue >3x spend — currently scalability ${opp.scalability}/5).`;
      nextAction = 'Keep pursuing real customers for this proven model; re-evaluate scaling next cycle.';
    }
  } else if (prev === 'SCALING') {
    if (ev.failures > 0) {
      next = 'VALIDATING';
      action = 'ITERATE';
      reasoning = `A failure appeared while SCALING — pausing the scale-up and demoting back to VALIDATING until the cause is understood.`;
      nextAction = 'Investigate what changed before resuming scale-up.';
    } else {
      next = 'SCALING';
      action = 'SCALE';
      reasoning = `Continuing to scale — ${ev.tests} tests, ${ev.successes} positive, 0 failed, $${ev.revenue.toFixed(2)} returned on $${ev.spent.toFixed(2)} spent.`;
      nextAction = 'Keep increasing real-world acquisition effort for this model.';
    }
  } else {
    next = prev;
    reasoning = 'No rule matched — leaving lifecycle state unchanged.';
    nextAction = 'Re-check on the next cycle.';
  }

  const decision: OpportunityDecision = {
    id: uid('dec'),
    opportunityId: opp.id,
    opportunityName: opp.name,
    action,
    previousState: prev,
    newState: next,
    reasoning,
    evidenceSummary: `${ev.tests} test(s) — ${ev.successes} positive, ${ev.failures} failed. $${ev.spent.toFixed(2)} spent, $${ev.revenue.toFixed(2)} returned.`,
    metrics: { tests: ev.tests, spent: ev.spent, revenue: ev.revenue, realRevenueScore: score },
    nextAction,
    createdAt: now,
  };

  return { decision, newLifecycleState: next };
}
