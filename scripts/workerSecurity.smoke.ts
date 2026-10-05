/* ============================================================================
 * Phase 0 verification: the real Worker fetch handler against a local D1
 * with the production schema/migrations. Every outbound HTTP call is
 * intercepted and counted — an outbound call is a paid operation.
 *   7 unauthorized paid endpoints → 401, zero paid calls
 *   8 /state and friends without auth → 401, no PII
 *   + route policy, login rate limit, admin-only routes, kill switch,
 *     metered + capped + rate-limited manual research, dead-run behaviour.
 * ========================================================================== */

import { createTestDb } from './lib/d1TestDb';
import worker from '../worker/src/index';
import { D1Repository } from '../src/engine/d1Repository';
import { D1LedgerStore } from '../src/economy/d1LedgerStore';
import { Treasury } from '../src/economy/treasury';
import type { Prospect } from '../src/types';
import { ROUTE_POLICIES, routePolicy } from '../worker/src/security';

let failures = 0;
const assert = (ok: unknown, label: string) => {
  if (ok) console.log(`  OK: ${label}`);
  else { failures += 1; console.error(`  FAIL: ${label}`); }
};

/* ---- outbound network: count every call, answer Tavily/Anthropic ---- */
let outbound: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  outbound.push(url);
  if (url.includes('api.tavily.com')) {
    return new Response(JSON.stringify({ results: [{ title: 'Secret Salon Harare | Facebook', url: 'https://facebook.com/secretsalon', content: 'Secret Salon Harare. Call 0771234567.' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('api.anthropic.com')) {
    return new Response(JSON.stringify({ content: [{ text: '{}' }], usage: { input_tokens: 1000, output_tokens: 100 } }), { status: 200 });
  }
  return new Response('not found', { status: 404 });
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
  TAVILY_API_KEY: 'tvly-test',
  TAVILY_USD_PER_CREDIT: '0.008', // test fixture, not a real plan price
  ANTHROPIC_API_KEY: 'sk-ant-test',
  MANUAL_PAID_REQUESTS_PER_HOUR: '3',
};
const ctx: any = { waitUntil: () => {}, passThroughOnException: () => {} };
async function call(method: string, path: string, opts: { body?: unknown; token?: string; admin?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cf-connecting-ip': opts.ip ?? '203.0.113.7' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.admin) headers['x-admin-secret'] = opts.admin;
  const res = await worker.fetch(new Request(`https://survivor.test${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env, ctx);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
}

/* ---- seed: a real-looking prospect with PII, and a production run ---- */
const repo = new D1Repository(db, AGENT);
const treasury = new Treasury(new D1LedgerStore(db, AGENT), AGENT);
await repo.upsertOpportunities([{ id: 'opp-1', name: 'Local websites', category: 'Local / Real-World', tags: [], dataSource: 'LIVE', researchStage: 'RANKED', description: '', howMoneyMade: '', capitalRequiredMin: 0, capitalRequiredMax: 10, timeToRevenueDaysMin: 7, timeToRevenueDaysMax: 30, skills: [], difficulty: 2, competition: 3, scalability: 3, risk: 1, riskLevel: 'Low', geographicRelevance: ['Zimbabwe'], evidenceTier: 'LIKELY', evidenceNotes: '', successProbability: 0.2, revenuePotentialMonthlyMin: 0, revenuePotentialMonthlyMax: 300, upsideNote: '', downsideNote: '', operatingCostsNote: '', examples: [], sources: [], dateResearched: null, executionBlocked: false } as any]);
const now = Date.now();
const prospect: Prospect = {
  id: 'p-pii', opportunityId: 'opp-1', opportunityName: 'Local websites', businessName: 'Secret Salon', category: 'Salon', location: 'Harare',
  websitePresence: 'SOCIAL_ONLY', socialLinks: [], contactChannel: 'PHONE', contactValue: '0771234567', sources: [], evidenceNotes: '', priority: 'HIGH',
  score: { total: 70, factors: [], expectedDealValue: 150, expectedAcquisitionCost: 5, expectedProfit: 100, expectedTimeToRevenueDays: 10, probabilityOfClose: 0.2, expectedValue: 20, scoredAt: now },
  status: 'QUALIFIED', dataSource: 'LIVE', dateDiscovered: now, messagesSentCount: 0, responsesReceivedCount: 0, actualRevenue: 0, notes: [], createdAt: now, updatedAt: now,
};
await repo.upsertProspects([prospect]);
await treasury.createRun({ environment: 'PRODUCTION', startingCapital: 50, createdBy: 'test' });

console.log('--- Route policy table ---');
assert(ROUTE_POLICIES.filter((p) => p.access === 'PUBLIC').map((p) => p.path).sort().join(',') === '/auth/login,/demo/,/health', 'only /health, /auth/login and /demo/* are public');
assert(routePolicy('GET', '/state')?.access === 'OPERATOR' && routePolicy('GET', '/anything-new-under/prospects')?.access === undefined, '/state is operator-only; non-API paths have no API policy');
assert(routePolicy('POST', '/prospects/something-new')?.access === 'OPERATOR', 'an unlisted API route defaults to OPERATOR, never public');
assert(routePolicy('POST', '/treasury/policy')?.access === 'ADMIN' && routePolicy('POST', '/treasury/spend-request')?.access === 'OPERATOR', 'exact admin rules win over operator prefixes');

console.log('--- Scenario 7: paid endpoints without authorization ---');
for (const path of ['/prospects/research', '/prospects/research/full', '/prospects/verify', '/prospects/discover', '/income/research', '/income/strategy']) {
  outbound = [];
  const r = await call('POST', path, { body: { prospectId: 'p-pii' } });
  assert((r.status === 401 || r.status === 403) && outbound.length === 0, `POST ${path} → ${r.status}, ${outbound.length} paid call(s)`);
}
outbound = [];
assert((await call('POST', '/cycles/run')).status === 401 && outbound.length === 0, 'POST /cycles/run without admin → 401, no paid call');
const ledgerAfterProbe = await treasury.entries();
assert(ledgerAfterProbe.length === 1, 'no cost was booked by any unauthorized request');

console.log('--- Scenario 8: state without authorization ---');
for (const path of ['/state', '/status', '/treasury', '/ledger', '/runs', '/content/state', '/payments/requests', '/payments/finivex/status', '/real-revenue/verifications', '/control/kill-switch']) {
  const r = await call('GET', path);
  const leaks = /Secret Salon|0771234567|balance/i.test(r.text);
  assert((r.status === 401 || r.status === 403) && !leaks, `GET ${path} → ${r.status}, no PII or balance in body`);
}
const health = await call('GET', '/health');
assert(health.status === 200 && !/Secret Salon|0771234567|"balance"/.test(health.text), 'GET /health stays public and carries no PII or balance');
assert(health.body?.ready === true, `/health reports the schema ready (${JSON.stringify(health.body?.schema?.missingTables)})`);
assert((await call('POST', '/state')).status === 401 && (await call('POST', '/not-a-route')).status === 404, 'unknown/unsupported methods are refused');

console.log('--- Authentication ---');
let lastLogin = await call('POST', '/auth/login', { body: { secret: 'wrong' }, ip: '198.51.100.9' });
for (let i = 0; i < 10; i++) lastLogin = await call('POST', '/auth/login', { body: { secret: 'wrong' }, ip: '198.51.100.9' });
assert(lastLogin.status === 429, 'repeated failed logins from one client are rate limited (429)');
const login = await call('POST', '/auth/login', { body: { secret: env.TRIGGER_SECRET } });
const token = login.body?.token as string;
assert(login.status === 200 && typeof token === 'string', 'operator login issues a session token');
const state = await call('GET', '/state', { token });
assert(state.status === 200 && state.body?.run?.run?.status === 'ALIVE' && state.body?.run?.balance === 50, 'authenticated /state works and reports the run and its $50 balance');
assert((await call('POST', '/cycles/run', { token })).status === 403, 'an operator session is not an admin credential (403, not a session error)');
assert((await call('POST', '/treasury/record-capital', { token, body: { amount: 100 } })).status === 410, 'record-capital is retired (410): no deposits into a run');

console.log('--- Metered manual research ---');
outbound = [];
const research = await call('POST', '/prospects/verify', { token, body: { prospectId: 'p-pii' } });
const searchEntries = (await treasury.entries()).filter((e) => e.kind === 'SEARCH_EXPENSE');
assert(research.status === 200 && outbound.some((u) => u.includes('tavily')), 'authorized verification runs real (stubbed) searches');
assert(searchEntries.length > 0 && searchEntries.every((e) => e.metadata.channel === 'MANUAL' && e.metadata.provider === 'tavily' && e.metadata.initiatedBy === 'OPERATOR' && Math.abs(e.amount + 0.008 * Number(e.metadata.units)) < 1e-9), `each search is booked as its own SEARCH_EXPENSE at credits × price, initiated_by OPERATOR (${searchEntries.length} entries)`);
const booked = searchEntries.reduce((x, e) => x + e.amount, 0);
const balanceAfter = (await treasury.balance());
assert(Math.abs(balanceAfter - (50 + booked)) < 1e-9, `balance moved from $50 to $${balanceAfter.toFixed(3)} through recorded transactions only`);
await call('POST', '/prospects/verify', { token, body: { prospectId: 'p-pii' } });
await call('POST', '/prospects/verify', { token, body: { prospectId: 'p-pii' } });
outbound = [];
const limited = await call('POST', '/prospects/verify', { token, body: { prospectId: 'p-pii' } });
assert(limited.status === 429 && outbound.length === 0, 'the 4th paid request in an hour is rate limited (429) before any paid call');

console.log('--- Kill switch ---');
const engaged = await call('POST', '/control/kill-switch/engage', { token, body: { reason: 'test emergency' } });
assert(engaged.status === 200 && engaged.body?.killSwitch?.engaged === true, 'an operator can engage the kill switch');
outbound = [];
const blockedResearch = await call('POST', '/prospects/research', { token, body: { prospectId: 'p-pii' } });
assert(blockedResearch.status === 503 && outbound.length === 0, 'paid research is refused while engaged (503, no paid call)');
const blockedExpense = await call('POST', '/treasury/spend-request', { token, body: { vendor: 'namecheap', amount: 1, purpose: 'x', category: 'domain' } });
assert(blockedExpense.status === 503, 'financial actions are refused while engaged');
const blockedCycle = await call('POST', '/cycles/run', { admin: env.ADMIN_SECRET });
assert((blockedCycle.status === 503 || blockedCycle.status === 409) && /KILL_SWITCH/.test(`${blockedCycle.body?.code ?? ''} ${blockedCycle.body?.reason ?? ''}`), `manual cycles are refused while engaged (${blockedCycle.status})`);
let cronRan = false;
await worker.scheduled({} as any, env, { waitUntil: (p: Promise<unknown>) => { cronRan = true; return p; } } as any);
await new Promise((r) => setTimeout(r, 200));
const lastCycle = JSON.parse((await repo.getKV('runtime:last_cycle')) ?? '{}');
assert(cronRan && lastCycle.status === 'REJECTED' && lastCycle.rejected === 'KILL_SWITCH_ENGAGED', 'the cron cycle is refused too');
assert((await call('POST', '/control/kill-switch/release', { token })).status === 403, 'an operator cannot release it');
const released = await call('POST', '/control/kill-switch/release', { admin: env.ADMIN_SECRET, body: { reason: 'test over' } });
assert(released.status === 200 && released.body?.killSwitch?.engaged === false, 'admin releases it');

console.log('--- Admin credential implies operator ---');
const policyUpdate = await call('POST', '/treasury/policy', { admin: env.ADMIN_SECRET, body: { protectedReserve: 0 } });
assert(policyUpdate.status === 200 && policyUpdate.body?.policy?.protectedReserve === 0, 'admin can update treasury policy (handler accepts the admin credential)');
assert((await call('POST', '/treasury/policy', { token, body: { protectedReserve: 0 } })).status === 403, 'an operator session cannot change spending policy');

console.log('--- Dead run over HTTP ---');
const killRun = await treasury.recordOperatorExpense({ requestId: 'drain', amount: await treasury.balance(), vendor: 'test', purpose: 'drain to zero', recordedBy: 'test' });
assert(killRun.status === 'POSTED' && killRun.runStatus === 'DEAD', 'run drained to $0 → DEAD');
const deadCycle = await call('POST', '/cycles/run', { admin: env.ADMIN_SECRET });
assert(deadCycle.status === 409 && /RUN_DEAD/.test(deadCycle.body?.reason ?? ''), 'POST /cycles/run → 409 RUN_DEAD');
outbound = [];
const deadResearch = await call('POST', '/prospects/verify', { token, body: { prospectId: 'p-pii' } });
assert(deadResearch.status === 409 && outbound.length === 0, 'paid research on a dead run → 409, no paid call');
const newRun = await call('POST', '/runs', { admin: env.ADMIN_SECRET, body: { environment: 'PRODUCTION', startingCapital: 50, label: 'second experiment' } });
assert(newRun.status === 200 && newRun.body?.run?.status === 'ALIVE', 'admin starts a new experiment explicitly (POST /runs)');
assert((await call('POST', '/runs', { token, body: { environment: 'PRODUCTION', startingCapital: 999 } })).status === 403, 'operators cannot create runs (no self-funding)');

await mf.dispose();
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
