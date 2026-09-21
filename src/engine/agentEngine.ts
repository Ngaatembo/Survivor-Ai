/* ============================================================================
 * AgentEngine — the autonomous loop, transport-independent.
 *
 * One instance drives both environments:
 *   - Browser: the Zustand store wraps a StoreRepository and renders hooks.
 *   - Cloudflare Worker: a scheduled event constructs a SupabaseRepository,
 *     wires search + LLM providers from secrets, and calls runCycle().
 *
 * Loop: RESEARCH → DISCOVER → VERIFY → SCORE → RANK → SELECT → SIMULATE
 *       → MEASURE → LEARN.
 * Live discovery is used automatically when a SearchProvider is present;
 * LLM analysis enriches findings. Finance models remain execution-blocked.
 * ========================================================================== */

import type {
  Agent,
  AgentCycle,
  CycleStep,
  CycleStepKey,
  EventType,
  Experiment,
  Opportunity,
  Transaction,
} from '../types';
import { uid } from '../lib/format';
import { simulateExperiment, experimentBudget } from '../lib/simulation';
import { balanceFrom } from '../services/wallet';
import { record as ledgerRecord } from '../services/wallet';
import { discoverFromKnowledgeBase, advanceStage, scoreAll, rankOpportunities } from '../services/research';
import { decide, generateReport, strategyFromMemory, type Decision } from '../services/ai';
import { recordResult, lessonFromExperiment } from '../services/memory';
import { discoverLive } from '../services/liveResearch';
import { discoverProspects } from '../services/prospectDiscovery';
import type { EngineHooks, EngineRepository } from './repository';
import { createSeedSnapshot, computeSurvivalStatus } from './seed';
import type { LLMProvider, SearchProvider } from '../services/providers/types';
import { loadEconomyState, saveEconomyState, type SearchEconomyContext } from '../services/searchEconomy';
import { evaluateOpportunity, VALIDATION_SCORE_THRESHOLD } from '../lib/decisionEngine';
import { generateBusinessModel } from '../lib/businessModel';
import { generateOutreachMessages } from '../lib/outreachGenerator';
import { researchProspect } from '../services/prospectIntelligence';
import { researchMarketPrice } from '../services/marketPricing';
import { generateOffer } from '../lib/offerGenerator';
import { generateDesignBrief } from '../lib/designBriefGenerator';
import { generateProspectDemo } from '../lib/demoGenerator';
import { buildMissionLadder, evaluateMissions } from '../lib/missions';
import { createProjectFromWonOffer } from '../lib/projectTracker';
import { computeCategoryRealWorldStats, statsForCategory } from '../lib/realRevenue';
import { computeRecommendedActions } from '../lib/recommendedActions';
import { rankRevenueProspects } from '../lib/revenueConversion';

export const STEP_ORDER: CycleStepKey[] = [
  'RESEARCH',
  'DISCOVER',
  'VERIFY',
  'SCORE',
  'RANK',
  'SELECT',
  'SIMULATE',
  'MEASURE',
  'LEARN',
];

const STEP_LABELS: Record<CycleStepKey, string> = {
  RESEARCH: 'Research',
  DISCOVER: 'Discover',
  VERIFY: 'Verify',
  SCORE: 'Score',
  RANK: 'Rank',
  SELECT: 'Select',
  SIMULATE: 'Simulate',
  MEASURE: 'Measure',
  LEARN: 'Learn',
};

export interface EngineProviders {
  /** @deprecated single-provider slot, kept for backward compatibility with
   *  any caller that hasn't moved to `tavily`/`brave`. When both `search`
   *  and `tavily`/`brave` are omitted, no live search runs. */
  search?: SearchProvider | null;
  tavily?: SearchProvider | null;
  brave?: SearchProvider | null;
  llm?: LLMProvider | null;
}

export interface EngineOptions {
  /** UI / host callbacks (status, activity). Logging always writes to repo. */
  onStatus?: (status: AgentStatusLike) => void;
  onActivity?: (activity: string, step: CycleStepKey | null) => void;
  onLog?: (type: EventType, message: string) => void;
}

export interface RunOptions {
  /** Returning false aborts the cycle after the current step (pause). */
  shouldContinue?: () => boolean;
  /** Step delay in ms (0 for headless runs). */
  stepDelay?: number;
  /** Use live search providers when available. */
  useLive?: boolean;
}

export interface CycleOutcome {
  cycle: AgentCycle;
  decision: Decision | null;
  experiment: Experiment | null;
  balance: number;
  finalStatus: 'ALIVE' | 'AT_RISK' | 'CRITICAL' | 'DEAD';
}

export class AgentEngine {
  constructor(
    private repo: EngineRepository,
    private providers: EngineProviders = {},
    private options: EngineOptions = {},
  ) {}

