/* ============================================================================
 * Revenue-first loop, end to end: the real Worker fetch handler + cron
 * against a local D1 with every migration. The payment provider (Finivex) is
 * an HTTP stub; every outbound call is counted.
 *
 *   $50 PRODUCTION run → free loop → opportunities scored and selected →
 *   WAITING_FOR_OPERATOR actions → approve/complete/result → INTERESTED →
 *   REQUEST_PAYMENT → PAID (provider-verified) → ledger CUSTOMER_PAYMENT →
 *   balance $100, opportunity WON.
 * ========================================================================== */

import { createTestDb } from './lib/d1TestDb';
import worker from '../worker/src/index';
import { D1Repository } from '../src/engine/d1Repository';
import type { Offer, Prospect } from '../src/types';
import { calibrationMultiplier, scoreOpportunity } from '../src/revenue/selector';
import { cleanBusinessName } from '../src/revenue/strategies/webAuraService';

let failures = 0;
const assert = (ok: unknown, label: string) => {
  if (ok) console.log(`  OK: ${label}`);
  else { failures += 1; console.error(`  FAIL: ${label}`); }
};

/* ---- outbound: only the payment provider answers ---- */
let outbound: string[] = [];
const finivexPayments: Record<string, { status: string; amount: number; currency: string }> = {
  'FVX-PENDING': { status: 'PENDING', amount: 50, currency: 'USD' },
  'FVX-PAID-50': { status: 'COMPLETED', amount: 50, currency: 'USD' },
  'FVX-FAILED': { status: 'FAILED', amount: 50, currency: 'USD' },
};
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  outbound.push(url);
  if (url.includes('finivex.test/v1/payments/status')) {
    const tx = new URL(url).searchParams.get('transactionId') ?? '';
    const p = finivexPayments[tx];
    if (!p) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    return new Response(JSON.stringify({ data: { transactionId: tx, ...p } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('blocked in test', { status: 599 });
}) as typeof fetch;

const AGENT = 'agent-survive-01';
const { mf, db } = await createTestDb();
await db.prepare("INSERT INTO agents (id, name) VALUES (?, 'Test')").bind(AGENT).run();

const env: any = {
  DB: db,
  DB_BACKEND: 'd1',
  AGENT_ID: AGENT,
  TRIGGER_SECRET: 'operator-secret-for-tests',
  ADMIN_SECRET: 'admin-secret-for-tests',
  TAVILY_API_KEY: 'tvly-test', // present but unpriced + autonomy off → must never be called
  ANTHROPIC_API_KEY: 'sk-ant-test',
  FINIVEX_BASE_URL: 'https://finivex.test',
  FINIVEX_API_KEY: 'fvx-key',
  FINIVEX_API_SECRET: 'fvx-secret',
};
const ctx: any = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} };
const pending: Promise<unknown>[] = [];
async function call(method: string, path: string, opts: { body?: unknown; token?: string; admin?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.admin) headers['x-admin-secret'] = opts.admin;
  const res = await worker.fetch(new Request(`https://survivor.test${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env, ctx);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

/* ---- seed: the kind of prospects WebAura already discovers ---- */
const repo = new D1Repository(db, AGENT);
await repo.upsertOpportunities([{ id: 'opp-web', name: 'Local websites', category: 'Local / Real-World', tags: [], dataSource: 'LIVE', researchStage: 'RANKED', description: '', howMoneyMade: '', capitalRequiredMin: 0, capitalRequiredMax: 10, timeToRevenueDaysMin: 7, timeToRevenueDaysMax: 30, skills: [], difficulty: 2, competition: 3, scalability: 3, risk: 1, riskLevel: 'Low', geographicRelevance: ['Zimbabwe'], evidenceTier: 'LIKELY', evidenceNotes: '', successProbability: 0.2, revenuePotentialMonthlyMin: 0, revenuePotentialMonthlyMax: 300, upsideNote: '', downsideNote: '', operatingCostsNote: '', examples: [], sources: [], dateResearched: null, executionBlocked: false } as any]);
const now = Date.now();
const mk = (id: string, name: string, phone: string, verification: 'VERIFIED' | 'PROVISIONAL' | null, close: number, extra: Partial<Prospect> = {}): Prospect => ({
  id, opportunityId: 'opp-web', opportunityName: 'Local websites', businessName: name, category: 'Restaurant', location: 'Harare',
  websitePresence: 'SOCIAL_ONLY', socialLinks: ['https://facebook.com/x'], contactChannel: 'PHONE', contactValue: phone, sources: [], evidenceNotes: '', priority: 'HIGH',
  score: { total: 70, factors: [], expectedDealValue: 300, expectedAcquisitionCost: 0, expectedProfit: 300, expectedTimeToRevenueDays: 10, probabilityOfClose: close, expectedValue: 60, scoredAt: now },
  status: 'QUALIFIED', dataSource: 'LIVE', dateDiscovered: now, messagesSentCount: 0, responsesReceivedCount: 0, actualRevenue: 0, notes: [], createdAt: now, updatedAt: now,
  verification: verification ? { status: verification, confidence: verification === 'VERIFIED' ? 90 : 55, businessNameMatchScore: 1, contactMatchScore: 1, independentSources: 2, contactSources: 2, sourceUrls: [], conflictingContacts: [], notes: [], verifiedAt: now } : undefined,
  ...extra,
});
await repo.upsertProspects([
  mk('p-garwe', 'Harare, Zimbabwe - Garwe Restaurant and Events', '+263 77 231 3662', 'VERIFIED', 0.2),
  mk('p-chicken', 'Chicken-Hut Africa', '+263 78 004 5271', 'VERIFIED', 0.15),
  mk('p-topclass', 'Topclass Autobody', '+263716307770', 'PROVISIONAL', 0.2),
  mk('p-extra', 'Mbare Hair Studio', '0773456789', 'VERIFIED', 0.1),
  mk('p-landline', 'Landline Only Lodge', '024 2701234', 'VERIFIED', 0.3),
  mk('p-dnc', 'Do Not Contact Cafe', '0771111111', 'VERIFIED', 0.4, { priority: 'DO_NOT_CONTACT' }),
  mk('p-sample', 'Sample Shop', '0772222222', 'VERIFIED', 0.4, { dataSource: 'SAMPLE' }),
]);
const offer: Offer = { id: 'offer-garwe', prospectId: 'p-garwe', prospectName: 'Garwe', opportunityId: 'opp-web', price: 300, timelineDaysMin: 7, timelineDaysMax: 14, deliverables: ['6-page site', 'menu', 'WhatsApp ordering'], websiteBrief: {} as any, status: 'DRAFT', generator: 'local-rule-engine', generatedAt: now, updatedAt: now };
await repo.upsertOffer(offer);

const login = await call('POST', '/auth/login', { body: { secret: env.TRIGGER_SECRET } });
const token = login.body?.token as string;
const ledgerCount = async () => Number(((await db.prepare('SELECT COUNT(*) n FROM transactions').first()) as any).n);

console.log('--- Pure selector ---');
assert(calibrationMultiplier({ wins: 0, losses: 0, meanPriorOfResolved: 0 }) === 1, 'no outcomes yet → calibration multiplier 1');
assert(calibrationMultiplier({ wins: 0, losses: 5, meanPriorOfResolved: 0.2 }) < 1 && calibrationMultiplier({ wins: 3, losses: 0, meanPriorOfResolved: 0.2 }) > 1, 'losses pull p down, wins pull it up');
const cheap = scoreOpportunity({ value: 100, cost: 0, prior: 0.2, multiplier: 1, available: 40 });
const risky = scoreOpportunity({ value: 100, cost: 20, prior: 0.2, multiplier: 1, available: 40 });
const broke = scoreOpportunity({ value: 1000, cost: 45, prior: 0.5, multiplier: 1, available: 40 });
assert(cheap.score === 20 && risky.score < cheap.score, 'same EV: the one risking more of the $50 scores lower');
assert(!broke.affordable && broke.score === 0, 'cost above risk capital (balance − death − runway reserve) → not affordable, never selected');
assert(cleanBusinessName(mk('x', 'Harare, Zimbabwe - Garwe Restaurant and Events', '0', null, 0)) === 'Garwe Restaurant and Events', 'search-title prefix stripped from the business name');

console.log('--- Access and preconditions ---');
assert((await call('GET', '/revenue/summary')).status === 401, 'revenue summary without auth → 401');
assert((await call('POST', '/revenue/loop/run')).status === 401, 'loop run without auth → 401');
const noRun = await call('POST', '/revenue/loop/run', { token });
assert(noRun.status === 409 && /RUN_NOT_ALIVE/.test(noRun.body?.error), 'no living run → loop refuses (409)');
const run = await call('POST', '/runs', { admin: env.ADMIN_SECRET, body: { environment: 'PRODUCTION', startingCapital: 50, label: 'revenue-first' } });
assert(run.status === 200 && run.body?.run?.status === 'ALIVE', 'admin starts a $50 PRODUCTION run');

console.log('--- Kill switch stops the loop ---');
await call('POST', '/control/kill-switch/engage', { token, body: { reason: 'test' } });
const killed = await call('POST', '/revenue/loop/run', { token });
assert(killed.status === 423 || killed.status === 409 || killed.status === 403, `kill switch engaged → loop refused (${killed.status})`);
assert(Number(((await db.prepare('SELECT COUNT(*) n FROM survivor_opportunities').first()) as any).n) === 0, 'nothing created while stopped');
await call('POST', '/control/kill-switch/release', { admin: env.ADMIN_SECRET, body: { reason: 'test over' } });

console.log('--- Free loop: discover → qualify → score → select → queue ---');
outbound = [];
const ledgerBefore = await ledgerCount();
const loop1 = await call('POST', '/revenue/loop/run', { token });
assert(loop1.status === 200 && loop1.body.queued.length === 3, `loop selects up to capacity (3) and queues 3 human actions (got ${loop1.body?.queued?.length})`);
assert(outbound.length === 0, 'the loop made zero outbound calls (no Tavily, no LLM, no messages)');
assert((await ledgerCount()) === ledgerBefore, 'the loop moved no money');
const spend = (await db.prepare('SELECT COUNT(*) n FROM spend_authorizations').first()) as any;
assert(Number(spend.n) === 0, 'no spend authorizations were requested');
const opps = (await call('GET', '/revenue/opportunities', { token })).body.opportunities as any[];
const byRef = (ref: string) => opps.find((o) => o.sourceRef === ref);
assert(opps.length === 6, 'SAMPLE prospect ignored; 6 LIVE prospects became opportunities');
assert(byRef('p-landline').status === 'DISCOVERED' && /WhatsApp/.test(byRef('p-landline').statusReason), 'landline-only prospect is not qualified (no WhatsApp number)');
assert(byRef('p-dnc').status === 'DISCOVERED', 'DO_NOT_CONTACT prospect is never qualified');
assert(byRef('p-garwe').estimatedValue === 300 && byRef('p-garwe').estimatedCost === 0, 'value comes from the drafted $300 offer; cost $0');
assert(byRef('p-garwe').score > byRef('p-chicken').score && byRef('p-chicken').score > byRef('p-topclass').score, 'ranking: Garwe (60) > Chicken-Hut (45) > Topclass PROVISIONAL (30)');
assert(/score = value \$300 × p 0.2/.test(byRef('p-garwe').scoreExplanation), 'score explanation shows the formula with the numbers');
assert(['p-garwe', 'p-chicken', 'p-topclass'].every((r) => byRef(r).status === 'SELECTED'), 'top 3 are SELECTED');
assert(byRef('p-extra').status === 'QUALIFIED', '4th qualified opportunity waits (capacity 3)');

const actions = (await call('GET', '/revenue/actions', { token })).body.actions as any[];
const actFor = (ref: string, kind = 'CONTACT_PROSPECT') => actions.find((a) => a.opportunityId === byRef(ref).id && a.kind === kind);
const garweContact = actFor('p-garwe');
assert(garweContact.status === 'WAITING_FOR_OPERATOR' && garweContact.requiresHuman === true, 'action is WAITING_FOR_OPERATOR, REQUIRES_HUMAN_ACTION');
assert(!/\$\d/.test(garweContact.payload.message) && /free preview/i.test(garweContact.payload.message), 'first message has no price and offers a free preview');
assert(/^Hi Garwe Restaurant and Events/.test(garweContact.payload.message), 'message greets the clean business name');
assert(/^https:\/\/wa\.me\/263772313662\?text=/.test(garweContact.payload.whatsappUrl), 'wa.me link to the verified number, for the operator to send');

const again = await call('POST', '/revenue/loop/run', { token });
assert(again.status === 200 && again.body.queued.length === 0, 'running again queues nothing new (capacity full, one open action per opportunity)');

console.log('--- Operator: reject, approve, complete, result ---');
const top = actFor('p-topclass');
assert((await call('POST', '/revenue/actions/reject', { token, body: { actionId: top.id, note: 'unverified number' } })).status === 200, 'REJECT');
assert((await call('POST', '/revenue/actions/complete', { token, body: { actionId: garweContact.id } })).status === 409, 'cannot COMPLETE before APPROVE');
assert((await call('POST', '/revenue/actions/approve', { token, body: { actionId: garweContact.id } })).status === 200, 'APPROVE');
assert((await call('POST', '/revenue/actions/complete', { token, body: { actionId: garweContact.id, note: 'sent from my WhatsApp' } })).status === 200, 'COMPLETE (operator sent it)');
const interested = await call('POST', '/revenue/actions/result', { token, body: { actionId: garweContact.id, result: 'INTERESTED', note: 'wants the preview' } });
assert(interested.status === 200 && interested.body.opportunity.status === 'ACTIVE', 'INTERESTED → opportunity ACTIVE');
const payAction = interested.body.next;
assert(payAction?.kind === 'REQUEST_PAYMENT' && payAction.status === 'WAITING_FOR_OPERATOR', 'next action: REQUEST_PAYMENT, waiting for operator');

const chicken = actFor('p-chicken');
await call('POST', '/revenue/actions/approve', { token, body: { actionId: chicken.id } });
await call('POST', '/revenue/actions/complete', { token, body: { actionId: chicken.id } });
const nr1 = await call('POST', '/revenue/actions/result', { token, body: { actionId: chicken.id, result: 'NO_RESPONSE' } });
assert(nr1.body.next?.kind === 'FOLLOW_UP', 'NO_RESPONSE → one FOLLOW_UP queued');
await call('POST', '/revenue/actions/approve', { token, body: { actionId: nr1.body.next.id } });
const nr2 = await call('POST', '/revenue/actions/result', { token, body: { actionId: nr1.body.next.id, result: 'NO_RESPONSE' } });
assert(nr2.body.opportunity.status === 'LOST' && nr2.body.next === null, 'no response after follow-up → LOST');

console.log('--- PAID must be proven by the payment provider ---');
await call('POST', '/revenue/actions/approve', { token, body: { actionId: payAction.id } });
await call('POST', '/revenue/actions/complete', { token, body: { actionId: payAction.id, note: 'sent Finivex link' } });
const before = await ledgerCount();
const noProof = await call('POST', '/revenue/actions/result', { token, body: { actionId: payAction.id, result: 'PAID' } });
assert(noProof.status === 400 && (await ledgerCount()) === before, 'PAID without a provider transaction → 400, no revenue');
const pendingPay = await call('POST', '/revenue/actions/result', { token, body: { actionId: payAction.id, result: 'PAID', payment: { transactionId: 'FVX-PENDING', amount: 50, currency: 'USD' } } });
assert(pendingPay.status === 202 && (await ledgerCount()) === before, 'provider says PENDING → 202, no revenue');
const failedPay = await call('POST', '/revenue/actions/result', { token, body: { actionId: payAction.id, result: 'PAID', payment: { transactionId: 'FVX-FAILED', amount: 50, currency: 'USD' } } });
assert(failedPay.status === 409 && (await ledgerCount()) === before, 'provider says FAILED → 409, no revenue');
const wrongAmt = await call('POST', '/revenue/actions/result', { token, body: { actionId: payAction.id, result: 'PAID', payment: { transactionId: 'FVX-PAID-50', amount: 300, currency: 'USD' } } });
assert(wrongAmt.status === 409 && (await ledgerCount()) === before, 'claimed $300 but provider confirmed $50 → 409, no revenue');
const fake = await call('POST', '/revenue/actions/result', { token, body: { actionId: payAction.id, result: 'PAID', payment: { transactionId: 'MADE-UP', amount: 50, currency: 'USD' } } });
assert(fake.status === 409 && (await ledgerCount()) === before, 'unknown transaction → 409, no revenue');

outbound = [];
const paid = await call('POST', '/revenue/actions/result', { token, body: { actionId: payAction.id, result: 'PAID', note: 'deposit', payment: { transactionId: 'FVX-PAID-50', amount: 50, currency: 'USD' } } });
assert(paid.status === 200 && paid.body.opportunity.status === 'WON', 'provider COMPLETED $50 → opportunity WON');
assert(outbound.length === 1 && outbound[0].includes('finivex.test/v1/payments/status?transactionId=FVX-PAID-50'), 'Survivor asked Finivex itself (one status call)');
const entry: any = await db.prepare("SELECT * FROM transactions WHERE kind = 'CUSTOMER_PAYMENT'").first();
assert(entry && entry.amount === 50 && entry.idempotency_key === 'revenue:FINIVEX_PROVIDER:FVX-PAID-50' && entry.recorded_by === 'verifier:FINIVEX_PROVIDER', 'ledger: CUSTOMER_PAYMENT $50, key revenue:FINIVEX_PROVIDER:<tx>, recorded by the verifier');
const verification: any = await db.prepare("SELECT * FROM revenue_verifications WHERE external_reference = 'FVX-PAID-50' AND status = 'VERIFIED'").first();
assert(verification && verification.revenue_entry_id === `opp:${byRef('p-garwe').id}`, 'verification evidence stored for the opportunity');

const summary = (await call('GET', '/revenue/summary', { token })).body;
assert(summary.balance === 100 && summary.revenue === 50 && summary.profit === 50 && summary.expenses === 0, `treasury: $50 → $100, revenue $50, profit $50 (balance ${summary.balance})`);
assert(summary.counts.WON === 1 && summary.counts.LOST === 1 && summary.counts.ABANDONED === 1, 'counts: 1 WON, 1 LOST, 1 ABANDONED');
assert(summary.calibration.resolvedActions === 4 && summary.calibration.actualPositiveRate === 0.5, 'predicted vs actual recorded (4 resolved, 50% positive)');
assert(/Verified revenue \$50\.00/.test(summary.mission), `mission reflects verified revenue: "${summary.mission}"`);

console.log('--- One payment counts once ---');
const loop2 = await call('POST', '/revenue/loop/run', { token });
const newAction = loop2.body.queued?.[0];
assert(loop2.status === 200 && newAction, 'capacity freed → loop selects the next opportunity');
const opps2 = (await call('GET', '/revenue/opportunities', { token })).body.opportunities as any[];
const extra = opps2.find((o: any) => o.sourceRef === 'p-extra');
// m = ((1 + 5·0.175) / (2 + 5)) / 0.175 = 1.531 (one win, one loss, mean prior 0.175)
assert(extra.status === 'SELECTED' && /calibration 1\.531\]/.test(extra.scoreExplanation), `calibration from real outcomes: ${extra.scoreExplanation}`);
if (newAction) {
  await call('POST', '/revenue/actions/approve', { token, body: { actionId: newAction.id } });
  const reuse = await call('POST', '/revenue/actions/result', { token, body: { actionId: newAction.id, result: 'PAID', payment: { transactionId: 'FVX-PAID-50', amount: 50, currency: 'USD' } } });
  assert(reuse.status === 409 && /already credited/.test(reuse.body.error), 'the same Finivex transaction cannot be credited for a second opportunity');
}
assert((await call('GET', '/ledger', { token })).body.snapshot.balance === 100, 'balance still $100');

console.log('--- Cron runs the free loop; autonomous paid calls stay OFF ---');
outbound = [];
await worker.scheduled({} as any, env, ctx);
await Promise.all(pending);
assert(!outbound.some((u) => /tavily|anthropic|brave/i.test(u)), 'cron: zero Tavily/Anthropic/Brave calls');
const health = await call('GET', '/health');
assert(health.body?.connectors?.spending?.autonomousPaidCalls === false, '/health: autonomousPaidCalls = false');
const transitions = Number(((await db.prepare('SELECT COUNT(*) n FROM survivor_transitions').first()) as any).n);
assert(transitions > 10, `every state change is logged (${transitions} transitions)`);

await mf.dispose();
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
