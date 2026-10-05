/* ============================================================================
 * Cost meter — Survivor pays for its own brain.
 * ----------------------------------------------------------------------------
 * Every paid AI call and search asks the meter BEFORE it runs and is recorded
 * AFTER it runs, as its own line item (provider, operation, estimated and
 * actual cost). Before each call:
 *   1. guard: kill switch and run status, read fresh from the server
 *      (authorize() only — the sync check() cannot see them),
 *   2. funds: the call's worst-case cost must not take the run's balance
 *      below its death threshold,
 *   3. daily cap: automatic spend per UTC day (default $0.40),
 *   4. session cap: optional limit per manual request.
 * Line items are posted to the ledger by Treasury.recordCosts — one entry
 * per call, each with its own idempotency key.
 * ========================================================================== */

import type { Transaction } from '../types';
import type { CostItem } from '../economy/treasury';
import type { Initiator, SpendGate, SpendRequestLimits } from '../economy/spendGate';

export interface CostPolicy {
  /** Max spend per UTC day for this channel, USD. */
  dailyCapUsd: number;
  /** The run's death threshold: no call may take the balance below it. */
  floorUsd: number;
  /** Max spend for one metered session (one manual request). */
  sessionCapUsd?: number;
}

export const DEFAULT_COST_POLICY: CostPolicy = { dailyCapUsd: 0.4, floorUsd: 0 };

/** Tag carried by automatic cost entries written before migration 0022. */
export const AUTO_COST_TAG = '[AUTO]';

export type CostChannel = 'AUTO' | 'MANUAL';

export interface LlmPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

/** Published list prices; override with LLM_INPUT_USD_PER_MTOK /
 *  LLM_OUTPUT_USD_PER_MTOK. Gemini defaults to 0 because a key without
 *  billing only runs on Google's free tier. */
export const DEFAULT_LLM_PRICING: Record<'claude' | 'openai' | 'gemini', LlmPricing> = {
  claude: { inputUsdPerMTok: 1, outputUsdPerMTok: 5 }, // Claude Haiku 4.5
  openai: { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 }, // gpt-4o-mini
  gemini: { inputUsdPerMTok: 0, outputUsdPerMTok: 0 }, // free tier
};

/* Search prices are deliberately NOT defaulted here: see
 * src/economy/spendLimits.ts (TAVILY_USD_PER_CREDIT, BRAVE_USD_PER_QUERY).
 * An unpriced provider cannot be called. */

export function llmCostUsd(pricing: LlmPricing, inputTokens: number, outputTokens: number): number {
  return (inputTokens * pricing.inputUsdPerMTok + outputTokens * pricing.outputUsdPerMTok) / 1_000_000;
}

/** Worst-case cost of one call, used for the pre-call check: prompt tokens
 *  estimated at ~4 characters each, output at the full max_tokens. */
