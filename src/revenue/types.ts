/* ============================================================================
 * Revenue loop — the generic economic vocabulary.
 * ----------------------------------------------------------------------------
 *   $ → opportunity → hypothesis → action → prospect → offer → payment
 *     → verification → revenue → treasury → survival
 *
 * Nothing here knows about websites. A Strategy turns what Survivor already
 * knows (free, stored data — no paid calls) into Opportunities, and says what
 * the next real-world action for one is. Survivor scores and selects; a human
 * performs every real-world action (REQUIRES_HUMAN_ACTION).
 * ========================================================================== */

export type OpportunityStatus =
  | 'DISCOVERED' | 'QUALIFIED' | 'SELECTED' | 'TESTING' | 'ACTIVE' | 'WON' | 'LOST' | 'ABANDONED';

export const OPEN_OPPORTUNITY: OpportunityStatus[] = ['DISCOVERED', 'QUALIFIED', 'SELECTED', 'TESTING', 'ACTIVE'];

export type ActionKind = 'CONTACT_PROSPECT' | 'FOLLOW_UP' | 'REQUEST_PAYMENT';
export type ActionStatus = 'WAITING_FOR_OPERATOR' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'RESOLVED';
export type ActionResult = 'NO_RESPONSE' | 'INTERESTED' | 'PRICE_REJECTED' | 'NEGOTIATING' | 'TRIAL' | 'PAID' | 'LOST';
export const ACTION_RESULTS: ActionResult[] = ['NO_RESPONSE', 'INTERESTED', 'PRICE_REJECTED', 'NEGOTIATING', 'TRIAL', 'PAID', 'LOST'];

export interface Opportunity {
  id: string;
  runId: string | null;
  strategyId: string;
  sourceRef: string;
  title: string;
  targetCustomer: string;
  problem: string;
  offer: string;
  hypothesis: string;
  successCriterion: string;
  estimatedValue: number;
  estimatedCost: number;
  priorProbability: number;
  probability: number;
  score: number;
  scoreExplanation: string;
  evidence: Record<string, unknown>;
  status: OpportunityStatus;
  statusReason: string | null;
  revenueEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SurvivorAction {
  id: string;
  opportunityId: string;
  kind: ActionKind;
  title: string;
  why: string;
  instructions: string;
  payload: Record<string, unknown>;
  requiresHuman: true;
  expectedValue: number;
  predictedProbability: number;
  predictedOutcome: string;
  cost: number;
  status: ActionStatus;
  result: ActionResult | null;
  resultNote: string | null;
  paymentReference: string | null;
  createdAt: string;
  decidedAt: string | null;
  completedAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
}

/** What a strategy proposes. Survivor fills in id/score/status. */
export interface OpportunityCandidate {
  sourceRef: string;
  title: string;
  targetCustomer: string;
  problem: string;
  offer: string;
  hypothesis: string;
  successCriterion: string;
  estimatedValue: number;
  estimatedCost: number;
  priorProbability: number;
  evidence: Record<string, unknown>;
  /** null = qualified; otherwise why it cannot be pursued right now. */
  disqualifiedBecause: string | null;
}

export interface ActionProposal {
  kind: ActionKind;
  title: string;
  why: string;
  instructions: string;
  payload: Record<string, unknown>;
  predictedOutcome: string;
  /** Probability THIS action produces a positive response (not payment). */
  predictedProbability: number;
  cost: number;
}

/**
 * A way to make money. Implementations must be free to run: they read data
 * Survivor already has and never call a paid provider or contact anyone.
 */
export interface Strategy<TSource = unknown> {
  id: string;
  name: string;
  customer: string;
  problem: string;
  offer: string;
  costModel: string;
  successCriterion: string;
  /** Turn stored data into candidates. */
  candidates(sources: TSource[]): OpportunityCandidate[];
  /** The next human action for an opportunity, given what happened last. */
  nextAction(opp: Opportunity, source: TSource | undefined, last: SurvivorAction | null): ActionProposal | null;
}
