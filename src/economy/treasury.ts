/* ============================================================================
 * Survivor economy — Treasury: the only writer of the ledger.
 * ----------------------------------------------------------------------------
 * Every balance change goes through post(), which
 *   1. returns the original entry if the idempotency key was already used,
 *   2. validates the entry against the run (ledger.ts rules),
 *   3. inserts it,
 *   4. recomputes the balance from the ledger and moves the run to
 *      ALIVE / DEPLETED / DEAD. DEAD is permanent.
 * ========================================================================== */

import {
  EXPENSE_KINDS,
  OPEN_RUN_STATUSES,
  deriveRunStatus,
  roundMoney,
  sumBalance,
  validateEntry,
  type LedgerEntry,
  type LedgerKind,
  type LedgerRejection,
  type ProposedEntry,
  type RevenueVerifier,
  type RunEnvironment,
  type RunStatus,
  type SurvivorRun,
} from './ledger';
import type { LedgerStore } from './ledgerStore';

export type PostResult =
  | { status: 'POSTED'; entry: LedgerEntry; balance: number; runStatus: RunStatus }
  | { status: 'DUPLICATE'; entry: LedgerEntry }
  | { status: 'REJECTED'; code: LedgerRejection; reason: string };

export interface CreateRunInput {
  environment: RunEnvironment;
  startingCapital: number;
  currency?: string;
  deathThreshold?: number;
  depletedThreshold?: number;
  label?: string;
  createdBy: string;
  /** Required when another run is still open: that run is ENDED first. */
  endOpenRunReason?: string;
}

/** One priced AI or search call, as recorded by the CostMeter. */
export interface CostItem {
  seq: number;
  kind: 'AI' | 'SEARCH';
  provider: string;
  operation: string;
  estimatedUsd: number;
  actualUsd: number;
  /** How actualUsd was obtained: provider-reported tokens × list price, or a
   *  configured per-call price when the provider reports no cost. */
  costBasis: 'TOKEN_USAGE_X_PRICE' | 'CONFIGURED_PRICE';
  at: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Already written to the ledger by the spend gate at settle time. */
  posted?: boolean;
}

export interface CostContext {
  /** Unique per metered session (cycle or manual request); part of every key. */
  sessionId: string;
  channel: 'AUTO' | 'MANUAL';
  reason: string;
  cycleId?: string;
  cycleIndex?: number;
  strategy?: string;
}

export interface VerifiedRevenueInput {
  verifier: RevenueVerifier;
  verificationId: string;
  /** Provider's own payment reference — the idempotency anchor. */
  externalReference: string;
  /** Amount the verifier confirmed (not the amount claimed). */
  amount: number;
  currency: string;
  paidAt?: number;
  claimId?: string;
  description: string;
  processingFee?: number;
}

export interface TreasurySnapshot {
  run: SurvivorRun | null;
  balance: number;
  startingCapital: number;
  revenue: number;
  expenses: number;
  fees: number;
  refunds: number;
  adjustments: number;
  netResult: number;
  entryCount: number;
}

export class Treasury {
  constructor(
    private store: LedgerStore,
    private agentId: string,
    private clock: () => number = Date.now,
    private newId: (prefix: string) => string = (prefix) => `${prefix}_${crypto.randomUUID()}`,
  ) {}

  getOpenRun(): Promise<SurvivorRun | null> {
    return this.store.getOpenRun();
  }

  /** The open run, or the latest closed one so a dead run stays visible. */
  async getCurrentRun(): Promise<SurvivorRun | null> {
    return (await this.store.getOpenRun()) ?? (await this.store.getLatestRun());
  }

  listRuns(): Promise<SurvivorRun[]> {
    return this.store.listRuns();
  }

  async entries(runId?: string): Promise<LedgerEntry[]> {
    const run = runId ? await this.store.getRun(runId) : await this.getCurrentRun();
    return run ? this.store.listEntries(run.id) : [];
  }

  async balance(runId?: string): Promise<number> {
    return sumBalance(await this.entries(runId));
  }

