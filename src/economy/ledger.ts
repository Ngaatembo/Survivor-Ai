/* ============================================================================
 * Survivor economy — ledger rules (pure, no I/O).
 * ----------------------------------------------------------------------------
 * The single definition of what may move a Survivor run's balance.
 *
 *   balance(run) = SUM(amount) over that run's ledger entries
 *
 * There is no stored balance to mutate. Every balance change is an immutable
 * entry with an explicit kind, a sign fixed by that kind, and a unique
 * idempotency key, so the same real-world event can never be posted twice.
 *
 * A run is one experiment: it starts with exactly one STARTING_CAPITAL entry
 * and ends permanently when its balance reaches the death threshold. There is
 * no deposit path into an existing run — new capital means a new run.
 *
 * The same rules are enforced again in the database (migration 0022 triggers
 * and unique indexes) so a code path that skips this module still cannot
 * revive a dead run or double-post an event.
 * ========================================================================== */

export type RunEnvironment = 'PRODUCTION' | 'SANDBOX' | 'TEST';

/** CREATED: run exists, capital not posted yet.
 *  ALIVE: balance above the depleted threshold.
 *  DEPLETED: still alive, balance at or below the depleted threshold.
 *  DEAD: balance reached the death threshold. Terminal.
 *  ENDED: closed by an operator (e.g. superseded by a new run). Terminal. */
export type RunStatus = 'CREATED' | 'ALIVE' | 'DEPLETED' | 'DEAD' | 'ENDED';

export const OPEN_RUN_STATUSES: readonly RunStatus[] = ['CREATED', 'ALIVE', 'DEPLETED'];
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['DEAD', 'ENDED'];

export interface SurvivorRun {
  id: string;
  agentId: string;
  environment: RunEnvironment;
  status: RunStatus;
  currency: string;
  startingCapital: number;
  deathThreshold: number;
  depletedThreshold: number;
  label?: string;
  createdAt: number;
  startedAt?: number;
  diedAt?: number;
  endedAt?: number;
  endReason?: string;
  createdBy: string;
}

export type LedgerKind =
  // credits
  | 'STARTING_CAPITAL'
  | 'CUSTOMER_PAYMENT'
  | 'REFUND_RECEIVED'
  | 'TRANSFER_IN'
  // debits
  | 'AI_EXPENSE'
  | 'SEARCH_EXPENSE'
  | 'TOOL_EXPENSE'
  | 'OPERATOR_EXPENSE'
  | 'PROCESSING_FEE'
  | 'REFUND_ISSUED'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT'
  // history only — never written by current code
  | 'LEGACY_SIMULATION'
  | 'LEGACY_UNCLASSIFIED';

type Sign = 1 | -1;

/** Required sign of the amount for each writable kind. */
const KIND_SIGN: Partial<Record<LedgerKind, Sign>> = {
  STARTING_CAPITAL: 1,
  CUSTOMER_PAYMENT: 1,
  REFUND_RECEIVED: 1,
  TRANSFER_IN: 1,
  AI_EXPENSE: -1,
  SEARCH_EXPENSE: -1,
  TOOL_EXPENSE: -1,
  OPERATOR_EXPENSE: -1,
  PROCESSING_FEE: -1,
  REFUND_ISSUED: -1,
  TRANSFER_OUT: -1,
  // Downward corrections only. An upward "adjustment" would be a silent
  // deposit, which is exactly what a run must never accept.
  ADJUSTMENT: -1,
};

/** Legacy `transactions.type` (CHECK-constrained) for each kind, so existing
 *  readers and the dashboard keep working. */
export const LEGACY_TYPE_FOR_KIND: Record<LedgerKind, 'DEPOSIT' | 'REVENUE' | 'EXPENSE' | 'REFUND' | 'LOSS'> = {
  STARTING_CAPITAL: 'DEPOSIT',
  CUSTOMER_PAYMENT: 'REVENUE',
  REFUND_RECEIVED: 'REFUND',
  TRANSFER_IN: 'DEPOSIT',
  AI_EXPENSE: 'EXPENSE',
  SEARCH_EXPENSE: 'EXPENSE',
  TOOL_EXPENSE: 'EXPENSE',
  OPERATOR_EXPENSE: 'EXPENSE',
  PROCESSING_FEE: 'EXPENSE',
  REFUND_ISSUED: 'REFUND',
  TRANSFER_OUT: 'EXPENSE',
  ADJUSTMENT: 'LOSS',
  LEGACY_SIMULATION: 'EXPENSE',
  LEGACY_UNCLASSIFIED: 'EXPENSE',
};

