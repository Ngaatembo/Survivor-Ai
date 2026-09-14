/* ============================================================================
 * Offer + delivery smoke test (Phase 3): offer generation, design brief
 * generation, project creation on WON, milestone advancement, and
 * recommended-actions integration (SEND_OFFER / ADVANCE_PROJECT). Pure-
 * function tests — no network/D1 needed. Run with:
 *   npx tsx scripts/offerDelivery.smoke.ts
 * ========================================================================== */

import { SAMPLE_OPPORTUNITIES } from '../src/data/sampleData';
import { scoreOpportunity } from '../src/lib/scoring';
import { scoreProspect, priorityFromScore } from '../src/lib/prospectScoring';
import { generateBusinessModel } from '../src/lib/businessModel';
import { generateOffer } from '../src/lib/offerGenerator';
import { generateDesignBrief } from '../src/lib/designBriefGenerator';
import { createProjectFromWonOffer, advanceMilestone, nextIncompleteMilestone, isOverdue } from '../src/lib/projectTracker';
import { computeRecommendedActions } from '../src/lib/recommendedActions';
import { InMemoryRepository } from '../src/engine/inMemoryRepository';
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

function baseProspect(overrides: Partial<Prospect> = {}): Prospect {
  const opp = baseOpp();
  const s: LeadScoreBreakdown = scoreProspect(
    { websitePresence: 'NONE_FOUND', contactChannel: 'WHATSAPP', sourcesCount: 2, hasCommercialSignals: true, hasUrgencySignal: false },
    undefined,
  );
  return {
    id: 'prospect-offer-test-1',
    opportunityId: opp.id,
    opportunityName: opp.name,
    businessName: 'Test Bakery',
    category: 'Local food business',
    location: 'Marondera',
    websitePresence: 'NONE_FOUND',
    socialLinks: [],
    contactChannel: 'WHATSAPP',
    contactValue: '+263 77 111 2222',
    sources: [{ id: 'src-1', title: 'Test Bakery | Facebook', url: 'https://facebook.com/testbakery', kind: 'web', note: 'test' }],
    evidenceNotes: 'No independent website found; primary presence is a Facebook page.',
    priority: priorityFromScore(s, 'NONE_FOUND'),
    score: s,
    status: 'INTERESTED',
    dataSource: 'LIVE',
    dateDiscovered: Date.now(),
    messagesSentCount: 1,
    responsesReceivedCount: 1,
    actualRevenue: 0,
    notes: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

console.log('--- Offer generation: never fabricates a fact, includes a gap analysis only when supported ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const prospect = baseProspect();
  const offer = generateOffer(prospect, model);
  assert(offer.status === 'DRAFT', 'a freshly generated offer starts DRAFT');
  assert(offer.price > 0, `price is positive (got ${offer.price})`);
  assert(offer.timelineDaysMax >= offer.timelineDaysMin, 'timeline max >= min');
  assert(offer.deliverables.length > 0, 'has at least one deliverable');
  assert(!!offer.gapAnalysis, 'NONE_FOUND website presence produces a gap analysis');
  assert(offer.gapAnalysis!.includes(prospect.businessName), 'gap analysis references the actual business name, not a placeholder');
  assert(offer.websiteBrief.sitemap.length > 0, 'website brief includes a sitemap');
  assert(offer.websiteBrief.requiredAssets.length > 0, 'website brief lists required assets');

  const adequateProspect = baseProspect({ websitePresence: 'ADEQUATE' });
  const adequateOffer = generateOffer(adequateProspect, model);
  assert(adequateOffer.gapAnalysis === undefined, 'ADEQUATE website presence produces no gap analysis (nothing fabricated)');
}

console.log('--- Design brief: no image-gen wired in, assetStatus always NOT_CONFIGURED ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const prospect = baseProspect();
  const offer = generateOffer(prospect, model);
  const brief = generateDesignBrief(offer, prospect);
  assert(brief.offerId === offer.id, 'design brief links back to its offer');
  assert(brief.assetStatus === 'NOT_CONFIGURED', `assetStatus is NOT_CONFIGURED (got ${brief.assetStatus})`);
  assert(brief.homepageConcept.length > 0, 'homepage concept is non-empty');
  assert(brief.socialGraphics.length > 0, 'social graphics list is non-empty');
}

console.log('--- Project tracker: created on WON, standard milestones, advances correctly ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const prospect = baseProspect({ status: 'WON' });
  const offer = generateOffer(prospect, model);
  const project = createProjectFromWonOffer(prospect, offer);
  assert(project.status === 'ACTIVE', 'new project starts ACTIVE');
  assert(project.milestones.length === 6, `has all 6 standard milestones (got ${project.milestones.length})`);
  assert(project.milestones[0].status === 'active', 'first milestone (KICKOFF) starts active');
  assert(project.milestones.slice(1).every((m) => m.status === 'pending'), 'remaining milestones start pending');
  assert(project.agreedPrice === offer.price, 'agreed price matches the offer price');

  const afterKickoff = advanceMilestone(project, 'KICKOFF');
  assert(afterKickoff.milestones[0].status === 'done', 'advancing KICKOFF marks it done');
  assert(afterKickoff.milestones[1].status === 'active', 'advancing KICKOFF activates CONTENT_COLLECTED');
  assert(afterKickoff.status === 'ACTIVE', 'project stays ACTIVE after a non-final milestone');

  const delivered = advanceMilestone(afterKickoff, 'DELIVERED');
  assert(delivered.status === 'DELIVERED', 'advancing to DELIVERED marks the whole project DELIVERED');
  assert(delivered.milestones.every((m) => m.status === 'done'), 'all milestones marked done once DELIVERED');
  assert(!!delivered.deliveredAt, 'deliveredAt is set once DELIVERED');
  assert(nextIncompleteMilestone(delivered) === undefined, 'no incomplete milestone remains once DELIVERED');

  const overdueProject = { ...project, startedAt: Date.now() - 999 * 24 * 60 * 60 * 1000 };
  assert(isOverdue(overdueProject), 'a project long past its agreed timeline is flagged overdue');
  assert(!isOverdue(delivered), 'a DELIVERED project is never flagged overdue');
}

console.log('--- Recommended actions: SEND_OFFER and ADVANCE_PROJECT surface correctly ---');
{
  const opp = baseOpp();
  const model = generateBusinessModel(opp, []);
  const prospect = baseProspect();
  const offer = generateOffer(prospect, model);
  const actionsWithDraftOffer = computeRecommendedActions([opp], [], [model], [], [prospect], [offer], []);
  assert(
    actionsWithDraftOffer.some((a) => a.kind === 'SEND_OFFER'),
    'a DRAFT offer produces a SEND_OFFER recommended action',
  );

  const sentOffer = { ...offer, status: 'SENT' as const };
  const actionsWithSentOffer = computeRecommendedActions([opp], [], [model], [], [prospect], [sentOffer], []);
  assert(
    !actionsWithSentOffer.some((a) => a.kind === 'SEND_OFFER'),
    'a SENT offer no longer produces a SEND_OFFER action',
  );

  const wonProspect = baseProspect({ status: 'WON' });
  const project = createProjectFromWonOffer(wonProspect, offer);
  const actionsWithProject = computeRecommendedActions([opp], [], [model], [], [wonProspect], [], [project]);
  assert(
    actionsWithProject.some((a) => a.kind === 'ADVANCE_PROJECT'),
    'an ACTIVE project with an incomplete milestone produces an ADVANCE_PROJECT action',
  );

  const deliveredProject = { ...project, status: 'DELIVERED' as const };
  const actionsWithDelivered = computeRecommendedActions([opp], [], [model], [], [wonProspect], [], [deliveredProject]);
  assert(
    !actionsWithDelivered.some((a) => a.kind === 'ADVANCE_PROJECT'),
    'a DELIVERED project no longer produces an ADVANCE_PROJECT action',
  );
}

console.log('--- Repository round-trip: offers, design briefs, projects, CRM status write path ---');
{
  (async () => {
    const repo = new InMemoryRepository();
    const opp = baseOpp();
    const model = generateBusinessModel(opp, []);
    const prospect = baseProspect();
    await repo.upsertProspects([prospect]);

    const offer = generateOffer(prospect, model);
    await repo.upsertOffer(offer);
    const listedOffers = await repo.listOffers();
    assert(listedOffers.length === 1 && listedOffers[0].id === offer.id, 'offer round-trips through the repository');

    const brief = generateDesignBrief(offer, prospect);
    await repo.upsertDesignBrief(brief);
    const listedBriefs = await repo.listDesignBriefs();
    assert(listedBriefs.length === 1 && listedBriefs[0].offerId === offer.id, 'design brief round-trips through the repository');

    await repo.updateOfferStatus(offer.id, 'SENT');
    const afterSend = (await repo.listOffers())[0];
    assert(afterSend.status === 'SENT', 'updateOfferStatus persists through the repository');

    await repo.updateProspectStatus(prospect.id, 'WON');
    const wonProspect = (await repo.listProspects())[0];
    assert(wonProspect.status === 'WON', 'updateProspectStatus (the CRM write path) persists through the repository');

    const project = createProjectFromWonOffer(wonProspect, afterSend);
    await repo.upsertProject(project);
    await repo.advanceProjectMilestone(project.id, 'KICKOFF');
    const advanced = (await repo.listProjects())[0];
    assert(advanced.milestones[0].status === 'done', 'advanceProjectMilestone persists through the repository');

    console.log(failures === 0 ? `\nAll checks passed.` : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })();
}
