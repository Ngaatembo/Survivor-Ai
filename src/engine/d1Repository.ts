/* ============================================================================
 * D1Repository — durable SQLite (Cloudflare D1) persistence behind the same
 * EngineRepository interface used by SupabaseRepository.
 *
 * D1 has no client-side query builder like supabase-js — everything here is
 * raw SQL via db.prepare(...).bind(...). Differences from SupabaseRepository
 * worth knowing when reading this file:
 *   - text[] / jsonb columns are stored as TEXT holding JSON; encode on
 *     write (JSON.stringify), decode on read (JSON.parse) via j()/a() below.
 *   - booleans are stored as INTEGER 0/1; encode with b(), decode with
 *     Boolean(v).
 *   - there's no `.select('*, child(*)')` join sugar, so listOpportunities()
 *     and listExperiments() do a second query per parent and stitch results
 *     in memory (grouped by parent id) rather than N+1 per row.
 *   - reset() and upsertOpportunities() batch their statements with
 *     db.batch() for one round-trip instead of sequential awaits.
 * ========================================================================== */

import type {
  Agent,
  AgentCycle,
  AgentEvent,
  CycleStep,
  CycleStepKey,
  EventType,
  Experiment,
  MemoryEntry,
  Opportunity,
  ResearchReport,
  Strategy,
  Transaction,
  ScoreBreakdown,
} from '../types';
import type { EngineRepository } from './repository';
import { createSeedSnapshot, AGENT_ID } from './seed';

/* Minimal structural subset of Cloudflare's D1Database/D1PreparedStatement,
 * declared locally (same pattern as SupabaseClientLike in supabaseRepository)
 * so this file type-checks under the root tsconfig (browser build, no
 * @cloudflare/workers-types) as well as worker/tsconfig.json, which passes
 * the real D1Database binding in at runtime — it satisfies this shape. */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<unknown>;
  all<T = any>(): Promise<{ results: T[] }>;
  first<T = any>(): Promise<T | null>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
}

export class D1Repository implements EngineRepository {
  constructor(
    private db: D1DatabaseLike,
    private agentId: string = AGENT_ID,
  ) {}

  private n(v: unknown): number {
    if (v === null || v === undefined) return 0;
    const num = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(num) ? num : 0;
  }

  /** Encode an array/object column to its JSON-TEXT storage form. */
  private j(v: unknown): string {
    return JSON.stringify(v ?? (Array.isArray(v) ? [] : {}));
  }

