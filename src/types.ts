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

/* ------------------------------ service wiring ---------------------------- */

export interface ConnectorStatus {
  id: string;
  name: string;
  purpose: string;
  connected: boolean;
  currentFallback: string;
  safetyGated?: boolean;
}
