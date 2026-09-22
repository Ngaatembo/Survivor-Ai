/* ============================================================================
 * Backend API client — the frontend's ONLY connection to the Cloudflare
 * Worker backend. Mostly read-only: this file intentionally exposes no way
 * to write wallet balance, experiment allocation, or any financial record
 * from the browser (see PHASE 30 / "Never allow frontend to directly
 * control..."). The three narrow exceptions (Phase 3 CRM/offer/project
 * write paths below) touch only their own single table each and never
 * wallet/experiment data — the autonomous loop itself never calls these;
 * they exist so a human can record real-world outcomes from the dashboard.
 *
 * TRIGGER_SECRET is never referenced here and never sent from the browser —
 * the /cycles/run endpoint is not called from the frontend at all. The
 * autonomous loop runs on the Worker's cron; the dashboard only observes it.
 * ========================================================================== */

import type {
  Agent,
  AgentCycle,
  AgentEvent,
  BusinessModel,
  DesignBrief,
  Experiment,
  LearningEvent,
  MarketPriceResearch,
  MemoryEntry,
  Mission,
  Offer,
  Opportunity,
  OpportunityDecision,
  OutreachMessageSet,
  Project,
  ProjectMilestoneKey,
  Prospect,
  ProspectDemo,
  ProspectInteraction,
  ProspectIntelligence,
  UnifiedProspectResearch,
  ProspectStatus,
  RealRevenueEntry,
  RecommendedAction,
  ResearchReport,
  Strategy,
  Transaction,
} from '../types';
import { env } from '../config/env';
import type { MoneyMetrics } from '../lib/moneyMetrics';

export interface TreasuryPolicy {
  currency: string;
  protectedReserve: number;
  autonomousDailyLimit: number;
  autonomousPerTransactionLimit: number;
  approvalPerTransactionLimit: number;
  allowedVendors: string[];
  blockedCategories: string[];
  realMoneyExecutionEnabled: boolean;
  emergencyFrozen: boolean;
}
export interface TreasurySnapshot {
  balance: number;
  ownerCapital: number;
  revenue: number;
  expenses: number;
  refunds: number;
  profit: number;
  protectedReserve: number;
  availableToSpend: number;
  autonomousSpentToday: number;
  autonomousRemainingToday: number;
  policy: TreasuryPolicy;
}
export interface TreasurySpendRequest {
  id: string;
  vendor: string;
  amount: number;
  purpose: string;
  category: string;
  opportunityId?: string;
  expectedRevenue?: number;
  maxLoss?: number;
  evidence?: string;
  decision: 'AUTO' | 'APPROVAL' | 'BLOCKED';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RECORDED';
  createdAt: number;
  reviewedAt?: number;
  note?: string;
}
export interface TreasuryResponse { ok: true; treasury: TreasurySnapshot; spendRequests: TreasurySpendRequest[]; }

export interface BackendHealth {
  ok: boolean;
  ready?: boolean;
  schema?: {
    ready: boolean;
    missingTables: string[];
  };
  service: string;
  time: string;
  runtime?: {
    cronConfigured: boolean;
    cronSchedule: string;
    timezone: string;
    lastCycle: Record<string, unknown> | null;
    lastCycleAgeMinutes: number | null;
    stale: boolean | null;
  };
  connectors: {
    db: { backend: string; connected: boolean };
    llm: boolean;
    search: boolean;
    payments: {
      sandboxConfigured: boolean;
      finivexConfigured?: boolean;
      productionExecutionEnabled: boolean;
    };
  };
}

export interface ActionApproval {
  id: string;
  actionId: string;
  actionKind: RecommendedAction['kind'];
  title: string;
  prospectId?: string;
  opportunityId?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
  note?: string;
  createdAt: number;
  reviewedAt?: number;
}

export interface SurvivalScore {
  score: number;
  status: 'ALIVE' | 'AT_RISK' | 'CRITICAL' | 'DEAD';
  components: { cash: number; revenue: number; pipeline: number; resilience: number };
  runwayTransactions: number;
  explanation: string[];
  calculatedAt: number;
}

