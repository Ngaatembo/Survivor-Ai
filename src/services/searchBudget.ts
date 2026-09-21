/* ============================================================================
 * SURVIVE AI — Search Budget & Policy (Economic Survival Overhaul, Phases 2/4/9/10/11)
 * ----------------------------------------------------------------------------
 * ONE centralized place that decides:
 *   - which purpose a search serves (SearchPurpose)
 *   - how many searches that purpose may run (per cycle / day / month / per
 *     entity) — hard guards, never crash on breach: SEARCH_BUDGET_EXCEEDED
 *   - which provider to use for that purpose (never "Tavily wins because a
 *     key exists" — provider choice is data, not a fallback-order accident)
 *   - whether a search is even worth running right now, given what's
 *     already known, the survival status, and whether a real decision is
 *     waiting on it (shouldSearch())
 *
 * State (SearchEconomyState) is a small, serializable JSON blob persisted
 * via EngineRepository.getKV/setKV — see searchEconomy.ts for load/save and
 * the actual provider-call wrapper. This file is pure logic: no fetch, no
 * repository, fully unit-testable (see scripts/searchEconomy.smoke.ts).
 * ========================================================================== */

import type { AgentStatus } from '../types';

export type SearchPurpose =
  | 'OPPORTUNITY_DISCOVERY'
  | 'PROSPECT_DISCOVERY'
  | 'PROSPECT_INTELLIGENCE'
  | 'MARKET_PRICING'
  | 'OTHER';

export const SEARCH_PURPOSES: SearchPurpose[] = [
  'OPPORTUNITY_DISCOVERY',
  'PROSPECT_DISCOVERY',
  'PROSPECT_INTELLIGENCE',
  'MARKET_PRICING',
  'OTHER',
];

export type SearchProviderId = 'tavily' | 'brave' | 'none';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MONTH_MS = 30 * DAY_MS;

export interface SearchPurposePolicy {
  /** How long a cached result for this purpose stays valid. */
  ttlMs: number;
  /** Hard per-cycle ceiling for this purpose (Phase 10). */
  maxPerCycle: number;
  /** Hard daily ceiling for this purpose. */
  maxPerDay: number;
  /** Hard monthly ceiling for this purpose. */
  maxPerMonth: number;
  /** How many fresh (non-cached) searches a single entity (one opportunity
   *  or one prospect) may consume within its TTL window before it must
   *  wait for the cache to expire or a real status change to justify more. */
  maxPerEntity: number;
  /** Preferred provider for this purpose — cost/quality tradeoff, NOT
   *  "whichever key happens to be configured first" (Phase 9). */
  primaryProvider: SearchProviderId;
  /** Used only when the primary provider is unavailable or fails. */
  fallbackProvider: SearchProviderId;
  /** Results requested per search call. */
  resultsPerQuery: number;
}

/**
 * Default policy. Every number here is intentionally conservative and
 * documented in docs/SURVIVAL_ECONOMICS_AUDIT.md — tune via this one object,
 * never by scattering ad-hoc limits through the research modules.
 *
 * Provider choice: Brave Search has a free tier (2,000 queries/month) and is
 * the default primary for every purpose. Tavily is kept as the fallback (or
 * primary only where its snippet quality materially matters, e.g. deep
 * per-business intelligence) — it is never auto-preferred purely because a
 * key exists, which is what the pre-overhaul code did (services/providers/
 * search.ts: `if (keys.tavily) return new TavilyProvider(...)`).
 */
