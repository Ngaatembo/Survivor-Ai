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
  | 'CRITICAL'
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
  | 'WAIT_FOR_EVIDENCE'
  | 'CONTACT_PROSPECT'
  | 'FOLLOW_UP_PROSPECT'
  | 'SEND_OFFER'
  | 'ADVANCE_PROJECT';

export interface RecommendedAction {
  id: string;
  kind: RecommendedActionKind;
  opportunityId?: string;
  opportunityName?: string;
  prospectId?: string;
  prospectName?: string;
  title: string;
  description: string;
  expectedValue: number; // USD, modeled
  urgency: 1 | 2 | 3 | 4 | 5;
  effort: 1 | 2 | 3 | 4 | 5;
  rank: number; // 1 = top action
  createdAt: number;
}

/* -------------------------------- prospects -------------------------------- */

/**
 * CRM pipeline states for a real-world prospect (build-spec §8). A prospect
 * always traces back to the opportunity/business model it was discovered
 * for — this is real-world execution of a validated model, not a parallel
 * simulation.
 */
export type ProspectStatus =
  | 'DISCOVERED'
  | 'QUALIFIED'
  | 'CONTACTED'
  | 'REPLIED'
  | 'INTERESTED'
  | 'PROPOSAL_SENT'
  | 'NEGOTIATING'
  | 'WON'
  | 'LOST'
  | 'NOT_INTERESTED'
  | 'FOLLOW_UP';

export type ProspectPriority = 'HIGH' | 'MEDIUM' | 'LOW' | 'DO_NOT_CONTACT';

/**
 * What the evidence actually shows about the prospect's web presence.
 * Defaults to UNKNOWN — the discovery engine never claims NONE/OUTDATED
 * unless the cited source actually supports that conclusion (build-spec §7:
 * "Never claim that a business has no website unless the available
 * evidence supports that conclusion").
 */
export type WebsitePresence = 'NONE_FOUND' | 'SOCIAL_ONLY' | 'WEAK_OR_OUTDATED' | 'ADEQUATE' | 'UNKNOWN';

export type ContactChannel = 'PHONE' | 'WHATSAPP' | 'EMAIL' | 'FACEBOOK' | 'INSTAGRAM' | 'WEBSITE_FORM' | 'UNKNOWN';

export type ProspectVerificationStatus = 'VERIFIED' | 'PROVISIONAL' | 'CONFLICT' | 'UNVERIFIED';

export interface ProspectVerification {
  status: ProspectVerificationStatus;
  confidence: number; // 0..100, evidence-based identity/contact confidence
  verifiedBusinessName?: string;
  verifiedContactChannel?: ContactChannel;
  verifiedContactValue?: string;
  verifiedEmail?: string;
  verifiedWebsiteUrl?: string;
  verifiedLocation?: string;
  alternateContacts?: string[];
  businessNameMatchScore: number; // 0..1
  contactMatchScore: number; // 0..1
  independentSources: number;
  contactSources: number;
  sourceUrls: string[];
  conflictingContacts: string[];
  notes: string[];
  verifiedAt: number;
}

/** Explainable lead-scoring breakdown (build-spec §12). Every number here is
 *  derived from a field already stored on the prospect — no opaque score. */
export interface LeadScoreBreakdown {
  total: number; // 0..100
  factors: string[]; // short plain-language reasons, most-significant first
  expectedDealValue: number;
  expectedAcquisitionCost: number;
  expectedProfit: number;
  expectedTimeToRevenueDays: number;
  probabilityOfClose: number; // 0..1
  expectedValue: number; // expectedProfit * probabilityOfClose
  scoredAt: number;
}

export interface Prospect {
  id: string;
  opportunityId: string;
  opportunityName: string;

  businessName: string;
  category: string; // free-text business category (e.g. "Local service business")
  location: string;

  websitePresence: WebsitePresence;
  websiteUrl?: string;
  socialLinks: string[];

  contactChannel: ContactChannel;
  contactValue?: string; // only populated with a verified/provisional public contact

  /** Independent evidence that the business identity/contact belongs to this prospect. */
  verification?: ProspectVerification;

  sources: ResearchSource[];
  evidenceNotes: string;

  priority: ProspectPriority;
  score: LeadScoreBreakdown;

  status: ProspectStatus;
  dataSource: DataSource;

  dateDiscovered: number;
  lastContactAt?: number;
  nextFollowUpAt?: number;
  messagesSentCount: number;
  responsesReceivedCount: number;

  actualRevenue: number; // only ever set from real_revenue records (build-spec §13)
  notes: string[];
  reasonLost?: string;

  createdAt: number;
  updatedAt: number;
}

export type ProspectInteractionKind =
  | 'DISCOVERED'
  | 'QUALIFIED'
  | 'OUTREACH_GENERATED'
  | 'STATUS_CHANGE'
  | 'NOTE'
  | 'FOLLOW_UP_SET'
  | 'OFFER_DRAFTED'
  | 'PROJECT_STARTED'
  | 'INTELLIGENCE_GATHERED'
  | 'DEMO_BUILT';

