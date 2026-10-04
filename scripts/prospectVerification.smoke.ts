import { verifyProspect } from '../src/services/prospectVerification';
import { emptyState } from '../src/services/searchBudget';
import type { Prospect } from '../src/types';
import type { SearchEconomyContext } from '../src/services/searchEconomy';
import type { SearchProvider as Provider, SearchResult as Result } from '../src/services/providers/types';

// Website verification performs a live homepage audit (services/websiteAudit.ts).
// Tests must not depend on the network or on fictional domains resolving, so
// fetch is replaced with a deterministic fixture: the official test domain
// serves a healthy homepage, every other host is unreachable.
const FIXTURE_HOMEPAGES: Record<string, string> = {
  'chidocuts.co.zw': `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chido Cuts Hair Salon | Harare</title>
<meta name="description" content="Chido Cuts Hair Salon in Harare. Haircuts, braids and styling. Book on WhatsApp.">
</head><body><header><nav><a href="/">Home</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>
<main><h1>Chido Cuts Hair Salon</h1><p>Professional haircuts, braids and styling in Harare.</p>
<a href="https://wa.me/263771234567">WhatsApp us</a><a href="tel:+263771234567">Call 0771234567</a>
<a href="/book">Book now</a><form action="/contact"><input name="name"><button>Send</button></form>
<img src="/salon.jpg" alt="Salon interior"><p>Testimonials: "Best salon in Harare" — Rudo</p>
<p>Open Mon–Sat 8am–6pm, 12 Samora Machel Ave, Harare.</p></main><footer>© 2026 Chido Cuts</footer></body></html>`,
};
// The unrelated domain is reachable and healthy too, so the test proves it is
// rejected on ownership evidence rather than because the fetch failed.
FIXTURE_HOMEPAGES['chido-example.co.zw'] = FIXTURE_HOMEPAGES['chidocuts.co.zw'];
globalThis.fetch = (async (input: string | URL | Request) => {
  const host = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).hostname.replace(/^www\./, '');
  const html = FIXTURE_HOMEPAGES[host];
  if (!html) throw new TypeError('fetch failed (test fixture: host not reachable)');
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}) as typeof fetch;

let failures = 0;
const assert = (ok: boolean, label: string) => {
  if (ok) console.log(`  OK: ${label}`);
  else { failures += 1; console.error(`  FAIL: ${label}`); }
};

