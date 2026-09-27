/* ============================================================================
 * Cost meter — Survivor pays for its own brain.
 * ----------------------------------------------------------------------------
 * Every paid AI call and search is checked against two rules BEFORE it runs
 * and recorded AFTER it runs:
 *   1. Daily cap: automatic AI + search spend is capped per UTC day
 *      (default $0.40, agreed 27 Sep 2026).
 *   2. Dormant floor: once the REAL treasury is at or below the floor
 *      (default $10), no paid call runs at all. The bot keeps doing free
 *      work and wakes up when revenue or a top-up lifts it above the floor.
 * What was spent is written to the real ledger as one "[AUTO]" EXPENSE per
 * cycle (or per manual action), so the treasury balance is real money.
 * ========================================================================== */

import type { Transaction } from '../types';

export interface CostPolicy {
  /** Max automatic AI + search spend per UTC day, USD. */
  dailyCapUsd: number;
  /** At or below this real balance the bot is dormant: no paid calls. */
  floorUsd: number;
}

export const DEFAULT_COST_POLICY: CostPolicy = { dailyCapUsd: 0.4, floorUsd: 10 };

/** Tag carried by every automatic cost entry in the ledger. */
export const AUTO_COST_TAG = '[AUTO]';

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

/** Automatic AI + search spend already recorded today (UTC). */
export function autoSpentToday(transactions: Transaction[], now = Date.now()): number {
  const day = utcDay(now);
  return transactions
    .filter((t) => t.type === 'EXPENSE' && t.description.includes(AUTO_COST_TAG) && utcDay(t.createdAt) === day)
    .reduce((sum, t) => sum + Math.max(0, -t.amount), 0);
}

export function isDormant(balanceUsd: number, policy: CostPolicy = DEFAULT_COST_POLICY): boolean {
  return balanceUsd <= policy.floorUsd;
}

export type SpendCheck = { ok: true } | { ok: false; reason: 'DORMANT' | 'DAILY_CAP' };

export class CostMeter {
  readonly policy: CostPolicy;
  private readonly spentBeforeUsd: number;
  private readonly balanceUsd: number;
  spentUsd = 0;
  llmCalls = 0;
  searchCalls = 0;
  inputTokens = 0;
  outputTokens = 0;
  blocked: { DORMANT: number; DAILY_CAP: number } = { DORMANT: 0, DAILY_CAP: 0 };

  constructor(opts: { balanceUsd: number; spentTodayUsd: number; policy?: Partial<CostPolicy> }) {
    this.policy = { ...DEFAULT_COST_POLICY, ...(opts.policy ?? {}) };
    this.balanceUsd = opts.balanceUsd;
    this.spentBeforeUsd = opts.spentTodayUsd;
  }

  static fromLedger(transactions: Transaction[], policy?: Partial<CostPolicy>, now = Date.now()): CostMeter {
    const balance = transactions.reduce((sum, t) => sum + t.amount, 0);
    return new CostMeter({ balanceUsd: balance, spentTodayUsd: autoSpentToday(transactions, now), policy });
  }

  get dormant(): boolean {
    return isDormant(this.balanceUsd - this.spentUsd, this.policy);
  }

  get spentTodayUsd(): number {
    return this.spentBeforeUsd + this.spentUsd;
  }

  get remainingTodayUsd(): number {
    return Math.max(0, this.policy.dailyCapUsd - this.spentTodayUsd);
  }

  /** Ask before a paid call. A refusal is counted so the cycle can report it. */
  check(estimateUsd: number): SpendCheck {
    if (this.dormant) {
      this.blocked.DORMANT += 1;
      return { ok: false, reason: 'DORMANT' };
    }
    if (this.spentTodayUsd + Math.max(0, estimateUsd) > this.policy.dailyCapUsd + 1e-9) {
      this.blocked.DAILY_CAP += 1;
      return { ok: false, reason: 'DAILY_CAP' };
    }
    return { ok: true };
  }

  recordLlm(costUsd: number, inputTokens: number, outputTokens: number): void {
    this.llmCalls += 1;
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.spentUsd += Math.max(0, costUsd);
  }

  recordSearch(costUsd: number): void {
    this.searchCalls += 1;
    this.spentUsd += Math.max(0, costUsd);
  }

  get blockedTotal(): number {
    return this.blocked.DORMANT + this.blocked.DAILY_CAP;
  }

  /** One-line account for logs. */
  summary(): string {
    const parts = [
      `${this.llmCalls} AI call(s)`,
      `${this.searchCalls} search(es)`,
      `$${this.spentUsd.toFixed(4)} spent`,
      `$${this.spentTodayUsd.toFixed(2)} of $${this.policy.dailyCapUsd.toFixed(2)} used today`,
    ];
    if (this.blocked.DAILY_CAP) parts.push(`${this.blocked.DAILY_CAP} call(s) skipped at the daily cap`);
    if (this.blocked.DORMANT) parts.push(`${this.blocked.DORMANT} call(s) skipped while dormant`);
    return parts.join(', ');
  }

  /** The ledger entry for what this session spent, or null if nothing. */
  toExpense(transactions: Transaction[], label: string, now = Date.now()): Transaction | null {
    const amount = Math.round(this.spentUsd * 10000) / 10000;
    if (amount <= 0) return null;
    const before = transactions.reduce((sum, t) => sum + t.amount, 0);
    return {
      id: `tx_cost_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'EXPENSE',
      amount: -amount,
      description: `${AUTO_COST_TAG} AI + search costs — ${label} (${this.llmCalls} AI call(s), ${this.searchCalls} search(es), ${this.inputTokens + this.outputTokens} tokens)`,
      balanceAfter: Math.round((before - amount) * 10000) / 10000,
      createdAt: now,
      ledger: 'REAL',
    };
  }
}
