/* ============================================================================
 * EngineRepository — persistence port.
 * The headless engine talks only to this interface. Implementations:
 *   - StoreRepository  : bridges to the Zustand browser store (localStorage)
 *   - InMemoryRepository: tests / worker dev
 *   - SupabaseRepository: Postgres via supabase-js (worker + optional browser)
 * All methods are async; the browser bridge resolves immediately.
 * ========================================================================== */

import type {
  Agent,
  AgentCycle,
  AgentEvent,
  CycleStepKey,
  Experiment,
  MemoryEntry,
  Opportunity,
  ResearchReport,
  Strategy,
  Transaction,
} from '../types';

export interface EngineRepository {
  // agent
  getAgent(): Promise<Agent>;
  updateAgent(patch: Partial<Agent>): Promise<Agent>;

  // opportunities
  listOpportunities(): Promise<Opportunity[]>;
  listResearchedOpportunities(): Promise<Opportunity[]>; // stage != UNDISCOVERED
  upsertOpportunities(opps: Opportunity[]): Promise<void>;

  // transactions (append-only)
  listTransactions(): Promise<Transaction[]>;
  appendTransaction(tx: Transaction): Promise<void>;

  // experiments
  listExperiments(): Promise<Experiment[]>;
  appendExperiment(exp: Experiment): Promise<void>;

  // memory
  listMemory(): Promise<MemoryEntry[]>;
  upsertMemory(mem: MemoryEntry): Promise<void>;

  // reports
  listReports(): Promise<ResearchReport[]>;
  appendReport(report: ResearchReport): Promise<void>;

  // strategies
  listStrategies(): Promise<Strategy[]>;
  appendStrategy(strategy: Strategy): Promise<void>;
  deactivateStrategies(): Promise<void>;

  // events (append-only)
  listEvents(): Promise<AgentEvent[]>;
  appendEvent(event: AgentEvent): Promise<void>;

  // cycles
  listCycles(): Promise<AgentCycle[]>;
  appendCycle(cycle: AgentCycle): Promise<void>;
  updateCycleStep(cycleId: string, step: CycleStepKey, status: 'active' | 'done' | 'skipped', at?: number): Promise<void>;
  completeCycle(cycleId: string, patch: Partial<AgentCycle>): Promise<void>;

  // hard reset (used by browser "RESET"; worker does not expose this)
  reset?(opts?: { seed: boolean }): Promise<void>;
}

/** Engine callbacks so the host can render progress / stay in sync. */
export interface EngineHooks {
  log: (type: AgentEvent['type'], message: string) => void | Promise<void>;
  setStatus?: (status: Agent['status']) => void | Promise<void>;
  setActivity?: (activity: string, step: CycleStepKey | null) => void | Promise<void>;
}
