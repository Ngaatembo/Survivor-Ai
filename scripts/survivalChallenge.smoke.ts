import {
  approveChallenge,
  beginResultWait,
  cancelChallenge,
  createChallenge,
  recordChallengeResult,
} from '../src/lib/survivalChallenge';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const challenge = createChallenge({
  actionId: 'act_1',
  actionKind: 'CONTACT_PROSPECT',
  opportunityId: 'opp_1',
  opportunityName: 'Local business website service',
  prospectId: 'prospect_1',
  prospectName: 'Example Business',
  objective: 'Test whether a qualified prospect will engage with the offer.',
  action: 'Human reviews and sends the prepared outreach message.',
}, 'challenge_1');

assert(challenge.phase === 'AWAITING_APPROVAL', 'new challenge must await approval');
assert(challenge.guardrails.length >= 4, 'challenge must carry safety guardrails');

const approved = approveChallenge(challenge, 2);
assert(approved.phase === 'READY_FOR_HUMAN_EXECUTION', 'approval must not auto-execute');

const waiting = beginResultWait(approved);
assert(waiting.phase === 'AWAITING_RESULT', 'execution must move to result wait');

const success = recordChallengeResult(waiting, 'SUCCESS', 'Prospect replied and requested a proposal.', 3);
assert(success.phase === 'COMPLETED', 'success must complete the challenge');

const failed = recordChallengeResult(waiting, 'FAILED', 'No response after the agreed test window.', 4);
assert(failed.phase === 'FAILED', 'failure must preserve a failed outcome');

const cancelled = cancelChallenge(challenge, 'Operator stopped the test.', 5);
assert(cancelled.phase === 'CANCELLED', 'cancel must be terminal');

console.log('survivalChallenge smoke: PASS');
