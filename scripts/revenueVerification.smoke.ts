import { decideFinivexVerification, extractFinivexFacts } from '../src/lib/revenueVerification';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (!condition) {
    failures += 1;
    console.error('FAIL:', message);
  } else {
    console.log('OK:', message);
  }
}

const verified = decideFinivexVerification({
  claimedAmount: 25,
  claimedCurrency: 'USD',
  providerStatus: 'COMPLETED',
  providerAmount: 25,
  providerCurrency: 'USD',
});
assert(verified.status === 'VERIFIED', 'matching completed provider payment verifies');

const mismatchAmount = decideFinivexVerification({
  claimedAmount: 25,
  claimedCurrency: 'USD',
  providerStatus: 'COMPLETED',
  providerAmount: 20,
  providerCurrency: 'USD',
});
assert(mismatchAmount.status === 'REJECTED', 'amount mismatch is rejected');

const mismatchCurrency = decideFinivexVerification({
  claimedAmount: 25,
  claimedCurrency: 'USD',
  providerStatus: 'COMPLETED',
  providerAmount: 25,
  providerCurrency: 'ZWG',
});
assert(mismatchCurrency.status === 'REJECTED', 'currency mismatch is rejected');

const pending = decideFinivexVerification({
  claimedAmount: 25,
  claimedCurrency: 'USD',
  providerStatus: 'PENDING',
});
assert(pending.status === 'PENDING', 'pending provider payment is not counted as verified');

const facts = extractFinivexFacts({
  data: { status: 'COMPLETED', amount: '25.00', currency: 'USD' },
});
assert(facts.status === 'COMPLETED' && facts.amount === 25 && facts.currency === 'USD', 'common provider response shape is extracted');

if (failures) process.exit(1);
console.log('REVENUE VERIFICATION SMOKE PASSED');