/** Append-only observability trail for a prospect (build-spec §23). */
export interface ProspectInteraction {
  id: string;
  prospectId: string;
  kind: ProspectInteractionKind;
  summary: string;
  createdAt: number;
}

/* ------------------------- prospect intelligence ---------------------------- */

/**
 * Deep research on ONE specific real business (Phase 6, "why would THIS
 * person pay us") — as opposed to the generic category-level evidence
 * used elsewhere. Generated from live search snippets about that exact
 * business, synthesized by the real LLM when connected (never a template);
 * degrades to a plain snippet digest when the LLM is unavailable. Every
 * field traces to `sources`; nothing here is invented.
 */
export type IntelligenceConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ProspectIntelligence {
  id: string;
  prospectId: string;
  businessOverview: string;
  apparentServices: string[];
  socialPresenceSummary: string;
  competitiveNote: string;
  specificProblemEvidence: string;
  recommendedAngle: string;
  confidence: IntelligenceConfidence;
  generator: 'llm' | 'snippet-digest';
  sources: ResearchSource[];
  generatedAt: number;
  updatedAt: number;
}

/* ---------------------------------- missions --------------------------------- */

/**
 * A concrete, structured survival objective (Survivor 2.0 §10) — replaces
 * the freeform Agent.currentObjective string with something the
 * dashboard can show progress against and learn from. The standard
 * ladder (make first $1 -> reach $10 -> ... -> recover starting capital
 * -> reach $100) is defined once in lib/missions.ts; only one mission is
 * ACTIVE at a time, activated in order as each completes.
 */
export type MissionStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED';

export interface Mission {
  id: string;
  sequence: number; // fixed ladder position, so ordering never depends on timestamps
  objective: string; // e.g. "Make first $1"
  targetBalance: number; // the wallet balance that completes this mission
  strategy: string; // human-readable current approach, mirrors Agent.currentStrategy
  status: MissionStatus;
  expectedRevenue?: string; // e.g. "$20-$60" — a range, never a false-precision number
  startedAt: number;
  completedAt?: number;
  lessonsLearned: string[]; // filled in from real_revenue/learning_events once completed
}

/* ------------------------------ market pricing ------------------------------ */

/**
 * A real, evidence-grounded market-rate estimate for a specific service in
 * a specific region — replaces the old pure-formula price guess
 * (modeled monthly revenue ÷ assumed engagement count) with actual going
 * rates found via live search, synthesized by the real LLM when
 * connected. Confidence is only ever HIGH/MEDIUM when the underlying
 * snippets contained a real pricing figure — never estimated from theory.
 * One per opportunity, regenerated as research improves.
 */
export interface MarketPriceResearch {
  id: string;
  opportunityId: string;
  service: string;
  region: string;
  priceMin: number;
  priceMax: number;
  currency: string;
  rationale: string;
  confidence: IntelligenceConfidence;
  generator: 'llm' | 'snippet-digest';
  sources: ResearchSource[];
  generatedAt: number;
  updatedAt: number;
}

/* -------------------------------- demos -------------------------------- */

/* ------------------------------ prospect demos ------------------------------ */

/**
 * A real, working single-page website demo built for ONE specific
 * prospect (Phase 3, "here's what YOUR website could look like" — not a
 * generic template). Built from the prospect's own real fields, the
 * linked offer's website brief, and (when available and confident) the
 * deep-research report — never a fabricated photo, testimonial, or claim.
 * Always carries a visible "demo, not yet built or affiliated" disclaimer
 * so it can never be mistaken for the business's real official site.
 */
export interface ProspectDemo {
  id: string;
  prospectId: string;
  offerId: string;
  businessName: string;
  html: string; // self-contained HTML document
  heroHeadline: string;
  sectionsIncluded: string[];
  generator: 'llm' | 'template';
  generatedAt: number;
  updatedAt: number;
}

/* --------------------------- outreach_messages ------------------------------ */

/**
 * AI outreach assistant output (build-spec §9) — prepared for human
 * approval/execution; SURVIVE AI never sends these automatically. Every
 * field is generated only from the prospect's own stored, verified fields
 * and the linked business model — never invented facts about the business.
 */
export interface OutreachMessageSet {
  id: string;
  prospectId: string;
  opportunityId: string;
  businessModelId?: string;

  whatsapp: string;
  sms: string;
  email: { subject: string; body: string };
  shortVersion: string;
  professionalVersion: string;
  followUp1: string;
  followUp2: string;
  objectionResponses: { objection: string; response: string }[];
  priceExplanation: string;
  callScript: string[];
  meetingAgenda: string[];
  proposalOutline: string[];

  generator: 'local-rule-engine' | 'llm';
  generatedAt: number;
  updatedAt: number;
}

/* --------------------------------- offers ----------------------------------- */

/**
 * A concrete, sendable package generated once a prospect is engaged
 * (INTERESTED or further) and a business model exists for its opportunity
 * (Phase 3 — offer + delivery). Never fabricates a fact about the
 * business: everything here is derived from the prospect's own stored
 * fields and the linked business model. Never sent automatically — a
 * human reviews and sends it (spec §20, carried forward).
 */