function baseProspect(overrides: Partial<Prospect> = {}): Prospect {
  const now = Date.now();
  return {
    id: 'verification-test-1',
    opportunityId: 'opp-1',
    opportunityName: 'AI websites',
    businessName: 'Chido Cuts',
    category: 'Local personal services',
    location: 'Harare',
    websitePresence: 'SOCIAL_ONLY',
    socialLinks: [],
    contactChannel: 'PHONE',
    contactValue: '0771234567',
    sources: [{ id: 'src-1', title: 'Chido Cuts | Facebook', url: 'https://facebook.com/chidocuts', kind: 'web' }],
    evidenceNotes: 'Discovery source.',
    priority: 'HIGH',
    score: {
      total: 75, factors: [], expectedDealValue: 300, expectedAcquisitionCost: 5,
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

function ctx(results: Result[]): SearchEconomyContext {
  const provider: Provider = {
    id: 'stub',
    label: 'Verification stub',
    connected: true,
    search: async () => results,
  };
  return {
    state: emptyState(),
    providers: { tavily: provider, brave: null },
    survivalStatus: 'ALIVE',
    now: Date.now(),
    cycleStartedAt: Date.now(),
  };
}

console.log('--- Prospect verification: corroborated business + contact ---');
{
  const p = baseProspect();
  const results: Result[] = [
    {
      title: 'Chido Cuts Hair Salon | Home',
      url: 'https://chidocuts.co.zw/',
      snippet: 'Chido Cuts Hair Salon, Harare. Call 0771234567 for bookings.',
      source: 'stub',
    },
    {
      title: 'Chido Cuts Hair Salon | Facebook',
      url: 'https://facebook.com/chidocuts',
      snippet: 'Chido Cuts Hair Salon Harare. WhatsApp 0771234567.',
      source: 'stub',
    },
  ];
  const verified = await verifyProspect(ctx(results), p);
  assert(verified.verification?.status === 'VERIFIED', 'two independent matching sources produce VERIFIED');
  assert(verified.businessName === 'Chido Cuts Hair Salon', 'canonical business name is taken from matching evidence');
  assert(verified.contactValue === '0771234567', 'corroborated phone is retained');
  assert(verified.contactChannel === 'PHONE', 'verified phone is exposed as PHONE');
  assert((verified.verification?.contactSources ?? 0) >= 2, 'contact is corroborated across independent sources');
  assert(verified.websitePresence === 'ADEQUATE', 'independent website evidence upgrades website presence to ADEQUATE');
  assert(verified.websiteUrl === 'https://chidocuts.co.zw', 'verified independent website URL is retained (normalized, no trailing slash)');
  assert(verified.priority === 'DO_NOT_CONTACT', 'adequate website prospect is removed from the website-offer contact queue');
}

console.log('--- Prospect verification: unrelated custom domain is not official ---');
{
  const p = baseProspect({ id: 'verification-test-unrelated-domain' });
  const results: Result[] = [
    { title: 'Chido Cuts Hair Salon', url: 'https://chido-example.co.zw/', snippet: 'Chido Cuts Hair Salon, Harare. Call 0771234567.', source: 'stub' },
    { title: 'Chido Cuts Hair Salon | Facebook', url: 'https://facebook.com/chidocuts', snippet: 'Chido Cuts Hair Salon Harare. WhatsApp 0771234567.', source: 'stub' },
  ];
  const verified = await verifyProspect(ctx(results), p);
  assert(!verified.verification?.verifiedWebsiteUrl, 'unrelated custom domain is not accepted as the official website');
}

console.log('--- Prospect verification: conflicting contacts fail closed ---');
{
  const p = baseProspect({ id: 'verification-test-2', contactValue: '0770000000' });
  const results: Result[] = [
    {
      title: 'Chido Cuts Hair Salon',
      url: 'https://chidocuts.co.zw/',
      snippet: 'Harare salon. Call 0771111111.',
      source: 'stub',
    },
    {
      title: 'Chido Cuts Hair Salon | Facebook',
      url: 'https://facebook.com/chidocuts',
      snippet: 'Harare salon. WhatsApp 0772222222.',
      source: 'stub',
    },
  ];
  const verified = await verifyProspect(ctx(results), p);
  assert(verified.verification?.status === 'CONFLICT', 'different equally-supported contact numbers produce CONFLICT');
  assert(!verified.contactValue, 'ambiguous contact is removed from the usable CRM contact field');
  assert(verified.contactChannel === 'UNKNOWN', 'conflicting contact cannot be used for outreach');
  assert((verified.verification?.conflictingContacts.length ?? 0) >= 2, 'both conflicting numbers remain visible as evidence');
}

console.log('--- Prospect verification: same name but conflicting city fails closed ---');
{
  const p = baseProspect({
    id: 'verification-test-location-conflict',
    businessName: 'Topclass Autobody',
    location: 'Mutare',
    contactValue: '0716307770',
    websitePresence: 'NONE_FOUND',
  });
  const results: Result[] = [
    {
      title: 'Topclass Autobody | Home',
      url: 'https://www.topclass.co.zw/',
      snippet: '23 George Avenue, Msasa, Harare. Call +263 242 446954. Topclass Autobody.',
      source: 'stub',
    },
    {
      title: 'TOPCLASS Autobody | Hararelife',
      url: 'https://hararelife.com/listing/topclass-autobody/',
      snippet: '23 George Avenue, Msasa, Harare. +263 242 446954. www.topclass.co.zw',
      source: 'stub',
    },
  ];
  const verified = await verifyProspect(ctx(results), p);
  assert(verified.verification?.status === 'CONFLICT', 'same-name evidence in another city produces CONFLICT');
  assert(!verified.contactValue, 'conflicting-city contact is removed');
  assert(verified.contactChannel === 'UNKNOWN', 'conflicting-city contact channel is unusable');
  assert(verified.websitePresence === 'UNKNOWN', 'wrong-city website is not attributed to the lead');
  assert(!verified.websiteUrl, 'wrong-city website URL is not retained');
}

console.log('--- Prospect verification: duplicate pages on one domain cannot corroborate contact ---');
{
  const p = baseProspect({ id: 'verification-test-same-domain' });
  const results: Result[] = [
    {
      title: 'Chido Cuts Hair Salon | Home',
      url: 'https://chidocuts.co.zw/',
      snippet: 'Chido Cuts Hair Salon, Harare. Call 0771234567.',
      source: 'stub',
    },
    {
      title: 'Chido Cuts Hair Salon | Contact',
      url: 'https://chidocuts.co.zw/contact',
      snippet: 'Chido Cuts Hair Salon, Harare. WhatsApp 0771234567.',
      source: 'stub',
    },
  ];
  const verified = await verifyProspect(ctx(results), p);
  assert(verified.verification?.status !== 'VERIFIED', 'same-domain duplicates do not create independent corroboration');
}

console.log('--- Prospect verification: directory-only contact evidence remains provisional ---');
{
  const p = baseProspect({ id: 'verification-test-directories' });
  const results: Result[] = [
    {
      title: 'Chido Cuts Hair Salon',
      url: 'https://www.africabizinfo.com/ZW/chido-cuts',
      snippet: 'Chido Cuts Hair Salon, Harare. Call 0771234567.',
      source: 'stub',
    },
    {
      title: 'Chido Cuts Hair Salon',
      url: 'https://www.cybo.com/ZW-biz/chido-cuts',
      snippet: 'Chido Cuts Hair Salon, Harare. WhatsApp 0771234567.',
      source: 'stub',
    },
  ];
  const verified = await verifyProspect(ctx(results), p);
  assert(verified.verification?.status !== 'VERIFIED', 'directory-only contact evidence cannot establish first-party ownership');
}

console.log('--- Prospect verification: no evidence remains unverified ---');
{
  const p = baseProspect({ id: 'verification-test-3' });
  const verified = await verifyProspect(ctx([]), p);
  assert(verified.verification?.status === 'UNVERIFIED', 'no search evidence does not create a false verification');
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
