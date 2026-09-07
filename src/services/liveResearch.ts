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
import type { LLMProvider, SearchProvider } from './providers/types';

/** Queries used to sweep each category in a live discovery pass. */
export const DISCOVERY_QUERIES: { category: Category; query: string }[] = [
  { category: 'Digital Business', query: 'legitimate low-cost online business models AI services 2025 beginners make money' },
  { category: 'Services', query: 'freelance services beginners can offer online to earn first income fast' },
  { category: 'Content', query: 'content creator business models that make money newsletter youtube affiliate 2025' },
  { category: 'E-Commerce', query: 'low budget e-commerce business models digital products print on demand reselling' },
  { category: 'Local / Real-World', query: 'small business opportunities Africa Zimbabwe youth low capital 2025' },
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
 * { opportunities, queriesRun, providerUsed } so the caller can log honestly.
 */
export async function discoverLive(
  search: SearchProvider,
  llm: LLMProvider | null,
  dedupeAgainst: string[],
): Promise<{ opportunities: Opportunity[]; queriesRun: number; sourcesCount: number }> {
  const found: Opportunity[] = [];
  let queriesRun = 0;
  let sourcesCount = 0;

  for (const { category, query } of DISCOVERY_QUERIES) {
    let results: Awaited<ReturnType<SearchProvider['search']>>;
    try {
      results = await search.search(query, 5);
    } catch {
      results = [];
    }
    queriesRun += 1;
    if (results.length === 0) continue;

    const snippets = results.map((r) => `${r.title} — ${r.snippet}`);
    const candidateName = candidateFromQuery(category);
    const analysis = llm?.analyzeOpportunity
      ? await llm.analyzeOpportunity({ name: candidateName, category, snippets }).catch(() => null)
      : null;

    const name = `${candidateName} (live research)`;
    if (dedupeAgainst.some((n) => n.toLowerCase().includes(candidateName.toLowerCase()))) {
      sourcesCount += results.length;
      continue; // don't duplicate a model we already hold
    }

    const isFinance = category === 'Finance' || FINANCE_HINTS.some((h) => query.includes(h));

    const sources = results.map((r, i) => ({
      id: uid('src'),
      title: r.title.slice(0, 140),
      url: r.url,
      kind: 'web' as const,
      note: `Live search result ${i + 1} via ${search.label}${r.publishedAt ? ` · ${r.publishedAt}` : ''}`,
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

  return { opportunities: found, queriesRun, sourcesCount };
}

function candidateFromQuery(category: Category): string {
  const map: Record<Category, string> = {
    'Digital Business': 'AI-enabled digital service (live-sourced)',
    Content: 'Content monetization model (live-sourced)',
    'E-Commerce': 'Low-budget e-commerce model (live-sourced)',
    Services: 'Online freelance service (live-sourced)',
    Finance: 'Financial / trading strategy (live-sourced)',
    'Local / Real-World': 'Local low-capital business (live-sourced)',
  };
  return map[category];
}
