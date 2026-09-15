/* ============================================================================
 * Prospect pipeline smoke test (lead scoring, outreach generation,
 * recommended-actions integration). Pure-function tests — no network/D1
 * needed. Run with:
 *   npx tsx scripts/prospectPipeline.smoke.ts
 * ========================================================================== */

import { SAMPLE_OPPORTUNITIES } from '../src/data/sampleData';
import { scoreOpportunity } from '../src/lib/scoring';
import { scoreProspect, priorityFromScore } from '../src/lib/prospectScoring';
import { generateOutreachMessages } from '../src/lib/outreachGenerator';
import { generateBusinessModel } from '../src/lib/businessModel';
import { computeRecommendedActions } from '../src/lib/recommendedActions';
import { discoverProspects } from '../src/services/prospectDiscovery';
import { InMemoryRepository } from '../src/engine/inMemoryRepository';
import type { SearchProvider, SearchResult } from '../src/services/providers/types';
import type { LeadScoreBreakdown, Prospect } from '../src/types';

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

function baseOpp() {
  const seed = SAMPLE_OPPORTUNITIES.find((o) => o.id === 'opp-ai-websites') ?? SAMPLE_OPPORTUNITIES[0];
  const scored = scoreOpportunity({ ...seed, researchStage: 'RANKED' });
  return { ...seed, researchStage: 'RANKED' as const, score: scored, lifecycleState: 'VALIDATING' as const, category: 'Local / Real-World' as const };
}

