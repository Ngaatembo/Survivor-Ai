/* ============================================================================
 * SURVIVE AI — AI decision service
 * ----------------------------------------------------------------------------
 * v1 runs a transparent, auditable local rule engine. The exported interfaces
 * (decide(), generateReport()) are exactly what an LLM-backed provider will
 * implement when connectors.claude / connectors.openai are connected. All
 * rule-engine outputs are labelled as such in the UI.
 * ========================================================================== */

import type {
  MemoryEntry,
  Opportunity,
  ResearchReport,
  Transaction,
} from '../types';
import { STARTING_BUDGET } from '../lib/scoring';
import { dayRange, capRange, uid } from '../lib/format';
import { balanceFrom } from './wallet';

export interface Decision {
  selected: Opportunity | null;
  alternatives: Opportunity[];
  reasons: string[];
  rejections: { opportunity: Opportunity; reason: string }[];
  confidence: number; // 0..1
}

/**
 * Choose the next experiment.
 * Rules: finance/blocked models are never auto-executed (research-only);
 * memory AVOID conclusions are skipped; budget must cover minimum capital;
 * ranking blends score with learned results.
 */
export function decide(
  ranked: Opportunity[],
  memory: MemoryEntry[],
  transactions: Transaction[],
): Decision {
  const balance = balanceFrom(transactions);
  const rejections: Decision['rejections'] = [];
  const candidates: { opp: Opportunity; adjusted: number; reasons: string[] }[] = [];

  for (const opp of ranked) {
    if (!opp.score || opp.researchStage === 'UNDISCOVERED') continue;

    if (opp.executionBlocked) {
      rejections.push({
        opportunity: opp,
        reason: opp.blockReason ?? 'High-risk category — research only, never auto-executed.',
      });
      continue;
    }
    if (opp.capitalRequiredMin > Math.max(STARTING_BUDGET, balance)) {
      rejections.push({
        opportunity: opp,
        reason: `Capital requirement ${capRange(opp.capitalRequiredMin, opp.capitalRequiredMax)} exceeds available simulated budget.`,
      });
      continue;
    }

    const mem = memory.find((m) => m.kind === 'opportunity' && m.refId === opp.id);
    if (mem?.conclusion === 'AVOID') {
      rejections.push({
        opportunity: opp,
        reason: `Memory: tested ${mem.tests}× with $${mem.spent.toFixed(2)} spent and $${mem.revenue.toFixed(2)} returned — concluded AVOID.`,
      });
      continue;
    }
    if (mem && mem.tests >= 4 && mem.conclusion !== 'VIABLE') {
      rejections.push({
        opportunity: opp,
        reason: `Memory: already tested ${mem.tests}× without proving viable — exploration budget exhausted, moving to new models.`,
      });
      continue;
    }

    let adjusted = opp.score.total;
    const reasons: string[] = [];
    reasons.push(`Composite score ${opp.score.total}/100 (${opp.score.recommendation}).`);
    reasons.push(
      `Capital ${capRange(opp.capitalRequiredMin, opp.capitalRequiredMax)} fits the $${STARTING_BUDGET} budget; first revenue in ${dayRange(opp.timeToRevenueDaysMin, opp.timeToRevenueDaysMax)}.`,
    );

    if (mem) {
      if (mem.conclusion === 'PROMISING' || mem.conclusion === 'VIABLE') {
        adjusted += 6;
        reasons.push(
          `Memory boost: prior tests returned $${mem.revenue.toFixed(2)} on $${mem.spent.toFixed(2)} spent — reinforcing a winner.`,
        );
      } else if (mem.conclusion === 'MIXED') {
        adjusted -= 4;
        reasons.push('Memory caution: mixed prior results — one more carefully designed test.');
      }
    }
    if (opp.evidenceTier === 'VERIFIED') reasons.push('Evidence tier VERIFIED — model is well documented.');
    if (opp.risk <= 2) reasons.push(`Risk ${opp.riskLevel}: downside is capped at the small test budget.`);
    if (opp.researchStage !== 'RANKED') reasons.push('Freshly discovered model — exploration value.');

    candidates.push({ opp, adjusted, reasons });
  }

  candidates.sort((a, b) => b.adjusted - a.adjusted);
  const top = candidates[0];

  const confidence = top
    ? Math.min(
        0.92,
        0.35 +
          (top.opp.score?.total ?? 0) / 220 +
          (top.opp.evidenceTier === 'VERIFIED' ? 0.12 : top.opp.evidenceTier === 'LIKELY' ? 0.06 : 0) +
          (memory.find((m) => m.kind === 'opportunity' && m.refId === top.opp.id && m.revenue > 0)
            ? 0.1
            : 0),
      )
    : 0;

  return {
    selected: top?.opp ?? null,
    alternatives: candidates.slice(1, 4).map((c) => c.opp),
    reasons: top?.reasons ?? ['No executable candidate available this cycle.'],
    rejections,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * Generate a structured research report. v1: rule-engine template from the
 * opportunity's verified fields. Later: an LLM provider fills these sections
 * after live research; the report shape stays identical.
 */
export function generateReport(opp: Opportunity): ResearchReport {
  const score = opp.score?.total ?? 0;
  const confidence =
    Math.round(
      Math.min(
        0.95,
        0.3 + score / 250 + (opp.evidenceTier === 'VERIFIED' ? 0.15 : opp.evidenceTier === 'LIKELY' ? 0.08 : 0),
      ) * 100,
    ) / 100;

  return {
    id: uid('rpt'),
    opportunityId: opp.id,
    opportunityName: opp.name,
    generatedAt: Date.now(),
    generator: 'local-rule-engine',
    dataSource: opp.dataSource,
    executiveSummary: `${opp.name} is a ${opp.category.toLowerCase()} model scored ${score}/100 by the SURVIVE AI engine. It requires ${capRange(opp.capitalRequiredMin, opp.capitalRequiredMax)} of simulated starting capital and projects first revenue within ${dayRange(opp.timeToRevenueDaysMin, opp.timeToRevenueDaysMax)}. Evidence tier: ${opp.evidenceTier}. ${opp.executionBlocked ? 'This model is classified RESEARCH ONLY and is excluded from autonomous execution.' : `Recommendation: ${opp.score?.recommendation ?? 'UNSCORED'} for a $${STARTING_BUDGET} budget.`}`,
    marketOpportunity: opp.description,
    howItWorks: opp.howMoneyMade,
    capitalRequirements: `Estimated starting capital ${capRange(opp.capitalRequiredMin, opp.capitalRequiredMax)}. Operating costs: ${opp.operatingCostsNote}`,
    competition: `Competition intensity rated ${opp.competition}/5 and execution difficulty ${opp.difficulty}/5. Scalability rated ${opp.scalability}/5.`,
    risks: [
      `Primary downside: ${opp.downsideNote}`,
      `Risk rating: ${opp.riskLevel} (${opp.risk}/5).`,
      `Evidence limitation: ${opp.evidenceNotes}`,
    ],
    evidence: `Evidence tier ${opp.evidenceTier}. ${opp.evidenceNotes} Sources: ${opp.sources
      .map((s) => s.title)
      .join('; ')}.`,
    potentialRevenue: `Modeled monthly range $${Math.max(0, opp.revenuePotentialMonthlyMin)}–$${Math.max(0, opp.revenuePotentialMonthlyMax)} after ramp-up. A first experiment is expected to return a fraction of this.`,
    recommendedExperiment: `Run one time-boxed experiment with the minimum viable budget (${capRange(0, Math.max(2, opp.capitalRequiredMin))}), focused on a single offer and a single channel. Define success as first revenue or validated demand within ${dayRange(opp.timeToRevenueDaysMin, opp.timeToRevenueDaysMax)}. Record cost, revenue and lessons regardless of outcome.`,
    confidence,
    finalScore: score,
  };
}

export function strategyFromMemory(
  memory: MemoryEntry[],
  balance: number,
  threshold: number,
): { strategy: string; objective: string } {
  const tested = memory.filter((m) => m.tests > 0);
  const winners = tested
    .filter((m) => m.revenue > m.spent)
    .sort((a, b) => b.revenue - a.revenue);
  const winner = winners.find((w) => w.kind === 'opportunity') ?? winners[0];

  if (balance <= threshold) {
    return {
      strategy: 'DEFENSIVE — capital near survival threshold.',
      objective: 'Survive: run only zero/low-capital, fast-cash experiments; cut all non-essential spend.',
    };
  }
  if (winner) {
    const w = winner;
    return {
      strategy: `EXPLOIT — double down on proven model: "${w.title}".`,
      objective: `Repeat and systematize the winning pattern ($${w.revenue.toFixed(2)} returned on $${w.spent.toFixed(2)} spent) while testing one adjacent model per cycle.`,
    };
  }
  if (tested.length > 0) {
    return {
      strategy: 'EXPLORE — no repeatable winner yet; broad low-capital testing.',
      objective: 'Test the highest-scoring sub-$15 service/digital models until one returns positive cash flow.',
    };
  }
  return {
    strategy: 'INITIAL EXPLORATION — map the opportunity space.',
    objective: 'Discover and score opportunities, then run the first low-capital experiment.',
  };
}
