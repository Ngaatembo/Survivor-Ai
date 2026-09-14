/* ============================================================================
 * Intelligence smoke test (Phase 5): blendWithReal bounds, category stats
 * computation, scoreOpportunity/realRevenueScore/scoreProspect blending
 * (all backward compatible, all no-ops below the sample-size threshold),
 * and computeRecommendedActions' real-world action weighting. Pure-function
 * tests — no network/D1 needed. Run with:
 *   npx tsx scripts/intelligence.smoke.ts
 * ========================================================================== */

import { SAMPLE_OPPORTUNITIES } from '../src/data/sampleData';
import { scoreOpportunity } from '../src/lib/scoring';
import { scoreProspect, priorityFromScore } from '../src/lib/prospectScoring';
import { generateBusinessModel } from '../src/lib/businessModel';
import { realRevenueScore, evaluateOpportunity } from '../src/lib/decisionEngine';
import { computeRecommendedActions } from '../src/lib/recommendedActions';
import {
  blendWithReal,
  realWorldBlendWeight,
  computeCategoryRealWorldStats,
  statsForCategory,
  type CategoryRealWorldStats,
} from '../src/lib/realRevenue';
import type { LeadScoreBreakdown, Opportunity, Prospect, RealRevenueEntry } from '../src/types';

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

function baseOpp(): Opportunity {
  const seed = SAMPLE_OPPORTUNITIES.find((o) => o.id === 'opp-ai-websites') ?? SAMPLE_OPPORTUNITIES[0];
  const scored = scoreOpportunity({ ...seed, researchStage: 'RANKED' });
  return { ...seed, researchStage: 'RANKED' as const, score: scored, lifecycleState: 'VALIDATING' as const, category: 'Local / Real-World' as const };
}

