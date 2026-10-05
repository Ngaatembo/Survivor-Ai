/* ============================================================================
 * Survivor economy — spending limits and provider prices (one place).
 * ----------------------------------------------------------------------------
 * Every value here is a Worker variable (wrangler.toml [vars] or
 * `wrangler secret put`); the defaults apply only when a variable is unset.
 *
 *   AUTONOMOUS_PAID_CALLS          "enabled" to let Survivor's own cycles make
 *                                  paid AI/search calls. Anything else (incl.
 *                                  unset) = disabled. Default: DISABLED.
 *   PER_CALL_CAP_USD               max authorized cost of one provider call
 *   AUTO_PER_CYCLE_CAP_USD         max a single Survivor cycle may authorize
 *   AUTO_DAILY_CAP_USD             max Survivor-initiated spend per UTC day
 *     (legacy name DAILY_SPEND_CAP_USD is still read)
 *   MANUAL_PER_REQUEST_CAP_USD     max one operator request may authorize
 *   MANUAL_DAILY_CAP_USD           max operator-initiated spend per UTC day
 *   TOTAL_DAILY_CAP_USD            max of both channels together per UTC day
 *   MIN_RUNWAY_RESERVE_USD         a call is refused if afterwards the run's
 *                                  balance (minus unsettled reservations)
 *                                  would fall below death threshold + this
 *
 * Prices are NOT defaulted. A provider without a configured price cannot be
 * called (PRICING_UNKNOWN) — an unpriced call is exactly how 600+ cycles
 * booked $0 while Tavily was consuming credits.
 *   TAVILY_USD_PER_CREDIT   your plan's $ per Tavily credit. Tavily's public
 *                           docs: basic search = 1 credit, advanced = 2.
 *   BRAVE_USD_PER_QUERY     your plan's $ per Brave query.
 * ========================================================================== */

export interface SpendLimits {
  autonomousPaidCalls: boolean;
  perCallUsd: number;
  autoPerCycleUsd: number;
  autoDailyUsd: number;
  manualPerRequestUsd: number;
  manualDailyUsd: number;
  totalDailyUsd: number;
  runwayReserveUsd: number;
}

export const SPEND_LIMIT_DEFAULTS: SpendLimits = {
  autonomousPaidCalls: false,
  perCallUsd: 0.05,
  autoPerCycleUsd: 0.1,
  autoDailyUsd: 0.4,
  manualPerRequestUsd: 0.25,
  manualDailyUsd: 1,
  totalDailyUsd: 1.4,
  runwayReserveUsd: 10,
};

export interface ProviderPrices {
  /** USD per Tavily credit; undefined = PRICING UNKNOWN (calls refused). */
  tavilyUsdPerCredit?: number;
  /** USD per Brave query; undefined = PRICING UNKNOWN (calls refused). */
  braveUsdPerQuery?: number;
}

type EnvLike = Record<string, string | undefined>;

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** A configured price must be a positive number; anything else is unknown. */
function price(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function spendLimitsFromEnv(env: EnvLike): SpendLimits {
  const d = SPEND_LIMIT_DEFAULTS;
  return {
    autonomousPaidCalls: (env.AUTONOMOUS_PAID_CALLS ?? '').trim().toLowerCase() === 'enabled',
    perCallUsd: num(env.PER_CALL_CAP_USD, d.perCallUsd),
    autoPerCycleUsd: num(env.AUTO_PER_CYCLE_CAP_USD, d.autoPerCycleUsd),
    autoDailyUsd: num(env.AUTO_DAILY_CAP_USD ?? env.DAILY_SPEND_CAP_USD, d.autoDailyUsd),
    manualPerRequestUsd: num(env.MANUAL_PER_REQUEST_CAP_USD, d.manualPerRequestUsd),
    manualDailyUsd: num(env.MANUAL_DAILY_CAP_USD, d.manualDailyUsd),
    totalDailyUsd: num(env.TOTAL_DAILY_CAP_USD, d.totalDailyUsd),
    runwayReserveUsd: num(env.MIN_RUNWAY_RESERVE_USD, d.runwayReserveUsd),
  };
}

export function providerPricesFromEnv(env: EnvLike): ProviderPrices {
  return {
    tavilyUsdPerCredit: price(env.TAVILY_USD_PER_CREDIT),
    braveUsdPerQuery: price(env.BRAVE_USD_PER_QUERY),
  };
}

/** Tavily bills by search depth: basic = 1 credit, advanced = 2 credits
 *  (Tavily API credits documentation). Mirrors the depth choice in
 *  services/providers/search.ts. */
export function tavilyCreditsForQuery(query: string): number {
  return /^\s*site:\S+\s+/i.test(query) ? 1 : 2;
}
