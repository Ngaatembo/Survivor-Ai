/* ============================================================================
 * Demo generator smoke test (Phase 3, deepened): a real, working demo page
 * built for one specific business — verifies personalization when
 * confident intelligence exists, honest generic fallback otherwise, no
 * fabricated photos/testimonials, always-visible demo disclaimer, working
 * contact link, and repository round-trips.
 * Run with:
 *   npx tsx scripts/demoGenerator.smoke.ts
 * ========================================================================== */

import { generateProspectDemo, generateDemoHtml } from '../src/lib/demoGenerator';
import { generateOffer } from '../src/lib/offerGenerator';
import { generateBusinessModel } from '../src/lib/businessModel';
import { scoreOpportunity } from '../src/lib/scoring';
import { scoreProspect, priorityFromScore } from '../src/lib/prospectScoring';
import { SAMPLE_OPPORTUNITIES } from '../src/data/sampleData';
import { InMemoryRepository } from '../src/engine/inMemoryRepository';
import type { LeadScoreBreakdown, Offer, Opportunity, Prospect, ProspectIntelligence } from '../src/types';

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
    id: 'prospect-demo-1',
    opportunityId: opp.id,
    opportunityName: opp.name,
    businessName: 'Test Salon',
    category: 'Local personal services',
    location: 'Marondera',
    websitePresence: 'NONE_FOUND',
    socialLinks: [],
    contactChannel: 'WHATSAPP',
    contactValue: '+263771112222',
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
    ...overrides,
  };
}

function baseIntel(overrides: Partial<ProspectIntelligence> = {}): ProspectIntelligence {
  return {
    id: 'intel-demo-1',
    prospectId: 'prospect-demo-1',
    businessOverview: 'Test Salon offers haircuts, styling, and manicures with a loyal local following.',
    apparentServices: ['Haircuts', 'Styling', 'Manicures'],
    socialPresenceSummary: 'Active Instagram with regular posts.',
    competitiveNote: 'No direct competitor evidence found.',
    specificProblemEvidence: 'No booking link found anywhere in their online presence.',
    recommendedAngle: 'Lead with an online booking page to reduce no-shows.',
    confidence: 'HIGH',
    generator: 'llm',
    sources: [{ id: 'src-1', title: 'Test Salon Instagram', url: 'https://instagram.com/testsalon', kind: 'web' }],
    generatedAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

console.log('--- generateDemoHtml: no intelligence -> honest generic content, never fabricated ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const prospect = baseProspect(opp);
  const offer: Offer = generateOffer(prospect, model);
  const result = generateDemoHtml(prospect, offer);
  assert(result.generator === 'template', 'no intelligence -> template generator, not claimed as personalized');
  assert(result.html.includes(prospect.businessName), 'the real business name appears in the page');
  assert(result.html.includes('DEMO'), 'the demo disclaimer badge is present');
  assert(result.html.includes('Not yet live, not the business') || result.html.includes('official site'), 'the disclaimer text is present');
  assert(!result.html.toLowerCase().includes('testimonial'), 'no fabricated testimonials section');
  assert(result.html.includes('Your photo here'), 'photo slots are honest placeholders, never a stock image');
}

console.log('--- generateDemoHtml: confident LLM intelligence -> genuinely personalized ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const prospect = baseProspect(opp);
  const offer: Offer = generateOffer(prospect, model);
  const intel = baseIntel();
  const result = generateDemoHtml(prospect, offer, intel);
  assert(result.generator === 'llm', 'confident LLM intelligence -> generator is llm');
  assert(result.heroHeadline.includes('Haircuts'), 'headline uses the real apparent service, not a generic phrase');
  assert(result.html.includes('Haircuts') && result.html.includes('Styling'), 'real services appear as actual page content');
  assert(result.html.includes('loyal local following'), 'the real business overview is used as About copy');
  assert(result.html.includes('personalized from public research'), 'footer honestly discloses this was personalized from research');
}

console.log('--- generateDemoHtml: LOW confidence intelligence -> falls back to honest generic content ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const prospect = baseProspect(opp);
  const offer: Offer = generateOffer(prospect, model);
  const lowConfIntel = baseIntel({ confidence: 'LOW' });
  const result = generateDemoHtml(prospect, offer, lowConfIntel);
  assert(result.generator === 'template', 'LOW confidence intelligence is never trusted for customer-facing demo copy');
  assert(!result.html.includes('loyal local following'), 'low-confidence overview text is never used verbatim');
}

console.log('--- generateDemoHtml: snippet-digest intelligence -> never used for customer-facing copy ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const prospect = baseProspect(opp);
  const offer: Offer = generateOffer(prospect, model);
  const digestIntel = baseIntel({ generator: 'snippet-digest', confidence: 'LOW' });
  const result = generateDemoHtml(prospect, offer, digestIntel);
  assert(result.generator === 'template', 'an unsynthesized digest is never used to personalize a customer-facing demo');
}

console.log('--- generateDemoHtml: working contact link built from the prospect\'s real contact info ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const prospect = baseProspect(opp, { contactChannel: 'WHATSAPP', contactValue: '+263771112222' });
  const offer: Offer = generateOffer(prospect, model);
  const result = generateDemoHtml(prospect, offer);
  assert(result.html.includes('wa.me/263771112222'), 'WhatsApp contact link uses the prospect\'s real number, digits only');

  const emailProspect = baseProspect(opp, { id: 'p2', contactChannel: 'EMAIL', contactValue: 'owner@testsalon.co.zw' });
  const emailOffer: Offer = generateOffer(emailProspect, model);
  const emailResult = generateDemoHtml(emailProspect, emailOffer);
  assert(emailResult.html.includes('mailto:owner@testsalon.co.zw'), 'email contact link uses the real email address');
}

console.log('--- generateProspectDemo / repository round-trip ---');
{
  (async () => {
    const opp = baseOpp();
    const model = generateBusinessModel(opp, []);
    const prospect = baseProspect(opp);
    const offer: Offer = generateOffer(prospect, model);
    const intel = baseIntel();
    const demo = generateProspectDemo(prospect, offer, intel);

    assert(demo.prospectId === prospect.id, 'demo links back to the correct prospect');
    assert(demo.offerId === offer.id, 'demo links back to the correct offer');
    assert(demo.sectionsIncluded.length > 0, 'demo records which sections were included');

    const repo = new InMemoryRepository();
    await repo.upsertProspectDemo(demo);
    const listed = await repo.listProspectDemos();
    assert(listed.length === 1 && listed[0].id === demo.id, 'demo round-trips through the repository');

    const rebuilt = generateProspectDemo(prospect, offer, intel);
    await repo.upsertProspectDemo(rebuilt);
    const afterRebuild = await repo.listProspectDemos();
    assert(afterRebuild.length === 1, 'rebuilding a demo for the same prospect replaces, not duplicates');

    console.log(failures === 0 ? `\nAll checks passed.` : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })();
}
