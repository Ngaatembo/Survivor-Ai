/* ============================================================================
 * SURVIVE AI — Domain models
 * ----------------------------------------------------------------------------
 * These interfaces mirror the logical database tables prepared for Supabase.
 * See /supabase/schema.sql for the DDL. The prototype persists to localStorage
 * via a storage adapter; swapping in Supabase later does not change these shapes.
 * ========================================================================== */

export type AgentStatus =
  | 'ALIVE'
  | 'AT_RISK'
  | 'DEAD'
  | 'RESEARCHING'
  | 'EXECUTING'
  | 'PAUSED';

export type DataSource = 'SAMPLE' | 'LIVE';

export type EvidenceTier = 'VERIFIED' | 'LIKELY' | 'UNCERTAIN' | 'UNVERIFIED';

export type Category =
  | 'Digital Business'
  | 'Content'
  | 'E-Commerce'
  | 'Services'
  | 'Finance'
  | 'Local / Real-World';

export type RiskLevel = 'Low' | 'Low–Medium' | 'Medium' | 'Medium–High' | 'High';

export type ResearchStage =
  | 'UNDISCOVERED'
  | 'DISCOVERED'
  | 'RESEARCHED'
  | 'VERIFIED'
  | 'SCORED'
  | 'RANKED';

export type ExperimentOutcome =
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'FAILED'
  | 'INCONCLUSIVE';

export type TransactionType =
  | 'DEPOSIT'
  | 'REVENUE'
  | 'EXPENSE'
  | 'REFUND'
  | 'PROFIT'
  | 'LOSS';

export type EventType =
  | 'SYSTEM'
  | 'CYCLE'
  | 'DISCOVERY'
  | 'RESEARCH'
  | 'VERIFY'
  | 'SCORE'
  | 'DECISION'
  | 'REJECTION'
  | 'EXPERIMENT'
  | 'WALLET'
  | 'MEMORY'
  | 'WARNING';

/* -------------------------- opportunity lifecycle -------------------------- */

/**
 * Explicit evidence-driven lifecycle. Transitions are decided by
 * decisionEngine.evaluateOpportunity() — never flipped straight to PROVEN or
 * SCALING off a single lucky result (see PROOF_THRESHOLD in decisionEngine.ts).
 */
export type OpportunityLifecycleState =
  | 'DISCOVERED'
  | 'VALIDATING'
  | 'PROVEN'
  | 'SCALING'
  | 'FAILED'
  | 'ARCHIVED';

export type DecisionAction = 'KILL' | 'ITERATE' | 'SCALE' | 'CONTINUE';

/* ---------------------------------- agents -------------------------------- */

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  startedAt: number;
  startingCapital: number;
  survivalThreshold: number;
  currentStrategy: string;
  currentObjective: string;
  cycleCount: number;
  totalCyclesRun: number;
}

/* ----------------------------- research_sources --------------------------- */

export interface ResearchSource {
  id: string;
  title: string;
  url?: string;
  kind: 'platform' | 'report' | 'community' | 'academic' | 'sample-note' | 'web';
  note?: string;
}

/* ------------------------------ opportunities ----------------------------- */

export interface Opportunity {
  id: string;
  name: string;
  category: Category;
  tags: string[];
  dataSource: DataSource;
  researchStage: ResearchStage;

  description: string;
  howMoneyMade: string;

  capitalRequiredMin: number; // USD
  capitalRequiredMax: number; // USD
  timeToRevenueDaysMin: number;
  timeToRevenueDaysMax: number;

  skills: string[];
  difficulty: 1 | 2 | 3 | 4 | 5; // 1 = trivial, 5 = very hard
  competition: 1 | 2 | 3 | 4 | 5; // 1 = empty, 5 = saturated
  scalability: 1 | 2 | 3 | 4 | 5; // 1 = none, 5 = excellent
  risk: 1 | 2 | 3 | 4 | 5; // 1 = safe, 5 = dangerous
  riskLevel: RiskLevel;