  /** Seed the repository on first run (idempotent — safe to call every boot). */
  async ensureSeeded(): Promise<void> {
    const agent = await this.safeGetAgent();
    if (agent) return;
    const snap = createSeedSnapshot();
    // Create the agent row FIRST and idempotently — createAgentIfMissing()
    // is a no-op if a concurrent boot already created it (ON CONFLICT DO
    // NOTHING / upsert), so this is safe under concurrent cold starts.
    // (Bug fixed here: this used to call updateAgent(), which assumes the
    // row already exists — a plain UPDATE against a missing row silently
    // affects 0 rows on D1 and errors on Supabase, so nothing ever got
    // seeded on a fresh database.)
    await this.repo.createAgentIfMissing(snap.agent);
    await this.repo.upsertOpportunities(snap.opportunities);
    for (const tx of snap.transactions) await this.repo.appendTransaction(tx);
    for (const evt of snap.events) await this.repo.appendEvent(evt);
    for (const strat of snap.strategies) await this.repo.appendStrategy(strat);
    // Survivor 2.0 §10 — the mission ladder, scaled to this agent's actual
    // starting capital.
    await this.repo.upsertMissions(buildMissionLadder(snap.agent.startingCapital));
  }

  private async safeGetAgent() {
    try {
      return await this.repo.getAgent();
    } catch {
      return null;
    }
  }

  async runCycle(opts: RunOptions = {}): Promise<CycleOutcome | null> {
    const stepDelay = opts.stepDelay ?? 600;
    const shouldContinue = opts.shouldContinue ?? (() => true);
    const hooks = this.hooks();

    const agent = await this.repo.getAgent();
    if (agent.status === 'DEAD') {
      await hooks.log('WARNING', 'Agent is DEAD — no new cycles can start. Reset the simulation.');
      return null;
    }

    // Atomic claim: prevents an overlapping cron tick / manual trigger from
    // racing this one and creating duplicate cycles or double-spending the
    // simulated balance. A stale claim (crashed mid-cycle) can be reclaimed.
    const claimed = await this.repo.tryClaimCycle();
    if (!claimed) {
      await hooks.log(
        'WARNING',
        'A cycle is already running — this trigger was skipped to avoid overlapping execution.',
      );
      return null;
    }

    try {
      return await this.runClaimedCycle(agent, opts, hooks, stepDelay, shouldContinue);
    } finally {
      const finalTx = await this.repo.listTransactions();
      const finalBalance = balanceFrom(finalTx);
      const releaseStatus = computeSurvivalStatus(finalBalance);
      await this.repo.releaseCycleLock(releaseStatus);
    }
  }

