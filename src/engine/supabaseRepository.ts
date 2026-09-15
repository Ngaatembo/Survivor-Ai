/* ============================================================================
 * SupabaseRepository — durable Postgres persistence behind the same
 * EngineRepository interface. Works in the Cloudflare Worker (service role
 * key) and optionally in the browser (anon key + RLS).
 *
 * Money columns are NUMERIC(12,2) and come back as strings — normalized to
 * numbers here. The nested `score` object is stored JSONB in
 * opportunities.score_factors; score_total/recommendation are projected
 * columns for SQL ranking.
 * ========================================================================== */

import type {
  Agent,
  AgentCycle,
  AgentEvent,
  BusinessModel,
  CycleStep,
  CycleStepKey,
  DesignBrief,
  EventType,
  Experiment,
  IntelligenceConfidence,
  LearningEvent,
  MemoryEntry,
  Offer,
  Opportunity,
  OpportunityDecision,
  OutreachMessageSet,
  Project,
  ProjectMilestone,
  ProjectMilestoneKey,
  Prospect,
  ProspectDemo,
  ProspectInteraction,
  ProspectIntelligence,
  MarketPriceResearch,
  RealRevenueEntry,
  RecommendedAction,
  ResearchReport,
  Strategy,
  Transaction,
  ScoreBreakdown,
  WebsiteBrief,
} from '../types';
import type { EngineRepository } from './repository';
import { advanceMilestone } from '../lib/projectTracker';
import { createSeedSnapshot, AGENT_ID } from './seed';

export interface SupabaseClientLike {
  from(table: string): any;
}

export class SupabaseRepository implements EngineRepository {
  constructor(
    private db: SupabaseClientLike,
    private agentId: string = AGENT_ID,
  ) {}

  private n(v: unknown): number {
    if (v === null || v === undefined) return 0;
    const num = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(num) ? num : 0;
  }

  /* ------------------------------- agent -------------------------------- */

  async getAgent(): Promise<Agent> {
    const { data, error } = await this.db.from('agents').select('*').eq('id', this.agentId).single();
    if (error || !data) throw new Error(error?.message ?? 'agent not found');
    return this.mapAgent(data);
  }

  async updateAgent(patch: Partial<Agent>): Promise<Agent> {
    const update = this.agentPatch(patch);
    const { data, error } = await this.db
      .from('agents')
      .update(update)
      .eq('id', this.agentId)
      .select('*')
      .single();
    if (error) {
      throw new Error(
        `${error.message} — updateAgent(${this.agentId}) failed; if the agent doesn't exist yet, call createAgentIfMissing() first`,
      );
    }
    return this.mapAgent(data);
  }

