/* ============================================================================
 * InMemoryRepository — used by the Cloudflare Worker in quick dev runs and by
 * tests. Production headless runs use SupabaseRepository (durability).
 * Supports the same seeding as the browser store.
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
  MemoryEntry,
  Offer,
  Opportunity,
  OpportunityDecision,
  OutreachMessageSet,
  Project,
  ProjectMilestoneKey,
  Prospect,
  ProspectInteraction,
  ProspectIntelligence,
  RealRevenueEntry,
  RecommendedAction,
  ResearchReport,
  Strategy,
  Transaction,
} from '../types';
import { advanceMilestone } from '../lib/projectTracker';
import type { EngineRepository } from './repository';

interface InMemoryState {
  agent: Agent | null;
  opportunities: Opportunity[];
  transactions: Transaction[];
  experiments: Experiment[];
  memory: MemoryEntry[];
  reports: ResearchReport[];
  events: AgentEvent[];
  strategies: Strategy[];
  cycles: AgentCycle[];
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
}

export class InMemoryRepository implements EngineRepository {
  state: InMemoryState = {
    agent: null,
    opportunities: [],
    transactions: [],
    experiments: [],
    memory: [],
    reports: [],
    events: [],
    strategies: [],
    cycles: [],
    businessModels: [],
    decisions: [],
    actions: [],
    prospects: [],
    prospectInteractions: [],
    outreachMessages: [],
    offers: [],
    designBriefs: [],
    projects: [],
    realRevenue: [],
    learningEvents: [],
    prospectIntelligence: [],
  };

  /** Load a snapshot (e.g. produced by createSeedState). */
  load(snapshot: Partial<InMemoryState>) {
    this.state = { ...this.state, ...snapshot };
  }

  async getAgent() {
    if (!this.state.agent) throw new Error('agent not initialized');
    return this.state.agent;
  }
  async updateAgent(patch: Partial<Agent>) {
    const next = { ...(await this.getAgent()), ...patch };
    this.state.agent = next;
    return next;
  }
  async createAgentIfMissing(agent: Agent) {
    if (!this.state.agent) this.state.agent = agent;
    return this.state.agent;
  }
  private cycleLockAt: number | null = null;
  async tryClaimCycle(staleAfterMs = 15 * 60 * 1000) {
    const agent = this.state.agent;
    if (!agent || agent.status === 'DEAD') return false;
    const locked = agent.status === 'RESEARCHING' || agent.status === 'EXECUTING';
    if (locked && this.cycleLockAt !== null && Date.now() - this.cycleLockAt < staleAfterMs) return false;
    this.cycleLockAt = Date.now();
    this.state.agent = { ...agent, status: 'RESEARCHING' };
    return true;
  }
  async releaseCycleLock(status: Agent['status']) {
    this.cycleLockAt = null;
    if (this.state.agent) this.state.agent = { ...this.state.agent, status };
  }

  async listOpportunities() {
    return this.state.opportunities;
  }
  async listResearchedOpportunities() {
    return this.state.opportunities.filter((o) => o.researchStage !== 'UNDISCOVERED');
  }
  async upsertOpportunities(opps: Opportunity[]) {
    const byId = new Map(this.state.opportunities.map((o) => [o.id, o]));
    for (const o of opps) byId.set(o.id, o);
    this.state.opportunities = [...byId.values()];
  }

  async listTransactions() {
    return this.state.transactions;
  }
  async appendTransaction(tx: Transaction) {
    this.state.transactions = [...this.state.transactions, tx];
  }

  async listExperiments() {
    return this.state.experiments;
  }
  async appendExperiment(exp: Experiment) {
    this.state.experiments = [exp, ...this.state.experiments];
  }

  async listMemory() {
    return this.state.memory;
  }
  async upsertMemory(mem: MemoryEntry) {
    const idx = this.state.memory.findIndex(
      (m) => m.kind === mem.kind && (mem.refId ? m.refId === mem.refId : m.id === mem.id),
    );
    if (idx >= 0) {
      const copy = [...this.state.memory];
      copy[idx] = mem;
      this.state.memory = copy;
    } else {
      this.state.memory = [mem, ...this.state.memory];
    }
  }

  async listReports() {
    return this.state.reports;
  }
  async appendReport(report: ResearchReport) {
    this.state.reports = [report, ...this.state.reports.filter((r) => r.opportunityId !== report.opportunityId)];
  }

  async listStrategies() {
    return this.state.strategies;
  }
  async appendStrategy(strategy: Strategy) {
    this.state.strategies = [
      { ...strategy, active: true },
      ...this.state.strategies.map((s) => ({ ...s, active: false })),
    ];
  }
  async deactivateStrategies() {
    this.state.strategies = this.state.strategies.map((s) => ({ ...s, active: false }));
  }

  async listEvents() {
    return this.state.events;
  }
  async appendEvent(event: AgentEvent) {
    this.state.events = [...this.state.events, event].slice(-500);
  }

  async listCycles() {
    return this.state.cycles;
  }
  async appendCycle(cycle: AgentCycle) {
    this.state.cycles = [...this.state.cycles, cycle].slice(-200);
  }
  async updateCycleStep(cycleId: string, step: CycleStepKey, status: 'active' | 'done' | 'skipped', at?: number) {
    this.state.cycles = this.state.cycles.map((c) =>
      c.id !== cycleId
        ? c
        : {
            ...c,
            steps: c.steps.map((st) =>
              st.key === step
                ? { ...st, status, at: status === 'done' ? at ?? Date.now() : st.at }
                : st,
            ),
          },
    );
  }
  async completeCycle(cycleId: string, patch: Partial<AgentCycle>) {
    this.state.cycles = this.state.cycles.map((c) => (c.id === cycleId ? { ...c, ...patch } : c));
  }

  async reset() {
    this.state = {
      agent: null,
      opportunities: [],
      transactions: [],
      experiments: [],
      memory: [],
      reports: [],
      events: [],
      strategies: [],
      cycles: [],
      businessModels: [],
      decisions: [],
      actions: [],
      prospects: [],
      prospectInteractions: [],
      outreachMessages: [],
      offers: [],
      designBriefs: [],
      projects: [],
      realRevenue: [],
      learningEvents: [],
      prospectIntelligence: [],
    };
  }

  async listBusinessModels() {
    return this.state.businessModels;
  }
  async upsertBusinessModel(model: BusinessModel) {
    this.state.businessModels = [
      model,
      ...this.state.businessModels.filter((m) => m.opportunityId !== model.opportunityId),
    ];
  }

  async listDecisions() {
    return this.state.decisions;
  }
  async appendDecision(decision: OpportunityDecision) {
    this.state.decisions = [decision, ...this.state.decisions].slice(0, 500);
  }

  async listActions() {
    return this.state.actions;
  }
  async replaceActions(actions: RecommendedAction[]) {
    this.state.actions = actions;
  }

  async listProspects() {
    return this.state.prospects;
  }
  async upsertProspects(prospects: Prospect[]) {
    const byKey = new Map(this.state.prospects.map((p) => [`${p.opportunityId}::${p.businessName.toLowerCase()}`, p]));
    for (const p of prospects) byKey.set(`${p.opportunityId}::${p.businessName.toLowerCase()}`, p);
    this.state.prospects = [...byKey.values()];
  }

  async listProspectInteractions() {
    return this.state.prospectInteractions;
  }
  async appendProspectInteraction(interaction: ProspectInteraction) {
    this.state.prospectInteractions = [interaction, ...this.state.prospectInteractions].slice(0, 1000);
  }

  async listOutreachMessages() {
    return this.state.outreachMessages;
  }
  async upsertOutreachMessages(set: OutreachMessageSet) {
    this.state.outreachMessages = [
      set,
      ...this.state.outreachMessages.filter((m) => m.prospectId !== set.prospectId),
    ];
  }

  async listOffers() {
    return this.state.offers;
  }
  async upsertOffer(offer: Offer) {
    this.state.offers = [offer, ...this.state.offers.filter((o) => o.prospectId !== offer.prospectId)];
  }
  async updateOfferStatus(offerId: string, status: Offer['status']) {
    this.state.offers = this.state.offers.map((o) => (o.id === offerId ? { ...o, status, updatedAt: Date.now() } : o));
  }

  async listDesignBriefs() {
    return this.state.designBriefs;
  }
  async upsertDesignBrief(brief: DesignBrief) {
    this.state.designBriefs = [brief, ...this.state.designBriefs.filter((b) => b.offerId !== brief.offerId)];
  }

  async listProjects() {
    return this.state.projects;
  }
  async upsertProject(project: Project) {
    this.state.projects = [project, ...this.state.projects.filter((p) => p.prospectId !== project.prospectId)];
  }
  async advanceProjectMilestone(projectId: string, milestone: ProjectMilestoneKey) {
    this.state.projects = this.state.projects.map((p) => (p.id === projectId ? advanceMilestone(p, milestone) : p));
  }

  async updateProspectStatus(prospectId: string, status: Prospect['status'], reasonLost?: string) {
    this.state.prospects = this.state.prospects.map((p) =>
      p.id === prospectId ? { ...p, status, reasonLost: reasonLost ?? p.reasonLost, updatedAt: Date.now() } : p,
    );
  }

  async listRealRevenue() {
    return this.state.realRevenue;
  }
  async addRealRevenueEntry(entry: RealRevenueEntry) {
    this.state.realRevenue = [entry, ...this.state.realRevenue];
  }

  async listLearningEvents() {
    return this.state.learningEvents;
  }
  async appendLearningEvent(event: LearningEvent) {
    this.state.learningEvents = [event, ...this.state.learningEvents];
  }

  async updateProjectOutcome(
    projectId: string,
    outcome: { satisfaction?: number; repeatPurchase?: boolean; referral?: boolean },
  ) {
    this.state.projects = this.state.projects.map((p) =>
      p.id === projectId ? { ...p, ...outcome, updatedAt: Date.now() } : p,
    );
  }

  async listProspectIntelligence() {
    return this.state.prospectIntelligence;
  }
  async upsertProspectIntelligence(intel: ProspectIntelligence) {
    this.state.prospectIntelligence = [
      intel,
      ...this.state.prospectIntelligence.filter((i) => i.prospectId !== intel.prospectId),
    ];
  }
}
