/* ============================================================================
 * Sales API client — thin typed wrappers over the operator-only /sales/* routes.
 * Nothing here sends a message to anyone; the salesperson does that themselves.
 * ========================================================================== */

import { salesGet, salesPost } from './backendApi';
import type { PipelineCounts, SalesToday } from '../sales/actions';
import type { SalesAnalytics } from '../sales/analytics';
import type { CallPrep, CallStep, GeneratedFollowUp, PlanStep } from '../sales/messages';
import type {
  FollowUpRow,
  MeetingRow,
  OfferType,
  PricingKey,
  PricingSettings,
  ProposalRow,
  SalesActivity,
  SalesAngle,
  SalesBrief,
  SalesChannel,
  SalesMessage,
  SalesNote,
  SalesSettings,
  SalesStage,
} from '../sales/types';

export interface LeadSummary {
  prospectId: string;
  businessName: string;
  category: string;
  location: string;
  score: number;
  priority: string;
  verification: string;
  stage: SalesStage;
  stageEnteredAt: number;
  paused: boolean;
  contactPerson?: string;
  angle?: SalesAngle;
  channel?: SalesChannel;
  channelStatus?: 'RECOMMENDED' | 'NO_DIRECT_CHANNEL';
  offerType?: OfferType;
  demoStatus: string;
  lastContactAt?: number;
  nextAction?: string;
  nextActionAt?: number;
  hasBrief: boolean;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  opportunity?: string;
  lostReason?: string;
  wonValue?: number;
}

export interface PipelineResponse { ok: true; leads: LeadSummary[]; counts: PipelineCounts; today: SalesToday; generatedAt: number }

export interface LeadProfile {
  ok: true;
  lead: LeadSummary;
  contact: {
    contactPerson: string | null; phone: string | null; whatsapp: string | null; email: string | null;
    recordedContact: string | null; socialLinks: string[]; website: string | null;
    whatsappNumber: string | null; callNumber: string | null;
  };
  prospect: {
    id: string; businessName: string; category: string; location: string; websitePresence: string; score: number;
    scoreFactors: string[]; priority: string; evidenceNotes: string;
    verification: { status: string; confidence: number; independentSources: number } | null;
    sources: { title: string; url?: string }[];
  };
  state: {
    stage: SalesStage; allowedNext: SalesStage[]; paused: boolean; lostReason: string | null; lostNotes: string | null;
    wonValue: number | null; lastContactAt: number | null; demoStatus: string; demoBuilt: boolean;
    existingOffer: { status: string; price: number } | null; researchedAt: number | null;
  };
  brief: SalesBrief;
  messages: SalesMessage[];
  followUps: FollowUpRow[];
  meetings: MeetingRow[];
  proposals: ProposalRow[];
  notes: SalesNote[];
  activities: SalesActivity[];
  history: { from: string | null; to: string; note: string | null; at: number }[];
  discoveryQuestions: { text: string; why: string }[];
  callPrep: CallPrep;
  callGuide: CallStep[];
  actionPlan: PlanStep[];
  followUpSituations: { key: string; label: string }[];
  pricing: PricingSettings;
}

export interface SettingsResponse {
  ok: true;
  settings: SalesSettings;
  pricing: PricingSettings;
  pricingLabels: Record<PricingKey, string>;
  pricingHelp: Record<PricingKey, string>;
}

const post = <T>(path: string, body: unknown) => salesPost<T>(path, body);
const qs = (prospectId: string) => `?prospectId=${encodeURIComponent(prospectId)}`;

export const getPipeline = () => salesGet<PipelineResponse>('/sales/pipeline');
export const getAnalytics = () => salesGet<{ ok: true; analytics: SalesAnalytics }>('/sales/analytics');
export const getSalesSettings = () => salesGet<SettingsResponse>('/sales/settings');
export const getLeadProfile = (prospectId: string) => salesGet<LeadProfile>(`/sales/lead${qs(prospectId)}`);

export const saveSalesSettings = (patch: { company?: Partial<SalesSettings['company']>; cadence?: Partial<SalesSettings['cadence']>; pricing?: Partial<Record<PricingKey, number | null | ''>> }) =>
  post<SettingsResponse>('/sales/settings', patch);

export const runResearch = (prospectId: string) => post<{ ok: true; brief: SalesBrief; notes: string[] }>('/sales/research', { prospectId });
export const generateMessages = (prospectId: string) =>
  post<{ ok: true; messages: SalesMessage[]; warnings: Record<string, string[]> }>('/sales/message/generate', { prospectId });
export const selectMessage = (messageId: string, editedBody?: string) =>
  post<{ ok: true; warnings: string[]; stageNote?: string }>('/sales/message/select', { messageId, editedBody });
export const generateFollowUpMessage = (prospectId: string, situation: string) =>
  post<{ ok: true; followUp: GeneratedFollowUp; message: SalesMessage }>('/sales/follow-up/generate', { prospectId, situation });
export const scheduleFollowUp = (prospectId: string, args: { inDays?: number; dueAt?: string; note?: string }) =>
  post<{ ok: true; dueAt: number }>('/sales/follow-up/schedule', { prospectId, ...args });
export const finishFollowUp = (id: string, status: 'DONE' | 'SKIPPED') => post<{ ok: true }>('/sales/follow-up/done', { id, status });

export const changeStage = (prospectId: string, stage: SalesStage, extra: { note?: string; messageId?: string; force?: boolean } = {}) =>
  post<{ ok: true; lead: LeadSummary }>('/sales/stage', { prospectId, stage, ...extra });
export const markWon = (prospectId: string, value?: number, note?: string) => post<{ ok: true }>('/sales/won', { prospectId, value, note });
export const markLost = (prospectId: string, reason: string, notes?: string) => post<{ ok: true }>('/sales/lost', { prospectId, reason, notes });
export const disqualifyLead = (prospectId: string, note?: string) => post<{ ok: true }>('/sales/disqualify', { prospectId, note });
export const pauseLead = (prospectId: string, paused: boolean) => post<{ ok: true }>('/sales/pause', { prospectId, paused });

export const updateLead = (prospectId: string, patch: { contactPerson?: string; phone?: string; whatsapp?: string; email?: string; demoStatus?: 'SENT' }) =>
  post<{ ok: true }>('/sales/lead/update', { prospectId, ...patch });
export const logActivity = (prospectId: string, kind: 'NOTE' | 'CALL' | 'REPLY_RECEIVED', summary: string) =>
  post<{ ok: true }>('/sales/activity', { prospectId, kind, summary });

export const bookMeeting = (prospectId: string, scheduledAt: string, kind: 'CALL' | 'VIDEO' | 'VISIT', notes?: string) =>
  post<{ ok: true; stageNote?: string }>('/sales/meeting', { prospectId, scheduledAt, kind, notes });
export const updateMeeting = (id: string, status: 'DONE' | 'CANCELLED') => post<{ ok: true }>('/sales/meeting/update', { id, status });

export const createProposal = (prospectId: string, offerType?: OfferType, extraScope?: string[]) =>
  post<{ ok: true; proposal: ProposalRow }>('/sales/proposal', { prospectId, offerType, extraScope });
export const setProposalStatus = (id: string, status: ProposalRow['status'], extra: { body?: string; acknowledgeManualPrice?: boolean } = {}) =>
  post<{ ok: true; stageNote?: string; hint?: string }>('/sales/proposal/status', { id, status, ...extra });
