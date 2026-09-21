/* ============================================================================
 * Search providers — Tavily and Brave. Pure fetch; works in browser & worker.
 * Both fail soft: the engine then uses the SAMPLE knowledge base and tags
 * results appropriately.
 * ========================================================================== */

import type { SearchProvider, SearchResult } from './types';

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
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          max_results: max,
          search_depth: 'basic',
        }),
      });
      if (!res.ok) throw new Error(`tavily ${res.status}`);
      const data: any = await res.json();
      return (data?.results ?? []).map((r: Record<string, unknown>) => ({
        title: String(r.title ?? 'Untitled'),
        url: String(r.url ?? ''),
        snippet: String(r.content ?? ''),
        publishedAt: r.published_date ? String(r.published_date) : undefined,
        source: 'web',
      }));
    } catch (e) {
      console.warn('[search:tavily] failed', e);
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
      const res = await fetch(url, {
        headers: {
          'X-Subscription-Token': this.apiKey,
          accept: 'application/json',
        },
      });
      if (!res.ok) throw new Error(`brave ${res.status}`);
      const data: any = await res.json();
      return (data?.web?.results ?? []).map((r: Record<string, unknown>) => ({
        title: String(r.title ?? 'Untitled'),
        url: String(r.url ?? ''),
        snippet: String(r.description ?? ''),
        publishedAt: r.age ? String(r.age) : undefined,
        source: 'web',
      }));
    } catch (e) {
      console.warn('[search:brave] failed', e);
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
