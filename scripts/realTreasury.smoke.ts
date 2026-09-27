/* ============================================================================
 * Phase 0 smoke test (27 Sep 2026): real treasury, $0.40/day cost cap,
 * dormant-not-dead, metered AI calls, and the self-filling approval queue.
 * Run with: npx tsx scripts/realTreasury.smoke.ts
 * ========================================================================== */

import { CostMeter, autoSpentToday, AUTO_COST_TAG } from '../src/lib/costMeter';
import { createLLMProvider } from '../src/services/providers/llm';
import { runSearch, type SearchEconomyContext } from '../src/services/searchEconomy';
import { emptyState } from '../src/services/searchBudget';
import { computeSurvivalStatus } from '../src/engine/seed';
import { openingLedger, balanceFrom } from '../src/services/wallet';
import { AgentEngine } from '../src/engine/agentEngine';
import { InMemoryRepository } from '../src/engine/inMemoryRepository';
import { queueApprovals, whatsappUrl, approvalActionId } from '../src/lib/approvalQueue';
import type { SearchProvider } from '../src/services/providers/types';
import type { OutreachMessageSet, Prospect, RecommendedAction, Transaction } from '../src/types';

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures += 1;
}

const DAY = 86_400_000;
const now = Date.parse('2026-09-27T10:00:00Z');
const opening = openingLedger(50);

console.log('--- Status ladder: dormant at the $10 floor, never "dead" ---');
assert(computeSurvivalStatus(50) === 'ALIVE', '$50 → ALIVE');
assert(computeSurvivalStatus(20) === 'AT_RISK', '$20 → AT_RISK');
assert(computeSurvivalStatus(12) === 'CRITICAL', '$12 → CRITICAL');
assert(computeSurvivalStatus(10) === 'DEAD', '$10 → DORMANT (stored as DEAD)');
assert(opening[0].ledger === 'REAL' && opening[0].amount === 50 && opening[0].id === 'tx-real-opening-deposit', 'opening deposit is a REAL $50 entry with its own id');

console.log('--- Cost meter: daily cap and dormant floor ---');
{
  const earlier: Transaction = { id: 'a', type: 'EXPENSE', amount: -0.35, description: `${AUTO_COST_TAG} AI + search costs`, balanceAfter: 49.65, createdAt: now - 3_600_000, ledger: 'REAL' };
  const yesterday: Transaction = { ...earlier, id: 'b', createdAt: now - DAY };
  const ledger = [...opening, yesterday, earlier];
  assert(Math.abs(autoSpentToday(ledger, now) - 0.35) < 1e-9, "only today's [AUTO] costs count toward the cap");
  const m = CostMeter.fromLedger(ledger, undefined, now);
  assert(m.check(0.04).ok, '$0.04 more fits under $0.40');
  assert(!m.check(0.06).ok, '$0.06 more would pass $0.40 → refused');
  m.recordLlm(0.03, 1000, 200);
  assert(!m.check(0.03).ok && m.blocked.DAILY_CAP === 2 && Math.abs(m.remainingTodayUsd - 0.02) < 1e-9, 'after spending $0.03, only $0.02 of the cap is left');
  const tx = m.toExpense(ledger, 'cycle #1', now);
  assert(!!tx && tx.amount === -0.03 && tx.description.includes(AUTO_COST_TAG) && tx.ledger === 'REAL', 'what was spent becomes one REAL [AUTO] expense');

  const poor = new CostMeter({ balanceUsd: 10, spentTodayUsd: 0 });
  assert(poor.dormant && !poor.check(0).ok && poor.blocked.DORMANT === 1, 'at $10 the meter is dormant and refuses even free calls');
  assert(new CostMeter({ balanceUsd: 10.5, spentTodayUsd: 0 }).check(0.01).ok, 'above the floor it works again (wakes up)');
}

