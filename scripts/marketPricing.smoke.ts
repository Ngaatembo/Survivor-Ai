/* ============================================================================
 * Market pricing research smoke test: verifies real market research
 * (when confidently evidence-backed) overrides the old pure-formula price
 * guess in offers, degrades honestly with no evidence, and never trusts
 * an LLM-fabricated number with no real snippet backing.
 * Run with:
 *   npx tsx scripts/marketPricing.smoke.ts
 * ========================================================================== */

import { researchMarketPrice } from '../src/services/marketPricing';
import { generateOffer } from '../src/lib/offerGenerator';
import { generateBusinessModel } from '../src/lib/businessModel';
import { scoreOpportunity } from '../src/lib/scoring';
import { scoreProspect, priorityFromScore } from '../src/lib/prospectScoring';
import { SAMPLE_OPPORTUNITIES } from '../src/data/sampleData';
import { InMemoryRepository } from '../src/engine/inMemoryRepository';
import type { LLMProvider, MarketPriceAnalysis, SearchProvider, SearchResult } from '../src/services/providers/types';
import type { LeadScoreBreakdown, Opportunity, Prospect } from '../src/types';
import { emptyState } from '../src/services/searchBudget';
import type { SearchEconomyContext } from '../src/services/searchEconomy';

/** Fresh search-economy context per call, so each test case's mock search
 *  results are used independently rather than served from a shared cache. */
function mkCtx(search: SearchProvider): SearchEconomyContext {
  return {
    state: emptyState(),
    providers: { tavily: search, brave: null },
    survivalStatus: 'ALIVE',
    now: Date.now(),
    cycleStartedAt: Date.now(),
  };
}

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

