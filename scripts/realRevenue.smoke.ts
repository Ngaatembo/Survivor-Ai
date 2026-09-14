/* ============================================================================
 * Real revenue smoke test (Phase 4): profit calc, learning-event generation,
 * memory folding (never mixing real $ into simulated tests/spent/revenue),
 * the real-world scoring adjustment (2+ data points, explainable, capped),
 * simulation-vs-reality comparison, and repository round-trips (append-only
 * ledger, project outcome tracking). Pure-function tests — no network/D1
 * needed. Run with:
 *   npx tsx scripts/realRevenue.smoke.ts
 * ========================================================================== */

import { SAMPLE_OPPORTUNITIES } from '../src/data/sampleData';
import { scoreOpportunity } from '../src/lib/scoring';
import { generateBusinessModel } from '../src/lib/businessModel';
import { realRevenueScore, evaluateOpportunity } from '../src/lib/decisionEngine';
import {
  computeProfit,
  generateLearningEvent,
  foldRealRevenueIntoMemory,
  realWorldScoreAdjustment,
  comparePredictionToActual,
  aggregateRealityComparison,
} from '../src/lib/realRevenue';
import { InMemoryRepository } from '../src/engine/inMemoryRepository';
import type { LearningEvent, MemoryEntry, Opportunity, RealRevenueEntry } from '../src/types';

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

function baseEntry(opp: Opportunity, overrides: Partial<RealRevenueEntry> = {}): RealRevenueEntry {
  return {
    id: 'rr-test-1',
    date: Date.now(),
    opportunityId: opp.id,
    opportunityName: opp.name,
    prospectId: 'prospect-1',
    prospectName: 'Test Bakery',
    projectId: 'proj-1',
    productService: 'Website',
    quotedPrice: 100,
    amountReceived: 100,
    costs: 10,
    profit: 90,
    currency: 'USD',
    paymentMethod: 'MOBILE_MONEY',
    acquisitionChannel: 'WhatsApp outreach',
    daysFromDiscoveryToPayment: 9,
    createdAt: Date.now(),
    ...overrides,
  };
}

console.log('--- Profit calculation ---');
{
  assert(computeProfit(100, 10) === 90, 'profit = received - costs');
  assert(computeProfit(0, 0) === 0, 'zero in, zero out');
  assert(computeProfit(100.1, 0.05) === 100.05, 'rounds to cents cleanly');
}

console.log('--- Learning event: compares real numbers, never fabricates a missing prediction ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const entry = baseEntry(opp, { amountReceived: model.suggestedPrice * 1.5 });
  const event = generateLearningEvent(entry, opp, model);
  assert(event.kind === 'PREDICTION_VS_ACTUAL', 'kind is PREDICTION_VS_ACTUAL');
  assert(event.predictedValue === model.suggestedPrice, 'predictedValue matches the business model price');
  assert(event.actualValue === entry.amountReceived, 'actualValue matches the entry');
  assert(event.deltaPct !== undefined && event.deltaPct > 0, `positive delta when actual > predicted (got ${event.deltaPct})`);
  assert(event.summary.includes(opp.name), 'summary references the real opportunity name');

  const noModelEvent = generateLearningEvent(entry, opp, undefined);
  assert(noModelEvent.predictedValue === undefined, 'no business model -> no fabricated predicted price');
  assert(noModelEvent.deltaPct === undefined, 'no predicted price -> no fabricated delta');
}

