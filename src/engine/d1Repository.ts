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
  BusinessModel,
  CycleStep,
  CycleStepKey,
  DesignBrief,
  EventType,
  Experiment,
  IntelligenceConfidence,
  LearningEvent,
  LeadScoreBreakdown,
  MemoryEntry,
  Offer,
  Opportunity,
  OpportunityDecision,
  OutreachMessageSet,
  Project,
  ProjectMilestone,
  ProjectMilestoneKey,
  Prospect,
  ProspectInteraction,
  ProspectIntelligence,
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

  /** D1 (Cloudflare's SQLite) caps a single statement at 100 bound
   *  parameters. Any `WHERE x IN (?,?,...)` built from a caller-supplied
   *  list must be chunked through this before binding, since that list
   *  has no fixed upper bound (accumulates over the agent's lifetime as
   *  more opportunities/prospects are discovered) — 90 leaves headroom
   *  for the query's own fixed placeholders. */
  private chunk<T>(items: T[], size = 90): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
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
    const res: any = await this.db
      .prepare(`UPDATE agents SET ${setClause} WHERE id = ?`)
      .bind(...keys.map((k) => fields[k]), this.agentId)
      .run();
    // Defense in depth: never silently "succeed" at persisting nothing.
    // A 0-row UPDATE almost always means the agent hasn't been created
    // yet — callers must go through createAgentIfMissing() first.
    if (res && res.meta && res.meta.changes === 0) {
      throw new Error(
        `updateAgent(${this.agentId}) affected 0 rows — agent does not exist yet; call createAgentIfMissing() first`,
      );
    }
    return this.getAgent();
  }

  /** Create the agent row iff it doesn't already exist. Idempotent. */
  async createAgentIfMissing(agent: Agent): Promise<Agent> {
    await this.db
      .prepare(
        `INSERT INTO agents
           (id, name, status, starting_capital, survival_threshold, current_strategy,
            current_objective, cycle_count, total_cycles_run, real_money_enabled,
            daily_spend_limit, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        agent.id,
        agent.name,
        agent.status,
        agent.startingCapital,
        agent.survivalThreshold,
        agent.currentStrategy,
        agent.currentObjective,
        agent.cycleCount,
        agent.totalCyclesRun,
        this.iso(agent.startedAt),
      )
      .run();
    return this.getAgent();
  }

  /**
   * Atomic compare-and-swap claim: only one caller can move the agent into
   * RESEARCHING/EXECUTING at a time. A stale lock (a previous run that
   * crashed mid-cycle without releasing it) can be reclaimed after
   * `staleAfterMs`. Never reclaims a DEAD agent.
   */
  async tryClaimCycle(staleAfterMs = 15 * 60 * 1000): Promise<boolean> {
    const now = Date.now();
    const staleBefore = this.iso(now - staleAfterMs);
    const res: any = await this.db
      .prepare(
        `UPDATE agents SET status = 'RESEARCHING', cycle_lock_at = ?
         WHERE id = ? AND status != 'DEAD'
           AND (
             status NOT IN ('RESEARCHING', 'EXECUTING')
             OR cycle_lock_at IS NULL
             OR cycle_lock_at < ?
           )`,
      )
      .bind(this.iso(now), this.agentId, staleBefore)
      .run();
    return Boolean(res?.meta?.changes && res.meta.changes > 0);
  }

  async releaseCycleLock(status: Agent['status']): Promise<void> {
    await this.db
      .prepare('UPDATE agents SET status = ?, cycle_lock_at = NULL WHERE id = ?')
      .bind(status, this.agentId)
      .run();
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
    const sources: any[] = [];
    for (const idChunk of this.chunk(ids)) {
      const placeholders = idChunk.map(() => '?').join(',');
      const { results } = await this.db
        .prepare(`SELECT * FROM research_sources WHERE opportunity_id IN (${placeholders})`)
        .bind(...idChunk)
        .all();
      sources.push(...results);
    }

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
    const deleteStmts = this.chunk(ids).map((idChunk) => {
      const placeholders = idChunk.map(() => '?').join(',');
      return this.db
        .prepare(`DELETE FROM research_sources WHERE opportunity_id IN (${placeholders})`)
        .bind(...idChunk);
    });

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

    await this.db.batch([...deleteStmts, ...sourceStmts]);
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
      lifecycleState: (r.lifecycle_state ?? 'DISCOVERED') as Opportunity['lifecycleState'],
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
      lifecycle_state: o.lifecycleState ?? 'DISCOVERED',
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
    const resultRows: any[] = [];
    for (const idChunk of this.chunk(ids)) {
      const placeholders = idChunk.map(() => '?').join(',');
      const { results } = await this.db
        .prepare(`SELECT * FROM experiment_results WHERE experiment_id IN (${placeholders})`)
        .bind(...idChunk)
        .all();
      resultRows.push(...results);
    }
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
      'opportunity_models',
      'opportunity_decisions',
      'agent_actions',
      'prospect_interactions', // no agent_id column; deleted via prospects join below
      'outreach_messages', // no agent_id column; deleted via prospects join below
      'design_briefs', // no agent_id column; deleted via prospects/offers join below
      'offers', // no agent_id column; deleted via prospects join below
      'projects', // no agent_id column; deleted via prospects join below
      'real_revenue', // no agent_id column; deleted via opportunities join below
      'learning_events', // no agent_id column; deleted via opportunities join below
      'prospect_intelligence', // no agent_id column; deleted via prospects join below
      'prospects',
    ];

    const stmts = [
      // child tables without agent_id: scope by parent id subquery
      this.db.prepare(
        `DELETE FROM experiment_results WHERE experiment_id IN (SELECT id FROM experiments WHERE agent_id = ?)`,
      ).bind(this.agentId),
      this.db.prepare(
        `DELETE FROM research_sources WHERE opportunity_id IN (SELECT id FROM opportunities WHERE agent_id = ?)`,
      ).bind(this.agentId),
      this.db.prepare(
        `DELETE FROM prospect_interactions WHERE prospect_id IN (SELECT id FROM prospects WHERE agent_id = ?)`,
      ).bind(this.agentId),
      this.db.prepare(
        `DELETE FROM outreach_messages WHERE prospect_id IN (SELECT id FROM prospects WHERE agent_id = ?)`,
      ).bind(this.agentId),
      this.db.prepare(
        `DELETE FROM design_briefs WHERE offer_id IN (SELECT o.id FROM offers o JOIN prospects p ON p.id = o.prospect_id WHERE p.agent_id = ?)`,
      ).bind(this.agentId),
      this.db.prepare(
        `DELETE FROM offers WHERE prospect_id IN (SELECT id FROM prospects WHERE agent_id = ?)`,
      ).bind(this.agentId),
      this.db.prepare(
        `DELETE FROM projects WHERE prospect_id IN (SELECT id FROM prospects WHERE agent_id = ?)`,
      ).bind(this.agentId),
      this.db.prepare(
        `DELETE FROM real_revenue WHERE opportunity_id IN (SELECT id FROM opportunities WHERE agent_id = ?)`,
      ).bind(this.agentId),
      this.db.prepare(
        `DELETE FROM learning_events WHERE opportunity_id IN (SELECT id FROM opportunities WHERE agent_id = ?)`,
      ).bind(this.agentId),
      this.db.prepare(
        `DELETE FROM prospect_intelligence WHERE prospect_id IN (SELECT id FROM prospects WHERE agent_id = ?)`,
      ).bind(this.agentId),
      ...tables
        .filter(
          (t) =>
            ![
              'experiment_results',
              'research_sources',
              'prospect_interactions',
              'outreach_messages',
              'design_briefs',
              'offers',
              'projects',
              'real_revenue',
              'learning_events',
              'prospect_intelligence',
            ].includes(t),
        )
        .map((t) => this.db.prepare(`DELETE FROM ${t} WHERE agent_id = ?`).bind(this.agentId)),
      this.db.prepare('DELETE FROM agents WHERE id = ?').bind(this.agentId),
    ];
    await this.db.batch(stmts);

    if (seed) await seedD1(this.db, this.agentId);
  }

  /* --------------------------- business models --------------------------- */

  async listBusinessModels(): Promise<BusinessModel[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM opportunity_models WHERE agent_id = ?')
      .bind(this.agentId)
      .all();
    return results.map((r: any) => this.mapBusinessModel(r));
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
      follow_up_sequence: this.j(model.followUpSequence),
      objection_handling: this.j(model.objectionHandling),
      delivery_workflow: model.deliveryWorkflow,
      time_to_first_sale_days_estimate: model.timeToFirstSaleDaysEstimate,
      upsells: this.j(model.upsells),
      recurring_revenue_note: model.recurringRevenueNote,
      expected_profit_first_deal: model.expectedProfitFirstDeal,
      can_scale: this.b(model.canScale),
      scale_note: model.scaleNote,
      next_action: model.nextAction,
      confidence: model.confidence,
      generator: model.generator,
      generated_at: this.iso(model.generatedAt),
      updated_at: this.iso(model.updatedAt),
    };
    const cols = Object.keys(row);
    const updateClause = cols
      .filter((c) => c !== 'opportunity_id')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');
    await this.db
      .prepare(
        `INSERT INTO opportunity_models (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
         ON CONFLICT(opportunity_id) DO UPDATE SET ${updateClause}`,
      )
      .bind(...cols.map((c) => (row as any)[c]))
      .run();
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
      followUpSequence: this.a<string>(r.follow_up_sequence),
      objectionHandling: this.a<{ objection: string; response: string }>(r.objection_handling),
      deliveryWorkflow: r.delivery_workflow,
      timeToFirstSaleDaysEstimate: r.time_to_first_sale_days_estimate,
      upsells: this.a<string>(r.upsells),
      recurringRevenueNote: r.recurring_revenue_note ?? '',
      expectedProfitFirstDeal: this.n(r.expected_profit_first_deal),
      canScale: Boolean(r.can_scale),
      scaleNote: r.scale_note ?? '',
      nextAction: r.next_action ?? '',
      confidence: this.n(r.confidence),
      generator: r.generator ?? 'local-rule-engine',
      generatedAt: this.ms(r.generated_at),
      updatedAt: this.ms(r.updated_at),
    };
  }

  /* ----------------------------- decisions -------------------------------- */

  async listDecisions(): Promise<OpportunityDecision[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM opportunity_decisions WHERE agent_id = ? ORDER BY created_at DESC LIMIT 500')
      .bind(this.agentId)
      .all();
    return results.map((r: any) => this.mapDecision(r));
  }

  async appendDecision(decision: OpportunityDecision): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO opportunity_decisions
           (id, agent_id, opportunity_id, opportunity_name, action, previous_state, new_state,
            reasoning, evidence_summary, metrics, next_action, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        decision.id,
        this.agentId,
        decision.opportunityId,
        decision.opportunityName,
        decision.action,
        decision.previousState,
        decision.newState,
        decision.reasoning,
        decision.evidenceSummary,
        this.j(decision.metrics),
        decision.nextAction,
        this.iso(decision.createdAt),
      )
      .run();
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
      metrics: this.o(r.metrics),
      nextAction: r.next_action ?? '',
      createdAt: this.ms(r.created_at),
    };
  }

  /* ------------------------------- actions -------------------------------- */

  async listActions(): Promise<RecommendedAction[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM agent_actions WHERE agent_id = ? ORDER BY rank ASC')
      .bind(this.agentId)
      .all();
    return results.map((r: any) => this.mapAction(r));
  }

  async replaceActions(actions: RecommendedAction[]): Promise<void> {
    const deleteStmt = this.db.prepare('DELETE FROM agent_actions WHERE agent_id = ?').bind(this.agentId);
    const insertStmts = actions.map((a) =>
      this.db
        .prepare(
          `INSERT INTO agent_actions
             (id, agent_id, kind, opportunity_id, opportunity_name, prospect_id, prospect_name,
              title, description, expected_value, urgency, effort, rank, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          a.id,
          this.agentId,
          a.kind,
          a.opportunityId ?? null,
          a.opportunityName ?? null,
          a.prospectId ?? null,
          a.prospectName ?? null,
          a.title,
          a.description,
          a.expectedValue,
          a.urgency,
          a.effort,
          a.rank,
          this.iso(a.createdAt),
        ),
    );
    await this.db.batch([deleteStmt, ...insertStmts]);
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
      createdAt: this.ms(r.created_at),
    };
  }

  /* ------------------------------- prospects ------------------------------ */

  async listProspects(): Promise<Prospect[]> {
    const { results: rows } = await this.db
      .prepare('SELECT * FROM prospects WHERE agent_id = ? ORDER BY created_at DESC')
      .bind(this.agentId)
      .all();
    if (!rows.length) return [];
    const ids = rows.map((r: any) => r.id);
    const sourceRows: any[] = [];
    for (const idChunk of this.chunk(ids)) {
      const placeholders = idChunk.map(() => '?').join(',');
      const { results } = await this.db
        .prepare(`SELECT * FROM prospect_sources WHERE prospect_id IN (${placeholders})`)
        .bind(...idChunk)
        .all();
      sourceRows.push(...results);
    }
    const sourcesByProspect = new Map<string, any[]>();
    for (const s of sourceRows) {
      const list = sourcesByProspect.get(s.prospect_id as string) ?? [];
      list.push(s);
      sourcesByProspect.set(s.prospect_id as string, list);
    }
    return rows.map((r: any) => this.mapProspect(r, sourcesByProspect.get(r.id) ?? []));
  }

  async upsertProspects(prospects: Prospect[]): Promise<void> {
    if (prospects.length === 0) return;
    const stmts = prospects.map((p) => {
      const row = this.prospectRow(p);
      const cols = Object.keys(row);
      const updateClause = cols
        .filter((c) => c !== 'id')
        .map((c) => `${c} = excluded.${c}`)
        .join(', ');
      return this.db
        .prepare(
          `INSERT INTO prospects (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
           ON CONFLICT(id) DO UPDATE SET ${updateClause}`,
        )
        .bind(...cols.map((c) => row[c]));
    });
    await this.db.batch(stmts);

    const ids = prospects.map((p) => p.id);
    const deleteStmts = this.chunk(ids).map((idChunk) => {
      const placeholders = idChunk.map(() => '?').join(',');
      return this.db
        .prepare(`DELETE FROM prospect_sources WHERE prospect_id IN (${placeholders})`)
        .bind(...idChunk);
    });
    const sourceStmts = prospects.flatMap((p) =>
      p.sources.map((s) =>
        this.db
          .prepare(
            `INSERT INTO prospect_sources (id, prospect_id, title, url, kind, note)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               prospect_id = excluded.prospect_id, title = excluded.title,
               url = excluded.url, kind = excluded.kind, note = excluded.note`,
          )
          .bind(s.id, p.id, s.title, s.url ?? null, s.kind, s.note ?? null),
      ),
    );
    await this.db.batch([...deleteStmts, ...sourceStmts]);
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
      social_links: this.j(p.socialLinks),
      contact_channel: p.contactChannel,
      contact_value: p.contactValue ?? null,
      evidence_notes: p.evidenceNotes,
      priority: p.priority,
      score: this.j(p.score),
      status: p.status,
      data_source: p.dataSource,
      date_discovered: this.iso(p.dateDiscovered),
      last_contact_at: p.lastContactAt ? this.iso(p.lastContactAt) : null,
      next_follow_up_at: p.nextFollowUpAt ? this.iso(p.nextFollowUpAt) : null,
      messages_sent_count: p.messagesSentCount,
      responses_received_count: p.responsesReceivedCount,
      actual_revenue: p.actualRevenue,
      notes: this.j(p.notes),
      reason_lost: p.reasonLost ?? null,
      created_at: this.iso(p.createdAt),
      updated_at: this.iso(p.updatedAt),
    };
  }

  private mapProspect(r: any, sourceRows: any[]): Prospect {
    return {
      id: r.id,
      opportunityId: r.opportunity_id,
      opportunityName: r.opportunity_name ?? '',
      businessName: r.business_name,
      category: r.category ?? '',
      location: r.location ?? '',
      websitePresence: r.website_presence ?? 'UNKNOWN',
      websiteUrl: r.website_url ?? undefined,
      socialLinks: this.a<string>(r.social_links),
      contactChannel: r.contact_channel ?? 'UNKNOWN',
      contactValue: r.contact_value ?? undefined,
      sources: sourceRows.map((s: any) => ({
        id: s.id,
        title: s.title,
        url: s.url ?? undefined,
        kind: s.kind,
        note: s.note ?? undefined,
      })),
      evidenceNotes: r.evidence_notes ?? '',
      priority: r.priority,
      score: this.o<LeadScoreBreakdown>(r.score),
      status: r.status,
      dataSource: r.data_source,
      dateDiscovered: this.ms(r.date_discovered),
      lastContactAt: r.last_contact_at ? this.ms(r.last_contact_at) : undefined,
      nextFollowUpAt: r.next_follow_up_at ? this.ms(r.next_follow_up_at) : undefined,
      messagesSentCount: r.messages_sent_count ?? 0,
      responsesReceivedCount: r.responses_received_count ?? 0,
      actualRevenue: this.n(r.actual_revenue),
      notes: this.a<string>(r.notes),
      reasonLost: r.reason_lost ?? undefined,
      createdAt: this.ms(r.created_at),
      updatedAt: this.ms(r.updated_at),
    };
  }

  /* --------------------------- prospect interactions ----------------------- */

  async listProspectInteractions(): Promise<ProspectInteraction[]> {
    const { results } = await this.db
      .prepare(
        `SELECT pi.* FROM prospect_interactions pi
         JOIN prospects p ON p.id = pi.prospect_id
         WHERE p.agent_id = ? ORDER BY pi.created_at DESC LIMIT 1000`,
      )
      .bind(this.agentId)
      .all();
    return results.map((r: any) => ({
      id: r.id,
      prospectId: r.prospect_id,
      kind: r.kind,
      summary: r.summary,
      createdAt: this.ms(r.created_at),
    }));
  }

  async appendProspectInteraction(interaction: ProspectInteraction): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO prospect_interactions (id, prospect_id, kind, summary, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(interaction.id, interaction.prospectId, interaction.kind, interaction.summary, this.iso(interaction.createdAt))
      .run();
  }

  /* ----------------------------- outreach messages -------------------------- */

  async listOutreachMessages(): Promise<OutreachMessageSet[]> {
    const { results } = await this.db
      .prepare(
        `SELECT om.* FROM outreach_messages om
         JOIN prospects p ON p.id = om.prospect_id
         WHERE p.agent_id = ?`,
      )
      .bind(this.agentId)
      .all();
    return results.map((r: any) => this.mapOutreach(r));
  }

  async upsertOutreachMessages(set: OutreachMessageSet): Promise<void> {
    const row = {
      id: set.id,
      prospect_id: set.prospectId,
      opportunity_id: set.opportunityId,
      business_model_id: set.businessModelId ?? null,
      whatsapp: set.whatsapp,
      sms: set.sms,
      email: this.j(set.email),
      short_version: set.shortVersion,
      professional_version: set.professionalVersion,
      follow_up_1: set.followUp1,
      follow_up_2: set.followUp2,
      objection_responses: this.j(set.objectionResponses),
      price_explanation: set.priceExplanation,
      call_script: this.j(set.callScript),
      meeting_agenda: this.j(set.meetingAgenda),
      proposal_outline: this.j(set.proposalOutline),
      generator: set.generator,
      generated_at: this.iso(set.generatedAt),
      updated_at: this.iso(set.updatedAt),
    };
    const cols = Object.keys(row);
    const updateClause = cols
      .filter((c) => c !== 'prospect_id')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');
    await this.db
      .prepare(
        `INSERT INTO outreach_messages (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
         ON CONFLICT(prospect_id) DO UPDATE SET ${updateClause}`,
      )
      .bind(...cols.map((c) => (row as any)[c]))
      .run();
  }

  private mapOutreach(r: any): OutreachMessageSet {
    return {
      id: r.id,
      prospectId: r.prospect_id,
      opportunityId: r.opportunity_id,
      businessModelId: r.business_model_id ?? undefined,
      whatsapp: r.whatsapp,
      sms: r.sms,
      email: this.o<{ subject: string; body: string }>(r.email),
      shortVersion: r.short_version,
      professionalVersion: r.professional_version,
      followUp1: r.follow_up_1,
      followUp2: r.follow_up_2,
      objectionResponses: this.a<{ objection: string; response: string }>(r.objection_responses),
      priceExplanation: r.price_explanation,
      callScript: this.a<string>(r.call_script),
      meetingAgenda: this.a<string>(r.meeting_agenda),
      proposalOutline: this.a<string>(r.proposal_outline),
      generator: r.generator ?? 'local-rule-engine',
      generatedAt: this.ms(r.generated_at),
      updatedAt: this.ms(r.updated_at),
    };
  }

  /* --------------------------------- offers --------------------------------- */

  async listOffers(): Promise<Offer[]> {
    const { results } = await this.db
      .prepare(
        `SELECT o.* FROM offers o JOIN prospects p ON p.id = o.prospect_id WHERE p.agent_id = ? ORDER BY o.created_at DESC`,
      )
      .bind(this.agentId)
      .all();
    return results.map((r: any) => this.mapOffer(r));
  }

  async upsertOffer(offer: Offer): Promise<void> {
    const row = {
      id: offer.id,
      prospect_id: offer.prospectId,
      prospect_name: offer.prospectName,
      opportunity_id: offer.opportunityId,
      business_model_id: offer.businessModelId ?? null,
      price: offer.price,
      timeline_days_min: offer.timelineDaysMin,
      timeline_days_max: offer.timelineDaysMax,
      deliverables: this.j(offer.deliverables),
      gap_analysis: offer.gapAnalysis ?? null,
      website_brief: this.j(offer.websiteBrief),
      status: offer.status,
      generator: offer.generator,
      generated_at: this.iso(offer.generatedAt),
      updated_at: this.iso(offer.updatedAt),
      created_at: this.iso(offer.generatedAt),
    };
    const cols = Object.keys(row);
    const updateClause = cols
      .filter((c) => c !== 'prospect_id' && c !== 'created_at')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');
    await this.db
      .prepare(
        `INSERT INTO offers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
         ON CONFLICT(prospect_id) DO UPDATE SET ${updateClause}`,
      )
      .bind(...cols.map((c) => (row as any)[c]))
      .run();
  }

  async updateOfferStatus(offerId: string, status: Offer['status']): Promise<void> {
    await this.db
      .prepare(`UPDATE offers SET status = ?, updated_at = ? WHERE id = ?`)
      .bind(status, this.iso(Date.now()), offerId)
      .run();
  }

  private mapOffer(r: any): Offer {
    return {
      id: r.id,
      prospectId: r.prospect_id,
      prospectName: r.prospect_name ?? '',
      opportunityId: r.opportunity_id,
      businessModelId: r.business_model_id ?? undefined,
      price: this.n(r.price),
      timelineDaysMin: r.timeline_days_min,
      timelineDaysMax: r.timeline_days_max,
      deliverables: this.a<string>(r.deliverables),
      gapAnalysis: r.gap_analysis ?? undefined,
      websiteBrief: this.o<WebsiteBrief>(r.website_brief),
      status: r.status,
      generator: r.generator ?? 'local-rule-engine',
      generatedAt: this.ms(r.generated_at),
      updatedAt: this.ms(r.updated_at),
    };
  }

  /* ------------------------------ design briefs ------------------------------ */

  async listDesignBriefs(): Promise<DesignBrief[]> {
    const { results } = await this.db
      .prepare(
        `SELECT db.* FROM design_briefs db
         JOIN offers o ON o.id = db.offer_id
         JOIN prospects p ON p.id = o.prospect_id
         WHERE p.agent_id = ?`,
      )
      .bind(this.agentId)
      .all();
    return results.map((r: any) => this.mapDesignBrief(r));
  }

  async upsertDesignBrief(brief: DesignBrief): Promise<void> {
    const row = {
      id: brief.id,
      offer_id: brief.offerId,
      prospect_id: brief.prospectId,
      homepage_concept: brief.homepageConcept,
      hero_section: brief.heroSection,
      logo_direction: brief.logoDirection,
      social_graphics: this.j(brief.socialGraphics),
      color_direction_note: brief.colorDirectionNote,
      asset_status: brief.assetStatus,
      generated_at: this.iso(brief.generatedAt),
      updated_at: this.iso(brief.updatedAt),
    };
    const cols = Object.keys(row);
    const updateClause = cols
      .filter((c) => c !== 'offer_id')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');
    await this.db
      .prepare(
        `INSERT INTO design_briefs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
         ON CONFLICT(offer_id) DO UPDATE SET ${updateClause}`,
      )
      .bind(...cols.map((c) => (row as any)[c]))
      .run();
  }

  private mapDesignBrief(r: any): DesignBrief {
    return {
      id: r.id,
      offerId: r.offer_id,
      prospectId: r.prospect_id,
      homepageConcept: r.homepage_concept,
      heroSection: r.hero_section,
      logoDirection: r.logo_direction,
      socialGraphics: this.a<string>(r.social_graphics),
      colorDirectionNote: r.color_direction_note ?? '',
      assetStatus: r.asset_status ?? 'NOT_CONFIGURED',
      generatedAt: this.ms(r.generated_at),
      updatedAt: this.ms(r.updated_at),
    };
  }

  /* --------------------------------- projects --------------------------------- */

  async listProjects(): Promise<Project[]> {
    const { results } = await this.db
      .prepare(
        `SELECT pr.* FROM projects pr JOIN prospects p ON p.id = pr.prospect_id WHERE p.agent_id = ? ORDER BY pr.created_at DESC`,
      )
      .bind(this.agentId)
      .all();
    return results.map((r: any) => this.mapProject(r));
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
      milestones: this.j(project.milestones),
      status: project.status,
      started_at: this.iso(project.startedAt),
      delivered_at: project.deliveredAt ? this.iso(project.deliveredAt) : null,
      updated_at: this.iso(project.updatedAt),
      created_at: this.iso(project.startedAt),
    };
    const cols = Object.keys(row);
    const updateClause = cols
      .filter((c) => c !== 'prospect_id' && c !== 'created_at')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');
    await this.db
      .prepare(
        `INSERT INTO projects (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
         ON CONFLICT(prospect_id) DO UPDATE SET ${updateClause}`,
      )
      .bind(...cols.map((c) => (row as any)[c]))
      .run();
  }

  async advanceProjectMilestone(projectId: string, milestone: ProjectMilestoneKey): Promise<void> {
    const row = await this.db.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first<any>();
    if (!row) return;
    const project = this.mapProject(row);
    const updated = advanceMilestone(project, milestone);
    await this.db
      .prepare(
        `UPDATE projects SET milestones = ?, status = ?, delivered_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(
        this.j(updated.milestones),
        updated.status,
        updated.deliveredAt ? this.iso(updated.deliveredAt) : null,
        this.iso(updated.updatedAt),
        projectId,
      )
      .run();
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
      milestones: this.a<ProjectMilestone>(r.milestones),
      status: r.status,
      startedAt: this.ms(r.started_at),
      deliveredAt: r.delivered_at ? this.ms(r.delivered_at) : undefined,
      updatedAt: this.ms(r.updated_at),
      satisfaction: r.satisfaction ?? undefined,
      repeatPurchase: r.repeat_purchase === null || r.repeat_purchase === undefined ? undefined : !!r.repeat_purchase,
      referral: r.referral === null || r.referral === undefined ? undefined : !!r.referral,
    };
  }

  /* ------------------------------ CRM write path ------------------------------ */

  async updateProspectStatus(prospectId: string, status: Prospect['status'], reasonLost?: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE prospects SET status = ?, reason_lost = COALESCE(?, reason_lost), updated_at = ? WHERE id = ?`,
      )
      .bind(status, reasonLost ?? null, this.iso(Date.now()), prospectId)
      .run();
  }

  /* --------------------------- real revenue ledger --------------------------- */

  async listRealRevenue(): Promise<RealRevenueEntry[]> {
    const { results } = await this.db
      .prepare(
        `SELECT rr.* FROM real_revenue rr
         JOIN opportunities o ON o.id = rr.opportunity_id
         WHERE o.agent_id = ? ORDER BY rr.date DESC`,
      )
      .bind(this.agentId)
      .all();
    return results.map((r: any) => this.mapRealRevenue(r));
  }

  async addRealRevenueEntry(entry: RealRevenueEntry): Promise<void> {
    // Append-only, per the design constraint — always an INSERT, never an
    // upsert/update. Auditable ledger of actual money received.
    await this.db
      .prepare(
        `INSERT INTO real_revenue (
           id, date, opportunity_id, opportunity_name, prospect_id, prospect_name, project_id,
           product_service, quoted_price, amount_received, costs, profit, currency, payment_method,
           acquisition_channel, days_from_discovery_to_payment, notes, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.id,
        this.iso(entry.date),
        entry.opportunityId,
        entry.opportunityName,
        entry.prospectId,
        entry.prospectName,
        entry.projectId,
        entry.productService,
        entry.quotedPrice,
        entry.amountReceived,
        entry.costs,
        entry.profit,
        entry.currency,
        entry.paymentMethod,
        entry.acquisitionChannel,
        entry.daysFromDiscoveryToPayment,
        entry.notes ?? null,
        this.iso(entry.createdAt),
      )
      .run();
  }

  private mapRealRevenue(r: any): RealRevenueEntry {
    return {
      id: r.id,
      date: this.ms(r.date),
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
      createdAt: this.ms(r.created_at),
    };
  }

  /* ----------------------------- learning events ------------------------------ */

  async listLearningEvents(): Promise<LearningEvent[]> {
    const { results } = await this.db
      .prepare(
        `SELECT le.* FROM learning_events le
         JOIN opportunities o ON o.id = le.opportunity_id
         WHERE o.agent_id = ? ORDER BY le.created_at DESC`,
      )
      .bind(this.agentId)
      .all();
    return results.map((r: any) => this.mapLearningEvent(r));
  }

  async appendLearningEvent(event: LearningEvent): Promise<void> {
    // Append-only, per the design constraint.
    await this.db
      .prepare(
        `INSERT INTO learning_events (id, kind, opportunity_id, category, ref_id, summary, predicted_value, actual_value, delta_pct, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.kind,
        event.opportunityId,
        event.category,
        event.refId,
        event.summary,
        event.predictedValue ?? null,
        event.actualValue ?? null,
        event.deltaPct ?? null,
        this.iso(event.createdAt),
      )
      .run();
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
      createdAt: this.ms(r.created_at),
    };
  }

  /* --------------------------- project outcome tracking ------------------------ */

  async updateProjectOutcome(
    projectId: string,
    outcome: { satisfaction?: number; repeatPurchase?: boolean; referral?: boolean },
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE projects SET
           satisfaction = COALESCE(?, satisfaction),
           repeat_purchase = COALESCE(?, repeat_purchase),
           referral = COALESCE(?, referral),
           updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        outcome.satisfaction ?? null,
        outcome.repeatPurchase === undefined ? null : this.b(outcome.repeatPurchase),
        outcome.referral === undefined ? null : this.b(outcome.referral),
        this.iso(Date.now()),
        projectId,
      )
      .run();
  }

  /* ---------------------------- prospect intelligence -------------------------- */

  async listProspectIntelligence(): Promise<ProspectIntelligence[]> {
    const { results } = await this.db
      .prepare(
        `SELECT pi.* FROM prospect_intelligence pi
         JOIN prospects p ON p.id = pi.prospect_id
         WHERE p.agent_id = ?`,
      )
      .bind(this.agentId)
      .all();
    return results.map((r: any) => this.mapProspectIntelligence(r));
  }

  async upsertProspectIntelligence(intel: ProspectIntelligence): Promise<void> {
    const row = {
      id: intel.id,
      prospect_id: intel.prospectId,
      business_overview: intel.businessOverview,
      apparent_services: this.j(intel.apparentServices),
      social_presence_summary: intel.socialPresenceSummary,
      competitive_note: intel.competitiveNote,
      specific_problem_evidence: intel.specificProblemEvidence,
      recommended_angle: intel.recommendedAngle,
      confidence: intel.confidence,
      generator: intel.generator,
      sources: this.j(intel.sources),
      generated_at: this.iso(intel.generatedAt),
      updated_at: this.iso(intel.updatedAt),
    };
    const cols = Object.keys(row);
    const updateClause = cols
      .filter((c) => c !== 'prospect_id')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');
    await this.db
      .prepare(
        `INSERT INTO prospect_intelligence (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
         ON CONFLICT(prospect_id) DO UPDATE SET ${updateClause}`,
      )
      .bind(...cols.map((c) => (row as any)[c]))
      .run();
  }

  private mapProspectIntelligence(r: any): ProspectIntelligence {
    return {
      id: r.id,
      prospectId: r.prospect_id,
      businessOverview: r.business_overview,
      apparentServices: this.a<string>(r.apparent_services),
      socialPresenceSummary: r.social_presence_summary,
      competitiveNote: r.competitive_note,
      specificProblemEvidence: r.specific_problem_evidence,
      recommendedAngle: r.recommended_angle,
      confidence: r.confidence as IntelligenceConfidence,
      generator: r.generator,
      sources: this.a(r.sources),
      generatedAt: this.ms(r.generated_at),
      updatedAt: this.ms(r.updated_at),
    };
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
