/* ============================================================================
 * SURVIVE AI — "What should I do now?" recommendation engine (build-spec §16)
 * ----------------------------------------------------------------------------
 * Pure function: derives a ranked action list from current opportunities +
 * their latest decisions + business models. Recomputed and fully replaced
 * every cycle (agentEngine calls repo.replaceActions()) — this is derived
 * state, not history; the history lives in opportunity_decisions.
 * ========================================================================== */

import type {
  BusinessModel,
  Opportunity,
  OpportunityDecision,
  Prospect,
  RecommendedAction,
  RecommendedActionKind,
} from '../types';
import { realRevenueScore } from './decisionEngine';
import { uid } from './format';
import type { MemoryEntry } from '../types';

function latestDecisionFor(opportunityId: string, decisions: OpportunityDecision[]): OpportunityDecision | undefined {
  return decisions
    .filter((d) => d.opportunityId === opportunityId)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

interface ActionInput {
  kind: RecommendedActionKind;
  opportunity?: Opportunity;
  prospect?: Prospect;
  title: string;
  description: string;
  expectedValue: number;
  urgency: RecommendedAction['urgency'];
  effort: RecommendedAction['effort'];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeRecommendedActions(
  opportunities: Opportunity[],
  decisions: OpportunityDecision[],
  businessModels: BusinessModel[],
  memory: MemoryEntry[],
  prospects: Prospect[] = [],
  now: number = Date.now(),
  recentWindowMs: number = 2 * 60 * 60 * 1000,
): RecommendedAction[] {
  const inputs: ActionInput[] = [];

  for (const opp of opportunities) {
    if (opp.researchStage === 'UNDISCOVERED') continue;
    const decision = latestDecisionFor(opp.id, decisions);
    const model = businessModels.find((m) => m.opportunityId === opp.id);
    const score = realRevenueScore(opp, memory);

    if (opp.lifecycleState === 'PROVEN' || opp.lifecycleState === 'SCALING') {
      inputs.push({
        kind: opp.lifecycleState === 'SCALING' ? 'PURSUE_MODEL' : 'REVIEW_PROVEN',
        opportunity: opp,
        title: `${opp.lifecycleState === 'SCALING' ? 'Scale' : 'Review'}: ${opp.name}`,
        description: model
          ? `${opp.lifecycleState === 'SCALING' ? 'Keep pursuing' : 'Start real outreach for'} "${opp.name}" — suggested price $${model.suggestedPrice}, expected profit $${model.expectedProfitFirstDeal.toFixed(2)} on the first deal. Next: ${model.nextAction}`
          : `"${opp.name}" is ${opp.lifecycleState} but has no business model yet — one will be generated next cycle.`,
        expectedValue: model?.expectedProfitFirstDeal ?? score,
        urgency: opp.lifecycleState === 'SCALING' ? 5 : 4,
        effort: 3,
      });
    } else if (opp.lifecycleState === 'VALIDATING') {
      if (decision?.action === 'ITERATE') {
        inputs.push({
          kind: 'ITERATE_OFFER',
          opportunity: opp,
          title: `Change something and re-test: ${opp.name}`,
          description: decision.reasoning + ' ' + decision.nextAction,
          expectedValue: score * 0.5,
          urgency: 3,
          effort: 2,
        });
      } else {
        inputs.push({
          kind: 'RUN_EXPERIMENT',
          opportunity: opp,
          title: `Keep testing: ${opp.name}`,
          description: decision?.nextAction ?? `Run another experiment to build evidence for "${opp.name}".`,
          expectedValue: score * 0.3,
          urgency: 2,
          effort: 2,
        });
      }
    } else if (opp.lifecycleState === 'DISCOVERED' && opp.score && opp.score.total >= 50) {
      inputs.push({
        kind: 'WAIT_FOR_EVIDENCE',
        opportunity: opp,
        title: `Ready to validate: ${opp.name}`,
        description: `Scored ${opp.score.total}/100 — will move into active testing next cycle.`,
        expectedValue: score * 0.2,
        urgency: 1,
        effort: 1,
      });
    }

    // Surface a KILL decision made recently so the user sees it, even
    // though there's no further action to take on it.
    if (decision?.action === 'KILL' && now - decision.createdAt <= recentWindowMs) {
      inputs.push({
        kind: 'STOP_OPPORTUNITY',
        opportunity: opp,
        title: `Stopped: ${opp.name}`,
        description: decision.reasoning,
        expectedValue: 0,
        urgency: 1,
        effort: 1,
      });
    }
  }

  // Prospect-driven actions (build-spec §16 examples: "Contact Business X",
  // "Follow up with Business Y"). Never suggests contacting a DO_NOT_CONTACT
  // prospect or one already past outreach without a due follow-up.
  for (const p of prospects) {
    if (p.priority === 'DO_NOT_CONTACT' || p.status === 'WON' || p.status === 'LOST' || p.status === 'NOT_INTERESTED') continue;

    if (p.status === 'DISCOVERED' || p.status === 'QUALIFIED') {
      inputs.push({
        kind: 'CONTACT_PROSPECT',
        prospect: p,
        title: `Contact ${p.businessName}`,
        description: `${p.priority} priority — ${p.evidenceNotes} Estimated deal $${p.score.expectedDealValue.toFixed(0)}, ~${Math.round(p.score.probabilityOfClose * 100)}% probability of close.`,
        expectedValue: p.score.expectedValue,
        urgency: p.priority === 'HIGH' ? 5 : p.priority === 'MEDIUM' ? 3 : 1,
        effort: 1,
      });
    } else if (p.nextFollowUpAt && p.nextFollowUpAt <= now) {
      inputs.push({
        kind: 'FOLLOW_UP_PROSPECT',
        prospect: p,
        title: `Follow up with ${p.businessName}`,
        description: `Status ${p.status.replace('_', ' ').toLowerCase()} — follow-up was due ${new Date(p.nextFollowUpAt).toLocaleDateString()}.`,
        expectedValue: p.score.expectedValue * 0.8,
        urgency: 4,
        effort: 1,
      });
    } else if (p.status === 'CONTACTED' && p.lastContactAt && now - p.lastContactAt > 3 * DAY_MS) {
      inputs.push({
        kind: 'FOLLOW_UP_PROSPECT',
        prospect: p,
        title: `Follow up with ${p.businessName}`,
        description: `Contacted ${Math.round((now - p.lastContactAt) / DAY_MS)} day(s) ago with no recorded reply yet.`,
        expectedValue: p.score.expectedValue * 0.6,
        urgency: 2,
        effort: 1,
      });
    }
  }

  inputs.sort((a, b) => b.expectedValue - a.expectedValue || b.urgency - a.urgency);

  return inputs.slice(0, 10).map((input, i) => ({
    id: uid('act'),
    kind: input.kind,
    opportunityId: input.opportunity?.id,
    opportunityName: input.opportunity?.name,
    prospectId: input.prospect?.id,
    prospectName: input.prospect?.businessName,
    title: input.title,
    description: input.description,
    expectedValue: Math.round(input.expectedValue * 100) / 100,
    urgency: input.urgency,
    effort: input.effort,
    rank: i + 1,
    createdAt: now,
  }));
}
