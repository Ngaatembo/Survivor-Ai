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
  BusinessModel,
  CycleStepKey,
  Experiment,
  MemoryEntry,
  Opportunity,
  OpportunityDecision,
  RecommendedAction,
  ResearchReport,
  Strategy,
  Transaction,
} from '../types';

export interface EngineRepository {
  // agent
  getAgent(): Promise<Agent>;
  /**
   * Create the agent row if (and only if) it does not already exist.
   * MUST be idempotent — safe to call on every boot. This is the only
   * method that may create the row; updateAgent() assumes it already
   * exists and must never be relied on to seed a brand-new agent (a
   * plain UPDATE against a missing row silently affects 0 rows on D1,
   * and errors on Supabase — either way nothing gets persisted).
   */
  createAgentIfMissing(agent: Agent): Promise<Agent>;
  updateAgent(patch: Partial<Agent>): Promise<Agent>;
  /**
   * Atomically claim the right to run a cycle: flips status to
   * RESEARCHING only if no cycle is currently in flight (or the
   * previous claim is stale), so overlapping cron ticks / manual
   * triggers can never run concurrently and double-spend. Returns
   * false if another cycle currently holds the lock.
   */
  tryClaimCycle(staleAfterMs?: number): Promise<boolean>;
  /** Release the cycle lock, recording the agent's final status. */
  releaseCycleLock(status: Agent['status']): Promise<void>;

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

  // business models (commercial core — build-spec §3) — one per opportunity,
  // regenerated as evidence improves.
  listBusinessModels(): Promise<BusinessModel[]>;
  upsertBusinessModel(model: BusinessModel): Promise<void>;

  // opportunity decisions (commercial core — build-spec §5) — append-only
  // KILL/ITERATE/SCALE/CONTINUE audit log.
  listDecisions(): Promise<OpportunityDecision[]>;
  appendDecision(decision: OpportunityDecision): Promise<void>;

  // recommended actions (commercial core — build-spec §16) — derived state,
  // fully replaced every cycle rather than accumulated.
  listActions(): Promise<RecommendedAction[]>;
  replaceActions(actions: RecommendedAction[]): Promise<void>;
}

/** Engine callbacks so the host can render progress / stay in sync. */
export interface EngineHooks {
  log: (type: AgentEvent['type'], message: string) => void | Promise<void>;
  setStatus?: (status: Agent['status']) => void | Promise<void>;
  setActivity?: (activity: string, step: CycleStepKey | null) => void | Promise<void>;
}
