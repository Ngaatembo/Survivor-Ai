/* ============================================================================
 * SURVIVE AI — Search Economy orchestrator (Phases 2–5, 9–15 glue)
 * ----------------------------------------------------------------------------
 * The single call site every research module (liveResearch, prospectDiscovery,
 * prospectIntelligence, marketPricing) should use instead of calling a
 * SearchProvider directly. It:
 *   1. asks shouldSearch() whether this is worth doing at all,
 *   2. serves a cached result when one is still valid,
 *   3. otherwise calls the policy-selected provider (with fallback),
 *   4. records the outcome (log + cache) and returns it.
 *
 * Never throws on a budget breach — returns a structured
 * { budgetExceeded: true } result and the caller continues with whatever it
 * already has (Phase 10: "DO NOT crash... continue using cached information").
 * ========================================================================== */

import type { AgentStatus } from '../types';
import type { EngineRepository } from '../engine/repository';
import type { LLMProvider, SearchProvider, SearchResult } from './providers/types';
import type { CostMeter, SpendBlock, SpendTicket } from '../lib/costMeter';
import { tavilyCreditsForQuery, type ProviderPrices } from '../economy/spendLimits';
import { SearchProviderError } from './providers/search';
import {
  emptyState,
  recordSearch,
  selectProvider,
  shouldSearch,
  summarizeSearchEconomy,
  type SearchEconomyState,
  type SearchEconomySummary,
  type SearchProviderId,
  type SearchPurpose,
} from './searchBudget';

const KV_KEY = 'search_economy_state';

/** Load the persisted economy state from the repository's KV store (falls
 *  back to a fresh, empty state on first run or any parse failure — never
 *  blocks a cycle over corrupted budget bookkeeping). */
export async function loadEconomyState(repo: EngineRepository): Promise<SearchEconomyState> {
  try {
    const raw = await repo.getKV(KV_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.log) || typeof parsed.cache !== 'object') return emptyState();
    return parsed as SearchEconomyState;
  } catch {
    return emptyState();
  }
}

export async function saveEconomyState(repo: EngineRepository, state: SearchEconomyState): Promise<void> {
  try {
    await repo.setKV(KV_KEY, JSON.stringify(state));
  } catch {
    // Persistence is best-effort: losing one cycle's budget ledger degrades
    // to "search a bit more than intended", never a crash.
  }
}

export interface SearchEconomyContext {
  state: SearchEconomyState;
  providers: { tavily: SearchProvider | null; brave: SearchProvider | null };
  survivalStatus: AgentStatus;
  now: number;
  cycleStartedAt: number;
  /** Mutated in place across a cycle's worth of runSearch() calls; the
   *  caller (agentEngine) persists it once at the end via saveEconomyState. */
  onLog?: (message: string) => void;
  /** Run cost meter. Cache hits are free and never checked; a real provider
   *  call is authorized first (kill switch, run status, funds, caps) and
   *  charged its price after, as its own ledger line item. */
  meter?: CostMeter | null;
  /** Price of one real search call in USD, applied to every provider.
   *  Superseded per provider by `searchPrices`. */
  searchCostUsd?: number;
  /** Price of one real search call per provider, USD. */
  searchPrices?: Partial<Record<'tavily' | 'brave', number>>;
  /** Refuse real provider calls when no meter is attached (the Worker sets
   *  this, so no route can search without the cost being accounted). */
  requireMeter?: boolean;
  /** Configured provider prices in their billing unit (Tavily credits,
   *  Brave queries). When set, an unpriced provider is never called. */
  providerPrices?: ProviderPrices;
}