export function estimateLlmCostUsd(pricing: LlmPricing, promptChars: number, maxOutputTokens: number): number {
  return llmCostUsd(pricing, Math.ceil(promptChars / 4), maxOutputTokens);
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Spend already recorded today (UTC) on the given channel. */
export function spentToday(transactions: Transaction[], channel: CostChannel, now = Date.now()): number {
  const day = utcDay(now);
  return transactions
    .filter((t) => t.amount < 0 && utcDay(t.createdAt) === day)
    .filter((t) => {
      if (t.kind === 'AI_EXPENSE' || t.kind === 'SEARCH_EXPENSE') return (t.metadata?.channel ?? 'AUTO') === channel;
      // Pre-0022 rows: automatic costs were tagged in the description.
      return channel === 'AUTO' && t.type === 'EXPENSE' && t.description.includes(AUTO_COST_TAG);
    })
    .reduce((sum, t) => sum + Math.max(0, -t.amount), 0);
}

/** Automatic AI + search spend already recorded today (UTC). */
export function autoSpentToday(transactions: Transaction[], now = Date.now()): number {
  return spentToday(transactions, 'AUTO', now);
}

export type SpendBlock =
  | 'KILL_SWITCH' | 'RUN_CLOSED' | 'AUTONOMY_DISABLED' | 'PRICING_UNKNOWN'
  | 'INSUFFICIENT_FUNDS' | 'DAILY_CAP' | 'SESSION_CAP' | 'GATE_REFUSED';
export type SpendCheck = { ok: true } | { ok: false; reason: SpendBlock; detail?: string };

/** Fresh server-side check run before every paid call: returns a reason to
 *  refuse (kill switch engaged, run dead/ended) or null to proceed. */
export type SpendGuard = () => Promise<{ reason: 'KILL_SWITCH' | 'RUN_CLOSED' | 'AUTONOMY_DISABLED'; detail: string } | null>;

/** Atomic server-side authorization (src/economy/spendGate.ts). When a
 *  meter has a gate, every paid call must obtain a reservation first. */
export interface MeterGate {
  gate: SpendGate;
  runId: string;
  initiatedBy: Initiator;
  sessionId: string;
  reason: string;
  limits: SpendRequestLimits;
}

/** Proof that a specific paid call was authorized. */
export interface SpendTicket {
  seq: number;
  kind: 'AI' | 'SEARCH';
  provider: string;
  operation: string;
  units: number;
  unit: string;
  estimatedUsd: number;
  authorizationId?: string;
}

export class CostMeter {
  readonly policy: CostPolicy;
  readonly channel: CostChannel;
  private readonly spentBeforeUsd: number;
  private readonly balanceUsd: number;
  private readonly guard?: SpendGuard;
  private readonly meterGate?: MeterGate;
  private seq = 0;
  items: CostItem[] = [];
  spentUsd = 0;
  llmCalls = 0;
  searchCalls = 0;
  inputTokens = 0;
  outputTokens = 0;
  blocked: Record<SpendBlock, number> = {
    KILL_SWITCH: 0, RUN_CLOSED: 0, AUTONOMY_DISABLED: 0, PRICING_UNKNOWN: 0,
    INSUFFICIENT_FUNDS: 0, DAILY_CAP: 0, SESSION_CAP: 0, GATE_REFUSED: 0,
  };
  lastBlock: string | null = null;

  constructor(opts: { balanceUsd: number; spentTodayUsd: number; policy?: Partial<CostPolicy>; guard?: SpendGuard; channel?: CostChannel; gate?: MeterGate }) {
    this.policy = { ...DEFAULT_COST_POLICY, ...(opts.policy ?? {}) };
    this.balanceUsd = opts.balanceUsd;
    this.spentBeforeUsd = opts.spentTodayUsd;
    this.guard = opts.guard;
    this.channel = opts.channel ?? 'AUTO';
    this.meterGate = opts.gate;
  }

  /** True when every paid call must be authorized by the atomic gate. */
  get gated(): boolean {
    return Boolean(this.meterGate);
  }

  static fromLedger(
    transactions: Transaction[],
    policy?: Partial<CostPolicy>,
    now = Date.now(),
    opts: { guard?: SpendGuard; channel?: CostChannel; gate?: MeterGate } = {},
  ): CostMeter {
    const balance = transactions.reduce((sum, t) => sum + t.amount, 0);
    const channel = opts.channel ?? 'AUTO';
    return new CostMeter({ balanceUsd: balance, spentTodayUsd: spentToday(transactions, channel, now), policy, guard: opts.guard, channel, gate: opts.gate });
  }

  /** Money left above the death threshold after this session's spend. */
  get availableUsd(): number {
    return this.balanceUsd - this.spentUsd - this.policy.floorUsd;
  }

  /** True once the run cannot afford any paid call at all. */
  get exhausted(): boolean {
    return this.availableUsd <= 0;
  }

  get spentTodayUsd(): number {
    return this.spentBeforeUsd + this.spentUsd;
  }

  get remainingTodayUsd(): number {
    return Math.max(0, this.policy.dailyCapUsd - this.spentTodayUsd);
  }

  private refuse(reason: SpendBlock, detail?: string): SpendCheck {
    this.blocked[reason] += 1;
    this.lastBlock = detail ? `${reason}: ${detail}` : reason;
    return { ok: false, reason, detail };
  }

  /** Funds and caps only. Prefer authorize(), which also checks the guard. */
  check(estimateUsd: number): SpendCheck {
    const estimate = Math.max(0, estimateUsd);
    if (estimate > this.availableUsd + 1e-12 || this.availableUsd <= 0) {
      return this.refuse('INSUFFICIENT_FUNDS', `needs up to $${estimate.toFixed(4)}, $${Math.max(0, this.availableUsd).toFixed(4)} available above the death threshold`);
    }
    if (this.spentTodayUsd + estimate > this.policy.dailyCapUsd + 1e-9) return this.refuse('DAILY_CAP');
    if (this.policy.sessionCapUsd !== undefined && this.spentUsd + estimate > this.policy.sessionCapUsd + 1e-9) return this.refuse('SESSION_CAP');
    return { ok: true };
  }

  /** The pre-call gate for every paid operation. */
  async authorize(estimateUsd: number): Promise<SpendCheck> {
    if (this.guard) {
      let block: Awaited<ReturnType<SpendGuard>>;
      try {
        block = await this.guard();
      } catch (e) {
        block = { reason: 'KILL_SWITCH', detail: `guard unavailable (${(e as Error).message}) — failing closed` };
      }
      if (block) return this.refuse(block.reason, block.detail);
    }
    return this.check(estimateUsd);
  }

  /**
   * Authorize ONE paid call before it is made. Order: guard (kill switch,
   * run, autonomy) → price known → local caps → atomic gate reservation.
   * Only a returned ticket permits the request.
   */
  async authorizeCall(call: { kind: 'AI' | 'SEARCH'; provider: string; operation: string; units: number; unit: string; estimatedUsd: number | undefined }): Promise<{ ok: true; ticket: SpendTicket } | { ok: false; reason: SpendBlock; detail?: string }> {
    if (call.estimatedUsd === undefined || !Number.isFinite(call.estimatedUsd) || (this.gated && call.estimatedUsd <= 0)) {
      const r = this.refuse('PRICING_UNKNOWN', `${call.provider}: no configured price — the call cannot be costed, so it is not made`);
      return r as { ok: false; reason: SpendBlock; detail?: string };
    }
    const local = await this.authorize(call.estimatedUsd);
    if (!local.ok) return local;
    const seq = ++this.seq;
    const ticket: SpendTicket = { seq, kind: call.kind, provider: call.provider, operation: call.operation, units: call.units, unit: call.unit, estimatedUsd: call.estimatedUsd };
    if (this.meterGate) {
      const g = this.meterGate;
      const reserved = await g.gate.reserve({
        idempotencyKey: `${g.sessionId}:${seq}`,
        runId: g.runId,
        initiatedBy: g.initiatedBy,
        channel: this.channel,
        provider: call.provider,
        operation: call.operation,
        units: call.units,
        unit: call.unit,
        amountUsd: call.estimatedUsd,
        sessionId: g.sessionId,
        reason: g.reason,
        limits: g.limits,
      });
      if (!reserved.ok) {
        const r = this.refuse(reserved.code === 'KILL_SWITCH' ? 'KILL_SWITCH' : reserved.code === 'RUN_CLOSED' ? 'RUN_CLOSED' : 'GATE_REFUSED', `${reserved.code}: ${reserved.detail}`);
        return r as { ok: false; reason: SpendBlock; detail?: string };
      }
      ticket.authorizationId = reserved.id;
    }
    // Count the reservation now so later checks in this session see it.
    this.spentUsd += call.estimatedUsd;
    return { ok: true, ticket };
  }

  /**
   * Close a ticket after the provider answered.
   *   OK          provider served the call: actual cost recorded (ledger now)
   *   NOT_BILLED  provider definitely refused it (HTTP 4xx): reservation released
   *   UNCERTAIN   timeout / network / 5xx: reservation kept, still counted
   */
  async settleCall(ticket: SpendTicket, outcome: 'OK' | 'NOT_BILLED' | 'UNCERTAIN', actualUsd = ticket.estimatedUsd, detail: { inputTokens?: number; outputTokens?: number } = {}): Promise<void> {
    this.spentUsd -= ticket.estimatedUsd; // replace the reservation with the outcome
    if (outcome === 'NOT_BILLED') {
      if (this.meterGate && ticket.authorizationId) await this.meterGate.gate.release(ticket.authorizationId, 'provider refused the request (not billed)');
      return;
    }
    if (outcome === 'UNCERTAIN') {
      this.spentUsd += ticket.estimatedUsd; // keep counting the worst case
      return;
    }
    const cost = Math.max(0, actualUsd);
    if (ticket.kind === 'AI') {
      this.llmCalls += 1;
      this.inputTokens += detail.inputTokens ?? 0;
      this.outputTokens += detail.outputTokens ?? 0;
    } else {
      this.searchCalls += 1;
    }
    this.spentUsd += cost;
    const item: CostItem = {
      seq: ticket.seq, kind: ticket.kind, provider: ticket.provider, operation: ticket.operation,
      estimatedUsd: ticket.estimatedUsd, actualUsd: cost,
      costBasis: ticket.kind === 'AI' ? 'TOKEN_USAGE_X_PRICE' : 'CONFIGURED_PRICE', at: Date.now(),
      inputTokens: detail.inputTokens, outputTokens: detail.outputTokens,
    };
    if (this.meterGate && ticket.authorizationId) {
      const settled = await this.meterGate.gate.settle(ticket.authorizationId, cost, {
        kind: ticket.kind === 'AI' ? 'AI_EXPENSE' : 'SEARCH_EXPENSE',
        description: `${ticket.kind === 'AI' ? 'AI call' : 'Search'} — ${ticket.provider} ${ticket.operation} (${this.meterGate.reason})`,
        metadata: { units: ticket.units, unit: ticket.unit, sessionId: this.meterGate.sessionId, costBasis: item.costBasis, inputTokens: detail.inputTokens, outputTokens: detail.outputTokens },
      });
      item.posted = settled.ok;
    }
    this.items.push(item);
  }

  recordLlm(costUsd: number, inputTokens: number, outputTokens: number, detail: { provider?: string; operation?: string; estimatedUsd?: number } = {}): void {
    const cost = Math.max(0, costUsd);
    this.llmCalls += 1;
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.spentUsd += cost;
    this.items.push({
      seq: ++this.seq, kind: 'AI', provider: detail.provider ?? 'llm', operation: detail.operation ?? 'completion',
      estimatedUsd: detail.estimatedUsd ?? cost, actualUsd: cost, costBasis: 'TOKEN_USAGE_X_PRICE', at: Date.now(),
      inputTokens, outputTokens,
    });
  }

  recordSearch(costUsd: number, detail: { provider?: string; operation?: string } = {}): void {
    const cost = Math.max(0, costUsd);
    this.searchCalls += 1;
    this.spentUsd += cost;
    this.items.push({
      seq: ++this.seq, kind: 'SEARCH', provider: detail.provider ?? 'search', operation: detail.operation ?? 'query',
      estimatedUsd: cost, actualUsd: cost, costBasis: 'CONFIGURED_PRICE', at: Date.now(),
    });
  }

  get blockedTotal(): number {
    return Object.values(this.blocked).reduce((a, b) => a + b, 0);
  }

  /** One-line account for logs. */
  summary(): string {
    const parts = [
      `${this.llmCalls} AI call(s)`,
      `${this.searchCalls} search(es)`,
      `$${this.spentUsd.toFixed(4)} spent`,
      `$${this.spentTodayUsd.toFixed(4)} of $${this.policy.dailyCapUsd.toFixed(2)} used today (${this.channel})`,
    ];
    for (const [reason, count] of Object.entries(this.blocked)) {
      if (count) parts.push(`${count} call(s) refused: ${reason}`);
    }
    return parts.join(', ');
  }
}
