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
  ProspectStatus,
  RealRevenueEntry,
  RecommendedAction,
  ResearchReport,
  Strategy,
  Transaction,
} from '../types';
import { env } from '../config/env';

export interface BackendHealth {
  ok: boolean;
  service: string;
  time: string;
  connectors: {
    db: { backend: string; connected: boolean };
    llm: boolean;
    search: boolean;
    payments: false;
  };
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
export function researchProspectNow(prospectId: string): Promise<{ ok: true; intelligence: ProspectIntelligence }> {
  return postJson('/prospects/research', { prospectId });
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