export const SEARCH_POLICY: Record<SearchPurpose, SearchPurposePolicy> = {
  OPPORTUNITY_DISCOVERY: {
    ttlMs: 7 * DAY_MS,
    maxPerCycle: 6,
    maxPerDay: 12, // cycles run every 30 min, but discovery is capped well below "every cycle" via caching + shouldSearch
    maxPerMonth: 150,
    maxPerEntity: 1,
    primaryProvider: 'brave',
    fallbackProvider: 'tavily',
    resultsPerQuery: 5,
  },
  PROSPECT_DISCOVERY: {
    ttlMs: 2 * DAY_MS, // 24–72h band from the spec; 48h default
    maxPerCycle: 3,
    maxPerDay: 9,
    maxPerMonth: 120,
    maxPerEntity: 2,
    primaryProvider: 'brave',
    fallbackProvider: 'tavily',
    resultsPerQuery: 5,
  },
  PROSPECT_INTELLIGENCE: {
    ttlMs: 7 * DAY_MS,
    maxPerCycle: 3,
    maxPerDay: 9,
    maxPerMonth: 120,
    maxPerEntity: 3, // up to 3 targeted queries for one business (name+location, reviews, competitors)
    primaryProvider: 'tavily', // per-business synthesis benefits from Tavily's richer snippets
    fallbackProvider: 'brave',
    resultsPerQuery: 4,
  },
  MARKET_PRICING: {
    ttlMs: 7 * DAY_MS,
    maxPerCycle: 2,
    maxPerDay: 6,
    maxPerMonth: 60,
    maxPerEntity: 1,
    primaryProvider: 'brave',
    fallbackProvider: 'tavily',
    resultsPerQuery: 4,
  },
  OTHER: {
    ttlMs: 10 * DAY_MS,
    maxPerCycle: 1,
    maxPerDay: 3,
    maxPerMonth: 30,
    maxPerEntity: 1,
    primaryProvider: 'brave',
    fallbackProvider: 'tavily',
    resultsPerQuery: 4,
  },
};

/* ============================================================================
 * Economic survival logic (Phase 11) — the search policy tightens as the
 * simulated agent's survival status worsens. Returns an adjusted COPY of the
 * base policy; SEARCH_POLICY itself is never mutated.
 * ========================================================================== */
export function survivalAdjustedPolicy(
  purpose: SearchPurpose,
  survivalStatus: AgentStatus,
): SearchPurposePolicy {
  const base = SEARCH_POLICY[purpose];
  if (survivalStatus === 'DEAD') {
    return { ...base, maxPerCycle: 0, maxPerDay: 0, maxPerMonth: 0, maxPerEntity: 0 };
  }
  if (survivalStatus === 'CRITICAL') {
    // Strongly prioritize prospects already in motion; broad discovery is
    // throttled hard rather than eliminated (a total-zero discovery budget
    // would mean the agent can never replace a dead pipeline).
    const scale = purpose === 'OPPORTUNITY_DISCOVERY' || purpose === 'PROSPECT_DISCOVERY' ? 0.2 : 0.6;
    return {
      ...base,
      maxPerCycle: Math.max(purpose === 'OPPORTUNITY_DISCOVERY' ? 0 : 1, Math.floor(base.maxPerCycle * scale)),
      maxPerDay: Math.max(1, Math.floor(base.maxPerDay * scale)),
      maxPerMonth: Math.max(1, Math.floor(base.maxPerMonth * scale)),
    };
  }
  if (survivalStatus === 'AT_RISK') {
    const scale = purpose === 'OPPORTUNITY_DISCOVERY' ? 0.5 : 0.75;
    return {
      ...base,
      maxPerCycle: Math.max(1, Math.floor(base.maxPerCycle * scale)),
      maxPerDay: Math.max(1, Math.floor(base.maxPerDay * scale)),
      maxPerMonth: Math.max(1, Math.floor(base.maxPerMonth * scale)),
    };
  }
  return base; // ALIVE / RESEARCHING / EXECUTING / PAUSED — normal policy
}

/* ============================================================================
 * State — a small, serializable ledger of what's already been searched.
 * ========================================================================== */
export interface SearchLogEntry {
  ts: number;
  purpose: SearchPurpose;
  provider: SearchProviderId;
  query: string;
  entityId?: string;
  cacheHit: boolean;
}

export interface SearchCacheEntry {
  key: string;
  query: string;
  normalizedQuery: string;
  provider: SearchProviderId;
  purpose: SearchPurpose;
  entityId?: string;
  results: unknown[]; // SearchResult[], kept untyped here to avoid an import cycle with providers/types
  ts: number;
}

export interface SearchEconomyState {
  /** Append-only, capped ring buffer. Daily/monthly/per-entity counts are
   *  derived from this by filtering on timestamp — no separate counters to
   *  drift out of sync. */
  log: SearchLogEntry[];
  cache: Record<string, SearchCacheEntry>;
}

