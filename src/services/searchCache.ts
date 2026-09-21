/* ============================================================================
 * Thin, named re-export of the caching surface of searchBudget.ts (Phase 3).
 * Budget accounting and caching share one state object (SearchEconomyState)
 * by design — see searchBudget.ts's header comment — so the implementation
 * lives there; this file exists so "the cache" has its own clear entry
 * point to import from, matching the spec's suggested module layout.
 * ========================================================================== */
export {
  normalizeQuery,
  cacheKey,
  getCached,
  recordSearch,
  emptyState,
  SEARCH_POLICY,
  type SearchCacheEntry,
  type SearchEconomyState,
  type SearchPurpose,
} from './searchBudget';
