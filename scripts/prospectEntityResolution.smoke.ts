import { sameBusiness, resolveProspectEntities } from '../src/services/prospectEntityResolution';
import type { Prospect } from '../src/types';

let failures = 0;
const assert = (ok: boolean, label: string) => {
  if (ok) console.log(`  OK: ${label}`);
  else { failures += 1; console.error(`  FAIL: ${label}`); }
};

function prospect(overrides: Partial<Prospect> = {}): Prospect {
  const now = Date.now();
  return {
    id: 'p-1',
    opportunityId: 'opp-1',
    opportunityName: 'Website services',
    businessName: 'ABC Construction',
    category: 'Construction',
    location: 'Harare',
    websitePresence: 'UNKNOWN',
    socialLinks: [],
    contactChannel: 'PHONE',
    contactValue: '0771234567',
    sources: [{ id: 's1', title: 'ABC Construction', url: 'https://abc.co.zw', kind: 'web' }],
    evidenceNotes: 'Source A.',
    priority: 'HIGH',
    score: {
      total: 80, factors: [], expectedDealValue: 300, expectedAcquisitionCost: 5,
      expectedProfit: 250, expectedTimeToRevenueDays: 7, probabilityOfClose: 0.2,
      expectedValue: 50, scoredAt: now,
    },
    status: 'QUALIFIED',
    dataSource: 'LIVE',
    dateDiscovered: now,
    messagesSentCount: 0,
    responsesReceivedCount: 0,
    actualRevenue: 0,
    notes: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

console.log('--- Entity resolution: strong duplicate ---');
{
  const a = prospect();
  const b = prospect({
    id: 'p-2',
    businessName: 'ABC Construction Pvt Ltd',
    websitePresence: 'ADEQUATE',
    websiteUrl: 'https://abcconstruction.co.zw',
    sources: [{ id: 's2', title: 'ABC Construction Pvt Ltd', url: 'https://facebook.com/abc', kind: 'web' }],
  });
  assert(sameBusiness(a, b), 'strong name + same location/contact resolves to one business');
  const result = resolveProspectEntities([a], [b]);
  assert(result.merged === 1, 'duplicate is counted as merged');
  assert(result.accepted.length === 1, 'duplicate does not create a second entity');
  assert(result.accepted[0].sources.length === 2, 'evidence from both records is retained');
}

console.log('--- Entity resolution: same name, different location ---');
{
  const a = prospect();
  const b = prospect({ id: 'p-3', location: 'Bulawayo', contactValue: '0789999999' });
  assert(!sameBusiness(a, b), 'same business name in a different city is not automatically merged');
}

console.log('--- Entity resolution: shared contact, unrelated name ---');
{
  const a = prospect();
  const b = prospect({ id: 'p-4', businessName: 'XYZ Motors' });
  assert(!sameBusiness(a, b), 'shared contact alone cannot merge unrelated businesses');
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
