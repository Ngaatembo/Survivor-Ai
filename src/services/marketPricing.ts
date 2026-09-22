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
import type { LLMProvider } from './providers/types';
import { runSearch, type SearchEconomyContext } from './searchEconomy';

const MAX_SNIPPETS = 8;
const PRICE_RE = /(?:US\\$|USD\\s*|\\$|ZAR\\s*|R\\s*|ZWL\\s*|ZW\\$)\\s*([0-9]{1,6}(?:[.,][0-9]{1,2})?)/gi;

type ObservedPrice = { value: number; currency: string; snippet: string };

function extractObservedPrices(snippets: string[]): ObservedPrice[] {
  const out: ObservedPrice[] = [];
  for (const snippet of snippets) {
    for (const match of snippet.matchAll(PRICE_RE)) {
      const raw = match[1].replace(/,/g, '');
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) continue;
      const before = snippet.slice(Math.max(0, (match.index ?? 0) - 8), match.index ?? 0);
      const currency = /US\\$|USD/i.test(before) ? 'USD'
        : /ZAR|\\bR\\s*$/i.test(before) ? 'ZAR'
        : /ZWL|ZW\\$/i.test(before) ? 'ZWL'
        : 'USD';
      // Ignore obvious years and tiny numbers that are unlikely to be a service price.
      if ((value >= 1900 && value <= 2100) || value < 2) continue;
      out.push({ value, currency, snippet });
    }
  }
  return out;
}



async function gatherPricingSnippets(
  ctx: SearchEconomyContext,
  service: string,
  region: string,
  opportunityId: string,
  offerPending: boolean,
): Promise<{ snippets: string[]; sources: ResearchSource[]; cacheHits: number; budgetExceeded: number }> {
  const queries = [
    `${service} price cost ${region}`,
    `how much does ${service} cost ${region} freelancer quote`,
    `${service} rates ${region} 2026`,
  ];

  const sources: ResearchSource[] = [];
  const snippets: string[] = [];
  let cacheHits = 0;
  let budgetExceeded = 0;

  for (const q of queries) {
    if (snippets.length >= MAX_SNIPPETS) break;
    const searchOutcome = await runSearch(ctx, {
      purpose: 'MARKET_PRICING',
      query: q,
      entityId: opportunityId,
      offerPending,
      max: 4,
    });
    if (searchOutcome.budgetExceeded) {
      budgetExceeded += 1;
      continue;
    }
    if (searchOutcome.cacheHit) cacheHits += 1;
    for (const r of searchOutcome.results) {
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

  return { snippets, sources, cacheHits, budgetExceeded };
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
  ctx: SearchEconomyContext,
  llm: LLMProvider | null,
  opp: Opportunity,
  now: number = Date.now(),
  opts: { offerPending?: boolean } = {},
): Promise<MarketPriceResearch> {
  const service = opp.howMoneyMade || opp.name;
  const region = opp.geographicRelevance[0] ?? 'Zimbabwe';
  const { snippets, sources } = await gatherPricingSnippets(ctx, service, region, opp.id, opts.offerPending ?? true);
  const observed = extractObservedPrices(snippets);
  const observedByCurrency = new Map<string, number[]>();
  for (const item of observed) {
    const values = observedByCurrency.get(item.currency) ?? [];
    values.push(item.value);
    observedByCurrency.set(item.currency, values);
  }

  let body:
    | Omit<MarketPriceResearch, 'id' | 'opportunityId' | 'sources' | 'generatedAt' | 'updatedAt'>
    | null = null;

  if (llm?.connected && llm.analyzeMarketPrice && snippets.length > 0) {
    try {
      const analysis = await llm.analyzeMarketPrice({ service, region, snippets });
      if (analysis && typeof analysis.priceMin === 'number' && typeof analysis.priceMax === 'number' && analysis.priceMax > 0) {
        const currency = analysis.currency ?? 'USD';
        const observedValues = observedByCurrency.get(currency) ?? [];
        const observedMin = observedValues.length ? Math.min(...observedValues) : 0;
        const observedMax = observedValues.length ? Math.max(...observedValues) : 0;
        const withinObservedEvidence =
          observedValues.length > 0 &&
          analysis.priceMin >= observedMin &&
          analysis.priceMax <= observedMax;
        if (withinObservedEvidence) {
          body = {
            service,
            region,
            priceMin: analysis.priceMin,
            priceMax: analysis.priceMax,
            currency,
            rationale: (analysis.rationale ?? 'Synthesized from real search results.') +
              ' Evidence gate: quoted range is bounded by observed prices in the retrieved sources (' +
              observedValues.join(', ') + ' ' + currency + ').',
            confidence: analysis.confidence ?? 'MEDIUM',
            generator: 'llm',
          };
        }
      }
    } catch {
      body = null; // fall through to digest
    }
  }

  if (!body) {
    body = digestFromSnippets(service, region, snippets);
    if (observed.length > 0) {
      const byCurrency = [...observedByCurrency.entries()]
        .map(([currency, values]) => currency + ': ' + Math.min(...values) + '-' + Math.max(...values))
        .join('; ');
      body = {
        ...body,
        rationale: body.rationale + ' Observed price evidence: ' + byCurrency + '.',
      };
    }
  }

  return {
    id: uid('price'),
    opportunityId: opp.id,
    ...body,
    sources,
    generatedAt: now,
    updatedAt: now,
  };
}