  private async runClaimedCycle(
    agent: Agent,
    opts: RunOptions,
    hooks: EngineHooks,
    stepDelay: number,
    shouldContinue: () => boolean,
  ): Promise<CycleOutcome | null> {
    let opportunities = await this.repo.listOpportunities();
    let transactions = await this.repo.listTransactions();
    let memory = await this.repo.listMemory();

    const index = agent.totalCyclesRun + 1;
    const cycle: AgentCycle = {
      id: uid('cyc'),
      index,
      startedAt: Date.now(),
      steps: STEP_ORDER.map((key) => ({ key, label: STEP_LABELS[key], status: 'pending' as const })),
      discoveredIds: [],
    };
    await this.repo.appendCycle(cycle);
    await this.repo.updateAgent({
      cycleCount: agent.cycleCount + 1,
      totalCyclesRun: index,
      status: 'RESEARCHING',
    });

    await hooks.log('CYCLE', `Agent started research cycle #${index}.`);

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const tick = async (step: CycleStepKey, ms = stepDelay): Promise<boolean> => {
      await this.repo.updateCycleStep(cycle.id, step, 'active');
      await hooks.setActivity?.(stepLabel(step), step);
      await delay(ms);
      if (!shouldContinue()) {
        await this.repo.updateCycleStep(cycle.id, step, 'skipped');
        return false;
      }
      await this.repo.updateCycleStep(cycle.id, step, 'done', Date.now());
      return true;
    };

    let decision: Decision | null = null;
    let experiment: Experiment | null = null;

    /* 1 — RESEARCH */
    await hooks.setStatus?.('RESEARCHING');
    await hooks.setActivity?.('Researching legitimate income models across categories…', 'RESEARCH');
    if (!(await tick('RESEARCH'))) return aborted(cycle, transactions);

    /* Search-economy context (Economic Survival Overhaul, Phases 2–5/9–11):
     * one shared, budget/cache-aware ledger for every search this cycle
     * makes, across discovery, prospecting, intelligence and pricing. Loaded
     * once from the repository's KV store and persisted once at the end of
     * the cycle so budgets/cache survive across cron invocations (a Worker
     * instance is not guaranteed to stay warm between 30-minute ticks). */
    const liveLlm = opts.useLive !== false ? this.providers.llm ?? null : null;
    const tavilyProvider = opts.useLive !== false ? this.providers.tavily ?? this.providers.search ?? null : null;
    const braveProvider = opts.useLive !== false ? this.providers.brave ?? null : null;
    const hasLiveSearch = Boolean(tavilyProvider?.connected || braveProvider?.connected);
    const survivalStatusAtStart = computeSurvivalStatus(balanceFrom(await this.repo.listTransactions()));
    const economyState = await loadEconomyState(this.repo);
    const searchCtx: SearchEconomyContext = {
      state: economyState,
      providers: { tavily: tavilyProvider, brave: braveProvider },
      survivalStatus: agent.status === 'DEAD' ? 'DEAD' : survivalStatusAtStart,
      now: Date.now(),
      cycleStartedAt: cycle.startedAt,
      onLog: (message) => {
        void hooks.log('WARNING', message);
      },
    };

    /* 2 — DISCOVER */
    if (hasLiveSearch) {
      await hooks.setActivity?.('Live web search — discovering real opportunities…', 'DISCOVER');
      const existingNames = opportunities.map((o) => o.name);
      const { opportunities: liveOpps, queriesRun, sourcesCount, cacheHits, budgetExceeded } = await discoverLive(
        searchCtx,
        liveLlm,
        existingNames,
      );
      if (liveOpps.length > 0) {
        await this.repo.upsertOpportunities(liveOpps);
        opportunities = await this.repo.listOpportunities();
        const ids = liveOpps.map((o) => o.id);
        await this.repo.completeCycle(cycle.id, { discoveredIds: ids });
        await hooks.log(
          'DISCOVERY',
          `LIVE discovery: ${queriesRun} fresh search(es), ${cacheHits} served from cache, ${budgetExceeded} skipped (budget), ${sourcesCount} sources cited, ${liveOpps.length} new opportunities tagged LIVE${liveLlm?.connected ? ` and analyzed by ${liveLlm.label}` : ' (analysis pending LLM connector)'}.`,
        );
      } else {
        await hooks.log('DISCOVERY', `Live search: ${cacheHits} cached / ${budgetExceeded} budget-limited, no new models this cycle — continuing from knowledge base.`);
      }
    }

    // Knowledge-base discovery always progresses too, so the loop never stalls
    // when live providers are absent or error (providers fail soft).
    {
      const current = await this.repo.listOpportunities();
      const { discovered } = discoverFromKnowledgeBase(current, 4);
      if (discovered.length > 0) {
        const ids = discovered.map((d) => d.id);
        const updated = advanceStage(current, ids, 'DISCOVERED');
        await this.repo.upsertOpportunities(updated);
        const priorIds = (cycle.discoveredIds ?? []).filter((id) => !ids.includes(id));
        await this.repo.completeCycle(cycle.id, { discoveredIds: [...priorIds, ...ids] });
        await hooks.log(
          'DISCOVERY',
          `${hasLiveSearch ? 'Also discovered' : 'Discovered'} ${discovered.length} from knowledge base: ${discovered.map((d) => d.name).join('; ')}.`,
        );
      } else if (!hasLiveSearch) {
        await hooks.log('DISCOVERY', 'SAMPLE knowledge base fully explored. Connect search + LLM for live discovery.');
      }
    }
    if (!(await tick('DISCOVER'))) return aborted(cycle, await this.repo.listTransactions());

    /* 3 — VERIFY */
    await hooks.setActivity?.('Analyzing evidence and verifying claims…', 'VERIFY');
    opportunities = await this.repo.listOpportunities();
    {
      const researchIds = opportunities
        .filter((o) => o.researchStage === 'DISCOVERED')
        .map((o) => o.id);
      if (researchIds.length) {
        let opps = advanceStage(opportunities, researchIds, 'RESEARCHED');
        opps = advanceStage(opps, researchIds, 'VERIFIED');
        await this.repo.upsertOpportunities(opps);
        await hooks.log(
          'VERIFY',
          `Verified ${researchIds.length} opportunities — evidence tiers assigned. No claim accepted without an evidence label.`,
        );
      } else {
        await hooks.log('VERIFY', 'No new items to verify — re-checking existing evidence.');
      }
    }
    if (!(await tick('VERIFY'))) return aborted(cycle, await this.repo.listTransactions());

    /* 4 — SCORE */
    await hooks.setActivity?.('Scoring opportunities against the $50 budget…', 'SCORE');
    {
      opportunities = await this.repo.listOpportunities();
      // Phase 5 §18 — blend in the real-world track record per category
      // (close rate, actual time-to-revenue) once enough real data exists;
      // see lib/realRevenue.ts for the exact, explainable blending rule.
      const categoryStats = computeCategoryRealWorldStats(
        opportunities,
        await this.repo.listProspects(),
        await this.repo.listRealRevenue(),
      );
      const scored = scoreAll(opportunities, categoryStats);
      await this.repo.upsertOpportunities(scored);
      const top = [...scored]
        .filter((o) => o.score && !o.executionBlocked)
        .sort((a, b) => b.score!.total - a.score!.total)[0];
      await hooks.log(
        'SCORE',
        top
          ? `Scored ${scored.filter((o) => o.score).length} opportunities. Highest executable: ${top.name} (${top.score!.total}/100).`
          : 'Scoring complete — no executable candidates yet.',
      );
    }
    if (!(await tick('SCORE'))) return aborted(cycle, await this.repo.listTransactions());

    /* 5 — RANK */
    await hooks.setActivity?.('Ranking candidates by risk-adjusted return…', 'RANK');
    {
      opportunities = await this.repo.listOpportunities();
      const categoryStats = computeCategoryRealWorldStats(
        opportunities,
        await this.repo.listProspects(),
        await this.repo.listRealRevenue(),
      );
      const ranked = rankOpportunities(opportunities, categoryStats).map((o) =>
        o.researchStage === 'UNDISCOVERED' || o.researchStage === 'DISCOVERED'
          ? o
          : { ...o, researchStage: 'RANKED' as const },
      );
      await this.repo.upsertOpportunities(ranked);
      await hooks.log('SCORE', `Ranking complete — ${ranked.filter((o) => o.researchStage !== 'UNDISCOVERED').length} opportunities in the active set.`);
    }
    if (!(await tick('RANK'))) return aborted(cycle, await this.repo.listTransactions());

    /* 6 — SELECT */
    await hooks.setActivity?.('Selecting the next experiment…', 'SELECT');
    {
      opportunities = await this.repo.listOpportunities();
      transactions = await this.repo.listTransactions();
      memory = await this.repo.listMemory();
      decision = decide(opportunities, memory, transactions);
      for (const rej of decision.rejections.slice(0, 3)) {
        await hooks.log('REJECTION', `Rejected "${rej.opportunity.name}": ${rej.reason}`);
      }
      if (decision.selected) {
        await hooks.log(
          'DECISION',
          `Selected "${decision.selected.name}" — confidence ${Math.round(decision.confidence * 100)}%. ${decision.reasons[0]}`,
        );
      } else {
        await hooks.log('WARNING', 'No executable opportunity this cycle — research continues next cycle.');
      }
    }
    if (!(await tick('SELECT'))) return aborted(cycle, await this.repo.listTransactions());

    /* 7 — SIMULATE */
    await hooks.setStatus?.('EXECUTING');
    const selected = decision?.selected ?? null;
    transactions = await this.repo.listTransactions();
    const balance = balanceFrom(transactions);
    const budget = selected ? experimentBudget(selected, balance) : 0;
    // Hard safety re-check, independent of experimentBudget()'s own math:
    // never let a write proceed above 18% of the CURRENT balance. This is
    // the last line of defense before the ledger is touched.
    const hardCap = Math.round(balance * 0.18 * 100) / 100;
    if (selected && budget > 0 && budget <= hardCap + 0.005) {
      await hooks.setActivity?.(`Simulating experiment: ${selected.name}…`, 'SIMULATE');
      const expId = uid('exp');
      await hooks.log('EXPERIMENT', `Experiment simulation created for "${selected.name}" with $${budget.toFixed(2)} simulated budget. No real money moves.`);

      await delay(stepDelay);
      if (!shouldContinue()) {
        await this.repo.updateCycleStep(cycle.id, 'SIMULATE', 'skipped');
        return aborted(cycle, await this.repo.listTransactions());
      }

      transactions = await this.repo.listTransactions();
      memory = await this.repo.listMemory();
      const sim = simulateExperiment({
        opportunity: selected,
        budget,
        memory: memory.find((m) => m.kind === 'opportunity' && m.refId === selected.id),
      });

      experiment = {
        id: expId,
        cycleId: cycle.id,
        opportunityId: selected.id,
        opportunityName: selected.name,
        category: selected.category,
        objective: `Validate demand and first-revenue path for "${selected.name}" within ${selected.timeToRevenueDaysMax} days.`,
        startingBudget: budget,
        plannedAction: `Run one minimal, time-boxed test: single offer, single channel, budget capped at $${budget.toFixed(2)}.`,
        expectedOutcome: `First revenue signal or clear demand validation; modeled monthly range $${Math.max(0, selected.revenuePotentialMonthlyMin)}–$${Math.max(0, selected.revenuePotentialMonthlyMax)}.`,
        actualCost: sim.actualCost,
        actualRevenue: sim.actualRevenue,
        profitLoss: Math.round((sim.actualRevenue - sim.actualCost) * 100) / 100,
        roi: sim.actualCost > 0 ? Math.round(((sim.actualRevenue - sim.actualCost) / sim.actualCost) * 100) : 0,
        outcome: sim.outcome,
        durationDays: sim.durationDays,
        lessonsLearned: sim.lessons,
        evidenceNote: sim.evidenceNote,
        simulated: true,
        createdAt: Date.now(),
      };
      // The experiment row MUST exist before either ledger entry below is
      // written — transactions.related_experiment_id is a foreign key, and
      // writing the expense first (referencing an experiment that doesn't
      // exist yet) throws a FK constraint violation on D1/Postgres. (This
      // was a real, verified bug: fixed after it surfaced in local testing.)
      await this.repo.appendExperiment(experiment);

      const expenseTx: Transaction = ledgerRecord(transactions, {
        type: 'EXPENSE',
        amount: -budget,
        description: `Simulated experiment budget — ${selected.name}`,
        relatedExperimentId: expId,
      }).slice(-1)[0];
      await this.repo.appendTransaction(expenseTx);
      transactions = [...transactions, expenseTx];

      if (sim.actualRevenue > 0) {
        const revenueTx: Transaction = ledgerRecord(transactions, {
          type: 'REVENUE',
          amount: sim.actualRevenue,
          description: `Simulated revenue — ${selected.name}`,
          relatedExperimentId: expId,
        }).slice(-1)[0];
        await this.repo.appendTransaction(revenueTx);
        await hooks.log(
          'WALLET',
          `Experiment returned $${sim.actualRevenue.toFixed(2)} simulated revenue (net ${sim.actualRevenue - sim.actualCost >= 0 ? '+' : ''}$${(sim.actualRevenue - sim.actualCost).toFixed(2)}).`,
        );
      } else {
        await hooks.log('WALLET', `Experiment returned $0.00 simulated revenue — $${sim.actualCost.toFixed(2)} budget consumed.`);
      }

      await this.repo.completeCycle(cycle.id, {
        experimentId: experiment.id,
        selectedOpportunityId: selected.id,
      });
      await hooks.log(
        'EXPERIMENT',
        `Experiment outcome: ${sim.outcome.replace('_', ' ')} after ${sim.durationDays} simulated days (ROI ${experiment.roi}%).`,
      );
    } else {
      await this.repo.updateCycleStep(cycle.id, 'SIMULATE', 'skipped');
      await hooks.log(
        'WARNING',
        selected
          ? `SIMULATE step skipped: the 18% allocation cap on a $${balance.toFixed(2)} balance is too small to fund a meaningful experiment this cycle — research continues.`
          : 'SIMULATE step skipped: no affordable executable candidate (finance models remain research-only).',
      );
    }
    if (!(await tick('SIMULATE', stepDelay * 0.6))) return aborted(cycle, await this.repo.listTransactions());

    /* 8 — MEASURE */
    await hooks.setActivity?.('Measuring results and writing to memory…', 'MEASURE');
    if (experiment) {
      opportunities = await this.repo.listOpportunities();
      const opp = opportunities.find((o) => o.id === experiment!.opportunityId);
      if (opp) {
        let memState = await this.repo.listMemory();
        // Build memory updates the same way memory service expects.
        const updatedEntries = recordResult(memState, experiment, opp);
        // Upsert only the affected entries (opportunity + category).
        const affectedIds = new Set<string>();
        for (const m of updatedEntries) {
          const prior = memState.find(
            (x) => x.kind === m.kind && (m.refId ? x.refId === m.refId : false),
          );
          if (!prior || prior.conclusion !== m.conclusion || prior.tests !== m.tests) {
            await this.repo.upsertMemory(m);
            affectedIds.add(m.id);
          }
        }
        const lesson = lessonFromExperiment(experiment);
        await this.repo.upsertMemory(lesson);
        const oppMem = updatedEntries.find((m) => m.kind === 'opportunity' && m.refId === opp.id);
        await hooks.log(
          'MEMORY',
          oppMem
            ? `Memory updated: "${opp.name}" tested ${oppMem.tests}× — spent $${oppMem.spent.toFixed(2)}, returned $${oppMem.revenue.toFixed(2)} — conclusion: ${oppMem.conclusion}.`
            : 'Memory updated with experiment result.',
        );
      }
    }
    if (!(await tick('MEASURE'))) return aborted(cycle, await this.repo.listTransactions());

    /* 9 — LEARN */
    await hooks.setActivity?.('Updating strategy from results…', 'LEARN');
    {
      transactions = await this.repo.listTransactions();
      memory = await this.repo.listMemory();
      const finalBalance = balanceFrom(transactions);
      const threshold = (await this.repo.getAgent()).survivalThreshold;
      const { strategy, objective } = strategyFromMemory(memory, finalBalance, threshold);
      await this.repo.deactivateStrategies();
      await this.repo.appendStrategy({
        id: uid('strat'),
        name: strategy,
        rationale: objective,
        active: true,
        createdAt: Date.now(),
      });
      await this.repo.updateAgent({ currentStrategy: strategy, currentObjective: objective });
      await hooks.log('MEMORY', `Agent updated strategy: ${strategy}`);

      /* --- Commercial core (build-spec §4/§5/§16): evidence-driven lifecycle,
       * KILL/ITERATE/SCALE decisions, business models, recommended actions.
       * Runs every cycle over every researched-and-not-blocked opportunity —
       * cheap pure functions; only writes when something actually changed,
       * so a healthy system does not flood the decision log with repeats. */
      try {
        const now = Date.now();
        const researched = (await this.repo.listOpportunities()).filter(
          (o) => o.researchStage !== 'UNDISCOVERED',
        );
        const allExperiments = await this.repo.listExperiments();
        const learningEvents = await this.repo.listLearningEvents();
        const categoryStatsForDecisions = computeCategoryRealWorldStats(
          researched,
          await this.repo.listProspects(),
          await this.repo.listRealRevenue(),
        );
        const changedOpps: Opportunity[] = [];
        let promotions = 0;
        let kills = 0;

        for (const o of researched) {
          const { decision, newLifecycleState } = evaluateOpportunity(o, memory, allExperiments, learningEvents, categoryStatsForDecisions);
          const stateChanged = newLifecycleState !== (o.lifecycleState ?? 'DISCOVERED');
          if (stateChanged) {
            changedOpps.push({ ...o, lifecycleState: newLifecycleState });
            if (decision.action === 'SCALE') promotions++;
            if (decision.action === 'KILL') kills++;
          }
          // Persist a decision record whenever something material happened —
          // a state change, or an explicit KILL/SCALE/ITERATE verdict — but
          // not for a plain "not enough evidence yet" CONTINUE every cycle.
          if (stateChanged || decision.action !== 'CONTINUE') {
            await this.repo.appendDecision(decision);
          }
        }
        if (changedOpps.length) {
          await this.repo.upsertOpportunities(changedOpps);
          if (promotions) await hooks.log('DECISION', `${promotions} opportunity(ies) promoted (PROVEN/SCALING) this cycle.`);
          if (kills) await hooks.log('DECISION', `${kills} opportunity(ies) marked FAILED this cycle — evidence did not support them.`);
        }

        // Business models: generate/refresh for high-value candidates —
        // scored above the validation threshold, not execution-blocked.
        // Capped so this stays cheap even with a large opportunity set.
        const freshOpps = await this.repo.listOpportunities();
        const highValue = freshOpps
          .filter((o) => !o.executionBlocked && o.score && o.score.total >= VALIDATION_SCORE_THRESHOLD)
          .sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))
          .slice(0, 5);
        for (const o of highValue) {
          await this.repo.upsertBusinessModel(generateBusinessModel(o, memory));
        }
        let businessModels = await this.repo.listBusinessModels();

        /* --- Real-world pipeline (build-spec §7/§8/§9): dedicated local-
         * business prospect discovery for the strongest practical route to
         * revenue — validated Local/Real-World opportunities with a business
         * model behind them. Only runs when a live search provider is
         * connected; fails soft to nothing otherwise (never fabricated
         * prospects). Bounded per cycle so it stays cheap alongside
         * opportunity discovery in the same cycle. */
        const pursuable = freshOpps
          .filter(
            (o) =>
              !o.executionBlocked &&
              o.category === 'Local / Real-World' &&
              (o.lifecycleState === 'VALIDATING' || o.lifecycleState === 'PROVEN' || o.lifecycleState === 'SCALING'),
          )
          .sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))
          .slice(0, 2);

        if (hasLiveSearch && pursuable.length > 0) {
          const existingProspects = await this.repo.listProspects();
          const allOppsForStats = await this.repo.listOpportunities();
          const realRevenueForStats = await this.repo.listRealRevenue();
          let newProspectsCount = 0;
          let highPriorityCount = 0;
          for (const opp of pursuable) {
            const model = businessModels.find((m) => m.opportunityId === opp.id);
            const existingNames = existingProspects
              .filter((p) => p.opportunityId === opp.id)
              .map((p) => p.businessName);
            // Phase 5 §20 — blend this opportunity's category real close
            // rate into new prospects' probabilityOfClose from the moment
            // they're discovered, once enough real data exists.
            const categoryStats = statsForCategory(
              computeCategoryRealWorldStats(allOppsForStats, existingProspects, realRevenueForStats),
              opp.category,
            );
            const { prospects, sourcesCount } = await discoverProspects(searchCtx, opp, model, existingNames, categoryStats);
            if (prospects.length === 0) continue;
            await this.repo.upsertProspects(prospects);
            for (const p of prospects) {
              await this.repo.appendProspectInteraction({
                id: uid('pint'),
                prospectId: p.id,
                kind: p.status === 'QUALIFIED' ? 'QUALIFIED' : 'DISCOVERED',
                summary: `Discovered via live search (${p.category}) — ${p.priority} priority, lead score ${p.score.total}/100. ${sourcesCount} source(s) reviewed this pass.`,
                createdAt: now,
              });
            }
            newProspectsCount += prospects.length;
            highPriorityCount += prospects.filter((p) => p.priority === 'HIGH').length;
          }
          if (newProspectsCount > 0) {
            await hooks.log(
              'DISCOVERY',
              `Prospect discovery: found ${newProspectsCount} new local business(es) for "${pursuable[0].name}"${pursuable.length > 1 ? ` and ${pursuable.length - 1} other opportunity(ies)` : ''}${highPriorityCount ? ` — ${highPriorityCount} high priority` : ''}.`,
            );
          }
        }

        // Phase 6 (deep research): for the highest-value engaged prospects
        // that don't have a Prospect Intelligence report yet, research the
        // SPECIFIC business (not the generic category) using real search +
        // the real LLM when connected. Capped per cycle to bound API cost;
        // never runs without live search, since there's nothing real to
        // research otherwise.
        const allProspects = await this.repo.listProspects();
        const existingIntelligence = await this.repo.listProspectIntelligence();
        if (hasLiveSearch) {
          // Phase 4/12: prospects that already have an intelligence report
          // are excluded above (no repeat research within its cache TTL);
          // among the rest, still prioritize by expected value first so a
          // budget-limited cycle spends its few searches on the prospects
          // most likely to matter, not just whichever were discovered first.
          const revenueCandidates = rankRevenueProspects(allProspects, 5);

          const needsResearch = revenueCandidates
            .map((candidate) => candidate.prospect)
            .filter((p) => !existingIntelligence.some((i) => i.prospectId === p.id))
            .slice(0, 3);
          for (const p of needsResearch) {
            const statusChanged = p.status === 'INTERESTED' || p.status === 'REPLIED';
            const offerPending = p.status === 'PROPOSAL_SENT' || p.status === 'NEGOTIATING';
            const intel = await researchProspect(searchCtx, liveLlm, p, now, { statusChanged, offerPending });
            await this.repo.upsertProspectIntelligence(intel);
            await this.repo.appendProspectInteraction({
              id: uid('pint'),
              prospectId: p.id,
              kind: 'INTELLIGENCE_GATHERED',
              summary: `Deep research completed (${intel.generator === 'llm' ? 'AI-synthesized' : 'raw source digest'}, ${intel.confidence.toLowerCase()} confidence) — ${intel.sources.length} source(s) reviewed.`,
              createdAt: now,
            });
          }
          if (needsResearch.length > 0) {
            await hooks.log(
              'DECISION',
              `Deep research completed for ${needsResearch.length} top prospect(s) — business-specific findings ready to inform outreach and offers.`,
            );
          }
        }

        // AI outreach assistant (build-spec §9): generate the message set for
        // any QUALIFIED-or-better prospect that doesn't have one yet. Capped
        // per cycle; messages are prepared for human approval only — nothing
        // here sends anything.
        const existingOutreach = await this.repo.listOutreachMessages();
        const needsOutreach = revenueCandidates
          .map((candidate) => candidate.prospect)
          .filter((p) => !existingOutreach.some((m) => m.prospectId === p.id))
          .slice(0, 5);
        for (const p of needsOutreach) {
          const model = businessModels.find((m) => m.opportunityId === p.opportunityId);
          const intel = (await this.repo.listProspectIntelligence()).find((i) => i.prospectId === p.id);
          await this.repo.upsertOutreachMessages(generateOutreachMessages(p, model, intel));
          await this.repo.appendProspectInteraction({
            id: uid('pint'),
            prospectId: p.id,
            kind: 'OUTREACH_GENERATED',
            summary: 'Outreach message set generated (WhatsApp/SMS/email/call script) — pending human review and send.',
            createdAt: now,
          });
        }
        if (needsOutreach.length > 0) {
          await hooks.log('DECISION', `Prepared outreach messages for ${needsOutreach.length} prospect(s) — review before sending.`);
        }

        // Real market-price research (replaces the pure-formula price
        // guess in businessModel.ts's estimatePrice): for any opportunity
        // about to produce an offer that doesn't have researched pricing
        // yet, look up real going rates via live search before quoting a
        // client. Capped implicitly by needsOffer's own cap below.
        const ENGAGED_STATUSES = new Set(['INTERESTED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON']);
        const existingOffers = await this.repo.listOffers();
        const latestIntelligence = await this.repo.listProspectIntelligence();

        // Revenue-acquisition improvement: a strong qualified prospect should
        // have a sales package prepared before first contact. This remains
        // draft-only and is capped at five prospects per cycle.
        const needsOffer = revenueCandidates
          .map((candidate) => candidate.prospect)
          .filter(
            (p) =>
              !existingOffers.some((o) => o.prospectId === p.id) &&
              (
                ENGAGED_STATUSES.has(p.status) ||
                (p.status === 'QUALIFIED' && (p.priority === 'HIGH' || p.priority === 'MEDIUM') && p.score.total >= 60)
              ),
          )
          .slice(0, 5);

                if (hasLiveSearch) {
          const existingPricing = await this.repo.listMarketPriceResearch();
          const oppsNeedingPricing = new Map<string, Opportunity>();
          for (const p of needsOffer) {
            if (existingPricing.some((mp) => mp.opportunityId === p.opportunityId)) continue;
            const opp = researched.find((o) => o.id === p.opportunityId);
            if (opp) oppsNeedingPricing.set(opp.id, opp);
          }
          for (const opp of oppsNeedingPricing.values()) {
            const priceResearch = await researchMarketPrice(searchCtx, liveLlm, opp, Date.now(), { offerPending: true });
            await this.repo.upsertMarketPriceResearch(priceResearch);
          }
          if (oppsNeedingPricing.size > 0) {
            await hooks.log('DECISION', `Researched real market pricing for ${oppsNeedingPricing.size} opportunity(ies) before quoting.`);
          }
        }
        const latestPricing = await this.repo.listMarketPriceResearch();

        for (const p of needsOffer) {
          const model = businessModels.find((m) => m.opportunityId === p.opportunityId);
          const intel = latestIntelligence.find((i) => i.prospectId === p.id);
          const marketPrice = latestPricing.find((mp) => mp.opportunityId === p.opportunityId);
          const offer = generateOffer(p, model, intel, marketPrice);
          await this.repo.upsertOffer(offer);
          const brief = generateDesignBrief(offer, p);
          await this.repo.upsertDesignBrief(brief);
          const demo = generateProspectDemo(p, offer, intel);
          await this.repo.upsertProspectDemo(demo);
          await this.repo.appendProspectInteraction({
            id: uid('pint'),
            prospectId: p.id,
            kind: 'OFFER_DRAFTED',
            summary: `Offer drafted: $${offer.price} over ${offer.timelineDaysMin}-${offer.timelineDaysMax} days, with a design brief and working demo page — pending human review and send.`,
            createdAt: now,
          });
        }
        if (needsOffer.length > 0) {
          await hooks.log('DECISION', `Drafted offer + design brief for ${needsOffer.length} engaged prospect(s) — review before sending.`);
        }

        // Auto-create a delivery project the moment a prospect reaches WON
        // against a drafted offer (Phase 3). CRM status changes are always
        // human-driven (repo.updateProspectStatus) — this only reacts to a
        // WON status that already exists, it never sets one itself.
        const allOffers = await this.repo.listOffers();
        const existingProjects = await this.repo.listProjects();
        const wonNeedingProject = allProspects.filter(
          (p) => p.status === 'WON' && !existingProjects.some((pr) => pr.prospectId === p.id),
        );
        for (const p of wonNeedingProject) {
          const offer = allOffers.find((o) => o.prospectId === p.id);
          if (!offer) continue; // no offer on record yet — nothing to build a project from
          const project = createProjectFromWonOffer(p, offer, now);
          await this.repo.upsertProject(project);
          if (offer.status !== 'ACCEPTED') await this.repo.updateOfferStatus(offer.id, 'ACCEPTED');
          await this.repo.appendProspectInteraction({
            id: uid('pint'),
            prospectId: p.id,
            kind: 'PROJECT_STARTED',
            summary: `Delivery project started — agreed $${project.agreedPrice} over ~${project.agreedTimelineDaysMax} days.`,
            createdAt: now,
          });
        }
        if (wonNeedingProject.length > 0) {
          await hooks.log('DECISION', `Started ${wonNeedingProject.length} delivery project(s) for won prospect(s).`);
        }

        // "What should I do now?" — recomputed and fully replaced every cycle.
        const decisions = await this.repo.listDecisions();
        businessModels = await this.repo.listBusinessModels();
        const finalProspects = await this.repo.listProspects();
        const finalOffers = await this.repo.listOffers();
        const finalProjects = await this.repo.listProjects();
        const finalCategoryStats = computeCategoryRealWorldStats(freshOpps, finalProspects, await this.repo.listRealRevenue());
        const currentSurvivalStatus = computeSurvivalStatus(balanceFrom(await this.repo.listTransactions()));
        const actions = computeRecommendedActions(
          freshOpps,
          decisions,
          businessModels,
          memory,
          finalProspects,
          finalOffers,
          finalProjects,
          finalCategoryStats,
          currentSurvivalStatus,
        );
        await this.repo.replaceActions(actions);
        if (actions[0]) {
          await hooks.log('DECISION', `Top recommended action: ${actions[0].title}`);
        }
      } catch (e) {
        // Commercial-core evaluation must never take down the core research
        // loop — log and continue; the next cycle will re-evaluate anyway.
        await hooks.log('WARNING', `Commercial-core evaluation failed this cycle: ${(e as Error).message}`);
      }

      // Persist the search-economy ledger (budget usage + cache) once,
      // whatever happened above — losing this write only means the next
      // cycle re-derives slightly stale counts, never a crash.
      await saveEconomyState(this.repo, searchCtx.state);

      await this.repo.completeCycle(cycle.id, {
        completedAt: Date.now(),
        summary: `Cycle #${index}: balance $${finalBalance.toFixed(2)}, ${experiment ? `experiment ${experiment.outcome}` : 'no experiment'}.`,
      });
      await hooks.log('CYCLE', `Cycle #${index} complete. Balance $${finalBalance.toFixed(2)} / threshold $${threshold.toFixed(2)}.`);
    }
    await tick('LEARN', stepDelay * 0.6);

    /* Final status — persisted by the caller's releaseCycleLock() so it is
     * set exactly once, on every exit path (success, abort, or throw). */
    transactions = await this.repo.listTransactions();
    const finalBalance = balanceFrom(transactions);
    const finalStatus: CycleOutcome['finalStatus'] = computeSurvivalStatus(finalBalance);

    // Survivor 2.0 §10 — evaluate the mission ladder against the real
    // final balance for this cycle; log once when a mission completes.
    const currentMissions = await this.repo.listMissions();
    if (currentMissions.length > 0) {
      const updatedAgent = await this.repo.getAgent();
      const withStrategy = currentMissions.map((m) =>
        m.status === 'ACTIVE' ? { ...m, strategy: updatedAgent.currentStrategy || m.strategy } : m,
      );
      const evaluated = evaluateMissions(withStrategy, finalBalance);
      const newlyCompleted = evaluated.filter(
        (m, i) => m.status === 'COMPLETED' && currentMissions[i]?.status !== 'COMPLETED',
      );
      await this.repo.upsertMissions(evaluated);
      for (const m of newlyCompleted) {
        await hooks.log('DECISION', `Mission complete: "${m.objective}" — reached $${finalBalance.toFixed(2)} (target $${m.targetBalance.toFixed(2)}).`);
      }
    }

    return { cycle, decision, experiment, balance: finalBalance, finalStatus };

    function stepLabel(step: CycleStepKey): string {
      const map: Record<CycleStepKey, string> = {
        RESEARCH: 'Researching legitimate income models across categories…',
        DISCOVER: 'Discovering opportunities…',
        VERIFY: 'Analyzing evidence and verifying claims…',
        SCORE: 'Scoring opportunities against the $50 budget…',
        RANK: 'Ranking candidates by risk-adjusted return…',
        SELECT: 'Selecting the next experiment…',
        SIMULATE: 'Simulating experiment…',
        MEASURE: 'Measuring results and writing to memory…',
        LEARN: 'Updating strategy from results…',
      };
      return map[step];
    }
  }

  /** Generate a report and persist it (used by both browser and worker). */
  async generateReportFor(opportunityId: string) {
    const opps = await this.repo.listOpportunities();
    const opp = opps.find((o) => o.id === opportunityId);
    if (!opp) return null;
    const report = generateReport(opp);
    await this.repo.appendReport(report);
    return report;
  }

  private hooks(): EngineHooks {
    const opts = this.options;
    return {
      log: async (type: EventType, message: string) => {
        await this.repo.appendEvent({ id: uid('evt'), type, message, createdAt: Date.now() });
        opts.onLog?.(type, message);
      },
      setStatus: async (status: AgentStatusLike) => {
        opts.onStatus?.(status);
      },
      setActivity: async (activity: string, step: CycleStepKey | null) => {
        opts.onActivity?.(activity, step);
      },
    };
  }
}

type AgentStatusLike = 'ALIVE' | 'AT_RISK' | 'CRITICAL' | 'DEAD' | 'RESEARCHING' | 'EXECUTING' | 'PAUSED';

async function aborted(cycle: AgentCycle, transactions: Transaction[]): Promise<CycleOutcome | null> {
  const balance = balanceFrom(transactions);
  return {
    cycle,
    decision: null,
    experiment: null,
    balance,
    finalStatus: computeSurvivalStatus(balance),
  };
}