  geographicRelevance: string[];
  evidenceTier: EvidenceTier;
  evidenceNotes: string;

  successProbability: number; // 0..1, estimate for a $50-budget first attempt
  revenuePotentialMonthlyMin: number;
  revenuePotentialMonthlyMax: number;
  upsideNote: string;
  downsideNote: string;
  operatingCostsNote: string;

  examples: string[];
  sources: ResearchSource[];
  dateResearched: number | null;

  // Finance / high-risk categories are research-only: never auto-executed.
  executionBlocked: boolean;
  blockReason?: string;

  score?: ScoreBreakdown;

  /** Evidence-driven commercial status — see decisionEngine.ts. */
  lifecycleState: OpportunityLifecycleState;
}

export type ScoreFactorKey =
  | 'capitalFit'
  | 'speedToRevenue'
  | 'successProbability'
  | 'profitPotential'
  | 'scalability'
  | 'competition'
  | 'difficulty'
  | 'risk'
  | 'evidence';

export type Recommendation =
  | 'HIGH PRIORITY'
  | 'RECOMMENDED'
  | 'WATCHLIST'
  | 'DEPRIORITIZE'
  | 'RESEARCH ONLY';

export interface ScoreFactor {
  key: ScoreFactorKey;
  label: string;
  weight: number;
  raw: number; // 0..100 normalized
  weighted: number; // raw * weight / 100
  direction: 'higher-better' | 'lower-better';
}

export interface ScoreBreakdown {
  total: number;
  factors: ScoreFactor[];
  recommendation: Recommendation;
  budgetFit: boolean;
  aiSuitable: boolean;
  scoredAt: number;
}

/* ----------------------------- research_reports --------------------------- */

export interface ResearchReport {
  id: string;
  opportunityId: string;
  opportunityName: string;
  generatedAt: number;
  generator: 'local-rule-engine' | 'llm';
  executiveSummary: string;
  marketOpportunity: string;
  howItWorks: string;
  capitalRequirements: string;
  competition: string;
  risks: string[];
  evidence: string;
  potentialRevenue: string;
  recommendedExperiment: string;
  confidence: number; // 0..1
  finalScore: number;
  dataSource: DataSource;
}

/* ------------------------------- experiments ------------------------------ */

export interface Experiment {
  id: string;
  cycleId: string | null;
  opportunityId: string;
  opportunityName: string;
  category: Category;

  objective: string;
  startingBudget: number;
  plannedAction: string;
  expectedOutcome: string;

  actualCost: number;
  actualRevenue: number;
  profitLoss: number;
  roi: number; // (revenue - cost) / cost * 100
  outcome: ExperimentOutcome;
  durationDays: number;

  lessonsLearned: string[];
  evidenceNote: string;
  simulated: true;

  createdAt: number;
}

/* ------------------------------- agent_memory ----------------------------- */

export type MemoryKind = 'opportunity' | 'category' | 'lesson' | 'assumption';

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  refId?: string; // opportunity id or category name
  title: string;
  tests: number;
  spent: number;
  revenue: number;
  conclusion: 'PROMISING' | 'VIABLE' | 'MIXED' | 'AVOID' | 'UNTESTED' | 'WATCH';
  notes: string[];
  updatedAt: number;
}

/* ------------------------------- transactions ----------------------------- */

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number; // signed: positive in, negative out
  description: string;
  relatedExperimentId?: string;
  balanceAfter: number;
  createdAt: number;
}

/* ------------------------------- agent_events ----------------------------- */

export interface AgentEvent {
  id: string;
  type: EventType;
  message: string;
  createdAt: number;
}

/* -------------------------------- strategies ------------------------------ */

export interface Strategy {
  id: string;
  name: string;
  rationale: string;
  active: boolean;
  createdAt: number;
}

/* ------------------------------- agent_cycles ----------------------------- */

export type CycleStepKey =
  | 'RESEARCH'
  | 'DISCOVER'
  | 'VERIFY'
  | 'SCORE'
  | 'RANK'
  | 'SELECT'
  | 'SIMULATE'
  | 'MEASURE'
  | 'LEARN';

