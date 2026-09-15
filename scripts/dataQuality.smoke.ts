/* ============================================================================
 * Data quality diagnostics smoke test (build-spec §44). Pure-function
 * tests — no network/D1 needed. Run with:
 *   npx tsx scripts/dataQuality.smoke.ts
 * ========================================================================== */

import { computeDataQualityIssues } from '../src/lib/dataQuality';
import type { Offer, Project, Prospect, RealRevenueEntry } from '../src/types';

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

function baseProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: 'p1',
    opportunityId: 'opp-1',
    opportunityName: 'Test Opp',
    businessName: 'Clean Business',
    category: 'Local service business',
    location: 'Harare',
    websitePresence: 'NONE_FOUND',
    socialLinks: [],
    contactChannel: 'PHONE',
    contactValue: '0771111111',
    sources: [{ id: 'src-1', title: 'Clean Business site', url: 'https://cleanbusiness.co.zw', kind: 'web' }],
    evidenceNotes: 'test',
    priority: 'HIGH',
    score: {
      total: 80,
      factors: [],
      expectedDealValue: 30,
      expectedAcquisitionCost: 1,
      expectedProfit: 29,
      probabilityOfClose: 0.3,
      expectedValue: 8.7,
      expectedTimeToRevenueDays: 7,
    },
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

console.log('--- No issues in a clean dataset ---');
{
  const prospects = [baseProspect()];
  const issues = computeDataQualityIssues({ prospects, offers: [], projects: [], realRevenue: [] });
  assert(issues.length === 0, 'a fully clean dataset produces zero issues');
}

console.log('--- Facebook group source is flagged HIGH severity ---');
{
  const contaminated = baseProspect({
    id: 'p2',
    businessName: 'The Market Place Zimbabwe',
    sources: [{ id: 'src-2', title: 'The Market Place Zimbabwe | The 4 Ways to Win', url: 'https://www.facebook.com/groups/12345/permalink/999/', kind: 'web' }],
  });
  const issues = computeDataQualityIssues({ prospects: [baseProspect(), contaminated], offers: [], projects: [], realRevenue: [] });
  const fbIssue = issues.find((i) => i.entityId === 'p2');
  assert(!!fbIssue, 'a prospect sourced from a Facebook group is flagged');
  assert(fbIssue?.severity === 'HIGH', 'Facebook group contamination is HIGH severity');
  assert(fbIssue!.message.includes('Market Place Zimbabwe'), 'the flag names the actual affected business');

  const clean = computeDataQualityIssues({ prospects: [baseProspect()], offers: [], projects: [], realRevenue: [] });
  assert(clean.length === 0, 'a prospect with only a normal website source is never flagged');
}

console.log('--- Duplicate prospects (same business, same opportunity) are flagged ---');
{
  const dup1 = baseProspect({ id: 'p3', businessName: 'Duplicate Co' });
  const dup2 = baseProspect({ id: 'p4', businessName: 'duplicate co' }); // case-insensitive match
  const issues = computeDataQualityIssues({ prospects: [dup1, dup2], offers: [], projects: [], realRevenue: [] });
  assert(issues.some((i) => i.category === 'Duplicate prospect'), 'case-insensitive duplicate business names under the same opportunity are flagged');

  const differentOpp = baseProspect({ id: 'p5', businessName: 'Duplicate Co', opportunityId: 'opp-2' });
  const noDupIssues = computeDataQualityIssues({ prospects: [dup1, differentOpp], offers: [], projects: [], realRevenue: [] });
  assert(!noDupIssues.some((i) => i.category === 'Duplicate prospect'), 'the same business name under a DIFFERENT opportunity is never flagged as a duplicate');
}

console.log('--- Orphaned offers/projects/revenue are flagged ---');
{
  const prospect = baseProspect();
  const validOffer: Offer = {
    id: 'o1', prospectId: prospect.id, prospectName: prospect.businessName, opportunityId: prospect.opportunityId,
    opportunityName: 'Test', price: 100, timelineDaysMin: 3, timelineDaysMax: 7, deliverables: [],
    websiteBrief: { sitemap: [], copyDirection: '', ctaStrategy: '', brandDirection: '', seoBasics: [], requiredSections: [], requiredAssets: [] },
    status: 'DRAFT', generator: 'local-rule-engine', generatedAt: Date.now(), updatedAt: Date.now(),
  };
  const orphanOffer: Offer = { ...validOffer, id: 'o2', prospectId: 'does-not-exist' };

  const offerIssues = computeDataQualityIssues({ prospects: [prospect], offers: [validOffer, orphanOffer], projects: [], realRevenue: [] });
  assert(offerIssues.some((i) => i.category === 'Orphaned offer' && i.entityId === 'o2'), 'an offer referencing a missing prospect is flagged');
  assert(!offerIssues.some((i) => i.entityId === 'o1'), 'a valid offer is never flagged');

  const validProject: Project = {
    id: 'pr1', prospectId: prospect.id, prospectName: prospect.businessName, offerId: validOffer.id, opportunityId: prospect.opportunityId,
    agreedPrice: 100, agreedTimelineDaysMax: 7, milestones: [], status: 'ACTIVE', startedAt: Date.now(), updatedAt: Date.now(),
  };
  const orphanProject: Project = { ...validProject, id: 'pr2', offerId: 'does-not-exist' };
  const projectIssues = computeDataQualityIssues({ prospects: [prospect], offers: [validOffer], projects: [validProject, orphanProject], realRevenue: [] });
  assert(projectIssues.some((i) => i.category === 'Orphaned project' && i.entityId === 'pr2'), 'a project referencing a missing offer is flagged');
  assert(!projectIssues.some((i) => i.entityId === 'pr1'), 'a valid project is never flagged');

  const validRevenue: RealRevenueEntry = {
    id: 'rr1', date: Date.now(), opportunityId: prospect.opportunityId, opportunityName: 'Test', prospectId: prospect.id,
    prospectName: prospect.businessName, projectId: validProject.id, productService: 'Website', quotedPrice: 100,
    amountReceived: 100, costs: 10, profit: 90, currency: 'USD', paymentMethod: 'CASH', acquisitionChannel: 'WhatsApp',
    daysFromDiscoveryToPayment: 5, createdAt: Date.now(),
  };
  const orphanRevenue: RealRevenueEntry = { ...validRevenue, id: 'rr2', projectId: 'does-not-exist' };
  const revenueIssues = computeDataQualityIssues({ prospects: [prospect], offers: [validOffer], projects: [validProject], realRevenue: [validRevenue, orphanRevenue] });
  assert(revenueIssues.some((i) => i.category === 'Orphaned revenue record' && i.entityId === 'rr2'), 'a revenue entry referencing a missing project is flagged');
  assert(!revenueIssues.some((i) => i.entityId === 'rr1'), 'a valid revenue entry is never flagged');
}

console.log(failures === 0 ? `\nAll checks passed.` : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
