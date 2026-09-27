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

import type { Prospect, ProspectIntelligence, ProspectProblemCandidate, ProspectProblemSelection, ProspectProblemType, ResearchSource } from '../types';
import { uid } from '../lib/format';
import type { LLMProvider } from './providers/types';
import { runSearch, type SearchEconomyContext } from './searchEconomy';

const MAX_SNIPPETS = 8;
const PROBLEM_TYPES: ProspectProblemType[] = [
  'DISCOVERABILITY', 'TRUST', 'CONVERSION', 'BOOKING', 'ORDERING',
  'LEAD_CAPTURE', 'FOLLOW_UP', 'CUSTOMER_EXPERIENCE',
  'COMPETITIVE_POSITION', 'WEBSITE_QUALITY', 'OTHER',
];
const INTELLIGENCE_CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'] as const;

function normalizePrimaryProblem(
  raw: unknown,
  sources: ResearchSource[],
): ProspectIntelligence['primaryProblem'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const type = typeof value.type === 'string' && PROBLEM_TYPES.includes(value.type as ProspectProblemType)
    ? value.type as ProspectProblemType
    : null;
  const confidence = typeof value.confidence === 'string' && INTELLIGENCE_CONFIDENCES.includes(value.confidence as typeof INTELLIGENCE_CONFIDENCES[number])
    ? value.confidence as typeof INTELLIGENCE_CONFIDENCES[number]
    : null;
  const textFields = ['evidence', 'businessFriction', 'likelyConsequence', 'solvableOpportunity', 'outreachClaim']
    .map((key) => [key, typeof value[key] === 'string' ? value[key].trim() : ''] as const);
  if (!type || !confidence || textFields.some(([, text]) => !text)) return undefined;

  // The model receives numbered snippets [1]...[8]. Convert those stable
  // references into the actual persisted source IDs before storing them.
  const rawSourceIds = Array.isArray(value.sourceIds) ? value.sourceIds : [];
  const sourceIds = rawSourceIds
    .map((id) => Number.parseInt(String(id).replace(/^src[-_]/i, ''), 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= sources.length)
    .map((n) => sources[n - 1].id);
  if (sourceIds.length === 0) return undefined;

  return {
    type,
    evidence: textFields[0][1],
    businessFriction: textFields[1][1],
    likelyConsequence: textFields[2][1],
    solvableOpportunity: textFields[3][1],
    outreachClaim: textFields[4][1],
    confidence,
    sourceIds,
  };
}

function selectProblemCandidates(rawCandidates: unknown, rawPrimary: unknown, sources: ResearchSource[], now: number): { primaryProblem?: ProspectProblemCandidate; problemSelection?: ProspectProblemSelection } {
  const rawList = Array.isArray(rawCandidates) ? rawCandidates : [];
  const candidates = [...rawList, ...(rawPrimary ? [rawPrimary] : [])]
    .map((value) => normalizePrimaryProblem(value, sources))
    .filter((value): value is NonNullable<ReturnType<typeof normalizePrimaryProblem>> => Boolean(value));

  const unique = candidates.filter((candidate, index, arr) =>
    arr.findIndex((x) => x.type === candidate.type && x.outreachClaim === candidate.outreachClaim) === index
  );

  const scored: ProspectProblemCandidate[] = unique.map((candidate) => {
    const evidenceStrength = Math.min(100, 50 + Math.min(40, candidate.sourceIds.length * 20) + (candidate.confidence === 'HIGH' ? 10 : candidate.confidence === 'MEDIUM' ? 5 : 0));
    const businessRelevance = Math.min(100, 40 + (candidate.businessFriction.length >= 40 ? 20 : 5) + (candidate.likelyConsequence.length >= 30 ? 20 : 5));
    const solvability = Math.min(100, 50 + (candidate.solvableOpportunity.length >= 30 ? 25 : 5) + (candidate.outreachClaim.length >= 20 ? 15 : 5));
    const clarity = candidate.outreachClaim.length <= 180 ? 90 : 60;
    const selectionScore = Math.round(evidenceStrength * 0.35 + businessRelevance * 0.25 + solvability * 0.25 + clarity * 0.15);
    return { ...candidate, evidenceStrength, businessRelevance, solvability, clarity, selectionScore, selectionReason: 'Strongest combination of evidence, business relevance, solvability and clear customer-facing claim.' };
  }).sort((a, b) => b.selectionScore - a.selectionScore);

  if (!scored.length) return {};
  const selected = scored[0];
  return {
    primaryProblem: selected,
    problemSelection: {
      candidates: scored,
      selectedIndex: 0,
      reason: selected.selectionReason,
      selectedAt: now,
    },
  };
}

async function gatherSnippets(
  ctx: SearchEconomyContext,
  prospect: Prospect,
  statusChanged: boolean,
  offerPending: boolean,
): Promise<{ snippets: string[]; sources: ResearchSource[]; cacheHits: number; budgetExceeded: number }> {
  const queries = [
    `"${prospect.businessName}" ${prospect.location}`,
    `"${prospect.businessName}" reviews OR services`,
    `${prospect.category} near ${prospect.location} competitors`,
  ];

  const sources: ResearchSource[] = [];
  const snippets: string[] = [];
  let cacheHits = 0;
  let budgetExceeded = 0;

  for (const q of queries) {
    if (snippets.length >= MAX_SNIPPETS) break;
    const searchOutcome = await runSearch(ctx, {
      purpose: 'PROSPECT_INTELLIGENCE',
      query: q,
      entityId: prospect.id,
      priority: prospect.priority === 'HIGH' || prospect.priority === 'MEDIUM' ? prospect.priority : 'LOW',
      statusChanged,
      offerPending,
      max: 4,
    });
    if (searchOutcome.budgetExceeded) {
      budgetExceeded += 1;
      continue;
    }
    if (searchOutcome.cacheHit) cacheHits += 1;
    const results = searchOutcome.results;
    for (const r of results) {
      if (snippets.length >= MAX_SNIPPETS) break;
      // Same reasoning as prospectDiscovery.ts: a Facebook GROUP is a
      // community, not this business — post content within it belongs to
      // whichever member posted it, never reliably to the business being
      // researched. Skip entirely rather than risk feeding an LLM (or a
      // human reading the digest) content misattributed to this prospect.
      if (/facebook\.com\/groups\//i.test(r.url)) continue;
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

  return { snippets, sources, cacheHits, budgetExceeded };
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
  ctx: SearchEconomyContext,
  llm: LLMProvider | null,
  prospect: Prospect,
  now: number = Date.now(),
  opts: { statusChanged?: boolean; offerPending?: boolean } = {},
): Promise<ProspectIntelligence> {
  const { snippets, sources } = await gatherSnippets(ctx, prospect, opts.statusChanged ?? false, opts.offerPending ?? false);

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
          ...selectProblemCandidates(analysis.problemCandidates, analysis.primaryProblem, sources, now),
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