export interface CycleStep {
  key: CycleStepKey;
  label: string;
  status: 'pending' | 'active' | 'done' | 'skipped';
  at?: number;
}

export interface AgentCycle {
  id: string;
  index: number;
  startedAt: number;
  completedAt?: number;
  steps: CycleStep[];
  discoveredIds: string[];
  selectedOpportunityId?: string;
  experimentId?: string;
  summary?: string;
}

/* ----------------------------- opportunity_models -------------------------- */

/**
 * The concrete, sellable business model behind a promising opportunity.
 * Answers WHO / WHAT PROBLEM / WHAT WE SELL / WHY BUY / PRICE / CHANNEL /
 * MESSAGE / DELIVERY / PROFIT / SCALE / NEXT ACTION. One per opportunity;
 * regenerated (upserted) as evidence improves.
 */
export interface BusinessModel {
  id: string;
  opportunityId: string;
  opportunityName: string;

  targetCustomer: string; // WHO
  problem: string; // WHAT PROBLEM
  offer: string; // WHAT EXACTLY DO WE SELL
  whyTheyBuy: string; // WHY WOULD THEY BUY

  suggestedPrice: number; // USD, single unit / first engagement
  priceRationale: string;
  deliveryCostEstimate: number;
  expectedGrossMarginPct: number; // 0..100

  acquisitionChannel: string; // HOW DO WE FIND THEM
  salesMessage: string; // WHAT DO WE SAY
  followUpSequence: string[];
  objectionHandling: { objection: string; response: string }[];

  deliveryWorkflow: string; // WHAT DOES DELIVERY REQUIRE
  timeToFirstSaleDaysEstimate: number; // HOW FAST CAN WE DELIVER
  upsells: string[];
  recurringRevenueNote: string;

  expectedProfitFirstDeal: number;
  canScale: boolean;
  scaleNote: string;
  nextAction: string; // WHAT IS THE NEXT ACTION

  confidence: number; // 0..1
  generator: 'local-rule-engine' | 'llm';
  generatedAt: number;
  updatedAt: number;
}

/* ---------------------------- opportunity_decisions ------------------------ */

/**
 * Append-only audit log of every KILL / ITERATE / SCALE / CONTINUE decision,
 * plus the lifecycle transition it drove. Every entry explains WHY.
 */
export interface OpportunityDecision {
  id: string;
  opportunityId: string;
  opportunityName: string;
  action: DecisionAction;
  previousState: OpportunityLifecycleState;
  newState: OpportunityLifecycleState;
  reasoning: string;
  evidenceSummary: string;
  metrics: {
    tests: number;
    spent: number;
    revenue: number;
    realRevenueScore: number;
  };
  nextAction: string;
  createdAt: number;
}

/* ------------------------------- agent_actions ------------------------------ */

/**
 * "What should I do now?" — recommended, ranked actions. Recomputed and
 * fully replaced at the end of every cycle (derived state, not history).
 */
export type RecommendedActionKind =
  | 'REVIEW_PROVEN'
  | 'PURSUE_MODEL'
  | 'RUN_EXPERIMENT'
  | 'STOP_OPPORTUNITY'
  | 'ITERATE_OFFER'
  | 'WAIT_FOR_EVIDENCE';

export interface RecommendedAction {
  id: string;
  kind: RecommendedActionKind;
  opportunityId?: string;
  opportunityName?: string;
  title: string;
  description: string;
  expectedValue: number; // USD, modeled
  urgency: 1 | 2 | 3 | 4 | 5;
  effort: 1 | 2 | 3 | 4 | 5;
  rank: number; // 1 = top action
  createdAt: number;
}

/* ------------------------------ service wiring ---------------------------- */

export interface ConnectorStatus {
  id: string;
  name: string;
  purpose: string;
  connected: boolean;
  currentFallback: string;
  safetyGated?: boolean;
}
