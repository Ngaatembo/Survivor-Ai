/* ============================================================================
 * Prospect Intelligence smoke test (Phase 6): deep, business-specific
 * research using mock search/LLM providers (no real network calls) —
 * verifies the LLM-synthesis path, the snippet-digest fallback path, the
 * "never fabricate" discipline, repository round-trips, and that offers/
 * outreach actually use the research when it's confident enough to trust.
 * Run with:
 *   npx tsx scripts/prospectIntelligence.smoke.ts
 * ========================================================================== */

import { researchProspect } from '../src/services/prospectIntelligence';
import { generateOffer } from '../src/lib/offerGenerator';
import { generateOutreachMessages } from '../src/lib/outreachGenerator';
import { generateBusinessModel } from '../src/lib/businessModel';
import { scoreOpportunity } from '../src/lib/scoring';
import { scoreProspect, priorityFromScore } from '../src/lib/prospectScoring';
import { SAMPLE_OPPORTUNITIES } from '../src/data/sampleData';
import { InMemoryRepository } from '../src/engine/inMemoryRepository';
import type { LLMProvider, ProspectIntelligenceAnalysis, SearchProvider, SearchResult } from '../src/services/providers/types';
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
    id: 'prospect-intel-1',
    opportunityId: opp.id,
    opportunityName: opp.name,
    businessName: 'Test Bakery',
    category: 'Local food business',
    location: 'Marondera',
    websitePresence: 'NONE_FOUND',
    socialLinks: [],
    contactChannel: 'WHATSAPP',
    contactValue: '+263 77 111 2222',
    sources: [],
    evidenceNotes: 'No independent website found.',
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

/** A mock search provider returning fixed, realistic snippets — no network. */
class MockSearchProvider implements SearchProvider {
  readonly id = 'mock';
  readonly connected = true;
  readonly label = 'Mock Search';
  constructor(private results: SearchResult[] = []) {}
  async search(): Promise<SearchResult[]> {
    return this.results;
  }
}

/** A mock LLM that returns a fixed, schema-valid analysis — no network. */
class MockLLMProvider implements LLMProvider {
  readonly id = 'mock';
  readonly connected = true;
  readonly label = 'Mock LLM';
  constructor(private analysis: Partial<ProspectIntelligenceAnalysis> | null) {}
  async complete(): Promise<string | null> {
    return null;
  }
  async analyzeProspect(): Promise<Partial<ProspectIntelligenceAnalysis> | null> {
    return this.analysis;
  }
}

