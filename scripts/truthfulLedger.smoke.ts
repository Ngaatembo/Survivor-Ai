/* ============================================================================
 * Phase 1 verification: the truthful ledger on a real local D1 database with
 * the production schema, migrations 0021/0022 and their triggers.
 *   1 start  2 expense  3 verified revenue  4 death  5 no resurrection
 *   6 duplicates   + database guards, concurrency, legacy backfill,
 *   and simulated-memory quarantine in a real engine cycle.
 * ========================================================================== */

import { createTestDb } from './lib/d1TestDb';
import { D1LedgerStore } from '../src/economy/d1LedgerStore';
import { Treasury } from '../src/economy/treasury';
import { D1Repository } from '../src/engine/d1Repository';
import { AgentEngine } from '../src/engine/agentEngine';
import { realExperience } from '../src/services/memory';
import { SAMPLE_OPPORTUNITIES } from '../src/data/sampleData';
import { scoreOpportunity } from '../src/lib/scoring';

let failures = 0;
const assert = (ok: unknown, label: string) => {
  if (ok) console.log(`  OK: ${label}`);
  else { failures += 1; console.error(`  FAIL: ${label}`); }
};
async function rejects(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { return (e as Error).message; }
}

const AGENT = 'agent-survive-01';
const { mf, db } = await createTestDb();
await db.prepare("INSERT INTO agents (id, name) VALUES (?, 'Test')").bind(AGENT).run();
const treasury = new Treasury(new D1LedgerStore(db, AGENT), AGENT);
const repo = new D1Repository(db, AGENT);

console.log('--- Scenario 1: start a $50 run ---');
const { run, capital } = await treasury.createRun({ environment: 'TEST', startingCapital: 50, createdBy: 'test', label: 'scenario run' });
assert(capital.status === 'POSTED', 'starting capital posted as a ledger entry');
assert((await treasury.balance()) === 50, 'balance = $50 (derived from the ledger)');
assert((await treasury.getOpenRun())?.status === 'ALIVE', 'status = ALIVE');
const legacyView = await repo.listTransactions();
assert(legacyView.length === 1 && legacyView[0].kind === 'STARTING_CAPITAL' && legacyView[0].type === 'DEPOSIT', 'repository ledger view shows the run’s single STARTING_CAPITAL entry');
assert(!!(await rejects(repo.appendTransaction(legacyView[0]))), 'direct repository ledger writes are disabled');

console.log('--- Scenario 2: expense ---');
const exp = await treasury.recordOperatorExpense({ requestId: 'spend-1', amount: 5, vendor: 'namecheap', purpose: 'domain', recordedBy: 'test' });
assert(exp.status === 'POSTED' && exp.entry.kind === 'OPERATOR_EXPENSE' && exp.entry.amount === -5, 'expense posted as a -$5.00 OPERATOR_EXPENSE');
assert((await treasury.balance()) === 45, 'balance = $45');

console.log('--- Scenario 3: verified revenue ---');
const unverified = await treasury.post({ kind: 'CUSTOMER_PAYMENT', amount: 20, description: 'I earned $20', idempotencyKey: 'claim-only', recordedBy: 'agent' });
assert(unverified.status === 'REJECTED' && unverified.code === 'UNVERIFIED_REVENUE', 'self-reported revenue without verification is rejected');
const wrongVerifier = await treasury.confirmRevenue({ verifier: 'FINIVEX_PROVIDER', verificationId: 'v0', externalReference: 'fx-0', amount: 20, currency: 'USD', description: 'real provider on a test run' });
assert(wrongVerifier.payment.status === 'REJECTED' && wrongVerifier.payment.code === 'VERIFIER_NOT_ALLOWED', 'a TEST run refuses production verifiers (simulated and real money never mix)');
const rev = await treasury.confirmRevenue({ verifier: 'SANDBOX_TEST', verificationId: 'ver-1', externalReference: 'sandbox-pay-1', amount: 20, currency: 'USD', description: 'Sandbox customer payment', claimId: 'claim-1' });
assert(rev.payment.status === 'POSTED' && rev.payment.entry.kind === 'CUSTOMER_PAYMENT', 'verified (sandbox) revenue posted as CUSTOMER_PAYMENT');
assert(rev.payment.status === 'POSTED' && rev.payment.entry.environment === 'TEST', 'the entry is labelled with the run’s TEST environment');
assert((await treasury.balance()) === 65, 'balance = $65');

