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
  DesignBrief,
  Experiment,
  LearningEvent,
  MarketPriceResearch,
  MemoryEntry,
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
  RealRevenueEntry,
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

  // prospects (real-world pipeline — build-spec §7/§8) — upserted by
  // (opportunityId, businessName) as discovery finds/re-confirms them.
  listProspects(): Promise<Prospect[]>;
  upsertProspects(prospects: Prospect[]): Promise<void>;

  // prospect interactions (build-spec §23) — append-only observability trail.
  listProspectInteractions(): Promise<ProspectInteraction[]>;
  appendProspectInteraction(interaction: ProspectInteraction): Promise<void>;

  // outreach message sets (AI outreach assistant — build-spec §9) — one per
  // prospect, regenerated (upserted) as the linked business model improves.
  listOutreachMessages(): Promise<OutreachMessageSet[]>;
  upsertOutreachMessages(set: OutreachMessageSet): Promise<void>;

  // offers (Phase 3: offer + delivery) — one per prospect, regenerated
  // (upserted) as the linked business model or prospect evidence improves.
  listOffers(): Promise<Offer[]>;
  upsertOffer(offer: Offer): Promise<void>;
  /** Human-driven: mark an offer sent/accepted/declined via the CRM write path. */
  updateOfferStatus(offerId: string, status: Offer['status']): Promise<void>;

  // design briefs (Phase 3) — one per offer.
  listDesignBriefs(): Promise<DesignBrief[]>;
  upsertDesignBrief(brief: DesignBrief): Promise<void>;

  // delivery projects (Phase 3) — one per WON prospect/offer.
  listProjects(): Promise<Project[]>;
  upsertProject(project: Project): Promise<void>;
  /** Advance a project's milestone; the human-driven counterpart to
   *  projectTracker.advanceMilestone() for implementations that persist
   *  milestones server-side rather than round-tripping the full object. */
  advanceProjectMilestone(projectId: string, milestone: ProjectMilestoneKey): Promise<void>;

  /**
   * Human-driven CRM write path (Phase 3): record a real-world status
   * change for a prospect. Never called by the autonomous loop itself —
   * SURVIVE AI never contacts anyone or observes real replies; this is the
   * only way a prospect ever advances past QUALIFIED.
   */
  updateProspectStatus(prospectId: string, status: Prospect['status'], reasonLost?: string): Promise<void>;

  // real revenue ledger (Phase 4, §13) — append-only, human-entered actual
  // money. Never mixed with the simulated wallet/experiment economics.
  listRealRevenue(): Promise<RealRevenueEntry[]>;
  addRealRevenueEntry(entry: RealRevenueEntry): Promise<void>;

  // learning events (Phase 4, §17) — append-only feed of real-world data
  // points that changed or reinforced a conclusion.
  listLearningEvents(): Promise<LearningEvent[]>;
  appendLearningEvent(event: LearningEvent): Promise<void>;

  // real-world outcome tracking on a delivered project (Phase 4, §15) —
  // satisfaction/repeat/referral, filled in by a human once known.
  updateProjectOutcome(
    projectId: string,
    outcome: { satisfaction?: number; repeatPurchase?: boolean; referral?: boolean },
  ): Promise<void>;

  // prospect intelligence (Phase 6) — deep, business-specific research.
  // One report per prospect, regenerated (upserted) as new research runs.
  listProspectIntelligence(): Promise<ProspectIntelligence[]>;
  upsertProspectIntelligence(intel: ProspectIntelligence): Promise<void>;

  // prospect demos (Phase 3, deepened) — a real, working single-page demo
  // built for one specific prospect. One per offer, regenerated (upserted)
  // as research/offer details improve.
  listProspectDemos(): Promise<ProspectDemo[]>;
  upsertProspectDemo(demo: ProspectDemo): Promise<void>;

  // market pricing research — real going rates for a specific service in
  // a specific region, replacing the old pure-formula price guess. One
  // per opportunity, regenerated (upserted) as research improves.
  listMarketPriceResearch(): Promise<MarketPriceResearch[]>;
  upsertMarketPriceResearch(research: MarketPriceResearch): Promise<void>;
}

/** Engine callbacks so the host can render progress / stay in sync. */
export interface EngineHooks {
  log: (type: AgentEvent['type'], message: string) => void | Promise<void>;
  setStatus?: (status: Agent['status']) => void | Promise<void>;
  setActivity?: (activity: string, step: CycleStepKey | null) => void | Promise<void>;
}