/** Bound the log so the KV blob never grows unbounded. At the policy's
 *  maximum realistic volume (~350 searches/month across all purposes) this
 *  comfortably covers a rolling month with headroom. */
const MAX_LOG_ENTRIES = 4000;
/** Bound the cache similarly — oldest entries evicted first. */
const MAX_CACHE_ENTRIES = 1500;

export function emptyState(): SearchEconomyState {
  return { log: [], cache: {} };
}

/* ============================================================================
 * Budget accounting
 * ========================================================================== */
export function countSince(
  state: SearchEconomyState,
  sinceMs: number,
  purpose?: SearchPurpose,
  entityId?: string,
): number {
  return state.log.filter(
    (e) =>
      e.ts >= sinceMs &&
      !e.cacheHit && // budget is about FRESH provider calls, not cache reads
      (!purpose || e.purpose === purpose) &&
      (entityId === undefined || e.entityId === entityId),
  ).length;
}

export type BudgetScope = 'cycle' | 'day' | 'month' | 'entity';

export interface BudgetCheck {
  ok: boolean;
  exceededScope?: BudgetScope;
  usage: { cycle: number; day: number; month: number; entity: number };
  policy: SearchPurposePolicy;
}

export function checkBudget(
  state: SearchEconomyState,
  purpose: SearchPurpose,
  survivalStatus: AgentStatus,
  now: number,
  cycleStartedAt: number,
  entityId?: string,
): BudgetCheck {
  const policy = survivalAdjustedPolicy(purpose, survivalStatus);
  const cycleCount = countSince(state, cycleStartedAt, purpose);
  const dayCount = countSince(state, now - DAY_MS, purpose);
  const monthCount = countSince(state, now - MONTH_MS, purpose);
  const entityCount = entityId !== undefined ? countSince(state, now - policy.ttlMs, purpose, entityId) : 0;

  const usage = { cycle: cycleCount, day: dayCount, month: monthCount, entity: entityCount };

  if (cycleCount >= policy.maxPerCycle) return { ok: false, exceededScope: 'cycle', usage, policy };
  if (dayCount >= policy.maxPerDay) return { ok: false, exceededScope: 'day', usage, policy };
  if (monthCount >= policy.maxPerMonth) return { ok: false, exceededScope: 'month', usage, policy };
  if (entityId !== undefined && entityCount >= policy.maxPerEntity) {
    return { ok: false, exceededScope: 'entity', usage, policy };
  }
  return { ok: true, usage, policy };
}

/* ============================================================================
 * Provider selection (Phase 9) — purpose-driven, budget-aware, never a
 * blind "prefer whichever key exists" default.
 * ========================================================================== */
export function selectProvider(
  purpose: SearchPurpose,
  available: { tavily: boolean; brave: boolean },
  survivalStatus: AgentStatus,
): SearchProviderId {
  const policy = survivalAdjustedPolicy(purpose, survivalStatus);
  const has = (id: SearchProviderId) => id === 'tavily' ? available.tavily : id === 'brave' ? available.brave : false;
  if (has(policy.primaryProvider)) return policy.primaryProvider;
  if (has(policy.fallbackProvider)) return policy.fallbackProvider;
  return 'none';
}

/* ============================================================================
 * shouldSearch() — Phase 4: information value must justify the cost.
 * ========================================================================== */
export interface ShouldSearchInput {
  purpose: SearchPurpose;
  query: string;
  /** Opportunity id or prospect id this search is about, if any. */
  entityId?: string;
  now: number;
  cycleStartedAt: number;
  survivalStatus: AgentStatus;
  /** True when the entity's status just changed in a way that makes prior
   *  evidence stale (e.g. a prospect replied, went INTERESTED, or is about
   *  to receive a priced offer). Forces past the "already researched
   *  recently" gate even though the cache TTL hasn't expired. */
  statusChanged?: boolean;
  /** True when a human-facing offer/proposal is actively being prepared for
   *  this entity — justifies fresh pricing/intelligence research even under
   *  a tightened AT_RISK/CRITICAL policy. */
  offerPending?: boolean;
  /** Entity priority, when known (HIGH prospects get more benefit of the
   *  doubt under a tightened survival policy). */
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Skip the cache even if a fresh-enough entry exists. Used sparingly. */
  forceRefresh?: boolean;
}

