/* ============================================================================
 * SURVIVE AI — browser store.
 * Thin orchestration over the shared, transport-independent AgentEngine.
 * The engine writes through a StoreRepository (zustand), so the in-browser
 * demo and the Cloudflare Worker (SupabaseRepository) run identical logic.
 * State persists to localStorage; engine internals are not persisted.
 * ========================================================================== */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Agent,
  AgentCycle,
  AgentEvent,
  CycleStepKey,
  Experiment,
  MemoryEntry,
  Opportunity,
  ResearchReport,
  Strategy,
  Transaction,
} from './types';
import { uid } from './lib/format';
import { simulateExperiment, experimentBudget } from './lib/simulation';
import { record as ledgerRecord, balanceFrom } from './services/wallet';
import { scoreOpportunity } from './lib/scoring';
import { recordResult, lessonFromExperiment } from './services/memory';
import { decide, strategyFromMemory } from './services/ai';
import { AgentEngine } from './engine/agentEngine';
import { createStoreRepository } from './engine/storeRepository';
import { createSeedSnapshot } from './engine/seed';
import { createLLMProvider } from './services/providers/llm';
import { createSearchProvider } from './services/providers/search';
import { env, featureFlags } from './config/env';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function seedInitialState() {
  const snap = createSeedSnapshot();
  return {
    agent: snap.agent,
    opportunities: snap.opportunities,
    reports: [] as ResearchReport[],
    experiments: [] as Experiment[],
    memory: [] as MemoryEntry[],
    transactions: snap.transactions,
    events: snap.events,
    strategies: snap.strategies,
    cycles: [] as AgentCycle[],
  };
}

interface LoopState {
  running: boolean;
  busy: boolean;
  currentStep: CycleStepKey | null;
  activeCycleId: string | null;
  activity: string;
}

interface SurviveState {
  agent: Agent;
  opportunities: Opportunity[];
  reports: ResearchReport[];
  experiments: Experiment[];
  memory: MemoryEntry[];
  transactions: Transaction[];
  events: AgentEvent[];
  strategies: Strategy[];
  cycles: AgentCycle[];
  loop: LoopState;

  logEvent: (type: AgentEvent['type'], message: string) => void;
  startLoop: () => void;
  pauseLoop: () => void;
  runNextCycle: () => void;
  resetSimulation: () => void;
  runManualExperiment: (opportunityId: string) => void;
  generateReportFor: (opportunityId: string) => void;
  _runAuto: () => Promise<void>;
}