console.log('--- Memory folding: real $ never touches simulated tests/spent/revenue/conclusion ---');
{
  const opp = baseOpp();
  const entry = baseEntry(opp);
  const memory: MemoryEntry[] = [
    { id: 'mem-opp-1', kind: 'opportunity', refId: opp.id, title: opp.name, tests: 2, spent: 2, revenue: 20, conclusion: 'VIABLE', notes: ['old note'], updatedAt: Date.now() },
  ];
  const updated = foldRealRevenueIntoMemory(memory, entry, opp);
  const oppMem = updated.find((m) => m.kind === 'opportunity' && m.refId === opp.id)!;
  assert(oppMem.tests === 2, 'simulated tests count untouched by real revenue');
  assert(oppMem.spent === 2, 'simulated spent untouched');
  assert(oppMem.revenue === 20, 'simulated revenue untouched (real $ never mixed in)');
  assert(oppMem.conclusion === 'VIABLE', 'conclusion untouched');
  assert(oppMem.notes[0].startsWith('[REAL]'), 'a [REAL]-tagged note was prepended');
  assert(oppMem.notes.includes('old note'), 'existing notes preserved');

  const catMem = updated.find((m) => m.kind === 'category' && m.refId === opp.category);
  assert(!!catMem, 'category-level memory entry created if missing');
  assert(catMem!.notes[0].startsWith('[REAL]'), 'category memory also gets the real-world note');
}

console.log('--- Real-world score adjustment: v1 rule-based, explainable, requires 2+ data points ---');
{
  const category = 'Local / Real-World';
  const oneEvent: LearningEvent[] = [
    { id: 'le-1', kind: 'PREDICTION_VS_ACTUAL', opportunityId: 'o1', category, refId: 'rr-1', summary: 's', deltaPct: -50, createdAt: Date.now() },
  ];
  assert(realWorldScoreAdjustment(category, oneEvent).multiplier === 1, 'a single data point never adjusts scoring');

  const twoBadEvents: LearningEvent[] = [
    ...oneEvent,
    { id: 'le-2', kind: 'PREDICTION_VS_ACTUAL', opportunityId: 'o2', category, refId: 'rr-2', summary: 's', deltaPct: -45, createdAt: Date.now() },
  ];
  const badAdj = realWorldScoreAdjustment(category, twoBadEvents);
  assert(badAdj.multiplier < 1, `consistently underperforming category gets a downward multiplier (got ${badAdj.multiplier})`);
  assert(!!badAdj.factor && badAdj.factor.includes(category), 'adjustment includes an explainable factor naming the category');

  const twoGoodEvents: LearningEvent[] = [
    { id: 'le-3', kind: 'PREDICTION_VS_ACTUAL', opportunityId: 'o3', category, refId: 'rr-3', summary: 's', deltaPct: 40, createdAt: Date.now() },
    { id: 'le-4', kind: 'PREDICTION_VS_ACTUAL', opportunityId: 'o4', category, refId: 'rr-4', summary: 's', deltaPct: 35, createdAt: Date.now() },
  ];
  const goodAdj = realWorldScoreAdjustment(category, twoGoodEvents);
  assert(goodAdj.multiplier > 1, `consistently outperforming category gets an upward multiplier (got ${goodAdj.multiplier})`);

  const mixedEvents: LearningEvent[] = [
    { id: 'le-5', kind: 'PREDICTION_VS_ACTUAL', opportunityId: 'o5', category, refId: 'rr-5', summary: 's', deltaPct: 5, createdAt: Date.now() },
    { id: 'le-6', kind: 'PREDICTION_VS_ACTUAL', opportunityId: 'o6', category, refId: 'rr-6', summary: 's', deltaPct: -5, createdAt: Date.now() },
  ];
  assert(realWorldScoreAdjustment(category, mixedEvents).multiplier === 1, 'roughly-accurate predictions get no adjustment');
}