console.log('--- Ledger rules that block silent money ---');
const topUp = await treasury.post({ kind: 'STARTING_CAPITAL', amount: 50, description: 'top up', idempotencyKey: 'topup-1', recordedBy: 'operator' });
assert(topUp.status === 'REJECTED' && topUp.code === 'RUN_ALREADY_STARTED', 'a second STARTING_CAPITAL (top-up) is rejected');
const upAdj = await treasury.post({ kind: 'ADJUSTMENT', amount: 10, description: 'fix', idempotencyKey: 'adj-up', recordedBy: 'operator' });
assert(upAdj.status === 'REJECTED' && upAdj.code === 'WRONG_SIGN', 'an upward ADJUSTMENT (silent deposit) is rejected');
const transfer = await treasury.post({ kind: 'TRANSFER_IN', amount: 10, description: 'transfer', idempotencyKey: 'tr-1', recordedBy: 'operator' });
assert(transfer.status === 'REJECTED' && transfer.code === 'TRANSFERS_NOT_ENABLED', 'TRANSFER_IN is rejected (single-account run)');
const fx = await treasury.confirmRevenue({ verifier: 'SANDBOX_TEST', verificationId: 'ver-fx', externalReference: 'zwg-1', amount: 100, currency: 'ZWG', description: 'ZWG payment' });
assert(fx.payment.status === 'REJECTED' && fx.payment.code === 'CURRENCY_MISMATCH', 'revenue in another currency is rejected (no FX yet)');
assert((await treasury.balance()) === 65, 'none of the rejected entries moved the balance');

console.log('--- Scenario 6: duplicate transactions ---');
const dupExp = await treasury.recordOperatorExpense({ requestId: 'spend-1', amount: 5, vendor: 'namecheap', purpose: 'domain', recordedBy: 'test' });
assert(dupExp.status === 'DUPLICATE', 'the same expense (same spend request) is not posted twice');
const dupRev = await treasury.confirmRevenue({ verifier: 'SANDBOX_TEST', verificationId: 'ver-2', externalReference: 'sandbox-pay-1', amount: 20, currency: 'USD', description: 'same payment, second claim', claimId: 'claim-2' });
assert(dupRev.payment.status === 'DUPLICATE', 'the same provider payment cannot be credited twice, even from a different claim');
const concurrent = await Promise.all(Array.from({ length: 5 }, () => treasury.recordCosts(
  [{ seq: 1, kind: 'SEARCH', provider: 'tavily', operation: 'query', estimatedUsd: 0.008, actualUsd: 0.008, costBasis: 'CONFIGURED_PRICE', at: Date.now() }],
  { sessionId: 'race', channel: 'AUTO', reason: 'race test' },
)));
const raceEntries = (await treasury.entries()).filter((e) => e.idempotencyKey === 'cost:race:1');
assert(raceEntries.length === 1, `5 concurrent posts of one cost → exactly 1 entry (${concurrent.flat().filter((r) => r.status === 'POSTED').length} reported POSTED)`);
assert(!!(await rejects(db.prepare(`INSERT INTO transactions (id, agent_id, type, amount, description, balance_after, created_at, ledger, run_id, kind, idempotency_key, environment, metadata) VALUES ('raw-dup', ?, 'EXPENSE', -1, 'raw', 0, '2026-10-04T00:00:00Z', 'REAL', ?, 'TOOL_EXPENSE', 'cost:race:1', 'TEST', '{}')`).bind(AGENT, run.id).run())), 'database unique index rejects a raw duplicate idempotency key');
const searchCost = raceEntries[0];
assert(searchCost?.metadata.provider === 'tavily' && searchCost?.metadata.estimatedUsd === 0.008 && searchCost?.metadata.actualUsd === 0.008 && searchCost?.metadata.reason === 'race test' && searchCost?.metadata.status === 'POSTED', 'expense records provider, estimated/actual cost, reason and status');

console.log('--- Database guards ---');
const entryId = (await treasury.entries())[0].id;
assert(/immutable/.test((await rejects(db.prepare("UPDATE transactions SET amount = 1000 WHERE id = ?").bind(entryId).run())) ?? ''), 'ledger entries cannot be updated');
assert(/immutable/.test((await rejects(db.prepare("DELETE FROM transactions WHERE id = ?").bind(entryId).run())) ?? ''), 'ledger entries cannot be deleted');
assert(/must belong to a survivor run/.test((await rejects(db.prepare(`INSERT INTO transactions (id, agent_id, type, amount, description, balance_after, created_at, ledger) VALUES ('orphan', ?, 'DEPOSIT', 1000, 'free money', 0, '2026-10-04T00:00:00Z', 'REAL')`).bind(AGENT).run())) ?? ''), 'a REAL entry without a run is rejected by the database');
assert(/fixed at creation/.test((await rejects(db.prepare("UPDATE survivor_runs SET starting_capital = 500 WHERE id = ?").bind(run.id).run())) ?? ''), 'run capital and thresholds cannot be edited');

