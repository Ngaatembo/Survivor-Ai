import { verifyProspect } from '../src/services/prospectVerification';
import { emptyState } from '../src/services/searchBudget';
import type { Prospect, SearchProvider, SearchResult } from '../src/types';
import type { SearchEconomyContext } from '../src/services/searchEconomy';
import type { SearchProvider as Provider, SearchResult as Result } from '../src/services/providers/types';

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

console.log('--- Prospect verification: no evidence remains unverified ---');
{
  const p = baseProspect({ id: 'verification-test-3' });
  const verified = await verifyProspect(ctx([]), p);
  assert(verified.verification?.status === 'UNVERIFIED', 'no search evidence does not create a false verification');
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