  /**
   * Create a new experiment and post its starting capital. This is the only
   * way capital enters the system. An open run must be ended explicitly
   * (endOpenRunReason) — a deposit never revives or tops up a run.
   */
  async createRun(input: CreateRunInput): Promise<{ run: SurvivorRun; capital: PostResult }> {
    const startingCapital = roundMoney(Number(input.startingCapital));
    const deathThreshold = roundMoney(Number(input.deathThreshold ?? 0));
    const depletedThreshold = roundMoney(Number(input.depletedThreshold ?? Math.max(deathThreshold, startingCapital * 0.1)));
    if (!Number.isFinite(startingCapital) || startingCapital <= 0) throw new Error('startingCapital must be a positive number');
    if (!Number.isFinite(deathThreshold) || deathThreshold < 0 || deathThreshold >= startingCapital) {
      throw new Error('deathThreshold must be ≥ 0 and below startingCapital');
    }
    if (!Number.isFinite(depletedThreshold) || depletedThreshold < deathThreshold || depletedThreshold >= startingCapital) {
      throw new Error('depletedThreshold must be between deathThreshold and startingCapital');
    }

    const open = await this.store.getOpenRun();
    if (open) {
      if (!input.endOpenRunReason?.trim()) {
        throw new Error(`run ${open.id} is still ${open.status}; end it explicitly (endOpenRunReason) before creating a new run`);
      }
      await this.endRun(open.id, input.endOpenRunReason.trim());
    }

    const now = this.clock();
    const run: SurvivorRun = {
      id: this.newId('run'),
      agentId: this.agentId,
      environment: input.environment,
      status: 'CREATED',
      currency: (input.currency ?? 'USD').toUpperCase(),
      startingCapital,
      deathThreshold,
      depletedThreshold,
      label: input.label,
      createdAt: now,
      createdBy: input.createdBy,
    };
    await this.store.insertRun(run);

    const capital = await this.post({
      kind: 'STARTING_CAPITAL',
      amount: startingCapital,
      currency: run.currency,
      description: `Starting capital for ${run.environment} run ${run.id}${run.label ? ` (${run.label})` : ''}`,
      idempotencyKey: `run:${run.id}:starting-capital`,
      recordedBy: input.createdBy,
      metadata: { startingCapital, deathThreshold, depletedThreshold },
    }, run.id);
    if (capital.status === 'POSTED') {
      await this.store.transitionRun(run.id, ['CREATED'], { status: 'ALIVE', startedAt: capital.entry.createdAt });
    }
    return { run: (await this.store.getRun(run.id)) ?? run, capital };
  }

  /** Operator closes a run (e.g. before starting a new experiment). */
  async endRun(runId: string, reason: string): Promise<boolean> {
    return this.store.transitionRun(runId, OPEN_RUN_STATUSES, { status: 'ENDED', endedAt: this.clock(), endReason: reason });
  }

  /**
   * Post one entry. `runId` defaults to the open run; passing a specific id
   * lets createRun post capital to the run it just created.
   */
  async post(proposed: ProposedEntry, runId?: string): Promise<PostResult> {
    const duplicate = proposed.idempotencyKey ? await this.store.findByIdempotencyKey(proposed.idempotencyKey) : null;
    if (duplicate) return { status: 'DUPLICATE', entry: duplicate };

    const run = runId ? await this.store.getRun(runId) : await this.store.getOpenRun();
    const existing = run ? await this.store.listEntries(run.id) : [];
    const check = validateEntry(run, existing, proposed);
    if (!check.ok) return { status: 'REJECTED', code: check.code, reason: check.reason };

    const amount = roundMoney(proposed.amount);
    const entry: LedgerEntry = {
      id: this.newId('tx'),
      runId: run!.id,
      agentId: this.agentId,
      kind: proposed.kind,
      amount,
      currency: run!.currency,
      description: proposed.description.trim(),
      idempotencyKey: proposed.idempotencyKey,
      environment: run!.environment,
      recordedBy: proposed.recordedBy,
      metadata: proposed.metadata ?? {},
      balanceAfter: roundMoney(sumBalance(existing) + amount),
      createdAt: proposed.createdAt ?? this.clock(),
    };

    let inserted: 'INSERTED' | 'DUPLICATE';
    try {
      inserted = await this.store.insertEntry(entry);
    } catch (e) {
      // The database re-checks the run is open (migration 0022 trigger); a
      // concurrent death between validate and insert lands here.
      return { status: 'REJECTED', code: 'RUN_NOT_OPEN', reason: (e as Error).message };
    }
    if (inserted === 'DUPLICATE') {
      const original = await this.store.findByIdempotencyKey(entry.idempotencyKey);
      if (original) return { status: 'DUPLICATE', entry: original };
    }

    const runStatus = await this.settle(run!.id);
    return { status: 'POSTED', entry, balance: await this.balance(run!.id), runStatus };
  }

