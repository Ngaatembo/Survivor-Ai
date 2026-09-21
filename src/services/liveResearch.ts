/* ============================================================================
 * LIVE research pipeline.
 * When a SearchProvider + LLMProvider are connected, discovery becomes real:
 *   search queries per category  →  result snippets  →  LLM extracts the
 *   opportunity attributes + evidence tier  →  LIVE opportunity with cited
 *   research_sources. Finance/high-risk results stay executionBlocked.
 *
 * Every failure degrades gracefully to the SAMPLE knowledge base — the
 * pipeline never produces fake "live" data: if no provider is connected it
 * returns an empty list and the caller tags the run as sample-based.
 * ========================================================================== */

import type { Category, DataSource, Opportunity } from '../types';
import { uid } from '../lib/format';
import { scoreOpportunity } from '../lib/scoring';
import type { LLMProvider } from './providers/types';
import { runSearch, type SearchEconomyContext } from './searchEconomy';

/** Queries used to sweep each category in a live discovery pass. */
export const DISCOVERY_QUERIES: { category: Category; query: string }[] = [
  // Revenue-first discovery: search for evidence of a buyer/problem/channel,
  // not generic "ways to make money" lists. This makes scarce web-search
  // calls useful for finding something we can actually sell, while the
  // opportunity scorer still decides whether the evidence is worth pursuing.
  { category: 'Digital Business', query: 'small businesses actively seeking affordable AI automation website booking lead generation services Zimbabwe Africa' },
  { category: 'Services', query: 'businesses hiring freelancers for website design social media automation lead generation Zimbabwe Africa' },
  { category: 'Content', query: 'businesses looking for content creators video social media marketing services Zimbabwe Africa' },
  { category: 'E-Commerce', query: 'small businesses seeking ecommerce website setup online ordering payment delivery services Zimbabwe Africa' },
  { category: 'Local / Real-World', query: 'Zimbabwe small businesses contact website online booking digital marketing automation services needed' },
  { category: 'Finance', query: 'retail forex crypto trading success rates retail investors lose money regulator data' },
];

const FINANCE_HINTS = ['forex', 'crypto', 'trading', 'betting', 'prediction market', 'day trading', 'cfd'];