  /** Decode a JSON-TEXT column back to an array, defaulting to []. */
  private a<T = unknown>(v: unknown): T[] {
    if (!v) return [];
    try {
      const parsed = JSON.parse(String(v));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Decode a JSON-TEXT column back to an object, defaulting to {}. */
  private o<T = Record<string, unknown>>(v: unknown): T {
    if (!v) return {} as T;
    try {
      return JSON.parse(String(v)) as T;
    } catch {
      return {} as T;
    }
  }

  private b(v: boolean | undefined | null): number {
    return v ? 1 : 0;
  }

  private iso(ms: number): string {
    return new Date(ms).toISOString();
  }

  private ms(iso: unknown): number {
    return iso ? Date.parse(String(iso)) || Date.now() : Date.now();
  }

  /* ------------------------------- agent -------------------------------- */

  async getAgent(): Promise<Agent> {
    const row = await this.db
      .prepare('SELECT * FROM agents WHERE id = ?')
      .bind(this.agentId)
      .first();
    if (!row) throw new Error('agent not found');
    return this.mapAgent(row);
  }

  async updateAgent(patch: Partial<Agent>): Promise<Agent> {
    const fields = this.agentPatch(patch);
    const keys = Object.keys(fields);
    if (keys.length === 0) return this.getAgent();
    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    await this.db
      .prepare(`UPDATE agents SET ${setClause} WHERE id = ?`)
      .bind(...keys.map((k) => fields[k]), this.agentId)
      .run();
    return this.getAgent();
  }

  private mapAgent(r: any): Agent {
    return {
      id: r.id,
      name: r.name ?? 'SURVIVE-01',
      status: r.status,
      startedAt: this.ms(r.started_at ?? r.created_at),
      startingCapital: this.n(r.starting_capital),
      survivalThreshold: this.n(r.survival_threshold),
      currentStrategy: r.current_strategy ?? '',
      currentObjective: r.current_objective ?? '',
      cycleCount: r.cycle_count ?? 0,
      totalCyclesRun: r.total_cycles_run ?? 0,
    };
  }

  private agentPatch(p: Partial<Agent>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (p.status !== undefined) out.status = p.status;
    if (p.currentStrategy !== undefined) out.current_strategy = p.currentStrategy;
    if (p.currentObjective !== undefined) out.current_objective = p.currentObjective;
    if (p.cycleCount !== undefined) out.cycle_count = p.cycleCount;
    if (p.totalCyclesRun !== undefined) out.total_cycles_run = p.totalCyclesRun;
    if (p.startingCapital !== undefined) out.starting_capital = p.startingCapital;
    if (p.survivalThreshold !== undefined) out.survival_threshold = p.survivalThreshold;
    if (p.startedAt !== undefined) out.created_at = this.iso(p.startedAt);
    return out;
  }

  /* ---------------------------- opportunities --------------------------- */

  async listOpportunities(): Promise<Opportunity[]> {
    const { results: opps } = await this.db
      .prepare('SELECT * FROM opportunities WHERE agent_id = ? ORDER BY created_at ASC')
      .bind(this.agentId)
      .all();
    if (!opps.length) return [];

    const ids = opps.map((o: any) => o.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results: sources } = await this.db
      .prepare(`SELECT * FROM research_sources WHERE opportunity_id IN (${placeholders})`)
      .bind(...ids)
      .all();

    const sourcesByOpp = new Map<string, any[]>();
    for (const s of sources) {
      const list = sourcesByOpp.get(s.opportunity_id as string) ?? [];
      list.push(s);
      sourcesByOpp.set(s.opportunity_id as string, list);
    }

    return opps.map((r: any) => this.mapOpportunity(r, sourcesByOpp.get(r.id) ?? []));
  }

  async listResearchedOpportunities(): Promise<Opportunity[]> {
    const all = await this.listOpportunities();
    return all.filter((o) => o.researchStage !== 'UNDISCOVERED');
  }

  async upsertOpportunities(opps: Opportunity[]): Promise<void> {
    if (opps.length === 0) return;

    const stmts = opps.map((o) => {
      const row = this.opportunityRow(o);
      const cols = Object.keys(row);
      const placeholders = cols.map(() => '?').join(', ');
      const updateClause = cols
        .filter((c) => c !== 'id')
        .map((c) => `${c} = excluded.${c}`)
        .join(', ');
      return this.db
        .prepare(
          `INSERT INTO opportunities (${cols.join(', ')}) VALUES (${placeholders})
           ON CONFLICT(id) DO UPDATE SET ${updateClause}`,
        )
        .bind(...cols.map((c) => row[c]));
    });
    await this.db.batch(stmts);

    // Sources: wipe & re-insert for affected opportunities (kept simple; sources
    // are append-mostly and small) — same approach as SupabaseRepository.
    const ids = opps.map((o) => o.id);
    const placeholders = ids.map(() => '?').join(',');
    const deleteStmt = this.db
      .prepare(`DELETE FROM research_sources WHERE opportunity_id IN (${placeholders})`)
      .bind(...ids);

    const sourceStmts = opps.flatMap((o) =>
      o.sources.map((s) =>
        this.db
          .prepare(
            `INSERT INTO research_sources (id, opportunity_id, title, url, kind, note, verified)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               opportunity_id = excluded.opportunity_id, title = excluded.title,
               url = excluded.url, kind = excluded.kind, note = excluded.note,
               verified = excluded.verified`,
          )
          .bind(s.id, o.id, s.title, s.url ?? null, s.kind, s.note ?? null, 0),
      ),
    );

    await this.db.batch([deleteStmt, ...sourceStmts]);
  }

  private mapOpportunity(r: any, sourceRows: any[]): Opportunity {
    const factors = this.o<Record<string, unknown>>(r.score_factors);
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
      tags: this.a<string>(r.tags),
      dataSource: r.data_source,
      researchStage: r.research_stage,
      description: r.description,
      howMoneyMade: r.how_money_made,
      capitalRequiredMin: this.n(r.capital_required_min),
      capitalRequiredMax: this.n(r.capital_required_max),
      timeToRevenueDaysMin: r.time_to_revenue_days_min,
      timeToRevenueDaysMax: r.time_to_revenue_days_max,
      skills: this.a<string>(r.skills),
      difficulty: r.difficulty,
      competition: r.competition,
      scalability: r.scalability,
      risk: r.risk,
      riskLevel: this.riskLevel(r.risk),
      geographicRelevance: this.a<string>(r.geographic_relevance),
      evidenceTier: r.evidence_tier,
      evidenceNotes: r.evidence_notes ?? '',
      successProbability: this.n(r.success_probability),
      revenuePotentialMonthlyMin: this.n(r.revenue_potential_monthly_min),
      revenuePotentialMonthlyMax: this.n(r.revenue_potential_monthly_max),
      upsideNote: r.upside_note ?? '',
      downsideNote: r.downside_note ?? '',
      operatingCostsNote: r.operating_costs_note ?? '',
      examples: this.a<string>(r.examples),
      sources: sourceRows.map((s: any) => ({
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
    };
  }

  private opportunityRow(o: Opportunity): Record<string, unknown> {
    return {
      id: o.id,
      agent_id: this.agentId,
      name: o.name,
      category: o.category,
      tags: this.j(o.tags),
      data_source: o.dataSource,
      research_stage: o.researchStage,
      description: o.description,
      how_money_made: o.howMoneyMade,
      capital_required_min: o.capitalRequiredMin,
      capital_required_max: o.capitalRequiredMax,
      time_to_revenue_days_min: o.timeToRevenueDaysMin,
      time_to_revenue_days_max: o.timeToRevenueDaysMax,
      skills: this.j(o.skills),
      difficulty: o.difficulty,
      competition: o.competition,
      scalability: o.scalability,
      risk: o.risk,
      geographic_relevance: this.j(o.geographicRelevance),
      evidence_tier: o.evidenceTier,
      evidence_notes: o.evidenceNotes,
      success_probability: o.successProbability,
      revenue_potential_monthly_min: o.revenuePotentialMonthlyMin,
      revenue_potential_monthly_max: o.revenuePotentialMonthlyMax,
      upside_note: o.upsideNote,
      downside_note: o.downsideNote,
      operating_costs_note: o.operatingCostsNote,
      examples: this.j(o.examples),
      execution_blocked: this.b(o.executionBlocked),
      block_reason: o.blockReason ?? null,
      score_total: o.score?.total ?? null,
      score_recommendation: o.score?.recommendation ?? null,
      score_factors: o.score
        ? this.j({ factors: o.score.factors, budgetFit: o.score.budgetFit, aiSuitable: o.score.aiSuitable, scoredAt: o.score.scoredAt })
        : '{}',
      date_researched: o.dateResearched ? this.iso(o.dateResearched) : null,
    };
  }

  private riskLevel(risk: number): Opportunity['riskLevel'] {
    return (['Low', 'Low–Medium', 'Medium', 'Medium–High', 'High'] as const)[Math.max(0, risk - 1)];
  }

  /* ----------------------------- transactions --------------------------- */

  async listTransactions(): Promise<Transaction[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM transactions WHERE agent_id = ? ORDER BY created_at ASC')
      .bind(this.agentId)
      .all();
    return results.map((r: any) => ({
      id: r.id,
      type: r.type,
      amount: this.n(r.amount),
      description: r.description,
      relatedExperimentId: r.related_experiment_id ?? undefined,
      balanceAfter: this.n(r.balance_after),
      createdAt: this.ms(r.created_at),
    }));
  }

  async appendTransaction(tx: Transaction): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO transactions (id, agent_id, type, amount, description, related_experiment_id, balance_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        tx.id,
        this.agentId,
        tx.type,
        tx.amount,
        tx.description,
        tx.relatedExperimentId ?? null,
        tx.balanceAfter,
        this.iso(tx.createdAt),
      )
      .run();
  }

  /* ------------------------------ experiments --------------------------- */

  async listExperiments(): Promise<Experiment[]> {
    const { results: exps } = await this.db
      .prepare('SELECT * FROM experiments WHERE agent_id = ? ORDER BY created_at DESC')
      .bind(this.agentId)
      .all();
    if (!exps.length) return [];

    const ids = exps.map((e: any) => e.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results: resultRows } = await this.db
      .prepare(`SELECT * FROM experiment_results WHERE experiment_id IN (${placeholders})`)
      .bind(...ids)
      .all();
    const resultsByExp = new Map<string, any>();
    for (const res of resultRows) resultsByExp.set(res.experiment_id as string, res);

    return exps.map((r: any) => this.mapExperiment(r, resultsByExp.get(r.id) ?? {}));
  }

  async appendExperiment(exp: Experiment): Promise<void> {
    const insertExp = this.db
      .prepare(
        `INSERT INTO experiments
           (id, agent_id, cycle_id, opportunity_id, opportunity_name, category, objective,
            starting_budget, planned_action, expected_outcome, simulated, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        exp.id,
        this.agentId,
        exp.cycleId,
        exp.opportunityId,
        exp.opportunityName,
        exp.category,
        exp.objective,
        exp.startingBudget,
        exp.plannedAction,
        exp.expectedOutcome,
        1,
        'COMPLETE',
        this.iso(exp.createdAt),
      );

    const insertResult = this.db
      .prepare(
        `INSERT INTO experiment_results
           (id, experiment_id, outcome, actual_cost, actual_revenue, profit_loss, roi_pct,
            duration_days, lessons_learned, evidence_note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `${exp.id}-result`,
        exp.id,
        exp.outcome,
        exp.actualCost,
        exp.actualRevenue,
        exp.profitLoss,
        exp.roi,
        exp.durationDays,
        this.j(exp.lessonsLearned),
        exp.evidenceNote,
        this.iso(exp.createdAt),
      );

    await this.db.batch([insertExp, insertResult]);
  }

  private mapExperiment(r: any, res: any): Experiment {
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
      lessonsLearned: this.a<string>(res.lessons_learned),
      evidenceNote: res.evidence_note ?? '',
      simulated: true,
      createdAt: this.ms(r.created_at),
    };
  }

  /* -------------------------------- memory ------------------------------ */

  async listMemory(): Promise<MemoryEntry[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM agent_memory WHERE agent_id = ? ORDER BY updated_at DESC')
      .bind(this.agentId)
      .all();
    return results.map((r: any) => ({
      id: r.id,
      kind: r.kind,
      refId: r.ref_id ?? undefined,
      title: r.title,
      tests: r.tests ?? 0,
      spent: this.n(r.spent),
      revenue: this.n(r.revenue),
      conclusion: r.conclusion,
      notes: this.a<string>(r.notes),
      updatedAt: this.ms(r.updated_at ?? r.created_at),
    }));
  }

  async upsertMemory(mem: MemoryEntry): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO agent_memory (id, agent_id, kind, ref_type, ref_id, title, tests, spent, revenue, conclusion, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind, ref_type = excluded.ref_type, ref_id = excluded.ref_id,
           title = excluded.title, tests = excluded.tests, spent = excluded.spent,
           revenue = excluded.revenue, conclusion = excluded.conclusion,
           notes = excluded.notes, updated_at = excluded.updated_at`,
      )
      .bind(
        mem.id,
        this.agentId,
        mem.kind,
        mem.refId ? (mem.kind === 'category' ? 'category' : 'opportunity') : null,
        mem.refId ?? null,
        mem.title,
        mem.tests,
        mem.spent,
        mem.revenue,
        mem.conclusion,
        this.j(mem.notes),
        this.iso(mem.updatedAt),
      )
      .run();
  }

  /* -------------------------------- reports ----------------------------- */

  async listReports(): Promise<ResearchReport[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM research_reports WHERE agent_id = ? ORDER BY created_at DESC')
      .bind(this.agentId)
      .all();
    return results.map((r: any) => ({
      id: r.id,
      opportunityId: r.opportunity_id,
      opportunityName: r.opportunity_name ?? '',
      generatedAt: this.ms(r.created_at),
      generator: r.generator,
      executiveSummary: r.executive_summary,
      marketOpportunity: r.market_opportunity ?? '',
      howItWorks: r.how_it_works ?? '',
      capitalRequirements: r.capital_requirements ?? '',
      competition: r.competition ?? '',
      risks: this.a<string>(r.risks),
      evidence: r.evidence ?? '',
      potentialRevenue: r.potential_revenue ?? '',
      recommendedExperiment: r.recommended_experiment ?? '',
      confidence: this.n(r.confidence),
      finalScore: r.final_score ?? 0,
      dataSource: r.data_source ?? 'SAMPLE',
    }));
  }

  async appendReport(report: ResearchReport): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO research_reports
           (id, agent_id, opportunity_id, opportunity_name, generator, executive_summary,
            market_opportunity, how_it_works, capital_requirements, competition, risks,
            evidence, potential_revenue, recommended_experiment, confidence, final_score,
            data_source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           opportunity_id = excluded.opportunity_id, opportunity_name = excluded.opportunity_name,
           generator = excluded.generator, executive_summary = excluded.executive_summary,
           market_opportunity = excluded.market_opportunity, how_it_works = excluded.how_it_works,
           capital_requirements = excluded.capital_requirements, competition = excluded.competition,
           risks = excluded.risks, evidence = excluded.evidence,
           potential_revenue = excluded.potential_revenue,
           recommended_experiment = excluded.recommended_experiment,
           confidence = excluded.confidence, final_score = excluded.final_score,
           data_source = excluded.data_source, created_at = excluded.created_at`,
      )
      .bind(
        report.id,
        this.agentId,
        report.opportunityId,
        report.opportunityName,
        report.generator,
        report.executiveSummary,
        report.marketOpportunity,
        report.howItWorks,
        report.capitalRequirements,
        report.competition,
        this.j(report.risks),
        report.evidence,
        report.potentialRevenue,
        report.recommendedExperiment,
        report.confidence,
        report.finalScore,
        report.dataSource,
        this.iso(report.generatedAt),
      )
      .run();
  }

  /* ------------------------------ strategies ---------------------------- */

  async listStrategies(): Promise<Strategy[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM strategies WHERE agent_id = ? ORDER BY created_at DESC')
      .bind(this.agentId)
      .all();
    return results.map((r: any) => ({
      id: r.id,
      name: r.name,
      rationale: r.rationale ?? '',
      active: Boolean(r.active),
      createdAt: this.ms(r.created_at),
    }));
  }

  async appendStrategy(strategy: Strategy): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO strategies (id, agent_id, name, rationale, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(strategy.id, this.agentId, strategy.name, strategy.rationale, this.b(strategy.active), this.iso(strategy.createdAt))
      .run();
  }

  async deactivateStrategies(): Promise<void> {
    await this.db
      .prepare('UPDATE strategies SET active = 0 WHERE agent_id = ? AND active = 1')
      .bind(this.agentId)
      .run();
  }

  /* -------------------------------- events ------------------------------ */

  async listEvents(): Promise<AgentEvent[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM agent_events WHERE agent_id = ? ORDER BY created_at ASC')
      .bind(this.agentId)
      .all();
    return results.map((r: any) => ({
      id: r.id,
      type: r.type as EventType,
      message: r.message,
      createdAt: this.ms(r.created_at),
    }));
  }

  async appendEvent(event: AgentEvent): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO agent_events (id, agent_id, type, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(event.id, this.agentId, event.type, event.message, this.iso(event.createdAt))
      .run();
  }

  /* -------------------------------- cycles ------------------------------ */

  async listCycles(): Promise<AgentCycle[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM agent_cycles WHERE agent_id = ? ORDER BY started_at ASC')
      .bind(this.agentId)
      .all();
    return results.map((r: any) => ({
      id: r.id,
      index: r.cycle_index,
      startedAt: this.ms(r.started_at),
      completedAt: r.completed_at ? Date.parse(r.completed_at) : undefined,
      steps: this.a<CycleStep>(r.steps),
      discoveredIds: this.a<string>(r.discovered_ids),
      selectedOpportunityId: r.selected_opportunity_id ?? undefined,
      experimentId: r.experiment_id ?? undefined,
      summary: r.summary ?? undefined,
    }));
  }

  async appendCycle(cycle: AgentCycle): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO agent_cycles
           (id, agent_id, cycle_index, steps, discovered_ids, selected_opportunity_id,
            experiment_id, summary, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        cycle.id,
        this.agentId,
        cycle.index,
        this.j(cycle.steps),
        this.j(cycle.discoveredIds),
        cycle.selectedOpportunityId ?? null,
        cycle.experimentId ?? null,
        cycle.summary ?? null,
        this.iso(cycle.startedAt),
        cycle.completedAt ? this.iso(cycle.completedAt) : null,
      )
      .run();
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
    await this.db
      .prepare('UPDATE agent_cycles SET steps = ? WHERE id = ?')
      .bind(this.j(steps), cycleId)
      .run();
  }

  async completeCycle(cycleId: string, patch: Partial<AgentCycle>): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (patch.completedAt !== undefined) fields.completed_at = patch.completedAt ? this.iso(patch.completedAt) : null;
    if (patch.summary !== undefined) fields.summary = patch.summary;
    if (patch.discoveredIds !== undefined) fields.discovered_ids = this.j(patch.discoveredIds);
    if (patch.selectedOpportunityId !== undefined) fields.selected_opportunity_id = patch.selectedOpportunityId ?? null;
    if (patch.experimentId !== undefined) fields.experiment_id = patch.experimentId ?? null;
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    await this.db
      .prepare(`UPDATE agent_cycles SET ${setClause} WHERE id = ?`)
      .bind(...keys.map((k) => fields[k]), cycleId)
      .run();
  }