export type ShouldSearchDecision =
  | { allow: true; reason: string }
  | { allow: false; reason: 'DEAD_NO_SEARCH' }
  | { allow: false; reason: 'CACHE_HIT'; cached: SearchCacheEntry }
  | { allow: false; reason: 'SEARCH_BUDGET_EXCEEDED'; scope: BudgetScope; usage: BudgetCheck['usage'] }
  | { allow: false; reason: 'LOW_VALUE_DEFERRED' };

export function shouldSearch(
  state: SearchEconomyState,
  input: ShouldSearchInput,
): ShouldSearchDecision {
  const { purpose, entityId, now, cycleStartedAt, survivalStatus } = input;

  // Phase 11: DEAD agent performs no search calls whatsoever.
  if (survivalStatus === 'DEAD') return { allow: false, reason: 'DEAD_NO_SEARCH' };

  // Phase 3/4: existing evidence still valid — never pay again for it.
  if (!input.forceRefresh) {
    const cached = getCachedInternal(state, purpose, input.query, entityId, now);
    if (cached) return { allow: false, reason: 'CACHE_HIT', cached };
  }

  // Phase 4: a prospect/opportunity researched recently with no status
  // change and no pending offer is not automatically re-researched, even
  // once its cache entry has technically expired, UNLESS the agent is fully
  // ALIVE (plenty of budget) or the entity is HIGH priority. This is the
  // explicit "no meaningful new information -> don't spend" gate.
  if (
    entityId &&
    !input.statusChanged &&
    !input.offerPending &&
    survivalStatus !== 'ALIVE' &&
    input.priority !== 'HIGH'
  ) {
    const lastEntry = [...state.log]
      .filter((e) => e.entityId === entityId && e.purpose === purpose && !e.cacheHit)
      .sort((a, b) => b.ts - a.ts)[0];
    // Researched within the last half of this purpose's TTL and nothing
    // changed — under a tightened (non-ALIVE) survival policy that's not
    // worth spending on again yet.
    if (lastEntry && now - lastEntry.ts < SEARCH_POLICY[purpose].ttlMs / 2) {
      return { allow: false, reason: 'LOW_VALUE_DEFERRED' };
    }
  }

  const budget = checkBudget(state, purpose, survivalStatus, now, cycleStartedAt, entityId);
  if (!budget.ok) {
    return { allow: false, reason: 'SEARCH_BUDGET_EXCEEDED', scope: budget.exceededScope!, usage: budget.usage };
  }

  return { allow: true, reason: 'within budget, no valid cache, information value justifies the cost' };
}

/* ============================================================================
 * Cache read/write (Phase 3) — kept here alongside budget logic since both
 * operate on the same SearchEconomyState; searchCache.ts re-exports the
 * public surface for callers that only need caching, not budget checks.
 * ========================================================================== */
export function normalizeQuery(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');
}

export function cacheKey(purpose: SearchPurpose, normalizedQuery: string, entityId?: string): string {
  return `${purpose}::${entityId ?? '-'}::${normalizedQuery}`;
}

function getCachedInternal(
  state: SearchEconomyState,
  purpose: SearchPurpose,
  query: string,
  entityId: string | undefined,
  now: number,
): SearchCacheEntry | null {
  const key = cacheKey(purpose, normalizeQuery(query), entityId);
  const entry = state.cache[key];
  if (!entry) return null;
  if (now - entry.ts > SEARCH_POLICY[purpose].ttlMs) return null;
  return entry;
}

export function getCached(
  state: SearchEconomyState,
  purpose: SearchPurpose,
  query: string,
  entityId: string | undefined,
  now: number,
): SearchCacheEntry | null {
  return getCachedInternal(state, purpose, query, entityId, now);
}

