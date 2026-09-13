/* ============================================================================
 * Backend API client — the frontend's ONLY connection to the Cloudflare
 * Worker backend. Read-only: this file intentionally exposes no way to
 * write wallet balance, experiment allocation, or any financial record from
 * the browser (see PHASE 30 / "Never allow frontend to directly control...").
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
  Experiment,
  MemoryEntry,
  Opportunity,
  OpportunityDecision,
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