function clampInt(n: number, lo: number, hi: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function clampNum(n: number, lo: number, hi: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Run one live discovery pass. Returns new LIVE opportunities. `dedupeAgainst`
 * is the set of names already in the DB (fuzzy name-match). Returns
 * { opportunities, queriesRun, sourcesCount, cacheHits, budgetExceeded } so
 * the caller can log honestly.
 *
 * Every query goes through the search-economy layer (services/searchEconomy.ts)
 * under purpose OPPORTUNITY_DISCOVERY, entityId = the category — so each
 * category is only actually re-searched once its 7-day cache TTL expires or
 * the budget resets, instead of on every 30-minute cycle (the single
 * largest source of avoidable search volume before this overhaul; see
 * docs/SURVIVAL_ECONOMICS_AUDIT.md).
 */
export async function discoverLive(
  ctx: SearchEconomyContext,
  llm: LLMProvider | null,
  dedupeAgainst: string[],
): Promise<{ opportunities: Opportunity[]; queriesRun: number; sourcesCount: number; cacheHits: number; budgetExceeded: number }> {
  const found: Opportunity[] = [];
  let queriesRun = 0;
  let sourcesCount = 0;
  let cacheHits = 0;
  let budgetExceeded = 0;

  for (const { category, query } of DISCOVERY_QUERIES) {
    const searchOutcome = await runSearch(ctx, {
      purpose: 'OPPORTUNITY_DISCOVERY',
      query,
      entityId: category,
      max: 5,
    });
    if (searchOutcome.budgetExceeded) {
      budgetExceeded += 1;
      continue;
    }
    if (searchOutcome.cacheHit) cacheHits += 1;
    const results = searchOutcome.results;
    queriesRun += 1;
    if (results.length === 0) continue;

    const candidateName = candidateFromQuery(category);
    const name = `${candidateName} (live research)`;

    // Cache hits mean we already paid for this evidence recently. If the
    // category already produced a stored opportunity, do not spend another
    // LLM call re-analyzing the same snippets every 30 minutes.
    if (dedupeAgainst.some((n) => n.toLowerCase().includes(candidateName.toLowerCase()))) {
      sourcesCount += results.length;
      continue; // existing opportunity already owns this evidence
    }

    const snippets = results.map((r) => `${r.title} — ${r.snippet}`);
    const analysis = llm?.analyzeOpportunity
      ? await llm.analyzeOpportunity({ name: candidateName, category, snippets }).catch(() => null)
      : null;

    const isFinance = category === 'Finance' || FINANCE_HINTS.some((h) => query.includes(h));

    const sources = results.map((r, i) => ({
      id: uid('src'),
      title: r.title.slice(0, 140),
      url: r.url,
      kind: 'web' as const,
      note: `Live search result ${i + 1} via ${searchOutcome.providerUsed}${r.publishedAt ? ` · ${r.publishedAt}` : ''}`,
    }));
    sourcesCount += sources.length;

    const dataSource: DataSource = 'LIVE';
    const tier: Opportunity['evidenceTier'] = (
      ['VERIFIED', 'LIKELY', 'UNCERTAIN', 'UNVERIFIED'] as const
    ).includes(analysis?.evidenceTier as never)
      ? (analysis!.evidenceTier as Opportunity['evidenceTier'])
      : 'UNCERTAIN';

    const riskNum = (isFinance ? 5 : clampInt(analysis?.risk ?? 3, 1, 5)) as 1 | 2 | 3 | 4 | 5;
    const diffNum = clampInt(analysis?.difficulty ?? 3, 1, 5) as 1 | 2 | 3 | 4 | 5;
    const compNum = clampInt(analysis?.competition ?? 3, 1, 5) as 1 | 2 | 3 | 4 | 5;
    const scaleNum = clampInt(analysis?.scalability ?? 3, 1, 5) as 1 | 2 | 3 | 4 | 5;
    const riskLevels: Opportunity['riskLevel'][] = ['Low', 'Low–Medium', 'Medium', 'Medium–High', 'High'];

    const opp: Opportunity = {
      id: uid('opp-live'),
      name,
      category,
      tags: ['live research', category.toLowerCase()],
      dataSource,
      researchStage: 'DISCOVERED',
      lifecycleState: 'DISCOVERED',
      description:
        analysis?.summary ||
        `Opportunity surfaced by live web research in the ${category} category. Attributes extracted by ${llm?.label ?? 'rule engine'} from ${results.length} sources pending verification.`,
      howMoneyMade: analysis?.howMoneyMade || 'Mechanism pending verification from live sources.',
      capitalRequiredMin: clampNum(analysis?.capitalRequiredMin ?? 10, 0, 5000),
      capitalRequiredMax: clampNum(analysis?.capitalRequiredMax ?? 50, 0, 10000),
      timeToRevenueDaysMin: clampInt(analysis?.timeToRevenueDaysMin ?? 14, 1, 1095),
      timeToRevenueDaysMax: clampInt(analysis?.timeToRevenueDaysMax ?? 60, 1, 1095),
      skills: (analysis?.skills ?? ['General execution']).slice(0, 6),
      difficulty: diffNum,
      competition: compNum,
      scalability: scaleNum,
      risk: riskNum,
      riskLevel: isFinance ? 'High' : riskLevels[riskNum - 1],
      geographicRelevance:
        category === 'Local / Real-World' ? ['Zimbabwe', 'Africa'] : ['Global online'],
      evidenceTier: tier,
      evidenceNotes:
        analysis?.evidenceNotes ||
        `Live search surfaced ${results.length} sources; extracted by ${llm?.label ?? 'heuristics'} and not yet independently verified. Treat as UNCERTAIN until browser verification is connected.`,
      successProbability: clampNum(analysis?.successProbability ?? 0.25, 0.02, 0.95),
      revenuePotentialMonthlyMin: clampNum(analysis?.revenuePotentialMonthlyMin ?? 0, 0, 100000),
      revenuePotentialMonthlyMax: clampNum(analysis?.revenuePotentialMonthlyMax ?? 200, 0, 100000),
      upsideNote: analysis?.upsideNote || 'Upside pending verification.',
      downsideNote: analysis?.downsideNote || 'Downside and failure modes pending verification.',
      operatingCostsNote: analysis?.operatingCostsNote || 'Operating costs pending verification.',
      examples: (analysis?.examples ?? []).slice(0, 4),
      sources,
      dateResearched: Date.now(),
      executionBlocked: isFinance,
      blockReason: isFinance
        ? 'High-risk financial speculation. Research-only category: never auto-executed; requires explicit human authorization, limits and audit controls.'
        : undefined,
    };
    // Score it immediately so ranking/decision can use it.
    opp.score = scoreOpportunity(opp);
    found.push(opp);
  }

  return { opportunities: found, queriesRun, sourcesCount, cacheHits, budgetExceeded };
}

function candidateFromQuery(category: Category): string {
  const map: Record<Category, string> = {
    'Digital Business': 'AI automation & website service (live-sourced)',
    Content: 'Business content service (live-sourced)',
    'E-Commerce': 'E-commerce setup service (live-sourced)',
    Services: 'Business freelance service (live-sourced)',
    Finance: 'Financial / trading strategy (live-sourced)',
    'Local / Real-World': 'Local business digital service (live-sourced)',
  };
  return map[category];
}
