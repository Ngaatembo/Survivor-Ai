import { evaluateFirstDollarChallenge } from '../src/lib/firstDollar';
import type { RealRevenueEntry } from '../src/types';

let failures = 0;

function assert(condition: boolean, message: string) {
  if (condition) console.log('  OK:', message);
  else {
    failures += 1;
    console.error('  FAIL:', message);
  }
}

function entry(id: string, amountReceived: number, date: number): RealRevenueEntry {
  return {
    id,
    date,
    opportunityId: 'opp-test',
    opportunityName: 'Test opportunity',
    prospectId: 'prospect-test',
    prospectName: 'Test customer',
    projectId: 'project-test',
    productService: 'Test service',
    quotedPrice: amountReceived,
    amountReceived,
    costs: 0,
    profit: amountReceived,
    currency: 'USD',
    paymentMethod: 'OTHER',
    acquisitionChannel: 'test',
    daysFromDiscoveryToPayment: 1,
    createdAt: date,
  };
}

console.log('--- First dollar challenge ---');

const empty = evaluateFirstDollarChallenge([]);
assert(empty.recordedRevenue === 0, 'no revenue starts at $0');
assert(empty.remaining === 1, 'first-dollar target starts with $1 remaining');
assert(!empty.reached, 'empty ledger cannot reach the challenge');

const below = evaluateFirstDollarChallenge([
  entry('rr-1', 0.40, 100),
  entry('rr-zero', 0, 90),
]);
assert(below.recordedRevenue === 0.4, 'only positive real receipts count');
assert(below.remaining === 0.6, '$0.40 leaves $0.60 remaining');
assert(!below.reached, 'less than $1 does not pass');

const reached = evaluateFirstDollarChallenge([
  entry('rr-late', 0.75, 200),
  entry('rr-first', 0.25, 100),
]);
assert(reached.recordedRevenue === 1, 'multiple real receipts sum to exactly $1');
assert(reached.reached, '$1 reaches the challenge');
assert(reached.firstEntryId === 'rr-first', 'first receipt is selected chronologically');

const exceeded = evaluateFirstDollarChallenge([
  entry('rr-1', 2, 100),
]);
assert(exceeded.reached, 'revenue above $1 still passes');
assert(exceeded.remaining === 0, 'remaining never becomes negative');

console.log(failures === 0 ? 'All first-dollar checks passed.' : failures + ' check(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
