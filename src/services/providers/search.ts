/* ============================================================================
 * Search providers — Tavily and Brave. Pure fetch; works in browser & worker.
 * Both fail soft: the live discovery layer receives an empty result set and
 * the production Worker never substitutes legacy SAMPLE records.
 * ========================================================================== */

import type { SearchProvider, SearchResult } from './types';

const SEARCH_TIMEOUT_MS = 8_000;

export class SearchProviderError extends Error {
  constructor(
    message: string,
    readonly provider: 'tavily' | 'brave',
    readonly status: number,
  ) {
    super(message);
    this.name = 'SearchProviderError';
  }
}

function shouldFailover(status: number): boolean {
  // Tavily uses 432/433 for plan or pay-as-you-go limits; both providers
  // can also return 429 for rate limits and 401/403 for unusable credentials.
  // A provider-level failure should not strand Survivor when the other
  // configured provider is still usable.
  return [401, 402, 403, 429, 432, 433, 500, 502, 503, 504].includes(status);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}


/* ------------------------------- Tavily ----------------------------------- */

class TavilyProvider implements SearchProvider {
  readonly id = 'tavily';
  readonly label = 'Tavily Search API';

  constructor(private apiKey: string) {}

  get connected() {
    return Boolean(this.apiKey);
  }

  async search(query: string, max = 5): Promise<SearchResult[]> {
    try {
      // Tavily ignores Google-style "site:" operators; turn a leading
      // "site:domain" into its include_domains filter instead (Brave
      // understands "site:" natively, so the query text stays portable).
      const site = query.match(/^\s*site:(\S+)\s+(.*)$/i);
      const res = await fetchWithTimeout('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query: site ? site[2] : query,
          max_results: Math.min(20, max),
          // Domain-filtered searches (Facebook pages) don't need the 2-credit
          // advanced depth — the page title/intro carries the name and number.
          search_depth: site ? 'basic' : 'advanced',
          include_raw_content: true,
          ...(site ? { include_domains: [site[1]] } : {}),
        }),
      });
      if (!res.ok) {
        if (shouldFailover(res.status)) throw new SearchProviderError(`tavily ${res.status}`, 'tavily', res.status);
        throw new Error(`tavily ${res.status}`);
      }
      const data: any = await res.json();
      return (data?.results ?? []).map((r: Record<string, unknown>) => ({
        title: String(r.title ?? 'Untitled'),
        url: String(r.url ?? ''),
        snippet: String(r.content ?? r.raw_content ?? '').slice(0, 12000),
        publishedAt: r.published_date ? String(r.published_date) : undefined,
        source: 'web',
      }));
    } catch (e) {
      console.warn('[search:tavily] failed', e);
      if (e instanceof SearchProviderError) throw e;
      return [];
    }
  }
}

/* -------------------------------- Brave ----------------------------------- */

class BraveProvider implements SearchProvider {
  readonly id = 'brave';
  readonly label = 'Brave Search API';

  constructor(private apiKey: string) {}

  get connected() {
    return Boolean(this.apiKey);
  }

  async search(query: string, max = 5): Promise<SearchResult[]> {
    try {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(max));
      const res = await fetchWithTimeout(url, {
        headers: {
          'X-Subscription-Token': this.apiKey,
          accept: 'application/json',
        },
      });
      if (!res.ok) {
        if (shouldFailover(res.status)) throw new SearchProviderError(`brave ${res.status}`, 'brave', res.status);
        throw new Error(`brave ${res.status}`);
      }
      const data: any = await res.json();
      return (data?.web?.results ?? []).map((r: Record<string, unknown>) => ({
        title: String(r.title ?? 'Untitled'),
        url: String(r.url ?? ''),
        snippet: [String(r.description ?? ''), ...(Array.isArray(r.extra_snippets) ? r.extra_snippets.map((x: unknown) => String(x)) : [])].join(' ').slice(0, 12000),
        publishedAt: r.age ? String(r.age) : undefined,
        source: 'web',
      }));
    } catch (e) {
      console.warn('[search:brave] failed', e);
      if (e instanceof SearchProviderError) throw e;
      return [];
    }
  }
}

/**
 * Build BOTH providers (when their keys are configured) rather than
 * silently picking one. Which provider is actually used for a given search
 * is a policy decision made by services/searchBudget.ts's selectProvider()
 * — purpose, cost, and remaining budget, never "Tavily wins because a key
 * happens to exist" (that was the pre-overhaul behavior of the single
 * `createSearchProvider()` below, kept only for narrow backward
 * compatibility with call sites that haven't been migrated to the
 * search-economy layer yet).
 */
export function createSearchProviders(keys: {
  tavily?: string;
  brave?: string;
}): { tavily: SearchProvider | null; brave: SearchProvider | null } {
  return {
    tavily: keys.tavily ? new TavilyProvider(keys.tavily) : null,
    brave: keys.brave ? new BraveProvider(keys.brave) : null,
  };
}

/**
 * @deprecated Legacy single-provider accessor — always preferred Tavily
 * whenever a key existed, with no cost/purpose awareness. Kept only for any
 * remaining call site that hasn't moved to `createSearchProviders()` +
 * `services/searchBudget.ts`'s purpose-driven `selectProvider()`. New code
 * should not call this.
 */
export function createSearchProvider(keys: {
  tavily?: string;
  brave?: string;
}): SearchProvider | null {
  if (keys.tavily) return new TavilyProvider(keys.tavily);
  if (keys.brave) return new BraveProvider(keys.brave);
  return null;
}