export const EXPENSE_KINDS: readonly LedgerKind[] = [
  'AI_EXPENSE', 'SEARCH_EXPENSE', 'TOOL_EXPENSE', 'OPERATOR_EXPENSE', 'PROCESSING_FEE',
];

/** Revenue verification methods. Only PRODUCTION_VERIFIERS may credit a
 *  PRODUCTION run; SANDBOX_TEST exists so the accounting path can be proven
 *  end to end without real money, and is refused on PRODUCTION runs. */
export type RevenueVerifier = 'FINIVEX_PROVIDER' | 'SANDBOX_TEST';
export const PRODUCTION_VERIFIERS: readonly RevenueVerifier[] = ['FINIVEX_PROVIDER'];

export interface LedgerEntry {
  id: string;
  runId: string;
  agentId: string;
  kind: LedgerKind;
  /** Signed: positive in, negative out. */
  amount: number;
  currency: string;
  description: string;
  idempotencyKey: string;
  environment: RunEnvironment;
  /** Who/what caused the entry: 'engine', 'operator', 'provider:FINIVEX', … */
  recordedBy: string;
  metadata: Record<string, unknown>;
  /** Advisory checkpoint; the authoritative balance is always the sum. */
  balanceAfter: number;
  createdAt: number;
}

export type LedgerRejection =
  | 'NO_RUN'
  | 'RUN_NOT_OPEN'
  | 'RUN_NOT_STARTED'
  | 'RUN_ALREADY_STARTED'
  | 'ENVIRONMENT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_AMOUNT'
  | 'WRONG_SIGN'
  | 'KIND_NOT_WRITABLE'
  | 'CAPITAL_MISMATCH'
  | 'MISSING_IDEMPOTENCY_KEY'
  | 'MISSING_DESCRIPTION'
  | 'UNVERIFIED_REVENUE'
  | 'VERIFIER_NOT_ALLOWED'
  | 'REVENUE_BEFORE_RUN'
  | 'TRANSFERS_NOT_ENABLED';

export type LedgerValidation = { ok: true } | { ok: false; code: LedgerRejection; reason: string };

/** Ledger amounts carry up to 6 decimals: per-call AI/search costs are
 *  fractions of a cent and must not be rounded away. */
export function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function sumBalance(entries: Pick<LedgerEntry, 'amount'>[]): number {
  return roundMoney(entries.reduce((sum, e) => sum + e.amount, 0));
}

export interface ProposedEntry {
  kind: LedgerKind;
  amount: number;
  currency?: string;
  description: string;
  idempotencyKey: string;
  recordedBy: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
}

/**
 * Decide whether a proposed entry may be posted to `run`, given that run's
 * existing entries. Pure: callers persist only after { ok: true }.
 * Duplicate idempotency keys are handled by the caller (they are not an
 * error — the original entry is returned).
 */