export interface BackendState {
  ok: boolean;
  fetchedAt: string;
  agent: Agent;
  opportunities: Opportunity[];
  experiments: Experiment[];
  transactions: Transaction[];
  memory: MemoryEntry[];
  events: AgentEvent[];
  cycles: AgentCycle[];
  reports: ResearchReport[];
  strategies: Strategy[];
  businessModels: BusinessModel[];
  decisions: OpportunityDecision[];
  actions: RecommendedAction[];
  prospects: Prospect[];
  prospectInteractions: ProspectInteraction[];
  outreachMessages: OutreachMessageSet[];
  offers: Offer[];
  designBriefs: DesignBrief[];
  projects: Project[];
  realRevenue: RealRevenueEntry[];
  learningEvents: LearningEvent[];
  prospectIntelligence: ProspectIntelligence[];
  // The worker's /state strips the full html to keep the payload bounded —
  // fetch the actual page at GET /demo/{prospectId} when needed.
  prospectDemos: Omit<ProspectDemo, 'html'>[];
  marketPriceResearch: MarketPriceResearch[];
  missions: Mission[];
  // Economic Survival Overhaul (Phases 6/14/15) — search-cost economics,
  // the revenue funnel and search ROI, computed server-side from the same
  // data above. Optional so an older/un-upgraded worker deployment (before
  // this field existed) still round-trips without a hard type error.
  economicEfficiency?: EconomicEfficiencySnapshot;
  incomeIntelligence?: IncomeChannelOpportunity[];
  survivalScore?: SurvivalScore;
  actionApprovals?: ActionApproval[];
}

export interface IncomeChannelOpportunity {
  id: string;
  channel: string;
  title: string;
  description: string;
  evidence: string;
  sourceUrls: string[];
  discoveredAt: number;
}

export interface EconomicEfficiencySnapshot {
  searchEconomy: {
    searchesToday: number;
    searchesThisMonth: number;
    cacheHitsToday: number;
    cacheMissesToday: number;
    cacheHitRateToday: number;
    byPurposeToday: Record<string, number>;
    byProviderToday: Record<string, number>;
    budgetRemainingToday: Record<string, number>;
    budgetRemainingThisMonth: Record<string, number>;
  };
  revenueFunnel: {
    stages: { stage: string; count: number; conversionFromPrevious: number | null }[];
    totalProspects: number;
    droppedCount: number;
    overallConversionRate: number | null;
    paidCount: number;
    paidRevenueTotal: number;
  };
  conversionByCategory: { category: string; discovered: number; won: number; lost: number; conversionRate: number | null }[];
  conversionByAcquisitionChannel: { channel: string; dealCount: number; totalRevenue: number; totalProfit: number; avgDealValue: number }[];
  dealMetrics: { avgDealSize: number | null; avgTimeToPaymentDays: number | null; dealCount: number };
  moneyMetrics?: MoneyMetrics;
  searchROI: {
    searchesPerProspect: number | null;
    searchesPerQualifiedProspect: number | null;
    searchesPerProposal: number | null;
    searchesPerWin: number | null;
    prospectsPer100Searches: number;
    qualifiedPer100Searches: number;
    proposalsPer100Searches: number;
    revenuePer100Searches: number;
    searchROI: number;
    basis: 'REAL_REVENUE' | 'EXPECTED_VALUE' | 'NO_DATA';
  };
  humanActionQueue: {
    topAction: RecommendedAction | null;
    queue: RecommendedAction[];
    offersAwaitingSend: number;
    followUpsDue: number;
    prospectsNeedingStatusUpdate: number;
    wonWithoutRecordedPayment: number;
  };
  survivalStatus: 'ALIVE' | 'AT_RISK' | 'CRITICAL' | 'DEAD';
}

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

const TIMEOUT_MS = 12_000;

async function getJson<T>(path: string): Promise<T> {
  if (!env.apiBaseUrl) throw new BackendError('VITE_API_BASE_URL is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${env.apiBaseUrl}${path}`, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      // fall through — body stays null, handled below
    }
    if (!res.ok) {
      throw new BackendError(body?.error ?? `Backend returned HTTP ${res.status}`, body);
    }
    if (body && body.ok === false) {
      throw new BackendError(body.error ?? 'Backend reported an error', body);
    }
    return body as T;
  } catch (e) {
    if (e instanceof BackendError) throw e;
    if ((e as Error)?.name === 'AbortError') {
      throw new BackendError(`Backend request timed out after ${TIMEOUT_MS}ms (${path})`, e);
    }
    throw new BackendError(`Could not reach backend at ${env.apiBaseUrl}${path}: ${(e as Error).message}`, e);
  } finally {
    clearTimeout(timer);
  }
}

export function fetchBackendHealth(): Promise<BackendHealth> {
  return getJson<BackendHealth>('/health');
}