console.log('--- Depleted, then Scenario 4: death ---');
const toDepleted = await treasury.recordOperatorExpense({ requestId: 'spend-2', amount: 61, vendor: 'cloudflare', purpose: 'hosting', recordedBy: 'test' });
assert(toDepleted.status === 'POSTED' && toDepleted.runStatus === 'DEPLETED', `balance ${(await treasury.balance()).toFixed(3)} ≤ $5 → DEPLETED (still alive)`);
const remaining = await treasury.balance();
const fatal = await treasury.recordOperatorExpense({ requestId: 'spend-3', amount: remaining, vendor: 'cloudflare', purpose: 'final bill', recordedBy: 'test' });
assert(fatal.status === 'POSTED' && fatal.runStatus === 'DEAD', 'spending the rest → balance $0 → DEAD');
const dead = await treasury.getCurrentRun();
assert(dead?.status === 'DEAD' && !!dead.diedAt && (await treasury.getOpenRun()) === null, 'death is recorded with a timestamp and the run is no longer open');

console.log('--- Scenario 5: no resurrection ---');
const engine = new AgentEngine(repo, {}, { treasury });
await engine.ensureSeeded();
const outcome = await engine.runCycle({ stepDelay: 0 });
assert(outcome === null && /^RUN_DEAD/.test(engine.lastRejection ?? ''), `normal cycle rejected (${engine.lastRejection?.split(':')[0]})`);
const lateRevenue = await treasury.confirmRevenue({ verifier: 'SANDBOX_TEST', verificationId: 'ver-late', externalReference: 'late-pay', amount: 100, currency: 'USD', description: 'payment after death' });
assert(lateRevenue.payment.status === 'REJECTED' && (lateRevenue.payment.code === 'NO_RUN' || lateRevenue.payment.code === 'RUN_NOT_OPEN'), 'revenue cannot be attributed to the dead run');
const lateDeposit = await treasury.post({ kind: 'STARTING_CAPITAL', amount: 50, description: 'revive', idempotencyKey: 'revive-1', recordedBy: 'operator' }, run.id);
assert(lateDeposit.status === 'REJECTED' && lateDeposit.code === 'RUN_NOT_OPEN', 'a deposit cannot revive the dead run');
assert(/not open/.test((await rejects(db.prepare(`INSERT INTO transactions (id, agent_id, type, amount, description, balance_after, created_at, ledger, run_id, kind, idempotency_key, environment, metadata) VALUES ('sql-revive', ?, 'REVENUE', 100, 'raw revive', 100, '2026-10-04T00:00:00Z', 'REAL', ?, 'CUSTOMER_PAYMENT', 'sql-revive', 'TEST', '{}')`).bind(AGENT, run.id).run())) ?? ''), 'even raw SQL cannot add money to the dead run');
assert(/final/.test((await rejects(db.prepare("UPDATE survivor_runs SET status = 'ALIVE' WHERE id = ?").bind(run.id).run())) ?? ''), 'the database refuses to flip DEAD back to ALIVE');
assert((await treasury.balance(run.id)) === 0, 'the dead run’s balance stays $0');
const next = await treasury.createRun({ environment: 'TEST', startingCapital: 50, createdBy: 'test', label: 'second experiment' });
assert(next.run.id !== run.id && (await treasury.getOpenRun())?.id === next.run.id, 'a new experiment is a NEW run');
assert((await treasury.getOpenRun())?.status === 'ALIVE' && (await treasury.balance()) === 50, 'the new run starts ALIVE at $50');
assert((await treasury.snapshot(run.id)).run?.status === 'DEAD', 'the old run is still DEAD');
assert(!!(await rejects(treasury.createRun({ environment: 'TEST', startingCapital: 50, createdBy: 'test' }))), 'a run cannot be created over an open run without explicitly ending it');

await mf.dispose();

