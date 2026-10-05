/* ============================================================================
 * Revenue loop — opportunity → action → outcome → verified revenue.
 * ----------------------------------------------------------------------------
 * run()            free: strategies read stored data, Survivor scores and
 *                  selects, and queues the next HUMAN action
 *                  (WAITING_FOR_OPERATOR). No paid call, no message sent.
 * decide()         operator APPROVE / REJECT
 * complete()       operator says the action was performed
 * reportResult()   operator reports what the customer did. PAID is never
 *                  taken on trust: the payment provider is asked directly and
 *                  only a provider-confirmed payment is credited, through
 *                  Treasury.confirmRevenue (the one revenue entry point).
 * ========================================================================== */

import type { D1DatabaseLike } from '../engine/d1Repository';
import type { Treasury } from '../economy/treasury';
import type { RevenueVerifier } from '../economy/ledger';
import { decideFinivexVerification } from '../lib/revenueVerification';
import { calibrationMultiplier, scoreOpportunity, selectTop, type StrategyOutcomes } from './selector';
import {
  ACTION_RESULTS, OPEN_OPPORTUNITY,
  type ActionProposal, type ActionResult, type ActionStatus, type Opportunity, type OpportunityStatus,
  type Strategy, type SurvivorAction,
} from './types';

export interface StrategyBinding<T = any> {
  strategy: Strategy<T>;
  /** Free: reads stored data only. */
  loadSources(): Promise<T[]>;
  sourceRef(source: T): string;
}

export interface ProviderPaymentCheck {
  ok: boolean;
  httpStatus: number;
  status: string;
  amount?: number;
  currency?: string;
}

export interface RevenueLoopDeps {
  db: D1DatabaseLike;
  agentId: string;
  treasury: Treasury;
  strategies: StrategyBinding[];
  /** true when the kill switch is engaged (or unreadable). */
  killSwitchEngaged(): Promise<boolean>;
  /** Asks the payment provider about a transaction. Absent = not configured. */
  checkPayment?: (transactionId: string) => Promise<ProviderPaymentCheck>;
  verifier?: RevenueVerifier;
  runwayReserveUsd: number;
  /** How many opportunities may be in flight at once. */
  capacity?: number;
  clock?: () => number;
}

export type LoopError = { ok: false; status: number; error: string };
const fail = (status: number, error: string): LoopError => ({ ok: false, status, error });

const POSITIVE: ActionResult[] = ['INTERESTED', 'NEGOTIATING', 'TRIAL', 'PAID'];