export function validateEntry(
  run: SurvivorRun | null,
  existing: Pick<LedgerEntry, 'kind' | 'amount'>[],
  proposed: ProposedEntry,
): LedgerValidation {
  if (!run) return { ok: false, code: 'NO_RUN', reason: 'no Survivor run exists; create a run explicitly first' };
  if (!OPEN_RUN_STATUSES.includes(run.status)) {
    return { ok: false, code: 'RUN_NOT_OPEN', reason: `run ${run.id} is ${run.status}; a ${run.status} run accepts no further entries — create a new run` };
  }
  if (!proposed.idempotencyKey?.trim()) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', reason: 'every ledger entry needs an idempotency key' };
  if (!proposed.description?.trim()) return { ok: false, code: 'MISSING_DESCRIPTION', reason: 'every ledger entry needs a description' };

  const sign = KIND_SIGN[proposed.kind];
  if (!sign) return { ok: false, code: 'KIND_NOT_WRITABLE', reason: `${proposed.kind} is a history-only kind and cannot be written` };
  if (proposed.kind === 'TRANSFER_IN' || proposed.kind === 'TRANSFER_OUT') {
    // A run has a single account today. A transfer in from outside would be a
    // deposit by another name, so transfers stay disabled until Survivor has
    // more than one account of its own.
    return { ok: false, code: 'TRANSFERS_NOT_ENABLED', reason: 'transfers are disabled: a run has one account; external money must arrive as verified revenue or a new run' };
  }

  const amount = Number(proposed.amount);
  if (!Number.isFinite(amount) || roundMoney(amount) === 0) return { ok: false, code: 'INVALID_AMOUNT', reason: 'amount must be a finite, non-zero number' };
  if (Math.sign(amount) !== sign) {
    return { ok: false, code: 'WRONG_SIGN', reason: `${proposed.kind} must be ${sign > 0 ? 'positive' : 'negative'}` };
  }
  const currency = (proposed.currency ?? run.currency).toUpperCase();
  if (currency !== run.currency.toUpperCase()) {
    return { ok: false, code: 'CURRENCY_MISMATCH', reason: `run ${run.id} is denominated in ${run.currency}; got ${currency} (no FX conversion yet)` };
  }

  const hasCapital = existing.some((e) => e.kind === 'STARTING_CAPITAL');
  if (proposed.kind === 'STARTING_CAPITAL') {
    if (run.status !== 'CREATED' || hasCapital) {
      return { ok: false, code: 'RUN_ALREADY_STARTED', reason: `run ${run.id} already has its starting capital; new capital requires a new run` };
    }
    if (Math.abs(roundMoney(amount) - roundMoney(run.startingCapital)) > 1e-9) {
      return { ok: false, code: 'CAPITAL_MISMATCH', reason: `starting capital must equal the run's declared ${run.startingCapital}` };
    }
    return { ok: true };
  }
  if (run.status === 'CREATED' || !hasCapital) {
    return { ok: false, code: 'RUN_NOT_STARTED', reason: `run ${run.id} has not been started (no starting capital posted)` };
  }

  if (proposed.kind === 'CUSTOMER_PAYMENT' || proposed.kind === 'REFUND_RECEIVED') {
    const m = proposed.metadata ?? {};
    const verifier = m.verifier as RevenueVerifier | undefined;
    if (!verifier || !m.verificationId || !m.externalReference) {
      return { ok: false, code: 'UNVERIFIED_REVENUE', reason: 'money in must reference a completed verification (verifier, verificationId, externalReference)' };
    }
    if (run.environment === 'PRODUCTION' && !PRODUCTION_VERIFIERS.includes(verifier)) {
      return { ok: false, code: 'VERIFIER_NOT_ALLOWED', reason: `${verifier} cannot credit a PRODUCTION run` };
    }
    if (run.environment !== 'PRODUCTION' && verifier !== 'SANDBOX_TEST') {
      return { ok: false, code: 'VERIFIER_NOT_ALLOWED', reason: `a ${run.environment} run only accepts SANDBOX_TEST verification, so simulated and real money never mix` };
    }
    // Only a real timestamp is checked (Number(null) would be 0 = 1970).
    const paidAt = typeof m.paidAt === 'number' ? m.paidAt : NaN;
    if (Number.isFinite(paidAt) && run.startedAt && paidAt < run.startedAt) {
      return { ok: false, code: 'REVENUE_BEFORE_RUN', reason: 'payment predates this run and cannot be attributed to it' };
    }
  }

  return { ok: true };
}

/**
 * Status after the balance changed. DEAD and ENDED never change. A run is
 * DEAD as soon as its balance is at or below the death threshold.
 */
export function deriveRunStatus(run: SurvivorRun, balance: number): RunStatus {
  if (TERMINAL_RUN_STATUSES.includes(run.status)) return run.status;
  if (run.status === 'CREATED') return 'CREATED';
  if (balance <= run.deathThreshold + 1e-9) return 'DEAD';
  if (balance <= run.depletedThreshold + 1e-9) return 'DEPLETED';
  return 'ALIVE';
}

/** May the engine run a normal cycle / spend for this run? */
export function runAcceptsWork(run: SurvivorRun | null): { ok: true } | { ok: false; reason: string } {
  if (!run) return { ok: false, reason: 'NO_ACTIVE_RUN: no Survivor run exists; an operator must create one explicitly' };
  if (run.status === 'CREATED') return { ok: false, reason: `RUN_NOT_STARTED: run ${run.id} has no starting capital yet` };
  if (run.status === 'DEAD') return { ok: false, reason: `RUN_DEAD: run ${run.id} died${run.diedAt ? ` at ${new Date(run.diedAt).toISOString()}` : ''}; it cannot be revived — create a new run` };
  if (run.status === 'ENDED') return { ok: false, reason: `RUN_ENDED: run ${run.id} was ended (${run.endReason ?? 'no reason recorded'})` };
  return { ok: true };
}

/** Agent status shown on the dashboard for a run (agents.status CHECK values). */
export function agentStatusForRun(run: SurvivorRun | null): 'ALIVE' | 'AT_RISK' | 'DEAD' | 'PAUSED' {
  if (!run) return 'PAUSED';
  if (run.status === 'ALIVE') return 'ALIVE';
  if (run.status === 'DEPLETED') return 'AT_RISK';
  if (run.status === 'DEAD') return 'DEAD';
  return 'PAUSED';
}
