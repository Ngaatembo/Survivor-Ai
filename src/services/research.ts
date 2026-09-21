/* ============================================================================
 * SURVIVE AI — Research service
 * ----------------------------------------------------------------------------
 * Legacy development-only research helpers. Production discovery is handled
 * by liveResearch.ts and the Worker never falls back to SAMPLE records.
 *
 * These functions remain for deterministic smoke tests and local development:
 *   discoverFromKnowledgeBase() -> development fixtures
 *   advanceStage()/scoreAll()/rankOpportunities() -> pure research transforms
 *
 * Production cycles explicitly use discoverLive().
 * ========================================================================== */

import type { Opportunity, ResearchStage } from '../types';
import { scoreOpportunity } from '../lib/scoring';
import type { CategoryRealWorldStats } from '../lib/realRevenue';

/** Pull not-yet-discovered opportunities from the local seeded knowledge base. */
export function discoverFromKnowledgeBase(
  opportunities: Opportunity[],
  count: number,
): { discovered: Opportunity[]; remaining: number } {
  const undiscovered = opportunities.filter((o) => o.researchStage === 'UNDISCOVERED');
  const picked = undiscovered.slice(0, count);
  return { discovered: picked, remaining: undiscovered.length - picked.length };
}

/** Advance research stages and (at SCORE stage) attach score breakdowns. */
export function advanceStage(
  opportunities: Opportunity[],
  ids: string[],
  stage: ResearchStage,
  at: number = Date.now(),
  categoryStats: CategoryRealWorldStats[] = [],
): Opportunity[] {
  const order: ResearchStage[] = [
    'UNDISCOVERED',
    'DISCOVERED',
    'RESEARCHED',
    'VERIFIED',
    'SCORED',
    'RANKED',
  ];
  return opportunities.map((o) => {
    if (!ids.includes(o.id)) return o;
    const currentIdx = order.indexOf(o.researchStage);
    const targetIdx = order.indexOf(stage);
    if (targetIdx <= currentIdx) return o;
    const next: Opportunity = { ...o, researchStage: stage };
    if (stage === 'DISCOVERED' && !o.dateResearched) next.dateResearched = at;
    if (stage === 'SCORED') next.score = scoreOpportunity(o, categoryStats);
    return next;
  });
}

/** Score everything that has reached verification. */
export function scoreAll(opportunities: Opportunity[], categoryStats: CategoryRealWorldStats[] = []): Opportunity[] {
  return opportunities.map((o) => {
    if (o.researchStage === 'UNDISCOVERED' || o.researchStage === 'DISCOVERED') return o;
    return { ...o, researchStage: o.researchStage === 'RANKED' ? 'RANKED' : 'SCORED', score: scoreOpportunity(o, categoryStats) };
  });
}

export function rankOpportunities(opportunities: Opportunity[], categoryStats: CategoryRealWorldStats[] = []): Opportunity[] {
  const scored = opportunities.map((o) =>
    o.score || o.researchStage === 'UNDISCOVERED' || o.researchStage === 'DISCOVERED'
      ? o
      : { ...o, score: scoreOpportunity(o, categoryStats) },
  );
  // Stable ranking: score desc, then capital asc, then speed asc.
  return [...scored].sort((a, b) => {
    const sa = a.researchStage === 'UNDISCOVERED' ? -1 : a.score!.total;
    const sb = b.researchStage === 'UNDISCOVERED' ? -1 : b.score!.total;
    if (sb !== sa) return sb - sa;
    if (a.capitalRequiredMin !== b.capitalRequiredMin)
      return a.capitalRequiredMin - b.capitalRequiredMin;
    return a.timeToRevenueDaysMax - b.timeToRevenueDaysMax;
  });
}
