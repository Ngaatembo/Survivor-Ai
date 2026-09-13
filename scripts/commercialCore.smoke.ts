/* ============================================================================
 * Commercial-core smoke test (business-model generator, opportunity
 * lifecycle, KILL/ITERATE/SCALE decision engine, recommended actions).
 * Pure-function tests — no D1/Supabase needed. Run with:
 *   npx tsx scripts/commercialCore.smoke.ts
 * ========================================================================== */

import { SAMPLE_OPPORTUNITIES } from '../src/data/sampleData';
import { scoreOpportunity } from '../src/lib/scoring';
import { evaluateOpportunity, realRevenueScore, PROOF_TESTS, SCALE_TESTS } from '../src/lib/decisionEngine';
import { generateBusinessModel } from '../src/lib/businessModel';
import { computeRecommendedActions } from '../src/lib/recommendedActions';
import type { Experiment, MemoryEntry, Opportunity } from '../src/types';

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

function baseOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  const seed = SAMPLE_OPPORTUNITIES.find((o) => o.id === 'opp-ai-websites') ?? SAMPLE_OPPORTUNITIES[0];
  const scored = scoreOpportunity({ ...seed, researchStage: 'RANKED' });
  return { ...seed, researchStage: 'RANKED', score: scored, lifecycleState: 'DISCOVERED', ...overrides };
}

function exp(id: string, opportunityId: string, outcome: Experiment['outcome'], cost: number, revenue: number): Experiment {
  return {
    id,
    cycleId: null,
    opportunityId,
    opportunityName: 'test',
    category: 'Services',
    objective: 'test',
    startingBudget: cost,
    plannedAction: 'test',
    expectedOutcome: 'test',
    actualCost: cost,
    actualRevenue: revenue,
    profitLoss: revenue - cost,
    roi: cost > 0 ? Math.round(((revenue - cost) / cost) * 100) : 0,
    outcome,
    durationDays: 3,
    lessonsLearned: [],
    evidenceNote: '',
    simulated: true,
    createdAt: Date.now(),
  };
}

console.log('--- Lifecycle: DISCOVERED -> VALIDATING gated by score threshold ---');
{
  const low = baseOpp({ score: { ...baseOpp().score!, total: 20 } });
  const { newLifecycleState: lowNext } = evaluateOpportunity(low, [], []);
  assert(lowNext === 'DISCOVERED', 'low score (20) stays DISCOVERED');

  const high = baseOpp({ score: { ...baseOpp().score!, total: 65 } });
  const { newLifecycleState: highNext, decision } = evaluateOpportunity(high, [], []);
  assert(highNext === 'VALIDATING', 'score >= 50 (65) moves to VALIDATING');
  assert(decision.action === 'ITERATE', 'DISCOVERED->VALIDATING is logged as ITERATE (start testing)');
}

console.log('--- Lifecycle: one lucky result must NOT prove an opportunity ---');
{
  const opp = baseOpp({ lifecycleState: 'VALIDATING' });
  const oneSuccess = [exp('e1', opp.id, 'SUCCESS', 5, 40)];
  const { newLifecycleState } = evaluateOpportunity(opp, [], oneSuccess);
  assert(newLifecycleState === 'VALIDATING', `1 success alone does not promote to PROVEN (stayed ${newLifecycleState})`);
  assert(PROOF_TESTS >= 3, 'PROOF_TESTS guard is at least 3');
}

console.log('--- Lifecycle: repeated success -> PROVEN (SCALE decision) ---');
{
  const opp = baseOpp({ lifecycleState: 'VALIDATING' });
  const experiments = [
    exp('e1', opp.id, 'SUCCESS', 5, 40),
    exp('e2', opp.id, 'SUCCESS', 5, 35),
    exp('e3', opp.id, 'PARTIAL_SUCCESS', 5, 20),
  ];
  const { newLifecycleState, decision } = evaluateOpportunity(opp, [], experiments);
  assert(newLifecycleState === 'PROVEN', `${PROOF_TESTS} clean positive results -> PROVEN (got ${newLifecycleState})`);
  assert(decision.action === 'SCALE', 'promotion to PROVEN is logged as a SCALE decision');
}

console.log('--- Lifecycle: repeated failure -> FAILED (KILL decision) ---');
{
  const opp = baseOpp({ lifecycleState: 'VALIDATING' });
  const experiments = [
    exp('e1', opp.id, 'FAILED', 5, 0),
    exp('e2', opp.id, 'FAILED', 5, 0),
    exp('e3', opp.id, 'FAILED', 5, 0),
  ];
  const { newLifecycleState, decision } = evaluateOpportunity(opp, [], experiments);
  assert(newLifecycleState === 'FAILED', `${PROOF_TESTS} failures -> FAILED (got ${newLifecycleState})`);
  assert(decision.action === 'KILL', 'demotion to FAILED is logged as a KILL decision');
}

console.log('--- Lifecycle: mixed evidence -> stays VALIDATING (ITERATE) ---');
{
  const opp = baseOpp({ lifecycleState: 'VALIDATING' });
  const experiments = [
    exp('e1', opp.id, 'SUCCESS', 5, 20),
    exp('e2', opp.id, 'FAILED', 5, 0),
    exp('e3', opp.id, 'FAILED', 5, 0),
  ];
  const { newLifecycleState, decision } = evaluateOpportunity(opp, [], experiments);
  assert(newLifecycleState === 'VALIDATING', `mixed evidence stays VALIDATING (got ${newLifecycleState})`);
  assert(decision.action === 'ITERATE', 'mixed evidence is logged as ITERATE, not KILL or SCALE');
}

