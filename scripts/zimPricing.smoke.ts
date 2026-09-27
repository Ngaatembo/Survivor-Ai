/* ============================================================================
 * Zimbabwe pricing smoke test — offers are priced by what the business is,
 * inside real published Zimbabwe market ranges, never $50 / never $0.
 * Run with: npx tsx scripts/zimPricing.smoke.ts
 * ========================================================================== */

import { generateOffer } from '../src/lib/offerGenerator';
import { generateBusinessModel } from '../src/lib/businessModel';
import { TIER_PRICES } from '../src/lib/zimWebsitePricing';
import { SAMPLE_OPPORTUNITIES } from '../src/data/sampleData';
import type { Prospect } from '../src/types';

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures += 1;
}

const opp = SAMPLE_OPPORTUNITIES.find((o) => o.id === 'opp-ai-websites') ?? SAMPLE_OPPORTUNITIES[0];
const model = generateBusinessModel(opp, []);

function prospect(businessName: string, category: string, location = 'Harare', evidenceNotes = ''): Prospect {
  return {
    id: `p-${businessName}`, opportunityId: opp.id, opportunityName: opp.name, businessName, category, location,
    websitePresence: 'SOCIAL_ONLY', socialLinks: [], contactChannel: 'WHATSAPP', contactValue: '+263771112222',
    sources: [], evidenceNotes, priority: 'HIGH', score: {} as Prospect['score'], status: 'QUALIFIED', dataSource: 'LIVE',
    dateDiscovered: 0, messagesSentCount: 0, responsesReceivedCount: 0, actualRevenue: 0, notes: [], createdAt: 0, updatedAt: 0,
  };
}

const cases: [Prospect, keyof typeof TIER_PRICES][] = [
  [prospect('Chido Cuts Hair Salon', 'Local personal services'), 'STARTER'],
  [prospect('SupaFix Workshop', 'Local trades & auto'), 'BUSINESS'],
  [prospect('Premium Electricians', 'Local service business (plumbing/electrical)'), 'BUSINESS'],
  [prospect('Golden Tasty Bakery', 'Local food & hospitality', 'Marondera'), 'ORDERING_BOOKING'],
  [prospect('Nyasha Boutique', 'Local retail / boutique', 'Bulawayo', 'Order online, delivery nationwide.'), 'ONLINE_STORE'],
];

for (const [p, tier] of cases) {
  const offer = generateOffer(p, model);
  const t = TIER_PRICES[tier];
  assert(offer.price === t.quote, `${p.businessName} → ${t.label} at $${t.quote} (got $${offer.price})`);
  assert(offer.price >= t.marketMin && offer.price <= t.marketMax, `  quote sits inside the Zimbabwe market range $${t.marketMin}–$${t.marketMax}`);
  assert(offer.deliverables.some((d) => d.includes(`$${t.monthlyCare}/month`)), `  includes the $${t.monthlyCare}/month care plan`);
  assert(/Sources checked/.test(offer.priceRationale ?? ''), '  price rationale cites the published sources');
}

const prices = new Set(cases.map(([p]) => generateOffer(p, model).price));
assert(prices.size >= 3, `different kinds of business get different prices (got ${[...prices].join(', ')})`);
assert(model.suggestedPrice >= 100, `opportunity-level default is a market price, not the old $50 formula (got $${model.suggestedPrice})`);

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
