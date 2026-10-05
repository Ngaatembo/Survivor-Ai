/* ============================================================================
 * Tavily spend incident (5 Oct 2026) — containment tests.
 * The real Worker fetch/scheduled handlers run against a local D1 built from
 * the production schema + migrations. Every outbound request to
 * api.tavily.com is counted: a counted request is a (potentially) billed one.
 *   A autonomy disabled → cycle makes NO Tavily request
 *   B kill switch       → NO Tavily request (cycle and operator)
 *   C dead run          → NO Tavily request
 *   D daily cap used up → NO Tavily request
 *   E concurrency       → authorized spend ≤ limit
 *   F gate failure      → NO Tavily request
 *   G duplicate/retry   → no duplicate charge
 *   + pricing unknown, runway reserve, provenance, 2-credit advanced pricing
 * The Tavily price used here (0.008 USD/credit) is a TEST FIXTURE, not a
 * statement about any account's real price.
 * ========================================================================== */

import { createTestDb } from './lib/d1TestDb';
import worker from '../worker/src/index';
import { D1Repository } from '../src/engine/d1Repository';
import { D1LedgerStore } from '../src/economy/d1LedgerStore';
import { Treasury } from '../src/economy/treasury';
import { D1SpendGate } from '../src/economy/spendGate';
import { setKillSwitch } from '../src/economy/killSwitch';
import type { Prospect } from '../src/types';

let failures = 0;
const assert = (ok: unknown, label: string) => {
  if (ok) console.log(`  OK: ${label}`);
  else { failures += 1; console.error(`  FAIL: ${label}`); }
};

let tavilyCalls = 0;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('api.tavily.com')) {
    tavilyCalls += 1;
    await new Promise((r) => setTimeout(r, 5)); // let concurrent requests interleave
    return new Response(JSON.stringify({ results: [{ title: 'Harare Salon | Facebook', url: 'https://facebook.com/hararesalon', content: 'Harare Salon, Harare. Call 0771234567.' }] }), { status: 200 });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const AGENT = 'agent-survive-01';
const TEST_PRICE_PER_CREDIT = '0.008';
const ctx: any = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {} };