export function fetchBackendState(): Promise<BackendState> {
  return getJson<BackendState>('/state');
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  if (!env.apiBaseUrl) throw new BackendError('VITE_API_BASE_URL is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${env.apiBaseUrl}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let responseBody: any = null;
    try {
      responseBody = await res.json();
    } catch {
      // fall through — body stays null, handled below
    }
    if (!res.ok) {
      throw new BackendError(responseBody?.error ?? `Backend returned HTTP ${res.status}`, responseBody);
    }
    if (responseBody && responseBody.ok === false) {
      throw new BackendError(responseBody.error ?? 'Backend reported an error', responseBody);
    }
    return responseBody as T;
  } catch (e) {
    if (e instanceof BackendError) throw e;
    if ((e as Error)?.name === 'AbortError') {
      throw new BackendError(`Backend request timed out after ${TIMEOUT_MS}ms (${path})`, e);
    }
    throw new BackendError(`Could not reach backend at ${env.apiBaseUrl}${path}: ${(e as Error).message}`, e);
  } finally {
    clearTimeout(timer);
  }
}

/** CRM write path (Phase 3): record a real-world status change for a
 *  prospect. This is the only way a prospect ever advances past QUALIFIED —
 *  SURVIVE AI never contacts anyone or observes real replies itself. */
export function updateProspectStatus(
  prospectId: string,
  status: ProspectStatus,
  reasonLost?: string,
): Promise<{ ok: true; prospectId: string; status: ProspectStatus }> {
  return postJson('/prospects/status', { prospectId, status, reasonLost });
}

/** Mark a drafted offer sent/accepted/declined — a human sends it, this app
 *  never does. */
export function updateOfferStatus(
  offerId: string,
  status: Offer['status'],
): Promise<{ ok: true; offerId: string; status: Offer['status'] }> {
  return postJson('/offers/status', { offerId, status });
}

/** Advance a delivery project's milestone. */
export function advanceProjectMilestone(
  projectId: string,
  milestone: ProjectMilestoneKey,
): Promise<{ ok: true; projectId: string; milestone: ProjectMilestoneKey }> {
  return postJson('/projects/milestone', { projectId, milestone });
}

/** Real-money write path (Phase 4): record what actually happened after a
 *  real transaction. Append-only on the backend — this always creates a
 *  new entry, never edits one. Returns the stored entry plus the learning
 *  event it generated. */
export function addRealRevenueEntry(input: {
  opportunityId: string;
  prospectId: string;
  prospectName?: string;
  projectId: string;
  productService: string;
  quotedPrice?: number;
  amountReceived: number;
  costs?: number;
  currency?: string;
  paymentMethod?: RealRevenueEntry['paymentMethod'];
  acquisitionChannel?: string;
  daysFromDiscoveryToPayment?: number;
  notes?: string;
  date?: number;
}): Promise<{ ok: true; entry: RealRevenueEntry; learningEvent: LearningEvent }> {
  return postJson('/real-revenue', input);
}

/** Real-world outcome tracking (Phase 4): satisfaction/repeat/referral on
 *  a delivery project. */
export function updateProjectOutcome(
  projectId: string,
  outcome: { satisfaction?: number; repeatPurchase?: boolean; referral?: boolean },
): Promise<{ ok: true; projectId: string }> {
  return postJson('/projects/outcome', { projectId, ...outcome });
}

/** Phase 6: manually trigger deep research on one specific prospect right
 *  now, rather than waiting for the capped per-cycle automatic pass. */
export function unifiedProspectResearchNow(prospectId: string): Promise<{ ok: true } & UnifiedProspectResearch> {
  return postJson('/prospects/research/full', { prospectId });
}

export function researchProspectNow(prospectId: string): Promise<{ ok: true; prospect?: Prospect; intelligence: ProspectIntelligence }> {
  return postJson('/prospects/research', { prospectId });
}

/** Verify and consolidate a prospect's public identity, contact, website and location evidence now. */
export function verifyProspectNow(prospectId: string): Promise<{ ok: true; prospect: Prospect }> {
  return postJson('/prospects/verify', { prospectId });
}

/** Phase 3 (deepened): regenerate a prospect's real, working demo page —
 *  e.g. after fresh deep research or an updated offer. Requires an
 *  existing offer for this prospect. Returns the metadata plus the
 *  shareable URL; fetch the actual page separately at demoUrl. */
