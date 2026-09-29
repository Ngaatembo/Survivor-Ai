/* ============================================================================
 * Sales settings defaults + stage transition rules.
 * ========================================================================== */

import { BUSINESS } from '../config/business';
import {
  LOST_REASONS,
  type CadenceSettings,
  type CompanyProfile,
  type LostReason,
  type QualificationResult,
  type SalesSettings,
  type SalesStage,
} from './types';

export function defaultCompany(): CompanyProfile {
  return {
    senderName: BUSINESS.senderName,
    company: BUSINESS.company,
    companyLine: BUSINESS.companyLine,
    website: BUSINESS.website,
    phone: BUSINESS.phone,
    proofSites: [...BUSINESS.proofSites],
    services: [
      'Business websites',
      'Digital business systems',
      'Admin dashboards',
      'Booking systems',
      'Ordering systems',
      'Business automation',
      'Website maintenance',
      'Custom digital solutions',
    ],
    homeTown: 'Marondera',
    valueLine: 'We help Zimbabwean businesses improve how customers find them online through websites and digital business systems.',
    paymentTerms: '50% to start, 50% when you are happy with the result',
  };
}

export function defaultCadence(): CadenceSettings {
  return { followUp1Days: 2, followUp2Days: 4, dormantAfterDays: 4, proposalChaseDays: 3, demoFeedbackDays: 2 };
}

export function defaultSettings(): SalesSettings {
  return { company: defaultCompany(), cadence: defaultCadence() };
}

export function mergeSettings(stored: Partial<SalesSettings> | undefined): SalesSettings {
  const d = defaultSettings();
  if (!stored) return d;
  const company = { ...d.company, ...(stored.company ?? {}) };
  if (!Array.isArray(company.services)) company.services = d.company.services;
  if (!Array.isArray(company.proofSites)) company.proofSites = d.company.proofSites;
  const cadence = { ...d.cadence, ...(stored.cadence ?? {}) };
  for (const k of Object.keys(d.cadence) as (keyof CadenceSettings)[]) {
    const n = Number(cadence[k]);
    cadence[k] = Number.isFinite(n) && n >= 0 && n <= 90 ? Math.round(n) : d.cadence[k];
  }
  return { company, cadence };
}

/* ------------------------------ stage transitions ------------------------------ */

const NEXT: Record<SalesStage, SalesStage[]> = {
  DISCOVERED: ['QUALIFIED', 'NOT_A_FIT'],
  QUALIFIED: ['RESEARCHED', 'READY_TO_CONTACT', 'DISCOVERED', 'NOT_A_FIT', 'LOST'],
  RESEARCHED: ['READY_TO_CONTACT', 'QUALIFIED', 'NOT_A_FIT', 'LOST'],
  READY_TO_CONTACT: ['CONTACTED', 'RESEARCHED', 'NOT_A_FIT', 'LOST'],
  CONTACTED: ['FOLLOW_UP_1', 'REPLIED', 'DORMANT', 'NOT_A_FIT', 'LOST'],
  FOLLOW_UP_1: ['FOLLOW_UP_2', 'REPLIED', 'DORMANT', 'NOT_A_FIT', 'LOST'],
  FOLLOW_UP_2: ['REPLIED', 'DORMANT', 'NOT_A_FIT', 'LOST'],
  REPLIED: ['INTERESTED', 'MEETING', 'DORMANT', 'NOT_A_FIT', 'LOST'],
  INTERESTED: ['MEETING', 'PROPOSAL', 'WON', 'DORMANT', 'NOT_A_FIT', 'LOST'],
  MEETING: ['PROPOSAL', 'INTERESTED', 'WON', 'DORMANT', 'NOT_A_FIT', 'LOST'],
  PROPOSAL: ['NEGOTIATION', 'WON', 'MEETING', 'DORMANT', 'NOT_A_FIT', 'LOST'],
  NEGOTIATION: ['WON', 'PROPOSAL', 'MEETING', 'DORMANT', 'LOST'],
  WON: [],
  LOST: ['QUALIFIED'],
  NOT_A_FIT: ['QUALIFIED'],
  DORMANT: ['REPLIED', 'READY_TO_CONTACT', 'INTERESTED', 'NOT_A_FIT', 'LOST'],
};

export function allowedNextStages(from: SalesStage): SalesStage[] {
  return NEXT[from];
}

export interface TransitionInput {
  from: SalesStage;
  to: SalesStage;
  hasChannel: boolean;
  qualification?: QualificationResult;
  lostReason?: string;
  /** Operator override for the evidence gates (never for the stage map). */
  force?: boolean;
}

export function checkTransition(t: TransitionInput): { ok: true } | { ok: false; error: string } {
  if (t.from === t.to) return { ok: true };
  if (!NEXT[t.from].includes(t.to)) {
    return { ok: false, error: `Cannot move a lead from ${t.from} to ${t.to}. Allowed next stages: ${NEXT[t.from].join(', ') || 'none'}.` };
  }
  if (t.to === 'QUALIFIED' && t.from === 'DISCOVERED' && !t.force && t.qualification && !t.qualification.qualified) {
    return { ok: false, error: `Not qualified yet: ${t.qualification.blockers.join(' ')}` };
  }
  if ((t.to === 'READY_TO_CONTACT' || t.to === 'CONTACTED') && !t.hasChannel && !t.force) {
    return { ok: false, error: 'NO_DIRECT_CHANNEL: no reliable contact channel is on record. Find decision-maker/contact information manually and add it to the lead first.' };
  }
  if (t.to === 'LOST' && !(LOST_REASONS as readonly string[]).includes(t.lostReason ?? '')) {
    return { ok: false, error: `A lost reason is required: ${LOST_REASONS.join(', ')}.` };
  }
  return { ok: true };
}

export function isLostReason(s: unknown): s is LostReason {
  return typeof s === 'string' && (LOST_REASONS as readonly string[]).includes(s);
}

/** What should be scheduled when a lead enters a stage. */
export interface StageEffect {
  followUp?: { inDays: number; kind: string; note: string };
  clearFollowUps?: boolean;
}

export function stageEffect(to: SalesStage, cadence: CadenceSettings): StageEffect {
  switch (to) {
    case 'CONTACTED':
      return { followUp: { inDays: cadence.followUp1Days, kind: 'FOLLOW_UP_1', note: 'Send follow-up 1 if there is no reply.' } };
    case 'FOLLOW_UP_1':
      return { followUp: { inDays: cadence.followUp2Days, kind: 'FOLLOW_UP_2', note: 'Send the short final follow-up if there is still no reply.' } };
    case 'FOLLOW_UP_2':
      return { followUp: { inDays: cadence.dormantAfterDays, kind: 'DORMANCY_REVIEW', note: 'No reply after the final follow-up: move to DORMANT.' } };
    case 'REPLIED':
      return { followUp: { inDays: 1, kind: 'REPLY', note: 'Reply and ask the most relevant discovery questions.' } };
    case 'INTERESTED':
      return { followUp: { inDays: 2, kind: 'NEXT_STEP', note: 'Agree the next step (demo, meeting or proposal).' } };
    case 'PROPOSAL':
      return { followUp: { inDays: cadence.proposalChaseDays, kind: 'PROPOSAL_CHASE', note: 'Chase the proposal — ask what questions they have.' } };
    case 'WON':
    case 'LOST':
    case 'NOT_A_FIT':
    case 'DORMANT':
      return { clearFollowUps: true };
    default:
      return {};
  }
}