export const useStore = create<SurviveState>()(
  persist(
    (set, get) => {
      /* -------- engine wiring: providers from env (absent → rule engine) ------ */
      const llm = createLLMProvider({ anthropic: env.anthropicKey, openai: env.openaiKey });
      const search = createSearchProvider({ tavily: env.tavilyKey, brave: env.braveKey });

      const repo = createStoreRepository(
        () => get() as any,
        set as any,
        () => seedInitialState() as any,
      );

      const engine = new AgentEngine(
        repo,
        { llm, search },
        {
          // Note: engine events are already persisted through StoreRepository
          // (appendEvent writes to store.events), so onLog is intentionally a
          // no-op here — it is only needed by hosts whose repo does not
          // stream back into the UI.
          onStatus: (status) => {
            set((s: any) => ({ agent: { ...s.agent, status } }));
          },
          onActivity: (activity, step) => {
            set((s: any) => {
              const cycles = s.cycles as AgentCycle[];
              const latest = cycles.length ? cycles[cycles.length - 1] : null;
              return {
                loop: {
                  ...s.loop,
                  activity,
                  currentStep: step,
                  activeCycleId: latest?.id ?? s.loop.activeCycleId,
                },
              };
            });
          },
        },
      );

      return {
        ...seedInitialState(),
        loop: {
          running: false,
          busy: false,
          currentStep: null,
          activeCycleId: null,
          activity: 'Idle — awaiting research instructions.',
        },

        logEvent: (type: AgentEvent['type'], message: string) =>
          set((s: any) => ({
            events: [...s.events, { id: uid('evt'), type, message, createdAt: Date.now() }].slice(-250),
          })),

        startLoop: () => {
          const s = get();
          if (s.agent.status === 'DEAD') {
            get().logEvent('WARNING', 'Agent is DEAD. Reset the simulation to restart.');
            return;
          }
          if (s.loop.busy) return;
          set((st: any) => ({
            loop: { ...st.loop, running: true, activity: 'Research loop started — running autonomously.' },
            agent: { ...st.agent, status: 'RESEARCHING' },
          }));
          get().logEvent('CYCLE', 'Autonomous research loop STARTED.');
          void get()._runAuto();
        },

        pauseLoop: () => {
          if (!get().loop.running) return;
          set((st: any) => ({ loop: { ...st.loop, running: false } }));
          get().logEvent('CYCLE', 'Pause requested — agent will halt after the current step.');
        },

        runNextCycle: () => {
          const s = get();
          if (s.loop.busy) return;
          if (s.agent.status === 'DEAD') {
            get().logEvent('WARNING', 'Agent is DEAD. Reset the simulation to continue.');
            return;
          }
          void runOneCycle(false);
        },

        resetSimulation: () => {
          const fresh = seedInitialState();
          set({
            ...fresh,
            loop: {
              running: false,
              busy: false,
              currentStep: null,
              activeCycleId: null,
              activity: 'Simulation reset — $50 seed restored.',
            },
          } as any);
          get().logEvent('SYSTEM', 'Simulation reset to initial $50.00 seeded state.');
        },

        /* Manual experiment (Decision Center / Explorer). Uses the same
         * simulation + memory services as the autonomous loop. */
        runManualExperiment: (opportunityId: string) => {
          const s = get();
          if (s.agent.status === 'DEAD') {
            get().logEvent('WARNING', 'Agent is DEAD — experiments are locked.');
            return;
          }
          if (s.loop.busy) return;
          const opp = s.opportunities.find((o: Opportunity) => o.id === opportunityId);
          if (!opp) return;
          if (opp.executionBlocked) {
            get().logEvent('REJECTION', `Manual experiment blocked: "${opp.name}" — ${opp.blockReason}`);
            return;
          }
          const balance = balanceFrom(s.transactions);
          const budget = experimentBudget(opp, balance);
          if (budget <= 0 || balance < budget) {
            get().logEvent('WARNING', `Insufficient simulated balance for "${opp.name}".`);
            return;
          }

          set((st: any) => ({
            agent: { ...st.agent, status: 'EXECUTING' },
            loop: { ...st.loop, busy: true, activity: `Simulating: ${opp.name}…` },
          }));

          const manualExpId = uid('exp');
          const expenseTx = ledgerRecord(get().transactions, {
            type: 'EXPENSE',
            amount: -budget,
            description: `Simulated experiment budget — ${opp.name} (manual)`,
            relatedExperimentId: manualExpId,
          }).slice(-1)[0];
          set((st: any) => ({ transactions: [...st.transactions, expenseTx] }));
          get().logEvent('EXPERIMENT', `Manual experiment simulation created for "${opp.name}" — $${budget.toFixed(2)} simulated budget.`);

          const sim = simulateExperiment({
            opportunity: opp,
            budget,
            memory: get().memory.find((m: MemoryEntry) => m.kind === 'opportunity' && m.refId === opp.id),
          });

          let transactions = get().transactions;
          if (sim.actualRevenue > 0) {
            const revenueTx = ledgerRecord(transactions, {
              type: 'REVENUE',
              amount: sim.actualRevenue,
              description: `Simulated revenue — ${opp.name} (manual)`,
              relatedExperimentId: manualExpId,
            }).slice(-1)[0];
            transactions = [...transactions, revenueTx];
            set({ transactions });
          }

          const experiment: Experiment = {
            id: manualExpId,
            cycleId: null,
            opportunityId: opp.id,
            opportunityName: opp.name,
            category: opp.category,
            objective: `Validate demand for "${opp.name}" (manually launched from Decision Center).`,
            startingBudget: budget,
            plannedAction: 'Single minimal test, single channel, capped budget.',
            expectedOutcome: 'First revenue signal or validated demand.',
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

          const updatedMemory: MemoryEntry[] = recordResult(get().memory, experiment, opp);
          const memory = [lessonFromExperiment(experiment), ...updatedMemory];
          const finalBalance = balanceFrom(get().transactions);
          const { strategy, objective } = strategyFromMemory(memory, finalBalance, get().agent.survivalThreshold);

          set((st: any) => ({
            experiments: [experiment, ...st.experiments],
            memory,
            agent: {
              ...st.agent,
              status: finalBalance <= 0 ? 'DEAD' : finalBalance < st.agent.survivalThreshold ? 'AT_RISK' : 'ALIVE',
              currentStrategy: strategy,
              currentObjective: objective,
            },
            loop: { ...st.loop, busy: false, currentStep: null, activity: 'Manual experiment complete.' },
          }));
          get().logEvent(
            'EXPERIMENT',
            `Manual experiment outcome: ${sim.outcome.replace('_', ' ')} — cost $${sim.actualCost.toFixed(2)}, revenue $${sim.actualRevenue.toFixed(2)}, ROI ${experiment.roi}%.`,
          );
        },

        /* Reports go through the engine (same generator as the worker). */
        generateReportFor: async (opportunityId: string) => {
          // Ensure score exists locally before generating.
          const opp = get().opportunities.find((o: Opportunity) => o.id === opportunityId);
          if (opp && !opp.score) {
            const scored = { ...opp, score: scoreOpportunity(opp) };
            set((st: any) => ({
              opportunities: st.opportunities.map((o: Opportunity) => (o.id === opp.id ? scored : o)),
            }));
          }
          const report = await engine.generateReportFor(opportunityId);
          if (report) {
            set((st: any) => ({
              reports: [report, ...st.reports.filter((r: ResearchReport) => r.opportunityId !== opportunityId)],
            }));
            get().logEvent('SYSTEM', `Research report generated for "${opp?.name}" (${llm?.connected ? llm.label : 'rule engine'}).`);
          }
        },

        _runAuto: async () => {
          while (get().loop.running) {
            if (get().agent.status === 'DEAD') break;
            await runOneCycle(true);
            if (!get().loop.running) break;
            await delay(1300);
          }
        },
      };

      async function runOneCycle(auto: boolean) {
        if (get().loop.busy) return;
        set((st: any) => ({ loop: { ...st.loop, busy: true } }));
        try {
          await engine.runCycle({
            useLive: true,
            stepDelay: 620,
            shouldContinue: () => (auto ? get().loop.running : true),
          });
        } catch (e) {
          get().logEvent('WARNING', `Cycle error: ${(e as Error).message}`);
        } finally {
          const balance = balanceFrom(get().transactions);
          const dead = balance <= 0;
          const running = get().loop.running;
          set((st: any) => ({
            loop: {
              ...st.loop,
              busy: false,
              currentStep: null,
              activeCycleId: null,
              running: dead ? false : running,
              activity: dead
                ? 'Agent DEAD — capital exhausted. Reset to start a new simulation.'
                : running
                  ? 'Research loop running — beginning next cycle…'
                  : 'Idle — research cycle complete.',
            },
            agent: {
              ...st.agent,
              status: dead
                ? 'DEAD'
                : running
                  ? 'RESEARCHING'
                  : balance < st.agent.survivalThreshold
                    ? 'AT_RISK'
                    : 'ALIVE',
            },
          }));
        }
      }
    },
    {
      name: 'survive-ai-v2',
      partialize: (s: any) => ({
        agent: s.agent,
        opportunities: s.opportunities,
        reports: s.reports,
        experiments: s.experiments,
        memory: s.memory,
        transactions: s.transactions,
        events: s.events,
        strategies: s.strategies,
        cycles: s.cycles,
      }),
      onRehydrateStorage: () => (state: any) => {
        if (!state) return;
        const balance = balanceFrom(state.transactions ?? []);
        const status =
          balance <= 0 ? 'DEAD' : balance < (state.agent?.survivalThreshold ?? 5) ? 'AT_RISK' : 'ALIVE';
        useStore.setState({
          agent: { ...state.agent, status },
          loop: {
            running: false,
            busy: false,
            currentStep: null,
            activeCycleId: null,
            activity: 'Idle — awaiting research instructions.',
          },
        });
      },
    },
  ),
);

/* ------------------------------ selectors --------------------------------- */

export function useWalletTotals() {
  const transactions = useStore((s) => s.transactions);
  let revenue = 0;
  let expenses = 0;
  for (const t of transactions) {
    if (t.amount > 0 && t.type !== 'DEPOSIT') revenue += t.amount;
    if (t.amount < 0) expenses += Math.abs(t.amount);
  }
  return {
    balance: balanceFrom(transactions),
    revenue: Math.round(revenue * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
    profit: Math.round((revenue - expenses) * 100) / 100,
  };
}

/** Live connection flags for the connectors panel (browser). */
export const browserConnections = {
  supabase: featureFlags.supabase,
  search: featureFlags.search,
  llmClaude: Boolean(env.anthropicKey),
  llmOpenai: Boolean(env.openaiKey),
  workers: false,
};
