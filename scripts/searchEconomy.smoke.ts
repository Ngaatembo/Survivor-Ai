/* ============================================================================
 * Search Economy smoke test (Economic Survival Overhaul, Phase 17).
 * Pure-function + mock-provider tests — no network calls. Covers the 20
 * test areas the spec calls out, to the extent they apply to this system:
 *   1. search budget enforcement            11. dead agent -> no search
 *   2. daily limit                          12. qualified prospect prioritized
 *   3. monthly limit                            over unnecessary discovery
 *   4. per-prospect/opportunity limit        13. payment increases revenue metrics
 *   5. cache hit                            14. category performance updates
 *   6. cache expiration                         after payment
 *   7. provider fallback                    15. search ROI calculation
 *   8. Tavily not auto-preferred            16. human action queue / funnel shape
 *   9. critical survival state reduces      17. no duplicate research within TTL
 *      search activity                      18/19. Facebook groups / fake content
 *  10. (covered by 1-4 above)                    excluded — see prospectPipeline.smoke.ts
 *                                           20. market pricing not re-researched
 * Run with: npx tsx scripts/searchEconomy.smoke.ts
 * ========================================================================== */

import {
  emptyState,
  shouldSearch,
  recordSearch,
  checkBudget,
  selectProvider,
  survivalAdjustedPolicy,
  summarizeSearchEconomy,
  getCached,
  normalizeQuery,
  SEARCH_POLICY,
  DAY_MS,
} from '../src/services/searchBudget';
import { runSearch, computeSearchROI, type SearchEconomyContext } from '../src/services/searchEconomy';
import { computeRevenueFunnel, conversionByAcquisitionChannel, conversionByCategory } from '../src/lib/revenueFunnel';
import { computeCategoryRealWorldStats, statsForCategory } from '../src/lib/realRevenue';
import { scoreProspect, priorityFromScore } from '../src/lib/prospectScoring';
import type { SearchProvider, SearchResult } from '../src/services/providers/types';
import type { LeadScoreBreakdown, Opportunity, Prospect, ProspectStatus, RealRevenueEntry } from '../src/types';

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

class MockSearch implements SearchProvider {
  readonly id: string;
  readonly connected = true;
  readonly label: string;
  calls = 0;
  constructor(id: string, private results: SearchResult[] = [{ title: 'A', url: 'https://a.example', snippet: 'snippet', source: 'x' }]) {
    this.id = id;
    this.label = id;
  }
  async search(): Promise<SearchResult[]> {
    this.calls += 1;
    return this.results;
  }
}

function mkCtx(overrides: Partial<SearchEconomyContext> = {}): SearchEconomyContext {
  return {
    state: emptyState(),
    providers: { tavily: new MockSearch('tavily'), brave: new MockSearch('brave') },
    survivalStatus: 'ALIVE',
    now: Date.now(),
    cycleStartedAt: Date.now(),
    ...overrides,
  };
}

function baseOpp(): Opportunity {
  return {
    id: 'opp-test-1', name: 'Test websites for local shops', category: 'Local / Real-World', tags: [],
    dataSource: 'LIVE', researchStage: 'RANKED', description: 'test', howMoneyMade: 'test',
    capitalRequiredMin: 0, capitalRequiredMax: 50, timeToRevenueDaysMin: 7, timeToRevenueDaysMax: 30,
    skills: [], difficulty: 2, competition: 2, scalability: 3, risk: 1, riskLevel: 'Low',
    geographicRelevance: ['Zimbabwe'], evidenceTier: 'LIKELY', evidenceNotes: 'test',
    successProbability: 0.3, revenuePotentialMonthlyMin: 50, revenuePotentialMonthlyMax: 500,
    upsideNote: '', downsideNote: '', operatingCostsNote: '', examples: [], sources: [],
    lifecycleState: 'VALIDATING', executionBlocked: false,
  };
}

function baseProspect(opp: Opportunity, status: ProspectStatus, id = 'prospect-test-1'): Prospect {
  const score: LeadScoreBreakdown = scoreProspect(
    { websitePresence: 'NONE_FOUND', contactChannel: 'PHONE', sourcesCount: 2, hasCommercialSignals: true, hasUrgencySignal: false },
    undefined,
  );
  return {
    id, opportunityId: opp.id, opportunityName: opp.name, businessName: `Business ${id}`,
    category: 'Local trades', location: 'Harare', websitePresence: 'NONE_FOUND', socialLinks: [],
    contactChannel: 'PHONE', contactValue: '+263770000000', sources: [], evidenceNotes: 'test',
    priority: priorityFromScore(score, 'NONE_FOUND'), score, status, dataSource: 'LIVE',
    dateDiscovered: Date.now(), messagesSentCount: 0, responsesReceivedCount: 0, actualRevenue: 0,
    notes: [], createdAt: Date.now(), updatedAt: Date.now(),
  };
}