function baseProspect(opp: Opportunity): Prospect {
  const s: LeadScoreBreakdown = scoreProspect(
    { websitePresence: 'NONE_FOUND', contactChannel: 'WHATSAPP', sourcesCount: 2, hasCommercialSignals: true, hasUrgencySignal: false },
    undefined,
  );
  return {
    id: 'prospect-price-1',
    opportunityId: opp.id,
    opportunityName: opp.name,
    businessName: 'Test Business',
    category: 'Local service business',
    location: 'Harare',
    websitePresence: 'NONE_FOUND',
    socialLinks: [],
    contactChannel: 'WHATSAPP',
    contactValue: '+263771112222',
    sources: [],
    evidenceNotes: 'test',
    priority: priorityFromScore(s, 'NONE_FOUND'),
    score: s,
    status: 'INTERESTED',
    dataSource: 'LIVE',
    dateDiscovered: Date.now(),
    messagesSentCount: 0,
    responsesReceivedCount: 0,
    actualRevenue: 0,
    notes: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

class MockSearchProvider implements SearchProvider {
  readonly id = 'mock';
  readonly connected = true;
  readonly label = 'Mock Search';
  constructor(private results: SearchResult[] = []) {}
  async search(): Promise<SearchResult[]> {
    return this.results;
  }
}

class MockLLMProvider implements LLMProvider {
  readonly id = 'mock';
  readonly connected = true;
  readonly label = 'Mock LLM';
  constructor(private analysis: Partial<MarketPriceAnalysis> | null) {}
  async complete(): Promise<string | null> {
    return null;
  }
  async analyzeMarketPrice(): Promise<Partial<MarketPriceAnalysis> | null> {
    return this.analysis;
  }
}

console.log('--- researchMarketPrice: no search results -> honest LOW-confidence empty state, never a fabricated price ---');
{
  (async () => {
    const opp = baseOpp();
    const emptySearch = new MockSearchProvider([]);
    const research = await researchMarketPrice(mkCtx(emptySearch), null, opp);
    assert(research.confidence === 'LOW', 'no results -> LOW confidence');
    assert(research.generator === 'snippet-digest', 'no LLM connected -> snippet-digest generator');
    assert(research.priceMax === 0, 'no evidence -> $0 range, never a fabricated number');
    assert(research.opportunityId === opp.id, 'research links back to the correct opportunity');

    console.log('--- researchMarketPrice: real snippets, no LLM -> honest digest, no fabricated price ---');
    const snippetSearch = new MockSearchProvider([
      { title: 'Freelance website designer Harare', url: 'https://example.com/1', snippet: 'Rates from $150 for a basic small business website, $300+ for e-commerce.', source: 'stub' },
    ]);
    const digestResearch = await researchMarketPrice(mkCtx(snippetSearch), null, opp);
    assert(digestResearch.generator === 'snippet-digest', 'no LLM -> digest, never claims synthesis');
    assert(digestResearch.priceMax === 0, 'digest never invents a price range even when snippets mention real numbers');
    assert(digestResearch.sources.length > 0, 'sources are still captured for manual review');

    console.log('--- researchMarketPrice: LLM connected, returns a confident, evidence-backed range ---');
    const goodLlm = new MockLLMProvider({
      priceMin: 120,
      priceMax: 250,
      currency: 'USD',
      rationale: 'Multiple freelancers in Harare quote $120-$250 for a basic small business website.',
      confidence: 'HIGH',
    });
    const llmResearch = await researchMarketPrice(mkCtx(snippetSearch), goodLlm, opp);
    assert(llmResearch.generator === 'llm', 'LLM connected and returned valid JSON -> generator is llm');
    assert(llmResearch.confidence === 'HIGH', 'confidence passed through from the model');
    assert(llmResearch.priceMin === 120 && llmResearch.priceMax === 250, 'real researched price range is used exactly');

    console.log('--- researchMarketPrice: LLM fails/returns unusable JSON -> falls back to honest digest ---');
    const failingLlm = new MockLLMProvider(null);
    const fallbackResearch = await researchMarketPrice(mkCtx(snippetSearch), failingLlm, opp);
    assert(fallbackResearch.generator === 'snippet-digest', 'unusable LLM response falls back to the honest digest');

    console.log('--- generateOffer: a confident researched price OVERRIDES the old formula guess ---');
    const model = generateBusinessModel(opp, []);
    const prospect = baseProspect(opp);
    const formulaOffer = generateOffer(prospect, model);
    const researchedOffer = generateOffer(prospect, model, undefined, llmResearch);
    assert(researchedOffer.price === Math.round((120 + 250) / 2), `researched offer prices at the midpoint of the real range (got ${researchedOffer.price})`);
    assert(researchedOffer.price !== formulaOffer.price, `real market research changes the price from the old formula guess ($${formulaOffer.price} -> $${researchedOffer.price})`);
    assert(!!researchedOffer.priceRationale?.includes('real market research'), 'the offer explains that its price is grounded in real research');

    console.log('--- generateOffer: a LOW-confidence or digest-only research NEVER overrides the formula price ---');
    const lowConfResearch = { ...llmResearch, confidence: 'LOW' as const };
    const stillFormulaOffer = generateOffer(prospect, model, undefined, lowConfResearch);
    assert(stillFormulaOffer.price === formulaOffer.price, 'LOW-confidence research is never trusted to override pricing');

    const digestOnlyOffer = generateOffer(prospect, model, undefined, digestResearch);
    assert(digestOnlyOffer.price === formulaOffer.price, 'an unsynthesized digest (generator: snippet-digest) never overrides pricing, regardless of confidence label');

    console.log('--- generateOffer: omitting marketPrice entirely stays backward compatible ---');
    const noPriceArgOffer = generateOffer(prospect, model, undefined);
    assert(noPriceArgOffer.price === formulaOffer.price, 'omitting the marketPrice argument entirely matches the formula-only behavior');

    console.log('--- Repository round-trip ---');
    const repo = new InMemoryRepository();
    await repo.upsertMarketPriceResearch(llmResearch);
    const listed = await repo.listMarketPriceResearch();
    assert(listed.length === 1 && listed[0].id === llmResearch.id, 'market price research round-trips through the repository');

    const updated = { ...llmResearch, priceMax: 300, updatedAt: Date.now() };
    await repo.upsertMarketPriceResearch(updated);
    const afterUpdate = await repo.listMarketPriceResearch();
    assert(afterUpdate.length === 1, 'upserting again for the same opportunity replaces, not duplicates');
    assert(afterUpdate[0].priceMax === 300, 'the replacement is the latest data');

    console.log(failures === 0 ? `\nAll checks passed.` : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })();
}