export type OfferStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED';

export interface WebsiteBrief {
  sitemap: string[];
  copyDirection: string;
  ctaStrategy: string;
  brandDirection: string;
  seoBasics: string[];
  requiredSections: string[];
  requiredAssets: string[];
}

export interface Offer {
  id: string;
  prospectId: string;
  prospectName: string;
  opportunityId: string;
  businessModelId?: string;

  price: number;
  priceRationale?: string; // explains whether the price is grounded in real market research or a formula estimate
  timelineDaysMin: number;
  timelineDaysMax: number;
  deliverables: string[];
  gapAnalysis?: string; // only included when the evidence actually supports one

  websiteBrief: WebsiteBrief;

  status: OfferStatus;
  generator: 'local-rule-engine' | 'llm';
  generatedAt: number;
  updatedAt: number;
}

/* ------------------------------ design briefs ------------------------------- */

/**
 * Structured design brief generated alongside every drafted offer (Phase 3).
 * No image-generation integration is wired into this deployment, so
 * `assetStatus` stays NOT_CONFIGURED — the brief itself is complete and
 * human-usable regardless, and nothing here fabricates an asset URL.
 */
export type DesignAssetStatus = 'NOT_CONFIGURED' | 'GENERATING' | 'READY';

export interface DesignBrief {
  id: string;
  offerId: string;
  prospectId: string;

  homepageConcept: string;
  heroSection: string;
  logoDirection: string;
  socialGraphics: string[];
  colorDirectionNote: string;

  assetStatus: DesignAssetStatus;
  generatedAt: number;
  updatedAt: number;
}

/* --------------------------------- projects ---------------------------------- */

/**
 * A lightweight delivery project, created automatically the moment a
 * prospect reaches WON against a drafted offer (Phase 3). Tracks agreed
 * price/timeline and standard milestones so "what's next to deliver" is a
 * simple query — this is delivery tracking, never a second wallet: real
 * money is recorded separately in the Phase 4 revenue ledger, not here.
 */
export type ProjectMilestoneKey =
  | 'KICKOFF'
  | 'CONTENT_COLLECTED'
  | 'DESIGN_APPROVED'
  | 'BUILD'
  | 'REVIEW'
  | 'DELIVERED';

export interface ProjectMilestone {
  key: ProjectMilestoneKey;
  label: string;
  status: 'pending' | 'active' | 'done';
  completedAt?: number;
}

export type ProjectStatus = 'ACTIVE' | 'DELIVERED' | 'CANCELLED';

export interface Project {
  id: string;
  prospectId: string;
  prospectName: string;
  offerId: string;
  opportunityId: string;

  agreedPrice: number;
  agreedTimelineDaysMax: number;
  milestones: ProjectMilestone[];
  status: ProjectStatus;

  startedAt: number;
  deliveredAt?: number;
  updatedAt: number;

  // Real-world outcome tracking (Phase 4, §15) — optional, filled in by a
  // human once known. Never inferred or defaulted.
  satisfaction?: number; // 1-5
  repeatPurchase?: boolean;
  referral?: boolean;
}

/* ----------------------------- real revenue -------------------------------- */

/**
 * The actual-money record (Phase 4, §13) — completely separate from the
 * simulated wallet/experiment economics used everywhere else in the app.
 * The platform never moves money; a human fills this in after a real
 * transaction happens. Append-only: entries are never edited or deleted
 * once recorded, so this stays an honest audit trail.
 */
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'MOBILE_MONEY' | 'CARD' | 'OTHER';

export interface RealRevenueEntry {
  id: string;
  date: number; // when the real transaction happened
  opportunityId: string;
  opportunityName: string;
  prospectId: string;
  prospectName: string;
  projectId: string;
  productService: string;
  quotedPrice: number;
  amountReceived: number;
  costs: number;
  profit: number; // amountReceived - costs, stored (not just derived) for audit
  currency: string;
  paymentMethod: PaymentMethod;
  acquisitionChannel: string;
  daysFromDiscoveryToPayment: number;
  notes?: string;
  createdAt: number;
}

/* ---------------------------- learning events ------------------------------ */

/**
 * Append-only feed of real-world data points that changed or reinforced a
 * conclusion (Phase 4, §17). Feeds `agent_memory` (via a note, not a
 * parallel system) and a small, explainable rule-based scoring nudge
 * (`realWorldScoreAdjustment` in lib/realRevenue.ts) — never a black-box
 * model.
 */
export type LearningEventKind = 'REAL_REVENUE_RECORDED' | 'PREDICTION_VS_ACTUAL';

export interface LearningEvent {
  id: string;
  kind: LearningEventKind;
  opportunityId: string;
  category: string;
  refId: string; // the real_revenue entry id this event was generated from
  summary: string; // human-readable "what we learned" line
  predictedValue?: number;
  actualValue?: number;
  deltaPct?: number; // (actual - predicted) / predicted, when both exist
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