console.log('--- AI calls are checked first and charged by real token use ---');
{
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ content: [{ text: 'hello' }], usage: { input_tokens: 2000, output_tokens: 400 } }), { status: 200 });
  }) as typeof fetch;
  try {
    const llm = createLLMProvider({ anthropic: 'test-key' })!;
    const meter = new CostMeter({ balanceUsd: 50, spentTodayUsd: 0 });
    llm.attachMeter!(meter);
    const out = await llm.complete('system', 'prompt');
    // Haiku 4.5: 2000 × $1/M + 400 × $5/M = $0.004
    assert(out === 'hello' && calls === 1, 'call goes through under the cap');
    assert(Math.abs(meter.spentUsd - 0.004) < 1e-9 && meter.llmCalls === 1, `charged $${meter.spentUsd.toFixed(4)} from the real token usage`);

    const capped = new CostMeter({ balanceUsd: 50, spentTodayUsd: 0.399 });
    llm.attachMeter!(capped);
    const refused = await llm.complete('system', 'prompt');
    assert(refused === null && calls === 1, 'over the cap: returns null without calling the API (rule-engine fallback)');

    const gemini = createLLMProvider({ gemini: 'g-key' })!;
    assert(gemini.id === 'gemini' && gemini.connected, 'a Gemini key alone connects the free-tier provider');
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('--- Searches: cache is free, real calls pass the meter ---');
{
  let searches = 0;
  const stub: SearchProvider = { id: 'stub', connected: true, label: 'Stub', search: async () => { searches += 1; return []; } };
  const ctx = (meter: CostMeter): SearchEconomyContext => ({
    state: emptyState(), providers: { tavily: stub, brave: null }, survivalStatus: 'ALIVE', now, cycleStartedAt: now, meter, searchCostUsd: 0.008,
  });
  const ok = new CostMeter({ balanceUsd: 50, spentTodayUsd: 0 });
  await runSearch(ctx(ok), { purpose: 'PROSPECT_DISCOVERY', query: 'garage Harare', entityId: 'x' });
  assert(searches === 1 && ok.searchCalls === 1 && Math.abs(ok.spentUsd - 0.008) < 1e-9, 'a real search is charged its price');
  const dormant = new CostMeter({ balanceUsd: 9, spentTodayUsd: 0 });
  const r = await runSearch(ctx(dormant), { purpose: 'PROSPECT_DISCOVERY', query: 'salon Harare', entityId: 'y' });
  assert(searches === 1 && r.skippedReason === 'TREASURY_DORMANT', 'dormant: no search call is made');
}

console.log('--- A full cycle only writes real money to the ledger ---');
{
  const repo = new InMemoryRepository();
  const engine = new AgentEngine(repo, {}, {});
  await engine.ensureSeeded();
  const before = await repo.listTransactions();
  assert(before.length === 1 && before[0].ledger === 'REAL' && balanceFrom(before) === 50, 'seeded with the real $50 only');
  await engine.runCycle({ stepDelay: 0 });
  const after = await repo.listTransactions();
  assert(after.every((t) => !/Simulated/i.test(t.description)), 'no simulated budget or revenue entries after a cycle');
  assert(balanceFrom(after) === 50, 'no AI/search used → balance stays exactly $50');
  const exps = await repo.listExperiments();
  assert(exps.every((e) => e.simulated), 'forecasts are still recorded as simulated experiments (not money)');

  // Dormant agent still runs (free) cycles instead of refusing.
  const poorRepo = new InMemoryRepository();
  const poorEngine = new AgentEngine(poorRepo, {}, {});
  await poorEngine.ensureSeeded();
  await poorRepo.appendTransaction({ id: 'drain', type: 'EXPENSE', amount: -41, description: 'test drain', balanceAfter: 9, createdAt: Date.now(), ledger: 'REAL' });
  await poorRepo.updateAgent({ status: 'DEAD' });
  const outcome = await poorEngine.runCycle({ stepDelay: 0 });
  assert(outcome !== null && outcome.finalStatus === 'DEAD', 'a dormant agent still completes a (free) cycle');
}

console.log('--- Approval queue fills itself with the exact message ---');
{
  const base = (id: string, verified: boolean, phone = '077 286 2688'): Prospect => ({
    id, opportunityId: 'opp', opportunityName: 'Websites', businessName: `Biz ${id}`, category: 'Local trades & auto', location: 'Harare',
    websitePresence: 'SOCIAL_ONLY', socialLinks: [], contactChannel: 'PHONE', contactValue: phone, sources: [], evidenceNotes: '',
    priority: 'HIGH', score: {} as Prospect['score'], status: 'QUALIFIED', dataSource: 'LIVE', dateDiscovered: 0,
    messagesSentCount: 0, responsesReceivedCount: 0, actualRevenue: 0, notes: [], createdAt: 0, updatedAt: 0,
    verification: verified ? { status: 'VERIFIED', confidence: 80, verifiedContactValue: phone, businessNameMatchScore: 1, contactMatchScore: 1, independentSources: 2, contactSources: 2, sourceUrls: [], conflictingContacts: [], notes: [], verifiedAt: 0 } : undefined,
  });
  const prospects = [base('p1', true), base('p2', false)];
  const outreach = prospects.map((p) => ({ id: `o-${p.id}`, prospectId: p.id, opportunityId: 'opp', whatsapp: `Hi ${p.businessName}!` } as OutreachMessageSet));
  const actions: RecommendedAction[] = prospects.map((p, i) => ({
    id: `act_CONTACT_PROSPECT_${p.id}`, kind: 'CONTACT_PROSPECT', prospectId: p.id, prospectName: p.businessName,
    title: `Contact ${p.businessName}`, description: '', expectedValue: 10, urgency: 5, effort: 1, rank: i + 1, createdAt: 0,
  } as RecommendedAction));

  const first = queueApprovals([], { actions, prospects, outreach, offers: [], now });
  assert(first.added.length === 1 && first.added[0].prospectId === 'p1', 'only the verified, contactable business is queued');
  const a = first.added[0];
  assert(a.actionId === approvalActionId('CONTACT_PROSPECT', 'p1') && a.actionId === 'outreach:p1', 'approval id matches the server-side CRM gate');
  assert(a.message === 'Hi Biz p1!' && a.status === 'PENDING' && a.source === 'AUTO', 'carries the exact message, pending, marked as queued by Survivor');
  assert(a.whatsappUrl === 'https://wa.me/263772862688?text=Hi%20Biz%20p1!', 'WhatsApp link converts 077… to 263 77…');

  const again = queueApprovals(first.approvals, { actions, prospects, outreach, offers: [], now });
  assert(again.added.length === 0, 'never queued twice');
  const rejected = first.approvals.map((x) => ({ ...x, status: 'REJECTED' as const }));
  assert(queueApprovals(rejected, { actions, prospects, outreach, offers: [], now }).added.length === 0, 'a rejection is respected — not re-queued');
  assert(whatsappUrl('+263 77 286 2688', 'x') === 'https://wa.me/263772862688?text=x', '+263 numbers work too');
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