  /** Create the agent row iff it doesn't already exist. Idempotent. */
  async createAgentIfMissing(agent: Agent): Promise<Agent> {
    const { error } = await this.db.from('agents').upsert(
      {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        starting_capital: agent.startingCapital,
        survival_threshold: agent.survivalThreshold,
        current_strategy: agent.currentStrategy,
        current_objective: agent.currentObjective,
        cycle_count: agent.cycleCount,
        total_cycles_run: agent.totalCyclesRun,
        real_money_enabled: false,
        daily_spend_limit: 0,
        created_at: new Date(agent.startedAt).toISOString(),
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return this.getAgent();
  }

  /**
   * Atomic-enough claim for a single-writer worker: only one caller can move
   * the agent into RESEARCHING/EXECUTING at a time. A stale lock (a previous
   * run that crashed mid-cycle without releasing it) can be reclaimed after
   * `staleAfterMs`. Never reclaims a DEAD agent. Supabase has no CAS-on-update
   * feedback via supabase-js the way D1's changes-count gives us, so this
   * reads-then-writes with a status filter on the write itself — still race-
   * safe against the common case (cron ticks, which never overlap on a single
   * scheduled Worker) even though it is not a true DB-level CAS.
   */
  async tryClaimCycle(staleAfterMs = 15 * 60 * 1000): Promise<boolean> {
    const now = Date.now();
    const staleBefore = new Date(now - staleAfterMs).toISOString();
    const { data, error } = await this.db
      .from('agents')
      .update({ status: 'RESEARCHING', cycle_lock_at: new Date(now).toISOString() })
      .eq('id', this.agentId)
      .neq('status', 'DEAD')
      .or(`status.not.in.(RESEARCHING,EXECUTING),cycle_lock_at.is.null,cycle_lock_at.lt.${staleBefore}`)
      .select('id');
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  }

  async releaseCycleLock(status: Agent['status']): Promise<void> {
    await this.db.from('agents').update({ status, cycle_lock_at: null }).eq('id', this.agentId);
  }

  private mapAgent(r: any): Agent {
    return {
      id: r.id,
      name: r.name ?? 'SURVIVE-01',
      status: r.status,
      startedAt: Date.parse(r.started_at ?? r.created_at ?? new Date().toISOString()) || Date.now(),
      startingCapital: this.n(r.starting_capital),
      survivalThreshold: this.n(r.survival_threshold),
      currentStrategy: r.current_strategy ?? '',
      currentObjective: r.current_objective ?? '',
      cycleCount: r.cycle_count ?? 0,
      totalCyclesRun: r.total_cycles_run ?? 0,
    };
  }

  private agentPatch(p: Partial<Agent>) {
    const out: Record<string, unknown> = {};
    if (p.status !== undefined) out.status = p.status;
    if (p.currentStrategy !== undefined) out.current_strategy = p.currentStrategy;
    if (p.currentObjective !== undefined) out.current_objective = p.currentObjective;
    if (p.cycleCount !== undefined) out.cycle_count = p.cycleCount;
    if (p.totalCyclesRun !== undefined) out.total_cycles_run = p.totalCyclesRun;
    if (p.startingCapital !== undefined) out.starting_capital = p.startingCapital;
    if (p.survivalThreshold !== undefined) out.survival_threshold = p.survivalThreshold;
    if (p.startedAt !== undefined) out.started_at = new Date(p.startedAt).toISOString();
    return out;
  }

  /* ---------------------------- opportunities --------------------------- */

  async listOpportunities(): Promise<Opportunity[]> {
    const { data, error } = await this.db
      .from('opportunities')
      .select('*, research_sources(*)')
      .eq('agent_id', this.agentId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapOpportunity(r));
  }

  async listResearchedOpportunities(): Promise<Opportunity[]> {
    const all = await this.listOpportunities();
    return all.filter((o) => o.researchStage !== 'UNDISCOVERED');
  }

  async upsertOpportunities(opps: Opportunity[]): Promise<void> {
    if (opps.length === 0) return;
    const rows = opps.map((o) => this.opportunityRow(o));
    const { error } = await this.db
      .from('opportunities')
      .upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(error.message);

    // Sources: wipe & re-insert for affected opportunities (kept simple; sources
    // are append-mostly and small).
    const ids = opps.map((o) => o.id);
    await this.db.from('research_sources').delete().in('opportunity_id', ids);
    const sourceRows = opps.flatMap((o) =>
      o.sources.map((s) => ({
        id: s.id,
        opportunity_id: o.id,
        title: s.title,
        url: s.url ?? null,
        kind: s.kind,
        note: s.note ?? null,
        verified: false,
      })),
    );
    if (sourceRows.length) {
      const { error: se } = await this.db.from('research_sources').upsert(sourceRows, { onConflict: 'id' });
      if (se) throw new Error(se.message);
    }
  }

  private mapOpportunity(r: any): Opportunity {
    const factors = (r.score_factors ?? {}) as Record<string, unknown>;
    const score: ScoreBreakdown | undefined =
      r.score_total != null && factors.factors
        ? {
            total: r.score_total,
            factors: factors.factors as ScoreBreakdown['factors'],
            recommendation: (r.score_recommendation ?? factors.recommendation ?? 'WATCHLIST') as ScoreBreakdown['recommendation'],
            budgetFit: Boolean(factors.budgetFit),
            aiSuitable: Boolean(factors.aiSuitable),
            scoredAt: factors.scoredAt ? Number(factors.scoredAt) : Date.now(),
          }
        : undefined;

    return {
      id: r.id,
      name: r.name,
      category: r.category,
      tags: r.tags ?? [],
      dataSource: r.data_source,
      researchStage: r.research_stage,
      description: r.description,
      howMoneyMade: r.how_money_made,
      capitalRequiredMin: this.n(r.capital_required_min),
      capitalRequiredMax: this.n(r.capital_required_max),
      timeToRevenueDaysMin: r.time_to_revenue_days_min,
      timeToRevenueDaysMax: r.time_to_revenue_days_max,
      skills: r.skills ?? [],
      difficulty: r.difficulty,
      competition: r.competition,
      scalability: r.scalability,
      risk: r.risk,
      riskLevel: this.riskLevel(r.risk),
      geographicRelevance: r.geographic_relevance ?? [],
      evidenceTier: r.evidence_tier,
      evidenceNotes: r.evidence_notes ?? '',
      successProbability: this.n(r.success_probability),
      revenuePotentialMonthlyMin: this.n(r.revenue_potential_monthly_min),
      revenuePotentialMonthlyMax: this.n(r.revenue_potential_monthly_max),
      upsideNote: r.upside_note ?? '',
      downsideNote: r.downside_note ?? '',
      operatingCostsNote: r.operating_costs_note ?? '',
      examples: r.examples ?? [],
      sources: (r.research_sources ?? []).map((s: any) => ({
        id: s.id,
        title: s.title,
        url: s.url ?? undefined,
        kind: s.kind,
        note: s.note ?? undefined,
      })),
      dateResearched: r.date_researched ? Date.parse(r.date_researched) : null,
      executionBlocked: Boolean(r.execution_blocked),
      blockReason: r.block_reason ?? undefined,
      score,
      lifecycleState: (r.lifecycle_state ?? 'DISCOVERED') as Opportunity['lifecycleState'],
    };
  }

  private opportunityRow(o: Opportunity): Record<string, unknown> {
    return {
      id: o.id,
      agent_id: this.agentId,
      name: o.name,
      category: o.category,
      tags: o.tags,
      data_source: o.dataSource,
      research_stage: o.researchStage,
      description: o.description,
      how_money_made: o.howMoneyMade,
      capital_required_min: o.capitalRequiredMin,
      capital_required_max: o.capitalRequiredMax,
      time_to_revenue_days_min: o.timeToRevenueDaysMin,
      time_to_revenue_days_max: o.timeToRevenueDaysMax,
      skills: o.skills,
      difficulty: o.difficulty,
      competition: o.competition,
      scalability: o.scalability,
      risk: o.risk,
      geographic_relevance: o.geographicRelevance,
      evidence_tier: o.evidenceTier,
      evidence_notes: o.evidenceNotes,
      success_probability: o.successProbability,
      revenue_potential_monthly_min: o.revenuePotentialMonthlyMin,
      revenue_potential_monthly_max: o.revenuePotentialMonthlyMax,
      upside_note: o.upsideNote,
      downside_note: o.downsideNote,
      operating_costs_note: o.operatingCostsNote,
      examples: o.examples,
      execution_blocked: o.executionBlocked,
      block_reason: o.blockReason ?? null,
      score_total: o.score?.total ?? null,
      score_recommendation: o.score?.recommendation ?? null,
      score_factors: o.score
        ? { factors: o.score.factors, budgetFit: o.score.budgetFit, aiSuitable: o.score.aiSuitable, scoredAt: o.score.scoredAt }
        : {},
      date_researched: o.dateResearched ? new Date(o.dateResearched).toISOString() : null,
      lifecycle_state: o.lifecycleState ?? 'DISCOVERED',
    };
  }

  private riskLevel(risk: number): Opportunity['riskLevel'] {
    return (['Low', 'Low–Medium', 'Medium', 'Medium–High', 'High'] as const)[Math.max(0, risk - 1)];
  }

  /* ----------------------------- transactions --------------------------- */

  async listTransactions(): Promise<Transaction[]> {
    const { data, error } = await this.db
      .from('transactions')
      .select('*')
      .eq('agent_id', this.agentId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      type: r.type,
      amount: this.n(r.amount),
      description: r.description,
      relatedExperimentId: r.related_experiment_id ?? undefined,
      balanceAfter: this.n(r.balance_after),
      createdAt: Date.parse(r.created_at) || Date.now(),
    }));
  }

  async appendTransaction(tx: Transaction): Promise<void> {
    const { error } = await this.db.from('transactions').insert({
      id: tx.id,
      agent_id: this.agentId,
      type: tx.type,
      amount: tx.amount,
      description: tx.description,
      related_experiment_id: tx.relatedExperimentId ?? null,
      balance_after: tx.balanceAfter,
      created_at: new Date(tx.createdAt).toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  /* ------------------------------ experiments --------------------------- */

  async listExperiments(): Promise<Experiment[]> {
    const { data, error } = await this.db
      .from('experiments')
      .select('*, experiment_results(*)')
      .eq('agent_id', this.agentId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapExperiment(r));
  }

  async appendExperiment(exp: Experiment): Promise<void> {
    const { error } = await this.db.from('experiments').insert({
      id: exp.id,
      agent_id: this.agentId,
      cycle_id: exp.cycleId,
      opportunity_id: exp.opportunityId,
      objective: exp.objective,
      starting_budget: exp.startingBudget,
      planned_action: exp.plannedAction,
      expected_outcome: exp.expectedOutcome,
      simulated: true,
      status: 'COMPLETE',
      created_at: new Date(exp.createdAt).toISOString(),
    });
    if (error) throw new Error(error.message);

    const { error: re } = await this.db.from('experiment_results').insert({
      experiment_id: exp.id,
      outcome: exp.outcome,
      actual_cost: exp.actualCost,
      actual_revenue: exp.actualRevenue,
      profit_loss: exp.profitLoss,
      roi_pct: exp.roi,
      duration_days: exp.durationDays,
      lessons_learned: exp.lessonsLearned,
      evidence_note: exp.evidenceNote,
      created_at: new Date(exp.createdAt).toISOString(),
    });
    if (re) throw new Error(re.message);
  }

  private mapExperiment(r: any): Experiment {
    const res = r.experiment_results?.[0] ?? {};
    return {
      id: r.id,
      cycleId: r.cycle_id ?? null,
      opportunityId: r.opportunity_id,
      opportunityName: r.opportunity_name ?? '',
      category: r.category ?? 'Services',
      objective: r.objective ?? '',
      startingBudget: this.n(r.starting_budget),
      plannedAction: r.planned_action ?? '',
      expectedOutcome: r.expected_outcome ?? '',
      actualCost: this.n(res.actual_cost),
      actualRevenue: this.n(res.actual_revenue),
      profitLoss: this.n(res.profit_loss),
      roi: this.n(res.roi_pct),
      outcome: res.outcome ?? 'INCONCLUSIVE',
      durationDays: res.duration_days ?? 0,
      lessonsLearned: res.lessons_learned ?? [],
      evidenceNote: res.evidence_note ?? '',
      simulated: true,
      createdAt: Date.parse(r.created_at) || Date.now(),
    };
  }

  /* -------------------------------- memory ------------------------------ */

  async listMemory(): Promise<MemoryEntry[]> {
    const { data, error } = await this.db
      .from('agent_memory')
      .select('*')
      .eq('agent_id', this.agentId)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      kind: r.kind,
      refId: r.ref_id ?? undefined,
      title: r.title,
      tests: r.tests ?? 0,
      spent: this.n(r.spent),
      revenue: this.n(r.revenue),
      conclusion: r.conclusion,
      notes: r.notes ?? [],
      updatedAt: Date.parse(r.updated_at ?? r.created_at) || Date.now(),
    }));
  }