function baseProspect(overrides: Partial<Prospect> = {}, score?: LeadScoreBreakdown): Prospect {
  const opp = baseOpp();
  const s: LeadScoreBreakdown =
    score ??
    scoreProspect(
      { websitePresence: 'SOCIAL_ONLY', contactChannel: 'PHONE', sourcesCount: 1, hasCommercialSignals: true, hasUrgencySignal: false },
      undefined,
    );
  return {
    id: 'prospect-test-1',
    opportunityId: opp.id,
    opportunityName: opp.name,
    businessName: 'Test Auto Repair',
    category: 'Local trades & auto',
    location: 'Harare',
    websitePresence: 'SOCIAL_ONLY',
    socialLinks: ['https://facebook.com/testautorepair'],
    contactChannel: 'PHONE',
    contactValue: '+263 77 000 0000',
    sources: [{ id: 'src-1', title: 'Test Auto Repair | Facebook', url: 'https://facebook.com/testautorepair', kind: 'web', note: 'test' }],
    evidenceNotes: 'Primary public result is a Facebook page, not an independent website.',
    priority: priorityFromScore(s, 'SOCIAL_ONLY'),
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

console.log('--- Lead scoring: explainable factors, sane bounds ---');
{
  const score = scoreProspect(
    { websitePresence: 'NONE_FOUND', contactChannel: 'PHONE', sourcesCount: 2, hasCommercialSignals: true, hasUrgencySignal: true },
    undefined,
  );
  assert(score.total >= 0 && score.total <= 100, `total is 0..100 (got ${score.total})`);
  assert(score.factors.length > 0, 'produces at least one explanatory factor');
  assert(score.probabilityOfClose <= 0.35, `probability of close stays conservative (<=35%, got ${score.probabilityOfClose})`);
  assert(score.expectedValue === Math.round(score.expectedProfit * score.probabilityOfClose * 100) / 100, 'expected value = profit x probability');
}

console.log('--- Lead scoring: a corroborated, no-website, reachable lead outranks a weak one ---');
{
  const strong = scoreProspect(
    { websitePresence: 'NONE_FOUND', contactChannel: 'PHONE', sourcesCount: 3, hasCommercialSignals: true, hasUrgencySignal: true },
    undefined,
  );
  const weak = scoreProspect(
    { websitePresence: 'UNKNOWN', contactChannel: 'UNKNOWN', sourcesCount: 1, hasCommercialSignals: false, hasUrgencySignal: false },
    undefined,
  );
  assert(strong.total > weak.total, `strong lead (${strong.total}) outranks weak lead (${weak.total})`);
}

console.log('--- Priority: an ADEQUATE website is DO_NOT_CONTACT regardless of score ---');
{
  const highScoreButAdequate = scoreProspect(
    { websitePresence: 'ADEQUATE', contactChannel: 'PHONE', sourcesCount: 3, hasCommercialSignals: true, hasUrgencySignal: true },
    undefined,
  );
  const priority = priorityFromScore(highScoreButAdequate, 'ADEQUATE');
  assert(priority === 'DO_NOT_CONTACT', `ADEQUATE presence forces DO_NOT_CONTACT (got ${priority})`);
}

console.log('--- Priority: never HIGH off a weak/uncorroborated signal ---');
{
  const weak = scoreProspect(
    { websitePresence: 'UNKNOWN', contactChannel: 'UNKNOWN', sourcesCount: 1, hasCommercialSignals: false, hasUrgencySignal: false },
    undefined,
  );
  const priority = priorityFromScore(weak, 'UNKNOWN');
  assert(priority !== 'HIGH', `weak single-source lead is never HIGH priority (got ${priority})`);
}

console.log('--- Outreach generation: grounded only in stored prospect/model fields ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const prospect = baseProspect();
  const outreach = generateOutreachMessages(prospect, model);
  assert(outreach.whatsapp.includes(prospect.businessName), 'WhatsApp message names the actual business');
  assert(outreach.whatsapp.includes(String(model.suggestedPrice)), 'WhatsApp message quotes the real modeled price');
  assert(outreach.email.subject.includes(prospect.businessName), 'Email subject names the actual business');
  assert(outreach.objectionResponses.length >= 2, 'has objection handling');
  assert(outreach.callScript.length >= 3, 'has a multi-step call script');
  assert(outreach.meetingAgenda.length >= 3, 'has a meeting agenda');
  assert(outreach.generator === 'local-rule-engine', 'labeled as rule-engine generated, not fabricated as LLM output');
  assert(
    !outreach.whatsapp.toLowerCase().includes('5-star') && !outreach.whatsapp.toLowerCase().includes('award-winning'),
    'never invents unverified claims about the prospect business',
  );
}

console.log('--- Outreach generation: falls back sanely with no business model yet ---');
{
  const prospect = baseProspect();
  const outreach = generateOutreachMessages(prospect, undefined);
  assert(outreach.whatsapp.includes(prospect.businessName), 'still produces a usable message without a model');
  assert(outreach.objectionResponses.length >= 2, 'still has a default objection-handling set');
}

console.log('--- Recommended actions: a HIGH-priority undiscovered prospect outranks a WAIT_FOR_EVIDENCE opportunity ---');
{
  const opp = baseOpp();
  const strongScore = scoreProspect(
    { websitePresence: 'NONE_FOUND', contactChannel: 'PHONE', sourcesCount: 3, hasCommercialSignals: true, hasUrgencySignal: true },
    generateBusinessModel(opp, []),
  );
  const prospect = baseProspect({ priority: 'HIGH', status: 'QUALIFIED' }, strongScore);
  // Barely over the WAIT_FOR_EVIDENCE threshold with low modeled revenue —
  // isolates the comparison to "an unqualified lead vs. a strong, scored
  // prospect" rather than two coincidentally similar dollar figures.
  const discovered = {
    ...opp,
    lifecycleState: 'DISCOVERED' as const,
    score: { ...opp.score!, total: 51 },
    revenuePotentialMonthlyMin: 10,
    revenuePotentialMonthlyMax: 20,
  };
  const actions = computeRecommendedActions([discovered], [], [], [], [prospect]);
  assert(actions.length > 0, 'produced at least one action');
  assert(actions[0].kind === 'CONTACT_PROSPECT', `top action is to contact the prospect (got ${actions[0].kind})`);
  assert(actions[0].prospectId === prospect.id, 'action links back to the correct prospect');
}

console.log('--- Recommended actions: never suggests contacting a DO_NOT_CONTACT or closed prospect ---');
{
  const doNotContact = baseProspect({ id: 'p-dnc', priority: 'DO_NOT_CONTACT' });
  const won = baseProspect({ id: 'p-won', status: 'WON', priority: 'HIGH' });
  const lost = baseProspect({ id: 'p-lost', status: 'LOST', priority: 'HIGH' });
  const actions = computeRecommendedActions([], [], [], [], [doNotContact, won, lost]);
  assert(actions.length === 0, `no actions generated for DO_NOT_CONTACT/WON/LOST prospects (got ${actions.length})`);
}

console.log('--- Recommended actions: a due follow-up is surfaced ---');
{
  const contacted = baseProspect({
    id: 'p-followup',
    status: 'CONTACTED',
    priority: 'MEDIUM',
    nextFollowUpAt: Date.now() - 1000,
  });
  const actions = computeRecommendedActions([], [], [], [], [contacted]);
  assert(actions.length === 1 && actions[0].kind === 'FOLLOW_UP_PROSPECT', `due follow-up produces a FOLLOW_UP_PROSPECT action (got ${actions[0]?.kind})`);
}

console.log('--- End-to-end discovery: fake search results -> real prospects -> repository round-trip ---');
{
  const opp = { ...baseOpp(), geographicRelevance: ['Harare'] };
  const model = generateBusinessModel(opp, []);

  const canned: SearchResult[] = [
    {
      title: 'Chido Cuts Hair Salon | Facebook',
      url: 'https://facebook.com/chidocuts',
      snippet: 'Chido Cuts is open Mon-Sat, book now for braiding and treatments. Call us on 0771234567.',
      source: 'stub',
    },
    {
      title: 'Marimba Motors — auto repair garage',
      url: 'https://marimbamotors.co.zw',
      snippet: 'Full service auto repair garage in Harare. Established business with regular customers.',
      source: 'stub',
    },
    {
      title: 'Not a real business at all $$$',
      url: 'https://example.com/x',
      snippet: '',
      source: 'stub',
    },
    {
      // Real bug reproduction: Facebook renders a group-post page's title
      // as "{Group Name} | {Post text}" — a group is a community, not a
      // business, and post content within it belongs to whichever member
      // posted it (here, an unrelated coach's own contact number), never
      // reliably to the group's name. Must be skipped entirely, not
      // misparsed into a prospect named after the group.
      title: 'The Market Place Zimbabwe | The 4 Ways to Win in the Clothing Business',
      url: 'https://www.facebook.com/groups/303721000000000/permalink/1234567890/',
      snippet: 'For coaching, consulting or mentorship: WhatsApp 0781141313 — The Small Biz Guy.',
      source: 'stub',
    },
    {
      // Real bug reproduction: Facebook renders a group-post page's title
      // as "{Group Name} | {Post text}" — a group is a community, not a
      // business, and post content within it belongs to whichever member
      // posted it (here, an unrelated coach's own contact number), never
      // reliably to the group's name. Must be skipped entirely, not
      // misparsed into a prospect named after the group.
      title: 'The Market Place Zimbabwe | The 4 Ways to Win in the Clothing Business',
      url: 'https://www.facebook.com/groups/303721000000000/permalink/1234567890/',
      snippet: 'For coaching, consulting or mentorship: WhatsApp 0781141313 — The Small Biz Guy.',
      source: 'stub',
    },
    {
      // Real bug reproduction: a shared government-policy news post
      // (no commercial signal, not indexed under its own business domain)
      // was previously turned into a prospect scored 74/100 and marked
      // HIGH priority. Must be skipped for lack of any real evidence this
      // is a business at all.
      title: 'Government Scraps US$703 Bakery Licence Fee... - Cleopas H Mukungunugwa',
      url: 'https://www.facebook.com/cleopas.mukungunugwa/posts/9876543210',
      snippet: 'The Government of Zimbabwe has completely removed the Local Authority bakery licence fee, which previously cost US$703. Exchange rate context: 16.0001 to 7.9996 in recent commentary. 12 6 comments 11 shares.',
      source: 'stub',
    },
  ];

  const stubSearch: SearchProvider = {
    id: 'stub',
    connected: true,
    label: 'Stub Search',
    search: async () => canned,
  };

  const { prospects, queriesRun } = await discoverProspects(stubSearch, opp, model, []);
  assert(queriesRun > 0, `ran at least one query (got ${queriesRun})`);
  assert(prospects.length > 0, `surfaced at least one real prospect (got ${prospects.length})`);
  assert(
    prospects.every((p) => p.sources.length > 0 && p.sources[0].url),
    'every prospect cites a real source URL',
  );
  const facebookOne = prospects.find((p) => p.businessName.toLowerCase().includes('chido cuts'));
  assert(!!facebookOne, 'extracted a clean business name from a Facebook page title');
  assert(facebookOne?.websitePresence === 'SOCIAL_ONLY', 'Facebook-only result classified as SOCIAL_ONLY, not fabricated as NONE_FOUND');
  assert(facebookOne?.contactChannel === 'PHONE' && facebookOne?.contactValue?.includes('0771234567'), 'extracted a real phone number actually present in the snippet');

  const ownDomain = prospects.find((p) => p.businessName.toLowerCase().includes('marimba motors'));
  assert(ownDomain?.websitePresence === 'ADEQUATE', 'a result indexed under its own domain is treated as already having a website');
  assert(ownDomain?.priority === 'DO_NOT_CONTACT', 'a business that already has a website is not recommended for the website offer');

  const groupMisattribution = prospects.find((p) => p.businessName.toLowerCase().includes('market place zimbabwe'));
  assert(
    !groupMisattribution,
    'a Facebook GROUP post is never turned into a prospect — the group name is not a business and its poster\'s contact info is never misattributed to it',
  );
  assert(
    !prospects.some((p) => p.contactValue?.includes('0781141313')),
    'the unrelated group-post author\'s phone number never ends up on any prospect',
  );

  const newsArticleMisattribution = prospects.find((p) => p.businessName.toLowerCase().includes('government scraps'));
  assert(
    !newsArticleMisattribution,
    'a government-policy news post with no commercial signal and no own domain is never turned into a prospect',
  );
  assert(
    !prospects.some((p) => p.contactValue?.includes('16.0001') || p.contactValue?.includes('7.9996')),
    'a decimal figure from an article\'s economic commentary is never extracted as a phone number',
  );

  // Repository round-trip (InMemoryRepository — same interface D1/Supabase implement).
  const repo = new InMemoryRepository();
  await repo.upsertProspects(prospects);
  const stored = await repo.listProspects();
  assert(stored.length === prospects.length, 'all discovered prospects persisted');
  assert(stored.every((p) => p.score && typeof p.score.total === 'number'), 'persisted prospects keep their score breakdown');

  // Discovering again with the same names must not duplicate them.
  const existingNames = stored.map((p) => p.businessName);
  const { prospects: secondPass } = await discoverProspects(stubSearch, opp, model, existingNames);
  assert(secondPass.length === 0, `re-discovery against known names yields no duplicates (got ${secondPass.length})`);
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