export function regenerateProspectDemo(
  prospectId: string,
): Promise<{ ok: true; demo: Omit<ProspectDemo, 'html'>; demoUrl: string }> {
  return postJson('/prospects/demo', { prospectId });
}

/** The shareable link for a prospect's demo page — the same page GET
 *  /demo/{prospectId} on the backend serves as real HTML, ready to send
 *  to the actual business ("here's what your website could look like"). */
export function demoUrl(prospectId: string): string {
  return `${env.apiBaseUrl}/demo/${prospectId}`;
}


export function fetchTreasury(): Promise<TreasuryResponse> {
  return getJson<TreasuryResponse>('/treasury');
}

export function createTreasurySpendRequest(input: {
  vendor: string; amount: number; purpose: string; category: string;
  opportunityId?: string; expectedRevenue?: number; maxLoss?: number; evidence?: string;
}): Promise<{ ok: true; request: TreasurySpendRequest; treasury: TreasurySnapshot }> {
  return postJson('/treasury/spend-request', input);
}

export function updateTreasuryPolicy(input: Partial<TreasuryPolicy>): Promise<{ ok: true; policy: TreasuryPolicy }> {
  return postJson('/treasury/policy', input);
}

export function approveTreasurySpendRequest(requestId: string, note?: string): Promise<{ ok: true; request: TreasurySpendRequest }> {
  return postJson('/treasury/spend-request/approve', { requestId, note });
}

export function rejectTreasurySpendRequest(requestId: string, note?: string): Promise<{ ok: true; request: TreasurySpendRequest }> {
  return postJson('/treasury/spend-request/reject', { requestId, note });
}

export function recordConfirmedTreasuryExpense(requestId: string): Promise<{ ok: true }> {
  return postJson('/treasury/record-confirmed-expense', { requestId });
}

export function recordTreasuryCapital(input: { amount: number; description?: string }): Promise<{ ok: true; transaction: Transaction; treasury: TreasurySnapshot }> {
  return postJson('/treasury/record-capital', input);
}

export type ContentDraftStatus = 'DRAFT' | 'READY' | 'PUBLISHED' | 'ARCHIVED';

export interface ContentDraft {
  id: string;
  platform: 'WhatsApp' | 'Facebook' | 'LinkedIn' | 'TikTok';
  purpose: 'AWARENESS' | 'PROOF' | 'LEAD' | 'MONETIZATION';
  hook: string;
  body: string;
  cta: string;
  sourceTitle: string;
  sourceUrl?: string;
  sourceId: string;
  createdAt: number;
  status: ContentDraftStatus;
  campaign?: string;
  offer?: string;
  publishedAt?: number;
  metrics: { reach: number; impressions: number; clicks: number; leads: number; revenue: number };
}

export interface ContentEngineState {
  version: 1;
  researchedAt: number | null;
  research: IncomeChannelOpportunity[];
  drafts: ContentDraft[];
  updatedAt?: number;
}

export function fetchActionApprovals(): Promise<{ ok: true; approvals: ActionApproval[] }> {
  return getJson('/actions/approvals');
}

export function requestActionApproval(action: RecommendedAction): Promise<{ ok: true; approval: ActionApproval }> {
  return postJson('/actions/approvals', {
    actionId: action.id,
    actionKind: action.kind,
    title: action.title,
    prospectId: action.prospectId,
    opportunityId: action.opportunityId,
  });
}

export function reviewActionApproval(approvalId: string, decision: 'APPROVED' | 'REJECTED', note?: string): Promise<{ ok: true; approval: ActionApproval }> {
  return postJson('/actions/approvals/review', { approvalId, decision, note });
}

export function markActionExecuted(approvalId: string): Promise<{ ok: true; approval: ActionApproval }> {
  return postJson('/actions/approvals/execute', { approvalId });
}

export function fetchContentState(): Promise<{ ok: true; state: ContentEngineState }> {
  return getJson('/content/state');
}

export function saveContentState(state: Omit<ContentEngineState, 'version' | 'updatedAt'>): Promise<{ ok: true; state: ContentEngineState }> {
  return postJson('/content/state', state);
}

export function researchIncomeChannels(channel?: string): Promise<{ ok: true; opportunities: IncomeChannelOpportunity[]; researchedAt: string }> {
  return postJson('/income/research', channel ? { channel } : {});
}