/** Returns a NEW state (immutable-style update, consistent with the rest of
 *  the codebase's pure-function style) with the search recorded in the log
 *  and, when `results` is provided (i.e. this was a real provider call, not
 *  a cache hit being replayed), cached for future TTL-bounded reuse. */
export function recordSearch(
  state: SearchEconomyState,
  entry: Omit<SearchLogEntry, 'cacheHit'> & { cacheHit?: boolean },
  results?: unknown[],
): SearchEconomyState {
  const cacheHit = entry.cacheHit ?? false;
  const log = [...state.log, { ...entry, cacheHit }].slice(-MAX_LOG_ENTRIES);
  let cache = state.cache;
  if (!cacheHit && results) {
    const normalizedQuery = normalizeQuery(entry.query);
    const key = cacheKey(entry.purpose, normalizedQuery, entry.entityId);
    cache = { ...cache, [key]: { key, query: entry.query, normalizedQuery, provider: entry.provider, purpose: entry.purpose, entityId: entry.entityId, results, ts: entry.ts } };
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE_ENTRIES) {
      const sorted = keys.map((k) => [k, cache[k].ts] as const).sort((a, b) => a[1] - b[1]);
      const drop = sorted.slice(0, keys.length - MAX_CACHE_ENTRIES).map(([k]) => k);
      const trimmed = { ...cache };
      for (const k of drop) delete trimmed[k];
      cache = trimmed;
    }
  }
  return { log, cache };
}

/* ============================================================================
 * Dashboard summary (Phase 10/15) — used by the /state worker endpoint and
 * the ECONOMIC EFFICIENCY dashboard panel.
 * ========================================================================== */
export interface SearchEconomySummary {
  searchesToday: number;
  searchesThisMonth: number;
  cacheHitsToday: number;
  cacheMissesToday: number;
  cacheHitRateToday: number; // 0..1
  byPurposeToday: Record<SearchPurpose, number>;
  byProviderToday: Record<string, number>;
  budgetRemainingToday: Record<SearchPurpose, number>;
  budgetRemainingThisMonth: Record<SearchPurpose, number>;
}

export function summarizeSearchEconomy(
  state: SearchEconomyState,
  survivalStatus: AgentStatus,
  now: number = Date.now(),
): SearchEconomySummary {
  const sinceDay = now - DAY_MS;
  const sinceMonth = now - MONTH_MS;
  const todayEntries = state.log.filter((e) => e.ts >= sinceDay);
  const monthFreshCount = (p: SearchPurpose) => countSince(state, sinceMonth, p);
  const dayFreshCount = (p: SearchPurpose) => countSince(state, sinceDay, p);

  const byPurposeToday = {} as Record<SearchPurpose, number>;
  const budgetRemainingToday = {} as Record<SearchPurpose, number>;
  const budgetRemainingThisMonth = {} as Record<SearchPurpose, number>;
  for (const p of SEARCH_PURPOSES) {
    byPurposeToday[p] = todayEntries.filter((e) => e.purpose === p && !e.cacheHit).length;
    const policy = survivalAdjustedPolicy(p, survivalStatus);
    budgetRemainingToday[p] = Math.max(0, policy.maxPerDay - dayFreshCount(p));
    budgetRemainingThisMonth[p] = Math.max(0, policy.maxPerMonth - monthFreshCount(p));
  }

  const byProviderToday: Record<string, number> = {};
  for (const e of todayEntries) {
    if (e.cacheHit) continue;
    byProviderToday[e.provider] = (byProviderToday[e.provider] ?? 0) + 1;
  }

  const cacheHitsToday = todayEntries.filter((e) => e.cacheHit).length;
  const cacheMissesToday = todayEntries.filter((e) => !e.cacheHit).length;
  const total = cacheHitsToday + cacheMissesToday;

  return {
    searchesToday: cacheMissesToday,
    searchesThisMonth: countSince(state, sinceMonth),
    cacheHitsToday,
    cacheMissesToday,
    cacheHitRateToday: total > 0 ? Math.round((cacheHitsToday / total) * 1000) / 1000 : 0,
    byPurposeToday,
    byProviderToday,
    budgetRemainingToday,
    budgetRemainingThisMonth,
  };
}
