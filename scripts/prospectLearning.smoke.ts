import { computeProblemOutcomeStats, problemLearningAdjustment } from '../src/lib/prospectLearning';
import type { Prospect, ProspectIntelligence } from '../src/types';

const now = Date.now();
const base = (id: string, status: Prospect['status']): Prospect => ({
  id, opportunityId: 'opp', opportunityName: 'Websites', businessName: id, category: 'Local', location: 'Harare',
  websitePresence: 'NONE_FOUND', socialLinks: [], contactChannel: 'WHATSAPP', contactValue: '+263771111111',
  sources: [], evidenceNotes: '', priority: 'HIGH', score: {} as Prospect['score'], status, dataSource: 'LIVE',
  dateDiscovered: now, messagesSentCount: 1, responsesReceivedCount: status === 'REPLIED' ? 1 : 0,
  actualRevenue: status === 'WON' ? 100 : 0, notes: [], createdAt: now, updatedAt: now,
});
const intel = (id: string, type: 'ORDERING' | 'TRUST'): ProspectIntelligence => ({
  id: 'intel-' + id, prospectId: id, businessOverview: '', apparentServices: [], socialPresenceSummary: '',
  competitiveNote: '', specificProblemEvidence: '', recommendedAngle: '', confidence: 'HIGH', generator: 'llm',
  sources: [], generatedAt: now, updatedAt: now,
  primaryProblem: {
    type, evidence: 'Evidence', businessFriction: 'Friction', likelyConsequence: 'Consequence',
    solvableOpportunity: 'Opportunity', outreachClaim: 'Claim', confidence: 'HIGH', sourceIds: ['src-1'],
  },
});

const prospects = [
  base('p1','WON'), base('p2','WON'), base('p3','WON'),
  base('p4','LOST'), base('p5','LOST'), base('p6','LOST'),
  base('p7','LOST'),
];
const intelligence = [
  intel('p1','ORDERING'), intel('p2','ORDERING'), intel('p3','ORDERING'),
  intel('p4','ORDERING'), intel('p5','TRUST'), intel('p6','TRUST'), intel('p7','TRUST'),
];

const stats = computeProblemOutcomeStats(prospects, intelligence);
const ordering = stats.find((s) => s.type === 'ORDERING')!;
const trust = stats.find((s) => s.type === 'TRUST')!;

console.log('--- prospect outcome learning ---');
console.log('ORDERING:', ordering);
console.log('TRUST:', trust);
if (ordering.decided !== 4 || ordering.won !== 3 || Math.round((ordering.closeRate ?? 0) * 100) !== 75) throw new Error('ORDERING stats incorrect');
if (trust.decided !== 3 || trust.won !== 0) throw new Error('TRUST stats incorrect');
if (problemLearningAdjustment('ORDERING', stats).bonus <= 0) throw new Error('positive learning adjustment missing');
if (problemLearningAdjustment('TRUST', stats).bonus >= 0) throw new Error('negative learning adjustment missing');
if (problemLearningAdjustment('BOOKING', stats).bonus !== 0) throw new Error('unseen problem type should not be adjusted');
console.log('All checks passed.');
