import type { MarketPriceResearch, Opportunity, Prospect, ProspectIntelligence, ResearchSource } from '../types';
import type { LLMProvider } from './providers/types';
import type { SearchEconomyContext } from './searchEconomy';
import { verifyProspect } from './prospectVerification';
import { researchProspect } from './prospectIntelligence';
import { researchMarketPrice } from './marketPricing';

/**
 * Unified real-world research pass.
 *
 * Order matters:
 * 1. consolidate the business identity/contact/location;
 * 2. research the now-verified business;
 * 3. research current market pricing for the linked opportunity;
 * 4. return one evidence package with deduplicated sources.
 *
 * Nothing in this package is allowed to silently invent a contact, price or
 * business fact. Each underlying research subsystem keeps its own evidence
 * gates and confidence level.
 */
export interface UnifiedProspectResearch {
  prospect: Prospect;
  intelligence: ProspectIntelligence;
  marketPrice: MarketPriceResearch;
  sources: ResearchSource[];
  overallConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  generatedAt: number;
}

function confidenceRank(value: 'HIGH' | 'MEDIUM' | 'LOW'): number {
  return value === 'HIGH' ? 3 : value === 'MEDIUM' ? 2 : 1;
}

function combineConfidence(
  identity: Prospect['verification'],
  intelligence: ProspectIntelligence,
  pricing: MarketPriceResearch,
): UnifiedProspectResearch['overallConfidence'] {
  const identityConfidence = identity?.status === 'VERIFIED'
    ? 'HIGH'
    : identity?.status === 'PROVISIONAL'
      ? 'MEDIUM'
      : 'LOW';
  const rank = Math.min(
    confidenceRank(identityConfidence),
    confidenceRank(intelligence.confidence),
    confidenceRank(pricing.confidence),
  );
  return rank >= 3 ? 'HIGH' : rank === 2 ? 'MEDIUM' : 'LOW';
}

function dedupeSources(groups: ResearchSource[][]): ResearchSource[] {
  const seen = new Set<string>();
  const result: ResearchSource[] = [];
  for (const group of groups) {
    for (const source of group) {
      const key = source.url || source.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(source);
    }
  }
  return result;
}

export async function runUnifiedProspectResearch(
  ctx: SearchEconomyContext,
  llm: LLMProvider | null,
  prospect: Prospect,
  opportunity: Opportunity,
  now = Date.now(),
): Promise<UnifiedProspectResearch> {
  const verified = await verifyProspect(ctx, prospect, now);
  const intelligence = await researchProspect(
    ctx,
    llm,
    verified,
    now,
    { statusChanged: true, offerPending: true },
  );
  const marketPrice = await researchMarketPrice(
    ctx,
    llm,
    opportunity,
    now,
    { offerPending: true },
  );

  return {
    prospect: verified,
    intelligence,
    marketPrice,
    sources: dedupeSources([
      verified.sources,
      intelligence.sources,
      marketPrice.sources,
    ]),
    overallConfidence: combineConfidence(
      verified.verification,
      intelligence,
      marketPrice,
    ),
    generatedAt: now,
  };
}