  async upsertMemory(mem: MemoryEntry): Promise<void> {
    const { error } = await this.db
      .from('agent_memory')
      .upsert(
        {
          id: mem.id,
          agent_id: this.agentId,
          kind: mem.kind,
          ref_type: mem.refId ? (mem.kind === 'category' ? 'category' : 'opportunity') : null,
          ref_id: mem.refId ?? null,
          title: mem.title,
          tests: mem.tests,
          spent: mem.spent,
          revenue: mem.revenue,
          conclusion: mem.conclusion,
          notes: mem.notes,
          updated_at: new Date(mem.updatedAt).toISOString(),
        },
        { onConflict: 'id' },
      );
    if (error) throw new Error(error.message);
  }

  /* -------------------------------- reports ----------------------------- */

  async listReports(): Promise<ResearchReport[]> {
    const { data, error } = await this.db
      .from('research_reports')
      .select('*')
      .eq('agent_id', this.agentId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      opportunityId: r.opportunity_id,
      opportunityName: r.opportunity_name ?? '',
      generatedAt: Date.parse(r.created_at) || Date.now(),
      generator: r.generator,
      executiveSummary: r.executive_summary,
      marketOpportunity: r.market_opportunity ?? '',
      howItWorks: r.how_it_works ?? '',
      capitalRequirements: r.capital_requirements ?? '',
      competition: r.competition ?? '',
      risks: r.risks ?? [],
      evidence: r.evidence ?? '',
      potentialRevenue: r.potential_revenue ?? '',
      recommendedExperiment: r.recommended_experiment ?? '',
      confidence: this.n(r.confidence),
      finalScore: r.final_score ?? 0,
      dataSource: r.data_source ?? 'SAMPLE',
    }));
  }

  async appendReport(report: ResearchReport): Promise<void> {
    const { error } = await this.db
      .from('research_reports')
      .upsert(
        {
          id: report.id,
          agent_id: this.agentId,
          opportunity_id: report.opportunityId,
          generator: report.generator,
          executive_summary: report.executiveSummary,
          market_opportunity: report.marketOpportunity,
          how_it_works: report.howItWorks,
          capital_requirements: report.capitalRequirements,
          competition: report.competition,
          risks: report.risks,
          evidence: report.evidence,
          potential_revenue: report.potentialRevenue,
          recommended_experiment: report.recommendedExperiment,
          confidence: report.confidence,
          final_score: report.finalScore,
          data_source: report.dataSource,
          created_at: new Date(report.generatedAt).toISOString(),
        },
        { onConflict: 'id' },
      );
    if (error) throw new Error(error.message);
  }

  /* ------------------------------ strategies ---------------------------- */

  async listStrategies(): Promise<Strategy[]> {
    const { data, error } = await this.db
      .from('strategies')
      .select('*')
      .eq('agent_id', this.agentId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      rationale: r.rationale ?? '',
      active: Boolean(r.active),
      createdAt: Date.parse(r.created_at) || Date.now(),
    }));
  }

  async appendStrategy(strategy: Strategy): Promise<void> {
    const { error } = await this.db.from('strategies').insert({
      id: strategy.id,
      agent_id: this.agentId,
      name: strategy.name,
      rationale: strategy.rationale,
      active: strategy.active,
      created_at: new Date(strategy.createdAt).toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  async deactivateStrategies(): Promise<void> {
    const { error } = await this.db
      .from('strategies')
      .update({ active: false })
      .eq('agent_id', this.agentId)
      .eq('active', true);
    if (error) throw new Error(error.message);
  }

  /* -------------------------------- events ------------------------------ */

  async listEvents(): Promise<AgentEvent[]> {
    const { data, error } = await this.db
      .from('agent_events')
      .select('*')
      .eq('agent_id', this.agentId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      type: r.type as EventType,
      message: r.message,
      createdAt: Date.parse(r.created_at) || Date.now(),
    }));
  }

  async appendEvent(event: AgentEvent): Promise<void> {
    const { error } = await this.db.from('agent_events').insert({
      id: event.id,
      agent_id: this.agentId,
      type: event.type,
      message: event.message,
      created_at: new Date(event.createdAt).toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  /* -------------------------------- cycles ------------------------------ */

  async listCycles(): Promise<AgentCycle[]> {
    const { data, error } = await this.db
      .from('agent_cycles')
      .select('*')
      .eq('agent_id', this.agentId)
      .order('started_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      index: r.cycle_index,
      startedAt: Date.parse(r.started_at) || Date.now(),
      completedAt: r.completed_at ? Date.parse(r.completed_at) : undefined,
      steps: (r.steps ?? []) as CycleStep[],
      discoveredIds: r.discovered_ids ?? [],
      selectedOpportunityId: r.selected_opportunity_id ?? undefined,
      experimentId: r.experiment_id ?? undefined,
      summary: r.summary ?? undefined,
    }));
  }

  async appendCycle(cycle: AgentCycle): Promise<void> {
    const { error } = await this.db.from('agent_cycles').insert({
      id: cycle.id,
      agent_id: this.agentId,
      cycle_index: cycle.index,
      steps: cycle.steps,
      discovered_ids: cycle.discoveredIds,
      selected_opportunity_id: cycle.selectedOpportunityId ?? null,
      experiment_id: cycle.experimentId ?? null,
      summary: cycle.summary ?? null,
      started_at: new Date(cycle.startedAt).toISOString(),
      completed_at: cycle.completedAt ? new Date(cycle.completedAt).toISOString() : null,
    });
    if (error) throw new Error(error.message);
  }

  async updateCycleStep(
    cycleId: string,
    step: CycleStepKey,
    status: 'active' | 'done' | 'skipped',
    at?: number,
  ): Promise<void> {
    const cycles = await this.listCycles();
    const cycle = cycles.find((c) => c.id === cycleId);
    if (!cycle) return;
    const steps = cycle.steps.map((s) =>
      s.key === step ? { ...s, status, at: status === 'done' ? at ?? Date.now() : s.at } : s,
    );
    const { error } = await this.db
      .from('agent_cycles')
      .update({ steps })
      .eq('id', cycleId);
    if (error) throw new Error(error.message);
  }

  async completeCycle(cycleId: string, patch: Partial<AgentCycle>): Promise<void> {
    const update: Record<string, unknown> = {};
    if (patch.completedAt !== undefined)
      update.completed_at = patch.completedAt ? new Date(patch.completedAt).toISOString() : null;
    if (patch.summary !== undefined) update.summary = patch.summary;
    if (patch.discoveredIds !== undefined) update.discovered_ids = patch.discoveredIds;
    if (patch.selectedOpportunityId !== undefined)
      update.selected_opportunity_id = patch.selectedOpportunityId ?? null;
    if (patch.experimentId !== undefined) update.experiment_id = patch.experimentId ?? null;
    const { error } = await this.db.from('agent_cycles').update(update).eq('id', cycleId);
    if (error) throw new Error(error.message);
  }

  /* -------------------------------- reset ------------------------------- */

  async reset({ seed = true }: { seed?: boolean } = {}): Promise<void> {
    for (const table of [
      'transactions',
      'experiment_results',
      'experiments',
      'agent_memory',
      'research_reports',
      'research_sources',
      'opportunities',
      'agent_events',
      'strategies',
      'agent_cycles',
      'opportunity_models',
      'opportunity_decisions',
      'agent_actions',
    ]) {
      await this.db.from(table).delete().eq('agent_id', this.agentId);
    }
    // Child tables without their own agent_id column: scope by prospect ids.
    const { data: prospectRows } = await this.db.from('prospects').select('id').eq('agent_id', this.agentId);
    const prospectIds = (prospectRows ?? []).map((r: any) => r.id);
    if (prospectIds.length) {
      await this.db.from('prospect_interactions').delete().in('prospect_id', prospectIds);
      await this.db.from('outreach_messages').delete().in('prospect_id', prospectIds);
      const { data: offerRows } = await this.db.from('offers').select('id').in('prospect_id', prospectIds);
      const offerIds = (offerRows ?? []).map((r: any) => r.id);
      if (offerIds.length) await this.db.from('design_briefs').delete().in('offer_id', offerIds);
      await this.db.from('projects').delete().in('prospect_id', prospectIds);
      await this.db.from('offers').delete().in('prospect_id', prospectIds);
    }
    await this.db.from('prospects').delete().eq('agent_id', this.agentId);
    await this.db.from('agents').delete().eq('id', this.agentId);
    if (seed) await seedSupabase(this.db, this.agentId);
  }

  /* --------------------------- business models --------------------------- */

  async listBusinessModels(): Promise<BusinessModel[]> {
    const { data, error } = await this.db.from('opportunity_models').select('*').eq('agent_id', this.agentId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapBusinessModel(r));
  }

  async upsertBusinessModel(model: BusinessModel): Promise<void> {
    const row = {
      id: model.id,
      agent_id: this.agentId,
      opportunity_id: model.opportunityId,
      opportunity_name: model.opportunityName,
      target_customer: model.targetCustomer,
      problem: model.problem,
      offer: model.offer,
      why_they_buy: model.whyTheyBuy,
      suggested_price: model.suggestedPrice,
      price_rationale: model.priceRationale,
      delivery_cost_estimate: model.deliveryCostEstimate,
      expected_gross_margin_pct: model.expectedGrossMarginPct,
      acquisition_channel: model.acquisitionChannel,
      sales_message: model.salesMessage,
      follow_up_sequence: model.followUpSequence,
      objection_handling: model.objectionHandling,
      delivery_workflow: model.deliveryWorkflow,
      time_to_first_sale_days_estimate: model.timeToFirstSaleDaysEstimate,
      upsells: model.upsells,
      recurring_revenue_note: model.recurringRevenueNote,
      expected_profit_first_deal: model.expectedProfitFirstDeal,
      can_scale: model.canScale,
      scale_note: model.scaleNote,
      next_action: model.nextAction,
      confidence: model.confidence,
      generator: model.generator,
      generated_at: new Date(model.generatedAt).toISOString(),
      updated_at: new Date(model.updatedAt).toISOString(),
    };
    const { error } = await this.db.from('opportunity_models').upsert(row, { onConflict: 'opportunity_id' });
    if (error) throw new Error(error.message);
  }

  private mapBusinessModel(r: any): BusinessModel {
    return {
      id: r.id,
      opportunityId: r.opportunity_id,
      opportunityName: r.opportunity_name ?? '',
      targetCustomer: r.target_customer,
      problem: r.problem,
      offer: r.offer,
      whyTheyBuy: r.why_they_buy,
      suggestedPrice: this.n(r.suggested_price),
      priceRationale: r.price_rationale,
      deliveryCostEstimate: this.n(r.delivery_cost_estimate),
      expectedGrossMarginPct: this.n(r.expected_gross_margin_pct),
      acquisitionChannel: r.acquisition_channel,
      salesMessage: r.sales_message,
      followUpSequence: r.follow_up_sequence ?? [],
      objectionHandling: r.objection_handling ?? [],
      deliveryWorkflow: r.delivery_workflow,
      timeToFirstSaleDaysEstimate: r.time_to_first_sale_days_estimate,
      upsells: r.upsells ?? [],
      recurringRevenueNote: r.recurring_revenue_note ?? '',
      expectedProfitFirstDeal: this.n(r.expected_profit_first_deal),
      canScale: Boolean(r.can_scale),
      scaleNote: r.scale_note ?? '',
      nextAction: r.next_action ?? '',
      confidence: this.n(r.confidence),
      generator: r.generator ?? 'local-rule-engine',
      generatedAt: Date.parse(r.generated_at),
      updatedAt: Date.parse(r.updated_at),
    };
  }

  /* ----------------------------- decisions -------------------------------- */

  async listDecisions(): Promise<OpportunityDecision[]> {
    const { data, error } = await this.db
      .from('opportunity_decisions')
      .select('*')
      .eq('agent_id', this.agentId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapDecision(r));
  }

  async appendDecision(decision: OpportunityDecision): Promise<void> {
    const { error } = await this.db.from('opportunity_decisions').insert({
      id: decision.id,
      agent_id: this.agentId,
      opportunity_id: decision.opportunityId,
      opportunity_name: decision.opportunityName,
      action: decision.action,
      previous_state: decision.previousState,
      new_state: decision.newState,
      reasoning: decision.reasoning,
      evidence_summary: decision.evidenceSummary,
      metrics: decision.metrics,
      next_action: decision.nextAction,
      created_at: new Date(decision.createdAt).toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  private mapDecision(r: any): OpportunityDecision {
    return {
      id: r.id,
      opportunityId: r.opportunity_id,
      opportunityName: r.opportunity_name ?? '',
      action: r.action,
      previousState: r.previous_state,
      newState: r.new_state,
      reasoning: r.reasoning,
      evidenceSummary: r.evidence_summary,
      metrics: r.metrics ?? { tests: 0, spent: 0, revenue: 0, realRevenueScore: 0 },
      nextAction: r.next_action ?? '',
      createdAt: Date.parse(r.created_at),
    };
  }

  /* ------------------------------- actions -------------------------------- */

  async listActions(): Promise<RecommendedAction[]> {
    const { data, error } = await this.db
      .from('agent_actions')
      .select('*')
      .eq('agent_id', this.agentId)
      .order('rank', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapAction(r));
  }

  async replaceActions(actions: RecommendedAction[]): Promise<void> {
    await this.db.from('agent_actions').delete().eq('agent_id', this.agentId);
    if (actions.length === 0) return;
    const rows = actions.map((a) => ({
      id: a.id,
      agent_id: this.agentId,
      kind: a.kind,
      opportunity_id: a.opportunityId ?? null,
      opportunity_name: a.opportunityName ?? null,
      prospect_id: a.prospectId ?? null,
      prospect_name: a.prospectName ?? null,
      title: a.title,
      description: a.description,
      expected_value: a.expectedValue,
      urgency: a.urgency,
      effort: a.effort,
      rank: a.rank,
      created_at: new Date(a.createdAt).toISOString(),
    }));
    const { error } = await this.db.from('agent_actions').insert(rows);
    if (error) throw new Error(error.message);
  }

  private mapAction(r: any): RecommendedAction {
    return {
      id: r.id,
      kind: r.kind,
      opportunityId: r.opportunity_id ?? undefined,
      opportunityName: r.opportunity_name ?? undefined,
      prospectId: r.prospect_id ?? undefined,
      prospectName: r.prospect_name ?? undefined,
      title: r.title,
      description: r.description,
      expectedValue: this.n(r.expected_value),
      urgency: r.urgency,
      effort: r.effort,
      rank: r.rank,
      createdAt: Date.parse(r.created_at),
    };
  }

  /* ------------------------------- prospects ------------------------------ */

  async listProspects(): Promise<Prospect[]> {
    const { data, error } = await this.db
      .from('prospects')
      .select('*, prospect_sources(*)')
      .eq('agent_id', this.agentId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapProspect(r));
  }

  async upsertProspects(prospects: Prospect[]): Promise<void> {
    if (prospects.length === 0) return;
    const rows = prospects.map((p) => this.prospectRow(p));
    const { error } = await this.db.from('prospects').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(error.message);

    const ids = prospects.map((p) => p.id);
    await this.db.from('prospect_sources').delete().in('prospect_id', ids);
    const sourceRows = prospects.flatMap((p) =>
      p.sources.map((s) => ({
        id: s.id,
        prospect_id: p.id,
        title: s.title,
        url: s.url ?? null,
        kind: s.kind,
        note: s.note ?? null,
      })),
    );
    if (sourceRows.length) {
      const { error: se } = await this.db.from('prospect_sources').upsert(sourceRows, { onConflict: 'id' });
      if (se) throw new Error(se.message);
    }
  }

  private prospectRow(p: Prospect): Record<string, unknown> {
    return {
      id: p.id,
      agent_id: this.agentId,
      opportunity_id: p.opportunityId,
      opportunity_name: p.opportunityName,
      business_name: p.businessName,
      category: p.category,
      location: p.location,
      website_presence: p.websitePresence,
      website_url: p.websiteUrl ?? null,
      social_links: p.socialLinks,
      contact_channel: p.contactChannel,
      contact_value: p.contactValue ?? null,
      evidence_notes: p.evidenceNotes,
      priority: p.priority,
      score: p.score,
      status: p.status,
      data_source: p.dataSource,
      date_discovered: new Date(p.dateDiscovered).toISOString(),
      last_contact_at: p.lastContactAt ? new Date(p.lastContactAt).toISOString() : null,
      next_follow_up_at: p.nextFollowUpAt ? new Date(p.nextFollowUpAt).toISOString() : null,
      messages_sent_count: p.messagesSentCount,
      responses_received_count: p.responsesReceivedCount,
      actual_revenue: p.actualRevenue,
      notes: p.notes,
      reason_lost: p.reasonLost ?? null,
      created_at: new Date(p.createdAt).toISOString(),
      updated_at: new Date(p.updatedAt).toISOString(),
    };
  }

  private mapProspect(r: any): Prospect {
    return {
      id: r.id,
      opportunityId: r.opportunity_id,
      opportunityName: r.opportunity_name ?? '',
      businessName: r.business_name,
      category: r.category ?? '',
      location: r.location ?? '',
      websitePresence: r.website_presence ?? 'UNKNOWN',
      websiteUrl: r.website_url ?? undefined,
      socialLinks: r.social_links ?? [],
      contactChannel: r.contact_channel ?? 'UNKNOWN',
      contactValue: r.contact_value ?? undefined,
      sources: (r.prospect_sources ?? []).map((s: any) => ({
        id: s.id,
        title: s.title,
        url: s.url ?? undefined,
        kind: s.kind,
        note: s.note ?? undefined,
      })),
      evidenceNotes: r.evidence_notes ?? '',
      priority: r.priority,
      score: r.score ?? { total: 0, factors: [], expectedDealValue: 0, expectedAcquisitionCost: 0, expectedProfit: 0, expectedTimeToRevenueDays: 0, probabilityOfClose: 0, expectedValue: 0, scoredAt: Date.now() },
      status: r.status,
      dataSource: r.data_source,
      dateDiscovered: Date.parse(r.date_discovered) || Date.now(),
      lastContactAt: r.last_contact_at ? Date.parse(r.last_contact_at) : undefined,
      nextFollowUpAt: r.next_follow_up_at ? Date.parse(r.next_follow_up_at) : undefined,
      messagesSentCount: r.messages_sent_count ?? 0,
      responsesReceivedCount: r.responses_received_count ?? 0,
      actualRevenue: this.n(r.actual_revenue),
      notes: r.notes ?? [],
      reasonLost: r.reason_lost ?? undefined,
      createdAt: Date.parse(r.created_at) || Date.now(),
      updatedAt: Date.parse(r.updated_at) || Date.now(),
    };
  }

  /* --------------------------- prospect interactions ----------------------- */

  async listProspectInteractions(): Promise<ProspectInteraction[]> {
    const { data: prospectRows, error: pe } = await this.db
      .from('prospects')
      .select('id')
      .eq('agent_id', this.agentId);
    if (pe) throw new Error(pe.message);
    const ids = (prospectRows ?? []).map((r: any) => r.id);
    if (!ids.length) return [];
    const { data, error } = await this.db
      .from('prospect_interactions')
      .select('*')
      .in('prospect_id', ids)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      prospectId: r.prospect_id,
      kind: r.kind,
      summary: r.summary,
      createdAt: Date.parse(r.created_at) || Date.now(),
    }));
  }

  async appendProspectInteraction(interaction: ProspectInteraction): Promise<void> {
    const { error } = await this.db.from('prospect_interactions').insert({
      id: interaction.id,
      prospect_id: interaction.prospectId,
      kind: interaction.kind,
      summary: interaction.summary,
      created_at: new Date(interaction.createdAt).toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  /* ----------------------------- outreach messages -------------------------- */

  async listOutreachMessages(): Promise<OutreachMessageSet[]> {
    const { data: prospectRows, error: pe } = await this.db
      .from('prospects')
      .select('id')
      .eq('agent_id', this.agentId);
    if (pe) throw new Error(pe.message);
    const ids = (prospectRows ?? []).map((r: any) => r.id);
    if (!ids.length) return [];
    const { data, error } = await this.db.from('outreach_messages').select('*').in('prospect_id', ids);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapOutreach(r));
  }

  async upsertOutreachMessages(set: OutreachMessageSet): Promise<void> {
    const row = {
      id: set.id,
      prospect_id: set.prospectId,
      opportunity_id: set.opportunityId,
      business_model_id: set.businessModelId ?? null,
      whatsapp: set.whatsapp,
      sms: set.sms,
      email: set.email,
      short_version: set.shortVersion,
      professional_version: set.professionalVersion,
      follow_up_1: set.followUp1,
      follow_up_2: set.followUp2,
      objection_responses: set.objectionResponses,
      price_explanation: set.priceExplanation,
      call_script: set.callScript,
      meeting_agenda: set.meetingAgenda,
      proposal_outline: set.proposalOutline,
      generator: set.generator,
      generated_at: new Date(set.generatedAt).toISOString(),
      updated_at: new Date(set.updatedAt).toISOString(),
    };
    const { error } = await this.db.from('outreach_messages').upsert(row, { onConflict: 'prospect_id' });
    if (error) throw new Error(error.message);
  }

  private mapOutreach(r: any): OutreachMessageSet {
    return {
      id: r.id,
      prospectId: r.prospect_id,
      opportunityId: r.opportunity_id,
      businessModelId: r.business_model_id ?? undefined,
      whatsapp: r.whatsapp,
      sms: r.sms,
      email: r.email ?? { subject: '', body: '' },
      shortVersion: r.short_version,
      professionalVersion: r.professional_version,
      followUp1: r.follow_up_1,
      followUp2: r.follow_up_2,
      objectionResponses: r.objection_responses ?? [],
      priceExplanation: r.price_explanation,
      callScript: r.call_script ?? [],
      meetingAgenda: r.meeting_agenda ?? [],
      proposalOutline: r.proposal_outline ?? [],
      generator: r.generator ?? 'local-rule-engine',
      generatedAt: Date.parse(r.generated_at) || Date.now(),
      updatedAt: Date.parse(r.updated_at) || Date.now(),
    };
  }

  /* --------------------------------- offers --------------------------------- */

  async listOffers(): Promise<Offer[]> {
    const { data: prospectRows, error: pe } = await this.db.from('prospects').select('id').eq('agent_id', this.agentId);
    if (pe) throw new Error(pe.message);
    const ids = (prospectRows ?? []).map((r: any) => r.id);
    if (!ids.length) return [];
    const { data, error } = await this.db.from('offers').select('*').in('prospect_id', ids);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapOffer(r));
  }

  async upsertOffer(offer: Offer): Promise<void> {
    const row = {
      id: offer.id,
      prospect_id: offer.prospectId,
      prospect_name: offer.prospectName,
      opportunity_id: offer.opportunityId,
      business_model_id: offer.businessModelId ?? null,
      price: offer.price,
      price_rationale: offer.priceRationale ?? null,
      timeline_days_min: offer.timelineDaysMin,
      timeline_days_max: offer.timelineDaysMax,
      deliverables: offer.deliverables,
      gap_analysis: offer.gapAnalysis ?? null,
      website_brief: offer.websiteBrief,
      status: offer.status,
      generator: offer.generator,
      generated_at: new Date(offer.generatedAt).toISOString(),
      updated_at: new Date(offer.updatedAt).toISOString(),
    };
    const { error } = await this.db.from('offers').upsert(row, { onConflict: 'prospect_id' });
    if (error) throw new Error(error.message);
  }

  async updateOfferStatus(offerId: string, status: Offer['status']): Promise<void> {
    const { error } = await this.db
      .from('offers')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', offerId);
    if (error) throw new Error(error.message);
  }

  private mapOffer(r: any): Offer {
    return {
      id: r.id,
      prospectId: r.prospect_id,
      prospectName: r.prospect_name ?? '',
      opportunityId: r.opportunity_id,
      businessModelId: r.business_model_id ?? undefined,
      price: this.n(r.price),
      priceRationale: r.price_rationale ?? undefined,
      timelineDaysMin: r.timeline_days_min,
      timelineDaysMax: r.timeline_days_max,
      deliverables: r.deliverables ?? [],
      gapAnalysis: r.gap_analysis ?? undefined,
      websiteBrief: r.website_brief as WebsiteBrief,
      status: r.status,
      generator: r.generator ?? 'local-rule-engine',
      generatedAt: Date.parse(r.generated_at) || Date.now(),
      updatedAt: Date.parse(r.updated_at) || Date.now(),
    };
  }

  /* ------------------------------ design briefs ------------------------------ */

  async listDesignBriefs(): Promise<DesignBrief[]> {
    const { data: prospectRows, error: pe } = await this.db.from('prospects').select('id').eq('agent_id', this.agentId);
    if (pe) throw new Error(pe.message);
    const ids = (prospectRows ?? []).map((r: any) => r.id);
    if (!ids.length) return [];
    const { data, error } = await this.db.from('design_briefs').select('*').in('prospect_id', ids);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapDesignBrief(r));
  }

  async upsertDesignBrief(brief: DesignBrief): Promise<void> {
    const row = {
      id: brief.id,
      offer_id: brief.offerId,
      prospect_id: brief.prospectId,
      homepage_concept: brief.homepageConcept,
      hero_section: brief.heroSection,
      logo_direction: brief.logoDirection,
      social_graphics: brief.socialGraphics,
      color_direction_note: brief.colorDirectionNote,
      asset_status: brief.assetStatus,
      generated_at: new Date(brief.generatedAt).toISOString(),
      updated_at: new Date(brief.updatedAt).toISOString(),
    };
    const { error } = await this.db.from('design_briefs').upsert(row, { onConflict: 'offer_id' });
    if (error) throw new Error(error.message);
  }

  private mapDesignBrief(r: any): DesignBrief {
    return {
      id: r.id,
      offerId: r.offer_id,
      prospectId: r.prospect_id,
      homepageConcept: r.homepage_concept,
      heroSection: r.hero_section,
      logoDirection: r.logo_direction,
      socialGraphics: r.social_graphics ?? [],
      colorDirectionNote: r.color_direction_note ?? '',
      assetStatus: r.asset_status ?? 'NOT_CONFIGURED',
      generatedAt: Date.parse(r.generated_at) || Date.now(),
      updatedAt: Date.parse(r.updated_at) || Date.now(),
    };
  }

  /* --------------------------------- projects --------------------------------- */

  async listProjects(): Promise<Project[]> {
    const { data: prospectRows, error: pe } = await this.db.from('prospects').select('id').eq('agent_id', this.agentId);
    if (pe) throw new Error(pe.message);
    const ids = (prospectRows ?? []).map((r: any) => r.id);
    if (!ids.length) return [];
    const { data, error } = await this.db.from('projects').select('*').in('prospect_id', ids);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapProject(r));
  }

  async upsertProject(project: Project): Promise<void> {
    const row = {
      id: project.id,
      prospect_id: project.prospectId,
      prospect_name: project.prospectName,
      offer_id: project.offerId,
      opportunity_id: project.opportunityId,
      agreed_price: project.agreedPrice,
      agreed_timeline_days_max: project.agreedTimelineDaysMax,
      milestones: project.milestones,
      status: project.status,
      started_at: new Date(project.startedAt).toISOString(),
      delivered_at: project.deliveredAt ? new Date(project.deliveredAt).toISOString() : null,
      updated_at: new Date(project.updatedAt).toISOString(),
    };
    const { error } = await this.db.from('projects').upsert(row, { onConflict: 'prospect_id' });
    if (error) throw new Error(error.message);
  }

  async advanceProjectMilestone(projectId: string, milestone: ProjectMilestoneKey): Promise<void> {
    const { data, error } = await this.db.from('projects').select('*').eq('id', projectId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return;
    const project = this.mapProject(data);
    const updated = advanceMilestone(project, milestone);
    const { error: ue } = await this.db
      .from('projects')
      .update({
        milestones: updated.milestones,
        status: updated.status,
        delivered_at: updated.deliveredAt ? new Date(updated.deliveredAt).toISOString() : null,
        updated_at: new Date(updated.updatedAt).toISOString(),
      })
      .eq('id', projectId);
    if (ue) throw new Error(ue.message);
  }

  private mapProject(r: any): Project {
    return {
      id: r.id,
      prospectId: r.prospect_id,
      prospectName: r.prospect_name ?? '',
      offerId: r.offer_id,
      opportunityId: r.opportunity_id,
      agreedPrice: this.n(r.agreed_price),
      agreedTimelineDaysMax: r.agreed_timeline_days_max,
      milestones: (r.milestones ?? []) as ProjectMilestone[],
      status: r.status,
      startedAt: Date.parse(r.started_at) || Date.now(),
      deliveredAt: r.delivered_at ? Date.parse(r.delivered_at) : undefined,
      updatedAt: Date.parse(r.updated_at) || Date.now(),
      satisfaction: r.satisfaction ?? undefined,
      repeatPurchase: r.repeat_purchase ?? undefined,
      referral: r.referral ?? undefined,
    };
  }

  /* ------------------------------ CRM write path ------------------------------ */

  async updateProspectStatus(prospectId: string, status: Prospect['status'], reasonLost?: string): Promise<void> {
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (reasonLost !== undefined) patch.reason_lost = reasonLost;
    const { error } = await this.db.from('prospects').update(patch).eq('id', prospectId);
    if (error) throw new Error(error.message);
  }

  /* --------------------------- real revenue ledger --------------------------- */

  async listRealRevenue(): Promise<RealRevenueEntry[]> {
    const { data: oppRows, error: oe } = await this.db.from('opportunities').select('id').eq('agent_id', this.agentId);
    if (oe) throw new Error(oe.message);
    const ids = (oppRows ?? []).map((r: any) => r.id);
    if (!ids.length) return [];
    const { data, error } = await this.db.from('real_revenue').select('*').in('opportunity_id', ids).order('date', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapRealRevenue(r));
  }

  async addRealRevenueEntry(entry: RealRevenueEntry): Promise<void> {
    // Append-only: always an insert, never an upsert/update.
    const row = {
      id: entry.id,
      date: new Date(entry.date).toISOString(),
      opportunity_id: entry.opportunityId,
      opportunity_name: entry.opportunityName,
      prospect_id: entry.prospectId,
      prospect_name: entry.prospectName,
      project_id: entry.projectId,
      product_service: entry.productService,
      quoted_price: entry.quotedPrice,
      amount_received: entry.amountReceived,
      costs: entry.costs,
      profit: entry.profit,
      currency: entry.currency,
      payment_method: entry.paymentMethod,
      acquisition_channel: entry.acquisitionChannel,
      days_from_discovery_to_payment: entry.daysFromDiscoveryToPayment,
      notes: entry.notes ?? null,
      created_at: new Date(entry.createdAt).toISOString(),
    };
    const { error } = await this.db.from('real_revenue').insert(row);
    if (error) throw new Error(error.message);
  }

  private mapRealRevenue(r: any): RealRevenueEntry {
    return {
      id: r.id,
      date: Date.parse(r.date) || Date.now(),
      opportunityId: r.opportunity_id,
      opportunityName: r.opportunity_name ?? '',
      prospectId: r.prospect_id,
      prospectName: r.prospect_name ?? '',
      projectId: r.project_id,
      productService: r.product_service,
      quotedPrice: this.n(r.quoted_price),
      amountReceived: this.n(r.amount_received),
      costs: this.n(r.costs),
      profit: this.n(r.profit),
      currency: r.currency,
      paymentMethod: r.payment_method,
      acquisitionChannel: r.acquisition_channel,
      daysFromDiscoveryToPayment: r.days_from_discovery_to_payment,
      notes: r.notes ?? undefined,
      createdAt: Date.parse(r.created_at) || Date.now(),
    };
  }

  /* ----------------------------- learning events ------------------------------ */

  async listLearningEvents(): Promise<LearningEvent[]> {
    const { data: oppRows, error: oe } = await this.db.from('opportunities').select('id').eq('agent_id', this.agentId);
    if (oe) throw new Error(oe.message);
    const ids = (oppRows ?? []).map((r: any) => r.id);
    if (!ids.length) return [];
    const { data, error } = await this.db.from('learning_events').select('*').in('opportunity_id', ids).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapLearningEvent(r));
  }

  async appendLearningEvent(event: LearningEvent): Promise<void> {
    const row = {
      id: event.id,
      kind: event.kind,
      opportunity_id: event.opportunityId,
      category: event.category,
      ref_id: event.refId,
      summary: event.summary,
      predicted_value: event.predictedValue ?? null,
      actual_value: event.actualValue ?? null,
      delta_pct: event.deltaPct ?? null,
      created_at: new Date(event.createdAt).toISOString(),
    };
    const { error } = await this.db.from('learning_events').insert(row);
    if (error) throw new Error(error.message);
  }

  private mapLearningEvent(r: any): LearningEvent {
    return {
      id: r.id,
      kind: r.kind,
      opportunityId: r.opportunity_id,
      category: r.category,
      refId: r.ref_id,
      summary: r.summary,
      predictedValue: r.predicted_value ?? undefined,
      actualValue: r.actual_value ?? undefined,
      deltaPct: r.delta_pct ?? undefined,
      createdAt: Date.parse(r.created_at) || Date.now(),
    };
  }

  /* --------------------------- project outcome tracking ------------------------ */

  async updateProjectOutcome(
    projectId: string,
    outcome: { satisfaction?: number; repeatPurchase?: boolean; referral?: boolean },
  ): Promise<void> {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (outcome.satisfaction !== undefined) patch.satisfaction = outcome.satisfaction;
    if (outcome.repeatPurchase !== undefined) patch.repeat_purchase = outcome.repeatPurchase;
    if (outcome.referral !== undefined) patch.referral = outcome.referral;
    const { error } = await this.db.from('projects').update(patch).eq('id', projectId);
    if (error) throw new Error(error.message);
  }

  /* --------------------------- prospect intelligence -------------------------- */

  async listProspectIntelligence(): Promise<ProspectIntelligence[]> {
    const { data: prospectRows, error: pe } = await this.db.from('prospects').select('id').eq('agent_id', this.agentId);
    if (pe) throw new Error(pe.message);
    const ids = (prospectRows ?? []).map((r: any) => r.id);
    if (!ids.length) return [];
    const { data, error } = await this.db.from('prospect_intelligence').select('*').in('prospect_id', ids);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapProspectIntelligence(r));
  }

  async upsertProspectIntelligence(intel: ProspectIntelligence): Promise<void> {
    const row = {
      id: intel.id,
      prospect_id: intel.prospectId,
      business_overview: intel.businessOverview,
      apparent_services: intel.apparentServices,
      social_presence_summary: intel.socialPresenceSummary,
      competitive_note: intel.competitiveNote,
      specific_problem_evidence: intel.specificProblemEvidence,
      recommended_angle: intel.recommendedAngle,
      confidence: intel.confidence,
      generator: intel.generator,
      sources: intel.sources,
      generated_at: new Date(intel.generatedAt).toISOString(),
      updated_at: new Date(intel.updatedAt).toISOString(),
    };
    const { error } = await this.db.from('prospect_intelligence').upsert(row, { onConflict: 'prospect_id' });
    if (error) throw new Error(error.message);
  }

  private mapProspectIntelligence(r: any): ProspectIntelligence {
    return {
      id: r.id,
      prospectId: r.prospect_id,
      businessOverview: r.business_overview,
      apparentServices: (r.apparent_services ?? []) as string[],
      socialPresenceSummary: r.social_presence_summary,
      competitiveNote: r.competitive_note,
      specificProblemEvidence: r.specific_problem_evidence,
      recommendedAngle: r.recommended_angle,
      confidence: r.confidence as IntelligenceConfidence,
      generator: r.generator,
      sources: (r.sources ?? []) as ProspectIntelligence['sources'],
      generatedAt: Date.parse(r.generated_at) || Date.now(),
      updatedAt: Date.parse(r.updated_at) || Date.now(),
    };
  }

  /* -------------------------------- prospect demos ------------------------------ */

  async listProspectDemos(): Promise<ProspectDemo[]> {
    const { data: prospectRows, error: pe } = await this.db.from('prospects').select('id').eq('agent_id', this.agentId);
    if (pe) throw new Error(pe.message);
    const ids = (prospectRows ?? []).map((r: any) => r.id);
    if (!ids.length) return [];
    const { data, error } = await this.db.from('prospect_demos').select('*').in('prospect_id', ids);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapProspectDemo(r));
  }

  async upsertProspectDemo(demo: ProspectDemo): Promise<void> {
    const row = {
      id: demo.id,
      prospect_id: demo.prospectId,
      offer_id: demo.offerId,
      business_name: demo.businessName,
      html: demo.html,
      hero_headline: demo.heroHeadline,
      sections_included: demo.sectionsIncluded,
      generator: demo.generator,
      generated_at: new Date(demo.generatedAt).toISOString(),
      updated_at: new Date(demo.updatedAt).toISOString(),
    };
    const { error } = await this.db.from('prospect_demos').upsert(row, { onConflict: 'prospect_id' });
    if (error) throw new Error(error.message);
  }

  private mapProspectDemo(r: any): ProspectDemo {
    return {
      id: r.id,
      prospectId: r.prospect_id,
      offerId: r.offer_id,
      businessName: r.business_name,
      html: r.html,
      heroHeadline: r.hero_headline,
      sectionsIncluded: (r.sections_included ?? []) as string[],
      generator: r.generator,
      generatedAt: Date.parse(r.generated_at) || Date.now(),
      updatedAt: Date.parse(r.updated_at) || Date.now(),
    };
  }

  /* -------------------------------- market pricing ------------------------------ */

  async listMarketPriceResearch(): Promise<MarketPriceResearch[]> {
    const { data: oppRows, error: oe } = await this.db.from('opportunities').select('id').eq('agent_id', this.agentId);
    if (oe) throw new Error(oe.message);
    const ids = (oppRows ?? []).map((r: any) => r.id);
    if (!ids.length) return [];
    const { data, error } = await this.db.from('market_price_research').select('*').in('opportunity_id', ids);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => this.mapMarketPriceResearch(r));
  }

  async upsertMarketPriceResearch(research: MarketPriceResearch): Promise<void> {
    const row = {
      id: research.id,
      opportunity_id: research.opportunityId,
      service: research.service,
      region: research.region,
      price_min: research.priceMin,
      price_max: research.priceMax,
      currency: research.currency,
      rationale: research.rationale,
      confidence: research.confidence,
      generator: research.generator,
      sources: research.sources,
      generated_at: new Date(research.generatedAt).toISOString(),
      updated_at: new Date(research.updatedAt).toISOString(),
    };
    const { error } = await this.db.from('market_price_research').upsert(row, { onConflict: 'opportunity_id' });
    if (error) throw new Error(error.message);
  }

  private mapMarketPriceResearch(r: any): MarketPriceResearch {
    return {
      id: r.id,
      opportunityId: r.opportunity_id,
      service: r.service,
      region: r.region,
      priceMin: this.n(r.price_min),
      priceMax: this.n(r.price_max),
      currency: r.currency,
      rationale: r.rationale,
      confidence: r.confidence,
      generator: r.generator,
      sources: (r.sources ?? []) as MarketPriceResearch['sources'],
      generatedAt: Date.parse(r.generated_at) || Date.now(),
      updatedAt: Date.parse(r.updated_at) || Date.now(),
    };
  }
}

/* ---------------------------- first-run seeding --------------------------- */

export async function seedSupabase(
  db: SupabaseClientLike,
  agentId: string = AGENT_ID,
): Promise<void> {
  const snap = createSeedSnapshot();
  const repo = new SupabaseRepository(db, agentId);

  // Insert agent with the service-role-friendly defaults.
  await db.from('agents').upsert({
    id: snap.agent.id,
    name: snap.agent.name,
    status: 'ALIVE',
    starting_capital: snap.agent.startingCapital,
    survival_threshold: snap.agent.survivalThreshold,
    current_strategy: snap.agent.currentStrategy,
    current_objective: snap.agent.currentObjective,
    cycle_count: 0,
    total_cycles_run: 0,
    real_money_enabled: false,
    daily_spend_limit: 0,
    created_at: new Date(snap.agent.startedAt).toISOString(),
  });

  await repo.upsertOpportunities(snap.opportunities);
  for (const tx of snap.transactions) await repo.appendTransaction(tx);
  for (const evt of snap.events) await repo.appendEvent(evt);
  for (const strat of snap.strategies) await repo.appendStrategy(strat);
}
