/* ============================================================================
 * Real treasury smoke test: run-based status ladder (death is final, no
 * dormant revival), $0.40/day cost cap, per-call metered AI and search, and
 * the self-filling approval queue.
 * (Updated Oct 2026: the old "dormant at $10, wakes on top-up" behaviour was
 * deliberately replaced by terminal death — see src/economy/ledger.ts.)
 * ========================================================================== */

import { CostMeter, autoSpentToday, AUTO_COST_TAG } from '../src/lib/costMeter';
import { Treasury } from '../src/economy/treasury';
import { InMemoryLedgerStore } from '../src/economy/ledgerStore';
import { setKillSwitch } from '../src/economy/killSwitch';
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

console.log('--- Status ladder: death at the threshold, no dormant floor ---');
assert(computeSurvivalStatus(50) === 'ALIVE', '$50 → ALIVE');
assert(computeSurvivalStatus(20) === 'AT_RISK', '$20 → AT_RISK');
assert(computeSurvivalStatus(4) === 'CRITICAL', '$4 → CRITICAL (depleted)');
assert(computeSurvivalStatus(10) === 'AT_RISK', '$10 is no longer a dormant floor');
assert(computeSurvivalStatus(0) === 'DEAD', '$0 → DEAD');
assert(computeSurvivalStatus(30, { status: 'DEAD', startingCapital: 50, deathThreshold: 0, depletedThreshold: 5 }) === 'DEAD', 'a DEAD run stays DEAD whatever the balance');
assert(opening[0].ledger === 'REAL' && opening[0].amount === 50 && opening[0].id === 'tx-real-opening-deposit', 'legacy demo opening deposit is unchanged');

console.log('--- Cost meter: daily cap and death-threshold floor ---');
{
  const earlier: Transaction = { id: 'a', type: 'EXPENSE', amount: -0.35, description: `${AUTO_COST_TAG} AI + search costs`, balanceAfter: 49.65, createdAt: now - 3_600_000, ledger: 'REAL' };
  const yesterday: Transaction = { ...earlier, id: 'b', createdAt: now - DAY };
  const ledger = [...opening, yesterday, earlier];
  assert(Math.abs(autoSpentToday(ledger, now) - 0.35) < 1e-9, "only today's automatic costs count toward the cap");
  const m = CostMeter.fromLedger(ledger, undefined, now);
  assert(m.check(0.04).ok, '$0.04 more fits under $0.40');
  assert(!m.check(0.06).ok, '$0.06 more would pass $0.40 → refused');
  m.recordLlm(0.03, 1000, 200, { provider: 'claude', operation: 'completion', estimatedUsd: 0.05 });
  assert(!m.check(0.03).ok && m.blocked.DAILY_CAP === 2 && Math.abs(m.remainingTodayUsd - 0.02) < 1e-9, 'after spending $0.03, only $0.02 of the cap is left');
  assert(m.items.length === 1 && m.items[0].kind === 'AI' && m.items[0].actualUsd === 0.03 && m.items[0].estimatedUsd === 0.05, 'each call becomes its own line item with estimate and actual cost');

  const broke = new CostMeter({ balanceUsd: 0.01, spentTodayUsd: 0 });
  assert(!broke.check(0.02).ok && broke.blocked.INSUFFICIENT_FUNDS === 1, 'a call that could take the balance below the death threshold is refused');
  assert(broke.check(0.005).ok, 'a call that fits above the threshold is allowed (the run spends down toward death)');
  assert(new CostMeter({ balanceUsd: 0, spentTodayUsd: 0 }).exhausted, 'at $0 the meter is exhausted');
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
    const strict = createLLMProvider({ anthropic: 'test-key', requireMeter: true })!;
    assert((await strict.complete('system', 'prompt')) === null && calls === 0, 'requireMeter: no meter attached → no API call');
    const llm = createLLMProvider({ anthropic: 'test-key' })!;
    const meter = new CostMeter({ balanceUsd: 50, spentTodayUsd: 0 });
    llm.attachMeter!(meter);
    const out = await llm.complete('system', 'prompt');
    // Haiku 4.5: 2000 × $1/M + 400 × $5/M = $0.004
    assert(out === 'hello' && calls === 1, 'call goes through under the cap');
    assert(Math.abs(meter.spentUsd - 0.004) < 1e-9 && meter.llmCalls === 1, `charged $${meter.spentUsd.toFixed(4)} from the real token usage`);
    assert(meter.items[0]?.provider.startsWith('claude') && meter.items[0]?.costBasis === 'TOKEN_USAGE_X_PRICE', 'the line item names the provider and how the cost was measured');

    const killed = new CostMeter({ balanceUsd: 50, spentTodayUsd: 0, guard: async () => ({ reason: 'KILL_SWITCH', detail: 'test' }) });
    llm.attachMeter!(killed);
    assert((await llm.complete('system', 'prompt')) === null && calls === 1 && killed.blocked.KILL_SWITCH === 1, 'kill switch (guard) is checked immediately before the call: no API call');

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
  assert(ok.items[0]?.kind === 'SEARCH' && ok.items[0]?.provider === 'tavily', 'the search line item names the provider that served it');
  const broke = new CostMeter({ balanceUsd: 0.004, spentTodayUsd: 0 });
  const r = await runSearch(ctx(broke), { purpose: 'PROSPECT_DISCOVERY', query: 'salon Harare', entityId: 'y' });
  assert(searches === 1 && r.skippedReason === 'INSUFFICIENT_FUNDS', 'cannot afford the search above the death threshold: no call is made');
  const unmetered = await runSearch({ ...ctx(ok), meter: null, requireMeter: true }, { purpose: 'PROSPECT_DISCOVERY', query: 'barber Harare', entityId: 'z' });
  assert(searches === 1 && unmetered.skippedReason === 'UNMETERED_SEARCH_REFUSED', 'requireMeter: an unmetered search is refused');
}

console.log('--- A full cycle only writes real money to the ledger ---');
{
  const repo = new InMemoryRepository();
  const treasury = new Treasury(new InMemoryLedgerStore(), 'agent-survive-01');
  const engine = new AgentEngine(repo, {}, { treasury });
  await engine.ensureSeeded();
  assert((await engine.runCycle({ stepDelay: 0 })) === null && /NO_ACTIVE_RUN/.test(engine.lastRejection ?? ''), 'no run → no cycle (seeding never mints capital)');
  await treasury.createRun({ environment: 'TEST', startingCapital: 50, createdBy: 'test' });
  await engine.runCycle({ stepDelay: 0 });
  const after = await treasury.entries();
  assert(after.length === 1 && after[0].kind === 'STARTING_CAPITAL', 'no AI/search used → only the starting capital in the ledger');
  assert((await treasury.balance()) === 50, 'balance stays exactly $50');
  assert((await repo.listExperiments()).length === 0, 'no Math.random() experiment is produced unless simulateForecasts is enabled');

  await setKillSwitch(repo, true, 'test stop', 'test');
  assert((await engine.runCycle({ stepDelay: 0 })) === null && /KILL_SWITCH/.test(engine.lastRejection ?? ''), 'kill switch engaged → cycle refused');
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