async function setup(extraEnv: Record<string, string> = {}, run: { startingCapital?: number } = {}) {
  const t = await createTestDb();
  await t.db.prepare("INSERT INTO agents (id, name) VALUES (?, 'Test')").bind(AGENT).run();
  const env: any = {
    DB: t.db, DB_BACKEND: 'd1', AGENT_ID: AGENT,
    TRIGGER_SECRET: 'op-secret', ADMIN_SECRET: 'admin-secret',
    TAVILY_API_KEY: 'tvly-test', TAVILY_USD_PER_CREDIT: TEST_PRICE_PER_CREDIT,
    MANUAL_PAID_REQUESTS_PER_HOUR: '1000',
    ...extraEnv,
  };
  for (const [k, v] of Object.entries(extraEnv)) if (v === '__unset__') delete env[k];
  const repo = new D1Repository(t.db, AGENT);
  const treasury = new Treasury(new D1LedgerStore(t.db, AGENT), AGENT);
  const now = Date.now();
  await repo.upsertOpportunities([{ id: 'opp-1', name: 'Local websites', category: 'Local / Real-World', tags: [], dataSource: 'LIVE', researchStage: 'RANKED', description: '', howMoneyMade: '', capitalRequiredMin: 0, capitalRequiredMax: 10, timeToRevenueDaysMin: 7, timeToRevenueDaysMax: 30, skills: [], difficulty: 2, competition: 3, scalability: 3, risk: 1, riskLevel: 'Low', geographicRelevance: ['Zimbabwe'], evidenceTier: 'LIKELY', evidenceNotes: '', successProbability: 0.2, revenuePotentialMonthlyMin: 0, revenuePotentialMonthlyMax: 300, upsideNote: '', downsideNote: '', operatingCostsNote: '', examples: [], sources: [], dateResearched: null, executionBlocked: false } as any]);
  const prospects: Prospect[] = Array.from({ length: 12 }, (_, i) => ({
    id: `p-${i}`, opportunityId: 'opp-1', opportunityName: 'Local websites', businessName: `Harare Salon ${i}`, category: 'Salon', location: 'Harare',
    websitePresence: 'SOCIAL_ONLY', socialLinks: [], contactChannel: 'PHONE', contactValue: '0771234567', sources: [], evidenceNotes: '', priority: 'HIGH',
    score: { total: 70, factors: [], expectedDealValue: 150, expectedAcquisitionCost: 5, expectedProfit: 100, expectedTimeToRevenueDays: 10, probabilityOfClose: 0.2, expectedValue: 20, scoredAt: now },
    status: 'QUALIFIED', dataSource: 'LIVE', dateDiscovered: now, messagesSentCount: 0, responsesReceivedCount: 0, actualRevenue: 0, notes: [], createdAt: now, updatedAt: now,
  }));
  await repo.upsertProspects(prospects);
  await treasury.createRun({ environment: 'PRODUCTION', startingCapital: run.startingCapital ?? 50, createdBy: 'test' });
  const call = async (method: string, path: string, body?: unknown, auth: 'op' | 'admin' = 'op') => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth === 'admin') headers['x-admin-secret'] = env.ADMIN_SECRET;
    else {
      const login = await worker.fetch(new Request('https://t/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `ip-${Math.random()}` }, body: JSON.stringify({ secret: env.TRIGGER_SECRET }) }), env, ctx);
      headers.authorization = `Bearer ${((await login.json()) as any).token}`;
    }
    const res = await worker.fetch(new Request(`https://t${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    let json: any = null; try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
  };
  const auths = async () => (await t.db.prepare('SELECT * FROM spend_authorizations ORDER BY created_at').all()).results as any[];
  return { ...t, env, repo, treasury, call, auths };
}

console.log('--- Test A: Survivor cycle while autonomous spending is disabled (default) ---');
{
  const s = await setup();
  tavilyCalls = 0;
  const r = await s.call('POST', '/cycles/run', undefined, 'admin');
  assert(r.status === 200, `cycle ran (${r.status})`);
  assert(tavilyCalls === 0, `NO Tavily request (${tavilyCalls})`);
  assert((await s.auths()).length === 0, 'no spend authorization was even requested successfully');
  const events = await s.repo.listEvents();
  assert(events.some((e) => /AUTONOMY_DISABLED/.test(e.message)), 'the cycle log shows the refusal reason (AUTONOMY_DISABLED)');
  const health = await s.call('GET', '/health');
  assert(health.body?.connectors?.spending?.autonomousPaidCalls === false, '/health reports autonomousPaidCalls=false');
  await s.mf.dispose();
}

console.log('--- Autonomy explicitly enabled: bounded by the per-cycle cap, fully recorded ---');
{
  const s = await setup({ AUTONOMOUS_PAID_CALLS: 'enabled' });
  tavilyCalls = 0;
  await s.call('POST', '/cycles/run', undefined, 'admin');
  const rows = (await s.auths()).filter((a) => a.status !== 'RELEASED');
  const authorized = rows.reduce((x, a) => x + Number(a.amount_actual ?? a.amount_reserved), 0);
  assert(tavilyCalls > 0 && tavilyCalls === rows.length, `every Tavily request had an authorization (${tavilyCalls} requests, ${rows.length} authorizations)`);
  assert(authorized <= 0.1 + 1e-9, `cycle spend $${authorized.toFixed(3)} ≤ per-cycle cap $0.10`);
  assert(rows.every((a) => a.initiated_by === 'SURVIVOR' && a.channel === 'AUTO'), 'provenance: initiated_by = SURVIVOR');
  const entries = (await s.treasury.entries()).filter((e) => e.kind === 'SEARCH_EXPENSE');
  assert(entries.length === tavilyCalls && entries.every((e) => e.metadata.authorizationId && e.metadata.initiatedBy === 'SURVIVOR'), 'each request has exactly one ledger expense linked to its authorization');
  const advanced = entries.find((e) => e.metadata.units === 2);
  assert(advanced && Math.abs(advanced.amount + 0.016) < 1e-9, 'advanced search is costed at 2 credits (2 × test price)');
  await s.mf.dispose();
}

console.log('--- Test B: kill switch engaged ---');
{
  const s = await setup({ AUTONOMOUS_PAID_CALLS: 'enabled' });
  await setKillSwitch(s.repo, true, 'incident', 'test');
  tavilyCalls = 0;
  const cycle = await s.call('POST', '/cycles/run', undefined, 'admin');
  const manual = await s.call('POST', '/prospects/verify', { prospectId: 'p-1' });
  assert(tavilyCalls === 0, `NO Tavily request (cycle ${cycle.status}, operator ${manual.status})`);
  // Even with every other check passing, the gate itself reads the switch.
  const gate = new D1SpendGate(s.db, AGENT, s.treasury);
  const run = (await s.treasury.getOpenRun())!;
  const direct = await gate.reserve({ idempotencyKey: 'k-direct', runId: run.id, initiatedBy: 'OPERATOR', channel: 'MANUAL', provider: 'tavily', operation: 'q', units: 2, unit: 'tavily_credit', amountUsd: 0.016, sessionId: 's', reason: 'test', limits: { perCallUsd: 1, perSessionUsd: 1, channelDailyUsd: 1, totalDailyUsd: 1, runwayReserveUsd: 0 } });
  assert(!direct.ok && direct.code === 'KILL_SWITCH', 'the atomic gate refuses on its own when the switch is engaged');
  await s.mf.dispose();
}

console.log('--- Test C: run DEAD ---');
{
  const s = await setup({ AUTONOMOUS_PAID_CALLS: 'enabled' });
  await s.treasury.recordOperatorExpense({ requestId: 'drain', amount: 50, vendor: 'test', purpose: 'drain', recordedBy: 'test' });
  tavilyCalls = 0;
  const cycle = await s.call('POST', '/cycles/run', undefined, 'admin');
  const manual = await s.call('POST', '/prospects/verify', { prospectId: 'p-1' });
  assert(tavilyCalls === 0 && cycle.status === 409 && manual.status === 409, `NO Tavily request (cycle ${cycle.status}, operator ${manual.status})`);
  await s.mf.dispose();
}

console.log('--- Test D: daily limit exhausted ---');
{
  const s = await setup({ MANUAL_DAILY_CAP_USD: '0.016', TOTAL_DAILY_CAP_USD: '0.016' });
  tavilyCalls = 0;
  await s.call('POST', '/prospects/verify', { prospectId: 'p-1' });
  const afterFirst = tavilyCalls;
  await s.call('POST', '/prospects/verify', { prospectId: 'p-2' });
  await s.call('POST', '/prospects/verify', { prospectId: 'p-3' });
  const authorized = (await s.auths()).filter((a) => a.status !== 'RELEASED').reduce((x, a) => x + Number(a.amount_actual ?? a.amount_reserved), 0);
  assert(afterFirst >= 1 && tavilyCalls === afterFirst, `after the cap is used, NO further Tavily request (${afterFirst} then ${tavilyCalls - afterFirst})`);
  assert(authorized <= 0.016 + 1e-9, `authorized $${authorized.toFixed(3)} ≤ daily cap $0.016`);
  await s.mf.dispose();
}

console.log('--- Test E: concurrent requests try to exceed the limit ---');
{
  const s = await setup({ MANUAL_DAILY_CAP_USD: '0.05', TOTAL_DAILY_CAP_USD: '0.05' });
  tavilyCalls = 0;
  await Promise.all(Array.from({ length: 10 }, (_, i) => s.call('POST', '/prospects/verify', { prospectId: `p-${i}` })));
  const rows = (await s.auths()).filter((a) => a.status !== 'RELEASED');
  const authorized = rows.reduce((x, a) => x + Number(a.amount_actual ?? a.amount_reserved), 0);
  assert(authorized <= 0.05 + 1e-9, `10 concurrent requests: authorized $${authorized.toFixed(3)} ≤ $0.05`);
  assert(tavilyCalls === rows.length, `Tavily requests (${tavilyCalls}) = authorizations (${rows.length})`);
  const spentByLedger = -(await s.treasury.entries()).filter((e) => e.kind === 'SEARCH_EXPENSE').reduce((x, e) => x + e.amount, 0);
  assert(Math.abs(spentByLedger - authorized) < 1e-9, `ledger expenses ($${spentByLedger.toFixed(3)}) equal authorized spend`);
  await s.mf.dispose();
}

console.log('--- Test F: the authorization step itself fails ---');
{
  const s = await setup();
  await s.db.prepare("CREATE TRIGGER t_fail BEFORE INSERT ON spend_authorizations BEGIN SELECT RAISE(ABORT, 'simulated authorization failure'); END").run();
  tavilyCalls = 0;
  const r = await s.call('POST', '/prospects/verify', { prospectId: 'p-1' });
  assert(tavilyCalls === 0, `NO Tavily request when authorization cannot be written (${r.status})`);
  await s.mf.dispose();
}

console.log('--- Test G: duplicate / retried request ---');
{
  const s = await setup();
  const gate = new D1SpendGate(s.db, AGENT, s.treasury);
  const run = (await s.treasury.getOpenRun())!;
  const req = { idempotencyKey: 'session-x:1', runId: run.id, initiatedBy: 'OPERATOR' as const, channel: 'MANUAL' as const, provider: 'tavily', operation: 'q', units: 2, unit: 'tavily_credit', amountUsd: 0.016, sessionId: 'session-x', reason: 'retry test', limits: { perCallUsd: 1, perSessionUsd: 1, channelDailyUsd: 1, totalDailyUsd: 1, runwayReserveUsd: 0 } };
  const first = await gate.reserve(req);
  const retry = await gate.reserve(req);
  assert(first.ok && !retry.ok && retry.code === 'DUPLICATE', 'a retried authorization is refused as DUPLICATE (caller must not call again)');
  if (first.ok) {
    await gate.settle(first.id, 0.016, { kind: 'SEARCH_EXPENSE', description: 'once', metadata: {} });
    await gate.settle(first.id, 0.016, { kind: 'SEARCH_EXPENSE', description: 'twice', metadata: {} });
  }
  const charges = (await s.treasury.entries()).filter((e) => e.kind === 'SEARCH_EXPENSE');
  assert(charges.length === 1 && charges[0].amount === -0.016, 'settling twice posts ONE charge');
  await s.mf.dispose();
}

console.log('--- Pricing unknown ---');
{
  const s = await setup({ TAVILY_USD_PER_CREDIT: '__unset__', AUTONOMOUS_PAID_CALLS: 'enabled' });
  tavilyCalls = 0;
  await s.call('POST', '/prospects/verify', { prospectId: 'p-1' });
  await s.call('POST', '/cycles/run', undefined, 'admin');
  assert(tavilyCalls === 0, 'no configured Tavily price → NO Tavily request (operator or cycle)');
  assert((await s.call('GET', '/health')).body?.connectors?.spending?.tavilyPriced === false, '/health reports tavilyPriced=false');
  await s.mf.dispose();
}

console.log('--- Runway reserve (balance $12, spend $4, reserve $10 → denied) ---');
{
  const s = await setup({}, { startingCapital: 12 });
  const gate = new D1SpendGate(s.db, AGENT, s.treasury);
  const run = (await s.treasury.getOpenRun())!;
  const base = { runId: run.id, initiatedBy: 'OPERATOR' as const, channel: 'MANUAL' as const, provider: 'tavily', operation: 'q', units: 1, unit: 'x', sessionId: 'rw', reason: 'runway', limits: { perCallUsd: 5, perSessionUsd: 5, channelDailyUsd: 5, totalDailyUsd: 5, runwayReserveUsd: 10 } };
  const denied = await gate.reserve({ ...base, idempotencyKey: 'rw1', amountUsd: 4 });
  assert(!denied.ok && denied.code === 'RUNWAY', '$12 − $4 = $8 < $10 reserve → REQUEST DENIED');
  const allowed = await gate.reserve({ ...base, idempotencyKey: 'rw2', amountUsd: 1.5 });
  assert(allowed.ok, '$12 − $1.50 = $10.50 ≥ $10 → allowed');
  const second = await gate.reserve({ ...base, idempotencyKey: 'rw3', amountUsd: 1.5 });
  assert(!second.ok && second.code === 'RUNWAY', 'unsettled reservations count: a second $1.50 would breach the reserve → denied');
  await s.mf.dispose();
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