function baseProspect(opp: Opportunity, overrides: Partial<Prospect> = {}): Prospect {
  const s: LeadScoreBreakdown = scoreProspect(
    { websitePresence: 'NONE_FOUND', contactChannel: 'WHATSAPP', sourcesCount: 2, hasCommercialSignals: true, hasUrgencySignal: false },
    undefined,
  );
  return {
    id: overrides.id ?? 'prospect-intel-test',
    opportunityId: opp.id,
    opportunityName: opp.name,
    businessName: 'Test Salon',
    category: 'Local personal services',
    location: 'Marondera',
    websitePresence: 'NONE_FOUND',
    socialLinks: [],
    contactChannel: 'WHATSAPP',
    contactValue: '+263 77 000 0000',
    sources: [{ id: 'src-1', title: 'Test Salon | Facebook', url: 'https://facebook.com/testsalon', kind: 'web', note: 'test' }],
    evidenceNotes: 'test',
    priority: priorityFromScore(s, 'NONE_FOUND'),
    score: s,
    status: 'DISCOVERED',
    dataSource: 'LIVE',
    dateDiscovered: Date.now(),
    messagesSentCount: 0,
    responsesReceivedCount: 0,
    actualRevenue: 0,
    notes: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function baseEntry(opp: Opportunity, overrides: Partial<RealRevenueEntry> = {}): RealRevenueEntry {
  return {
    id: overrides.id ?? 'rr-intel-test',
    date: Date.now(),
    opportunityId: opp.id,
    opportunityName: opp.name,
    prospectId: 'prospect-intel-test',
    prospectName: 'Test Salon',
    projectId: 'proj-intel-test',
    productService: 'Website',
    quotedPrice: 100,
    amountReceived: 100,
    costs: 10,
    profit: 90,
    currency: 'USD',
    paymentMethod: 'MOBILE_MONEY',
    acquisitionChannel: 'WhatsApp outreach',
    daysFromDiscoveryToPayment: 5,
    createdAt: Date.now(),
    ...overrides,
  };
}

console.log('--- blendWithReal: no-op below sample threshold, bounded weight above it ---');
{
  assert(blendWithReal(0.5, 0.9, 0) === 0.5, 'zero sample size -> modeled value unchanged');
  assert(blendWithReal(0.5, 0.9, 2) === 0.5, 'below the 3-sample threshold -> modeled value unchanged');
  assert(blendWithReal(0.5, undefined, 10) === 0.5, 'undefined real value -> modeled value unchanged regardless of sample size');
  const blended = blendWithReal(0.5, 0.9, 3);
  assert(blended > 0.5 && blended < 0.9, `at threshold, blend sits strictly between modeled and real (got ${blended})`);
  const blendedMore = blendWithReal(0.5, 0.9, 20);
  assert(blendedMore > blended, `more samples pull the blend further toward real (${blendedMore} > ${blended})`);
  assert(realWorldBlendWeight(2) === 0, 'blend weight is 0 below threshold');
  assert(realWorldBlendWeight(3) > 0, 'blend weight is positive at threshold');
  assert(realWorldBlendWeight(1000) <= 0.6, 'blend weight never exceeds the 0.6 cap, however much data accumulates');
}

console.log('--- computeCategoryRealWorldStats: correct close rate, avg days, avg deal value ---');
{
  const opp = baseOpp();
  const won1 = baseProspect(opp, { id: 'p1', status: 'WON' });
  const won2 = baseProspect(opp, { id: 'p2', status: 'WON' });
  const lost1 = baseProspect(opp, { id: 'p3', status: 'LOST' });
  const discovered = baseProspect(opp, { id: 'p4', status: 'DISCOVERED' }); // not decided, excluded
  const entries = [
    baseEntry(opp, { id: 'rr1', amountReceived: 100, daysFromDiscoveryToPayment: 4 }),
    baseEntry(opp, { id: 'rr2', amountReceived: 200, daysFromDiscoveryToPayment: 6 }),
  ];
  const stats = computeCategoryRealWorldStats([opp], [won1, won2, lost1, discovered], entries);
  const catStats = statsForCategory(stats, opp.category);
  assert(!!catStats, 'stats computed for the category');
  assert(catStats!.decidedCount === 3, `decidedCount only counts WON+LOST, not DISCOVERED (got ${catStats!.decidedCount})`);
  assert(catStats!.wonCount === 2, 'wonCount counts correctly');
  assert(Math.abs(catStats!.realCloseRate - 2 / 3) < 0.001, `realCloseRate = won/decided (got ${catStats!.realCloseRate})`);
  assert(catStats!.avgRealTimeToRevenueDays === 5, 'avg days computed correctly (4,6 -> 5)');
  assert(catStats!.avgDealValue === 150, 'avg deal value computed correctly (100,200 -> 150)');

  const noStats = statsForCategory(stats, 'Digital Business');
  assert(noStats === undefined, 'no fabricated stats for a category with no data');
}

console.log('--- scoreOpportunity: backward compatible, blends only above threshold ---');
{
  const opp = baseOpp();
  const withoutStats = scoreOpportunity(opp);
  const withEmptyStats = scoreOpportunity(opp, []);
  assert(withoutStats.total === withEmptyStats.total, 'omitting categoryStats matches passing an empty array');

  const strongStats: CategoryRealWorldStats[] = [
    { category: opp.category, decidedCount: 5, wonCount: 5, realCloseRate: 1, avgRealTimeToRevenueDays: 2, avgDealValue: 100 },
  ];
  const withStrongStats = scoreOpportunity(opp, strongStats);
  assert(withStrongStats.total >= withoutStats.total, `a perfect real-world track record never scores lower (${withStrongStats.total} >= ${withoutStats.total})`);
}

console.log('--- realRevenueScore / evaluateOpportunity: categoryStats blending, still backward compatible ---');
{
  const opp = baseOpp();
  const plain = realRevenueScore(opp, []);
  const withEmpty = realRevenueScore(opp, [], [], []);
  assert(plain === withEmpty, 'omitting learningEvents/categoryStats matches passing empty arrays');

  const weakStats: CategoryRealWorldStats[] = [
    { category: opp.category, decidedCount: 5, wonCount: 0, realCloseRate: 0, avgRealTimeToRevenueDays: 60, avgDealValue: 10 },
  ];
  const withWeakStats = realRevenueScore(opp, [], [], weakStats);
  assert(withWeakStats < plain, `a category with 0% real close rate and slow real time-to-revenue scores lower (${withWeakStats} < ${plain})`);

  const { decision } = evaluateOpportunity(opp, [], []);
  assert(!!decision, 'evaluateOpportunity still works with only 3 args (fully backward compatible)');
}

console.log('--- scoreProspect: blends probabilityOfClose, adds an explanatory factor ---');
{
  const noStats = scoreProspect(
    { websitePresence: 'NONE_FOUND', contactChannel: 'WHATSAPP', sourcesCount: 2, hasCommercialSignals: true, hasUrgencySignal: false },
    undefined,
  );
  assert(!noStats.factors.some((f) => f.includes('Blended with')), 'no blend factor when no categoryStats given');

  const belowThreshold: CategoryRealWorldStats = { category: 'x', decidedCount: 2, wonCount: 2, realCloseRate: 1, avgRealTimeToRevenueDays: 5, avgDealValue: 100 };
  const stillNoBlend = scoreProspect(
    { websitePresence: 'NONE_FOUND', contactChannel: 'WHATSAPP', sourcesCount: 2, hasCommercialSignals: true, hasUrgencySignal: false },
    undefined,
    belowThreshold,
  );
  assert(stillNoBlend.probabilityOfClose === noStats.probabilityOfClose, 'below sample threshold, probabilityOfClose is unchanged');

  const strongTrackRecord: CategoryRealWorldStats = { category: 'x', decidedCount: 10, wonCount: 10, realCloseRate: 1, avgRealTimeToRevenueDays: 5, avgDealValue: 100 };
  const withBlend = scoreProspect(
    { websitePresence: 'NONE_FOUND', contactChannel: 'WHATSAPP', sourcesCount: 2, hasCommercialSignals: true, hasUrgencySignal: false },
    undefined,
    strongTrackRecord,
  );
  assert(withBlend.probabilityOfClose > noStats.probabilityOfClose, `a 100% real close rate pulls probabilityOfClose up (${withBlend.probabilityOfClose} > ${noStats.probabilityOfClose})`);
  assert(withBlend.probabilityOfClose <= 0.35, 'the conservative 35% ceiling still applies even with a perfect real track record');
  assert(withBlend.factors.some((f) => f.includes('Blended with')), 'an explanatory factor is added when the blend actually applies');
}

console.log('--- computeRecommendedActions: real-world weighting nudges prospect action expectedValue ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const prospect = baseProspect(opp, { status: 'DISCOVERED' });

  const noStatsActions = computeRecommendedActions([opp], [], [model], [], [prospect]);
  const contactAction = noStatsActions.find((a) => a.kind === 'CONTACT_PROSPECT');
  assert(!!contactAction, 'a CONTACT_PROSPECT action is produced for a DISCOVERED prospect');

  const strongCategoryStats: CategoryRealWorldStats[] = [
    { category: opp.category, decidedCount: 10, wonCount: 8, realCloseRate: 0.8, avgRealTimeToRevenueDays: 5, avgDealValue: 100 },
  ];
  const withStatsActions = computeRecommendedActions([opp], [], [model], [], [prospect], [], [], strongCategoryStats);
  const boostedAction = withStatsActions.find((a) => a.kind === 'CONTACT_PROSPECT');
  assert(!!boostedAction && boostedAction.expectedValue > contactAction!.expectedValue, `a category with a strong real close rate boosts the action's expectedValue (${boostedAction?.expectedValue} > ${contactAction!.expectedValue})`);

  const weakCategoryStats: CategoryRealWorldStats[] = [
    { category: opp.category, decidedCount: 10, wonCount: 0, realCloseRate: 0, avgRealTimeToRevenueDays: 60, avgDealValue: 10 },
  ];
  const withWeakStatsActions = computeRecommendedActions([opp], [], [model], [], [prospect], [], [], weakCategoryStats);
  const reducedAction = withWeakStatsActions.find((a) => a.kind === 'CONTACT_PROSPECT');
  assert(!!reducedAction && reducedAction.expectedValue < contactAction!.expectedValue, `a category with a 0% real close rate reduces the action's expectedValue (${reducedAction?.expectedValue} < ${contactAction!.expectedValue})`);
}

console.log(failures === 0 ? `\nAll checks passed.` : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
