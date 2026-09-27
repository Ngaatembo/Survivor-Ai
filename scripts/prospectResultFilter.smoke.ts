/* ============================================================================
 * Prospect result filter smoke test — replays the REAL bad records that were
 * saved to production D1 as "businesses" (snapshot 27 Sept 2026) and checks
 * that only genuine single businesses survive, with clean names.
 * Run with: npx tsx scripts/prospectResultFilter.smoke.ts
 * ========================================================================== */

import { extractZimPhone, judgeSearchResult, looksLikeBusinessName } from '../src/lib/prospectResultFilter';

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures += 1;
}

type Row = { title: string; url: string; snippet: string };

// Exact titles/URLs from production. Snippets aren't stored, so the stored
// (mis-)extracted contact value stands in for the text it was taken from.
const LIVE_ROWS: Row[] = [
  { title: 'Small Talk Bakery Cafe, 1580 Bayview Ave, Toronto, ON M4G 3B7, CA - MapQuest', url: 'https://www.mapquest.com/ca/ontario/small-talk-bakery-cafe-456440614', snippet: '' },
  { title: "Zimbabwe Prices: Why Are They as High as New York City's?", url: 'https://newrepublic.com/article/115925/zimbabwe-prices-why-are-they-high-new-york-citys', snippet: '' },
  { title: 'r/Zimbabwe', url: 'https://www.reddit.com/r/Zimbabwe', snippet: '' },
  { title: 'ZAIN  RESTAURANT AND BAKERY CAFE - Updated September 2026 - 53 Photos & 17 Reviews - 15035 Military Rd S, SeaTac, Washington - Cafes - Resta', url: 'https://www.yelp.com/biz/zain-restaurant-and-bakery-cafe-seatac', snippet: '' },
  { title: 'Auto Repair and Service Businesses for Sale and Investment in Zimbabwe | SMERGERS', url: 'https://www.smergers.com/auto-repair-and-service-businesses-for-sale-and-investment-in-zimbabwe/c225s475b', snippet: '150 - 2000' },
  { title: 'How to Start a Mobile Mechanic Business & Licences Required', url: 'https://workshopsoftware.com/how-to-start-a-mobile-mechanic-business', snippet: '' },
  { title: 'THE 10 BEST Harare Province Business Accommodation 2025 (with Prices) - Tripadvisor', url: 'https://www.tripadvisor.com.au/Hotels-g3650647-zff7-Harare_Province-Hotels.html', snippet: '' },
  { title: '10 Best Business Hotels in Harare', url: 'https://www.hotels.com/de1632671-th14/business-hotels-harare-zimbabwe', snippet: '' },
  { title: '10 Best Harare Hotels, Zimbabwe (from $45)', url: 'https://us.trip.com/hotels/harare-hotels-list-849', snippet: '' },
  { title: 'ZOE Construction Zimbabwe - Construction Contractor at Zoe Construction', url: 'https://zw.linkedin.com/in/zoe-construction-zimbabwe-b1530a21b', snippet: '' },
  { title: 'Auto Repair Garages Companies & Services in Zimbabwe | The Directory', url: 'https://thedirectory.co.zw/listings.cfm?smartpages=Auto+Repair+Garages', snippet: '2011-2026' },
  { title: 'Repair Garage Companies & Services in Zimbabwe | The Directory', url: 'https://thedirectory.co.zw/listings.cfm?Smartpages=repair+garage', snippet: '2011-2026' },
  { title: 'Auto Repair and Service Franchise Opportunities in Zimbabwe | SMERGERS', url: 'https://smergers.com/auto-repair-and-service-franchise-opportunities-in-zimbabwe/c225s475t11b', snippet: '' },
  { title: 'How to Start a Salon or Barbershop in Zimbabwe — Licences, Costs & Guide | RegisterCompany.co.zw', url: 'https://registercompany.co.zw/start-business/salon', snippet: '+44) 330 027 2159' },
  { title: 'Starting a Hair Salon Business in Zimbabwe - StartupBiz Zimbabwe', url: 'https://startupbiz.co.zw/starting-hair-salon-business-plan-zimbabwe', snippet: '' },
  { title: 'Hairdressing Course in Zimbabwe | TGS College', url: 'https://tgscollege.ac.zw/hairdressing', snippet: '078 948 0800' },
  { title: 'Need a trusted service provider in Zimbabwe? Find ... - Instagram', url: 'https://www.instagram.com/reel/Da9DTjzDXvk', snippet: '' },
  { title: 'How to Start a Retail Shop in Zimbabwe — Licences, Costs & Guide | RegisterCompany.co.zw', url: 'https://registercompany.co.zw/start-business/retail', snippet: '' },
  { title: 'New businesses in small towns in Zimbabwe | zimbabweland', url: 'https://zimbabweland.wordpress.com/2025/02/03/new-businesses-in-small-towns-in-zimbabwe', snippet: '' },
  { title: "The changing face of Zim's retail sector", url: 'https://www.heraldonline.co.zw/the-changing-face-of-zims-retail-sector', snippet: '' },
  { title: 'Truworths Zimbabwe Information', url: 'https://rocketreach.co/truworths-zimbabwe-profile_b4435956fa0545f6', snippet: '263) 457-1653' },
  { title: 'Retail and Banking Sector Analysis - v3 - MBA', url: 'https://www.humanrights.dk/files/media/migrated/zimbabwe_retail_and_banking_sector_analysis_-_dihrzela.pdf', snippet: '' },
  { title: 'Starting a Bakery Business In Zimbabwe - StartupBiz Zimbabwe', url: 'https://startupbiz.co.zw/starting-bakery-business-plan-zimbabwe', snippet: '' },
  { title: "Zimbabwe's booming restaurant scene - BBC News", url: 'https://www.bbc.com/news/business-33696377', snippet: '' },
  { title: 'How to Open a Restaurant in Zimbabwe 2026 — Licences & Costs', url: 'https://registercompany.co.zw/start-business/restaurant', snippet: '' },
  { title: "Zimbabwe's booming restaurant scene Survival ... Informal ...", url: 'https://www.newzimbabwe.com/zimbabwes-booming-restaurant-scenesurvival-informal-food-stalls-are-increasing-across-the-country', snippet: '' },
  { title: 'Simba the artisan baker and chef, Victoria Falls, Zimbabwe', url: 'https://www.youtube.com/watch?v=yhHZ7dCw9Pc', snippet: '+263 77 445 0693' },
  { title: 'Setting up a small auto body shop', url: 'https://www.heraldonline.co.zw/setting-up-a-small-auto-body-shop', snippet: '' },
  { title: 'Video credit: Hair by Eussy Zimbabwe - #bonestraightbraids', url: 'https://www.facebook.com/100063567631734/videos/video-credit-hair-by-eussy-zimbabwe-bonestraightbraids-colorb29braids/1466214494410107', snippet: '' },
  { title: 'She Came Back from South Africa to Start a Big Hair Salon ...', url: 'https://www.youtube.com/watch?v=gXeDfhkDV5w', snippet: '+263787579927' },
];