console.log('--- realRevenueScore / evaluateOpportunity: backward compatible, and apply the adjustment when wired ---');
{
  const opp = baseOpp();
  const withoutEvents = realRevenueScore(opp, []);
  const withNeutralEvents = realRevenueScore(opp, [], []);
  assert(withoutEvents === withNeutralEvents, 'omitting learningEvents entirely matches passing an empty array');

  const badEvents: LearningEvent[] = [
    { id: 'le-1', kind: 'PREDICTION_VS_ACTUAL', opportunityId: 'x', category: opp.category, refId: 'r1', summary: 's', deltaPct: -60, createdAt: Date.now() },
    { id: 'le-2', kind: 'PREDICTION_VS_ACTUAL', opportunityId: 'y', category: opp.category, refId: 'r2', summary: 's', deltaPct: -55, createdAt: Date.now() },
  ];
  const withBadEvents = realRevenueScore(opp, [], badEvents);
  assert(withBadEvents < withoutEvents, `a category with poor real-world results scores lower (${withBadEvents} < ${withoutEvents})`);

  // evaluateOpportunity (3-arg call, pre-Phase-4 call sites) stays valid.
  const { decision } = evaluateOpportunity(opp, [], []);
  assert(!!decision, 'evaluateOpportunity still works called with only 3 args (backward compatible)');
}

console.log('--- Simulation vs reality: degrades gracefully with no data, compares correctly with data ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const noDataComparison = comparePredictionToActual(opp, model, []);
  assert(noDataComparison.realEntryCount === 0, 'no entries -> honest empty state, not a fabricated number');
  assert(noDataComparison.realAvgPrice === undefined, 'no fabricated average price with zero entries');

  const entries = [
    baseEntry(opp, { id: 'rr-a', amountReceived: model.suggestedPrice, daysFromDiscoveryToPayment: 5 }),
    baseEntry(opp, { id: 'rr-b', amountReceived: model.suggestedPrice, daysFromDiscoveryToPayment: 7 }),
  ];
  const withData = comparePredictionToActual(opp, model, entries);
  assert(withData.realEntryCount === 2, 'counts real entries correctly');
  assert(withData.realAvgPrice === model.suggestedPrice, 'avg price computed correctly across entries');
  assert(withData.priceDeltaPct === 0, 'zero delta when actual matches predicted exactly');

  const aggregate = aggregateRealityComparison([noDataComparison, withData]);
  assert(aggregate.opportunitiesWithRealData === 1, 'aggregate only counts opportunities with real data');
  assert(aggregate.totalEntries === 2, 'aggregate sums entries across opportunities');
}

console.log('--- Repository round-trip: append-only ledger, learning events, project outcomes ---');
{
  (async () => {
    const repo = new InMemoryRepository();
    const opp = baseOpp();
    const entry = baseEntry(opp);
    await repo.addRealRevenueEntry(entry);
    const listed = await repo.listRealRevenue();
    assert(listed.length === 1 && listed[0].id === entry.id, 'real revenue entry round-trips through the repository');

    // Append-only: adding a second entry never overwrites the first.
    await repo.addRealRevenueEntry(baseEntry(opp, { id: 'rr-test-2' }));
    assert((await repo.listRealRevenue()).length === 2, 'a second entry is appended, not upserted over the first');

    const event = generateLearningEvent(entry, opp, undefined);
    await repo.appendLearningEvent(event);
    const listedEvents = await repo.listLearningEvents();
    assert(listedEvents.length === 1 && listedEvents[0].id === event.id, 'learning event round-trips through the repository');

    const project = {
      id: 'proj-outcome-test',
      prospectId: 'prospect-1',
      prospectName: 'Test Bakery',
      offerId: 'offer-1',
      opportunityId: opp.id,
      agreedPrice: 100,
      agreedTimelineDaysMax: 7,
      milestones: [],
      status: 'DELIVERED' as const,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await repo.upsertProject(project);
    await repo.updateProjectOutcome(project.id, { satisfaction: 5, repeatPurchase: true, referral: false });
    const updatedProject = (await repo.listProjects())[0];
    assert(updatedProject.satisfaction === 5, 'satisfaction persists through the repository');
    assert(updatedProject.repeatPurchase === true, 'repeatPurchase persists through the repository');
    assert(updatedProject.referral === false, 'referral persists through the repository');

    console.log(failures === 0 ? `\nAll checks passed.` : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })();
}
