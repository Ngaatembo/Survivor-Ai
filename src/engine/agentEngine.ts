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
import type { EngineHooks, EngineRepository } from './repository';
import { createSeedSnapshot, SURVIVAL_THRESHOLD } from './seed';
import type { LLMProvider, SearchProvider } from '../services/providers/types';

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
  search?: SearchProvider | null;
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
  finalStatus: 'ALIVE' | 'AT_RISK' | 'DEAD';
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
    await this.repo.upsertOpportunities(snap.opportunities);
    for (const tx of snap.transactions) await this.repo.appendTransaction(tx);
    for (const evt of snap.events) await this.repo.appendEvent(evt);
    for (const strat of snap.strategies) await this.repo.appendStrategy(strat);
    await this.repo.updateAgent(snap.agent);
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

    /* 2 — DISCOVER */
    const liveSearch = opts.useLive !== false ? this.providers.search ?? null : null;
    const liveLlm = opts.useLive !== false ? this.providers.llm ?? null : null;

    if (liveSearch?.connected) {
      await hooks.setActivity?.('Live web search — discovering real opportunities…', 'DISCOVER');
      const existingNames = opportunities.map((o) => o.name);
      const { opportunities: liveOpps, queriesRun, sourcesCount } = await discoverLive(
        liveSearch,
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
          `LIVE discovery: ${queriesRun} searches, ${sourcesCount} sources cited, ${liveOpps.length} new opportunities tagged LIVE${liveLlm?.connected ? ` and analyzed by ${liveLlm.label}` : ' (analysis pending LLM connector)'}.`,
        );
      } else {
        await hooks.log('DISCOVERY', 'Live search returned no new models (or provider error) — continuing from knowledge base.');
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
          `${liveSearch?.connected ? 'Also discovered' : 'Discovered'} ${discovered.length} from knowledge base: ${discovered.map((d) => d.name).join('; ')}.`,
        );
      } else if (!liveSearch?.connected) {
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
      const scored = scoreAll(opportunities);
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
      const ranked = rankOpportunities(opportunities).map((o) =>
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
    if (selected && balance > 1) {
      await hooks.setActivity?.(`Simulating experiment: ${selected.name}…`, 'SIMULATE');
      const budget = experimentBudget(selected, balance);
      const expId = uid('exp');
      const expenseTx: Transaction = ledgerRecord(transactions, {
        type: 'EXPENSE',
        amount: -budget,
        description: `Simulated experiment budget — ${selected.name}`,
        relatedExperimentId: expId,
      }).slice(-1)[0];
      await this.repo.appendTransaction(expenseTx);
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
      await this.repo.appendExperiment(experiment);
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
      await hooks.log('WARNING', 'SIMULATE step skipped: no affordable executable candidate (finance models remain research-only).');
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
      await this.repo.completeCycle(cycle.id, {
        completedAt: Date.now(),
        summary: `Cycle #${index}: balance $${finalBalance.toFixed(2)}, ${experiment ? `experiment ${experiment.outcome}` : 'no experiment'}.`,
      });
      await hooks.log('CYCLE', `Cycle #${index} complete. Balance $${finalBalance.toFixed(2)} / threshold $${threshold.toFixed(2)}.`);
    }
    await tick('LEARN', stepDelay * 0.6);

    /* Final status */
    transactions = await this.repo.listTransactions();
    const finalBalance = balanceFrom(transactions);
    const finalStatus: CycleOutcome['finalStatus'] =
      finalBalance <= 0 ? 'DEAD' : finalBalance < SURVIVAL_THRESHOLD ? 'AT_RISK' : 'ALIVE';
    await this.repo.updateAgent({
      status: finalStatus,
    });

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

type AgentStatusLike = 'ALIVE' | 'AT_RISK' | 'DEAD' | 'RESEARCHING' | 'EXECUTING' | 'PAUSED';

async function aborted(cycle: AgentCycle, transactions: Transaction[]): Promise<CycleOutcome | null> {
  const balance = balanceFrom(transactions);
  return {
    cycle,
    decision: null,
    experiment: null,
    balance,
    finalStatus: balance <= 0 ? 'DEAD' : balance < SURVIVAL_THRESHOLD ? 'AT_RISK' : 'ALIVE',
  };
}
