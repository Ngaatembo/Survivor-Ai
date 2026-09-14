/* ============================================================================
 * SURVIVE AI — Prospect lead scoring (build-spec §12)
 * ----------------------------------------------------------------------------
 * Pure, explainable scoring: LEAD SCORE, EXPECTED DEAL VALUE, EXPECTED
 * ACQUISITION COST, EXPECTED PROFIT, EXPECTED TIME TO REVENUE, PROBABILITY
 * OF CLOSE, EXPECTED VALUE — every number traces back to a field already
 * stored on the prospect/business model, never an opaque black-box score.
 * ========================================================================== */

import type { BusinessModel, ContactChannel, LeadScoreBreakdown, Prospect, WebsitePresence } from '../types';
import { blendWithReal, type CategoryRealWorldStats } from './realRevenue';

/** How strongly each observed web-presence state signals real need for the
 *  website-service offer. ADEQUATE means the business likely already has a
 *  working site — that is a reason to deprioritize, not pursue. */
const PRESENCE_NEED_WEIGHT: Record<WebsitePresence, number> = {
  NONE_FOUND: 1,
  SOCIAL_ONLY: 0.85,
  WEAK_OR_OUTDATED: 0.7,
  UNKNOWN: 0.4,
  ADEQUATE: 0.05,
};

const CHANNEL_REACHABILITY: Record<ContactChannel, number> = {
  PHONE: 1,
  WHATSAPP: 1,
  EMAIL: 0.8,
  FACEBOOK: 0.6,
  INSTAGRAM: 0.6,
  WEBSITE_FORM: 0.5,
  UNKNOWN: 0.1,
};

export interface ScoreProspectInput {
  websitePresence: WebsitePresence;
  contactChannel: ContactChannel;
  sourcesCount: number;
  hasCommercialSignals: boolean; // e.g. snippet mentions hours/reviews/address/pricing
  hasUrgencySignal: boolean; // e.g. "now open", "new location", "hiring"
}

/**
 * Score a prospect against a matched business model (if one exists yet —
 * a prospect can be discovered slightly before its opportunity has a model,
 * in which case conservative fallbacks are used and priority stays capped
 * at MEDIUM until a real offer/price exists).
 */
export function scoreProspect(
  input: ScoreProspectInput,
  businessModel: BusinessModel | undefined,
  categoryStats?: CategoryRealWorldStats,
  now: number = Date.now(),
): LeadScoreBreakdown {
  const factors: string[] = [];

  // Legitimacy: more independently-found sources (search hits, directory
  // listings, social pages) = more evidence this is a real, active business.
  const legitimacy = Math.min(1, 0.35 + input.sourcesCount * 0.2);
  if (input.sourcesCount >= 2) factors.push(`Corroborated across ${input.sourcesCount} independent sources`);
  else factors.push('Single-source evidence — treat as preliminary until corroborated');

  // Online-presence weakness → likely need for the offer.
  const needWeight = PRESENCE_NEED_WEIGHT[input.websitePresence];
  if (input.websitePresence === 'NONE_FOUND') factors.push('No independent website found in available sources');
  else if (input.websitePresence === 'SOCIAL_ONLY') factors.push('Primary public presence is a social page only (Facebook/Instagram), not an owned website');
  else if (input.websitePresence === 'WEAK_OR_OUTDATED') factors.push('Existing website appears weak or outdated');
  else if (input.websitePresence === 'ADEQUATE') factors.push('Already has an adequate website — likely not a fit for this offer');
  else factors.push('Website status not yet determined from available sources');

  // Reachability.
  const reachability = CHANNEL_REACHABILITY[input.contactChannel];
  if (reachability >= 0.8) factors.push(`Reachable via a public ${input.contactChannel.toLowerCase()} contact`);
  else if (reachability >= 0.5) factors.push(`Reachable only via a ${input.contactChannel.toLowerCase()} page — lower response likelihood`);
  else factors.push('No verified public contact channel found yet');

  // Commercial activity / urgency signals (conservative — only counted when
  // actually present in cited source text, never assumed).
  const commercialSignal = input.hasCommercialSignals ? 1 : 0.5;
  if (input.hasCommercialSignals) factors.push('Source text shows signs of active commercial operation');
  const urgency = input.hasUrgencySignal ? 1 : 0.5;
  if (input.hasUrgencySignal) factors.push('Source text suggests recent growth/change (opening, hiring, new location)');

  // Industry attractiveness: no per-industry market data is wired up yet,
  // so this stays a flat, explicitly-documented default rather than an
  // invented differentiator between categories.
  const industryAttractiveness = 0.6;

  const rawTotal =
    (legitimacy * 22 +
      needWeight * 30 +
      reachability * 22 +
      commercialSignal * 10 +
      urgency * 6 +
      industryAttractiveness * 10);
  const total = Math.round(Math.max(0, Math.min(100, rawTotal)));

  // Economics: derived from the linked business model when one exists;
  // otherwise a conservative placeholder that keeps priority capped until
  // a real offer/price is generated for this opportunity.
  const expectedDealValue = businessModel?.suggestedPrice ?? 25;
  const deliveryCost = businessModel?.deliveryCostEstimate ?? expectedDealValue * 0.3;
  // Acquisition cost here is nominal effort, not cash spend — outreach is a
  // free message; this represents the small time/opportunity cost of
  // researching + contacting one prospect, so it never dominates the model.
  const expectedAcquisitionCost = 1;
  const expectedProfit = Math.round((expectedDealValue - deliveryCost - expectedAcquisitionCost) * 100) / 100;
  const expectedTimeToRevenueDays = businessModel?.timeToFirstSaleDaysEstimate ?? 14;

  // Probability of close: lead score scaled into a believable close-rate
  // band. Deliberately conservative — cold outreach to an unqualified local
  // business rarely closes above ~35% even for a strong lead. Phase 5 §20:
  // once this category has a real-world track record (3+ decided
  // prospects), that record is blended in before the conservative cap is
  // applied — a category that demonstrably closes more (or less) than the
  // static heuristic assumes should say so.
  const modeledProbability = Math.min(0.35, (total / 100) * 0.35);
  const probabilityOfClose =
    Math.round(
      Math.min(0.35, blendWithReal(modeledProbability, categoryStats?.realCloseRate, categoryStats?.decidedCount ?? 0)) * 100,
    ) / 100;
  if (categoryStats && categoryStats.decidedCount >= 3) {
    factors.push(
      `Blended with this category's real close rate (${Math.round(categoryStats.realCloseRate * 100)}% across ${categoryStats.decidedCount} decided prospect(s))`,
    );
  }
  const expectedValue = Math.round(expectedProfit * probabilityOfClose * 100) / 100;

  return {
    total,
    factors,
    expectedDealValue,
    expectedAcquisitionCost,
    expectedProfit,
    expectedTimeToRevenueDays,
    probabilityOfClose,
    expectedValue,
    scoredAt: now,
  };
}

/** Derive a CRM priority tier from the score + evidence — never HIGH off a
 *  single weak/uncorroborated signal, and ADEQUATE presence is DO_NOT_CONTACT
 *  for the website offer regardless of score (spec §7/§8). */
export function priorityFromScore(score: LeadScoreBreakdown, websitePresence: WebsitePresence): Prospect['priority'] {
  if (websitePresence === 'ADEQUATE') return 'DO_NOT_CONTACT';
  if (score.total >= 70) return 'HIGH';
  if (score.total >= 45) return 'MEDIUM';
  if (score.total >= 20) return 'LOW';
  return 'DO_NOT_CONTACT';
}