export interface IncomeStrategyResponse {
  ok: true;
  generatedAt: string;
  strategies: Array<{
    kind: string; name: string; category: string; lifecycle: string; marketId: string;
    customer: string; problemToSolve: string; delivery: string; requiredHumanAction: string;
    risk: string; testCost: string; nextExperiment: string; searchResultCount: number;
    decision: { lifecycle: string; realRevenue: number; realSales: number; reasons: string[]; nextExperiment: string };
  }>;
  evidence: Array<{ channel: string; title: string; description: string; sourceUrls: string[] }>;
  channelPlans: Array<{ kind: string; decision: { lifecycle: string; realRevenue: number; realSales: number; reasons: string[]; nextExperiment: string }; plan: { objective: string; steps: string[]; humanActions: string[]; evidenceToCollect: string[]; successMetrics: string[]; stopConditions: string[]; currentEvidence: { realSales: number; realRevenue: number; dataQuality: string } } }>;
  forex: {
    target: string; status: 'FOUND'|'PARTIAL'|'NOT_FOUND';
    findings: Array<{ query:string; title:string; snippet:string; sourceUrl:string; sourceType:string }>;
    verificationNotes: string[]; nextStep: string;
  };
  guardrails: { autonomousTrading:boolean; autonomousPublishing:boolean; autonomousOutreach:boolean; autonomousPayments:boolean; academicDishonesty:boolean };
}

export function fetchIncomeStrategy(channel?: string): Promise<IncomeStrategyResponse> {
  return postJson('/income/strategy', channel ? { channel } : {});
}


export interface PaymentRequest {
  id: string;
  client_name: string;
  amount: number;
  currency: 'USD' | 'ZWG';
  description: string;
  payment_method: 'FINIVEX' | 'ECOCASH' | 'BANK' | 'CASH' | 'OTHER';
  prospect_id?: string | null;
  project_id?: string | null;
  opportunity_id?: string | null;
  status: 'PENDING' | 'APPROVED' | 'LINK_CREATED' | 'PAID' | 'CANCELLED' | 'FAILED';
  finivex_reference?: string | null;
  payment_link?: string | null;
  created_at: string;
  approved_at?: string | null;
  paid_at?: string | null;
  updated_at: string;
}

export function fetchPaymentRequests(): Promise<{ ok: true; requests: PaymentRequest[] }> {
  return getJson('/payments/requests');
}

export function createPaymentRequest(input: {
  clientName: string;
  amount: number;
  currency: 'USD' | 'ZWG';
  description: string;
  paymentMethod: PaymentRequest['payment_method'];
  prospectId?: string;
  projectId?: string;
  opportunityId?: string;
}): Promise<{ ok: true; request: PaymentRequest }> {
  return postJson('/payments/requests', input);
}

export function approvePaymentRequest(requestId: string): Promise<{ ok: true; request: PaymentRequest }> {
  return postJson('/payments/requests/approve', { requestId });
}

export function cancelPaymentRequest(requestId: string): Promise<{ ok: true }> {
  return postJson('/payments/requests/cancel', { requestId });
}

export function createApprovedFinivexLink(input: {
  requestId: string;
  customerEmail?: string;
  customerPhone?: string;
  expiresInMinutes?: number;
}): Promise<{ ok: true; requestId: string; paymentLink: string; reference?: string | null; provider?: unknown }> {
  return postJson('/payments/finivex/create-approved-link', input);
}

export function markPaymentRequestPaid(requestId: string): Promise<{ ok: true }> {
  return postJson('/payments/requests/mark-paid', { requestId });
}

export interface FinivexPaymentLinkResponse {
  ok: boolean;
  transactionId: string;
  paymentLink: string | null;
  provider?: unknown;
}

export function fetchFinivexStatus(): Promise<{ ok: true; payment: { provider: 'FINIVEX'; configured: boolean; canCreatePaymentLinks: boolean; canCheckStatus: boolean; note: string } }> {
  return getJson('/payments/finivex/status');
}


export interface WindsorIncomeSummary {
  configured: boolean;
  generatedAt: string;
  datePreset: string;
  data: {
    searchConsole: Record<string, unknown>[];
    analytics: Record<string, unknown>[];
    facebook: Record<string, unknown>[];
    instagram: Record<string, unknown>[];
    tiktok: Record<string, unknown>[];
    youtube: Record<string, unknown>[];
    linkedin: Record<string, unknown>[];
  };
  errors: Record<string, string>;
}

export function fetchWindsorIncomeSummary(): Promise<{ ok: true } & WindsorIncomeSummary> {
  return getJson('/integrations/windsor/summary');
}
