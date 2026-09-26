/* ============================================================================
 * SURVIVE AI — durable real-world Survival Challenge state machine.
 *
 * This layer turns a recommended economic action into a controlled experiment
 * lifecycle. It does NOT send messages, spend money, place trades, submit work,
 * or manufacture revenue. Human approval is required before execution, and
 * actual revenue remains exclusively in the real-revenue ledger.
 * ========================================================================== */

export type ChallengePhase =
  | 'AWAITING_APPROVAL'
  | 'READY_FOR_HUMAN_EXECUTION'
  | 'AWAITING_RESULT'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type ChallengeResult = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'INCONCLUSIVE';

export interface SurvivalChallenge {
  id: string;
  actionId: string;
  actionKind: string;
  opportunityId?: string;
  opportunityName?: string;
  prospectId?: string;
  prospectName?: string;
  phase: ChallengePhase;
  objective: string;
  action: string;
  guardrails: string[];
  startedAt: number;
  approvedAt?: number;
  result?: ChallengeResult;
  resultNote?: string;
  completedAt?: number;
}

export interface ChallengeInput {
  actionId: string;
  actionKind: string;
  opportunityId?: string;
  opportunityName?: string;
  prospectId?: string;
  prospectName?: string;
  objective: string;
  action: string;
  guardrails?: string[];
  now?: number;
}

export const SURVIVAL_CHALLENGE_KEY = 'survival:challenge';

export function createChallenge(input: ChallengeInput, id: string): SurvivalChallenge {
  if (!input.actionId) throw new Error('actionId is required');
  if (!input.actionKind) throw new Error('actionKind is required');
  if (!input.objective) throw new Error('objective is required');
  if (!input.action) throw new Error('action is required');

  return {
    id,
    actionId: input.actionId,
    actionKind: input.actionKind,
    opportunityId: input.opportunityId,
    opportunityName: input.opportunityName,
    prospectId: input.prospectId,
    prospectName: input.prospectName,
    phase: 'AWAITING_APPROVAL',
    objective: input.objective,
    action: input.action,
    guardrails: input.guardrails ?? [
      'Do not spend or transfer money without a separate human-approved payment path.',
      'Do not send outreach or submit applications automatically.',
      'Do not execute real-money trading.',
      'Record actual money only through the authenticated real-revenue ledger.',
    ],
    startedAt: input.now ?? Date.now(),
  };
}

export function approveChallenge(challenge: SurvivalChallenge, now = Date.now()): SurvivalChallenge {
  if (challenge.phase !== 'AWAITING_APPROVAL') {
    throw new Error(`challenge cannot be approved from phase ${challenge.phase}`);
  }
  return { ...challenge, phase: 'READY_FOR_HUMAN_EXECUTION', approvedAt: now };
}

export function beginResultWait(challenge: SurvivalChallenge): SurvivalChallenge {
  if (challenge.phase !== 'READY_FOR_HUMAN_EXECUTION') {
    throw new Error(`challenge cannot enter result-wait from phase ${challenge.phase}`);
  }
  return { ...challenge, phase: 'AWAITING_RESULT' };
}

export function recordChallengeResult(
  challenge: SurvivalChallenge,
  result: ChallengeResult,
  note: string,
  now = Date.now(),
): SurvivalChallenge {
  if (challenge.phase !== 'AWAITING_RESULT') {
    throw new Error(`challenge cannot record a result from phase ${challenge.phase}`);
  }
  if (!note.trim()) throw new Error('result note is required');
  return {
    ...challenge,
    phase: result === 'FAILED' ? 'FAILED' : 'COMPLETED',
    result,
    resultNote: note.trim(),
    completedAt: now,
  };
}

export function cancelChallenge(challenge: SurvivalChallenge, reason: string, now = Date.now()): SurvivalChallenge {
  if (challenge.phase === 'COMPLETED' || challenge.phase === 'FAILED' || challenge.phase === 'CANCELLED') {
    throw new Error(`challenge cannot be cancelled from phase ${challenge.phase}`);
  }
  if (!reason.trim()) throw new Error('cancellation reason is required');
  return {
    ...challenge,
    phase: 'CANCELLED',
    result: 'INCONCLUSIVE',
    resultNote: reason.trim(),
    completedAt: now,
  };
}

export function parseChallenge(raw: string | null): SurvivalChallenge | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SurvivalChallenge>;
    const phases = new Set<ChallengePhase>(['AWAITING_APPROVAL', 'READY_FOR_HUMAN_EXECUTION', 'AWAITING_RESULT', 'COMPLETED', 'FAILED', 'CANCELLED']);
    if (!value || typeof value.id !== 'string' || typeof value.actionId !== 'string' || typeof value.actionKind !== 'string' || typeof value.objective !== 'string' || typeof value.action !== 'string' || !phases.has(value.phase as ChallengePhase) || !Array.isArray(value.guardrails) || typeof value.startedAt !== 'number') return null;
    return value as SurvivalChallenge;
  } catch {
    return null;
  }
}
