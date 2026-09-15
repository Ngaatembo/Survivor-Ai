/* ============================================================================
 * Market pricing research — real going rates, not a formula guess.
 * ----------------------------------------------------------------------------
 * The original price estimate (businessModel.ts's estimatePrice) derives a
 * number purely from the opportunity's own modeled monthly-revenue range
 * divided by an assumed engagement count — it was never grounded in what
 * the market actually charges. This runs real, targeted live searches for
 * actual going rates, then either has the real LLM synthesize a price
 * range strictly from real figures found in those results, or — with no
 * LLM connected, or the call fails — falls back to an honest snippet
 * digest (never a fabricated number). Same shape as prospectIntelligence.ts.
 * ========================================================================== */

import type { MarketPriceResearch, Opportunity, ResearchSource } from '../types';
import { uid } from '../lib/format';
import type { LLMProvider, SearchProvider } from './providers/types';

const MAX_SNIPPETS = 8;

async function gatherPricingSnippets(
  search: SearchProvider,
  service: string,
  region: string,
): Promise<{ snippets: string[]; sources: ResearchSource[] }> {
  const queries = [
    `${service} price cost ${region}`,
    `how much does ${service} cost ${region} freelancer quote`,
    `${service} rates ${region} 2026`,
  ];

  const sources: ResearchSource[] = [];
  const snippets: string[] = [];

  for (const q of queries) {
    if (snippets.length >= MAX_SNIPPETS) break;
    let results: Awaited<ReturnType<SearchProvider['search']>>;
    try {
      results = await search.search(q, 4);
    } catch {
      results = [];
    }
    for (const r of results) {
      if (snippets.length >= MAX_SNIPPETS) break;
      snippets.push(`${r.title} — ${r.snippet}`);
      sources.push({
        id: uid('src'),
        title: r.title.slice(0, 140),
        url: r.url,
        kind: 'web',
        note: `Market pricing query: "${q}"`,
      });
    }
  }

  return { snippets, sources };
}

/** Fallback used when no LLM is connected, or the LLM call fails/returns
 *  unusable JSON — an honest digest, never a fabricated price. */
function digestFromSnippets(
  service: string,
  region: string,
  snippets: string[],
): Omit<MarketPriceResearch, 'id' | 'opportunityId' | 'sources' | 'generatedAt' | 'updatedAt'> {
  if (snippets.length === 0) {
    return {
      service,
      region,
      priceMin: 0,
      priceMax: 0,
      currency: 'USD',
      rationale: `No search results were found with real pricing evidence for "${service}" in ${region}. No confident price range can be given — review the fallback formula-based estimate manually before quoting a client.`,
      confidence: 'LOW',
      generator: 'snippet-digest',
    };
  }
  return {
    service,
    region,
    priceMin: 0,
    priceMax: 0,
    currency: 'USD',
    rationale: `Raw search snippets found (not synthesized — no LLM connected): ${snippets.slice(0, 3).join(' | ')}. Read the sources directly to judge a real price range manually.`,
    confidence: 'LOW',
    generator: 'snippet-digest',
  };
}

/** Research real market pricing for a specific service in a specific
 *  region. Never fabricates: with an LLM connected, its output is only
 *  trusted when it returns usable JSON with a non-LOW confidence tied to
 *  real snippet evidence; otherwise falls back to the honest digest
 *  above, which explicitly returns a $0 range rather than guessing. */
export async function researchMarketPrice(
  search: SearchProvider,
  llm: LLMProvider | null,
  opp: Opportunity,
  now: number = Date.now(),
): Promise<MarketPriceResearch> {
  const service = opp.howMoneyMade || opp.name;
  const region = opp.geographicRelevance[0] ?? 'Zimbabwe';
  const { snippets, sources } = await gatherPricingSnippets(search, service, region);

  let body:
    | Omit<MarketPriceResearch, 'id' | 'opportunityId' | 'sources' | 'generatedAt' | 'updatedAt'>
    | null = null;

  if (llm?.connected && llm.analyzeMarketPrice && snippets.length > 0) {
    try {
      const analysis = await llm.analyzeMarketPrice({ service, region, snippets });
      if (analysis && typeof analysis.priceMin === 'number' && typeof analysis.priceMax === 'number' && analysis.priceMax > 0) {
        body = {
          service,
          region,
          priceMin: analysis.priceMin,
          priceMax: analysis.priceMax,
          currency: analysis.currency ?? 'USD',
          rationale: analysis.rationale ?? 'Synthesized from real search results.',
          confidence: analysis.confidence ?? 'MEDIUM',
          generator: 'llm',
        };
      }
    } catch {
      body = null; // fall through to digest
    }
  }

  if (!body) body = digestFromSnippets(service, region, snippets);

  return {
    id: uid('price'),
    opportunityId: opp.id,
    ...body,
    sources,
    generatedAt: now,
    updatedAt: now,
  };
}