function searchPrice(ctx: SearchEconomyContext, provider: 'tavily' | 'brave' | 'none'): number {
  if (provider === 'none') return 0;
  const specific = ctx.searchPrices?.[provider];
  const value = specific ?? ctx.searchCostUsd ?? 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export interface RunSearchOptions {
  purpose: SearchPurpose;
  query: string;
  entityId?: string;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  statusChanged?: boolean;
  offerPending?: boolean;
  max?: number;
}

export interface RunSearchResult {
  results: SearchResult[];
  cacheHit: boolean;
  budgetExceeded: boolean;
  skippedReason?: string;
  providerUsed: SearchProviderId;
}

/** The one call site. Threads through shouldSearch()'s decision, calls the
 *  policy-selected provider on a real miss, and always updates ctx.state so
 *  subsequent calls within the same cycle see up-to-date budget usage. */
export async function runSearch(ctx: SearchEconomyContext, opts: RunSearchOptions): Promise<RunSearchResult> {
  const decision = shouldSearch(ctx.state, {
    purpose: opts.purpose,
    query: opts.query,
    entityId: opts.entityId,
    now: ctx.now,
    cycleStartedAt: ctx.cycleStartedAt,
    survivalStatus: ctx.survivalStatus,
    statusChanged: opts.statusChanged,
    offerPending: opts.offerPending,
    priority: opts.priority,
  });

  if (!decision.allow) {
    if (decision.reason === 'CACHE_HIT') {
      ctx.state = recordSearch(ctx.state, {
        ts: ctx.now,
        purpose: opts.purpose,
        provider: decision.cached.provider,
        query: opts.query,
        entityId: opts.entityId,
        cacheHit: true,
      });
      return { results: decision.cached.results as SearchResult[], cacheHit: true, budgetExceeded: false, providerUsed: decision.cached.provider };
    }
    if (decision.reason === 'SEARCH_BUDGET_EXCEEDED') {
      ctx.onLog?.(
        `SEARCH_BUDGET_EXCEEDED: ${opts.purpose} blocked at ${decision.scope} limit (cycle ${decision.usage.cycle}, day ${decision.usage.day}, month ${decision.usage.month}).`,
      );
      return { results: [], cacheHit: false, budgetExceeded: true, skippedReason: `SEARCH_BUDGET_EXCEEDED (${decision.scope})`, providerUsed: 'none' };
    }
    return { results: [], cacheHit: false, budgetExceeded: false, skippedReason: decision.reason, providerUsed: 'none' };
  }

  const providerId = selectProvider(
    opts.purpose,
    { tavily: Boolean(ctx.providers.tavily?.connected), brave: Boolean(ctx.providers.brave?.connected) },
    ctx.survivalStatus,
  );
  const provider = providerId === 'tavily' ? ctx.providers.tavily : providerId === 'brave' ? ctx.providers.brave : null;
  if (!provider) {
    return { results: [], cacheHit: false, budgetExceeded: false, skippedReason: 'NO_PROVIDER_CONFIGURED', providerUsed: 'none' };
  }

  if (!ctx.meter && ctx.requireMeter) {
    return { results: [], cacheHit: false, budgetExceeded: false, skippedReason: 'UNMETERED_SEARCH_REFUSED', providerUsed: 'none' };
  }

  const purposeOp = `${opts.purpose.toLowerCase()} search`;
  const skippedFor = (reason: SpendBlock): RunSearchResult => ({
    results: [],
    cacheHit: false,
    budgetExceeded: reason === 'DAILY_CAP',
    skippedReason:
      reason === 'KILL_SWITCH' ? 'KILL_SWITCH_ENGAGED'
      : reason === 'RUN_CLOSED' ? 'RUN_NOT_ALIVE'
      : reason === 'AUTONOMY_DISABLED' ? 'AUTONOMOUS_SPEND_DISABLED'
      : reason === 'PRICING_UNKNOWN' ? 'PRICING_UNKNOWN'
      : reason === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS'
      : reason === 'SESSION_CAP' ? 'REQUEST_SPEND_CAP'
      : reason === 'GATE_REFUSED' ? 'SPEND_NOT_AUTHORIZED'
      : 'DAILY_SPEND_CAP',
    providerUsed: 'none',
  });

  /** One provider call: authorized first (its own ticket), then settled. */
  const call = async (
    id: 'tavily' | 'brave',
    p: SearchProvider,
  ): Promise<{ ok: true; results: SearchResult[] } | { ok: false; refused?: SpendBlock; error?: unknown }> => {
    let ticket: SpendTicket | undefined;
    if (ctx.meter) {
      const q = quoteSearch(ctx, id, opts.query);
      const auth = await ctx.meter.authorizeCall({ kind: 'SEARCH', provider: id, operation: purposeOp, units: q.units, unit: q.unit, estimatedUsd: q.usd });
      if (!auth.ok) return { ok: false, refused: auth.reason };
      ticket = auth.ticket;
    }
    try {
      const results = await p.search(opts.query, opts.max ?? 5);
      if (ticket) await ctx.meter!.settleCall(ticket, 'OK');
      return { ok: true, results };
    } catch (error) {
      // A 4xx refusal (quota, plan, credentials) is not billed; a timeout,
      // network error or 5xx may have been, so it stays reserved.
      if (ticket) {
        const notBilled = error instanceof SearchProviderError && error.status >= 400 && error.status < 500;
        await ctx.meter!.settleCall(ticket, notBilled ? 'NOT_BILLED' : 'UNCERTAIN');
      }
      return { ok: false, error };
    }
  };

  let results: SearchResult[] = [];
  let usedProvider: SearchProviderId = providerId;
  const primaryId = providerId as 'tavily' | 'brave';
  const first = await call(primaryId, provider);
  if (first.ok) {
    results = first.results;
  } else if (first.refused) {
    return skippedFor(first.refused);
  } else if (first.error instanceof SearchProviderError) {
    // A hard provider quota/rate/credential failure: fail over to the other
    // configured provider — which needs its own authorization.
    const fallbackId: 'tavily' | 'brave' = primaryId === 'tavily' ? 'brave' : 'tavily';
    const fallback = ctx.providers[fallbackId];
    if (fallback?.connected) {
      usedProvider = fallbackId;
      const second = await call(fallbackId, fallback);
      if (second.ok) results = second.results;
      else if (second.refused) return skippedFor(second.refused);
    }
  }

  ctx.state = recordSearch(
    ctx.state,
    { ts: ctx.now, purpose: opts.purpose, provider: usedProvider, query: opts.query, entityId: opts.entityId, cacheHit: false },
    results,
  );

  return { results, cacheHit: false, budgetExceeded: false, providerUsed: usedProvider };
}

/**
 * Price of one call, in the provider's billing unit. With providerPrices
 * set (the Worker), an unconfigured price is undefined → PRICING_UNKNOWN.
 * Without it (legacy tests/demo), the flat per-call price is used.
 */
function quoteSearch(ctx: SearchEconomyContext, provider: 'tavily' | 'brave', query: string): { units: number; unit: string; usd: number | undefined } {
  if (ctx.providerPrices) {
    if (provider === 'tavily') {
      const credits = tavilyCreditsForQuery(query);
      const perCredit = ctx.providerPrices.tavilyUsdPerCredit;
      return { units: credits, unit: 'tavily_credit', usd: perCredit === undefined ? undefined : credits * perCredit };
    }
    return { units: 1, unit: 'brave_query', usd: ctx.providerPrices.braveUsdPerQuery };
  }
  return { units: 1, unit: 'request', usd: searchPrice(ctx, provider) };
}

export function getEconomySummary(state: SearchEconomyState, survivalStatus: AgentStatus, now = Date.now()): SearchEconomySummary {
  return summarizeSearchEconomy(state, survivalStatus, now);
}

/* ============================================================================
 * Search ROI (Phase 14) — revenue influenced / search cost. "Cost" here is
 * counted in search-call units (a proxy: Brave/Tavily's free tiers mean the
 * real $ cost is usually $0, but every call still has a rate-limit/quota
 * cost) rather than a fabricated $-per-call price, since neither provider's
 * paid pricing is configured anywhere in this codebase — see the audit doc
 * for the explicit assumption this makes.
 * ========================================================================== */
export interface SearchROIInput {
  totalFreshSearches: number;
  prospectsGenerated: number;
  qualifiedProspects: number;
  repliesRecorded: number;
  proposalsSent: number;
  wins: number;
  realRevenueTotal: number;
  expectedValueOfOpenPipeline: number; // sum of expectedValue across non-terminal prospects
}

export interface SearchROIResult {
  searchesPerProspect: number | null;
  searchesPerQualifiedProspect: number | null;
  searchesPerProposal: number | null;
  searchesPerWin: number | null;
  prospectsPer100Searches: number;
  qualifiedPer100Searches: number;
  proposalsPer100Searches: number;
  revenuePer100Searches: number;
  /** realRevenueTotal / totalFreshSearches when there's real revenue yet,
   *  otherwise expectedValueOfOpenPipeline / totalFreshSearches, clearly
   *  labeled by `basis`. */
  searchROI: number;
  basis: 'REAL_REVENUE' | 'EXPECTED_VALUE' | 'NO_DATA';
}

export function computeSearchROI(input: SearchROIInput): SearchROIResult {
  const n = input.totalFreshSearches;
  const per100 = (count: number) => (n > 0 ? Math.round((count / n) * 100 * 100) / 100 : 0);
  const perUnit = (count: number) => (count > 0 ? Math.round((n / count) * 100) / 100 : null);

  let searchROI = 0;
  let basis: SearchROIResult['basis'] = 'NO_DATA';
  if (n > 0) {
    if (input.realRevenueTotal > 0) {
      searchROI = Math.round((input.realRevenueTotal / n) * 100) / 100;
      basis = 'REAL_REVENUE';
    } else if (input.expectedValueOfOpenPipeline > 0) {
      searchROI = Math.round((input.expectedValueOfOpenPipeline / n) * 100) / 100;
      basis = 'EXPECTED_VALUE';
    }
  }

  return {
    searchesPerProspect: perUnit(input.prospectsGenerated),
    searchesPerQualifiedProspect: perUnit(input.qualifiedProspects),
    searchesPerProposal: perUnit(input.proposalsSent),
    searchesPerWin: perUnit(input.wins),
    prospectsPer100Searches: per100(input.prospectsGenerated),
    qualifiedPer100Searches: per100(input.qualifiedProspects),
    proposalsPer100Searches: per100(input.proposalsSent),
    revenuePer100Searches: n > 0 ? Math.round((input.realRevenueTotal / n) * 100 * 100) / 100 : 0,
    searchROI,
    basis,
  };
}