console.log('--- Legacy production data: migration 0022 backfill ---');
{
  const legacy = await createTestDb({ upTo: '0021' });
  const ldb = legacy.db;
  await ldb.prepare("INSERT INTO agents (id, name) VALUES (?, 'Prod')").bind(AGENT).run();
  await ldb.prepare(`INSERT INTO transactions (id, agent_id, type, amount, description, balance_after, created_at, ledger) VALUES ('tx-opening-deposit', ?, 'DEPOSIT', 50, 'old simulated grant', 50, '2026-09-21T20:00:55.499Z', 'SIMULATED')`).bind(AGENT).run();
  await ldb.prepare(`INSERT INTO transactions (id, agent_id, type, amount, description, balance_after, created_at, ledger) VALUES ('tx-sim-exp', ?, 'EXPENSE', -5, 'Simulated experiment budget', 45, '2026-09-22T00:00:00Z', 'SIMULATED')`).bind(AGENT).run();
  await ldb.prepare(`INSERT INTO transactions (id, agent_id, type, amount, description, balance_after, created_at, ledger) VALUES ('tx-real-opening-deposit', ?, 'DEPOSIT', 50, '[TREASURY CAPITAL] Owner capital', 50, '2026-09-27T01:11:12.146Z', 'REAL')`).bind(AGENT).run();
  await ldb.prepare(`INSERT INTO agent_memory (id, agent_id, kind, ref_type, ref_id, title, tests, spent, revenue, conclusion, notes) VALUES ('mem-1', ?, 'opportunity', 'opportunity', 'opp-x', 'AI website service', 2, 2, 0, 'AVOID', '[]')`).bind(AGENT).run();
  await legacy.applyMigration('migrations/0022_truthful_ledger.sql', true);

  const lt = new Treasury(new D1LedgerStore(ldb, AGENT), AGENT);
  const migrated = await lt.getOpenRun();
  assert(migrated?.id === `run_${AGENT}_001` && migrated.environment === 'PRODUCTION' && migrated.status === 'ALIVE', 'the existing REAL $50 became PRODUCTION run 001, ALIVE');
  assert(migrated?.deathThreshold === 0 && migrated.startingCapital === 50, 'run 001: starting capital $50, death threshold $0');
  assert((await lt.balance()) === 50, 'migrated balance is exactly $50 (simulated rows excluded)');
  const sim: any = await ldb.prepare("SELECT kind, run_id FROM transactions WHERE id = 'tx-sim-exp'").first();
  assert(sim.kind === 'LEGACY_SIMULATION' && sim.run_id === null, 'old simulated rows are labelled LEGACY_SIMULATION and belong to no run');
  const lrepo = new D1Repository(ldb, AGENT);
  const mem = await lrepo.listMemory();
  assert(mem[0]?.provenance === 'SIMULATED_LEGACY' && realExperience(mem).length === 0, 'all pre-0022 memory is SIMULATED_LEGACY and is not real experience');
  const sandboxOnProd = await lt.confirmRevenue({ verifier: 'SANDBOX_TEST', verificationId: 'x', externalReference: 'fake', amount: 1000, currency: 'USD', description: 'fake' });
  assert(sandboxOnProd.payment.status === 'REJECTED' && sandboxOnProd.payment.code === 'VERIFIER_NOT_ALLOWED', 'a PRODUCTION run refuses sandbox/test revenue');

  console.log('--- Quarantine: simulated AVOID memory no longer blocks decisions ---');
  const opp = { ...SAMPLE_OPPORTUNITIES.find((o) => !o.executionBlocked && o.capitalRequiredMin <= 10)!, id: 'opp-x', researchStage: 'RANKED' as const, dataSource: 'LIVE' as const };
  opp.score = scoreOpportunity(opp);
  await lrepo.upsertOpportunities([opp]);
  const lengine = new AgentEngine(lrepo, {}, { treasury: lt });
  await lengine.ensureSeeded();
  const cycle = await lengine.runCycle({ stepDelay: 0 });
  const events = await lrepo.listEvents();
  assert(cycle !== null, 'the production run accepts a normal cycle');
  assert(events.some((e) => e.type === 'DECISION' && e.message.includes(`Selected "${opp.name}"`)), 'an opportunity with simulated AVOID memory is selectable again');
  assert(!events.some((e) => e.type === 'REJECTION' && /Memory:/.test(e.message)), 'no rejection cites simulated memory');
  assert((await lrepo.listExperiments()).length === 0, 'no Math.random() experiment is created in production mode');
  assert((await lt.balance()) === 50 && (await lt.entries()).length === 1, 'the cycle moved no money (no paid providers connected)');
  const agent = await lrepo.getAgent();
  assert(!/EXPLOIT/.test(agent.currentStrategy), `strategy is no longer derived from simulated wins ("${agent.currentStrategy}")`);
  await legacy.mf.dispose();
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