function rowToOpp(r: any): Opportunity {
  return {
    id: r.id, runId: r.run_id, strategyId: r.strategy_id, sourceRef: r.source_ref, title: r.title,
    targetCustomer: r.target_customer, problem: r.problem, offer: r.offer, hypothesis: r.hypothesis,
    successCriterion: r.success_criterion, estimatedValue: Number(r.estimated_value), estimatedCost: Number(r.estimated_cost),
    priorProbability: Number(r.prior_probability), probability: Number(r.probability), score: Number(r.score),
    scoreExplanation: r.score_explanation, evidence: safeJson(r.evidence), status: r.status, statusReason: r.status_reason,
    revenueEntryId: r.revenue_entry_id, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function rowToAction(r: any): SurvivorAction {
  return {
    id: r.id, opportunityId: r.opportunity_id, kind: r.kind, title: r.title, why: r.why, instructions: r.instructions,
    payload: safeJson(r.payload), requiresHuman: true, expectedValue: Number(r.expected_value),
    predictedProbability: Number(r.predicted_probability), predictedOutcome: r.predicted_outcome, cost: Number(r.cost),
    status: r.status, result: r.result, resultNote: r.result_note, paymentReference: r.payment_reference,
    createdAt: r.created_at, decidedAt: r.decided_at, completedAt: r.completed_at, resolvedAt: r.resolved_at, updatedAt: r.updated_at,
  };
}

function safeJson(s: unknown): Record<string, unknown> {
  try { return typeof s === 'string' ? JSON.parse(s) : {}; } catch { return {}; }
}

export class RevenueLoop {
  private clock: () => number;
  constructor(private d: RevenueLoopDeps) {
    this.clock = d.clock ?? Date.now;
  }

  private now() { return new Date(this.clock()).toISOString(); }
  private id(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }

  /* ------------------------------- reads -------------------------------- */

  async opportunities(): Promise<Opportunity[]> {
    const { results } = await (this.d.db.prepare('SELECT * FROM survivor_opportunities WHERE agent_id = ? ORDER BY score DESC, created_at ASC').bind(this.d.agentId) as any).all();
    return (results ?? []).map(rowToOpp);
  }

  async actions(): Promise<SurvivorAction[]> {
    const { results } = await (this.d.db.prepare('SELECT * FROM survivor_actions WHERE agent_id = ? ORDER BY created_at DESC').bind(this.d.agentId) as any).all();
    return (results ?? []).map(rowToAction);
  }

  private async opp(id: string): Promise<Opportunity | null> {
    const r = await this.d.db.prepare('SELECT * FROM survivor_opportunities WHERE id = ? AND agent_id = ?').bind(id, this.d.agentId).first();
    return r ? rowToOpp(r) : null;
  }

  private async action(id: string): Promise<SurvivorAction | null> {
    const r = await this.d.db.prepare('SELECT * FROM survivor_actions WHERE id = ? AND agent_id = ?').bind(id, this.d.agentId).first();
    return r ? rowToAction(r) : null;
  }

  /** Cash Survivor may put at risk without breaching death + runway reserve. */
  async riskCapital(): Promise<{ balance: number; available: number; runId: string | null; alive: boolean }> {
    const run = await this.d.treasury.getOpenRun();
    if (!run || !['ALIVE', 'DEPLETED'].includes(run.status)) return { balance: 0, available: 0, runId: run?.id ?? null, alive: false };
    const balance = await this.d.treasury.balance(run.id);
    return { balance, available: balance - run.deathThreshold - this.d.runwayReserveUsd, runId: run.id, alive: true };
  }

  /* ------------------------------ writes -------------------------------- */

  private async log(entity: 'OPPORTUNITY' | 'ACTION', id: string, from: string | null, to: string, actor: string, note: string) {
    await this.d.db
      .prepare('INSERT INTO survivor_transitions (id, agent_id, entity_type, entity_id, from_status, to_status, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(this.id('trn'), this.d.agentId, entity, id, from, to, actor, note.slice(0, 500), this.now())
      .run();
  }

  private async setOppStatus(o: Opportunity, to: OpportunityStatus, actor: string, reason: string, extra: { revenueEntryId?: string } = {}) {
    if (o.status === to && !extra.revenueEntryId) return;
    await this.d.db
      .prepare('UPDATE survivor_opportunities SET status = ?, status_reason = ?, revenue_entry_id = COALESCE(?, revenue_entry_id), updated_at = ? WHERE id = ?')
      .bind(to, reason.slice(0, 300), extra.revenueEntryId ?? null, this.now(), o.id)
      .run();
    await this.log('OPPORTUNITY', o.id, o.status, to, actor, reason);
    o.status = to;
  }

  private async setActionStatus(a: SurvivorAction, to: ActionStatus, actor: string, note: string, fields: Record<string, unknown> = {}) {
    const cols = Object.keys(fields);
    const sets = ['status = ?', 'updated_at = ?', ...cols.map((c) => `${c} = ?`)].join(', ');
    await this.d.db
      .prepare(`UPDATE survivor_actions SET ${sets} WHERE id = ? AND status = ?`)
      .bind(to, this.now(), ...cols.map((c) => fields[c]), a.id, a.status)
      .run();
    await this.log('ACTION', a.id, a.status, to, actor, note);
    a.status = to;
  }

  private async queueAction(o: Opportunity, p: ActionProposal): Promise<SurvivorAction> {
    const now = this.now();
    const id = this.id('act');
    await this.d.db
      .prepare(`INSERT INTO survivor_actions (id, agent_id, opportunity_id, kind, title, why, instructions, payload, requires_human,
                 expected_value, predicted_probability, predicted_outcome, cost, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'WAITING_FOR_OPERATOR', ?, ?)`)
      .bind(id, this.d.agentId, o.id, p.kind, p.title, p.why, p.instructions, JSON.stringify(p.payload),
        Math.round(o.estimatedValue * o.probability * 100) / 100, p.predictedProbability, p.predictedOutcome, p.cost, now, now)
      .run();
    await this.log('ACTION', id, null, 'WAITING_FOR_OPERATOR', 'survivor', `${p.kind}: ${p.title} (REQUIRES_HUMAN_ACTION)`);
    return (await this.action(id))!;
  }

  private binding(strategyId: string): StrategyBinding | undefined {
    return this.d.strategies.find((b) => b.strategy.id === strategyId);
  }

  private async sourceFor(o: Opportunity): Promise<unknown> {
    const b = this.binding(o.strategyId);
    if (!b) return undefined;
    return (await b.loadSources()).find((s) => b.sourceRef(s) === o.sourceRef);
  }

  private async outcomes(strategyId: string): Promise<StrategyOutcomes> {
    const r: any = await this.d.db
      .prepare(`SELECT SUM(status = 'WON') wins, SUM(status = 'LOST') losses, AVG(prior_probability) p
                FROM survivor_opportunities WHERE agent_id = ? AND strategy_id = ? AND status IN ('WON','LOST')`)
      .bind(this.d.agentId, strategyId)
      .first();
    return { wins: Number(r?.wins ?? 0), losses: Number(r?.losses ?? 0), meanPriorOfResolved: Number(r?.p ?? 0) };
  }

  /**
   * One free pass of the loop. Refuses (and changes nothing) when the kill
   * switch is engaged or there is no living run.
   */
  async run(actor = 'survivor'): Promise<
    | { ok: true; discovered: number; qualified: number; selected: Opportunity[]; queued: SurvivorAction[]; inFlight: number; available: number }
    | LoopError
  > {
    if (await this.d.killSwitchEngaged()) return fail(423, 'KILL_SWITCH_ENGAGED: the revenue loop does not run while Survivor is stopped');
    const cap = await this.riskCapital();
    if (!cap.alive) return fail(409, 'RUN_NOT_ALIVE: start a run before Survivor can pursue revenue');

    const now = this.now();
    let discovered = 0;
    for (const b of this.d.strategies) {
      const multiplier = calibrationMultiplier(await this.outcomes(b.strategy.id));
      const sources = await b.loadSources();
      for (const c of b.strategy.candidates(sources)) {
        const s = scoreOpportunity({ value: c.estimatedValue, cost: c.estimatedCost, prior: c.priorProbability, multiplier, available: cap.available });
        const disq = c.disqualifiedBecause ?? (s.affordable ? null : 'cost exceeds risk capital above the runway reserve');
        const existing: any = await this.d.db
          .prepare('SELECT * FROM survivor_opportunities WHERE agent_id = ? AND strategy_id = ? AND source_ref = ?')
          .bind(this.d.agentId, b.strategy.id, c.sourceRef)
          .first();
        if (!existing) {
          const id = this.id('sop');
          await this.d.db
            .prepare(`INSERT INTO survivor_opportunities (id, agent_id, run_id, strategy_id, source_ref, title, target_customer, problem, offer,
                       hypothesis, success_criterion, estimated_value, estimated_cost, prior_probability, probability, score, score_explanation,
                       evidence, status, status_reason, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISCOVERED', ?, ?, ?)`)
            .bind(id, this.d.agentId, cap.runId, b.strategy.id, c.sourceRef, c.title, c.targetCustomer, c.problem, c.offer,
              c.hypothesis, c.successCriterion, c.estimatedValue, c.estimatedCost, c.priorProbability, s.probability, s.score,
              s.explanation, JSON.stringify(c.evidence), disq, now, now)
            .run();
          await this.log('OPPORTUNITY', id, null, 'DISCOVERED', actor, `${b.strategy.name}: ${c.title}`);
          discovered += 1;
          const o = (await this.opp(id))!;
          if (!disq) await this.setOppStatus(o, 'QUALIFIED', actor, s.explanation);
        } else {
          const o = rowToOpp(existing);
          if (!OPEN_OPPORTUNITY.includes(o.status)) continue;
          await this.d.db
            .prepare(`UPDATE survivor_opportunities SET title = ?, target_customer = ?, offer = ?, estimated_value = ?, estimated_cost = ?,
                       prior_probability = ?, probability = ?, score = ?, score_explanation = ?, evidence = ?, updated_at = ? WHERE id = ?`)
            .bind(c.title, c.targetCustomer, c.offer, c.estimatedValue, c.estimatedCost, c.priorProbability, s.probability,
              s.score, s.explanation, JSON.stringify(c.evidence), now, o.id)
            .run();
          if (o.status === 'DISCOVERED' && !disq) await this.setOppStatus(o, 'QUALIFIED', actor, s.explanation);
          else if (o.status === 'QUALIFIED' && disq) await this.setOppStatus(o, 'DISCOVERED', actor, `no longer qualified: ${disq}`);
        }
      }
    }

    const all = await this.opportunities();
    const inFlight = all.filter((o) => ['SELECTED', 'TESTING', 'ACTIVE'].includes(o.status)).length;
    const picks = selectTop(all.filter((o) => o.status === 'QUALIFIED'), (this.d.capacity ?? 3) - inFlight);
    const queued: SurvivorAction[] = [];
    for (const o of picks) {
      const b = this.binding(o.strategyId);
      const proposal = b?.strategy.nextAction(o, await this.sourceFor(o), null);
      if (!proposal) continue;
      await this.setOppStatus(o, 'SELECTED', actor, `selected: ${o.scoreExplanation}`);
      queued.push(await this.queueAction(o, proposal));
    }
    return { ok: true, discovered, qualified: all.filter((o) => o.status === 'QUALIFIED').length, selected: picks, queued, inFlight: inFlight + queued.length, available: cap.available };
  }

  async decide(actionId: string, decision: 'APPROVE' | 'REJECT', note = ''): Promise<{ ok: true; action: SurvivorAction } | LoopError> {
    const a = await this.action(actionId);
    if (!a) return fail(404, 'action not found');
    if (a.status !== 'WAITING_FOR_OPERATOR') return fail(409, `action is ${a.status}, not WAITING_FOR_OPERATOR`);
    const o = (await this.opp(a.opportunityId))!;
    if (decision === 'REJECT') {
      await this.setActionStatus(a, 'REJECTED', 'operator', note || 'rejected by operator', { decided_at: this.now(), result_note: note || null });
      await this.setOppStatus(o, 'ABANDONED', 'operator', `operator rejected ${a.kind}${note ? `: ${note}` : ''}`);
      return { ok: true, action: a };
    }
    // Money protection: an action that costs cash must fit inside the risk
    // capital above death + runway reserve, re-checked at approval time.
    if (a.cost > 0) {
      if (await this.d.killSwitchEngaged()) return fail(423, 'KILL_SWITCH_ENGAGED');
      const cap = await this.riskCapital();
      if (!cap.alive || a.cost > cap.available) return fail(409, `NOT_AFFORDABLE: costs $${a.cost}, risk capital is $${Math.max(0, cap.available).toFixed(2)}`);
    }
    await this.setActionStatus(a, 'APPROVED', 'operator', note || 'approved', { decided_at: this.now() });
    if (o.status === 'SELECTED') await this.setOppStatus(o, 'TESTING', 'operator', `approved ${a.kind}`);
    return { ok: true, action: a };
  }

  async complete(actionId: string, note = ''): Promise<{ ok: true; action: SurvivorAction } | LoopError> {
    const a = await this.action(actionId);
    if (!a) return fail(404, 'action not found');
    if (a.status !== 'APPROVED') return fail(409, `action is ${a.status}; approve it before completing`);
    await this.setActionStatus(a, 'COMPLETED', 'operator', note || 'performed by operator', { completed_at: this.now() });
    return { ok: true, action: a };
  }

  async reportResult(
    actionId: string,
    result: ActionResult,
    note = '',
    payment?: { transactionId: string; amount: number; currency: string },
  ): Promise<
    | { ok: true; action: SurvivorAction; opportunity: Opportunity; next: SurvivorAction | null; revenue?: unknown }
    | (LoopError & { verification?: unknown })
  > {
    if (!ACTION_RESULTS.includes(result)) return fail(400, `result must be one of ${ACTION_RESULTS.join(', ')}`);
    const a = await this.action(actionId);
    if (!a) return fail(404, 'action not found');
    if (a.status !== 'APPROVED' && a.status !== 'COMPLETED') return fail(409, `action is ${a.status}; only an approved/completed action can have a result`);
    const o = (await this.opp(a.opportunityId))!;

    let revenue: unknown;
    if (result === 'PAID') {
      const v = await this.verifyAndCredit(o, a, payment);
      if (!v.ok) return v;
      revenue = v.revenue;
    }

    await this.setActionStatus(a, 'RESOLVED', 'operator', `${result}${note ? `: ${note}` : ''}`, {
      result, result_note: note || null, resolved_at: this.now(), payment_reference: payment?.transactionId ?? null,
      completed_at: a.completedAt ?? this.now(),
    });
    a.result = result;

    let next: SurvivorAction | null = null;
    if (result === 'PAID') {
      // set inside verifyAndCredit
    } else if (result === 'PRICE_REJECTED' || result === 'LOST') {
      await this.setOppStatus(o, 'LOST', 'operator', `${result}${note ? `: ${note}` : ''}`);
    } else {
      if (result !== 'NO_RESPONSE') await this.setOppStatus(o, 'ACTIVE', 'operator', `${result}${note ? `: ${note}` : ''}`);
      const b = this.binding(o.strategyId);
      const proposal = b?.strategy.nextAction(o, await this.sourceFor(o), a) ?? null;
      if (proposal) next = await this.queueAction(o, proposal);
      else if (result === 'NO_RESPONSE') await this.setOppStatus(o, 'LOST', 'operator', `no response after ${a.kind}`);
    }
    return { ok: true, action: a, opportunity: (await this.opp(o.id))!, next, revenue };
  }

  /** PAID → ask the provider → only a confirmed payment is credited. */
  private async verifyAndCredit(
    o: Opportunity,
    a: SurvivorAction,
    payment?: { transactionId: string; amount: number; currency: string },
  ): Promise<{ ok: true; revenue: unknown } | (LoopError & { verification?: unknown })> {
    const ref = payment?.transactionId?.trim();
    if (!ref || !(Number(payment?.amount) > 0) || !payment?.currency) {
      return fail(400, 'PAID requires the payment provider transactionId, amount and currency; revenue is never recorded on an operator\'s word');
    }
    if (!this.d.checkPayment) return fail(503, 'payment provider is not configured; PAID cannot be verified');
    const run = await this.d.treasury.getOpenRun();
    if (!run) return fail(409, 'RUN_NOT_ALIVE');

    let check: ProviderPaymentCheck;
    try { check = await this.d.checkPayment(ref); } catch (e) { return fail(502, `provider check failed: ${(e as Error).message}`); }
    const decision = decideFinivexVerification({
      claimedAmount: payment.amount, claimedCurrency: payment.currency,
      providerStatus: check.status, providerAmount: check.amount, providerCurrency: check.currency,
    });
    const verifier = this.d.verifier ?? 'FINIVEX_PROVIDER';
    const now = this.now();
    const verificationId = this.id('rvv');
    await this.d.db
      .prepare(`INSERT INTO revenue_verifications (id, agent_id, revenue_entry_id, method, provider, external_reference, status,
                 verified_amount, currency, reason, evidence, checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(verificationId, this.d.agentId, `opp:${o.id}`, verifier, verifier === 'FINIVEX_PROVIDER' ? 'FINIVEX' : verifier, ref,
        decision.status, decision.verifiedAmount ?? null, decision.verifiedCurrency ?? null, decision.reason,
        JSON.stringify({ providerHttpStatus: check.httpStatus, providerOk: check.ok, status: check.status, amount: check.amount ?? null, currency: check.currency ?? null, actionId: a.id }),
        now, now)
      .run();
    if (decision.status !== 'VERIFIED' || decision.verifiedAmount === undefined) {
      return { ...fail(decision.status === 'PENDING' ? 202 : 409, `payment not verified (${decision.status}): ${decision.reason}`), verification: { id: verificationId, ...decision } };
    }

    // ===== THE ONLY PLACE REVENUE ENTERS FROM THE REVENUE LOOP =====
    const credited = await this.d.treasury.confirmRevenue({
      verifier,
      verificationId,
      externalReference: ref,
      amount: decision.verifiedAmount,
      currency: decision.verifiedCurrency ?? payment.currency,
      paidAt: this.clock(),
      claimId: `opp:${o.id}`,
      description: `Customer payment: ${o.title} — ${verifier} ${ref}`,
    });
    if (credited.payment.status !== 'POSTED') {
      const why = credited.payment.status === 'DUPLICATE'
        ? `transaction ${ref} was already credited; one payment counts once`
        : `ledger refused the payment: ${(credited.payment as any).reason}`;
      return fail(409, why);
    }
    await this.setOppStatus(o, 'WON', `verifier:${verifier}`, `verified payment ${decision.verifiedAmount} ${decision.verifiedCurrency} (${ref})`, { revenueEntryId: credited.payment.entry.id });
    return { ok: true, revenue: { entryId: credited.payment.entry.id, amount: decision.verifiedAmount, currency: decision.verifiedCurrency, balance: credited.payment.balance, verificationId } };
  }

  /** Everything the minimal dashboard shows. */
  async summary() {
    const [snapshot, opps, actions, cap, killSwitch] = await Promise.all([
      this.d.treasury.snapshot(), this.opportunities(), this.actions(), this.riskCapital(), this.d.killSwitchEngaged(),
    ]);
    const count = (s: OpportunityStatus) => opps.filter((o) => o.status === s).length;
    const resolved = actions.filter((a) => a.status === 'RESOLVED' && a.result);
    const predicted = resolved.length ? resolved.reduce((s, a) => s + a.predictedProbability, 0) / resolved.length : null;
    const actual = resolved.length ? resolved.filter((a) => POSITIVE.includes(a.result!)).length / resolved.length : null;
    const waiting = actions.filter((a) => ['WAITING_FOR_OPERATOR', 'APPROVED', 'COMPLETED'].includes(a.status));
    const top = opps.find((o) => ['ACTIVE', 'TESTING', 'SELECTED'].includes(o.status));
    const mission = killSwitch
      ? 'Stopped: kill switch engaged.'
      : !cap.alive
        ? 'No living run. Start a run to begin.'
        : snapshot.revenue > 0
          ? `Verified revenue $${snapshot.revenue.toFixed(2)}. Keep converting: ${top ? top.title : 'run the loop for the next opportunity'}.`
          : top
            ? `Earn the first verified dollar: ${top.title} (${top.status}).`
            : 'Earn the first verified dollar: run the loop to select an opportunity.';
    return {
      run: snapshot.run,
      status: snapshot.run?.status ?? 'NO_RUN',
      killSwitchEngaged: killSwitch,
      balance: snapshot.balance,
      startingCapital: snapshot.startingCapital,
      revenue: snapshot.revenue,
      expenses: snapshot.expenses + snapshot.fees,
      profit: snapshot.netResult,
      riskCapital: Math.max(0, cap.available),
      mission,
      counts: {
        DISCOVERED: count('DISCOVERED'), QUALIFIED: count('QUALIFIED'), SELECTED: count('SELECTED'), TESTING: count('TESTING'),
        ACTIVE: count('ACTIVE'), WON: count('WON'), LOST: count('LOST'), ABANDONED: count('ABANDONED'),
        waitingForOperator: actions.filter((a) => a.status === 'WAITING_FOR_OPERATOR').length,
      },
      calibration: { resolvedActions: resolved.length, meanPredictedPositive: predicted, actualPositiveRate: actual },
      opportunities: opps.filter((o) => OPEN_OPPORTUNITY.includes(o.status) || o.status === 'WON').slice(0, 25),
      actions: waiting,
      recentResults: resolved.slice(0, 10),
    };
  }
}
