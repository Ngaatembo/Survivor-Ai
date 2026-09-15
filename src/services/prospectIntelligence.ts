/* ============================================================================
 * Prospect Intelligence — deep research on ONE specific real business.
 * ----------------------------------------------------------------------------
 * The question this answers is "why would THIS person pay us?", not the
 * generic category-level evidence used elsewhere in the app. Runs a small,
 * fixed set of targeted live searches naming the actual business, then:
 *   - if an LLM is connected, asks it to synthesize a report strictly from
 *     those snippets (analyzeProspect — schema-hinted, told explicitly
 *     never to invent a fact the snippets don't support);
 *   - if not, or if the LLM call fails, falls back to a plain digest built
 *     directly from the snippets themselves — still real, just unsynthesized.
 * Every report carries the sources it came from. Fails soft throughout:
 * a business with no useful search results gets a low-confidence report
 * that says so, never a fabricated one.
 * ========================================================================== */

import type { Prospect, ProspectIntelligence, ResearchSource } from '../types';
import { uid } from '../lib/format';
import type { LLMProvider, SearchProvider } from './providers/types';

const MAX_SNIPPETS = 8;

async function gatherSnippets(
  search: SearchProvider,
  prospect: Prospect,
): Promise<{ snippets: string[]; sources: ResearchSource[] }> {
  const queries = [
    `"${prospect.businessName}" ${prospect.location}`,
    `"${prospect.businessName}" reviews OR services`,
    `${prospect.category} near ${prospect.location} competitors`,
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
        note: `Deep research query: "${q}"`,
      });
    }
  }

  return { snippets, sources };
}

/** Fallback used when no LLM is connected, or the LLM call fails/returns
 *  unusable JSON — a plain, honest digest straight from the snippets, with
 *  no synthesis claimed. */
function digestFromSnippets(prospect: Prospect, snippets: string[]): Omit<
  ProspectIntelligence,
  'id' | 'prospectId' | 'sources' | 'generatedAt' | 'updatedAt'
> {
  if (snippets.length === 0) {
    return {
      businessOverview: `No search results were found specifically about ${prospect.businessName} beyond the original discovery source.`,
      apparentServices: [],
      socialPresenceSummary: 'No additional social presence evidence found.',
      competitiveNote: 'Not enough data to compare against nearby competitors.',
      specificProblemEvidence: prospect.evidenceNotes,
      recommendedAngle: 'Use the general category-level evidence already on file — no business-specific angle found yet.',
      confidence: 'LOW',
      generator: 'snippet-digest',
    };
  }
  return {
    businessOverview: `Raw search snippets found about ${prospect.businessName}: ${snippets.slice(0, 3).join(' | ')}`,
    apparentServices: [],
    socialPresenceSummary: snippets.find((s) => /facebook|instagram|social/i.test(s)) ?? 'No explicit social-media snippet found.',
    competitiveNote: 'Not synthesized — no LLM connected. Read the raw sources below directly.',
    specificProblemEvidence: prospect.evidenceNotes,
    recommendedAngle: 'Review the raw sources below manually — a connected LLM would synthesize a specific angle here.',
    confidence: 'LOW',
    generator: 'snippet-digest',
  };
}

/** Run deep research on one prospect. Never fabricates: with an LLM
 *  connected, its output is schema-validated and only trusted when it
 *  returns usable JSON; otherwise (or on any failure) falls back to the
 *  plain snippet digest above. */
export async function researchProspect(
  search: SearchProvider,
  llm: LLMProvider | null,
  prospect: Prospect,
  now: number = Date.now(),
): Promise<ProspectIntelligence> {
  const { snippets, sources } = await gatherSnippets(search, prospect);

  let body: Omit<ProspectIntelligence, 'id' | 'prospectId' | 'sources' | 'generatedAt' | 'updatedAt'> | null = null;

  if (llm?.connected && llm.analyzeProspect && snippets.length > 0) {
    try {
      const analysis = await llm.analyzeProspect({
        businessName: prospect.businessName,
        category: prospect.category,
        location: prospect.location,
        snippets,
      });
      if (analysis && analysis.businessOverview) {
        body = {
          businessOverview: analysis.businessOverview,
          apparentServices: analysis.apparentServices ?? [],
          socialPresenceSummary: analysis.socialPresenceSummary ?? 'Not addressed by the model.',
          competitiveNote: analysis.competitiveNote ?? 'Not addressed by the model.',
          specificProblemEvidence: analysis.specificProblemEvidence ?? prospect.evidenceNotes,
          recommendedAngle: analysis.recommendedAngle ?? 'Not addressed by the model.',
          confidence: analysis.confidence ?? 'MEDIUM',
          generator: 'llm',
        };
      }
    } catch {
      body = null; // fall through to digest
    }
  }

  if (!body) body = digestFromSnippets(prospect, snippets);

  return {
    id: uid('intel'),
    prospectId: prospect.id,
    ...body,
    sources,
    generatedAt: now,
    updatedAt: now,
  };
}