async function main() {
  /* ---------------------------- 1. budget enforcement -------------------------- */
  console.log('--- 1. Search budget enforcement (per-cycle) ---');
  {
    const ctx = mkCtx();
    const policy = SEARCH_POLICY.MARKET_PRICING;
    let exceeded = 0;
    for (let i = 0; i < policy.maxPerCycle + 3; i++) {
      const r = await runSearch(ctx, { purpose: 'MARKET_PRICING', query: `unique query ${i}`, entityId: `e${i}` });
      if (r.budgetExceeded) exceeded++;
    }
    assert(exceeded === 3, `exactly the 3 over-budget calls are refused (got ${exceeded})`);
  }

  /* -------------------------------- 2. daily limit ------------------------------ */
  console.log('--- 2. Daily limit ---');
  {
    let state = emptyState();
    const now = Date.now();
    // These searches happened a moment ago, in an EARLIER cycle (cycleStartedAt
    // below is now, strictly after every recorded ts) — isolates the DAY
    // limit from the per-cycle limit, which would otherwise trip first.
    const earlier = now - 60_000;
    const policy = SEARCH_POLICY.OTHER;
    for (let i = 0; i < policy.maxPerDay; i++) {
      state = recordSearch(state, { ts: earlier, purpose: 'OTHER', provider: 'brave', query: `q${i}`, entityId: `e${i}` });
    }
    const check = checkBudget(state, 'OTHER', 'ALIVE', now, now);
    assert(!check.ok && check.exceededScope === 'day', `day limit (${policy.maxPerDay}) trips exceededScope=day (got ${check.exceededScope})`);
  }

  /* ------------------------------- 3. monthly limit ----------------------------- */
  console.log('--- 3. Monthly limit ---');
  {
    let state = emptyState();
    const now = Date.now();
    const policy = SEARCH_POLICY.OTHER;
    // Spread across many distinct days (bypassing the daily cap) to isolate
    // the monthly cap specifically; all strictly before `now`/cycleStartedAt
    // so none of them count toward the per-cycle limit either.
    for (let i = 0; i < policy.maxPerMonth; i++) {
      const ts = now - 60_000 - (i % 25) * DAY_MS - Math.floor(i / 25) * 1000;
      state = recordSearch(state, { ts, purpose: 'OTHER', provider: 'brave', query: `q${i}`, entityId: `e${i}` });
    }
    const check = checkBudget(state, 'OTHER', 'ALIVE', now, now);
    assert(!check.ok && check.exceededScope === 'month', `month limit (${policy.maxPerMonth}) trips exceededScope=month (got ${check.exceededScope})`);
  }

  /* --------------------------- 4. per-entity (prospect) limit ------------------- */
  console.log('--- 4. Per-prospect/opportunity limit ---');
  {
    let state = emptyState();
    const now = Date.now();
    const earlier = now - 60_000; // an earlier cycle, still within this purpose's TTL
    const policy = SEARCH_POLICY.PROSPECT_INTELLIGENCE;
    for (let i = 0; i < policy.maxPerEntity; i++) {
      state = recordSearch(state, { ts: earlier, purpose: 'PROSPECT_INTELLIGENCE', provider: 'tavily', query: `q${i}`, entityId: 'prospect-1' });
    }
    const check = checkBudget(state, 'PROSPECT_INTELLIGENCE', 'ALIVE', now, now, 'prospect-1');
    assert(!check.ok && check.exceededScope === 'entity', `per-entity limit (${policy.maxPerEntity}) trips exceededScope=entity (got ${check.exceededScope})`);
    const otherEntity = checkBudget(state, 'PROSPECT_INTELLIGENCE', 'ALIVE', now, now, 'prospect-2');
    assert(otherEntity.ok, 'a DIFFERENT entity is unaffected by prospect-1s per-entity limit');
  }

  /* ---------------------------------- 5/6. cache -------------------------------- */
  console.log('--- 5/6. Cache hit and expiration ---');
  {
    const now = Date.now();
    let state = emptyState();
    state = recordSearch(
      state,
      { ts: now, purpose: 'MARKET_PRICING', provider: 'brave', query: 'website price Harare', entityId: 'opp-1' },
      [{ title: 'x', url: 'https://x', snippet: 's', source: 'x' }],
    );
    const fresh = getCached(state, 'MARKET_PRICING', 'website price Harare', 'opp-1', now + 1000);
    assert(fresh !== null, 'a just-written entry is a cache hit');
    const expired = getCached(state, 'MARKET_PRICING', 'website price Harare', 'opp-1', now + SEARCH_POLICY.MARKET_PRICING.ttlMs + 1);
    assert(expired === null, 'an entry past its purpose TTL is no longer served from cache');
    assert(normalizeQuery('  Website   Price, Harare!! ') === normalizeQuery('website price harare'), 'normalizeQuery collapses whitespace/punctuation/case');
  }

  /* ------------------------------ 7/8. provider choice -------------------------- */
  console.log('--- 7/8. Provider fallback and Tavily-not-auto-preferred ---');
  {
    const onlyTavily = selectProvider('MARKET_PRICING', { tavily: true, brave: false }, 'ALIVE');
    assert(onlyTavily === 'tavily', 'falls back to Tavily when Brave (the policy primary for pricing) is unavailable');

    const both = selectProvider('MARKET_PRICING', { tavily: true, brave: true }, 'ALIVE');
    assert(both === 'brave', 'with BOTH keys configured, the purpose-driven policy (brave primary) wins — Tavily is NOT auto-preferred just because its key exists');

    const intelBoth = selectProvider('PROSPECT_INTELLIGENCE', { tavily: true, brave: true }, 'ALIVE');
    assert(intelBoth === 'tavily', 'a DIFFERENT purpose can legitimately prefer Tavily by policy — a deliberate per-purpose choice, not a blanket default');

    const none = selectProvider('OTHER', { tavily: false, brave: false }, 'ALIVE');
    assert(none === 'none', 'no provider configured -> "none", never throws');
  }

  /* --------------------------- 9. survival status throttling -------------------- */
  console.log('--- 9. Critical survival state reduces search activity ---');
  {
    const alive = survivalAdjustedPolicy('OPPORTUNITY_DISCOVERY', 'ALIVE');
    const critical = survivalAdjustedPolicy('OPPORTUNITY_DISCOVERY', 'CRITICAL');
    assert(critical.maxPerCycle < alive.maxPerCycle, `CRITICAL cuts OPPORTUNITY_DISCOVERY per-cycle budget (${critical.maxPerCycle} < ${alive.maxPerCycle})`);
    assert(critical.maxPerCycle <= 1, `CRITICAL throttles OPPORTUNITY_DISCOVERY to at most 1/cycle, not eliminated outright (got ${critical.maxPerCycle})`);
    const atRisk = survivalAdjustedPolicy('MARKET_PRICING', 'AT_RISK');
    assert(atRisk.maxPerCycle <= SEARCH_POLICY.MARKET_PRICING.maxPerCycle, 'AT_RISK never INCREASES a budget versus ALIVE');
  }

  /* -------------------------------- 11. DEAD agent ------------------------------ */
  console.log('--- 11. Dead agent performs no search ---');
  {
    const ctx = mkCtx({ survivalStatus: 'DEAD' });
    const outcome = await runSearch(ctx, { purpose: 'MARKET_PRICING', query: 'anything', entityId: 'x' });
    assert(outcome.results.length === 0 && !outcome.budgetExceeded, 'DEAD agent gets an empty, non-budget-exceeded refusal (DEAD_NO_SEARCH), never a live call');
    assert((ctx.providers.tavily as MockSearch).calls === 0 && (ctx.providers.brave as MockSearch).calls === 0, 'no provider was actually called');

    const deadPolicy = survivalAdjustedPolicy('MARKET_PRICING', 'DEAD');
    assert(deadPolicy.maxPerCycle === 0 && deadPolicy.maxPerDay === 0 && deadPolicy.maxPerMonth === 0, 'DEAD zeroes every budget dimension');
  }

  /* --------------------- 12. qualified prospect prioritized --------------------- */
  console.log('--- 12. Existing qualified prospect prioritized over unnecessary re-discovery ---');
  {
    const now = Date.now();
    let state = emptyState();
    state = recordSearch(
      state,
      { ts: now - 10 * 60 * 1000, purpose: 'PROSPECT_INTELLIGENCE', provider: 'tavily', query: 'x', entityId: 'p-low' },
      [{ title: 'x', url: 'https://x', snippet: 's', source: 'x' }],
    );
    const deferred = shouldSearch(state, {
      purpose: 'PROSPECT_INTELLIGENCE',
      query: 'a completely different query about p-low',
      entityId: 'p-low',
      now,
      cycleStartedAt: now,
      survivalStatus: 'AT_RISK',
      priority: 'LOW',
    });
    assert(!deferred.allow && deferred.reason === 'LOW_VALUE_DEFERRED', 'a LOW-priority, recently-researched, unchanged prospect is deferred under AT_RISK, freeing budget for the pipeline that matters');

    const highPriorityStillAllowed = shouldSearch(emptyState(), {
      purpose: 'PROSPECT_INTELLIGENCE',
      query: 'urgent prospect',
      entityId: 'p-high',
      now,
      cycleStartedAt: now,
      survivalStatus: 'AT_RISK',
      priority: 'HIGH',
    });
    assert(highPriorityStillAllowed.allow, 'a HIGH-priority prospect is still researched even under AT_RISK');
  }

  /* --------------------- 13/14. payment -> revenue/category metrics ------------- */
  console.log('--- 13/14. Payment increases revenue metrics; category performance updates ---');
  {
    const opp = baseOpp();
    const prospectWon = baseProspect(opp, 'WON', 'p-won');
    const prospectLost = baseProspect(opp, 'LOST', 'p-lost');
    const before = computeCategoryRealWorldStats([opp], [prospectWon, prospectLost], []);
    const statsBefore = statsForCategory(before, opp.category);
    assert(statsBefore !== undefined && statsBefore.totalRevenue === 0, 'before any payment, category totalRevenue is 0');

    const entry: RealRevenueEntry = {
      id: 'rr-1', date: Date.now(), opportunityId: opp.id, opportunityName: opp.name,
      prospectId: prospectWon.id, prospectName: prospectWon.businessName, projectId: 'proj-1',
      productService: 'Website', quotedPrice: 200, amountReceived: 200, costs: 20, profit: 180,
      currency: 'USD', paymentMethod: 'MOBILE_MONEY', acquisitionChannel: 'referral',
      daysFromDiscoveryToPayment: 10, createdAt: Date.now(),
    };
    const after = computeCategoryRealWorldStats([opp], [prospectWon, prospectLost], [entry]);
    const statsAfter = statsForCategory(after, opp.category);
    assert(statsAfter!.totalRevenue === 200, 'recording a payment immediately increases the category totalRevenue');
    assert(statsAfter!.totalProfit === 180, 'recording a payment immediately increases the category totalProfit');
    assert(statsAfter!.realCloseRate === 0.5, `close rate reflects 1 WON / 2 decided (got ${statsAfter!.realCloseRate})`);

    const channels = conversionByAcquisitionChannel([entry]);
    assert(channels.length === 1 && channels[0].channel === 'referral' && channels[0].totalRevenue === 200, 'acquisition-channel performance updates immediately after payment');
  }

  /* -------------------------------- 15. search ROI ------------------------------ */
  console.log('--- 15. Search ROI calculation ---');
  {
    const roiWithRevenue = computeSearchROI({
      totalFreshSearches: 50, prospectsGenerated: 10, qualifiedProspects: 6, repliesRecorded: 3,
      proposalsSent: 2, wins: 1, realRevenueTotal: 200, expectedValueOfOpenPipeline: 50,
    });
    assert(roiWithRevenue.basis === 'REAL_REVENUE', 'ROI uses REAL_REVENUE as the basis once real money exists');
    assert(roiWithRevenue.searchROI === 4, `searchROI = revenue/searches = 200/50 = 4 (got ${roiWithRevenue.searchROI})`);
    assert(roiWithRevenue.prospectsPer100Searches === 20, `20 prospects per 100 searches (got ${roiWithRevenue.prospectsPer100Searches})`);

    const roiNoRevenue = computeSearchROI({
      totalFreshSearches: 50, prospectsGenerated: 10, qualifiedProspects: 6, repliesRecorded: 3,
      proposalsSent: 2, wins: 0, realRevenueTotal: 0, expectedValueOfOpenPipeline: 100,
    });
    assert(roiNoRevenue.basis === 'EXPECTED_VALUE', 'before any real revenue, ROI honestly falls back to EXPECTED_VALUE, clearly labeled');

    const noSearches = computeSearchROI({
      totalFreshSearches: 0, prospectsGenerated: 0, qualifiedProspects: 0, repliesRecorded: 0,
      proposalsSent: 0, wins: 0, realRevenueTotal: 0, expectedValueOfOpenPipeline: 0,
    });
    assert(noSearches.basis === 'NO_DATA' && noSearches.searchROI === 0, 'zero searches -> NO_DATA, never a divide-by-zero or fabricated number');
  }

  /* ------------------------------ 16. human action queue ------------------------ */
  console.log('--- 16. Human action queue / revenue funnel shape ---');
  {
    const opp = baseOpp();
    const prospects = [baseProspect(opp, 'DISCOVERED', 'p1'), baseProspect(opp, 'QUALIFIED', 'p2'), baseProspect(opp, 'WON', 'p3')];
    const funnel = computeRevenueFunnel(prospects, []);
    const discoveredStage = funnel.stages.find((s) => s.stage === 'DISCOVERED')!;
    const qualifiedStage = funnel.stages.find((s) => s.stage === 'QUALIFIED')!;
    const wonStage = funnel.stages.find((s) => s.stage === 'WON')!;
    assert(discoveredStage.count === 3, 'DISCOVERED counts every prospect that reached at least that stage (cumulative)');
    assert(qualifiedStage.count === 2, 'QUALIFIED counts QUALIFIED + WON (both reached at least QUALIFIED)');
    assert(wonStage.count === 1, 'WON counts only the WON prospect');
    const byCategory = conversionByCategory([...prospects, baseProspect(opp, 'LOST', 'p4')], [opp]);
    assert(byCategory.length === 1 && byCategory[0].won === 1 && byCategory[0].lost === 1, 'category conversion breakdown is derived correctly');
  }

  /* --------------------- 17. no duplicate research within TTL ------------------- */
  console.log('--- 17. No duplicate research within TTL ---');
  {
    const ctx = mkCtx();
    const r1 = await runSearch(ctx, { purpose: 'PROSPECT_INTELLIGENCE', query: 'Test Bakery Harare reviews', entityId: 'prospect-x' });
    const r2 = await runSearch(ctx, { purpose: 'PROSPECT_INTELLIGENCE', query: 'Test Bakery Harare reviews', entityId: 'prospect-x' });
    assert(!r1.cacheHit, 'first call is a real (non-cached) search');
    assert(r2.cacheHit, 'the identical query for the same entity within TTL is served from cache, not re-searched');
    const tavilyCalls = (ctx.providers.tavily as MockSearch).calls;
    assert(tavilyCalls === 1, `the underlying provider was called exactly once despite two runSearch() calls (got ${tavilyCalls} calls)`);
  }

  /* ------------------- 20. market pricing not repeatedly researched ------------- */
  console.log('--- 20. Market pricing is not repeatedly researched within its TTL ---');
  {
    const ctx = mkCtx();
    const r1 = await runSearch(ctx, { purpose: 'MARKET_PRICING', query: 'website design price Harare', entityId: 'opp-pricing-1' });
    const r2 = await runSearch(ctx, { purpose: 'MARKET_PRICING', query: 'website design price Harare', entityId: 'opp-pricing-1' });
    assert(!r1.cacheHit && r2.cacheHit, 'repeat pricing query for the same opportunity is cache-served, not re-purchased');
  }

  /* --------------------------------- summary ------------------------------------ */
  console.log('--- Dashboard summary shape ---');
  {
    let state = emptyState();
    const now = Date.now();
    state = recordSearch(state, { ts: now, purpose: 'MARKET_PRICING', provider: 'brave', query: 'q', entityId: 'e' }, [{ title: 't', url: 'u', snippet: 's', source: 'x' }]);
    state = recordSearch(state, { ts: now, purpose: 'MARKET_PRICING', provider: 'brave', query: 'q', cacheHit: true, entityId: 'e' });
    const summary = summarizeSearchEconomy(state, 'ALIVE', now);
    assert(summary.searchesToday === 1, 'summary counts fresh searches, not cache replays');
    assert(summary.cacheHitsToday === 1, 'summary counts cache hits separately');
    assert(summary.cacheHitRateToday === 0.5, `cache hit rate is hits/(hits+misses) = 0.5 (got ${summary.cacheHitRateToday})`);
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