  /* -------------------------------- reset ------------------------------- */

  async reset({ seed = true }: { seed?: boolean } = {}): Promise<void> {
    const tables = [
      'transactions',
      'experiment_results', // no agent_id column; deleted via experiments join below
      'experiments',
      'agent_memory',
      'research_reports',
      'research_sources', // no agent_id column; deleted via opportunities join below
      'opportunities',
      'agent_events',
      'strategies',
      'agent_cycles',
    ];

    const stmts = [
      // child tables without agent_id: scope by parent id subquery
      this.db.prepare(
        `DELETE FROM experiment_results WHERE experiment_id IN (SELECT id FROM experiments WHERE agent_id = ?)`,
      ).bind(this.agentId),
      this.db.prepare(
        `DELETE FROM research_sources WHERE opportunity_id IN (SELECT id FROM opportunities WHERE agent_id = ?)`,
      ).bind(this.agentId),
      ...tables
        .filter((t) => t !== 'experiment_results' && t !== 'research_sources')
        .map((t) => this.db.prepare(`DELETE FROM ${t} WHERE agent_id = ?`).bind(this.agentId)),
      this.db.prepare('DELETE FROM agents WHERE id = ?').bind(this.agentId),
    ];
    await this.db.batch(stmts);

    if (seed) await seedD1(this.db, this.agentId);
  }
}

/* ---------------------------- first-run seeding --------------------------- */

export async function seedD1(db: D1DatabaseLike, agentId: string = AGENT_ID): Promise<void> {
  const snap = createSeedSnapshot();
  const repo = new D1Repository(db, agentId);

  await db
    .prepare(
      `INSERT INTO agents
         (id, name, status, starting_capital, survival_threshold, current_strategy,
          current_objective, cycle_count, total_cycles_run, real_money_enabled,
          daily_spend_limit, created_at)
       VALUES (?, ?, 'ALIVE', ?, ?, ?, ?, 0, 0, 0, 0, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      snap.agent.id,
      snap.agent.name,
      snap.agent.startingCapital,
      snap.agent.survivalThreshold,
      snap.agent.currentStrategy,
      snap.agent.currentObjective,
      new Date(snap.agent.startedAt).toISOString(),
    )
    .run();

  await repo.upsertOpportunities(snap.opportunities);
  for (const tx of snap.transactions) await repo.appendTransaction(tx);
  for (const evt of snap.events) await repo.appendEvent(evt);
  for (const strat of snap.strategies) await repo.appendStrategy(strat);
}