  /** Recompute a run's status from its ledger. DEAD is recorded once, forever. */
  async settle(runId: string): Promise<RunStatus> {
    const run = await this.store.getRun(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    const balance = sumBalance(await this.store.listEntries(runId));
    const next = deriveRunStatus(run, balance);
    if (next !== run.status) {
      await this.store.transitionRun(runId, [run.status], {
        status: next,
        ...(next === 'DEAD' ? { diedAt: this.clock(), endReason: `balance ${balance} reached death threshold ${run.deathThreshold}` } : {}),
      });
    }
    return (await this.store.getRun(runId))?.status ?? next;
  }

  /** Post each priced AI/search call as its own expense entry. */
  async recordCosts(items: CostItem[], ctx: CostContext): Promise<PostResult[]> {
    const results: PostResult[] = [];
    for (const item of items) {
      if (item.posted) continue; // the spend gate already booked this call
      const amount = roundMoney(item.actualUsd);
      if (amount <= 0) continue; // a free call is not an expense
      const kind: LedgerKind = item.kind === 'AI' ? 'AI_EXPENSE' : 'SEARCH_EXPENSE';
      results.push(await this.post({
        kind,
        amount: -amount,
        description: `${item.kind === 'AI' ? 'AI call' : 'Search'} — ${item.provider} ${item.operation} (${ctx.reason})`,
        idempotencyKey: `cost:${ctx.sessionId}:${item.seq}`,
        recordedBy: ctx.channel === 'AUTO' ? 'engine' : 'operator',
        createdAt: item.at,
        metadata: {
          channel: ctx.channel,
          provider: item.provider,
          operation: item.operation,
          estimatedUsd: item.estimatedUsd,
          actualUsd: item.actualUsd,
          costBasis: item.costBasis,
          inputTokens: item.inputTokens,
          outputTokens: item.outputTokens,
          cycleId: ctx.cycleId,
          cycleIndex: ctx.cycleIndex,
          strategy: ctx.strategy,
          reason: ctx.reason,
          status: 'POSTED',
        },
      }));
    }
    return results;
  }

  /** An approved spend the operator has actually paid, with its receipt. */
  async recordOperatorExpense(input: { requestId: string; amount: number; vendor: string; purpose: string; receiptReference?: string; recordedBy: string; strategy?: string }): Promise<PostResult> {
    return this.post({
      kind: 'OPERATOR_EXPENSE',
      amount: -Math.abs(input.amount),
      description: `${input.vendor}: ${input.purpose}`,
      idempotencyKey: `operator-expense:${input.requestId}`,
      recordedBy: input.recordedBy,
      metadata: { requestId: input.requestId, vendor: input.vendor, receiptReference: input.receiptReference ?? null, strategy: input.strategy ?? null, status: 'POSTED' },
    });
  }

  /**
   * Credit money that a verifier has independently confirmed. The idempotency
   * key is the provider's payment reference, so the same payment can never be
   * credited twice — not even from two different revenue claims.
   */
  async confirmRevenue(input: VerifiedRevenueInput): Promise<{ payment: PostResult; fee?: PostResult }> {
    const ref = input.externalReference.trim();
    const payment = await this.post({
      kind: 'CUSTOMER_PAYMENT',
      amount: Math.abs(input.amount),
      currency: input.currency,
      description: input.description,
      idempotencyKey: `revenue:${input.verifier}:${ref}`,
      recordedBy: `verifier:${input.verifier}`,
      metadata: {
        verifier: input.verifier,
        verificationId: input.verificationId,
        externalReference: ref,
        paidAt: input.paidAt ?? null,
        claimId: input.claimId ?? null,
      },
    });
    let fee: PostResult | undefined;
    if (payment.status === 'POSTED' && input.processingFee && input.processingFee > 0) {
      fee = await this.post({
        kind: 'PROCESSING_FEE',
        amount: -Math.abs(input.processingFee),
        currency: input.currency,
        description: `Processing fee on ${input.verifier} payment ${ref}`,
        idempotencyKey: `fee:${input.verifier}:${ref}`,
        recordedBy: `verifier:${input.verifier}`,
        metadata: { verifier: input.verifier, externalReference: ref, verificationId: input.verificationId },
      });
    }
    return { payment, fee };
  }

  async snapshot(runId?: string): Promise<TreasurySnapshot> {
    const run = runId ? await this.store.getRun(runId) : await this.getCurrentRun();
    const entries = run ? await this.store.listEntries(run.id) : [];
    const total = (kinds: LedgerKind[]) => roundMoney(entries.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + e.amount, 0));
    const balance = sumBalance(entries);
    const startingCapital = total(['STARTING_CAPITAL']);
    return {
      run,
      balance,
      startingCapital,
      revenue: total(['CUSTOMER_PAYMENT']),
      expenses: -total(EXPENSE_KINDS.filter((k) => k !== 'PROCESSING_FEE')),
      fees: -total(['PROCESSING_FEE']),
      refunds: total(['REFUND_RECEIVED', 'REFUND_ISSUED']),
      adjustments: total(['ADJUSTMENT', 'LEGACY_UNCLASSIFIED']),
      netResult: roundMoney(balance - startingCapital),
      entryCount: entries.length,
    };
  }
}