console.log('--- Lifecycle: a conclusively FAILED opportunity is not reopened automatically ---');
{
  const opp = baseOpp({ lifecycleState: 'FAILED' });
  const { newLifecycleState, decision } = evaluateOpportunity(opp, [], []);
  assert(newLifecycleState === 'FAILED', 'stays FAILED with no new evidence');
  assert(decision.action === 'KILL', 'still reported as KILL (no reopening without new evidence)');
}

console.log('--- Lifecycle: PROVEN -> SCALING requires more evidence than PROVEN alone ---');
{
  const opp = baseOpp({ lifecycleState: 'PROVEN', scalability: 5 });
  const notEnough = [exp('e1', opp.id, 'SUCCESS', 5, 40), exp('e2', opp.id, 'SUCCESS', 5, 35), exp('e3', opp.id, 'SUCCESS', 5, 30)];
  const { newLifecycleState: stillProven } = evaluateOpportunity(opp, [], notEnough);
  assert(stillProven === 'PROVEN', `${PROOF_TESTS} tests alone is not enough to SCALE (got ${stillProven})`);

  const enough = [...notEnough, exp('e4', opp.id, 'SUCCESS', 5, 60)];
  assert(enough.length >= SCALE_TESTS, 'test fixture actually reaches SCALE_TESTS');
  const { newLifecycleState: scaled, decision } = evaluateOpportunity(opp, [], enough);
  assert(scaled === 'SCALING', `${SCALE_TESTS} tests + high scalability + strong revenue -> SCALING (got ${scaled})`);
  assert(decision.action === 'SCALE', 'SCALING transition logged as SCALE');
}

console.log('--- REAL_REVENUE_SCORE: a fast, cheap, high-evidence idea beats a slow high-ROI one ---');
{
  const fastCheap = baseOpp({
    revenuePotentialMonthlyMin: 100,
    revenuePotentialMonthlyMax: 200,
    timeToRevenueDaysMin: 3,
    timeToRevenueDaysMax: 7,
    evidenceTier: 'VERIFIED',
    successProbability: 0.7,
    difficulty: 2,
  });
  const slowUnproven = baseOpp({
    id: 'opp-slow',
    revenuePotentialMonthlyMin: 1000,
    revenuePotentialMonthlyMax: 5000,
    timeToRevenueDaysMin: 180,
    timeToRevenueDaysMax: 365,
    evidenceTier: 'UNVERIFIED',
    successProbability: 0.1,
    difficulty: 5,
  });
  const fastScore = realRevenueScore(fastCheap, []);
  const slowScore = realRevenueScore(slowUnproven, []);
  assert(fastScore > slowScore, `fast/cheap/proven (${fastScore}) outranks slow/unproven/high-ROI (${slowScore})`);
}

console.log('--- Business model generator produces a concrete, sellable offer ---');
{
  const opp = baseOpp({ score: { ...baseOpp().score!, total: 70 } });
  const model = generateBusinessModel(opp, []);
  assert(model.suggestedPrice > 0, `has a positive suggested price ($${model.suggestedPrice})`);
  assert(model.opportunityId === opp.id, 'linked to the correct opportunity');
  assert(model.salesMessage.length > 20, 'has a real sales message, not empty');
  assert(model.followUpSequence.length >= 2, 'has a follow-up sequence');
  assert(model.objectionHandling.length >= 2, 'has objection handling');
  assert(model.expectedProfitFirstDeal === Math.round((model.suggestedPrice - model.deliveryCostEstimate) * 100) / 100, 'expected profit matches price minus delivery cost');
  assert(model.generator === 'local-rule-engine', 'labeled as rule-engine generated, not fabricated as LLM output');
}

console.log('--- Recommended actions rank a PROVEN opportunity above a fresh DISCOVERED one ---');
{
  const proven = baseOpp({ id: 'opp-proven', lifecycleState: 'PROVEN', score: { ...baseOpp().score!, total: 80 } });
  const discovered = baseOpp({ id: 'opp-discovered', lifecycleState: 'DISCOVERED', score: { ...baseOpp().score!, total: 55 } });
  const model = generateBusinessModel(proven, []);
  const actions = computeRecommendedActions([proven, discovered], [], [model], []);
  assert(actions.length > 0, 'produced at least one action');
  assert(actions[0].opportunityId === proven.id, `top action is the PROVEN opportunity (got ${actions[0].opportunityId})`);
}

console.log('--- Execution-blocked opportunities never leave DISCOVERED ---');
{
  const blocked = baseOpp({ executionBlocked: true, blockReason: 'Finance category', score: { ...baseOpp().score!, total: 95 } });
  const { newLifecycleState } = evaluateOpportunity(blocked, [], [exp('e1', blocked.id, 'SUCCESS', 5, 100)]);
  assert(newLifecycleState === 'DISCOVERED', `execution-blocked stays DISCOVERED regardless of score/evidence (got ${newLifecycleState})`);
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