const GENUINE: (Row & { expectName: string; expectLocation?: string })[] = [
  {
    title: 'This is SupaFix Workshop. This is how we work. 🚗💨\nFrom engine overhauls and diagnostics to brakes, suspension, and genuine parts supply - ',
    url: 'https://www.facebook.com/supafixzimbabwe/videos/this-is-supafix-workshop-this-is-how-we-work-from-engine-overhauls-and-diagnosti/1605223714577125',
    snippet: 'Call or WhatsApp +263 77 286 2688',
    expectName: 'SupaFix Workshop',
  },
  { title: 'Installations, Repairs & MORE In Zimbabwe - Premium Electricians', url: 'https://premiumelectricians.co.zw', snippet: '', expectName: 'Premium Electricians' },
  { title: 'Alfresco The Bakery | Harare & Bulawayo, Zimbabwe', url: 'https://alfrescothebakery.com', snippet: '', expectName: 'Alfresco The Bakery', expectLocation: 'Harare' },
  { title: 'Fundamali.zw on TikTok', url: 'https://www.tiktok.com/@fundamali.zw/video/7439840698934791480', snippet: '', expectName: 'Fundamali.zw' },
];

console.log('--- Every non-business record from production is rejected ---');
for (const row of LIVE_ROWS) {
  const j = judgeSearchResult(row, 'Zimbabwe');
  assert(!j.ok, `rejected: "${row.title.slice(0, 70)}"${j.ok ? ` (wrongly accepted as "${j.businessName}")` : ` — ${j.reason}`}`);
}

console.log('--- Genuine businesses are kept with their real name ---');
for (const row of GENUINE) {
  const j = judgeSearchResult(row, 'Zimbabwe');
  assert(j.ok && j.businessName === row.expectName, `kept "${row.expectName}" (got ${j.ok ? `"${j.businessName}"` : `rejected: ${j.reason}`})`);
  if (row.expectLocation) assert(j.ok && j.location === row.expectLocation, `location recorded as ${row.expectLocation} (got ${j.ok ? j.location : '-'})`);
}

console.log('--- Foreign businesses with a clean name are still rejected ---');
{
  const j = judgeSearchResult({ title: 'Small Talk Bakery Cafe', url: 'https://smalltalkbakery.ca', snippet: '1580 Bayview Ave, Toronto. Open daily, order online.' }, 'Zimbabwe');
  assert(!j.ok, 'a Toronto bakery on its own domain is rejected for a Zimbabwe search');
}

console.log('--- Phone numbers: only real Zimbabwe numbers ---');
assert(extractZimPhone('Call +263 77 286 2688 today') === '+263 77 286 2688', '+263 mobile accepted');
assert(!!extractZimPhone('WhatsApp 0771234567'), '07x mobile accepted');
assert(!!extractZimPhone('Tel: 0242 700 800'), 'Harare landline accepted');
assert(!extractZimPhone('Established 2011-2026'), 'year range rejected');
assert(!extractZimPhone('Prices 150 - 2000'), 'price range rejected');
assert(!extractZimPhone('UK office +44) 330 027 2159'), 'UK number rejected');
assert(!extractZimPhone('Exchange rate 16.0001 to 7.9996'), 'decimal figures rejected');

console.log('--- Name shape ---');
assert(looksLikeBusinessName('Chido Cuts Hair Salon'), 'plain business name accepted');
assert(!looksLikeBusinessName('This is SupaFix Workshop. This is how we work'), 'sentence rejected');
assert(!looksLikeBusinessName('THE 10 BEST Harare Business Hotels 2026'), 'listicle rejected');
assert(!looksLikeBusinessName('Need a trusted service provider in Zimbabwe? Find ...'), 'question/ellipsis rejected');

console.log('--- WhatsApp Business links are social presence, not a website ---');
{
  const j = judgeSearchResult({ title: 'Geoffrey Electrical Contractors on WhatsApp | +263 78 715 2054', url: 'https://wa.me/electrical213', snippet: 'Electrical installations and repairs in Bulawayo. Call or WhatsApp +263 78 715 2054.' }, 'Zimbabwe');
  assert(j.ok && j.businessName === 'Geoffrey Electrical Contractors', `"on WhatsApp" suffix stripped from the name (got ${j.ok ? j.businessName : j.reason})`);
  assert(j.ok && j.isSocial, 'wa.me is treated as a social/WhatsApp presence, not the business\'s own website');
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