console.log('--- researchProspect: no search results at all -> honest low-confidence empty state ---');
{
  (async () => {
    const opp = baseOpp();
    const prospect = baseProspect(opp);
    const emptySearch = new MockSearchProvider([]);
    const intel = await researchProspect(mkCtx(emptySearch), null, prospect);
    assert(intel.confidence === 'LOW', 'no results -> LOW confidence, never fabricated');
    assert(intel.generator === 'snippet-digest', 'no LLM connected -> snippet-digest generator');
    assert(intel.sources.length === 0, 'no sources when nothing was found');
    assert(intel.businessOverview.includes(prospect.businessName), 'overview names the real business, not a placeholder');

    console.log('--- researchProspect: real snippets, no LLM connected -> honest digest, not synthesized ---');
    const snippetSearch = new MockSearchProvider([
      { title: 'Test Bakery Facebook', url: 'https://facebook.com/testbakery', snippet: 'Fresh bread daily, custom cakes for events.', source: 'facebook.com' },
      { title: 'Test Bakery reviews', url: 'https://example.com/reviews', snippet: 'Great cakes but slow delivery times.', source: 'example.com' },
    ]);
    const digestIntel = await researchProspect(mkCtx(snippetSearch), null, prospect);
    assert(digestIntel.generator === 'snippet-digest', 'no LLM -> digest, never claims synthesis');
    assert(digestIntel.sources.length > 0, 'sources are captured even without an LLM');
    assert(digestIntel.sources.every((s) => s.url), 'every source carries a real URL');
    assert(digestIntel.confidence === 'LOW', 'unsynthesized digest is always LOW confidence');

    console.log('--- researchProspect: LLM connected, returns a valid, grounded analysis ---');
    const goodLlm = new MockLLMProvider({
      businessOverview: 'Test Bakery is a local bakery offering fresh bread and custom cakes, with an active Facebook presence.',
      apparentServices: ['Fresh bread', 'Custom cakes'],
      socialPresenceSummary: 'Active Facebook page with regular posts.',
      competitiveNote: 'No direct evidence of nearby competitors in the snippets.',
      specificProblemEvidence: 'A review mentions slow delivery times, which a booking/ordering system could help address.',
      recommendedAngle: 'Lead with an online ordering page to address the slow-delivery complaint directly.',
      problemCandidates: [
        { type: 'TRUST', evidence: 'The business profile has limited independent information.', businessFriction: 'A new customer may have less third-party reassurance.', likelyConsequence: 'Trust may take longer to establish.', solvableOpportunity: 'Add a clear proof and trust section.', outreachClaim: 'I noticed there is limited independent information about the business online.', confidence: 'MEDIUM', sourceIds: ['1'] },
        { type: 'ORDERING', evidence: 'A review mentions slow delivery times.',
        businessFriction: 'Customers may not have a clear ordering path.',
        likelyConsequence: 'Ordering may be less convenient.',
        solvableOpportunity: 'Provide a direct online ordering path.',
        outreachClaim: 'I noticed a review mentioning slow delivery times.',
        confidence: 'HIGH', sourceIds: ['2'],
        },
      ],
      primaryProblem: null,
      confidence: 'HIGH',
    });
    const llmIntel = await researchProspect(mkCtx(snippetSearch), goodLlm, prospect);
    assert(llmIntel.generator === 'llm', 'LLM connected and returned valid JSON -> generator is llm');
    assert(llmIntel.confidence === 'HIGH', 'confidence passed through from the model');
    assert(llmIntel.apparentServices.includes('Fresh bread'), 'apparent services come from the real analysis');
    assert(llmIntel.recommendedAngle.includes('delivery'), 'recommended angle is grounded in the actual snippet evidence (slow delivery)');
    assert(llmIntel.primaryProblem?.type === 'ORDERING', 'selector chooses the stronger evidence-backed ordering problem');
    assert((llmIntel.problemSelection?.candidates.length ?? 0) === 2, 'selector retains the candidate set for auditability');
    assert(llmIntel.problemSelection?.selectedIndex === 0, 'selected problem is explicitly recorded');
    assert(llmIntel.primaryProblem?.sourceIds.length === 1, 'primary problem retains the linked source ID');

    console.log('--- researchProspect: LLM connected but fails/returns unusable JSON -> falls back to digest ---');
    const failingLlm = new MockLLMProvider(null);
    const fallbackIntel = await researchProspect(mkCtx(snippetSearch), failingLlm, prospect);
    assert(fallbackIntel.generator === 'snippet-digest', 'a null/unusable LLM response falls back to the honest digest, never a fabricated report');

    console.log('--- weak/LOW problem candidates are never promoted to a primary problem ---');
    const weakLlm = new MockLLMProvider({
      businessOverview: 'Test Bakery is a local bakery with a public Facebook presence.',
      apparentServices: ['Fresh bread'],
      socialPresenceSummary: 'Public Facebook presence found.',
      competitiveNote: 'Not enough evidence for a comparison.',
      specificProblemEvidence: 'No sufficiently strong business-specific problem was established.',
      recommendedAngle: 'Review the available evidence manually.',
      problemCandidates: [
        {
          type: 'ORDERING',
          evidence: 'A single ambiguous snippet may relate to ordering.',
          businessFriction: 'The available evidence is too weak to establish a real ordering friction.',
          likelyConsequence: 'There may be some inconvenience, but this is not established.',
          solvableOpportunity: 'Could review the ordering path if stronger evidence appears.',
          outreachClaim: 'I noticed something that may affect ordering.',
          confidence: 'LOW',
          sourceIds: ['1'],
        },
      ],
      primaryProblem: {
        type: 'ORDERING',
        evidence: 'A single ambiguous snippet may relate to ordering.',
        businessFriction: 'The available evidence is too weak to establish a real ordering friction.',
        likelyConsequence: 'There may be some inconvenience, but this is not established.',
        solvableOpportunity: 'Could review the ordering path if stronger evidence appears.',
        outreachClaim: 'I noticed something that may affect ordering.',
        confidence: 'LOW',
        sourceIds: ['1'],
      },
      confidence: 'LOW',
    });
    const weakIntel = await researchProspect(mkCtx(snippetSearch), weakLlm, prospect);
    assert(!weakIntel.primaryProblem, 'LOW-confidence candidate cannot become a primary problem');
    assert(!weakIntel.problemSelection, 'no candidate is selected when all evidence is insufficient');

    console.log('--- generateOffer / generateOutreachMessages: only trust HIGH/MEDIUM LLM-synthesized intelligence ---');
    const model = generateBusinessModel(opp, []);
    const offerWithGoodIntel = generateOffer(prospect, model, llmIntel);
    assert(
      // The offer quotes the selected, source-linked primary problem — not
      // the free-text recommendedAngle — so only evidence-backed claims
      // reach customer-facing text.
      offerWithGoodIntel.gapAnalysis?.includes('direct online ordering path') ?? false,
      'a confident, LLM-synthesized primary problem is folded into the offer\'s gap analysis',
    );
    const offerWithDigest = generateOffer(prospect, model, digestIntel);
    assert(
      !offerWithDigest.gapAnalysis?.includes('Not synthesized'),
      'an unsynthesized digest is never quoted directly into a customer-facing offer',
    );

    const outreachWithGoodIntel = generateOutreachMessages(prospect, model, llmIntel);
    assert(
      outreachWithGoodIntel.whatsapp.includes('delivery'),
      'confident intelligence personalizes the actual outreach message text',
    );
    const outreachWithoutIntel = generateOutreachMessages(prospect, model);
    assert(
      !outreachWithoutIntel.whatsapp.includes('delivery'),
      'omitting intelligence entirely falls back to the generic opener (backward compatible)',
    );

    console.log('--- Repository round-trip ---');
    const repo = new InMemoryRepository();
    await repo.upsertProspectIntelligence(llmIntel);
    const listed = await repo.listProspectIntelligence();
    assert(listed.length === 1 && listed[0].id === llmIntel.id, 'intelligence report round-trips through the repository');

    const updatedIntel = { ...llmIntel, confidence: 'MEDIUM' as const, updatedAt: Date.now() };
    await repo.upsertProspectIntelligence(updatedIntel);
    const afterUpdate = await repo.listProspectIntelligence();
    assert(afterUpdate.length === 1, 'upserting again for the same prospect replaces, not duplicates');
    assert(afterUpdate[0].confidence === 'MEDIUM', 'the replacement is the latest data');

    console.log(failures === 0 ? `\nAll checks passed.` : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })();
}
